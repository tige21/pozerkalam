#!/usr/bin/env node
/* Гейт облёта (код render-orbit-lod-stable; сценарий — specs/features/render/oblet.feature): камера погони обходит
   стоящую машину по кругу, и ни один объект, видимый на двух соседних шагах, не меняет вида — дерево не переключает
   ближнюю и дальнюю модель, чужая машина — модель, лофт и силуэт, куст не пропадает, а дальние предметы, тени,
   разметка и разрезка домов не появляются и не исчезают у своих порогов. Детализация считается от центра облёта
   (машины игрока), а не от камеры: от камеры расстояния менялись с каждым поворотом, и предметы переключали вид
   прямо на глазах (владелец 04.10.2026: «у деревьев под разными углами меняются текстуры, и у машины, когда камеру
   от 3 лица поворачиваю»). Позы подобраны у порогов: дерево — у PROP_LOD_D, машина — у CAR_MODEL_D, куст — у
   PROP_SMALL_D от машины; дальние отсечки — со стартов уровней 29 и 32, всё в полосе у maxD, 55 м теней и BLD_NEAR_D.
   Каждая сцена сначала прогоняется с детализацией от камеры и обязана переключать вид: иначе она не у порога, и её
   зелёный ничего не доказывает (раскладка города поменялась, камеру прижало стеной). У каждой — свой минимум сравнений.
     PW_DIR=/tmp/pw node tools/orbit-check.mjs
     FAULT=lodcam — детализация снова от камеры: проверка обязана покраснеть
     HTML=/путь/к/index.html — проверить другую сборку (например, git show HEAD:index.html)
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
/* HTML — другая сборка страницы: так проверка доказывает, что старый код она ловит */
const url = 'file://' + (process.env.HTML || path.join(ROOT, 'index.html')) + '?nocache=' + Date.now();
const prep = await context.newPage();
await prep.goto(url);
await prep.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_gfx', 'max'); localStorage.setItem('trainer_traffic', 'off'); });
await prep.close();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
await page.goto(url + 'r');
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && typeof propModel !== 'undefined'
  && /ready|failed/.test(propModel.state) && /ready|failed/.test(carModel.state), null, { timeout: 20000 });

