#!/usr/bin/env node
/* Гейт дорожной разметки по ГОСТ Р 51256 (коды city-marking-gost, city-marking-approach, city-marking-arrows,
   city-marking-clear, render-marking-world; сценарии — specs/features/city/razmetka.feature).
   Числа берутся из ГОСТа, а не из констант игры: 1.1 — 0,10 м; 1.2 — 0,20 м у края проезжей части;
   1.3 — две по 0,10 через 0,10; 1.5 — штрих 3 м, разрыв 9 м; 1.6 — 6 и 2 м на 30 м перед сплошной;
   1.18 — стрелки по разрешённым направлениям. Нарисованное (многоугольники разметки в level.dec)
   сверяется со смыслом линий из меты улиц (edges/solid — их же читают детекторы): лишняя краска,
   пропущенная линия, неверный штрих одинаково валят гейт.
     PW_DIR=/tmp/pw node tools/marking-check.mjs
     FAULT=gost|approach|arrowdir|arrowlane|arrowtip|screen — сломать нарочно и увидеть красный:
       штрих 1.5 — 2 м; без линии приближения; стрелки «во все стороны»; стрелки на полосу левее;
       стрелки на 6 м дальше от узла (в карман экзамена); разметка экранным штрихом в 2 px, как до 04.10.2026
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

/* поломки ставятся до первой сборки уровней: город собирается заново на каждом loadLevel */
await page.evaluate((fault) => {
  if (fault === 'gost') MARK_GOST['1.5'].dash = 2;
  if (fault === 'approach') { const o = roadDec2; window.roadDec2 = function (dec, u, v, yaw, len, r) { const a = r._apprA, b = r._apprB; delete r._apprA; delete r._apprB; try { return o.apply(this, arguments); } finally { if (a) r._apprA = a; if (b) r._apprB = b; } }; }
  if (fault === 'arrowdir') { const o = markArrow; window.markArrow = function (m, tu, tv, h) { return o(m, tu, tv, h, ['L', 'S', 'R']); }; }
  if (fault === 'arrowlane') { const o = markArrow; window.markArrow = function (m, tu, tv, h, set) { const r = ruv(h); return o(m, tu - r.u * LANE_W, tv - r.v * LANE_W, h, set); }; }
  if (fault === 'arrowtip') { const o = markArrow; window.markArrow = function (m, tu, tv, h, set) { const f = fuv(h); return o(m, tu - f.u * 3.5, tv - f.v * 3.5, h, set); }; }
  /* улицы уровней 23–26 своей геометрии меты не отдают — их куски записываются при сборке */
  const oR = roadDec; window.__roads = null;
  window.roadDec = function (dec, u, v, yaw, len, hw) { if (window.__roads) window.__roads.push({ u, v, yaw, len, hw, edges: [-hw, 0, hw], solid: [false, false, false], lanes: 1 }); return oR.apply(this, arguments); };
}, FAULT);

/* уровни с городской разметкой: общая карта (мета улиц в city.lanes) и уровни 23–26 (куски roadDec) */
const LV = await page.evaluate(() => {
  const out = [];
  LEVELS.forEach((d, i) => {
    if (d.custom) return;
    window.__roads = []; loadLevel(i); const own = window.__roads; window.__roads = null;
    const metas = (level.city && level.city.lanes || []).filter((m) => m.kind === 'lanes');
    if (metas.length || own.length) out.push({ i, graph: !!(level.city && level.city.graph), own: own.length });
  });
  return out;
});

