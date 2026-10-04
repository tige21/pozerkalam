#!/usr/bin/env node
/* Гейт обустройства города (коды city-props-clear, city-props-sight-triangle, city-props-sightline,
   city-lawn-off-carriageway, city-stop-rules, city-ocs-wires, render-props-model; сценарии — specs/features/city/obustroystvo.feature,
   касания — specs/features/collision/obustroystvo.feature, их исполняет gherkin-run). Деревья, кусты,
   изгороди и фонари уровней общей карты (27–32) стоят за поребриком и не на нём, вне домов и стоек;
   в треугольниках видимости перекрёстков нет ничего выше 0,5 м, кроме тонких опор фонарей; из полос
   подхода к светофору, знаку и указателю ни ствол, ни крона, ни куст не перекрывают линию взгляда; газон
   не лежит на асфальте; модели Kenney читаются, а без шаблона деревья рисуются коробками с одним
   предупреждением. Проверки по геометрии, а не по пикселям: треугольники и линии взгляда инструмент
   считает сам, без помощников генератора.
     PW_DIR=/tmp/pw node tools/props-check.mjs
     FAULT=propclear|proptri|propsight|lawn|nomodel|stopnear|ocsfloat — сломать нарочно и увидеть красный:
       дерево на проезжей части; дерево в треугольнике видимости; без фильтра обустройства под знаки и
       светофоры уровня; газон сдвинут на асфальт; страница без моделей; остановка у цели уровня; конец
       поперечины контактной сети в 3 м от опоры
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

/* страница без моделей обустройства — копия index.html без шаблона props-mesh */
const MAIN = path.join(ROOT, 'index.html');
const NOMODEL = path.join(os.tmpdir(), `props-check-nomodel-${process.pid}.html`);
fs.writeFileSync(NOMODEL, fs.readFileSync(MAIN, 'utf8').replace(/<template id="props-mesh">[^<]*<\/template>/, ''));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
async function open(file) {
  const url = 'file://' + file + '?nocache=' + Date.now();
  const prep = await context.newPage();
  await prep.goto(url);
  await prep.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_gfx', 'max'); });
  await prep.close();
  const page = await context.newPage();
  const errors = [], warns = [];
  page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
  await page.goto(url + 'r');
  await page.waitForFunction(() => typeof LEVELS !== 'undefined' && typeof propModel !== 'undefined' && propModel.state !== 'off', null, { timeout: 20000 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  return { page, errors, warns };
}
const main = await open(FAULT === 'nomodel' ? NOMODEL : MAIN);
const { page } = main;

/* уровни общей карты — по признаку: у них в city граф улиц и обустройство */
const CITY = await page.evaluate(() => LEVELS.map((d, i) => [d, i]).filter(([d]) => !d.custom)
  .map(([, i]) => { loadLevel(i); return level.city && level.city.graph && level.props && level.props.length ? i : -1; }).filter((i) => i >= 0));

/* общие помощники в странице: треугольники видимости — заново из графа улиц, как в city-check */
await page.evaluate(() => {
  window.__pc = {
    tris() {
      const g = level.city.graph, out = [];
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
          out.push({ id, p: [{ u: cu, v: cv }, { u: cu + da.u * 25, v: cv + da.v * 25 }, { u: cu + db.u * 25, v: cv + db.v * 25 }] });
        }
      }
      return out;
    },
    /* след предмета на земле: у твёрдого — его касание (ствол, стойка, изгородь), у куста — крона */
    foot(p) {
      if (p.m === 'yard') return rectPts(p.u, p.v, p.w, p.l, p.yaw);
      if (p._col) return rectPts(p._col.u, p._col.v, 2 * p._col.hw, 2 * p._col.hl, p._col.yaw);
      const r = Math.max(0.2, p.cr * 0.85); return rectPts(p.u, p.v, 2 * r, 2 * r, 0);
    },
    /* выше 0,5 м — всё, кроме тонких опор и проводов на 6–7 м */
    tall(p) { return !p.m.startsWith('lamp') && p.m !== 'ocs' && p.m !== 'wire'; },
    asphalt() { return level.dec.filter((d) => d.fill === ASPHALT && d.pts).map((d) => d.pts); },
  };
});

