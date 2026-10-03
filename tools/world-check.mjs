#!/usr/bin/env node
/* Гейт мира из картинок (коды render-car-styles, render-car-style-fallback, render-car-models,
   render-car-lights, render-wheel-spin, render-cull-exact, render-tram-texture, render-img-perspective, render-tex-perspective, render-tram-fallback, render-sky-pano; сценарии —
   specs/features/render/car.feature и world.feature): у чужих машин разные стили и кузова, а без
   картинки стиля — деталь стиля A; кузова — модели набора RgsDev с фарами, фонарями и номерами, стоп
   и поворотник горят на фонарях; трамвай нарисован
   картинками, а без них — прежними коробками; небо — панорама, низ которой стоит на линии горизонта,
   шов копий не виден, а на нижних уровнях качества — градиент.
     PW_DIR=/tmp/pw node tools/world-check.mjs
     FAULT=styles|stylefallback|models|lights|spin|cull|tram|persp|tramfallback|sky|texcell — сломать нарочно и увидеть красный: один стиль у
       всех машин, картинка стиля на месте при проверке отказа, у хэтчбека нет левой фары, у фонарей
       своей машины нет меток стороны, колёса без угла качения, отсечение с радиусом 0,2 от нужного, нет картинок трамвая, картинка на грани одной аффинной картой,
       картинки трамвая на месте при проверке отказа, нет картинки неба, плитка стен одной аффинной картой на грань
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

/* колёса крутятся: диск — картинка на квадрате 2R, и пока квадрат стоял, колёса ехали не вращаясь.
   Угол диска своей машины после настоящих кадров frame и машины потока после сдвига по её пути
   сверяется с пройденным путём: повернуться он обязан на путь / R, верхом вперёд */
const spin = await page.evaluate((fault) => {
  const R = CAR.wheelR, wheelImgs = new Set(Object.keys(carModel.img).filter((k) => k.startsWith('wheel')).map((k) => carModel.img[k]));
  const angleOf = (pick) => {
    const oE = emitCarMesh, oP = pushFace; let on = false, quad = null, F = null;
    window.emitCarMesh = function (u, v, th, col, st, lights, look) { on = pick(lights, look); F = fuv(th);
      try { return oE.apply(this, arguments); } finally { on = false; } };
    window.pushFace = function (vv, n, c, b, o) { if (on && !quad && o && o.img && wheelImgs.has(o.img)) quad = vv.map((q) => ({ u: -q.x, v: q.z, y: q.y })); return oP.apply(this, arguments); };
    try { render(0); } finally { window.emitCarMesh = oE; window.pushFace = oP; }
    if (!quad) return null;
    const cu = quad.reduce((a, q) => a + q.u, 0) / 4, cv = quad.reduce((a, q) => a + q.v, 0) / 4, cy = quad.reduce((a, q) => a + q.y, 0) / 4;
    const dz = (quad[0].u - cu) * F.u + (quad[0].v - cv) * F.v;
    return Math.atan2(quad[0].y - cy, dz);
  };
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const out = {}, oW = pushWheelCyl;
  if (fault === 'spin') window.pushWheelCyl = (u, v, y, sd, img) => oW(u, v, y, sd, img, 0);
  try {
  /* своя машина: 0,4 с настоящего frame на 3 м/с прямо */
  loadLevel(0); doAct('start'); opt.camMode = CAM_CHASE; paused = false;
  car.sel = 'D'; car.gear = 1; car.steer = 0; car.vel = 3; input.fwd = true;
  const own = (l) => !!(l && l.own);
  const a0 = angleOf(own), p0 = bodyPos();
  let t = 1000; for (let i = 0; i < 25; i++) { frame(t); t += 16; car.vel = 3; }
  const p1 = bodyPos(), a1 = angleOf(own), d = Math.hypot(p1.u - p0.u, p1.v - p0.v);
  input.fwd = false; paused = true;
  out.own = { d: +d.toFixed(3), want: +wrap(-d / R).toFixed(3), got: a0 === null || a1 === null ? null : +wrap(a1 - a0).toFixed(3) };
  /* машина потока: тот же кузов, сдвиг на 0,5 м по её пути */
  opt.traffic = 'normal'; loadLevel(29); doAct('start'); paused = true;
  const fc = level.actors.find((a) => a.kind === 'car' && a.act && !a.act.rail);
  if (fc) {
    car.ru = fc.u - fuv(fc.yaw).u * 7 + ruv(fc.yaw).u * 3; car.rv = fc.v - fuv(fc.yaw).v * 7 + ruv(fc.yaw).v * 3; car.th = fc.yaw;
    const mine = (l, look) => look === fc;
    const b0 = angleOf(mine); fc.act.s += 0.5; const b1 = angleOf(mine); fc.act.s -= 0.5;
    out.flow = { d: 0.5, want: +wrap(-0.5 / R).toFixed(3), got: b0 === null || b1 === null ? null : +wrap(b1 - b0).toFixed(3) };
  } else out.flow = { got: null, why: 'нет машины потока' };
  } finally { window.pushWheelCyl = oW; }
  return out;
}, FAULT);
check('колёса крутятся: диск своей машины и машины потока поворачивается на пройденный путь / R, верхом вперёд (@render-wheel-spin)',
  ['own', 'flow'].every((k) => spin[k].got !== null && Math.abs(spin[k].got - spin[k].want) < 0.02 && Math.abs(spin[k].want) > 0.3), JSON.stringify(spin));

