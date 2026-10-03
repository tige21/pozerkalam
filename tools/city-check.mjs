#!/usr/bin/env node
/* Гейт города без края (коды city-world-edge-hidden, city-buildings-clear, city-buildings-sight,
   render-buildings-under-street, render-buildings-fade, render-buildings-sort; сценарии —
   specs/features/city/zdaniya.feature) и поребрика (city-kerb-continuous, city-kerb-off-carriageway,
   city-kerb-furniture-clear — specs/features/city/borduyr.feature; поток и линия экзамена проверяются в
   traffic-check и exam-check). Главное — край мира не виден: из точек вдоль всех улиц общей карты
   и со стартов и целей уровней 27–32 горизонтальный луч в любую сторону упирается в дом не дальше
   BLD_MAXD. Дома при этом не стоят на улицах, перекрёстках, кольце, эстакаде, в карманах, на знаках и
   светофорах и не заходят в треугольники видимости; проход домов рисуется раньше уличного, дальний дом
   растворён в дымке, а внутри прохода нет перевёрнутых пар граней.
     PW_DIR=/tmp/pw node tools/city-check.mjs
     FAULT=edge|bldclear|bldsight|bldpass|fade|kerbgap|kerbin|kerbpole — сломать нарочно и увидеть красный:
       без внешнего пояса, тупиков и концов перспективы; дом на улице; дом в треугольнике видимости; дома в
       общем проходе; общий туман у дальних домов; каждая пятая коробка поребрика выкинута; поребрик шире на
       0,7 м внутрь; стойка поставлена на поребрик
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
const errors = [];
page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
await page.goto(url + 'r');
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && typeof carModel !== 'undefined' && carModel.state !== 'off', null, { timeout: 20000 });
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.addScriptTag({ path: path.join(ROOT, 'tools', 'sort-audit.js') });

/* уровни общей карты — по признаку, а не по номерам: у них в city есть граф улиц и дома */
const CITY = await page.evaluate(() => LEVELS.map((d, i) => [d, i]).filter(([d]) => !d.custom).map(([, i]) => { loadLevel(i); return level.city && level.city.graph && level.bld && level.bld.length ? i : -1; }).filter((i) => i >= 0));

/* ---- край мира не виден ---- */
const edge = await page.evaluate(([CITY, fault]) => {
  const rayHit = (B, pu, pv, du, dv, lim) => {
    let best = 1e9;
    for (const q of B) {
      if (Math.hypot(q.u - pu, q.v - pv) - q.r > Math.min(best, lim)) continue;
      for (let i = 0; i < 4; i++) {
        const a = q.pts[i], c = q.pts[(i + 1) % 4], ex = c.u - a.u, ey = c.v - a.v, den = du * ey - dv * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a.u - pu) * ey - (a.v - pv) * ex) / den, s = ((a.u - pu) * dv - (a.v - pv) * du) / den;
        if (t > 0 && s >= 0 && s <= 1 && t < best) best = t;
      }
    }
    return best;
  };
  const out = { points: 0, rays: 0, escaped: 0, worst: [] };
  for (const li of CITY) {
    loadLevel(li);
    const B = level.bld.filter((o) => fault !== 'edge' || (o.layer !== 'belt' && o.layer !== 'ends'))
      .map((o) => ({ u: o.u, v: o.v, r: Math.hypot(o.w, o.l) / 2, pts: rectPts(o.u, o.v, o.w, o.l, o.yaw) }));
    const pts = [];
    if (li === CITY[0]) {
      const g = level.city.graph;
      for (const e of g.E) { const A = g.V[e.a], f = fuv(e.yaw), rt = ruv(e.yaw);
        for (let t = 0; t <= e.len; t += 10) for (const s of [-1, 1]) { const off = Math.max(1.6, e.hw - 1.65) * s; pts.push({ u: A.u + f.u * t + rt.u * off, v: A.v + f.v * t + rt.v * off }); } }
    }
    if (level.start) pts.push({ u: level.start.u, v: level.start.v });
    if (level.goal) pts.push({ u: level.goal.u, v: level.goal.v });
    for (const q of pts) {
      out.points++;
      for (let a = 0; a < 360; a += 2) {
        out.rays++;
        const d = rayHit(B, q.u, q.v, Math.sin(rad(a)), Math.cos(rad(a)), BLD_MAXD);
        if (d > BLD_MAXD) { out.escaped++; if (out.worst.length < 5) out.worst.push({ lvl: li + 1, u: +q.u.toFixed(1), v: +q.v.toFixed(1), a }); }
      }
    }
  }
  return out;
}, [CITY, FAULT]);
check('край мира не виден: из точек вдоль улиц и со стартов и целей уровней общей карты любой луч упирается в дом не дальше BLD_MAXD (@city-world-edge-hidden)',
  edge.points > 100 && edge.escaped === 0, JSON.stringify(edge));

