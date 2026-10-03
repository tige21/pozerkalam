#!/usr/bin/env node
/* Гейт фасадов домов из картинок (серия 3; коды render-buildings-facade-img, -sides, -lod, -light,
   -rhythm; сценарии — specs/features/render/fasady.feature). Дом рисуется в одиночку (level.bld = [дом],
   уличные объекты убраны) с камерой, поставленной точно, и грань меряется по пикселям: по сетке точек на
   самой грани, спроецированных через viewProject, — соседний дом торец не закроет, знак не встанет
   поперёк.
     PW_DIR=/tmp/pw node tools/facade-check.mjs
     FAULT=facimg|facside|faclod|faclight|facseam — сломать нарочно и увидеть красный: страница без
       картинок фасадов; торцу дана плитка с окнами; дальнему дому оставлен цвет палитры; без накладки
       света; плитка растянута на 8 % (шаг окна не делит её пополам)
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

/* страница без картинок фасадов — для отказа: игра обязана нарисовать прежнюю плитку и сказать об
   этом одним предупреждением на картинку */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const noFac = path.join(os.tmpdir(), `facade-check-nofac-${process.pid}.html`);
fs.writeFileSync(noFac, html.split('\n').filter((l) => !l.startsWith('<img data-asset="fac-')).join('\n'));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

async function open(file) {
  const url = 'file://' + file + '?nocache=' + Date.now();
  const prep = await context.newPage();
  await prep.goto(url);
  await prep.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
    localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_gfx', 'max'); localStorage.setItem('trainer_traffic', 'off'); });
  await prep.close();
  const page = await context.newPage();
  const errors = [], warns = [];
  page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'warning' && /\[assets\] fac-/.test(m.text())) warns.push(m.text()); });
  await page.goto(url + 'r');
  await page.waitForFunction(() => typeof LEVELS !== 'undefined' && typeof carModel !== 'undefined' && carModel.state !== 'off', null, { timeout: 20000 });
  await page.waitForFunction(() => typeof FAC !== 'undefined' && Object.values(FAC).every((t) => t.img), null, { timeout: 10000 });
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
    /* камера ставится точно: в render() её поза приходит из updateCamera */
    const oUC = updateCamera;
    window.updateCamera = function () { const c = window.__facCam; if (c) { setCam(c.pos, c.tgt, null, 58); return; } return oUC.apply(this, arguments); };
    /* один дом в кадре, камера в dist м по горизонтали от его центра на нормали оси ax ('r' | 'f'), со
       сдвигом along по стене и на высоте hy; возвращает пиксели сетки точек на грани ax и на соседней */
    window.__facShot = function (o, ax, sgn, dist, along, hy) {
      const F = fwd(o.yaw), R = rgt(o.yaw), C = { x: -o.u, z: o.v };
      const N = ax === 'r' ? R : F, T = ax === 'r' ? F : R, half = ax === 'r' ? o.w / 2 : o.l / 2;
      const pos = { x: C.x + N.x * sgn * dist + T.x * along, y: hy, z: C.z + N.z * sgn * dist + T.z * along };
      window.__facCam = { pos, tgt: { x: C.x + N.x * sgn * half, y: Math.min(o.h, 14) * 0.5, z: C.z + N.z * sgn * half } };
      const keepB = level.bld, keepR = level.rend, ru = car.ru;
      level.bld = [o]; level.rend = []; car.ru += 2000;
      let facCalls = 0, texCalls = 0; const tf = window.texFace;
      window.texFace = function (f) { if (f.tex && f.tex.fac) facCalls++; else texCalls++; return tf.apply(this, arguments); };
      try { for (let k = 0; k < 3; k++) render(0.016); }
      finally { window.texFace = tf; level.bld = keepB; level.rend = keepR; car.ru = ru; }
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height), k = canvas.width / W;
      const face = (fax, fs) => {
        const FN = fax === 'r' ? R : F, FT = fax === 'r' ? F : R, fh = fax === 'r' ? o.w / 2 : o.l / 2, L = fax === 'r' ? o.l : o.w;
        const y0 = o.shop ? 3.4 : 0.3, y1 = Math.min(o.h, 18) - 0.3, px = [];
        for (let i = 0; i < 40; i++) for (let j = 0; j < 24; j++) {
          const a = (-0.42 + 0.84 * i / 39) * L, y = y0 + (y1 - y0) * (0.05 + 0.9 * j / 23);
          const p = { x: C.x + FN.x * fs * (fh + 0.02) + FT.x * a, y, z: C.z + FN.z * fs * (fh + 0.02) + FT.z * a };
          const s = viewProject(p); if (!s) continue;
          const X = Math.round(s.x * k), Y = Math.round(s.y * k);
          if (X < 0 || Y < 0 || X >= canvas.width || Y >= canvas.height) continue;
          const q = (Y * canvas.width + X) * 4; px.push([img.data[q], img.data[q + 1], img.data[q + 2]]);
        }
        return px;
      };
      const other = ax === 'r' ? 'f' : 'r', os = Math.sign(along) || 1;
      return { main: face(ax, sgn), side: face(other, os), facCalls, texCalls, d: Math.hypot(pos.x - C.x, pos.z - C.z) };
    };
    window.__facStats = function (px) {
      const L = px.map(([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b).sort((a, b) => a - b), med = L[L.length >> 1] || 0;
      const glass = px.filter(([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b < med * 0.6 && b >= r).length / (px.length || 1);
      const mean = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c], 0) / (px.length || 1));
      return { n: px.length, glass: +glass.toFixed(3), mean: mean.map((v) => +v.toFixed(1)), lum: +(0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2]).toFixed(1) };
    };
    loadLevel(28); doAct('start'); paused = true; if (typeof hideOv === 'function') hideOv();
    while (hudMode !== 2) cycleHud(); opt.mirrors = false; opt.camMode = CAM_CHASE; opt.marks = false; opt.refs = 0;
  });
  return { page, errors, warns };
}