/* отсечение по пирамиде взгляда (camSees) обязано выкидывать только невидимое: каждый отсечённый
   объект рисуется отдельно без отсечения, и ни одна его грань (видимая часть перед ближней плоскостью)
   не попадает в кадр. Геометрией, а не пикселями: попиксельно кадры совпадают в Chrome, а в headless
   shell строка горизонта дрожит от числа операций рисования в кадре, и это не отсечение */
const cull = await page.evaluate((fault) => {
  const oS = camSees, tight = (u, y, v, rd) => oS(u, y, v, rd * 0.2), out = [];
  const sees = fault === 'cull' ? tight : oS;
  const rend0 = () => level.rend;
  try {
    for (const lvl of [0, 21, 29]) {
      opt.traffic = 'normal'; loadLevel(lvl); doAct('start'); paused = true;
      if (level.actors.length) for (let i = 0; i < 100; i++) actorsTick(0.05);
      const c = bodyPos(), all = rend0();
      for (let a = 0; a < 360; a += 45) for (const [r, h] of [[8, 3], [4, 1.4]]) {
        const pos = { x: -(c.u + Math.sin(rad(a)) * r), y: h, z: c.v + Math.cos(rad(a)) * r }, tgt = { x: -c.u, y: 0.8, z: c.v };
        setVP(0, 0, W, H); setCam(pos, tgt, null, 58);
        const culled = all.filter((o) => !sees(o.u, (o.kind === 'car' ? 1.9 : o.kind === 'tram' ? 3.4 : o.h) * 0.5, o.v, o._crad || cullRad(o)));
        window.camSees = () => true;
        let leak = 0, worst = null;
        for (const o of culled) {
          level.rend = [o]; faces.length = 0; emitObstacles(60);
          for (const f of faces) {
            const behind = f.cp.some((q) => q.d <= NEAR), cc = behind ? clipNear(f.cp) : f.cp;
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const q of cc) { const sp = toScreen(q); x0 = Math.min(x0, sp.x); x1 = Math.max(x1, sp.x); y0 = Math.min(y0, sp.y); y1 = Math.max(y1, sp.y); }
            if (cc.length && x1 >= VP.x - 1 && x0 <= VP.x + VP.w + 1 && y1 >= VP.y - 1 && y0 <= VP.y + VP.h + 1) { leak++; worst = worst || { kind: o.kind, u: +o.u.toFixed(1), v: +o.v.toFixed(1) }; }
          }
        }
        level.rend = all; faces.length = 0; window.camSees = oS;
        /* дома — свой проход: отсечённый дом, нарисованный отдельно, тоже не даёт граней в кадре */
        let bldCulled = 0;
        for (const o of level.bld || []) {
          if (sees(o.u, o.h * 0.5, o.v, o._crad || cullRad(o))) continue;
          bldCulled++; faces.length = 0;
          emitBuilding(o, Math.hypot(o.u - c.u, o.v - c.v)); edgeOn = false;
          for (const f of faces) {
            const cc = f.cp.some((q) => q.d <= NEAR) ? clipNear(f.cp) : f.cp;
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const q of cc) { const sp = toScreen(q); x0 = Math.min(x0, sp.x); x1 = Math.max(x1, sp.x); y0 = Math.min(y0, sp.y); y1 = Math.max(y1, sp.y); }
            if (cc.length && x1 >= VP.x - 1 && x0 <= VP.x + VP.w + 1 && y1 >= VP.y - 1 && y0 <= VP.y + VP.h + 1) { leak++; worst = worst || { kind: 'bld', u: +o.u.toFixed(1), v: +o.v.toFixed(1) }; }
          }
        }
        faces.length = 0;
        /* разметка: отсечённый многоугольник целиком вне кадра (с запасом 3 px на линию) */
        let decCulled = 0;
        if (!RAMP_ON) for (const d of level.dec) {
          if (d._r === undefined || sees(d._u, 0, d._v, d._r + 0.3)) continue;
          decCulled++;
          const cp = d.pts.map((q) => toCam({ x: -q.u, y: 0.02, z: q.v })), cc = cp.some((q) => q.d <= NEAR) ? clipNear(cp) : cp;
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (const q of cc) { const sp = toScreen(q); x0 = Math.min(x0, sp.x); x1 = Math.max(x1, sp.x); y0 = Math.min(y0, sp.y); y1 = Math.max(y1, sp.y); }
          if (cc.length && x1 >= VP.x - 3 && x0 <= VP.x + VP.w + 3 && y1 >= VP.y - 3 && y0 <= VP.y + VP.h + 3) { leak++; worst = worst || { kind: 'decal', u: +d._u.toFixed(1), v: +d._v.toFixed(1) }; }
        }
        out.push({ lvl: lvl + 1, a, r, culled: culled.length + decCulled + bldCulled, leak, worst });
      }
    }
  } finally { window.camSees = oS; opt.traffic = 'normal'; }
  return out;
}, FAULT);
check('отсечение по пирамиде взгляда выкидывает только невидимое: ни одна грань отсечённого объекта и ни один кусок разметки не попадает в кадр (@render-cull-exact)',
  cull.every((r) => r.leak === 0) && cull.reduce((s, r) => s + r.culled, 0) > 0,
  JSON.stringify({ views: cull.length, culled: cull.reduce((s, r) => s + r.culled, 0), leaks: cull.filter((r) => r.leak).slice(0, 4) }));

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
      plates: F.filter((f) => f.m === 'plate').length };
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
/* картинка на большой грани под углом: аффинная карта по трём углам не знает перспективы, и борт
   трамвая «ехал» при повороте камеры — картинка съезжала с грани. На средний кусок борта кладётся
   метка-полоса на 0,3 длины; её место на экране сверяется с честной проекцией той же точки борта */
