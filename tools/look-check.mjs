#!/usr/bin/env node
/* Внешний вид сцены одной командой: кадры «как это выглядит» плюс числа по пикселям — рёбра
   коробочных объектов, текстура стен, живое отражение на стекле корпуса зеркала, подпись
   HUD-зеркала. Зависимость playwright-core — как у cockpit-shots (PW_DIR, по умолчанию /tmp/pw):
     PW_DIR=/tmp/pw node tools/look-check.mjs before            # база «до»
     PW_DIR=/tmp/pw node tools/look-check.mjs after --mobile    # телефон 844×390, DPR 2, тач
   Выход: build/shots/look-<tag>-<кадр>.png, одна JSON-строка в stdout; код 1 на любой красной
   проверке, ошибке страницы или пустом кадре. Коды требований — specs/features/render/vid.feature.
   Числа берутся с основного канваса (getImageData), координаты граней — через снимок viewCam. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tag = args.find(a => !a.startsWith('--')) || 'run';
const mobile = args.includes('--mobile');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const OUT = path.join(ROOT, 'build', 'shots');

function loadPlaywright() {
  try { return createRequire(path.join(PW_DIR, 'package.json'))('playwright-core'); }
  catch { console.error(`playwright-core не найден в ${PW_DIR}: mkdir -p ${PW_DIR} && (cd ${PW_DIR} && npm i playwright-core@1.55)`); process.exit(2); }
}
function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const d of dirs.reverse())
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const bin = path.join(cache, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  console.error('Chromium не найден: задай PW_CHROME=/путь/к/chrome-headless-shell');
  process.exit(2);
}

const { chromium } = loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const context = await browser.newContext(mobile
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', e => { if (/ServiceWorker/.test(e.message)) return; pageErrors.push(e.message); console.error('PAGEERR', e.message); });

await page.goto(url);
await page.evaluate((touch) => {
  for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9');
  localStorage.setItem('trainer_touch', touch);
  /* регулятор качества в headless-браузере за секунды уходит на q3 и гасит текстуры — уровень
     закрепляется «максимумом», проверяется картинка, а не лестница */
  localStorage.setItem('trainer_gfx', 'max');
}, mobile ? '1' : '0');
await page.goto(url + 'r');
await page.waitForTimeout(300);
await page.evaluate(() => doAct('start'));
await page.waitForTimeout(400);

/* помощники живут в странице: проекция через viewCam (после render `cam` держит последнее
   зеркало), чтение пикселей с основного канваса в CSS-координатах */
