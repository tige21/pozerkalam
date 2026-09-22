#!/usr/bin/env node
/* Проверка потока машин на городских уровнях. Поток живёт в frame(), поэтому проверять его
   в реальном времени — минуты на уровень; здесь страница держится на паузе, а actorsTick и
   game.t крутит сам инструмент: прогон детерминирован и занимает секунды.
   Валит прогон (код 1) на: машине вне проезжей части, машине на встречной половине, проезде
   на красный, наложении двух машин, застрявшей без причины и пустом потоке там, где он объявлен.
     PW_DIR=/tmp/pw node tools/traffic-check.mjs            # все уровни с traffic
     PW_DIR=/tmp/pw node tools/traffic-check.mjs 29 31      # индексы уровней, 0-based */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const ROOT = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECS = +(process.env.SECS || 120);
const { chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');
const cacheDir = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell')).sort().pop();
const BIN = path.join(cacheDir, shell, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');

const browser = await chromium.launch({ executablePath: BIN });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
let pageErr = null;
page.on('pageerror', e => { pageErr = e.message; });

const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
await page.goto(url);
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); });
await page.goto(url + '&r=1');
await page.waitForTimeout(400);

const asked = process.argv.slice(2).map(Number);
const levels = asked.length ? asked
  : await page.evaluate(() => LEVELS.map((d, i) => d.traffic ? i : -1).filter(i => i >= 0));

