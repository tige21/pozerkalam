#!/usr/bin/env node
/* Гейт салона из пререндера (коды требований render-cabin-… и dist-asset…; сценарии —
   specs/features/render/cabin.feature и specs/features/dist/assets.feature):
   куб салона распакован и рисуется, его проём лобового совпадает с WSHIELD и в нём выше линии
   капота нет ничего, рендер сделан на текущих константах, при битой картинке рисуется прежний
   салон, страница в бюджете, блок картинок вне <script>; без модели кузова (render-car-fallback,
   specs/features/render/car.feature) машины рисуются прежним лофтом.
   Проём меряется по самим граням куба, а не по кадрам: глаз в кузове неподвижен, и куб от
   поворота головы не зависит — пять поз головы проверяли бы одну и ту же картинку.
     PW_DIR=/tmp/pw node tools/cabin-check.mjs
     FAULT=shift|eye|budget|normal|script|marks|mirror|car|greenhouse|mirimg|mirflip|mirfallback — сломать нарочно и
       увидеть красный: сдвинуть грани на 4 px, поменять EYE после рендера, уронить бюджет до 0,5 МБ, проверить отказ на
       целой странице, завернуть блок картинок в <script>, держать руль прямо при проверке меток, отключить куб зеркала,
       оставить модель кузова на месте в проверке отказа, рисовать из салона стойки и крышу модели, снять картинки
       стекла зеркал, отразить контур бокового зеркала по ширине, проверить отказ картинок зеркал на целой странице
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || '';
const BUILD = path.join(ROOT, 'build');

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

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
fs.mkdirSync(BUILD, { recursive: true });
/* битая сборка для проверки отказа: у передней грани обрезан base64, распаковка картинки падает */
const brokenPath = path.join(BUILD, 'cabin-fallback.html');
fs.writeFileSync(brokenPath, html.replace(/(data-asset="cabin-pz" alt="" src="data:image\/webp;base64,)[A-Za-z0-9+/=]+/, '$1AAAA'));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

async function openPage(file) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const url = 'file://' + file + '?nocache=' + Date.now();
  /* первая вкладка только кладёт ключи онбординга; считаем предупреждения второй — своей загрузки */
  const prep = await context.newPage();
  await prep.goto(url);
  await prep.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); localStorage.setItem('trainer_runs', '9'); });
  await prep.close();
  const page = await context.newPage();
  const errors = [], warns = [];
  page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('[assets]')) warns.push(m.text()); });
  await page.goto(url + 'r');
  await page.waitForFunction(() => typeof cabinBake !== 'undefined' && cabinBake.state !== 'loading' && mirBake.state !== 'loading', null, { timeout: 15000 });
  await page.evaluate(() => { loadLevel(0); doAct('start'); if (opt.camMode !== CAM_FP) pressKey('KeyV'); opt.fpYaw = 0; opt.fpPitch = 0; });
  await page.waitForTimeout(300);
  /* сколько раз за один кадр нарисован прежний салон и сколько раз — канвас куба */
  /* прежний салон считается только в основном виде: салонное зеркало смотрит из своей точки и
     рисует салон гранями по праву, а зеркала обновляются по кругу — в одном кадре есть, в другом нет */
  const frame = await page.evaluate(() => {
    let interior = 0, cube = 0, main = false;
    const origI = emitInterior, origS = drawSceneInto, origD = CanvasRenderingContext2D.prototype.drawImage;
    window.drawSceneInto = (o) => { main = o.cube === cabinBake; try { return origS(o); } finally { main = false; } };
    window.emitInterior = (...a) => { if (main) interior++; return origI(...a); };
    CanvasRenderingContext2D.prototype.drawImage = function (src, ...a) { if (main && cubeGL.canvas && src === cubeGL.canvas) cube++; return origD.call(this, src, ...a); };
    try { render(0); } finally { window.emitInterior = origI; window.drawSceneInto = origS; CanvasRenderingContext2D.prototype.drawImage = origD; }
    return { state: cabinBake.state, interior, cube };
  });
  return { page, context, errors, warns, frame };
}