/* ---- дома не стоят на улице, у знаков и светофоров, в карманах и на эстакаде ---- */
const clear = await page.evaluate(([CITY, fault]) => {
  const bad = [];
  let checked = 0;
  for (const li of CITY) {
    loadLevel(li);
    /* след сжат на 5 см: дома пояса стоят встык, и общая грань — касание, а не пересечение */
    const B = level.bld.map((o) => ({ o, p: rectPts(o.u, o.v, o.w - 0.1, o.l - 0.1, o.yaw) }));
    if (fault === 'bldclear' && li === CITY[0]) { const e = level.city.graph.E[0], A = level.city.graph.V[e.a], f = fuv(e.yaw);
      const u = A.u + f.u * e.len / 2, v = A.v + f.v * e.len / 2; B.push({ o: { u, v, w: 10, l: 12, yaw: e.yaw, layer: 'fault' }, p: rectPts(u, v, 10, 12, e.yaw) }); }
    const zones = [];
    const g = level.city.graph;
    for (const e of g.E) { const A = g.V[e.a], Bv = g.V[e.b];
      zones.push({ why: 'улица ' + e.name, p: rectPts((A.u + Bv.u) / 2, (A.v + Bv.v) / 2, 2 * (e.hw + BLD_SETBACK) - 0.1, e.len, e.yaw) }); }
    for (const id in g.V) { const V = g.V[id]; if (V.round) { const r = V.round + 14.9, p = []; for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; p.push({ u: V.u + Math.cos(a) * r, v: V.v + Math.sin(a) * r }); } zones.push({ why: 'кольцо ' + id, p }); } }
    for (const o of level.obs) {
      if (o.kind === 'light' || o.kind === 'sign' || o.kind === 'guide') zones.push({ why: o.kind, p: rectPts(o.u, o.v, (o.kind === 'guide' ? 2 * GUIDE_HW : o.w) + 2, o.l + 2, o.yaw) });
      if (o.kind === 'kerb' || o.kind === 'wall') zones.push({ why: o.kind, p: rectPts(o.u, o.v, o.w, o.l, o.yaw) });
    }
    for (const z of level.ramps || []) zones.push({ why: 'эстакада', p: [{ u: z.bb.u0, v: z.bb.v0 }, { u: z.bb.u1, v: z.bb.v0 }, { u: z.bb.u1, v: z.bb.v1 }, { u: z.bb.u0, v: z.bb.v1 }] });
    if (typeof EXAM_POCK !== 'undefined') for (const k in EXAM_POCK) for (const pk of [].concat(EXAM_POCK[k])) if (pk && pk.u !== undefined && pk.w) zones.push({ why: 'карман', p: rectPts(pk.u, pk.v, pk.w, pk.l, pk.yaw || 0) });
    for (let i = 0; i < B.length; i++) {
      checked++;
      for (const z of zones) if (polyMTV(B[i].p, 4, z.p, z.p.length)) { bad.push({ lvl: li + 1, bld: [+B[i].o.u.toFixed(1), +B[i].o.v.toFixed(1), B[i].o.layer], why: z.why }); break; }
      for (let j = i + 1; j < B.length; j++) if (polyMTV(B[i].p, 4, B[j].p, 4)) bad.push({ lvl: li + 1, bld: [+B[i].o.u.toFixed(1), +B[i].o.v.toFixed(1)], why: 'другой дом' });
    }
  }
  return { checked, bad: bad.slice(0, 6), n: bad.length };
}, [CITY, FAULT]);
check('дома не стоят на улицах, кольце, эстакаде, в карманах, на знаках, светофорах и указателях и не врезаются друг в друга (@city-buildings-clear)',
  clear.checked > 50 && clear.n === 0, JSON.stringify(clear));