let bad = 0;
/* дальняя машина потока — упрощённый кузов, а не коробка: коробка на 20–32 м читалась
   ящиком и «превращалась» в машину на подъезде */
{
  const r = await page.evaluate(() => {
    loadLevel(LEVELS.findIndex(d => d.traffic)); hideOv(); paused = true;
    const cnt = f => { faces.length = 0; setCam({ x: -6, y: 3, z: -6 }, { x: 0, y: 0.7, z: 0 }, null, 60);
      f(); const n = faces.length; faces.length = 0; return n; };
    const a = level.actors.find(x => x.act);
    const far = { u: -cam.pos.x + 1e3, v: cam.pos.z };
    let low = 0; const L = emitCarLow; emitCarLow = (...x) => { low++; return L(...x); };
    const ou = a.u, ov = a.v; a.u = far.u; a.v = far.v;
    try { emitObstacles(1e4); } finally { emitCarLow = L; a.u = ou; a.v = ov; faces.length = 0; }
    return { called: low, lowF: cnt(() => emitCarLow(0, 0, 0.3, [200, 60, 60])),
      fullF: cnt(() => emitCarMesh(0, 0, 0.3, [200, 60, 60], 0, null)) };
  });
  const ok = r.called > 0 && r.lowF > 12 && r.lowF < r.fullF / 2;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'FAIL ') + 'дальняя машина потока — упрощённый кузов (@traffic-flow-lod) · граней '
    + r.lowF + ' против ' + r.fullF + (r.called ? '' : ' · emitCarLow не вызван'));
}
for (const li of levels) {
  const r = await page.evaluate(({ li, secs }) => {
    loadLevel(li); hideOv(); paused = true;
    const flow = level.actors.filter(a => a.act.flow);
    if (!flow.length) return { name: level.def.name, err: ['поток объявлен, но машин нет'] };
    const err = [], seen = {};
    /* одна строка на вид дефекта с худшим замером: иначе одно наложение печатается
       сотнями строк и прячет остальные проверки */
    const note = (k, val) => { const p = seen[k];
      /* отрицательное значение — «чем меньше, тем хуже»: храним худший замер */
      if (p === undefined || (val < 0 ? val > p : val > p)) seen[k] = val;
      if (p !== undefined && val < 0 && val < p) seen[k] = p; };
    const stuck = new Map(), crossed = new Map();
    const dt = 1 / 30, n = Math.round(secs / dt);
    let minGap = 99, vsum = 0, vn = 0, windows = 0;
    for (let k = 0; k < n; k++) {
      game.t += dt;
      actorsTick(dt);
      if (k % 3) continue;
      for (let i = 0; i < flow.length; i++) {
        const a = flow[i];
        vsum += a.act.v; vn++;
        /* на проезжей части и в своей половине. Внутри перекрёстка полос нет — там линию
           ведёт дуга, и привязка к соседнему лучу дала бы ложный «выезд на встречную» */
        if (level.city.graph) {
          const g = level.city.graph;
          let atNode = false;
          for (const id in g.V) { const N = g.V[id];
            if (Math.hypot(a.u - N.u, a.v - N.v) < (N.round || N.r) + 4) { atNode = true; break; } }
          const sn = atNode ? null : citySnap({ u: a.u, v: a.v });
          if (sn && !sn.ring) {
            const e = sn.e;
            if (sn.d > e.hw + 0.9) note('вне проезжей части  (@traffic-flow-lane)' + e.name, sn.d);
            const f = fuv(a.yaw), rt = ruv(e.yaw), ef = fuv(e.yaw);
            const lat = (a.u - sn.u) * rt.u + (a.v - sn.v) * rt.v;
            const dir = f.u * ef.u + f.v * ef.v;
            /* справа по ходу: едущий «по» ребру держит lat>0, едущий «против» — lat<0 */
            if (Math.abs(dir) > 0.7 && Math.abs(lat) > 0.6 && Math.sign(lat) !== Math.sign(dir))
              note('встречная половина  (@traffic-flow-oncoming)' + e.name, +lat.toFixed(1));
          }
        } else if (Math.abs(Math.abs(a.v) - 1.65) > 0.9 && Math.abs(a.u) < 56) {
          note('вне полосы двора', +a.v.toFixed(1));
        }
        /* красный свет */
        for (const sl of (level.city.stoplines || [])) {
          if (!sl.light) continue;
          const lf = fuv(sl.yaw), f = fuv(a.yaw);
          if (f.u * lf.u + f.v * lf.v < 0.6) continue;
          const s = (a.u - sl.u) * lf.u + (a.v - sl.v) * lf.v;
          const lr = ruv(sl.yaw);
          if (Math.abs((a.u - sl.u) * lr.u + (a.v - sl.v) * lr.v) > sl.w / 2) continue;
          const key = i + '@' + sl.u + ',' + sl.v;
          const was = crossed.get(key);
          if (was !== undefined && was < -0.3 && s > 0.3 && lightStops(sl.light))
            note('проезд на красный (@traffic-flow-red)', 1);
          crossed.set(key, s);
        }
        /* наложение кузовов считаем тем же satMTV, что и игроку: встречные расходятся в
           3,3 м (ширина полосы), а по расстоянию между центрами это читалось бы как удар,
           и наоборот — две машины под 120° касаются углами задолго до 4,4 м */
        for (let j = i + 1; j < flow.length; j++) {
          const b = flow[j];
          const d = Math.hypot(b.u - a.u, b.v - a.v);
          if (d < minGap) minGap = d;
          const m = satMTV({ u: a.u, v: a.v, hw: HALF_W, hl: HALF_L, yaw: a.yaw },
                           { u: b.u, v: b.v, hw: HALF_W, hl: HALF_L, yaw: b.yaw });
          if (m) note('кузова наложились на, м (@traffic-flow-gap)', m.depth.toFixed(2));
        }
        /* застряла без причины */
        const blocked = trafBlock(a, level.actors.indexOf(a)) < TRAF.see || trafLight(a) < TRAF.see;
        const st = (a.act.v < 0.2 && !blocked) ? (stuck.get(i) || 0) + dt * 3 : 0;
        stuck.set(i, st);
        if (st > 20) note('машина стоит без помехи, с (@traffic-flow-stuck)', Math.round(st));
      }
      /* окно для выезжающего: сколько раз за прогон путь игрока свободен дольше 3 с */
      if (k % 90 === 0 && !flow.some(a => Math.hypot(a.u - level.start.u, a.v - level.start.v) < 18)) windows++;
    }
    return { name: level.def.name, cars: flow.length,
      err: err.concat(Object.keys(seen).map(k => k + ': ' + Math.abs(seen[k]))),
      vavg: +(vsum / vn).toFixed(2), minGap: +minGap.toFixed(1), windows };
  }, { li, secs: SECS });

  const ok = !r.err.length && !pageErr;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'FAIL ') + r.name + ' · машин ' + (r.cars ?? 0)
    + ' · сред. скорость ' + (r.vavg ?? '-') + ' м/с · мин. дистанция ' + (r.minGap ?? '-') + ' м'
    + ' · окон ' + (r.windows ?? 0)
    + (r.err.length ? '\n     ' + r.err.join('\n     ') : ''));
  if (pageErr) { console.log('     PAGEERR ' + pageErr); pageErr = null; }
}
await browser.close();
process.exit(bad ? 1 : 0);
