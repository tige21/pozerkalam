#!/usr/bin/env node
/* Гейт мира из картинок (коды render-car-styles, render-car-style-fallback, render-car-models,
   render-car-lights, render-tram-texture, render-tram-fallback, render-sky-pano; сценарии —
   specs/features/render/car.feature и world.feature): у чужих машин разные стили и кузова, а без
   картинки стиля — деталь стиля A; кузова — модели набора RgsDev с фарами, фонарями и номерами, стоп
   и поворотник горят на фонарях; трамвай нарисован
   картинками, а без них — прежними коробками; небо — панорама, низ которой стоит на линии горизонта,
   шов копий не виден, а на нижних уровнях качества — градиент.
     PW_DIR=/tmp/pw node tools/world-check.mjs
     FAULT=styles|stylefallback|models|lights|tram|tramfallback|sky — сломать нарочно и увидеть красный: один стиль у
       всех машин, картинка стиля на месте при проверке отказа, у хэтчбека нет левой фары, у фонарей
       своей машины нет меток стороны, нет картинок трамвая, картинки трамвая на месте при проверке
       отказа, нет картинки неба
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
await prep.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); localStorage.setItem('trainer_runs', '9'); });
await prep.close();
const page = await context.newPage();
const errors = [], warns = [];
page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
page.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('[assets]')) warns.push(m.text()); });
await page.goto(url + 'r');
await page.waitForFunction(() => typeof carModel !== 'undefined' && carModel.state === 'ready' && carModel.imgDone
  && worldImg['tram-front'] && worldImg['sky-pano'], null, { timeout: 20000 });
/* кадр рисует сам инструмент: цикл rAF останавливается, иначе он перерисовал бы канвас между замерами */
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });

/* ---- стили чужих машин ---- */
const styles = await page.evaluate((fault) => {
  loadLevel(0); doAct('start'); paused = true;
  const cars = level.obs.filter((o) => o.kind === 'car');
  if (fault === 'styles') for (const o of cars) { o.style = 'b'; o.body = 'sedan'; }
  const adjacent = cars.slice(1).filter((o, i) => o.style === cars[i].style).length;
  const imgs = ['b', 'c', 'd', 'e'].map((s) => 'wheel-' + s).filter((k) => !carModel.img[k]);
  /* кузова, которыми рисуются машины рядом: своя машина ставится вплотную к ряду припаркованных */
  const bodies = new Set(), orig = emitCarModel;
  window.emitCarModel = (u, v, th, col, lit, body, style) => { for (const [k, b] of Object.entries(carModel.bodies)) if (b === body) bodies.add(k + ':' + style); return orig(u, v, th, col, lit, body, style); };
  try {
    for (const o of cars.slice(0, 4)) { car.ru = o.u - 3; car.rv = o.v - 6; opt.camMode = CAM_CHASE; render(0); }
  } finally { window.emitCarModel = orig; }
  const kinds = new Set([...bodies].map((s) => s.split(':')[0]));
  return { cars: cars.length, styles: cars.map((o) => o.style).join(''), adjacent, missingImgs: imgs, drawn: [...bodies].sort() , kinds: [...kinds].sort() };
}, FAULT);
check('у чужих машин разные стили: соседи по ряду не совпадают, диски всех стилей распакованы, рисуются все три кузова (@render-car-styles)',
  styles.cars >= 4 && styles.adjacent === 0 && !styles.missingImgs.length && ['cross', 'hatch', 'sedan'].every((k) => styles.kinds.includes(k)),
  JSON.stringify(styles));

/* ---- отказ стиля: без картинки — деталь стиля A и одно предупреждение ---- */
const fb = await page.evaluate((fault) => {
  const saved = carModel.img['wheel-c'];
  if (fault !== 'stylefallback') delete carModel.img['wheel-c'];
  delete carModel.warned['wheel-c'];
  const got = carStyleImg('wheel', 'c'), again = carStyleImg('wheel', 'c');
  carModel.img['wheel-c'] = saved;
  return { got, again };
}, FAULT);
await page.waitForTimeout(50);
const fbWarns = warns.filter((w) => w.includes('wheel-c'));
check('без картинки стиля деталь берётся у стиля A, предупреждение [assets] одно (@render-car-style-fallback)',
  fb.got === 'wheel' && fb.again === 'wheel' && fbWarns.length === 1, JSON.stringify({ ...fb, warns: fbWarns }));

