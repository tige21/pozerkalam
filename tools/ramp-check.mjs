#!/usr/bin/env node
/* Гейт эстакады (коды render-ramp-deck, render-ramp-sides, render-ramp-marks; сценарии —
   specs/features/render/estakada.feature). Эстакада рисовалась плоской серой наклейкой: без боков, без
   текстуры, на экзамене того же тона, что асфальт улицы, а стоп-линию на подъёме закрывал сам настил.
   Проверяется то, что видит игрок: настил отличается от земли рядом и несёт узор, бортики идут по всей длине
   каждого бока с высотой настила (числа — из описания зон, не из кода бортиков), стоп-линия на подъёме видна
   поверх настила.
     PW_DIR=/tmp/pw node tools/ramp-check.mjs
     FAULT=deckflat|noside|marksunder — сломать нарочно и увидеть красный: прежняя плоская наклейка; бортиков
       нет; разметка на эстакаде остаётся под настилом
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || '';

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) for (const sub of fs.readdirSync(path.join(cache, d))) {
    const bin = path.join(cache, d, sub, 'chrome-headless-shell');
    if (fs.existsSync(bin)) return bin;
  }
  console.error('Chromium не найден: задай PW_CHROME'); process.exit(2);
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
const prep = await context.newPage();
await prep.goto(url);
await prep.evaluate(() => {
  for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_gfx', 'max'); localStorage.setItem('trainer_traffic', 'off');
});
await prep.close();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
await page.goto(url + 'r');
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && typeof carModel !== 'undefined' && carModel.state !== 'off', null, { timeout: 20000 });
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

await page.evaluate((fault) => {
  /* прежний вид целиком: плоская заливка без узора и рифлей */
  if (fault === 'deckflat') {
    window.emitRampDeck = (z) => { rampRaw = false; fillGroundPoly(z.corners, '#71767d', 'rgba(230,234,238,.55)', 2, 0.012); rampRaw = true; };
    const o = rampBuild; window.rampBuild = function (lv) { o(lv); lv.rampDec = lv.rampDec.filter((d) => d.fill !== RAMP_GROOVE_COL); };
  }
  if (fault === 'noside') window.rampSidesSplit = (rend) => rend;
  /* перенесённая на эстакаду разметка возвращается в слой земли — под настил, как было */
  if (fault === 'marksunder') { const o = rampBuild; window.rampBuild = function (lv) { o(lv);
    const own = (d) => d.fill === RAMP_EDGE_COL || d.fill === RAMP_GROOVE_COL;
    lv.dec.push(...lv.rampDec.filter((d) => !own(d))); lv.rampDec = lv.rampDec.filter(own); }; }
}, FAULT);

/* уровни с эстакадой — по признаку, не по номерам */
const RL = await page.evaluate(() => LEVELS.map((d, i) => i).filter((i) => !LEVELS[i].custom && (loadLevel(i), level.ramps.length > 0)));