/* ---- предметы за поребриком ---- */
const clear = await page.evaluate(([CITY, fault]) => {
  const out = { checked: 0, bad: [] };
  for (const li of CITY) {
    loadLevel(li);
    /* провода контактной сети висят над проезжей частью на 6–7 м — их проверяет @city-ocs-wires */
    const P = level.props.filter((p) => p.m !== 'wire');
    if (fault === 'propclear') { const e = level.city.graph.E[0], A = level.city.graph.V[e.a], f = fuv(e.yaw), q = { ...P.find((p) => p.m.startsWith('tree')) };
      q.u = A.u + f.u * e.len / 2; q.v = A.v + f.v * e.len / 2; q._col = { ...q._col, u: q.u, v: q.v }; P.push(q); }
    const AS = __pc.asphalt();
    const K = level.obs.filter((o) => o.kind === 'kerb');
    const POST = level.obs.filter((o) => o.kind === 'light' || o.kind === 'sign' || o.kind === 'guide');
    const B = level.obs.filter((o) => o.kind === 'bld').map((o) => rectPts(o.u, o.v, o.w, o.l, o.yaw));
    for (const p of P) {
      out.checked++;
      const F = __pc.foot(p), n = F.length, why = [];
      /* островок кольца — трава поверх асфальтового диска: асфальт там нарисован, но ездят вокруг */
      const isle = Object.values(level.city.graph.V).some((V) => V.round && Math.hypot(p.u - V.u, p.v - V.v) < V.round - 7.0);
      if (!isle) for (const a of AS) if (polyMTV(F, n, a, a.length)) { why.push('на асфальте'); break; }
      /* до поребрика: от следа до коробки; у твёрдого — не ближе 0,4 м, у куста — без наложения */
      let kd = 1e9;
      for (const k of K) { const f = fuv(k.yaw), r = ruv(k.yaw);
        for (const q of F) { const du = q.u - k.u, dv = q.v - k.v, lat = Math.abs(du * r.u + dv * r.v) - k.w / 2, lon = Math.abs(du * f.u + dv * f.v) - k.l / 2;
          kd = Math.min(kd, lat > 0 || lon > 0 ? Math.hypot(Math.max(0, lat), Math.max(0, lon)) : Math.max(lat, lon)); } }
      if (kd < (p._col ? 0.39 : 0)) why.push('у поребрика ' + kd.toFixed(2));
      for (const b of B) if (polyMTV(F, n, b, 4)) { why.push('в доме'); break; }
      for (const o of POST) if (Math.hypot(o.u - p.u, o.v - p.v) - (p.m === 'hedge' ? p.l / 2 : 0) < 1.0) { why.push('у стойки ' + o.kind); break; }
      if (why.length) out.bad.push({ lvl: li + 1, m: p.m, u: +p.u.toFixed(2), v: +p.v.toFixed(2), why: why.join(', ') });
    }
  }
  return { checked: out.checked, n: out.bad.length, bad: out.bad.slice(0, 6) };
}, [CITY, FAULT]);
check('деревья, кусты, изгороди и фонари стоят за поребриком (твёрдые — не ближе 0,4 м), не на асфальте, не в домах и не у стоек (@city-props-clear)',
  clear.checked > 300 && clear.n === 0, JSON.stringify(clear));