/* зеркала заднего вида (серия 4): торец бокового корпуса за кадр — рамка [34,38,44], которую рисует
   emitMirrorHousing своей машины; в теле кузова (lat по модулю, y) */
const mirrorFrames = (fault) => {
  if (fault === 'mirflip' && mirImg.outline.side) mirImg.outline.side = mirImg.outline.side.map((q) => [1 - q[0], q[1]]);
  const origH = emitMirrorHousing, origP = pushPoly;
  let kind = null; const got = {};
  window.emitMirrorHousing = function (P, F, R, sg, col, k) { kind = k; try { return origH.apply(this, arguments); } finally { kind = null; } };
  window.pushPoly = function (pts, col) {
    if (kind && col && col[0] === 34 && col[1] === 38 && col[2] === 44 && !got[kind]) got[kind] = pts.map((q) => ({ x: q.x, y: q.y, z: q.z }));
    return origP.apply(this, arguments);
  };
  try { opt.fpYaw = 0; opt.fpPitch = 0; render(0); } finally { window.emitMirrorHousing = origH; window.pushPoly = origP; }
  const c = bodyPos(), r = ruv(car.th), M = MIR_H, out = {};
  for (const k of ['left', 'right']) {
    const pts = (got[k] || []).map((q) => { const du = -q.x - c.u, dv = q.z - c.v; return { lat: Math.abs(du * r.u + dv * r.v), y: q.y }; });
    const span = (sel) => { const ys = pts.filter(sel).map((p) => p.y); return ys.length ? Math.max(...ys) - Math.min(...ys) : 0; };
    const outer = span((p) => p.lat > M.lout - 0.012), inner = span((p) => p.lat < M.lin + 0.012);
    const inBox = pts.length > 0 && pts.every((p) => p.lat >= M.lin - 0.005 && p.lat <= M.lout + 0.005 && p.y >= M.y0 - 0.005 && p.y <= M.y1 + 0.005);
    out[k] = { n: pts.length, outer: +outer.toFixed(4), inner: +inner.toFixed(4), inBox };
  }
  out.need = mirImg.outline.side ? mirImg.outline.side.length : null;
  return out;
};

/* ---- целая сборка ---- */
const okPage = await openPage(FAULT === 'normal' ? brokenPath : path.join(ROOT, 'index.html'));
check('куб салона распакован и рисуется вместо прежнего салона, предупреждений [assets] нет (@render-cabin-cube)',
  okPage.frame.state === 'ready' && okPage.frame.cube === 1 && okPage.frame.interior === 0 && !okPage.warns.length && !okPage.errors.length,
  JSON.stringify({ ...okPage.frame, warns: okPage.warns.length, errors: okPage.errors }));