/* опорный дом — панель серой плиткой с глухим торцом, без башни; торец короче FAC_END_MAX */
const pick = `(() => level.bld.filter((o) => o.facW === 'fac-panel-a' && o.facE === 'fac-panel-end' && o.floors < 18
  && (o.front === 'r' ? o.w : o.l) <= FAC_END_MAX && (o.front === 'r' ? o.l : o.w) >= 18).sort((a, b) => b.floors - a.floors)[0])()`;

const main = await open(FAULT === 'facimg' ? noFac : path.join(ROOT, 'index.html'));
const { page } = main;
/* опорный дом выбирается до поломки: FAULT=facside меняет ему торец, и выбор по торцу его бы потерял */
await page.evaluate((pick) => { window.__facO = eval(pick); }, pick);
/* facside — торцу опорного дома плитка с окнами (цвет оси — её же, чтобы краснела только своя проверка);
   faclod — дефект, найденный при работе: за BLD_NEAR_D весь дом одного цвета, и торец на границе
   дальностей меняет цвет на цвет фасада */
if (FAULT === 'facside') await page.evaluate(() => { const o = __facO, m = FAC[o.facW].mean; o.facE = o.facW; o.cols = { r: m, f: m }; o._fu = o._fs = o._far = null; });
if (FAULT === 'faclod') await page.evaluate(() => { for (const o of level.bld) o._far = { bld: true, cols: { r: o.col, f: o.col } }; });
if (FAULT === 'faclight') await page.evaluate(() => { window.facOverlay = () => 'rgba(0,0,0,0)'; });

/* ---- картинка на ближнем доме; без картинки — прежняя плитка и одно предупреждение ---- */
const img = await page.evaluate(() => {
  const o = __facO; if (!o) return { err: 'нет опорного дома' };
  const s = __facShot(o, o.front, 1, 18, 0, 8), st = __facStats(s.main), t = FAC[o.facW];
  const nl = (() => { const n = o.front === 'r' ? rgt(o.yaw) : fwd(o.yaw); return Math.max(0, n.x * LIGHT.x + n.z * LIGHT.z); })();
  const want = t ? t.mean.map((m) => m * (0.42 + 0.58 * nl)) : null;
  return { facCalls: s.facCalls, glass: st.glass, mean: st.mean, want: want && want.map((v) => +v.toFixed(1)), n: st.n };
});
const nf = await open(noFac);
const fb = await nf.page.evaluate((pick) => {
  const o = eval(pick);
  const s = __facShot(o, o.front, 1, 18, 0, 8);
  return { facCalls: s.facCalls, texCalls: s.texCalls };
}, pick);
const colOk = img.want && img.mean.every((v, i) => Math.abs(v - img.want[i]) / 255 <= 0.08);
check('ближний дом нарисован картинкой фасада; без картинок — прежняя рисованная плитка и одно предупреждение на картинку (@render-buildings-facade-img)',
  !img.err && img.facCalls > 0 && img.glass >= 0.1 && colOk && !main.warns.length && !main.errors.length
  && fb.facCalls === 0 && fb.texCalls > 0 && nf.warns.length === 9 && !nf.errors.length,
  JSON.stringify({ img, fallback: { ...fb, warns: nf.warns.length, errors: nf.errors.slice(0, 2) }, warns: main.warns.slice(0, 2) }));