/* камера сзади на подходе: точки на настиле и на земле сбоку от эстакады на той же дальности */
const shot = async (li, setup) => page.evaluate(([li, setup]) => {
  loadLevel(li); doAct('start'); hideOv(); paused = true; opt.mirrors = false; opt.refs = 0; opt.marks = false; opt.guides = false;
  while (hudMode !== 2) cycleHud();
  /* чужие машины в замер не входят: у старта подъёма на экзамене стоит припаркованная, ровно на месте патча */
  level.rend = level.rend.filter((o) => o.kind !== 'car');
  const z0 = level.ramps[0], f = z0.up, r = z0.rt;
  const at = (a, x) => ({ u: z0.ou + f.u * a + r.u * x, v: z0.ov + f.v * a + r.v * x });
  /* настил меряется сверху над ним — издалека на 1280×720 он в два десятка пикселей и патч цеплял бы края;
     стоп-линия — сзади на подходе, как её видит водитель */
  const zd = level.ramps.find((z) => z.kind === 'deck'), dd = (zd.ov - z0.ov) * f.v + (zd.ou - z0.ou) * f.u + zd.len * 0.5;
  opt.camMode = setup.kind === 'deck' ? CAM_TOP : CAM_CHASE;
  const p = setup.kind === 'deck' ? at(0, 0) : at(-setup.back, setup.lat);
  setBody(p.u, p.v, Math.atan2(f.u, f.v)); car.vel = 0; opt.camYaw = Math.atan2(f.u, f.v) + (setup.yaw || 0); camSm = null;
  for (let k = 0; k < 4; k++) render(0.016);
  const cv = document.getElementById('view'), sc = cv.width / W, g = cv.getContext('2d');
  const C = viewCam, proj = (u, y, v) => { const dx = -u - C.pos.x, dy = y - C.pos.y, dz = v - C.pos.z, d = dx * C.f.x + dy * C.f.y + dz * C.f.z, k = C.scale / d;
    return { x: C.cx + (dx * C.r.x + dy * C.r.y + dz * C.r.z) * k, y: C.cy - (dx * C.u.x + dy * C.u.y + dz * C.u.z) * k, d }; };
  const patch = (q, hw, hh) => { const x0 = Math.round((q.x - hw) * sc), y0 = Math.round((q.y - hh) * sc), w = Math.round(2 * hw * sc), h = Math.round(2 * hh * sc);
    const px = g.getImageData(x0, y0, Math.max(1, w), Math.max(1, h)).data, L = [];
    for (let k = 0; k < px.length; k += 4) L.push(0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]);
    const m = L.reduce((s, x) => s + x, 0) / L.length, sd = Math.sqrt(L.reduce((s, x) => s + (x - m) * (x - m), 0) / L.length);
    return { m: +m.toFixed(1), sd: +sd.toFixed(1) }; };
  const out = { level: li + 1 };
  if (setup.kind === 'deck') {
    /* машина сверху стоит на начале подъёма; патчи — слева от неё (тень от солнца падает вправо-назад), между
       бортом и жёлтым краем: настил в 1,5 м от начала подъёма (стоп-линия дальше), дорога — в 2 м до него */
    const L = -(z0.hw - 0.22 + CAR.width / 2) / 2, qd = at(1.5, L), qr = at(-2, L);
    const pd = proj(qd.u, z0.grade * 1.5, qd.v), pr = proj(qr.u, 0, qr.v), e = at(1.5, L + 0.15);
    const px = Math.abs(proj(e.u, z0.grade * 1.5, e.v).x - pd.x);
    out.deck = patch(pd, px, px); out.road = patch(pr, px, px); out.at = [Math.round(pd.x), Math.round(pd.y), Math.round(pr.y), +px.toFixed(1)];
  }
  if (setup.kind === 'mark') {
    /* стоп-линия на подъёме: её точка — из стоп-линий города или полосы-наклейки уровня, на высоте настила */
    const sl = level.city && level.city.stoplines && level.city.stoplines.find((s) => level.ramps.some((z) => { const du = s.u - z.ou, dv = s.v - z.ov, a = du * z.up.u + dv * z.up.v; return z.kind === 'ramp' && a > 0 && a < z.len; }));
    const m = sl ? { u: sl.u, v: sl.v } : (level.marks.stop ? { u: (level.marks.stop.pts[0].u + level.marks.stop.pts[1].u) / 2, v: level.marks.stop.pts[0].v } : null);
    if (m) { const q = proj(m.u, groundH(m.u, m.v) + 0.02, m.v); out.line = patch(q, 6, 1); const zr = level.ramps[0], aa = (m.v - zr.ov) * zr.up.v + (m.u - zr.ou) * zr.up.u + 1.2, b = at(aa, 0);
      out.deckNear = patch(proj(b.u, groundH(b.u, b.v), b.v), 6, 2); out.at = [Math.round(q.x), Math.round(q.y)]; }
  }
  return out;
}, [li, setup]);