/* ---- треугольники видимости пусты ---- */
const sight = await page.evaluate(([CITY, fault]) => {
  loadLevel(CITY[0]);
  const g = level.city.graph, tris = [];
  for (const id in g.V) {
    const V = g.V[id]; if (V.round) continue;
    const arms = [];
    for (const e of g.adj[id]) arms.push({ yaw: e.a === id ? e.yaw : angNorm(e.yaw + PI), hw: e.hw });
    arms.sort((a, b) => a.yaw - b.yaw);
    if (arms.length < 2) continue;
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i], b = arms[(i + 1) % arms.length];
      let gap = b.yaw - a.yaw; if (i === arms.length - 1) gap += TAU;
      if (gap < rad(20) || gap > rad(170)) continue;
      const da = fuv(a.yaw), ra = ruv(a.yaw), db = fuv(b.yaw), rb = ruv(b.yaw), ha = a.hw + KERB_OUT, hb = b.hw + KERB_OUT;
      const pu = V.u + ra.u * ha, pv = V.v + ra.v * ha, qu = V.u - rb.u * hb, qv = V.v - rb.v * hb;
      const det = -da.u * db.v + da.v * db.u; if (Math.abs(det) < 1e-6) continue;
      const t = (-(qu - pu) * db.v + (qv - pv) * db.u) / det, cu = pu + da.u * t, cv = pv + da.v * t;
      tris.push({ id, p: [{ u: cu, v: cv }, { u: cu + da.u * BLD_SIGHT, v: cv + da.v * BLD_SIGHT }, { u: cu + db.u * BLD_SIGHT, v: cv + db.v * BLD_SIGHT }] });
    }
  }
  const B = level.bld.map((o) => rectPts(o.u, o.v, o.w, o.l, o.yaw));
  if (fault === 'bldsight' && tris.length) { const t = tris[0].p, cu = (t[0].u + t[1].u + t[2].u) / 3, cv = (t[0].v + t[1].v + t[2].v) / 3; B.push(rectPts(cu, cv, 4, 4, 0)); }
  const bad = [];
  for (const T of tris) for (const p of B) if (polyMTV(p, 4, T.p, 3)) { bad.push(T.id); break; }
  return { triangles: tris.length, bad };
}, [CITY, FAULT]);
check('в треугольниках видимости перекрёстков (25 × 25 м, СП 42.13330) нет домов (@city-buildings-sight)',
  sight.triangles >= 8 && sight.bad.length === 0, JSON.stringify(sight));

/* ---- проход домов раньше уличного ---- */
const pass = await page.evaluate(([CITY, fault]) => {
  loadLevel(CITY[0]); doAct('start'); paused = true; opt.camMode = CAM_CHASE;
  const oF = flushFaces, oB = emitBuildings, oO = emitObstacles;
  let flushes = 0, main = false, bAt = -1, bFaces = 0, oAt = -1;
  window.flushFaces = function () { flushes++; return oF.apply(this, arguments); };
  if (fault === 'bldpass') {
    window.emitBuildings = function () {};
    window.emitObstacles = function () { if (VP.w === W) { const k = faces.length; oB.apply(this, []); bFaces = faces.length - k; bAt = flushes; } if (VP.w === W) oAt = flushes; return oO.apply(this, arguments); };
  } else {
    window.emitBuildings = function () { const k = faces.length; const r = oB.apply(this, arguments); if (VP.w === W) { bFaces = faces.length - k; bAt = flushes; } return r; };
    window.emitObstacles = function () { if (VP.w === W) oAt = flushes; return oO.apply(this, arguments); };
  }
  try { for (let i = 0; i < 3; i++) render(0.016); } finally { window.flushFaces = oF; window.emitBuildings = oB; window.emitObstacles = oO; }
  return { buildingFaces: bFaces, buildingsFlushedAt: bAt, obstaclesStartAt: oAt };
}, [CITY, FAULT]);
check('дома рисуются отдельным проходом раньше уличного: их грани сброшены до первой грани препятствий (@render-buildings-under-street)',
  pass.buildingFaces > 0 && pass.obstaclesStartAt > pass.buildingsFlushedAt, JSON.stringify(pass));

/* ---- дальний дом растворён в дымке ---- */
const fade = await page.evaluate((fault) => {
  const haze = [154, 172, 192], out = [];
  for (const col of [[156, 94, 74], [200, 196, 186], [142, 104, 84]]) {
    fogFar = fault !== 'fade';
    let s; try { s = shadeCol(col, { x: 0, y: 0, z: 1 }, BLD_MAXD - 2, 5, null); } finally { fogFar = false; }
    const m = s.match(/(\d+),(\d+),(\d+)/).slice(1).map(Number);
    out.push(+(Math.max(...m.map((v, i) => Math.abs(v - haze[i]))) / 255 * 100).toFixed(1));
  }
  return { diffPct: out };
}, FAULT);
check('дом у границы дальности растворён в дымке: отличие от её цвета не больше 6 %, дом не выскакивает (@render-buildings-fade)',
  fade.diffPct.every((d) => d <= 6), JSON.stringify(fade));