/* ---- треугольники видимости ---- */
const tri = await page.evaluate(([CITY, fault]) => {
  loadLevel(CITY[0]);
  const T = __pc.tris(), P = level.props.filter((p) => __pc.tall(p)).slice();
  if (fault === 'proptri' && T.length) { const t = T[0].p, q = { ...P.find((p) => p.m.startsWith('tree')) };
    q.u = (t[0].u + t[1].u + t[2].u) / 3; q.v = (t[0].v + t[1].v + t[2].v) / 3; q._col = { ...q._col, u: q.u, v: q.v }; P.push(q); }
  const bad = [];
  for (const p of P) { const F = __pc.foot(p); for (const t of T) if (polyMTV(F, F.length, t.p, 3)) { bad.push({ m: p.m, u: +p.u.toFixed(1), v: +p.v.toFixed(1), node: t.id }); break; } }
  return { triangles: T.length, tall: P.length, n: bad.length, bad: bad.slice(0, 6) };
}, [CITY, FAULT]);
check('в треугольниках видимости перекрёстков (25 × 25 м, СП 42.13330) нет деревьев, кустов и изгородей (@city-props-sight-triangle)',
  tri.triangles >= 8 && tri.tall > 50 && tri.n === 0, JSON.stringify(tri));

/* ---- линии взгляда на линзы, знаки и указатели ---- */
const sightline = await page.evaluate(([CITY, fault]) => {
  const EYE_Y = 1.22;
  /* ствол — цилиндр до низа кроны, крона — цилиндр от низа до верха; куст и изгородь — коробка до своей высоты */
  const blocks = (p, ax, ay, az, bx, by, bz) => {
    const shapes = [];
    if (p.m === 'wire') return false;
    if (p.m === 'hedge' || p.m === 'stop' || p.m === 'urn' || p.m === 'bench' || p.m === 'yard') shapes.push({ u: p.u, v: p.v, y0: 0, y1: p.h, box: true });
    else if (p.m.startsWith('lamp') || p.m === 'ocs') shapes.push({ u: p.u, v: p.v, r: 0.11, y0: 0, y1: p.h });
    else if (p.m === 'stopsign') { shapes.push({ u: p.u, v: p.v, r: 0.05, y0: 0, y1: SIGN_H }); shapes.push({ u: p.u, v: p.v, r: 0.36, y0: SIGN_H - 0.8, y1: SIGN_H }); }
    else { if (p.cy0 > 0.05) shapes.push({ u: p.u, v: p.v, r: (p._col ? p._col.hw : 0.15), y0: 0, y1: p.cy0 });
      shapes.push({ u: p.u, v: p.v, r: Math.max(0.3, p.cr * 0.9), y0: p.cy0, y1: p.h }); }
    for (const s of shapes) {
      for (let k = 0; k <= 40; k++) {
        const t = k / 40, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        if (y < s.y0 || y > s.y1) continue;
        if (s.box) { const f = fuv(p.yaw), r = ruv(p.yaw), du = x - p.u, dv = z - p.v;
          if (Math.abs(du * r.u + dv * r.v) <= p.w / 2 && Math.abs(du * f.u + dv * f.v) <= p.l / 2) return true; continue; }
        if (Math.hypot(x - s.u, z - s.v) <= s.r) return true;
      }
    }
    return false;
  };
  const out = { targets: 0, rays: 0, bad: [] };
  for (const li of CITY) {
    loadLevel(li);
    let P = level.props;
    if (fault === 'propsight') P = propsForLevel(level.city.props, []);
    const g = level.city.graph, AS = __pc.asphalt();
    /* глаз — только на асфальте: за тупиком или концом улицы водителя нет */
    const onRoad = (u, v) => AS.some((a) => { let ins = false; for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      if ((a[i].v > v) !== (a[j].v > v) && u < (a[j].u - a[i].u) * (v - a[i].v) / (a[j].v - a[i].v) + a[i].u) ins = !ins; } return ins; });
    const tg = [];
    for (const o of level.obs) {
      if (o.kind === 'light') for (let i = 0; i < 3; i++) tg.push({ o, y: LIGHT_H - 0.16 - i * 0.29 });
      else if (o.kind === 'sign') tg.push({ o, y: SIGN_H - 0.35 });
      else if (o.kind === 'guide') tg.push({ o, y: 2.8 });
    }
    for (const T of tg) {
      out.targets++;
      const o = T.o, f = fuv(o.yaw);
      /* полосы подхода: ось ближайшей улицы, полосы на стороне объекта */
      let best = null;
      for (const e of g.E) { const A = g.V[e.a], B = g.V[e.b], du = B.u - A.u, dv = B.v - A.v, L2 = du * du + dv * dv; if (L2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((o.u - A.u) * du + (o.v - A.v) * dv) / L2)), pu = A.u + du * t, pv = A.v + dv * t, d = Math.hypot(o.u - pu, o.v - pv);
        if (!best || d < best.d) best = { d, pu, pv, hw: e.hw, lanes: e.lanes, tram: e.tram }; }
      if (!best) continue;
      const nu = (o.u - best.pu) / (best.d || 1), nv = (o.v - best.pv) / (best.d || 1);
      const lat = []; for (let k = 0; k < best.lanes; k++) lat.push(best.hw - LANE_W * (k + 0.5));
      for (const d of [12, 20, 30, 40, 55]) for (const x of lat) {
        const eu = best.pu + nu * x + f.u * d, ev = best.pv + nv * x + f.v * d;
        if (!onRoad(eu, ev)) continue;
        out.rays++;
        for (const p of P) {
          if (Math.hypot(p.u - (eu + o.u) / 2, p.v - (ev + o.v) / 2) > d / 2 + 4) continue;
          if (blocks(p, eu, EYE_Y, ev, o.u, T.y, o.v)) {
            out.bad.push({ lvl: li + 1, kind: o.kind, at: [+o.u.toFixed(1), +o.v.toFixed(1)], from: d, m: p.m, p: [+p.u.toFixed(1), +p.v.toFixed(1)] }); break; }
        }
      }
    }
  }
  return { targets: out.targets, rays: out.rays, n: out.bad.length, bad: out.bad.slice(0, 6) };
}, [CITY, FAULT]);
/* ---- остановки: знак, павильон, зигзаг 1.17 и правило 15 м ---- */
const stops = await page.evaluate(([CITY, fault]) => {
  const out = { levels: 0, stops: 0, bad: [] };
  const keep = () => [...EXAM_POCK.lenS, ...EXAM_POCK.lenN, ...EXAM_POCK.sadW].map((p) => ({ u: p.u, v: p.v, l: Math.max(p.w, p.l), what: 'карман' }));
  for (const li of CITY) {
    loadLevel(li); out.levels++;
    const S = (level.city.stops || []).slice();
    const K = keep(); if (level.goal) K.push({ u: level.goal.u, v: level.goal.v, l: level.goal.l, what: 'цель' });
    if (fault === 'stopnear' && li === CITY[0] && level.goal) S.push({ ...S[0], u: level.goal.u, v: level.goal.v, sign: { u: level.goal.u, v: level.goal.v }, pav: S[0].pav });
    const zig = level.dec.filter((d) => d.fill === STOP_ZIG_COL && d.polys).flatMap((d) => d.polys);
    const g = level.city.graph;
    for (const st of S) {
      out.stops++;
      const why = [];
      if (!level.props.some((p) => p.m === 'stopsign' && Math.hypot(p.u - st.sign.u, p.v - st.sign.v) < 0.05 && p.pic === st.kind)) why.push('нет знака ' + (st.kind === 'bus' ? '5.16' : '5.17'));
      if (!level.props.some((p) => p.m === 'stop' && Math.hypot(p.u - st.pav.u, p.v - st.pav.v) < 0.05)) why.push('нет павильона');
      /* место остановки — от знака по ходу движения на длину зигзага (у трамвайной — до павильона) */
      const f = fuv(st.yaw), Lz = st.len || 10, A = st.sign, B = { u: A.u + f.u * Lz, v: A.v + f.v * Lz };
      if (st.kind === 'bus') {
        const inZone = zig.filter((P) => P.some((q) => { const a = (q.u - A.u) * f.u + (q.v - A.v) * f.v; return a > -1 && a < Lz + 1 && Math.abs((q.u - A.u) * f.v - (q.v - A.v) * f.u) < 4; }));
        if (inZone.length < Math.floor(Lz / 1.5) - 1) why.push('зигзаг 1.17: ' + inZone.length + ' штрихов');
      }
      /* сторона дороги — по оси ближайшей улицы: место у тротуара напротив не в счёт */
      let e0 = null, bd = 1e9;
      for (const e of g.E) { const P = g.V[e.a], Q = g.V[e.b], du = Q.u - P.u, dv = Q.v - P.v, L2 = du * du + dv * dv; if (L2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((A.u - P.u) * du + (A.v - P.v) * dv) / L2)), d = Math.hypot(A.u - P.u - du * t, A.v - P.v - dv * t); if (d < bd) { bd = d; e0 = { P, du, dv, L: Math.sqrt(L2) }; } }
      const side = (q) => ((q.u - e0.P.u) * e0.dv - (q.v - e0.P.v) * e0.du) / e0.L;
      for (const k of K) {
        if (Math.sign(side(k)) !== Math.sign(side(A)) || Math.abs(side(k)) > bd) continue;
        const du = B.u - A.u, dv = B.v - A.v, l2 = du * du + dv * dv, q = Math.max(0, Math.min(1, ((k.u - A.u) * du + (k.v - A.v) * dv) / l2));
        const d = Math.hypot(k.u - A.u - du * q, k.v - A.v - dv * q) - k.l / 2;
        if (d < 15) why.push(k.what + ' в ' + d.toFixed(1) + ' м');
      }
      if (why.length) out.bad.push({ lvl: li + 1, street: st.street, at: [+A.u.toFixed(1), +A.v.toFixed(1)], why: why.join(', ') });
    }
  }
  return { levels: out.levels, stops: out.stops, n: out.bad.length, bad: out.bad.slice(0, 6) };
}, [CITY, FAULT]);
check('у остановки есть знак 5.16, павильон и зигзаг 1.17, и до кармана экзамена или цели уровня на её стороне не меньше 15 м — ПДД 12.4 (@city-stop-rules)',
  stops.stops >= stops.levels * 4 && stops.n === 0, JSON.stringify(stops));