if (okPage.frame.state === 'ready') {
  const geo = await okPage.page.evaluate((fault) => {
    const faces = cabinBake.faces;
    const hoodDeg = Math.atan2(HOOD_Y - EYE.y, HOOD_Z - EYE.z) * 180 / Math.PI;
    const px = {};
    const sh = fault === 'shift' ? 4 : 0;
    for (const f of faces) {
      const c = document.createElement('canvas'); c.width = c.height = f.size;
      const g = c.getContext('2d'); g.drawImage(f.img, sh, sh, f.size, f.size);
      px[f.key] = g.getImageData(0, 0, f.size, f.size).data;
    }
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const proj = (q) => {
      const d = [q[0] - EYE.lat, q[1] - EYE.y, q[2] - EYE.z];
      let best = null, bd = -1e9;
      for (const f of faces) { const t = dot(d, f.look); if (t > bd) { bd = t; best = f; } }
      return { f: best, x: (dot(d, best.right) / bd + 1) / 2 * best.size, y: (1 - dot(d, best.up) / bd) / 2 * best.size };
    };
    const alpha = (f, x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= f.size || yi >= f.size) return null;
      return px[f.key][(yi * f.size + xi) * 4 + 3];
    };
    const rgba = (f, x, y) => { const i = (Math.round(y) * f.size + Math.round(x)) * 4, d = px[f.key]; return `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`; };
    const W = WSHIELD, cen = [0, 1, 2].map((k) => (W[0][k] + W[1][k] + W[2][k] + W[3][k]) / 4);
    const elev = (q) => Math.atan2(q[1] - EYE.y, q[2] - EYE.z) * 180 / Math.PI;
    const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const edges = {};
    /* у нижней кромки проём внутри может закрывать козырёк щитка — там капот, не дорога */
    for (const [name, a, b, checkIn] of [['верх', 0, 1, true], ['право', 1, 2, true], ['низ', 2, 3, false], ['лево', 3, 0, true]]) {
      let n = 0, badOut = 0, badIn = 0; const where = [];
      for (let i = 1; i < 40; i++) {
        const q = lerp(W[a], W[b], i / 40), p = proj(q), pin = proj(lerp(q, cen, 0.02)), p2 = proj(lerp(W[a], W[b], i / 40 + 0.01));
        if (pin.f !== p.f || p2.f !== p.f) continue;
        /* «внутрь» — перпендикуляр к кромке на картинке, развёрнутый к центру проёма: сдвиг к центру
           стекла в 3D у верхних углов идёт почти вдоль кромки, и точка «на 3 px внутрь» ложилась
           на саму кромку */
        let ex = p2.x - p.x, ey = p2.y - p.y; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
        let nx = -ey, ny = ex;
        if ((pin.x - p.x) * nx + (pin.y - p.y) * ny < 0) { nx = -nx; ny = -ny; }
        const aIn = alpha(p.f, p.x + nx * 3, p.y + ny * 3), aOut = alpha(p.f, p.x - nx * 3, p.y - ny * 3);
        if (aIn === null || aOut === null) continue;
        n++;
        const az = Math.atan2(q[0] - EYE.lat, q[2] - EYE.z) * 180 / Math.PI;
        const at = `${p.f.key} аз ${az.toFixed(1)}° выс ${elev(q).toFixed(1)}°`;
        if (aOut < 230) { badOut++; where.push('снаружи ' + at + ' rgba ' + rgba(p.f, p.x - nx * 3, p.y - ny * 3)); }
        if (checkIn && elev(q) > hoodDeg + 0.5 && aIn > 25) { badIn++; where.push('внутри ' + at + ' rgba ' + rgba(p.f, p.x + nx * 3, p.y + ny * 3) + ` px ${Math.round(p.x)},${Math.round(p.y)}`); }
      }
      edges[name] = { n, badOut, badIn, ...(where.length ? { where: where.slice(0, 4) } : {}) };
    }
    let inside = 0, insideBad = 0;
    for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) {
      const q = lerp(lerp(W[0], W[1], i / 20), lerp(W[3], W[2], i / 20), j / 20);
      if (elev(q) <= hoodDeg + 0.5) continue;
      const p = proj(q), a = alpha(p.f, p.x, p.y);
      if (a === null) continue;
      inside++; if (a > 25) insideBad++;
    }
    const pxPerDeg = faces.find((f) => f.key === 'pz').size / 90;
    return { edges, inside, insideBad, hoodDeg: +hoodDeg.toFixed(2), tolPx: 3, tolDeg: +(3 / pxPerDeg).toFixed(3) };
  }, FAULT);
  const e = Object.values(geo.edges);
  check('проём лобового в кубе совпадает с WSHIELD: за кромкой кайма, внутри стекло; выше линии капота в проёме пусто (@render-cabin-bake-align)',
    e.every((x) => x.n >= 20 && !x.badOut && !x.badIn) && geo.inside >= 100 && !geo.insideBad, JSON.stringify(geo));
}
/* салонное зеркало: свой куб из точки камеры зеркала, прежний салон в его проходе не рисуется */
if (okPage.frame.state === 'ready') {
  const mir = await okPage.page.evaluate((fault) => {
    if (fault === 'mirror') mirBake.state = 'failed';
    let interior = 0, cube = 0, on = false;
    const origI = emitInterior, origD = CanvasRenderingContext2D.prototype.drawImage;
    window.emitInterior = (...a) => { if (on) interior++; return origI(...a); };
    CanvasRenderingContext2D.prototype.drawImage = function (src, ...a) { if (on && src === cubeGL.canvas) cube++; return origD.call(this, src, ...a); };
    const rect = mirrorRects().center, b = mirrorBuf(rect, 'center');
    on = true;
    try { renderMirrorInto(b, rect, 'center'); } finally { on = false; window.emitInterior = origI; CanvasRenderingContext2D.prototype.drawImage = origD; }
    return { state: mirBake.state, interior, cube };
  }, FAULT);
  check('салонное зеркало рисует свой куб из точки камеры зеркала, прежний салон в его проходе не рисуется (@render-mirror-cube)',
    mir.state === 'ready' && mir.cube === 1 && mir.interior === 0, JSON.stringify(mir));
}
/* метки оборотов на живом руле: проекция метки 12 часов на кадр и оттенок самого насыщенного
   пикселя вокруг — жёлтый на первом обороте, оранжевый на втором, красный на упоре */