const persp = await page.evaluate((fault) => {
  opt.traffic = 'off'; loadLevel(28); doAct('start'); paused = true;
  const tr = level.rend.find((o) => o.kind === 'tram');
  const saved = worldImg['tram-side-mid'], W0 = 400, H0 = 200, U = 0.3;
  const t = document.createElement('canvas'); t.width = W0; t.height = H0;
  const g = t.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W0, H0); g.fillStyle = '#000'; g.fillRect(U * W0 - 3, 0, 6, H0);
  worldImg['tram-side-mid'] = t;
  const origI = imgFace;
  if (fault === 'persp') window.imgFace = (f, s0, s1, s2, s3) => { const pat = imgPattern(f.img); if (!pat) return;
    ctx.save(); ctx.transform((s1.x - s0.x) / f.img.width, (s1.y - s0.y) / f.img.width, (s3.x - s0.x) / f.img.height, (s3.y - s0.y) / f.img.height, s0.x, s0.y);
    ctx.fillStyle = pat; ctx.fill(); ctx.restore(); };
  const out = [];
  try {
    car.ru = tr.u + 300; car.rv = tr.v + 300;
    const R = rgt(tr.yaw), F = fwd(tr.yaw), HW = TRAM_W / 2, HL = TRAM_L / 2, tt = HL / 3, ym = (TRAM_SIDE_Y[0] + TRAM_SIDE_Y[1]) / 2;
    const P = (lat, y, z) => ({ x: -tr.u + R.x * lat + F.x * z, y, z: tr.v + R.z * lat + F.z * z });
    /* правый борт (sd = 1): кусок идёт от z = t к z = −t, левый край картинки — у z = t */
    const lat = HW + 0.004, zU = tt + (-tt - tt) * U;
    for (const [along, off] of [[9, 4], [-9, 4], [7, 2.5], [0, 6]]) {
      const cpos = P(lat + off, 1.6, along), tgt = P(lat, ym, 0);
      ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0); setVP(0, 0, W, H);
      setCam(cpos, tgt, null, 50);
      drawSceneInto({ grid: false, trails: false, guides: false, maxD: 60, labels: false });
      const sp = toScreen(toCam(P(lat, ym, zU)));
      const row = Math.round(sp.y * pxScale), x0 = Math.max(0, Math.round(sp.x * pxScale) - 120), w = 240;
      const px = ctx.getImageData(x0, row, w, 1).data;
      let best = -1, bl = 1e9;
      for (let i = 0; i < w; i++) { const l = px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]; if (l < bl) { bl = l; best = i; } }
      let a = best, b = best; while (a > 0 && px[(a - 1) * 4] < 60) a--; while (b < w - 1 && px[(b + 1) * 4] < 60) b++;
      const xs = (x0 + (a + b) / 2) / pxScale;
      out.push({ cam: [along, off], err: +Math.abs(xs - sp.x).toFixed(1), dark: bl });
    }
  } finally { worldImg['tram-side-mid'] = saved; window.imgFace = origI; opt.traffic = 'normal'; }
  return out;
}, FAULT);
check('картинка на большой грани под углом стоит на грани: метка борта трамвая там же, где её точка, ± 2 px (@render-img-perspective)',
  persp.every((r) => r.err <= 2 && r.dark < 120), JSON.stringify(persp));