check('из полос подхода к светофору, знаку и указателю обустройство не перекрывает линию взгляда (@city-props-sightline)',
  sightline.targets > 20 && sightline.n === 0, JSON.stringify(sightline));

/* ---- контактная сеть: поперечины на опорах, контактный провод над осью пути ---- */
const ocs = await page.evaluate(([CITY, fault]) => {
  const out = { wires: 0, spans: 0, contact: 0, bad: [] };
  const li = CITY.find((i) => { loadLevel(i); return level.props.some((p) => p.m === 'wire'); });
  if (li === undefined) return { wires: 0, n: 1, bad: ['нет проводов'] };
  loadLevel(li);
  const W = level.props.filter((p) => p.m === 'wire').map((p) => ({ ...p, a: { ...p.a }, b: { ...p.b } }));
  if (fault === 'ocsfloat') W[0].a.u += 3;
  const poles = level.props.filter((p) => p.m === 'ocs');
  const trams = level.city.trams;
  for (const w of W) {
    out.wires++;
    const span = Math.abs(w.a.y - w.b.y) < 1e-6 && w.a.y > OCS_WIRE_Y + 0.5;
    if (span) {
      out.spans++;
      for (const e of [w.a, w.b]) if (!poles.some((p) => Math.hypot(p.u - e.u, p.v - e.v) < 0.05)) out.bad.push({ span: true, at: [+e.u.toFixed(1), +e.v.toFixed(1)], why: 'конец поперечины не на опоре' });
    } else {
      out.contact++;
      /* над осью пути: смещение от оси трамвайного полотна ±TRAM_HW/2 */
      for (const e of [w.a, w.b]) {
        const ok = trams.some((t) => { const f = fuv(t.yaw), r = ruv(t.yaw), du = e.u - t.u, dv = e.v - t.v, a = du * f.u + dv * f.v, x = du * r.u + dv * r.v;
          return Math.abs(a) <= t.len / 2 + 25 && Math.abs(Math.abs(x) - TRAM_HW / 2) < 0.05; });
        if (!ok) out.bad.push({ at: [+e.u.toFixed(1), +e.v.toFixed(1)], why: 'контактный провод не над путём' });
      }
      if (w.a.y < TRAM_H + 2) out.bad.push({ why: 'провод ниже ' + (TRAM_H + 2) + ' м' });
    }
  }
  return { lvl: li + 1, wires: out.wires, spans: out.spans, contact: out.contact, n: out.bad.length, bad: out.bad.slice(0, 6) };
}, [CITY, FAULT]);
check('контактная сеть Ленина: поперечины между опорами, контактный провод над осью каждого пути выше трамвая (@city-ocs-wires)',
  ocs.spans >= 3 && ocs.contact >= 4 && ocs.n === 0, JSON.stringify(ocs));