await page.evaluate(() => {
  window.__lk = {
    proj(p) {
      const V = viewCam, cx = p.x - V.pos.x, cy = p.y - V.pos.y, cz = p.z - V.pos.z;
      const x = cx * V.r.x + cy * V.r.y + cz * V.r.z, y = cx * V.u.x + cy * V.u.y + cz * V.u.z, d = cx * V.f.x + cy * V.f.y + cz * V.f.z;
      if (d < 0.2) return null;
      return { x: V.cx + x * V.scale / d, y: V.cy - y * V.scale / d, d };
    },
    lum(x, y) {
      const g = canvas.getContext('2d'), k = DPR, d = g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
      return 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
    },
    patch(x0, y0, w, h) {
      const g = canvas.getContext('2d'), k = DPR, d = g.getImageData(Math.round(x0 * k), Math.round(y0 * k), Math.round(w * k), Math.round(h * k)).data;
      let n = 0, s = 0, s2 = 0, r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; s += l; s2 += l * l; r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const m = s / n; return { n, mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)), rgb: [r / n, gg / n, b / n] };
    },
    /* отрезок обрезается по кадру с полем 12 px (Лианг–Барски): стена длиннее экрана */
    clipSeg(a, b) {
      const m = 12, xs = [m, W - m], ys = [m, H - m]; let t0 = 0, t1 = 1;
      const dx = b.x - a.x, dy = b.y - a.y;
      for (const [p, q] of [[-dx, a.x - xs[0]], [dx, xs[1] - a.x], [-dy, a.y - ys[0]], [dy, ys[1] - a.y]]) {
        if (p === 0) { if (q < 0) return null; continue; }
        const t = q / p;
        if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
        else { if (t < t0) return null; if (t < t1) t1 = t; }
      }
      return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
    },
    inPoly(pt, poly) {
      let ins = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) ins = !ins;
      }
      return ins;
    },
    /* самая крупная на экране боковая грань стены: 4 экранных угла, верхнее ребро, нормаль внутрь */
    wallFace() {
      const walls = level.obs.filter(o => o.kind === 'wall');
      let best = null;
      for (const o of walls) {
        const f = fuv(o.yaw), r = ruv(o.yaw);
        const sides = [[f, o.l / 2, r, o.w / 2], [r, o.w / 2, f, o.l / 2]];
        for (const [n, hn, t, ht] of sides) for (const sg of [-1, 1]) {
          const c = { u: o.u + n.u * sg * hn, v: o.v + n.v * sg * hn };
          const P = (k, y) => ({ x: -(c.u + t.u * k * ht), y, z: c.v + t.v * k * ht });
          const w = [P(-1, 0), P(1, 0), P(1, o.h), P(-1, o.h)].map(p => this.proj(p));
          if (w.some(p => !p)) continue;
          /* стена длиннее кадра — годится грань, у которой середина верхнего ребра и центр на экране */
          const top = this.clipSeg(w[3], w[2]);
          const mid = this.clipSeg({ x: (w[0].x + w[3].x) / 2, y: (w[0].y + w[3].y) / 2 }, { x: (w[1].x + w[2].x) / 2, y: (w[1].y + w[2].y) / 2 });
          if (!top || !mid || Math.hypot(top[1].x - top[0].x, top[1].y - top[0].y) < 60 || Math.hypot(mid[1].x - mid[0].x, mid[1].y - mid[0].y) < 60) continue;
          const cam = { x: -viewCam.pos.x, z: viewCam.pos.z };
          if ((cam.x - c.u) * n.u * sg + (cam.z - c.v) * n.v * sg <= 0) continue;
          let a = 0; for (let i = 0; i < 4; i++) { const p = w[i], q = w[(i + 1) % 4]; a += p.x * q.y - q.x * p.y; }
          a = Math.abs(a) / 2;
          if (!best || a > best.area) best = { area: a, pts: w, top, mid, len: o.l, h: o.h, c, t, ht };
        }
      }
      return best;
    }
  };
});

const shots = [], checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) }); };
const shot = async (name) => { const file = path.join(OUT, `look-${tag}-${name}.png`); await page.screenshot({ path: file }); shots.push(path.relative(ROOT, file)); return file; };
const pose = async (fn, arg, wait = 250) => { await page.evaluate(fn, arg); await page.waitForTimeout(wait); };

/* --- салон: вперёд без HUD, корпус левого зеркала, салонное зеркало --- */
await pose(() => { if (opt.camMode !== CAM_FP) pressKey('KeyV'); opt.fpYaw = 0; opt.fpPitch = 0; while (hudMode !== 2) cycleHud(); opt.mirrors = false; });
await shot('fp-fwd');
await pose(() => { opt.fpYaw = rad(-45); opt.fpPitch = rad(-6); });
await shot('fp-left45');

/* живое стекло: рамка стекла по mirrorGlassRect (появляется вместе с отражением на корпусе) */
{
  const has = await page.evaluate(() => typeof mirrorGlassRect === 'function');
  if (!has) check('стекло корпуса зеркала живое (@render-mirror-live)', false, 'mirrorGlassRect нет — стекло не рисуется');
  else {
    /* живость проверяется на ОДНОМ уровне и одной позе головы: машина переставляется на 6 м вдоль
       стены — отражение обязано измениться, застывший буфер остался бы прежним. Смена уровня
       меняла кадр сама по себе и проходила бы и с замёрзшим буфером */
    const snap = () => page.evaluate(() => { const r = mirrorGlassRect('left'); if (!r) return null; return { r, p: __lk.patch(r.x + r.w * 0.2, r.y + r.h * 0.2, r.w * 0.6, r.h * 0.6) }; });
    const a = await snap();
    await pose(() => { const c = bodyPos(); setBody(c.u, c.v + 6, car.th); }, null, 500);
    const b = await snap();
    await pose(() => { const c = bodyPos(); setBody(c.u, c.v - 6, car.th); }, null, 400);
    const diff = a && b ? Math.hypot(...a.p.rgb.map((v, i) => v - b.p.rgb[i])) : 0;
    check('стекло корпуса зеркала живое (@render-mirror-live)', a && b && a.p.sd >= 4 && diff >= 3,
      a && b ? `sd=${a.p.sd.toFixed(1)} разница после переезда на 6 м=${diff.toFixed(1)} rect=${JSON.stringify(a.r)}` : 'стекло вне кадра');
  }
}
await pose(() => { opt.fpYaw = 0; opt.fpPitch = rad(6); });
await shot('fp-up6');