/* плитка стен, бордюров и фасадов не плывёт: каждая залитая ячейка кладёт узор аффинно по трём углам, и
   его сдвиг против честной проекции той же точки грани — в четвёртом углу и в серединах сторон —
   это и разрыв на стыке с соседней ячейкой, и то, насколько узор «едет» при повороте камеры. Сцены — стены
   дворов, дома общей карты, бордюры; камера поворачивается по кругу. В счёт идут ячейки в кадре. Картинки
   фасадов кладёт facFace со своим делением — их меряет facade-check (@render-buildings-facade-perspective) */
const texp = await page.evaluate((fault) => {
  opt.traffic = 'off'; opt.gfx = 'max';
  const origC = texCell;
  /* поломка — настоящий код без права делить: одна аффинная карта на грань */
  if (fault === 'texcell') window.texCell = function (t0, t1, r0, r1) { return origC(t0, t1, r0, r1, TEX_SPLIT, TEX_SPLIT); };
  const M = { x: 0, y: 0, d: 0 };
  const out = {}; let cur = null;
  /* сдвиг по МАТРИЦЕ, которую получил канвас (ctx.getTransform, в ней и DPR), против честной проекции
     точки грани — в углах, серединах сторон и центре ячейки; только ячейки в кадре */
  texCellHook = (C) => {
    const f = TXS.f, m = ctx.getTransform();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const P of C) { const s = cam.scale / P.d, x = VP.cx + P.x * s, y = VP.cy - P.y * s; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < 0 || x0 > VP.w || y1 < 0 || y0 > VP.h) return;
    const t0 = C[0].t, t1 = C[1].t, r0 = C[0].r, r1 = C[2].r;
    let e = 0;
    for (const a of [0, 0.5, 1]) for (const b of [0, 0.5, 1]) {
      const t = t0 + (t1 - t0) * a, r = r0 + (r1 - r0) * b;
      texAt(f.cp[0], f.cp[1], f.cp[2], f.cp[3], t, r, M); const k = cam.scale / M.d;
      const ta = TXS.a0 + TXS.d1a * t + TXS.d3a * r, tb = TXS.b0 + TXS.d1b * t + TXS.d3b * r;
      const sx = (m.a * ta + m.c * tb + m.e) / pxScale, sy = (m.b * ta + m.d * tb + m.f) / pxScale;
      e = Math.max(e, Math.hypot(VP.cx + M.x * k - sx, VP.cy - M.y * k - sy));
    }
    cur.cells++; cur.es.push(e);
  };
  const scene = (name, li, u, v, th, camMode, yaws) => {
    cur = out[name] = { cells: 0, es: [] };
    loadLevel(li); doAct('start'); paused = true; qLevel = 0; opt.camMode = camMode; opt.refs = 0;
    setBody(u, v, th); car.vel = 0;
    for (const y of yaws) { if (camMode === CAM_FP) opt.fpYaw = rad(y); else { opt.camYaw = th + rad(y); camSm = null; } for (let k = 0; k < 3; k++) render(0.016); }
  };
  const Y = []; for (let y = -180; y < 180; y += 5) Y.push(y);
  try {
    scene('двор 2 сзади', 1, 0, 0, 0, CAM_CHASE, Y);
    scene('двор 1 сзади', 0, 0, 0, 0, CAM_CHASE, Y);
    scene('двор 1 салон', 0, 0, 0, 0, CAM_FP, [-80, -40, 0, 40, 80]);
    scene('город 29 сзади', 28, 8.15, -60, 0, CAM_CHASE, Y);
    scene('экзамен старт сзади', 31, 8.15, -100, 0, CAM_CHASE, Y);
    scene('экзамен старт салон', 31, 8.15, -100, 0, CAM_FP, [-80, -40, 0, 40, 80, 150, -150]);
    scene('уровень 23 бордюры', 22, 1.65, -6, 0, CAM_CHASE, Y);
  } finally { texCellHook = null; window.texCell = origC; opt.traffic = 'normal'; }
  const res = {};
  for (const k in out) { const e = out[k].es.sort((a, b) => a - b);
    res[k] = { cells: out[k].cells, p99: +(e[Math.floor(e.length * 0.99)] || 0).toFixed(2), max: +(e[e.length - 1] || 0).toFixed(2) }; }
  return res;
}, FAULT);
/* порог 2,5 px: раскладка держит TEX_ERR_PX 2 px в четвёртом углу, серединах сторон и центре, проверка
   меряет девять точек ячейки — запас на точки между проверенными */
check('плитка стен, бордюров и фасадов не плывёт при повороте камеры: сдвиг узора в каждой ячейке в кадре ≤ 2,5 px (@render-tex-perspective)',
  Object.values(texp).every((r) => r.cells > 20 && r.max <= 2.5), JSON.stringify(texp));
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