/* ---- газон вне асфальта ---- */
const lawn = await page.evaluate(([CITY, fault]) => {
  loadLevel(CITY[0]);
  let L = level.dec.filter((d) => d.fill === LAWN_COL && d.pts).map((d) => d.pts);
  if (fault === 'lawn') L = L.map((p, i) => i ? p : p.map((q) => ({ u: q.u * 0.8, v: q.v * 0.8 })));
  const AS = __pc.asphalt(), bad = [];
  for (const p of L) {
    const c = p.reduce((s, q) => ({ u: s.u + q.u / p.length, v: s.v + q.v / p.length }), { u: 0, v: 0 });
    const s = p.map((q) => ({ u: c.u + (q.u - c.u) * 0.98, v: c.v + (q.v - c.v) * 0.98 }));
    for (const a of AS) if (polyMTV(s, s.length, a, a.length)) { bad.push([+c.u.toFixed(1), +c.v.toFixed(1)]); break; }
  }
  return { lawns: L.length, metres: level.city.propStats.lawnM, n: bad.length, bad: bad.slice(0, 6) };
}, [CITY, FAULT]);
check('газон между поребриком и плиткой не заходит на асфальт (@city-lawn-off-carriageway)',
  lawn.lawns > 20 && lawn.metres > 500 && lawn.n === 0, JSON.stringify(lawn));