await nf.page.close();

/* ---- длинная сторона с окнами, торец глухой ---- */
const sides = await page.evaluate(() => {
  const o = __facO; if (!o) return { err: 'нет опорного дома' };
  const s = __facShot(o, o.front, 1, 16, (o.front === 'r' ? o.l : o.w) / 2 + 12, 7);
  return { long: __facStats(s.main), end: __facStats(s.side) };
});
check('на длинной стороне дома окна (доля тёмного стекла ≥ 10 %), торец глухой (≤ 3 %) (@render-buildings-facade-sides)',
  !sides.err && sides.long.n > 200 && sides.end.n > 200 && sides.long.glass >= 0.1 && sides.end.glass <= 0.03, JSON.stringify(sides));

/* ---- цвет на границе дальностей ---- */
const lod = await page.evaluate(() => {
  const o = __facO; if (!o) return { err: 'нет опорного дома' };
  const along = (o.front === 'r' ? o.l : o.w) / 2 + 10, out = {};
  for (const d of [BLD_NEAR_D - 0.5, BLD_NEAR_D + 0.5]) {
    /* камера на горизонтальном расстоянии d от центра дома: emitBuilding выбирает ближнюю или дальнюю
       коробку по нему */
    const dist = Math.sqrt(Math.max(1, d * d - along * along));
    const s = __facShot(o, o.front, 1, dist, along, 8);
    out[d < BLD_NEAR_D ? 'near' : 'far'] = { d: +s.d.toFixed(2), long: __facStats(s.main).mean, end: __facStats(s.side).mean };
  }
  const diff = (a, b) => +(Math.max(...a.map((v, i) => Math.abs(v - b[i]))) / 255 * 100).toFixed(1);
  return { ...out, diffLong: diff(out.near.long, out.far.long), diffEnd: diff(out.near.end, out.far.end) };
});
/* 2 % — порог заметности перепада яркости на большой ровной площади: стена целиком, сменившая цвет
   на 4,5 % (цвет палитры вместо плитки на теневой стороне), видна как скачок */
check('цвет стены и торца на границе дальностей (BLD_NEAR_D ± 0,5 м) меняется не больше чем на 2 % (@render-buildings-facade-lod)',
  !lod.err && lod.diffLong <= 2 && lod.diffEnd <= 2, JSON.stringify(lod));

/* ---- свет на картинке ---- */
const light = await page.evaluate(() => {
  const o = __facO; if (!o) return { err: 'нет опорного дома' };
  const N = o.front === 'r' ? rgt(o.yaw) : fwd(o.yaw), out = [];
  for (const sg of [1, -1]) {
    const s = __facShot(o, o.front, sg, 18, 0, 8), st = __facStats(s.main);
    out.push({ sg, k: 0.42 + 0.58 * Math.max(0, sg * (N.x * LIGHT.x + N.z * LIGHT.z)), lum: st.lum, n: st.n });
  }
  const want = out[0].k / out[1].k, got = out[0].lum / (out[1].lum || 1);
  return { faces: out, want: +want.toFixed(3), got: +got.toFixed(3), err: Math.abs(got / want - 1) };
});
check('освещённая и теневая стороны дома различаются по яркости как ламберт, ±10 % (@render-buildings-facade-light)',
  light.faces && Math.abs(light.want - 1) > 0.15 && light.err <= 0.1, JSON.stringify(light));