/* ---- кузова — модели набора RgsDev: фары, фонари, номера; стоп и поворотник на фонарях ---- */
const mdl = await page.evaluate((fault) => {
  const out = {};
  for (const [name, B] of Object.entries(carModel.bodies)) {
    const F = fault === 'models' && name === 'hatch' ? B.F.filter((f) => f.lamp !== 'head-L') : B.F;
    out[name] = { faces: F.length, lamps: [...new Set(F.filter((f) => f.lamp).map((f) => f.lamp))].sort().join(','),
      plates: F.filter((f) => f.img === 'plate').length };
  }
  return out;
}, FAULT);
check('кузова — модели набора: у каждого фары и фонари слева и справа, номер спереди и сзади, граней не больше 600 (@render-car-models)',
  ['sedan', 'hatch', 'cross'].every((k) => mdl[k] && mdl[k].lamps === 'head-L,head-R,tail-L,tail-R' && mdl[k].plates === 2 && mdl[k].faces <= 600),
  JSON.stringify(mdl));

/* стоп и поворотник своей машины: накладки считаются по стороне их центра в кадре кузова */
const lights = await page.evaluate((fault) => {
  loadLevel(0); doAct('start'); paused = true; opt.camMode = CAM_CHASE;
  const B = carModel.bodies.sedan, saved = B.F.map((f) => f.lamp);
  if (fault === 'lights') for (const f of B.F) if (f.lamp && f.lamp.startsWith('tail')) f.lamp = null;
  const c = bodyPos(), R = ruv(car.th);
  let red = 0, amberL = 0, amberR = 0, own = false;
  const oF = pushFace, oM = emitCarModel;
  window.pushFace = (v, n, col, b, o) => {
    if (own && col && col.length === 4) {
      let u = 0, w = 0; for (const q of v) { u -= q.x; w += q.z; }
      const lat = (u / v.length - c.u) * R.u + (w / v.length - c.v) * R.v;
      if (col[1] === 40) red++; else if (col[1] === 170) { if (lat < 0) amberL++; else amberR++; }
    }
    return oF(v, n, col, b, o);
  };
  window.emitCarModel = (u, v, th, col, lit, ...rest) => { own = !!(lit && lit.own); try { return oM(u, v, th, col, lit, ...rest); } finally { own = false; } };
  const back0 = input.back, blink0 = car.blink, t0 = game.t;
  try { input.back = true; car.blink = 'L'; game.t = 0.1; render(0); }
  finally { window.pushFace = oF; window.emitCarModel = oM; input.back = back0; car.blink = blink0; game.t = t0; B.F.forEach((f, i) => { f.lamp = saved[i]; }); }
  return { red, amberL, amberR };
}, FAULT);
check('стоп горит на фонарях своей машины, поворотник — только на своей стороне (@render-car-lights)',
  lights.red >= 2 && lights.amberL >= 2 && lights.amberR === 0, JSON.stringify(lights));

/* ---- трамвай: картинками, а без картинок — коробками ---- */
const tramRun = (drop) => page.evaluate((drop) => {
  loadLevel(28); doAct('start'); paused = true;
  const tr = level.rend.find((o) => o.kind === 'tram');
  const keys = ['tram-front', 'tram-side-end', 'tram-side-mid'], saved = keys.map((k) => worldImg[k]);
  if (drop) for (const k of keys) delete worldImg[k];
  const tramImgs = new Set(keys.map((k) => worldImg[k]).filter(Boolean));
  let img = 0, boxes = 0, inTram = false;
  const oF = pushFace, oB = pushBox, oT = emitTram;
  window.pushFace = (v, n, c, b, o) => { if (inTram && o && o.img && (tramImgs.has(o.img) || o.img instanceof HTMLCanvasElement)) img++; return oF(v, n, c, b, o); };
  window.pushBox = (...a) => { if (inTram) boxes++; return oB(...a); };
  window.emitTram = (o) => { inTram = true; try { return oT(o); } finally { inTram = false; } };
  try {
    const f = fuv(tr.yaw);
    car.ru = tr.u + f.u * 12 + 4; car.rv = tr.v + f.v * 12; opt.camMode = CAM_CHASE; render(0);
  } finally { window.pushFace = oF; window.pushBox = oB; window.emitTram = oT; keys.forEach((k, i) => { if (saved[i]) worldImg[k] = saved[i]; }); }
  return { img, boxes };
}, drop);
const tram = await tramRun(FAULT === 'tram');
check('трамвай нарисован картинками: по три куска на борт и наклонный перёд на оба торца (@render-tram-texture)',
  tram.img >= 6, JSON.stringify(tram));