/* ---- внутри прохода домов нет перевёрнутых пар ---- */
const sort = await page.evaluate((CITY) => {
  const log = console.log; console.log = () => {};
  const out = [];
  try {
    for (const li of [CITY[0], CITY[Math.min(1, CITY.length - 1)]]) {
      loadLevel(li); doAct('start'); paused = true;
      opt.camMode = CAM_CHASE;
      for (const y of [0, 90, 180, 270]) { opt.camYaw = rad(y); for (let k = 0; k < 40; k++) render(0.016);
        const r = sortAudit({ top: 1 }), p = Object.values(r)[0].find((q) => q.main);
        out.push({ lvl: li + 1, cam: 'сзади ' + y, errors: p ? p.errors : -1 }); }
      opt.camYaw = 0; opt.camMode = CAM_FP;
      const r = sortAudit({ yaws: [0, -60, 60, 150], top: 1 });
      for (const k in r) { const p = r[k].find((q) => q.main); out.push({ lvl: li + 1, cam: 'салон ' + k, errors: p ? p.errors : -1 }); }
      opt.camMode = CAM_CHASE;
    }
  } finally { console.log = log; }
  return out;
}, CITY);
check('внутри прохода домов нет перевёрнутых пар граней — сзади и из салона (@render-buildings-sort)',
  sort.length && sort.every((r) => r.errors === 0), JSON.stringify(sort.filter((r) => r.errors !== 0).slice(0, 6)) + ` из ${sort.length} кадров`);

/* ---- поребрик: уровни, где его ставит kerbsFromAsphalt (23–32); общий город — один раз ---- */
/* KALL — все уровни с поребриком из генератора (столбы у каждого уровня свои: светофоры экзамена есть
   только на 32); KL — без повторов общего города для проверок самого поребрика */
const KALL = await page.evaluate(() => LEVELS.map((d, i) => i).filter((i) => !LEVELS[i].custom)
  .filter((i) => { loadLevel(i); return level.obs.some((o) => o.kind === 'kerb' && o.grp !== undefined); }));
const KL = KALL.filter((i) => i === CITY[0] || !CITY.includes(i));
const ASPH = `(() => level.dec.filter((d) => !d.line && d.fill === ASPHALT && d.pts && d.pts.length >= 3).map((d) => {
  let A = 0; for (let i = 0; i < d.pts.length; i++) { const p = d.pts[i], q = d.pts[(i + 1) % d.pts.length]; A += p.u * q.v - q.u * p.v; }
  return { P: d.pts, road: !!d.road, s: A > 0 ? 1 : -1 }; }))()`;

/* край асфальта каждые 0,25 м: снаружи на KERB_OUT стоит поребрик. Пропускаются концы рёбер и места, где
   граница переходит в устье (соседи в ±0,3 м тоже должны быть краем) — там стык решает геометрия, а не выборка */
const cont = await page.evaluate(([KL, fault, ASPH]) => {
  const out = { levels: 0, samples: 0, miss: 0, worst: [] };
  for (const li of KL) {
    loadLevel(li); out.levels++;
    const open = !(level.city && level.city.graph), A = eval(ASPH);
    let K = level.obs.filter((o) => o.kind === 'kerb');
    if (fault === 'kerbgap') K = K.filter((o, i) => i % 5 !== 2);
    const KR = K.map((o) => rectPts(o.u, o.v, o.w + 0.04, o.l + 0.04, o.yaw));
    const inA = (u, v, self) => A.some((g) => g !== self && polyHas(u, v, g.P));
    for (const g of A) for (let i = 0; i < g.P.length; i++) {
      if (open && g.road && (i === 0 || i === 2)) continue;
      const a = g.P[i], b = g.P[(i + 1) % g.P.length], L = Math.hypot(b.u - a.u, b.v - a.v);
      if (L < 0.7) continue;
      const tu = (b.u - a.u) / L, tv = (b.v - a.v) / L, nu = g.s > 0 ? tv : -tv, nv = g.s > 0 ? -tu : tu;
      const edge = (s) => !inA(a.u + tu * s + nu * 0.1, a.v + tv * s + nv * 0.1, g);
      for (let s = 0.3; s <= L - 0.3; s += 0.25) {
        if (!edge(s) || !edge(s - 0.3) || !edge(s + 0.3)) continue;
        out.samples++;
        const ku = a.u + tu * s + nu * KERB_OUT, kv = a.v + tv * s + nv * KERB_OUT;
        if (!KR.some((p) => polyHas(ku, kv, p))) { out.miss++; if (out.worst.length < 6) out.worst.push({ lvl: li + 1, u: +ku.toFixed(1), v: +kv.toFixed(1) }); }
      }
    }
  }
  return out;
}, [KL, FAULT, ASPH]);
check('каждый край асфальта города и уровней 23–26 закрыт поребриком, кроме устьев и открытых концов дорог 23–26 (@city-kerb-continuous)',
  cont.levels >= 5 && cont.samples > 3000 && cont.miss === 0, JSON.stringify(cont));