if (okPage.frame.state === 'ready') {
  const marks = await okPage.page.evaluate((fault) => {
    const hue = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return null;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
    const out = [];
    for (const [name, turns, lo, hi] of [['0 оборотов', 0, 38, 62], ['1,2 оборота', 1.2, 17, 37], ['упор', null, -20, 16]]) {
      car.steer = turns === null ? CAR.maxSteer : turns * TAU / CAR.steerRatio;
      if (fault === 'marks') car.steer = 0;
      opt.fpPitch = rad(-22); render(0);
      const Wh = WHEEL, ax = [0, Math.sin(Wh.tilt), -Math.cos(Wh.tilt)], b2 = cross3(ax, [1, 0, 0]);
      const a = car.steer * CAR.steerRatio - PI * 0.5;
      const p = [0, 1, 2].map((i) => Wh.c[i] + ([1, 0, 0][i] * Math.cos(a) + b2[i] * Math.sin(a)) * Wh.r + ax[i] * (Wh.rt + 0.004));
      const c = bodyPos(), K = cabinCtx(c.u, c.v, car.th), sp = viewProject(K.P(p[0], p[1], p[2]));
      if (!sp) { out.push({ name, ok: false, why: 'метка за кадром' }); continue; }
      const R = 5, px = ctx.getImageData(Math.round(sp.x * pxScale) - R, Math.round(sp.y * pxScale) - R, 2 * R + 1, 2 * R + 1).data;
      let best = null, bs = -1;
      for (let i = 0; i < px.length; i += 4) { const r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
        if (sat > bs) { bs = sat; best = [r, g, b]; } }
      let h = hue(...best); if (h !== null && h > 300) h -= 360;
      out.push({ name, ok: bs > 0.45 && h !== null && h >= lo && h <= hi, hue: h === null ? null : +h.toFixed(0), sat: +bs.toFixed(2), at: [Math.round(sp.x), Math.round(sp.y)] });
    }
    car.steer = 0; opt.fpPitch = 0;
    return out;
  }, FAULT);
  check('метка 12 часов на руле видна и окрашена по оборотам: жёлтая, оранжевая на втором, красная на упоре (@render-wheel-marks)',
    marks.every((m) => m.ok), JSON.stringify(marks));
}
/* кузов своей машины из салона: стойки, крыша и рамы окон модели стоят не там, где окна куба, и
   их грани, смотрящие внутрь проёмов, проходили отсечение — модель рисовалась поверх обзора.
   Видимые из глаза грани кузова собираются в основном виде на пяти поворотах головы */