/* --- HUD-зеркала: подписи --- */
await pose(() => { while (hudMode !== 0) cycleHud(); opt.mirrors = true; opt.fpYaw = 0; opt.fpPitch = rad(-2); pressKey('KeyC'); while (opt.camMode !== CAM_CHASE) pressKey('KeyC'); }, null, 400);
await shot('hud-mirrors');
{
  const r = await page.evaluate(() => {
    if (typeof mirrorLabel !== 'function') return null;
    const quiet = MIR_KINDS.filter(k => !(curPhase && curPhase.mirror === k));
    return { quiet, labels: quiet.map(k => mirrorLabel(k)) };
  });
  check('подпись HUD-зеркала только новичку или при подсветке (@render-mirror-label)', r && r.labels.every(l => l === ''), r ? JSON.stringify(r) : 'mirrorLabel нет — подпись всегда');
}

/* --- стены: уровень 2 (четыре бетонные стены двора), из-за машины --- */
await pose(() => { loadLevel(1); while (opt.camMode !== CAM_CHASE) pressKey('KeyC'); while (hudMode !== 2) cycleHud(); opt.mirrors = false; }, null, 500);
await shot('chase-l2');
{
  const r = await page.evaluate(() => {
    const f = __lk.wallFace(); if (!f) return null;
    /* профиль поперёк верхнего ребра в его середине: ребро темнее обеих сторон */
    const [a, b] = f.top, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    /* шаг полпикселя CSS = пиксель устройства при DPR 2: линия в полтора пикселя проваливалась
       между целыми отсчётами */
    const prof = []; for (let o = -7; o <= 7; o += 0.5) prof.push(__lk.lum(mx + nx * o, my + ny * o));
    /* линия обязана быть темнее КАЖДОЙ из сторон: у верхнего ребра одна сторона — освещённый
       верх, другая — борт или небо, и среднее по обеим ловило бы просто тёмный борт */
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const near = Math.min(...prof.slice(10, 19)), farA = mean(prof.slice(0, 5)), farB = mean(prof.slice(24)), far = Math.min(farA, farB);
    /* шов сегмента — вертикальная линия через всю грань: провал ≥ 8 % сразу на трёх высотах
       (30/50/70 %) в одном и том же месте. Пятно текстуры на одной высоте — не шов */
    const [m0, m1] = f.mid, [p0, p1, p2, p3] = f.pts;
    const n = Math.max(20, Math.round(Math.hypot(m1.x - m0.x, m1.y - m0.y)));
    /* точки берутся в МИРЕ (доля длины стены × доля высоты) и проецируются: шов стоит на одной
       доле длины на любой высоте, а по экранным индексам наклонная линия шва расходилась */
    const N = 1600, off = 6;
    const dipsAt = (k) => { const prof = new Array(N + 1).fill(null);
      for (let i = 0; i <= N; i++) { const a = -f.ht + 2 * f.ht * i / N, p = __lk.proj({ x: -(f.c.u + f.t.u * a), y: f.h * k, z: f.c.v + f.t.v * a });
        if (!p || p.x < 8 || p.x > W - 8 || p.y < 8 || p.y > H - 8) continue; prof[i] = __lk.lum(p.x, p.y); }
      const d = new Set(); for (let i = off; i <= N - off; i++) { if (prof[i] === null || prof[i - off] === null || prof[i + off] === null) continue;
        const nb = (prof[i - off] + prof[i + off]) / 2; if (prof[i] < nb * 0.92) d.add(i); } return d; };
    const d1 = dipsAt(0.3), d2 = dipsAt(0.5), d3 = dipsAt(0.7);
    const has2 = (d, i) => d.has(i) || d.has(i - 1) || d.has(i + 1) || d.has(i - 2) || d.has(i + 2);
    let dips = 0; for (const i of d2) if (has2(d1, i) && has2(d3, i)) dips++;
    /* патч 40×40 в центре грани, целиком внутри многоугольника */
    const c = { x: (m0.x + m1.x) / 2, y: (m0.y + m1.y) / 2 };
    let s = 20; const inside = (h) => [[-h, -h], [h, -h], [h, h], [-h, h]].every(([dx, dy]) => __lk.inPoly({ x: c.x + dx, y: c.y + dy }, f.pts));
    while (s > 6 && !inside(s)) s -= 2;
    const patch = __lk.patch(c.x - s, c.y - s, 2 * s, 2 * s);
    return { area: Math.round(f.area), near, far, dips, n, patch: { sd: patch.sd, mean: patch.mean, size: 2 * s } };
  });
  check('ребро стены темнее обеих сторон (@render-edge-line)', r && r.near <= r.far * 0.88, r ? `на ребре ${r.near.toFixed(0)} рядом ${r.far.toFixed(0)} грань ${r.area}px²` : 'стена вне кадра');
  check('на стене нет линий по швам сегментов (@render-seam-free)', r && r.dips === 0, r ? `провалов ${r.dips} (отсчётов вдоль стены 1600)` : 'стена вне кадра');
  check('у стены есть текстура (@render-wall-texture)', r && r.patch.sd >= 3, r ? `sd=${r.patch.sd.toFixed(2)} патч ${r.patch.size}px` : 'стена вне кадра');
}