const tramFb = await tramRun(FAULT !== 'tramfallback');
check('без картинок трамвая — прежние коробки поясов, ни одной грани-картинки (@render-tram-fallback)',
  tramFb.img === 0 && tramFb.boxes >= 6, JSON.stringify(tramFb));

/* ---- небо ---- */
const sky = await page.evaluate((fault) => {
  loadLevel(0); doAct('start'); paused = true;
  if (fault === 'sky') delete worldImg['sky-pano'];
  const img = worldImg['sky-pano'];
  const run = (q, yawDeg) => {
    const q0 = qLevel; qLevel = q; opt.camMode = CAM_CHASE; opt.camYaw = rad(yawDeg); opt.pitch = rad(12);
    const draws = [], o = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (src, ...a) { if (img && src === img && this === ctx) draws.push(a); return o.call(this, src, ...a); };
    try { render(0); } finally { CanvasRenderingContext2D.prototype.drawImage = o; qLevel = q0; }
    /* линия горизонта — проекция горизонтального направления взгляда, считается здесь заново */
    const f = viewCam.f, u = viewCam.u, hl = Math.hypot(f.x, f.z), dx = f.x / hl, dz = f.z / hl;
    const yh = VP.cy - viewCam.scale * (dx * u.x + dz * u.z) / (dx * f.x + dz * f.z);
    return { draws, yh };
  };
  const a = run(0, 30), b = run(SKY_PANO_Q, 30);
  if (!a.draws.length) return { drawn: false, lowQ: b.draws.length };
  const bottom = a.draws[0][1] + a.draws[0][3];
  /* шов: столбцы по обе стороны стыка копий картинки, в полосе облаков над городом */
  const xs = a.draws.map((d) => d[0]).sort((p, q) => p - q), seam = xs.find((x) => x > 40 && x < VP.w - 40);
  let seamDiff = null;
  if (seam !== undefined) {
    const y0 = Math.max(4, Math.round(a.draws[0][1] + 4)), y1 = Math.round(a.yh - 30), h = Math.max(4, y1 - y0);
    const L = ctx.getImageData(Math.round((seam - 3) * pxScale), Math.round(y0 * pxScale), 1, Math.round(h * pxScale)).data;
    const R = ctx.getImageData(Math.round((seam + 3) * pxScale), Math.round(y0 * pxScale), 1, Math.round(h * pxScale)).data;
    let s = 0; for (let i = 0; i < L.length; i += 4) s += (Math.abs(L[i] - R[i]) + Math.abs(L[i + 1] - R[i + 1]) + Math.abs(L[i + 2] - R[i + 2])) / 3;
    seamDiff = +(s / (L.length / 4)).toFixed(1);
  }
  return { drawn: true, copies: a.draws.length, bottom: +bottom.toFixed(1), yh: +a.yh.toFixed(1), seam: seam === undefined ? null : +seam.toFixed(0), seamDiff, lowQ: b.draws.length };
}, FAULT);
check('небо — панорама: низ картинки на линии горизонта ± 2 px, шов копий не виден, на нижних уровнях качества — градиент (@render-sky-pano)',
  sky.drawn && Math.abs(sky.bottom - sky.yh) <= 2 && (sky.seamDiff === null || sky.seamDiff < 12) && sky.lowQ === 0, JSON.stringify(sky));

check('страница без исключений', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