/* ---- геометрия линий по ГОСТ и совпадение с метой ---- */
const gost = await page.evaluate((LV) => {
  const G = { edge: 0.20, single: 0.10, dbl: 0.10, dblGap: 0.10, d15: [3, 9], d16: [6, 2], app: 30 };
  const out = { pieces: 0, lines: 0, dashes: 0, zones: [], bad: [] };
  const bad = (m) => { if (out.bad.length < 10) out.bad.push(m); };
  for (const { i, graph } of LV) {
    window.__roads = []; loadLevel(i); const own = window.__roads; window.__roads = null;
    const metas = graph ? level.city.lanes.filter((m) => m.kind === 'lanes') : own;
    /* краска, на которую позже лёг асфальт (квадрат перекрёстка 23–26, следующая улица), не видна и не считается */
    const MP = [];
    level.dec.forEach((d, j) => { if (d.polys && d.fill === MARK_COL) for (const P of d.polys) MP.push({ P, j }); });
    const covered = (p, j) => level.dec.some((d, k) => k > j && d.fill === ASPHALT && d.pts && polyHas(p.u, p.v, d.pts));
    /* голубые контуры карманов экзамена — учебная подсказка, не разметка */
    if (level.dec.some((d) => d.line && !/125,216,255/.test(d.stroke))) bad(`L${i + 1}: на уровне осталась экранная линия`);
    const AR = (level.city && level.city.arrows) || [];
    const inArrow = (p) => AR.some((a) => { const f = fuv(a.yaw), r = ruv(a.yaw), du = p.u - a.u, dv = p.v - a.v, y = du * f.u + dv * f.v, x = du * r.u + dv * r.v; return y < 0.3 && y > -3.3 && Math.abs(x) < 1.1; });
    const ends = (m) => { const f = fuv(m.yaw); return { A: { u: m.u - f.u * m.len / 2, v: m.v - f.v * m.len / 2 }, B: { u: m.u + f.u * m.len / 2, v: m.v + f.v * m.len / 2 } }; };
    for (const m of metas) {
      out.pieces++;
      const f = fuv(m.yaw), rt = ruv(m.yaw), s0 = -m.len / 2, s1 = m.len / 2;
      const loc = (p) => ({ s: (p.u - m.u) * f.u + (p.v - m.v) * f.v, x: (p.u - m.u) * rt.u + (p.v - m.v) * rt.v });
      /* линия приближения ожидается там, где улица продолжается через свободную точку куском со сплошной */
      const zone = {};
      const E = ends(m);
      if (graph) for (const q of metas) {
        if (q === m || Math.abs(Math.cos(m.yaw - q.yaw)) < 0.94) continue;
        const Q = ends(q);
        for (const [end, P] of [['A', E.A], ['B', E.B]]) for (const [qe, QP] of [['A', Q.A], ['B', Q.B]]) {
          if (Math.hypot(P.u - QP.u, P.v - QP.v) > 0.15) continue;
          const same = end !== qe;
          m.edges.forEach((x) => {
            if (Math.abs(Math.abs(x) - m.hw) < 1e-6 || m.solid[m.edges.indexOf(x)]) return;
            if (end === 'B' ? x < 0 : x > 0) return;
            const xo = same ? x : -x, k = q.edges.findIndex((e) => Math.abs(e - xo) < 1e-6);
            if (k >= 0 && q.solid[k]) zone[x] = end === 'B' ? [s1 - G.app, s1] : [s0, s0 + G.app];
          });
        }
      }
      /* ожидаемые линии: кромки — у края, сплошные — по мете, двойная — осевая при 2+ полосах в сторону */
      const want = [];
      m.edges.forEach((x, k) => {
        if (Math.abs(Math.abs(x) - m.hw) < 1e-6) { want.push({ x, kind: 'edge', w: G.edge }); return; }
        if (m.tram && x === 0) return;
        if (m.solid[k]) {
          if (x === 0 && m.lanes >= 2) want.push({ x: x - (G.dbl + G.dblGap) / 2, kind: 'solid', w: G.dbl }, { x: x + (G.dbl + G.dblGap) / 2, kind: 'solid', w: G.dbl });
          else want.push({ x, kind: 'solid', w: G.single });
          return;
        }
        want.push({ x, kind: 'dash', w: G.single, zone: zone[x] || null });
      });
      if (Object.keys(zone).length) out.zones.push({ L: i + 1, name: m.name, x: Object.keys(zone).map(Number) });
      /* краска куска: многоугольники целиком внутри прямоугольника улицы, кроме стрелок */
      const strips = [];
      for (const { P, j } of MP) {
        const L = P.map(loc);
        if (L.some((q) => Math.abs(q.x) > m.hw + 0.01 || q.s < s0 - 0.01 || q.s > s1 + 0.01)) continue;
        const c = P.reduce((a, q) => ({ u: a.u + q.u / P.length, v: a.v + q.v / P.length }), { u: 0, v: 0 });
        if (inArrow(c) || P.every((q) => covered(q, j))) continue;
        const x0 = Math.min(...L.map((q) => q.x)), x1 = Math.max(...L.map((q) => q.x)), a = Math.min(...L.map((q) => q.s)), b = Math.max(...L.map((q) => q.s));
        strips.push({ xc: (x0 + x1) / 2, w: x1 - x0, a, b, j });
      }
      if (m.tram && strips.some((q) => Math.abs(q.xc) < TRAM_HW - 0.1)) bad(`L${i + 1} ${m.name || ''}: краска на трамвайном полотне`);
      const byLine = want.map(() => []);
      for (const q of strips) {
        /* кромка ищется у края, на асфальте; остальное — точно на своей границе полос */
        const k = want.findIndex((w) => w.kind === 'edge' ? Math.sign(q.xc) === Math.sign(w.x) && Math.abs(q.xc) <= m.hw - q.w / 2 + 0.005 && Math.abs(q.xc) >= m.hw - 0.4 : Math.abs(q.xc - w.x) < 0.03);
        if (k < 0) { bad(`L${i + 1} ${m.name || ''}: краска вне линий меты x=${q.xc.toFixed(2)} s=${q.a.toFixed(1)}…${q.b.toFixed(1)}`); continue; }
        if (Math.abs(q.w - want[k].w) > 0.006) bad(`L${i + 1} ${m.name || ''}: ширина ${q.w.toFixed(3)} м у линии x=${want[k].x.toFixed(2)} (${want[k].kind}), по ГОСТ ${want[k].w}`);
        byLine[k].push(q);
      }
      want.forEach((w, k) => {
        out.lines++;
        const S = byLine[k].sort((p, q) => p.a - q.a), D = [];
        for (const q of S) { const l = D[D.length - 1]; if (l && q.a - l.b < 0.01) l.b = Math.max(l.b, q.b); else D.push({ a: q.a, b: q.b }); }
        const tag = `L${i + 1} ${m.name || ''} x=${w.x.toFixed(2)} ${w.kind}`;
        if (!D.length) { bad(`${tag}: линии нет`); return; }
        if (w.kind !== 'dash') {
          /* каждые 5 см сплошной — краска или асфальт перекрёстка поверх неё */
          const j0 = S[0].j, at = (t) => ({ u: m.u + f.u * t + rt.u * w.x, v: m.v + f.v * t + rt.v * w.x });
          let gap = null;
          for (let t = s0 + 0.03; t < s1 - 0.03 && gap === null; t += 0.05) if (!D.some((d) => t >= d.a - 0.005 && t <= d.b + 0.005) && !covered(at(t), j0)) gap = t;
          if (gap !== null) bad(`${tag}: сплошная с разрывом у s=${gap.toFixed(2)}`);
          return;
        }
        out.dashes += D.length;
        const zn = (d) => w.zone && (d.a + d.b) / 2 >= w.zone[0] && (d.a + d.b) / 2 <= w.zone[1];
        for (let j = 0; j < D.length; j++) {
          const d = D[j], z = zn(d), [dl, gl] = z ? G.d16 : G.d15, len = d.b - d.a;
          const clipped = d.a < s0 + 0.02 || d.b > s1 - 0.02;
          if (len > dl + 0.02 || (!clipped && Math.abs(len - dl) > 0.02)) bad(`${tag}: штрих ${len.toFixed(2)} м (${z ? '1.6' : '1.5'}, по ГОСТ ${dl})`);
          if (j) {
            const g = d.a - D[j - 1].b, zp = zn(D[j - 1]);
            if (z === zp && Math.abs(g - gl) > 0.02) bad(`${tag}: разрыв ${g.toFixed(2)} м (${z ? '1.6' : '1.5'}, по ГОСТ ${gl})`);
            if (z !== zp && g < G.d16[1] - 0.02) bad(`${tag}: штрихи 1.5 и 1.6 слились (разрыв ${g.toFixed(2)} м)`);
          }
        }
        if (w.zone) {
          const Z = D.filter(zn);
          if (Z.length < 3 || Z.some((d) => Math.abs(d.b - d.a - G.d16[0]) > 0.02 && d.a > s0 + 0.02 && d.b < s1 - 0.02)) bad(`${tag}: нет линии приближения 1.6 (${Z.length} штрихов в зоне)`);
        }
      });
    }
  }
  return out;
}, LV);
check('линии городских уровней 23–32 — полосками в метрах по ГОСТ Р 51256 (1.1, 1.2, 1.3, 1.5), каждая — на своей границе из меты, лишней краски нет (@city-marking-gost)',
  gost.pieces >= 30 && gost.lines >= 100 && gost.dashes >= 200 && !gost.bad.length,
  JSON.stringify({ pieces: gost.pieces, lines: gost.lines, dashes: gost.dashes, bad: gost.bad }));