const res = await page.evaluate((fault) => {
  window.requestAnimationFrame = () => 0;
  if (propModel.state !== 'ready' || carModel.state !== 'ready') return { error: 'модели не загрузились: деревья коробками, машины лофтом — облёт проверять нечем' };
  const ORBIT_IN = 4;
  /* «от камеры» — как было до правки: центр детализации — сама камера. Этим режимом каждая сцена сначала доказывает,
     что стоит у порога (переключения есть), и только потом проверяется игра */
  const oLS = window.lodSync, hasLod = typeof oLS === 'function';
  const camLod = function () { LOD_P.u = -cam.pos.x; LOD_P.v = cam.pos.z; if (typeof LOD_C !== 'undefined') { LOD_C.u = LOD_P.u; LOD_C.v = LOD_P.v; } };
  const setMode = (m) => { if (hasLod) window.lodSync = m === 'cam' ? camLod : oLS; };
  /* вид каждого объекта на шаге: дерево — 'far'/'near' по тому, из чьих вершин собраны грани; машина — какой функцией
     нарисована; дом — разрезан ли; предмет, тень и разметка — нарисованы или нет */
  const lodOf = new Map();
  for (const k in propModel.M) { const P = propModel.M[k]; if (P.lod) for (const w of P.lod.W) lodOf.set(w, 'far'); for (const w of P.W) lodOf.set(w, 'near'); }
  let seen = null, curProp = null, inShadow = false, inDec = false;
  const main = () => VP.w === W && !mirPassOn;
  const H0 = {};
  for (const k of ['pushFace', 'emitProp', 'emitCarModel', 'emitCarBody', 'emitCarLow', 'emitObstacle', 'emitBuilding', 'drawShadows', 'drawDecals', 'fillGroundPoly', 'fillGroundPolys', 'strokeGroundPath']) H0[k] = window[k];
  window.pushFace = function (v) { if (seen && curProp && !seen.has(curProp)) { const k = lodOf.get(v[0]); if (k) seen.set(curProp, k); } return H0.pushFace.apply(this, arguments); };
  window.emitProp = function (o) { if (!main()) return H0.emitProp.apply(this, arguments); curProp = o; try { return H0.emitProp.apply(this, arguments); } finally { curProp = null; } };
  window.emitObstacle = function (o) { if (seen && main()) seen.set('obs', (seen.get('obs') || new Set()).add(o)); return H0.emitObstacle.apply(this, arguments); };
  window.emitBuilding = function (o, d) { if (seen && main()) seen.set(o, d < BLD_NEAR_D ? 'cut' : 'box'); return H0.emitBuilding.apply(this, arguments); };
  const carKey = (u, v) => u.toFixed(2) + ',' + v.toFixed(2);
  const carRec = (kind, fn) => function (u, v) { if (seen && main()) seen.set('car@' + carKey(u, v), kind); return H0[fn].apply(this, arguments); };
  window.emitCarModel = carRec('model', 'emitCarModel'); window.emitCarBody = carRec('loft', 'emitCarBody'); window.emitCarLow = carRec('low', 'emitCarLow');
  const wrapPass = (fn, set) => function () { if (!main()) return H0[fn].apply(this, arguments); set(true); try { return H0[fn].apply(this, arguments); } finally { set(false); } };
  window.drawShadows = wrapPass('drawShadows', (x) => { inShadow = x; });
  window.drawDecals = wrapPass('drawDecals', (x) => { inDec = x; });
  const ground = (fn) => function (pts) { if (seen && (inShadow || inDec)) seen.set(pts, 'drawn'); return H0[fn].apply(this, arguments); };
  window.fillGroundPoly = ground('fillGroundPoly'); window.fillGroundPolys = ground('fillGroundPolys'); window.strokeGroundPath = ground('strokeGroundPath');
  const scenes = [];
  try {
    /* сцены у порога — на открытой улице: во дворе камеру погони прижимает к кузову стенами, и при облёте она почти не
       движется. Предметы ищутся по координатам после загрузки уровня — loadLevel раздаёт новые копии */
    loadLevel(26);
    const tree = level.props.find((p) => p.m.startsWith('tree') && Math.abs(p.u - 11.15) < 0.3);
    const g = level.city.graph, axis = (p) => { let best = null;
      for (const e of g.E) { const A = g.V[e.a], B = g.V[e.b], du = B.u - A.u, dv = B.v - A.v, L = Math.hypot(du, dv); if (L < 30) continue;
        const t = ((p.u - A.u) * du + (p.v - A.v) * dv) / (L * L), d = Math.abs((p.u - A.u) * dv - (p.v - A.v) * du) / L;
        if (t > 0.3 && t < 0.9 && (!best || d < best.d)) best = { d, pu: A.u + du * t, pv: A.v + dv * t, fu: du / L, fv: dv / L }; }
      return best; };
    const bush = level.props.filter((p) => p.small && p.m.startsWith('bush')).map((p) => ({ p, a: axis(p) })).find((x) => x.a && x.a.d < 9);
    /* предмет впереди машины на ORBIT_IN ближе порога: камера сзади дальше от него на ~8 м, сбоку — на ~2, впереди
       предмет у неё за спиной. Расстояние от камеры пересекает порог, пока предмет виден, — от машины оно постоянно */
    const D = (T, k) => T - (k || ORBIT_IN);
    if (tree) scenes.push({ name: 'дерево у порога дальней модели', li: 26, u: tree.u - 3, v: tree.v - Math.sqrt(D(PROP_LOD_D) ** 2 - 9), th: 0, kind: 'state', keys: [{ at: tree }], min: 20 });
    if (bush) { const a = bush.a, back = Math.sqrt(D(PROP_SMALL_D, 7) ** 2 - a.d * a.d);
      scenes.push({ name: 'куст у порога дальности мелочи', li: 26, u: a.pu - a.fu * back, v: a.pv - a.fv * back, th: Math.atan2(a.fu, a.fv) * 180 / Math.PI, kind: 'presence', keys: [{ at: bush.p }], min: 10 }); }
    /* машина с аварийкой на Заводской (уровень 28) стоит; игрок — в CAR_MODEL_D от неё по той же улице. Далёкую машину
       камера видит только из-за спины игрока — отступ от порога больше, чтобы порог пересекался в поле зрения */
    loadLevel(27);
    const pc = level.obs.find((o) => o.kind === 'car' && !o.act);
    if (pc) scenes.push({ name: 'чужая машина у порога модели', li: 27, u: pc.u - D(CAR_MODEL_D, 7), v: pc.v, th: 90, kind: 'state', keys: ['car@' + carKey(pc.u, pc.v)], min: 20 });
    /* дальние отсечки — со старта уровней: всё, что лежит в полосе у порога от машины, — предметы у maxD, тени у 55 м,
       разметка у maxD и дома у порога разрезки. Видимость (пирамида взгляда и дома между камерой и предметом) — тем же
       кодом игры, сравниваются только объекты, видимые на обоих шагах */
    for (const li of [28, 31]) scenes.push({ name: 'дальние отсечки со старта уровня ' + (li + 1), li, start: true, kind: 'band', min: 50 });
    const run = (sc, mode) => {
      setMode(mode);
      loadLevel(sc.li); doAct('start'); hideOv(); paused = true; opt.camMode = CAM_CHASE; opt.mirrors = false; opt.refs = 0;
      if (!sc.start) setBody(sc.u, sc.v, sc.th * Math.PI / 180);
      car.vel = 0;
      /* loadLevel раздаёт новые копии предметов — ключ сцены находится заново по месту и модели */
      const keys = (sc.keys || []).map((k) => typeof k === 'object' ? level.props.find((p) => p.m === k.at.m && Math.hypot(p.u - k.at.u, p.v - k.at.v) < 0.01) : k);
      const c = bodyPos(), dc = (u, v) => Math.hypot(u - c.u, v - c.v), maxD = QUALITY[qLevel].maxD;
      const inBand = (d, T) => d > T - 12 && d < T + 2;
      /* круг тени игра считает лениво, в первом кадре, где тень рядом; здесь — той же формулой заранее */
      const shadowCircle = (o) => { if (o._sr !== undefined) return;
        let su = 0, sv = 0; for (const q of o._shadow) { su += q.u; sv += q.v; } su /= o._shadow.length; sv /= o._shadow.length;
        let sr = 0; for (const q of o._shadow) sr = Math.max(sr, Math.hypot(q.u - su, q.v - sv)); o._su = su; o._sv = sv; o._sr = sr; };
      /* объекты полосы и их видимость на шаге; для сцен у порога — свои ключи */
      const band = sc.kind !== 'band' ? null : {
        obs: level.rend.filter((o) => !(o.kind === 'prop' && (o.small || o.yard || o.m === 'yard')) && inBand(dc(o.u, o.v), maxD)),
        shadow: level.obs.filter((o) => o._shadow && (shadowCircle(o), inBand(dc(o.u, o.v), 55) || inBand(dc(o._su, o._sv) - o._sr, 55))),
        dec: level.dec.filter((d) => d._r !== undefined && !d.far && inBand(dc(d._u, d._v) - d._r, maxD)),
        bld: level.bld.filter((o) => inBand(dc(o.u, o.v), BLD_NEAR_D)) };
      const visObs = (o) => camSees(o.u, (o.kind === 'car' ? 1.9 : o.kind === 'tram' ? 3.4 : o.h) * 0.5, o.v, o._crad || cullRad(o)) && bldOcc(o) !== 2;
      let prev = null, flips = 0, compared = 0, steps = 0;
      const where = [];
      const flip = (y, what, a, b) => { flips++; if (where.length < 6) where.push(y + '° ' + what + ' ' + a + '→' + b); };
      for (let y = 0; y < 360; y += 3) {
        opt.camYaw = car.th + y * Math.PI / 180; camSm = null; render(0.016);
        seen = new Map(); render(0.016);
        const cur = seen; seen = null; steps++;
        const obsSet = cur.get('obs') || new Set();
        const st = { state: new Map(), vis: new Map() };
        if (sc.kind === 'state') for (const k of keys) st.state.set(k, cur.get(k));
        if (sc.kind === 'presence') for (const k of keys) { st.state.set(k, obsSet.has(k) ? 'есть' : 'нет'); st.vis.set(k, visObs(k)); }
        if (band) {
          for (const o of band.obs) { st.state.set(o, obsSet.has(o) ? 'есть' : 'нет'); st.vis.set(o, visObs(o)); }
          for (const o of band.shadow) { st.state.set(o._shadow, cur.has(o._shadow) ? 'тень' : 'без тени'); st.vis.set(o._shadow, camSees(o._su, 0, o._sv, o._sr)); }
          for (const d of band.dec) { const k = d.polys || d.pts; st.state.set(k, cur.has(k) ? 'есть' : 'нет'); st.vis.set(k, RAMP_ON || camSees(d._u, 0, d._v, d._r + 0.3)); }
          for (const o of band.bld) { st.state.set(o, cur.get(o)); }
        }
        if (prev) for (const [k, a] of prev.state) {
          const b = st.state.get(k);
          /* вид без видимости (модель, разрезка) сравнивается, когда объект нарисован на обоих шагах; наличие — когда
             объект в кадре и не закрыт домом на обоих */
          if (st.vis.has(k)) { if (!prev.vis.get(k) || !st.vis.get(k)) continue; }
          else if (a === undefined || b === undefined) continue;
          compared++;
          if (a !== b) flip(y, (k.kind || (typeof k === 'string' ? 'машина' : Array.isArray(k) ? 'земля' : '')), a, b);
        }
        prev = st;
      }
      return { steps, compared, flips, where };
    };
    const out = [];
    for (const sc of scenes) {
      const self = run(sc, 'cam');
      const game = run(sc, fault === 'lodcam' ? 'cam' : 'game');
      out.push({ name: sc.name, min: sc.min, self: { compared: self.compared, flips: self.flips }, compared: game.compared, flips: game.flips, where: game.where });
    }
    return { scenes: out };
  } finally {
    for (const k in H0) window[k] = H0[k];
    setMode('game');
  }
}, FAULT);

if (res.error) check('облёт камерой (@render-orbit-lod-stable)', false, res.error);
else {
  /* сцена считается, только если она у порога: «от камеры» она переключает вид, — иначе зелёный ничего не доказывает */
  const deaf = res.scenes.filter((r) => r.self.flips === 0 || r.self.compared < r.min);
  const thin = res.scenes.filter((r) => r.compared < r.min);
  const flips = res.scenes.filter((r) => r.flips > 0);
  check('облёт камерой вокруг стоящей машины не меняет вида деревьев, чужих машин, мелочи, теней, разметки и домов (@render-orbit-lod-stable)',
    res.scenes.length >= 5 && !deaf.length && !thin.length && !flips.length,
    JSON.stringify({ scenes: res.scenes.map((r) => ({ n: r.name, self: r.self.flips, cmp: r.compared, flips: r.flips, where: r.where })),
      deaf: deaf.map((r) => r.name), thin: thin.map((r) => r.name) }));
}
check('страница без исключений', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