/* след поребрика (сжатый на 2 см) не лежит на асфальте; островок кольца — бордюр на газоне поверх диска, не в счёт */
const offc = await page.evaluate(([KL, fault, ASPH]) => {
  const out = { kerbs: 0, bad: [] };
  for (const li of KL) {
    loadLevel(li);
    const A = eval(ASPH), R = (level.city && level.city.rounds) || [];
    for (const o of level.obs) {
      if (o.kind !== 'kerb' || R.some((r) => Math.hypot(o.u - r.u, o.v - r.v) < r.rIn + 1)) continue;
      out.kerbs++;
      const w = (fault === 'kerbin' ? 1.2 : o.w) - 0.04, P = rectPts(o.u, o.v, w, o.l - 0.04, o.yaw);
      let hit = null;
      for (let i = 0; i < 4 && !hit; i++) { const a = P[i], b = P[(i + 1) % 4], L = Math.hypot(b.u - a.u, b.v - a.v), n = Math.max(1, Math.ceil(L / 0.1));
        for (let k = 0; k <= n && !hit; k++) { const u = a.u + (b.u - a.u) * k / n, v = a.v + (b.v - a.v) * k / n; if (A.some((g) => polyHas(u, v, g.P))) hit = { u: +u.toFixed(2), v: +v.toFixed(2) }; } }
      if (hit && out.bad.length < 6) out.bad.push({ lvl: li + 1, kerb: [+o.u.toFixed(1), +o.v.toFixed(1)], at: hit });
      else if (hit) out.bad.push(0);
    }
  }
  return { kerbs: out.kerbs, n: out.bad.length, bad: out.bad.slice(0, 6) };
}, [KL, FAULT, ASPH]);
check('поребрик не заходит на проезжую часть: след каждой коробки (минус 2 см) вне асфальта (@city-kerb-off-carriageway)',
  offc.kerbs > 100 && offc.n === 0, JSON.stringify(offc));

/* стойки светофоров, знаков и указателей — в 0,4 м за наружной гранью поребрика (lightKerbClear), не на нём */
const pole = await page.evaluate(([KL, fault]) => {
  const out = { poles: 0, min: 1e9, bad: [] };
  for (const li of KL) {
    loadLevel(li);
    const K = level.obs.filter((o) => o.kind === 'kerb');
    const P = level.obs.filter((o) => o.kind === 'light' || o.kind === 'sign' || o.kind === 'guide');
    if (fault === 'kerbpole' && P.length && K.length) { P[0] = { kind: P[0].kind, u: K[0].u, v: K[0].v }; }
    for (const o of P) {
      out.poles++;
      let best = 1e9;
      for (const k of K) { const f = fuv(k.yaw), r = ruv(k.yaw), du = o.u - k.u, dv = o.v - k.v;
        const lat = Math.abs(du * r.u + dv * r.v) - k.w / 2, lon = Math.abs(du * f.u + dv * f.v) - k.l / 2;
        best = Math.min(best, Math.hypot(Math.max(0, lat), Math.max(0, lon))); }
      out.min = Math.min(out.min, best);
      if (best < 0.39) out.bad.push({ lvl: li + 1, kind: o.kind, u: +o.u.toFixed(2), v: +o.v.toFixed(2), d: +best.toFixed(2) });
    }
  }
  return { poles: out.poles, min: +out.min.toFixed(2), n: out.bad.length, bad: out.bad.slice(0, 6) };
}, [KALL, FAULT]);
check('стойки светофоров, знаков и указателей стоят не ближе 0,4 м за поребриком (@city-kerb-furniture-clear)',
  pole.poles > 20 && pole.n === 0, JSON.stringify(pole));

check('страница без исключений', !errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