/* ---- линия приближения перед сплошной ---- */
const appr = await page.evaluate((LV) => {
  const out = { zones: 0, ok: 0, bad: [] };
  for (const { i, graph } of LV) {
    if (!graph) continue;
    loadLevel(i);
    const metas = level.city.lanes.filter((m) => m.kind === 'lanes');
    const MP = level.dec.filter((d) => d.polys && d.fill === MARK_COL).flatMap((d) => d.polys);
    for (const m of metas) {
      const f = fuv(m.yaw), rt = ruv(m.yaw), s0 = -m.len / 2, s1 = m.len / 2;
      for (const q of metas) {
        if (q === m || Math.abs(Math.cos(m.yaw - q.yaw)) < 0.94) continue;
        const fq = fuv(q.yaw);
        for (const [end, sE] of [['A', s0], ['B', s1]]) {
          const P = { u: m.u + f.u * sE, v: m.v + f.v * sE };
          for (const [qe, sQ] of [['A', -q.len / 2], ['B', q.len / 2]]) {
            const QP = { u: q.u + fq.u * sQ, v: q.v + fq.v * sQ };
            if (Math.hypot(P.u - QP.u, P.v - QP.v) > 0.15) continue;
            m.edges.forEach((x, k) => {
              if (Math.abs(Math.abs(x) - m.hw) < 1e-6 || m.solid[k] || (end === 'B' ? x < 0 : x > 0)) return;
              const xo = end !== qe ? x : -x, kq = q.edges.findIndex((e) => Math.abs(e - xo) < 1e-6);
              if (kq < 0 || !q.solid[kq]) return;
              out.zones++;
              /* штрихи 6 м у самой сплошной: последний кончается на стыке, всего в 30 м — четыре */
              const D = [];
              for (const Pp of MP) {
                const L = Pp.map((p) => ({ s: (p.u - m.u) * f.u + (p.v - m.v) * f.v, x: (p.u - m.u) * rt.u + (p.v - m.v) * rt.v }));
                if (L.some((p) => Math.abs(p.x - x) > 0.08)) continue;
                const a = Math.min(...L.map((p) => p.s)), b = Math.max(...L.map((p) => p.s));
                if (end === 'B' ? b > s1 - 30.01 : a < s0 + 30.01) D.push([a, b]);
              }
              const six = D.filter(([a, b]) => Math.abs(b - a - 6) < 0.02);
              const atEnd = D.some(([a, b]) => end === 'B' ? Math.abs(b - s1) < 0.02 : Math.abs(a - s0) < 0.02);
              if (six.length >= 4 && atEnd) out.ok++;
              else if (out.bad.length < 6) out.bad.push({ L: i + 1, name: m.name, x, end, dashes6: six.length, atEnd });
            });
          }
        }
      }
    }
  }
  return out;
}, LV);
check('перед каждой сплошной, которой продолжается пунктир, — линия приближения 1.6: штрихи 6 м через 2 м на последних 30 м (@city-marking-approach)',
  appr.zones >= 6 && appr.ok === appr.zones, JSON.stringify(appr));

