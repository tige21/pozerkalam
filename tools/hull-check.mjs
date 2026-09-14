#!/usr/bin/env node
/* Габариты: касание обязано наступать ровно тогда, когда кузова коснулись, а не раньше.
   Столкновения считались по прямоугольнику 4,42 × 1,80, а кузов спереди и сзади сужается
   (нос на z=2,21 шириной 1,48 м), поэтому углы прямоугольника висели вне металла и
   «соприкосновение» засчитывалось за 2–9 см до контакта — владелец видел это как «кривые
   габариты». Здесь для набора курсов ищется бинарным поиском первое положение, которое
   игра считает касанием, и меряется настоящий зазор между следами кузовов.

   Заодно проверяется, что машина не проваливается сквозь стену: уменьшение фигуры
   столкновения не должно открыть дорогу насквозь.

   Зависимость — playwright-core в PW_DIR (как у cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/hull-check.mjs
     PW_DIR=/tmp/pw URL=https://pozerkalam.space/play/ node tools/hull-check.mjs
   Код 1, если хоть один зазор больше GAP_MAX или машина зашла за стену глубже 1 см. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const GAP_MAX = 0.01;          /* 1 см — предел, дальше это уже видно на текстурах */

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

const url = process.env.URL || 'file://' + path.join(ROOT, 'index.html');
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).split('\n')[0]));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 20000 });

const report = await page.evaluate((GAP_MAX) => {
  const rows = [];
  const hullPts = (u, v, th) => {
    const f = fuv(th), r = ruv(th);
    return CAR_HULL.map(h => ({ u: u + f.u * h.z + r.u * h.lat, v: v + f.v * h.z + r.v * h.lat }));
  };
  const segDist = (a, b, c, d) => {
    const pd = (p, q, r) => {
      const du = r.u - q.u, dv = r.v - q.v, L2 = du * du + dv * dv || 1;
      const t = Math.max(0, Math.min(1, ((p.u - q.u) * du + (p.v - q.v) * dv) / L2));
      return Math.hypot(p.u - (q.u + du * t), p.v - (q.v + dv * t));
    };
    return Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
  };
  const polyDist = (P, Q) => {
    let m = 1e9;
    for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++)
      m = Math.min(m, segDist(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length]));
    return m;
  };
  /* касание спрашиваем у САМОЙ игры: resolveCollisions ставит защёлку o._touch — иначе
     проверка щупала бы вспомогательные функции и пережила бы откат самой правки */
  const hit = (cu, cv, th, O) => {
    level.obs.length = 0; level.obs.push(O);
    O._touch = false; setBody(cu, cv, th); car.vel = 0; game.hitCd = 1;
    resolveCollisions(1 / 60);
    return !!O._touch;
  };
  const probe = (tag, thDeg, O) => {
    const th = rad(thDeg);
    let lo = -14, hi = 0;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (hit(O.u, O.v + mid, th, O)) hi = mid; else lo = mid;
    }
    const shape = O.kind === 'car' ? hullPts(O.u, O.v, O.yaw) : rectPts(O.u, O.v, O.w, O.l, O.yaw);
    const gap = polyDist(hullPts(O.u, O.v + hi, th), shape);
    rows.push({ tag, th: thDeg, gap: +gap.toFixed(4), ok: gap <= GAP_MAX });
  };

  loadLevel(0); hideOv();
  const wall = { kind: 'wall', u: 0, v: 10, w: 14, l: 0.5, h: 2.6, hw: 7, hl: 0.25, yaw: 0,
                 solid: true, col: [168, 166, 166] };
  const nb = { kind: 'car', u: 0, v: 0, w: CAR.width, l: CAR.length, h: CAR.height,
               hw: HALF_W, hl: HALF_L, yaw: 0, solid: true, col: [90, 90, 90] };
  for (const a of [0, 4, 8, 12, 20, 30, 45, 60, 90, 120, 160, 180, 200, 250, 300]) probe('стена', a, wall);
  for (const a of [0, 10, 25, 45, 90, 180, 200, 270]) probe('машина', a, nb);

  /* сквозь стену проехать по-прежнему нельзя */
  const through = [];
  for (const [thDeg, speed] of [[0, 5.5], [25, 5.5], [0, 1.2]]) {
    loadLevel(0); hideOv(); paused = false;
    const W = { kind: 'wall', u: 0, v: 14, w: 20, l: 0.6, h: 2.6, yaw: 0, solid: true,
                col: [168, 166, 166], hw: 10, hl: 0.3, _touch: false };
    level.obs.length = 0; level.obs.push(W);
    setBody(0, 0, rad(thDeg)); car.vel = speed; car.gear = 1; car.sel = 'D'; car.steer = 0;
    game.hits = 0; game.hitCd = 0;
    for (let i = 0; i < 360; i++) {
      car.vel = Math.max(car.vel, speed * 0.6);
      let rem = 1 / 60; while (rem > 1e-5) { const s = Math.min(1 / 120, rem); stepCar(s); rem -= s; }
      resolveCollisions(1 / 60); game.hitCd = Math.max(0, game.hitCd - 1 / 60);
    }
    const c = bodyPos(), f = fuv(car.th), r = ruv(car.th);
    let deep = -1e9;
    for (const h of CAR_HULL) deep = Math.max(deep, (c.v + f.v * h.z + r.v * h.lat) - (W.v - W.hl));
    through.push({ th: thDeg, speed, deep: +deep.toFixed(4), ok: deep <= 0.01 });
  }
  loadLevel(0);
  return { rows, through, hull: CAR_HULL.length };
}, GAP_MAX);

let bad = 0;
for (const r of report.rows) {
  if (!r.ok) { bad++; console.log(`FAIL · ${r.tag} ${r.th}°: касание за ${(r.gap * 100).toFixed(1)} см до кузова`); }
}
for (const t of report.through) {
  if (!t.ok) { bad++; console.log(`FAIL · упор в стену (${t.th}°, ${t.speed} м/с): зашёл на ${(t.deep * 100).toFixed(1)} см`); }
}
const worst = report.rows.reduce((m, r) => r.gap > m.gap ? r : m, report.rows[0]);
console.log(`след кузова: ${report.hull} вершин · худший зазор ${(worst.gap * 100).toFixed(2)} см (${worst.tag} ${worst.th}°)`);
console.log(bad ? `hull-check: нарушений ${bad}` : `hull-check: всё зелено (${report.rows.length} курсов + ${report.through.length} упоров)`);
if (pageErrors.length) { console.log('исключения на странице:\n' + pageErrors.join('\n')); bad++; }
await browser.close();
process.exit(bad ? 1 : 0);