if (okPage.frame.state === 'ready') {
  const own = await okPage.page.evaluate((fault) => {
    if (fault === 'greenhouse') for (const b of Object.values(carModel.bodies)) for (const f of b.F) f.g = 0;
    const origS = drawSceneInto, origE = emitCarModel, origP = pushFace;
    let main = false, rec = null;
    const seen = [];
    window.drawSceneInto = (o) => { main = o.cube === cabinBake; try { return origS(o); } finally { main = false; } };
    window.emitCarModel = function (u, v, th, col, lit) { rec = main && lit && lit.own ? [] : null;
      try { return origE.apply(this, arguments); } finally { if (rec) seen.push(...rec); rec = null; } };
    window.pushFace = function (vv) { const k = faces.length; const r = origP.apply(this, arguments);
      if (rec && faces.length > k) rec.push(vv.map((q) => ({ x: q.x, y: q.y, z: q.z }))); return r; };
    try {
      for (const yaw of [0, -60, 60, 135, -135]) { opt.fpYaw = rad(yaw); opt.fpPitch = rad(-8); render(0); }
    } finally { window.drawSceneInto = origS; window.emitCarModel = origE; window.pushFace = origP; opt.fpYaw = 0; opt.fpPitch = 0; }
    const c = bodyPos(), f = fuv(car.th), r = ruv(car.th);
    let over = 0, top = -1, at = null, hood = 0;
    for (const vs of seen) {
      let fy = -1, fz = 0, fl = 0;
      for (const q of vs) { const du = -q.x - c.u, dv = q.z - c.v; if (q.y > fy) { fy = q.y; fz = du * f.u + dv * f.v; fl = du * r.u + dv * r.v; } }
      if (fy > MIR_H.y0 + 0.005) { over++; if (fy > top) { top = fy; at = [+fl.toFixed(2), +fz.toFixed(2)]; } }
      if (fz > 1.2) hood++;
    }
    return { faces: seen.length, over, top: +top.toFixed(3), at, hood };
  }, FAULT);
  check('из салона кузов своей машины виден только ниже подоконной линии, капот рисуется (@render-cabin-own-body)',
    own.over === 0 && own.hood > 0, JSON.stringify(own));
}
/* стекло зеркал из салона: на кадре стекло — картинка, а не плоская заливка. Точки берутся на самой
   грани стекла (mirGlassW, углы — углы картинки), HUD-зеркала на это время скрыты. У бокового верх
   стекла — небо, низ — асфальт; у салонного середина — заднее окно, верх — потолок */