/* ---- стрелки 1.18 по полосам ---- */
const arrows = await page.evaluate((LV) => {
  const out = { nodes: 0, arrows: 0, bad: [] };
  const bad = (m) => { if (out.bad.length < 8) out.bad.push(m); };
  const painted = (MP, p) => MP.some((P) => polyHas(p.u, p.v, P));
  for (const { i, graph } of LV) {
    if (!graph) continue;
    loadLevel(i);
    const c = level.city, g = c.graph, MP = level.dec.filter((d) => d.polys && d.fill === MARK_COL).flatMap((d) => d.polys);
    const lanes = c.lanes.filter((m) => m.kind === 'lanes');
    for (const id in g.V) {
      const V = g.V[id], arms = g.adj[id];
      if (V.round || arms.length < 3 || id.startsWith('@')) continue;
      out.nodes++;
      for (const e of arms) {
        const out_ = e.a === id ? e.yaw : e.yaw + Math.PI, h = angNorm(out_ + Math.PI), av = new Set();
        for (const o of arms) { if (o === e) continue; const ob = o.a === id ? o.yaw : o.yaw + Math.PI, rel = angNorm(ob - h);
          av.add(Math.abs(rel) < rad(32) ? 'S' : rel > 0 ? 'R' : 'L'); }
        const mine = c.arrows.filter((a) => a.node === id && Math.abs(angNorm(a.yaw - h)) < 0.05);
        const n = e.lanes, union = new Set(mine.flatMap((a) => a.dirs));
        /* стрелка (3 м) с зазором от узла не помещается на перемычку короче 6 м — там стрелок нет */
        const piece = e.len - V.r - g.V[e.a === id ? e.b : e.a].r;
        if (piece < 6) { if (mine.length) bad(`L${i + 1} ${id} ${e.name}: стрелка на перемычке ${piece.toFixed(1)} м`); continue; }
        if ([...av].some((d) => !union.has(d)) || [...union].some((d) => !av.has(d))) bad(`L${i + 1} ${id} ${e.name}: стрелки ${[...union].join('')}, разрешено ${[...av].join('')}`);
        const f = fuv(h), r = ruv(h), b0 = e.tram ? TRAM_HW : 0;
        for (const a of mine) {
          out.arrows++;
          if (n > 1 && a.dirs.includes('L') && a.lane !== 1) bad(`L${i + 1} ${id}: налево не из левой полосы`);
          if (n > 1 && a.dirs.includes('R') && a.lane !== n) bad(`L${i + 1} ${id}: направо не из правой полосы`);
          /* стрелка — в своей полосе и на асфальте своей улицы, остриё в 1–4 м от заплатки узла */
          const lat = (a.u - V.u) * r.u + (a.v - V.v) * r.v, cen = b0 + LANE_W * (a.lane - 0.5);
          if (Math.abs(lat - cen) > 0.05) bad(`L${i + 1} ${id} ${e.name}: стрелка полосы ${a.lane} не по центру полосы (${lat.toFixed(2)} вместо ${cen.toFixed(2)})`);
          const dTip = -((a.u - V.u) * f.u + (a.v - V.v) * f.v) - V.r;
          if (dTip < 1 || dTip > 4) bad(`L${i + 1} ${id} ${e.name}: остриё в ${dTip.toFixed(2)} м от заплатки узла`);
          const P = (x, y) => ({ u: a.u + r.u * x + f.u * y, v: a.v + r.v * x + f.v * y });
          if (!lanes.some((m) => { const fm = fuv(m.yaw), rm = ruv(m.yaw), q = P(0, -3), s = (q.u - m.u) * fm.u + (q.v - m.v) * fm.v, x = (q.u - m.u) * rm.u + (q.v - m.v) * rm.v; return Math.abs(s) <= m.len / 2 && Math.abs(x) <= m.hw; })) bad(`L${i + 1} ${id}: хвост стрелки не на улице`);
          /* рисунок = мета: наконечник прямо, отвод влево, отвод вправо — краска есть ровно там, где направление разрешено */
          const S = painted(MP, P(0, -0.35)), Lb = [-1.4, -1.6, -1.8, -2.0].some((y) => painted(MP, P(-0.7, y))), Rb = [-1.4, -1.6, -1.8, -2.0].some((y) => painted(MP, P(0.7, y)));
          const stem = painted(MP, P(0, -2.6));
          if (!stem || S !== a.dirs.includes('S') || Lb !== a.dirs.includes('L') || Rb !== a.dirs.includes('R'))
            bad(`L${i + 1} ${id} ${e.name} полоса ${a.lane}: нарисовано ${stem ? '' : 'без стебля '}${S ? 'S' : ''}${Lb ? 'L' : ''}${Rb ? 'R' : ''}, в мете ${a.dirs.join('')}`);
        }
      }
    }
  }
  return out;
}, LV);
check('стрелки 1.18 у каждого узла общей карты: по направлениям, которые есть у узла, налево — из левой полосы, направо — из правой, нарисованное совпадает с метой (@city-marking-arrows)',
  arrows.nodes >= 6 && arrows.arrows >= 20 && !arrows.bad.length, JSON.stringify(arrows));