/* --- эстакада: уровень 20, салон у верха подъёма — лобовое обязано остаться прозрачным --- */
{
  const r = await page.evaluate(() => {
    loadLevel(19); while (opt.camMode !== CAM_FP) pressKey('KeyC'); while (hudMode !== 2) cycleHud(); opt.mirrors = false; opt.fpYaw = 0; opt.fpPitch = 0;
    const z = level.ramps[0]; if (!z) return null;
    const yaw = Math.atan2(z.up.u, z.up.v), t = 0.85;
    setBody(z.ou + z.up.u * z.len * t, z.ov + z.up.v * z.len * t, yaw); car.vel = 0;
    return { h: +groundH(car.ru, car.rv).toFixed(2) };
  });
  await page.waitForTimeout(400);
  await shot('ramp-top');
  /* доля неба в верхней половине проёма: с крышей поверх лобового было 2 % */
  const sky = await page.evaluate(() => { const p = __lk.patch(W * 0.30, H * 0.30, W * 0.40, H * 0.20); const g = canvas.getContext('2d'), k = DPR;
    const d = g.getImageData(Math.round(W * 0.30 * k), Math.round(H * 0.30 * k), Math.round(W * 0.40 * k), Math.round(H * 0.20 * k)).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] - d[i] > 25 && d[i + 2] > 120) n++; return n / p.n; });
  check('на эстакаде лобовое остаётся прозрачным (@render-ramp-windshield)', r && sky >= 0.6, r ? `небо ${(sky * 100).toFixed(0)} % при h=${r.h}` : 'на уровне нет эстакады');
  await pose(() => { loadLevel(0); }, null, 300);
}