/* ---- настил отличается от земли и несёт узор ---- */
const deck = [];
for (const li of RL) deck.push(await shot(li, { kind: 'deck', back: 15, lat: 0 }));
const dOk = deck.length >= 2 && deck.every((r) => Math.abs(r.deck.m - r.road.m) >= 18 && r.deck.sd >= 4);
check('настил эстакады отличается от дороги перед подъёмом (≥ 18 уровней яркости) и несёт узор — не плоская заливка (@render-ramp-deck)', dOk, JSON.stringify(deck));

/* ---- бортики по всей длине каждого бока, высота — настил + бортик ---- */
const sides = await page.evaluate((RL) => {
  const out = { zones: 0, sides: 0, bad: [] };
  for (const li of RL) {
    loadLevel(li);
    for (const z of level.ramps) {
      out.zones++;
      /* высота настила — из описания зоны: у подъёма уклон × расстояние, у площадки — её отметка */
      const H = (a) => z.kind === 'deck' ? z.h : z.grade * Math.min(z.len, Math.max(0, a));
      for (const sgn of [-1, 1]) {
        const iv = [];
        for (const o of level.rend) {
          if (o.kind !== 'rampside') continue;
          const du = o.u - z.ou, dv = o.v - z.ov, lat = du * z.rt.u + dv * z.rt.v, a = du * z.up.u + dv * z.up.v;
          if (Math.sign(lat) !== sgn || Math.abs(lat) - o.w / 2 > z.hw + 0.3 || a < -0.01 || a > z.len + 0.01) continue;
          const f = fuv(o.yaw), par = f.u * z.up.u + f.v * z.up.v, a0 = a - par * o.l / 2, a1 = a + par * o.l / 2;
          const [lo, hi, hl, hh] = a0 < a1 ? [a0, a1, o.hs0, o.hs1] : [a1, a0, o.hs1, o.hs0];
          if (Math.abs(hl - H(lo)) > 0.01 || Math.abs(hh - H(hi)) > 0.01) out.bad.push(`L${li + 1} зона ${z.kind} бок ${sgn}: высота ${hl.toFixed(2)}–${hh.toFixed(2)} вместо ${H(lo).toFixed(2)}–${H(hi).toFixed(2)}`);
          if (Math.abs(o.h - (Math.max(hl, hh) + RAMP_PARAPET)) > 0.01) out.bad.push(`L${li + 1}: верх бортика не над настилом`);
          iv.push([Math.max(0, lo), Math.min(z.len, hi)]);
        }
        iv.sort((p, q) => p[0] - q[0]);
        let reach = 0; for (const [lo, hi] of iv) { if (lo > reach + 0.01) break; reach = Math.max(reach, hi); }
        out.sides++;
        if (reach < z.len - 0.01) out.bad.push(`L${li + 1} зона ${z.kind} бок ${sgn}: бортик до ${reach.toFixed(2)} из ${z.len}`);
      }
    }
  }
  out.bad = out.bad.slice(0, 8);
  return out;
}, RL);
check('вдоль каждого бока каждой зоны эстакады — бортик без разрывов, высота у концов = настил по уклону + бортик (@render-ramp-sides)',
  sides.zones >= 6 && sides.sides === sides.zones * 2 && !sides.bad.length, JSON.stringify(sides));

/* ---- стоп-линия на подъёме поверх настила ---- */
const marks = [];
for (const li of RL) marks.push(await shot(li, { kind: 'mark', back: 9, lat: 0 }));
const mOk = marks.length >= 2 && marks.every((r) => r.line && r.line.m - r.deckNear.m >= 40);
check('стоп-линия на подъёме видна поверх настила — светлее настила рядом на ≥ 40 уровней (@render-ramp-marks)', mOk, JSON.stringify(marks));

check('страница без исключений', !errors.length, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
await browser.close();
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