/* ---- стрелки не ложатся на стоп-линии, зебры и карманы экзамена ---- */
const clear = await page.evaluate((LV) => {
  const out = { arrows: 0, bad: [] };
  const rect = (u, v, yaw, hw, hl) => { const f = fuv(yaw), r = ruv(yaw); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ u: u + f.u * hl * a + r.u * hw * b, v: v + f.v * hl * a + r.v * hw * b })); };
  /* выпуклые многоугольники разделены с запасом pad, если есть ось, на которой их проекции не сходятся */
  const sep = (A, B, pad) => {
    for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], nx = q.v - p.v, ny = p.u - q.u, l = Math.sqrt(nx * nx + ny * ny);
      if (l < 1e-9) continue;
      const pr = (X) => X.map((s) => (s.u * nx + s.v * ny) / l), a = pr(A), b = pr(B);
      if (Math.max(...a) + pad < Math.min(...b) || Math.max(...b) + pad < Math.min(...a)) return true;
    }
    return false;
  };
  const pockets = [];
  for (const k in EXAM_POCK) for (const p of EXAM_POCK[k]) pockets.push({ k, R: rect(p.u, p.v, 0, p.w / 2, p.l / 2) });
  for (const { i, graph } of LV) {
    if (!graph) continue;
    loadLevel(i);
    const c = level.city;
    /* нарисованные стрелки: пачка разметки, в которой есть треугольник наконечника */
    const AP = level.dec.filter((d) => d.polys && d.fill === MARK_COL && d.polys.some((P) => P.length === 3)).flatMap((d) => d.polys);
    out.arrows += c.arrows.length; out.polys = (out.polys || 0) + AP.length;
    const near = (P, u, v, r) => P.some((q) => Math.hypot(q.u - u, q.v - v) < r);
    for (const A of AP) {
      for (const s of c.stoplines || []) if (near(A, s.u, s.v, s.w + 4) && !sep(A, rect(s.u, s.v, s.yaw, s.w / 2, 0.2), 0.5)) out.bad.push(`L${i + 1}: стрелка у стоп-линии (${s.u.toFixed(1)}, ${s.v.toFixed(1)}) ближе 0,5 м`);
      for (const z of c.zebras || []) if (near(A, z.u, z.v, z.w + 4) && !sep(A, rect(z.u, z.v, z.yaw, z.w / 2, z.halfLen), 0.5)) out.bad.push(`L${i + 1}: стрелка на зебре`);
      for (const p of pockets) if (!sep(A, p.R, 0.3)) out.bad.push(`L${i + 1}: стрелка в кармане экзамена ${p.k}`);
      for (const r of c.rounds || []) if (near(A, r.u, r.v, r.rOut + 1)) out.bad.push(`L${i + 1}: стрелка на кольце`);
    }
  }
  out.bad = [...new Set(out.bad)].slice(0, 8);
  return out;
}, LV);
check('стрелки не лежат на стоп-линиях, зебрах, кольце и в карманах остановки экзамена (@city-marking-clear)',
  clear.arrows >= 20 && clear.polys >= clear.arrows * 3 && !clear.bad.length, JSON.stringify(clear));