if (okPage.frame.state === 'ready') {
  await okPage.page.waitForFunction(() => mirImg.side && mirImg.center, null, { timeout: 5000 }).catch(() => {});
  const glass = await okPage.page.evaluate((fault) => {
    if (fault === 'mirimg') { mirImg.side = null; mirImg.center = null; }
    const lum = (d) => 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
    const L = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    const band = (w, u0, u1, v0, v1) => {
      let s = 0, n = 0;
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) {
        const u = u0 + (u1 - u0) * i / 4, v = v0 + (v1 - v0) * j / 2;
        const p = viewProject(L(L(w[0], w[1], u), L(w[3], w[2], u), v));
        if (!p) continue;
        s += lum(ctx.getImageData(Math.round(p.x * pxScale), Math.round(p.y * pxScale), 1, 1).data); n++;
      }
      return n ? s / n : null;
    };
    const mirWas = opt.mirrors; opt.mirrors = false;
    const out = [];
    try {
      for (const [kind, yaw, pitch, lit, dark, min] of [
        ['left', -45, -6, [0.3, 0.7, 0.2, 0.35], [0.3, 0.7, 0.65, 0.85], 20],
        ['right', 50, -10, [0.3, 0.7, 0.2, 0.35], [0.3, 0.7, 0.65, 0.85], 20],
        ['center', 30, 4, [0.5, 0.65, 0.45, 0.6], [0.5, 0.8, 0.1, 0.2], 30],
      ]) {
        opt.fpYaw = rad(yaw); opt.fpPitch = rad(pitch); render(0);
        const w = mirGlassW[kind];
        if (!w) { out.push({ kind, ok: false, why: 'стекло не нарисовано' }); continue; }
        const a = band(w, ...lit), b = band(w, ...dark);
        out.push({ kind, ok: a !== null && b !== null && a - b >= min, light: a && +a.toFixed(0), dark: b && +b.toFixed(0) });
      }
    } finally { opt.mirrors = mirWas; opt.fpYaw = 0; opt.fpPitch = 0; }
    return out;
  }, FAULT);
  check('стекло боковых и салонного зеркал из салона — картинка серии 4: небо над асфальтом, заднее окно под потолком (@render-cabin-mirror-glass)',
    glass.every((g) => g.ok), JSON.stringify(glass));
  const fr = await okPage.page.evaluate(mirrorFrames, FAULT);
  check('торец бокового корпуса — контур картинки: наружный край выше, чем у борта, у правого тоже; торец в рамке MIR_H (@render-cabin-mirror-outline)',
    ['left', 'right'].every((k) => fr[k].n === fr.need && fr[k].inBox && fr[k].outer > fr[k].inner * 1.08), JSON.stringify(fr));
}
await okPage.context.close();

/* ---- свежесть рендера ---- */
let constsEnv = { ...process.env };
if (FAULT === 'eye') {
  const p = path.join(BUILD, 'cabin-fault-eye.html');
  fs.writeFileSync(p, html.replace('const EYE = { lat:-0.36, y:1.22, z:-0.20 };', 'const EYE = { lat:-0.36, y:1.24, z:-0.20 };'));
  constsEnv = { ...constsEnv, CONSTS_SRC: p };
}
const fresh = spawnSync('node', [path.join(ROOT, 'tools/blender/consts.mjs'), '--check'], { env: constsEnv, encoding: 'utf8' });
check('куб отрендерен на текущих константах index.html: отпечаток EYE/WSHIELD/WHEEL/… совпадает с вписанным в блок (@render-cabin-bake-fresh)',
  fresh.status === 0, (fresh.stderr || fresh.stdout).trim().split('\n').pop());

/* ---- отказ ---- */
const bad = await openPage(FAULT === 'normal' ? path.join(ROOT, 'index.html') : brokenPath);
check('битая грань куба: рисуется прежний салон, предупреждение [assets] одно, исключений нет (@render-cabin-fallback)',
  bad.frame.state === 'failed' && bad.frame.interior === 1 && bad.frame.cube === 0 && bad.warns.length === 1 && !bad.errors.length,
  JSON.stringify({ ...bad.frame, warns: bad.warns, errors: bad.errors }));
await bad.context.close();

/* ---- кузов: без модели — прежний лофт и одно предупреждение ---- */
const carBrokenPath = path.join(BUILD, 'car-fallback.html');
fs.writeFileSync(carBrokenPath, FAULT === 'car' ? html : html.replace(/<template id="car-mesh">[^<]*<\/template>/, ''));
{
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const pg = await ctx2.newPage();
  const errors = [], warns = [];
  pg.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
  pg.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('[assets] кузов')) warns.push(m.text()); });
  await pg.goto('file://' + carBrokenPath + '?nocache=' + Date.now());
  await pg.waitForFunction(() => typeof carModel !== 'undefined' && carModel.state !== 'off', null, { timeout: 15000 });
  const r = await pg.evaluate(() => {
    loadLevel(0); doAct('start'); opt.camMode = CAM_CHASE;
    let model = 0, loft = 0; const oM = emitCarModel, oB = emitCarBody;
    window.emitCarModel = (...a) => { model++; return oM(...a); };
    window.emitCarBody = (...a) => { loft++; return oB(...a); };
    try { render(0); } finally { window.emitCarModel = oM; window.emitCarBody = oB; }
    return { state: carModel.state, model, loft };
  });
  check('без модели кузова машины рисуются прежним лофтом, предупреждение [assets] одно, исключений нет (@render-car-fallback)',
    r.state === 'failed' && r.model === 0 && r.loft > 0 && warns.length === 1 && !errors.length,
    JSON.stringify({ ...r, warns, errors }));
  await ctx2.close();
}