/* ---- ритм плиток: окна и швы панелей делят плитку пополам, витрины стыкуются краями ---- */
const rhythm = await page.evaluate((fault) => {
  const out = {};
  const grab = (t) => { const w = t.img.naturalWidth, h = t.img.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    /* FAULT=facseam: плитка растянута на 8 % — так выглядит обрезка не по шагу окна */
    if (fault === 'facseam') g.drawImage(t.img, 0, 0, w * 1.08, h); else g.drawImage(t.img, 0, 0);
    return { w, h, d: g.getImageData(0, 0, w, h).data }; };
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const miss = Object.keys(FAC).length < 9;
  if (miss) return { missing: FAC_KEYS.filter((k) => !FAC[k]) };
  for (const k of ['fac-panel-a', 'fac-panel-b', 'fac-brick-red', 'fac-brick-yellow', 'fac-plaster']) {
    const { w, h, d } = grab(FAC[k]), all = [];
    for (let i = 0; i < d.length; i += 4) all.push(lum(d, i));
    all.sort((a, b) => a - b); const med = all[all.length >> 1];
    const colGlass = []; for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; if (lum(d, i) < med * 0.8 && d[i + 2] - d[i] >= 6) n++; } colGlass.push(n / h); }
    /* стекло — темнее стены и синее её: кирпич красный, бетон и штукатурка без синевы, а порог по одной
       яркости на тёмной кладке стекла не отделял. Окно — сплошной по ширине кусок столбцов со стеклом;
       переплёты делят его, поэтому куски ближе 6 % ширины сливаются */
    const spans = []; let s = -1;
    for (let x = 0; x <= w; x++) { const on = x < w && colGlass[x] > 0.15; if (on && s < 0) s = x; if (!on && s >= 0) { spans.push([s, x - 1]); s = -1; } }
    const win = []; for (const sp of spans) { const last = win[win.length - 1]; if (last && sp[0] - last[1] < w * 0.06) last[1] = sp[1]; else win.push(sp.slice()); }
    const big = win.filter(([a, b]) => b - a > w * 0.08);
    const cs = big.map(([a, b]) => (a + b) / 2), gap = cs.length === 2 ? (cs[1] - cs[0]) / w : null;
    out[k] = { windows: cs.length, gap: gap && +gap.toFixed(3) };
  }
  for (const k of ['fac-panel-a', 'fac-panel-b', 'fac-panel-end']) {
    const { w, h, d } = grab(FAC[k]), col = [];
    for (let x = 0; x < w; x++) { let s = 0; for (let y = 0; y < h; y++) s += lum(d, (y * w + x) * 4); col.push(s / h); }
    const at = (a, b) => { let m = 1e9, mx = -1; for (let x = a; x < b; x++) if (col[x] < m) { m = col[x]; mx = x; } return mx; };
    const edge = col[at(0, Math.round(w * 0.1))] < col[at(Math.round(w * 0.9), w)] ? at(0, Math.round(w * 0.1)) : at(Math.round(w * 0.9), w);
    const mid = at(Math.round(w * 0.3), Math.round(w * 0.7)), g = Math.abs(mid - edge) / w;
    out[k + ':швы'] = { gap: +Math.min(g, 1 - g).toFixed(3) };
  }
  for (const k of ['fac-shop-a', 'fac-shop-b']) {
    const { w, h, d } = grab(FAC[k]); let seam = 0; const steps = [];
    for (let y = 0; y < h; y++) seam += Math.abs(lum(d, (y * w) * 4) - lum(d, (y * w + w - 1) * 4));
    for (let x = 0; x < w - 1; x++) { let s = 0; for (let y = 0; y < h; y++) s += Math.abs(lum(d, (y * w + x) * 4) - lum(d, (y * w + x + 1) * 4)); steps.push(s / h); }
    steps.sort((a, b) => a - b);
    out[k] = { seam: +(seam / h).toFixed(1), p95: +steps[Math.floor(steps.length * 0.95)].toFixed(1) };
  }
  return out;
}, FAULT);
const winOk = !rhythm.missing && ['fac-panel-a', 'fac-panel-b', 'fac-brick-red', 'fac-brick-yellow', 'fac-plaster'].every((k) => rhythm[k].windows === 2 && Math.abs(rhythm[k].gap - 0.5) <= 0.04);
const jointOk = !rhythm.missing && ['fac-panel-a', 'fac-panel-b', 'fac-panel-end'].every((k) => Math.abs(rhythm[k + ':швы'].gap - 0.5) <= 0.03);
const shopOk = !rhythm.missing && ['fac-shop-a', 'fac-shop-b'].every((k) => rhythm[k].seam <= rhythm[k].p95);
check('плитки встают встык: два окна на плитку через полширины (±4 %), швы панелей через полширины (±3 %), край витрины не резче её крупных перепадов (@render-buildings-facade-rhythm)',
  winOk && jointOk && shopOk, JSON.stringify(rhythm));

check('страница без исключений', !main.errors.length, main.errors.slice(0, 3).join(' | '));
fs.unlinkSync(noFac);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