/* ---- линия на экране — полоска в метрах: ширина падает с дальностью, как у самой дороги ---- */
const world = await page.evaluate((fault) => {
  loadLevel(28); doAct('start'); paused = true; opt.camMode = CAM_CHASE; opt.mirrors = false; opt.refs = 0; opt.marks = false; opt.guides = false;
  if (fault === 'screen') {
    /* как было до 04.10.2026: каждая полоска — экранный штрих 2 px по своей оси */
    const add = [];
    level.dec = level.dec.filter((d) => {
      if (!(d.polys && d.fill === MARK_COL)) return true;
      for (const P of d.polys) if (P.length === 4) add.push({ line: true, stroke: MARK_COL, lw: 2, pts: [{ u: (P[0].u + P[3].u) / 2, v: (P[0].v + P[3].v) / 2 }, { u: (P[1].u + P[2].u) / 2, v: (P[1].v + P[2].v) / 2 }] });
      return false;
    });
    level.dec.push(...add); decBounds(level.dec);
  }
  /* штрихи межполосной линии попутного направления: по обе стороны асфальт, не бордюр и не рельсы */
  const dashedX = (q) => q.edges.find((x, k) => x > (q.tram ? TRAM_HW + 0.01 : 0.01) && Math.abs(x - q.hw) > 1e-6 && !q.solid[k]);
  const m = level.city.lanes.filter((q) => q.kind === 'lanes' && dashedX(q) !== undefined).sort((p, q) => q.len - p.len)[0];
  const f = fuv(m.yaw), rt = ruv(m.yaw), xl = dashedX(m);
  const sCar = m.len / 2 - 38;
  const dash = [];
  for (const d of level.dec) if (d.polys && d.fill === MARK_COL) for (const P of d.polys) {
    const L = P.map((q) => ({ s: (q.u - m.u) * f.u + (q.v - m.v) * f.v, x: (q.u - m.u) * rt.u + (q.v - m.v) * rt.v }));
    if (L.every((q) => Math.abs(q.x - xl) < 0.08 && Math.abs(q.s) <= m.len / 2)) dash.push((Math.min(...L.map((q) => q.s)) + Math.max(...L.map((q) => q.s))) / 2);
  }
  const xc = m.hw - 1.65;
  setBody(m.u + f.u * sCar + rt.u * xc, m.v + f.v * sCar + rt.v * xc, m.yaw); car.vel = 0; opt.camYaw = m.yaw; camSm = null;
  for (let k = 0; k < 4; k++) render(0.016);
  const cv = document.getElementById('view'), sc = cv.width / W, g = cv.getContext('2d'), out = [];
  /* контур грани раздвигается наружу на EXPAND_DEV px устройства с каждой стороны (закрывает щели сглаживания) */
  const grow = 2 * EXPAND_DEV / sc;
  for (const sd of dash.filter((t) => t - sCar > 3 && t - sCar < 33).sort((p, q) => p - q)) {
    /* по слепку основного вида: к концу render() `cam` может стоять на другом проходе */
    const P = (x) => { const u = m.u + f.u * sd + rt.u * x, v = m.v + f.v * sd + rt.v * x, C = viewCam;
      const dx = -u - C.pos.x, dy = 0.02 - C.pos.y, dz = v - C.pos.z, k = C.scale / (dx * C.f.x + dy * C.f.y + dz * C.f.z);
      return { x: C.cx + (dx * C.r.x + dy * C.r.y + dz * C.r.z) * k, y: C.cy - (dx * C.u.x + dy * C.u.y + dz * C.u.z) * k }; };
    const a = P(xl - 0.05), b = P(xl + 0.05), c = P(xl);
    const want = Math.abs(b.x - a.x), y = Math.round(c.y * sc), x0 = Math.round((c.x - want - 10) * sc), x1 = Math.round((c.x + want + 10) * sc);
    const px = g.getImageData(x0, y, x1 - x0, 1).data, lum = [];
    for (let k = 0; k < px.length; k += 4) lum.push(0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]);
    const base = Math.min(...lum), top = Math.max(...lum), thr = base + (top - base) * 0.5;
    const got = lum.filter((l) => l > thr).length / sc;
    out.push({ street: m.name, d: +(sd - sCar).toFixed(1), want: +(want + grow).toFixed(1), got: +got.toFixed(1), contrast: +(top - base).toFixed(0), at: [Math.round(c.x), Math.round(c.y)] });
  }
  return out;
}, FAULT);
const wN = world[0], wF = world[world.length - 1];
const wOk = world.length >= 3 && world.every((r) => r.contrast > 40 && Math.abs(r.got - r.want) <= Math.max(1.2, r.want * 0.25)) && wN.got - wF.got >= 0.6 * (wN.want - wF.want) && wN.want - wF.want > 2;
check('разметка на экране — полоска в метрах: штрихи 1.5 в 3–33 м от машины шириной с проекцию 0,10 м (±25 %, не меньше 1,2 px), ближний шире дальнего, как требует перспектива (@render-marking-world)', wOk, JSON.stringify(world));

check('страница без исключений', !errors.length, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok);
await browser.close();
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