/* ---- зеркала: без картинок — прежние корпуса и плоское стекло, по предупреждению на картинку ---- */
const mirBrokenPath = path.join(BUILD, 'mirror-fallback.html');
fs.writeFileSync(mirBrokenPath, FAULT === 'mirfallback' ? html
  : html.replace(/(data-asset="mirror-(?:side|center)" data-outline="[0-9.,;]+" alt="" src="data:image\/webp;base64,)[A-Za-z0-9+/=]+/g, '$1AAAA'));
{
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const pg = await ctx3.newPage();
  const errors = [], warns = [];
  pg.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
  pg.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('[assets] зеркало')) warns.push(m.text()); });
  await pg.goto('file://' + mirBrokenPath + '?nocache=' + Date.now());
  await pg.waitForFunction(() => typeof cabinBake !== 'undefined' && cabinBake.state !== 'loading', null, { timeout: 15000 });
  for (let i = 0; i < 30 && warns.length < 2; i++) await pg.waitForTimeout(100);
  await pg.evaluate(() => { loadLevel(0); doAct('start'); if (opt.camMode !== CAM_FP) pressKey('KeyV'); });
  const fr = await pg.evaluate(mirrorFrames, '');
  const st = await pg.evaluate(() => ({ side: !!mirImg.side, center: !!mirImg.center }));
  check('без картинок зеркал — прежний восьмигранный корпус и плоское стекло, предупреждений [assets] два, исключений нет (@render-mirror-img-fallback)',
    !st.side && !st.center && fr.left.n === 8 && fr.right.n === 8 && warns.length === 2 && !errors.length,
    JSON.stringify({ ...st, left: fr.left.n, right: fr.right.n, warns, errors }));
  await ctx3.close();
}

await browser.close();

/* ---- сборка ---- */
const budgetEnv = FAULT === 'budget' ? { ...process.env, EMBED_BUDGET_MB: '0.5' } : process.env;
const budget = spawnSync('node', [path.join(ROOT, 'tools/assets/embed.mjs'), '--check'], { env: budgetEnv, encoding: 'utf8' });
check('index.html в бюджете 2,2 МБ, блок картинок цел, все грани — WebP (@dist-asset-budget)',
  budget.status === 0, (budget.stdout + budget.stderr).trim().split('\n').filter(Boolean).slice(-2).join(' · '));

/* блок картинок не внутри <script>: иначе base64 уехал бы в зеркало codegraph и под мутатор */
const htmlS = FAULT === 'script'
  ? html.replace('<div id="assets"', '<script type="text/plain"><div id="assets"').replace('</div>\n<!-- assets:end -->', '</div></script>\n<!-- assets:end -->')
  : html;
const scripts = [...htmlS.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const mirror = fs.readFileSync(path.join(ROOT, 'codegraph-src/index.js'), 'utf8');
check('картинки встроены вне <script>: в скриптах страницы и в зеркале codegraph-src нет base64 граней (@dist-assets-outside-script)',
  !scripts.some((s) => s.includes('data:image/webp;base64,')) && !mirror.includes('data:image/webp;base64,'),
  `скриптов ${scripts.length}, зеркало ${(mirror.length / 1024).toFixed(0)} КБ`);

fs.rmSync(brokenPath, { force: true });
fs.rmSync(carBrokenPath, { force: true });
fs.rmSync(path.join(BUILD, 'cabin-fault-eye.html'), { force: true });
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