/* ---- модели и запасной вид ---- */
const drawn = async (pg) => pg.evaluate(([li]) => {
  loadLevel(li); hideOv(); paused = false; opt.camMode = CAM_CHASE; opt.mirrors = false;
  /* дерево на восточном газоне Ленина, машина в правой полосе в 10 м перед ним — дерево в кадре при любом порядке генератора */
  const t = level.props.find((p) => p.m.startsWith('tree') && Math.abs(p.u - 11.15) < 0.3) || level.props.find((p) => p.m.startsWith('tree'));
  setBody(8.15, t.v - 10, 0); car.vel = 0;
  let n = 0; const orig = emitProp;
  window.emitProp = function (o, cu, cv) { const f0 = faces.length; orig(o, cu, cv); n += faces.length - f0; };
  const t0 = performance.now();
  try { for (let i = 0; i < 4; i++) { if (i === 3) n = 0; frame(t0 + i * 16); } } finally { window.emitProp = orig; paused = true; }
  return { state: propModel.state, models: Object.keys(propModel.M).length, faces: n };
}, [CITY[0]]);
const mainDraw = await drawn(page);
const other = await open(NOMODEL);
const noDraw = await drawn(other.page);
const noWarn = other.warns.filter((w) => /\[assets\] обустройство/.test(w)).length;
check('модели Kenney читаются и рисуются; без шаблона деревья — коробками и одно предупреждение [assets] (@render-props-model)',
  mainDraw.state === 'ready' && mainDraw.models >= 9 && mainDraw.faces > 0 && noDraw.state === 'failed' && noDraw.faces > 0 && noWarn === 1,
  JSON.stringify({ main: mainDraw, nomodel: { ...noDraw, warns: noWarn } }));

check('страница без исключений', !main.errors.length && !other.errors.length, main.errors.concat(other.errors).slice(0, 3).join(' | '));
await browser.close();
fs.rmSync(NOMODEL, { force: true });
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