/* --- маркер виден из салона: уровень 24 у фазы «прижмись к жёлтой линии», уровень 31 у стоп-линии --- */
for (const c of [{ l: 23, u: 2.6, v: -8, th: 0, name: 'L24 «прижмись к жёлтой линии»' }, { l: 30, u: -78, v: -16, th: 0, name: 'L31 «остановись у линии»' }]) {
  /* габаритные столбики своей машины тоже жёлтые и стоят над капотом — на время проверки refs=0,
     иначе она зелёная и без маркера */
  await pose((c) => { loadLevel(c.l); while (opt.camMode !== CAM_FP) pressKey('KeyC'); while (hudMode !== 2) cycleHud(); opt.mirrors = false; opt.fpYaw = 0; opt.fpPitch = 0; opt.refs = 0;
    setBody(c.u, c.v, c.th); car.vel = 0; }, c, 500);
  await shot('mark-' + c.l);
  /* жёлтые пиксели маркера выше линии капота (верхние 60 % кадра): линия на асфальте под капотом
     их не даёт, столбики на концах — дают */
  const n = await page.evaluate(() => { const g = canvas.getContext('2d'), k = DPR, d = g.getImageData(0, 0, Math.round(W * k), Math.round(H * 0.6 * k)).data; let n = 0;
    /* цвет маркера [250,204,21] под ламбертом: b/r < 0,13 и g/r ≈ 0,82; у щита «главная дорога»
       [236,186,44] b/r 0,19, у габаритных столбиков [255,206,60] 0,24 — не считаются */
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 110 && g > 85 && b / r < 0.13 && g / r > 0.74 && g / r < 0.9) n++; } return n; });
  check(`жёлтый маркер виден из салона выше капота — ${c.name} (@render-mark-visible)`, n >= 40, `жёлтых пикселей ${n}`);
}
await pose(() => { opt.refs = 1; loadLevel(0); }, null, 300);

/* --- столб не просвечивает сквозь щит: знак «уступи» уровня 30 с 8 и 12 м из салона (ближе щит
   уходит под салонное зеркало — оно висит ровно на том же азимуте) --- */
for (const d of [8, 12]) {
  await pose((d) => { loadLevel(29); while (opt.camMode !== CAM_FP) pressKey('KeyC'); while (hudMode !== 2) cycleHud(); opt.mirrors = false; opt.fpYaw = 0; opt.fpPitch = 0;
    setBody(59 - d, -4.95, rad(90)); car.vel = 0; }, d, 500);
  await shot('sign-' + d);
  /* центр белого поля треугольника: пиксель не белый и не красный — это столб */
  const r = await page.evaluate(() => { const V = viewCam, p = { x: -59, y: SIGN_H - 0.42 - 0.02, z: -8.6 };
    const s = viewProject(p); if (!s) return null; const g = canvas.getContext('2d'), k = DPR, R = 5;
    const dd = g.getImageData(Math.round((s.x - R) * k), Math.round((s.y - R) * k), Math.round(2 * R * k), Math.round(2 * R * k)).data; let bad = 0, n = 0;
    /* столб — нейтральный серый темнее белого поля; красная кайма и её антиалиасинг не считаются */
    for (let i = 0; i < dd.length; i += 4) { n++; const r = dd[i], gg = dd[i + 1], b = dd[i + 2]; const grey = Math.abs(r - gg) < 25 && Math.abs(gg - b) < 25 && (r + gg + b) / 3 < 190; if (grey) bad++; }
    return { bad, n, x: Math.round(s.x), y: Math.round(s.y) }; });
  check(`столб не просвечивает сквозь щит знака с ${d} м (@render-sign-post)`, r && r.bad === 0, r ? `чужих пикселей ${r.bad} из ${r.n} в центре щита (${r.x},${r.y})` : 'щит вне кадра');
}
await pose(() => { loadLevel(0); }, null, 300);

/* --- бордюры сверху: уровень 14, вид сверху --- */
await pose(() => { loadLevel(13); while (opt.camMode !== CAM_TOP) pressKey('KeyC'); }, null, 500);
await shot('top-l14');
await pose(() => { loadLevel(0); while (opt.camMode !== CAM_CHASE) pressKey('KeyC'); while (hudMode !== 0) cycleHud(); opt.mirrors = true; }, null, 300);

const empty = [];
for (const s of shots) { const st = fs.statSync(path.join(ROOT, s)); if (st.size < 8000) empty.push(s); }
const result = { tag, mobile, checks, shots, pageErrors, empty };
fs.writeFileSync(path.join(OUT, `look-${tag}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
for (const c of checks) console.error((c.ok ? '  ok  ' : ' FAIL ') + c.name + (c.detail ? ' — ' + c.detail : ''));
await browser.close();
process.exit(checks.some(c => !c.ok) || pageErrors.length || empty.length ? 1 : 0);
