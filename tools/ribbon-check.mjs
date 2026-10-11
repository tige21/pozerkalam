#!/usr/bin/env node
/* Гейт ленты маршрута экзамена (план speed-limits-ribbon, Ф1). Владелец: «у фиолетовой линии кривая
   траектория особенно на перекрестках». Аккуратный водитель (tools/practice-bot.js) проезжает маршруты из
   графа в тренировочном режиме, а гейт после каждого кадра смотрит на ленту, которую видит игрок:
   - гладкость: на любых 2 м пути курс меняется не больше чем на 35° (машина на полном руле делает 30°:
     радиус 3,84 м), и нигде нет шипа — разворота больше 150° на 4 м;
   - устойчивость: лента впереди машины от кадра к кадру не двигается больше чем на 0,5 м, пока этап и
     маршрут те же — лента, которая перекраивается под колёсами на перекрёстке, и была «кривой».
   Первый метр от машины не меряется: там лента сводится с машины на полосу.

     PW_DIR=/tmp/pw node tools/ribbon-check.mjs
     FAULT=rebuild|tightarc PW_DIR=/tmp/pw node tools/ribbon-check.mjs   # каждая проверка обязана покраснеть

   Код 1 — хоть одна проверка не прошла. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || null;
const SEEDS = (process.env.SEEDS || '1007,11,23,42,77,5,9,31').split(',').map(Number);
let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

const url = process.env.URL || 'file://' + path.join(ROOT, 'index.html');
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'].concat(process.env.HOST_RULES ? ['--host-resolver-rules=' + process.env.HOST_RULES] : []) });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 30000 });
await page.evaluate(() => { try { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1'); } catch (e) {} });
/* evaluate, а не addScriptTag: CSP прода режет инлайновый <script> без хэша */
await page.evaluate(fs.readFileSync(path.join(HERE, 'practice-bot.js'), 'utf8'));
await page.evaluate((fault) => {
  /* rebuild — прежняя лента: каждые 0,35 с путь заново от машины; tightarc — дуга угла радиусом полполосы */
  if (fault === 'rebuild') { const f = window.examLegTick; window.examLegTick = function (dt) { if (exam && (exam.legT || 0) - (dt || 0) <= 0) exam.path = null; return f(dt); }; }
  if (fault === 'tightarc') window.RIBBON_RMIN = LANE_W / 2;
}, FAULT);

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };

const r = await page.evaluate((seeds) => {
  const STEP = 0.25, W = 8;
  const resample = (P) => { const o = [P[0]]; for (let i = 1; i < P.length; i++) { let a = o[o.length - 1]; const b = P[i]; let d = Math.hypot(b.u - a.u, b.v - a.v);
    while (d >= STEP) { const t = STEP / d; a = { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }; o.push(a); d = Math.hypot(b.u - a.u, b.v - a.v); } } return o; };
  const hd = (a, b) => Math.atan2(b.u - a.u, b.v - a.v);
  const dang = (x) => (x * 180 / Math.PI + 540) % 360 - 180;
  const segDist = (p, a, b) => { const du = b.u - a.u, dv = b.v - a.v, L2 = du * du + dv * dv || 1e-9, t = Math.max(0, Math.min(1, ((p.u - a.u) * du + (p.v - a.v) * dv) / L2));
    return Math.hypot(p.u - a.u - du * t, p.v - a.v - dv * t); };
  const polyDist = (p, P) => { let m = 1e9; for (let i = 1; i < P.length; i++) m = Math.min(m, segDist(p, P[i - 1], P[i])); return m; };
  const out = { snaps: 0, kinks: [], spikes: [], moves: [], done: 0, runs: 0 };
  for (const seed of seeds) {
    let prev = null;
    const sim = window.simTick;
    window.simTick = function (dt) {
      sim(dt);
      if (!exam || !exam.leg || !exam.leg.pts || exam.leg.pts.length < 3) return;
      const L = exam.leg, c = bodyPos();
      if (L === (prev && prev.leg)) return;
      const Q = resample(L.pts);
      out.snaps++;
      /* гладкость: от 1 м после машины до конца ленты */
      for (let i = 4 + W; i < Q.length - W; i++) {
        const a = Math.abs(dang(hd(Q[i], Q[i + W]) - hd(Q[i - W], Q[i])));
        if (a > 35) { out.kinks.push({ seed, t: +game.t.toFixed(1), st: exam.stage, at: { u: +Q[i].u.toFixed(1), v: +Q[i].v.toFixed(1) }, deg: Math.round(a) }); break; }
      }
      for (let i = 4 + 2 * W; i < Q.length - 2 * W; i++) {
        const a = Math.abs(dang(hd(Q[i], Q[i + 2 * W]) - hd(Q[i - 2 * W], Q[i])));
        if (a > 150) { out.spikes.push({ seed, t: +game.t.toFixed(1), st: exam.stage, at: { u: +Q[i].u.toFixed(1), v: +Q[i].v.toFixed(1) } }); break; }
      }
      /* устойчивость: прошлая лента впереди машины (5–50 м по ней) лежит на новой, если этап и маршрут те же */
      if (prev && prev.route === exam.route && prev.stage === exam.stage) {
        let s = 0, worst = 0, wp = null;
        for (let i = 1; i < prev.Q.length; i++) { s += STEP;
          const p = prev.Q[i]; if (Math.hypot(p.u - c.u, p.v - c.v) < 5) continue; if (s > 50) break;
          const d = polyDist(p, Q); if (d > worst) { worst = d; wp = p; } }
        if (worst > 0.5) out.moves.push({ seed, t: +game.t.toFixed(1), st: exam.stage, at: { u: +wp.u.toFixed(1), v: +wp.v.toFixed(1) }, m: +worst.toFixed(2) });
      }
      prev = { leg: L, Q, route: exam.route, stage: exam.stage };
    };
    const res = examDrive(seed, { mode: 'train', maxT: 300 });
    window.simTick = sim;
    out.runs++; if (res.done && !res.failed) out.done++;
  }
  return out;
}, SEEDS);

const ex = (a) => a.slice(0, 3).map((x) => `зерно ${x.seed} ${x.t} с этап ${x.st} у (${x.at.u}, ${x.at.v})${x.deg ? ' ' + x.deg + '°' : ''}${x.m ? ' ' + x.m + ' м' : ''}`).join('; ');
check('лента маршрута гладкая: нет излома круче 35° на 2 м и шипа с разворотом (@exam-ribbon-smooth)',
  r.kinks.length === 0 && r.spikes.length === 0 && r.snaps > 50,
  `кадров с новой лентой ${r.snaps}, изломов ${r.kinks.length}, шипов ${r.spikes.length}` + (r.kinks.length + r.spikes.length ? ' — ' + ex(r.kinks.concat(r.spikes)) : ''));
check('лента впереди машины не перекраивается от кадра к кадру больше чем на 0,5 м (@exam-ribbon-stable)',
  r.moves.length === 0 && r.snaps > 50, `сдвигов ${r.moves.length}` + (r.moves.length ? ' — ' + ex(r.moves) : '') + `; маршрутов пройдено ${r.done} из ${r.runs}`);
if (r.done < r.runs) check('бот проходит маршруты с новой лентой', false, `${r.done} из ${r.runs}`);
if (pageErrors.length) check('страница без исключений', false, pageErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
