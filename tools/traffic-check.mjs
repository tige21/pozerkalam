#!/usr/bin/env node
/* Проверка потока машин на городских уровнях. Поток живёт в frame(), поэтому проверять его
   в реальном времени — минуты на уровень; здесь страница держится на паузе, а actorsTick и
   game.t крутит сам инструмент: прогон детерминирован и занимает секунды.
   Валит прогон (код 1) на: машине вне проезжей части, машине на встречной половине, проезде
   на красный, наложении двух машин, застрявшей без причины и пустом потоке там, где он объявлен.
     PW_DIR=/tmp/pw node tools/traffic-check.mjs            # все уровни с traffic
     PW_DIR=/tmp/pw node tools/traffic-check.mjs 29 31      # индексы уровней, 0-based
     FAULT=kerbflow — поребрик поперёк пути первой машины: @city-kerb-flow-clear обязан покраснеть
     FAULT=noboxrule — поток без правила коробок (п. 13.2, 14.4): @traffic-flow-box-clear на уроке пробки красный
     FAULT=honkheld — гудок без проверки «игрок стоит по делу»: @traffic-honk-held красный
     FAULT=nojam — урок пробки без колонны: @traffic-jam-column красный
     FAULT=noring — въезжающий на кольцо не уступает круговому: на «часе пик» @traffic-flow-no-gridlock красный
   Главный прогон идёт без игрока на дороге: стоящая у старта машина игрока держала бы очередь потока весь
   прогон, и проверка мёртвой пробки (@traffic-flow-no-gridlock) читала бы это как сцепку */
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
/* TRAFFIC=heavy — гонять поток на заданной ступени: без этого гейт видел только «обычный»,
   а ступень «час пик» появилась бы слепой (пробки и наложения живут именно там) */
const TRAFFIC = process.env.TRAFFIC || '';
if (TRAFFIC) await page.evaluate(k => { if (!TRAF_SPACING[k]) throw new Error('нет ступени ' + k); opt.traffic = k; }, TRAFFIC);
const FAULT = process.env.FAULT || '';
await page.evaluate(f => { if (f === 'noboxrule') TRAF_BOX = false; if (f === 'noring') TRAF_RING = false; if (f === 'honkheld') playerHeld = () => false; }, FAULT);

const asked = process.argv.slice(2).map(Number);
const levels = asked.length ? asked
  : await page.evaluate(() => LEVELS.map((d, i) => d.traffic ? i : -1).filter(i => i >= 0));

let bad = 0;
/* дальняя машина потока — упрощённый кузов, а не коробка: коробка на 20–32 м читалась
   ящиком и «превращалась» в машину на подъезде */
{
  const r = await page.evaluate(() => {
    loadLevel(LEVELS.findIndex(d => d.traffic)); hideOv(); paused = true;
    const cnt = f => { faces.length = 0; setCam({ x: -6, y: 3, z: -6 }, { x: 0, y: 0.7, z: 0 }, null, 60); lodSync();
      f(); const n = faces.length; faces.length = 0; return n; };
    const a = level.actors.find(x => x.act);
    /* дальняя машина — по направлению взгляда, за TRAF_LOD: в 1000 м вбок она за пирамидой взгляда,
       и отсечение (camSees) по праву её не рисует */
    setVP(0, 0, W, H); setCam({ x: -6, y: 3, z: -6 }, { x: 0, y: 0.7, z: 0 }, null, 60); lodSync();
    const far = { u: -(cam.pos.x + cam.f.x * 90), v: cam.pos.z + cam.f.z * 90 };
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

/* гудок: игрок стоит в полосе перед машиной потока — через 3 с тишина, через 8 с ровно один
   сигнал (машина ≈3,3 с тормозит, ожидание идёт со стоянки), к 11 с повтора ещё нет. Игрок — в 20 м:
   поток идёт 30 км/ч, и с 9 м машина (тормозной путь 11,9 м плюс зазор 6,2) встать не успевала */
{
  const r = await page.evaluate(() => {
    loadLevel(LEVELS.findIndex(d => d.traffic)); hideOv(); paused = true;
    const a = level.actors.find(x => x.act && x.act.flow && x.act.rt); if (!a) return null;
    /* впереди игрока пусто: гудок — тому, кто держит пустую дорогу; на уровне 26 в 11 м по петле стоит
       статист урока, и игрок за ним стоит по делу (@traffic-honk-held) */
    let at = 20;
    for (const d of [20, 26, 32, 40, 50]) { const q = trafPose(a.act.rt, a.act.s + d, { u: 0, v: 0, yaw: 0 });
      setBody(q.u, q.v, q.yaw); if (!playerHeld()) { at = d; break; } }
    const p = trafPose(a.act.rt, a.act.s + at, { u: 0, v: 0, yaw: 0 });
    setBody(p.u, p.v, p.yaw); car.vel = 0; car.sel = 'D';
    let n = 0; const H = honk; honk = () => { n++; };
    const step = (secs) => { const dt = 1 / 30; for (let k = 0; k < Math.round(secs / dt); k++) { game.t += dt; actorsTick(dt); } };
    /* машина сначала тормозит с 8,3 м/с (≈3,3 с), ожидание считается со стоянки: гудок в 7–8 с */
    /* ожидание считается со стоянки машины потока: точка постановки игрока зависит от того, где впереди
       пусто, и время подъезда меняется — гудок мерим от остановки: через 3 с тишина, через 5 — один, через 8 — всё ещё один */
    try { for (let k = 0; k < 15 * 30 && !(a.act.v < 0.3 && a.act.waitT > 0); k++) { game.t += 1 / 30; actorsTick(1 / 30); }
      step(3); const at3 = n; step(2); const at6 = n; step(3); const at9 = n; return { at3, at6, at9, v: +a.act.v.toFixed(2), waitT: +(a.act.waitT || 0).toFixed(1) }; }
    finally { honk = H; }
  });
  const ok = r && r.at3 === 0 && r.at6 === 1 && r.at9 === 1;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'FAIL ') + 'машина потока гудит игроку, стоящему в её полосе (@traffic-honk-wait)'
    + (r ? ' · гудков через 3/5/8 с после остановки: ' + r.at3 + '/' + r.at6 + '/' + r.at9 + ' · скорость ' + r.v + ' · ожидание ' + r.waitT + ' с' : ' · машина потока не найдена'));
  if (pageErr) { console.log('     PAGEERR ' + pageErr); pageErr = null; }
}
/* гудок не для очереди: игрок стоит в 2 м за стоящей машиной, сзади подъезжает поток — 12 с тишины.
   Без проверки «игрок стоит по делу» машина сзади сигналила каждые 7 с за честное ожидание в пробке */
{
  const r = await page.evaluate(() => {
    loadLevel(LEVELS.findIndex(d => d.traffic)); hideOv(); paused = true;
    const a = level.actors.find(x => x.act && x.act.flow && x.act.rt); if (!a) return null;
    const p = trafPose(a.act.rt, a.act.s + 20, { u: 0, v: 0, yaw: 0 });
    setBody(p.u, p.v, p.yaw); car.vel = 0; car.sel = 'D';
    const q = trafPose(a.act.rt, a.act.s + 20 + 2 * HALF_L + 2, { u: 0, v: 0, yaw: 0 });
    const o = pcar(q.u, q.v, 0, PALETTE[2]); o.yaw = q.yaw; o.hw = o.w / 2; o.hl = o.l / 2;
    o.act = { started: false, done: false, flow: false, v: 0, s: 0, sp: 0, trig: () => false };
    level.actors.push(o);
    let n = 0; const H = honk; honk = () => { n++; };
    try { for (let k = 0; k < 12 * 30; k++) { game.t += 1 / 30; actorsTick(1 / 30); }
      return { n, gap: +demoTrafficGap(8).toFixed(1), waitT: +(a.act.waitT || 0).toFixed(1) }; }
    finally { honk = H; level.actors.pop(); }
  });
  const ok = r && r.n === 0;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'FAIL ') + 'игроку в очереди не гудят (@traffic-honk-held)'
    + (r ? ' · гудков за 12 с: ' + r.n + ' · до машины впереди ' + r.gap + ' м' : ' · машина потока не найдена'));
  if (pageErr) { console.log('     PAGEERR ' + pageErr); pageErr = null; }
}
/* урок пробки: на старте квартал N1–N2 стоит колонной в обе полосы, а за 3 минуты вся колонна впереди проходит N2 и
   уходит со сцены — затор живой, а не вечный. FAULT=nojam — урок без колонны */
{
  const r = await page.evaluate((fault) => {
    const li = LEVELS.findIndex(d => /^33 ·/.test(d.name)); if (li < 0) return null;
    if (fault === 'nojam') { const B = LEVELS[li].build; LEVELS[li].build = function () { const b = B.call(this); b.jam = null; return b; }; loadLevel(li); LEVELS[li].build = B; }
    else loadLevel(li);
    hideOv(); paused = true;
    const jam = level.actors.filter(a => a.act && a.act.jam);
    const block = jam.filter(a => a.v > -60 && a.v < -12 && a.u > 3 && a.u < 10).length;
    const ahead = jam.filter(a => a.v > -60);
    setBody(1e4, 1e4, 0); car.vel = 0;
    /* «ушла» — проехала последний узел своего пути (дальше exitS) или ушла со сцены */
    const passed = new Set();
    const dt = 1 / 30; for (let k = 0; k < 180 * 30; k++) { game.t += dt; actorsTick(dt);
      for (const a of ahead) if (a.act.done || a.act.s >= a.act.exitS) passed.add(a); }
    return { block, ahead: ahead.length, left: passed.size };
  }, FAULT);
  if (r) {
    const ok = r.block >= 12 && r.ahead > 0 && r.left === r.ahead;
    if (!ok) bad++;
    console.log((ok ? 'OK   ' : 'FAIL ') + 'урок пробки: колонна в квартале N1–N2 и уходит за 3 мин (@traffic-jam-column) · в квартале '
      + r.block + ' · впереди ' + r.ahead + ' · ушли ' + r.left);
  }
  if (pageErr) { console.log('     PAGEERR ' + pageErr); pageErr = null; bad++; }
}
for (const li of levels) {
  const r = await page.evaluate(({ li, secs, fault }) => {
    loadLevel(li); hideOv(); paused = true;
    setBody(1e4, 1e4, 0); car.vel = 0;
    const flow = level.actors.filter(a => a.act.flow);
    if (!flow.length) return { name: level.def.name, err: ['поток объявлен, но машин нет'] };
    const BX = jamBoxes() || [], boxT = new Map(), sHist = [];
    const err = [], seen = {};
    /* одна строка на вид дефекта с худшим замером: иначе одно наложение печатается
       сотнями строк и прячет остальные проверки */
    const note = (k, val) => { const p = seen[k];
      /* отрицательное значение — «чем меньше, тем хуже»: храним худший замер */
      if (p === undefined || (val < 0 ? val > p : val > p)) seen[k] = val;
      if (p !== undefined && val < 0 && val < p) seen[k] = p; };
    const stuck = new Map(), crossed = new Map(), ycross = new Map(), prevYaw = new Map(), prevPos = new Map(); let maxJump = 0, firstHit = null, kerbHit = null, firstGrid = null, firstRed = null;
    /* поребрик: поток едет по своей линии и о бордюр не тормозит — наезд был бы виден только глазом */
    const KB = level.obs.filter(o => o.kind === 'kerb').map(o => ({ o, r: Math.hypot(o.w, o.l) / 2 + 2.6 }));
    if (fault === 'kerbflow' && flow.length) { const a = flow[0], o = { kind: 'kerb', u: a.u, v: a.v, w: 0.5, l: 3, yaw: a.yaw + Math.PI / 2, hw: 0.25, hl: 1.5 }; KB.push({ o, r: 4.1 }); }
    const dt = 1 / 30, n = Math.round(secs / dt);
    let minGap = 99, vsum = 0, vn = 0, windows = 0;
    for (let k = 0; k < n; k++) {
      game.t += dt;
      actorsTick(dt);
      /* мёртвая пробка: каждая машина за любые 90 с проезжает хотя бы 3 м. Светофор держит не дольше
         цикла (24 с), очередь за ним сдвигается каждый зелёный — стоять 90 с может только сцепка */
      if (k % 900 === 0) {
        sHist.push(flow.map(a => a.act.done ? null : [a.act.rt, a.act.s]));
        if (sHist.length > 3) { const was = sHist[sHist.length - 4], now = sHist[sHist.length - 1];
          for (let i = 0; i < flow.length; i++) {
            if (!was[i] || !now[i] || was[i][0] !== now[i][0] || now[i][1] < was[i][1]) continue;
            if (now[i][1] - was[i][1] < 3) {
              note('машина потока стоит 90 с — сцепка (@traffic-flow-no-gridlock), м за 90 с', +(now[i][1] - was[i][1]).toFixed(1));
              const a = flow[i];
              if (!firstGrid) firstGrid = { t: +(k * dt).toFixed(0), i: level.actors.indexOf(a), jam: !!a.act.jam, u: +a.u.toFixed(1), v: +a.v.toFixed(1), yaw: Math.round(deg(a.yaw)) };
            }
          } }
      }
      if (k % 3) continue;
      for (let i = 0; i < flow.length; i++) {
        const a = flow[i];
        /* машина колонны пробки ушла со сцены (лежит в 10 км): ни дороги, ни соседей у неё больше нет */
        if (a.act.done) continue;
        vsum += a.act.v; vn++;
        /* курс по касательной: скачок курса за 0,1 с не больше 8° — поворот 90° на 6 м/с честно
           даёт до 6°, а со ступенчатым курсом с сегмента на кольце было 12° и на стыке петли 77° */
        /* скачок дальше 5 м за 0,1 с — не поворот, а перенос (машина колонны ушла со сцены): курс не сравниваем */
        const pp = prevPos.get(i), tele = pp && Math.hypot(a.u - pp[0], a.v - pp[1]) > 5;
        prevPos.set(i, [a.u, a.v]);
        if (prevYaw.has(i) && !tele) { const j = Math.abs(deg(angNorm(a.yaw - prevYaw.get(i)))); if (j > maxJump) maxJump = j; }
        prevYaw.set(i, a.yaw);
        /* на проезжей части и в своей половине. Внутри перекрёстка полос нет — там линию
           ведёт дуга, и привязка к соседнему лучу дала бы ложный «выезд на встречную» */
        if (level.city.graph) {
          const g = level.city.graph;
          let atNode = false;
          /* островок кольца: центр машины ближе round−6 — это уже бордюр островка (проезжая
             часть кольца начинается с round−5,5). Проверка стоит ДО пропуска узлов: весь узел
             выпадал из проверок, и поток спокойно ехал сквозь кольцо по центру */
          for (const id in g.V) { const N = g.V[id];
            if (N.round && Math.hypot(a.u - N.u, a.v - N.v) < N.round - 6)
              note('на островке кольца, м от центра (@traffic-flow-island)' + id, -Math.hypot(a.u - N.u, a.v - N.v)); }
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
          /* п. 6.14 и для потока: кто в миг смены зелёного на жёлтый был ближе своего тормозного пути (замедление
             TRAF.dec), проезжает законно — то же правило, что у игрока */
          const ph = lightPhase(sl.light), phWas = ycross.get(key + 'ph');
          if (phWas === 'G' && ph === 'Y') ycross.set(key + 'ok', -s < a.act.v * a.act.v / (2 * TRAF.dec) + 0.5);
          if (ph === 'G') ycross.delete(key + 'ok');
          ycross.set(key + 'ph', ph);
          if (was !== undefined && was < -0.3 && s > 0.3 && lightStops(sl.light) && !(ph === 'Y' && ycross.get(key + 'ok'))) {
            note('проезд на красный (@traffic-flow-red)', 1);
            if (!firstRed) firstRed = { t: +(k * dt).toFixed(1), i: level.actors.indexOf(a), jam: !!a.act.jam, u: +a.u.toFixed(1), v: +a.v.toFixed(1), yaw: Math.round(deg(a.yaw)), sp: +a.act.v.toFixed(2), ph: lightPhase(sl.light), line: [sl.u, sl.v] };
          }
          crossed.set(key, s);
        }
        /* наложение кузовов считаем тем же satMTV, что и игроку: встречные расходятся в
           3,3 м (ширина полосы), а по расстоянию между центрами это читалось бы как удар,
           и наоборот — две машины под 120° касаются углами задолго до 4,4 м */
        for (let j = i + 1; j < flow.length; j++) {
          const b = flow[j];
          if (b.act.done) continue;
          const d = Math.hypot(b.u - a.u, b.v - a.v);
          if (d < minGap) minGap = d;
          const m = satMTV({ u: a.u, v: a.v, hw: HALF_W, hl: HALF_L, yaw: a.yaw },
                           { u: b.u, v: b.v, hw: HALF_W, hl: HALF_L, yaw: b.yaw });
          if (m) { note('кузова наложились на, м (@traffic-flow-gap)', m.depth.toFixed(2));
            /* первое наложение с координатами и временем — иначе по одной цифре не найти, где
               и почему (спавн, перекрёсток, стык петель) */
            if (!firstHit) firstHit = { t: +(k * dt).toFixed(1), u: +a.u.toFixed(1), v: +a.v.toFixed(1), i, j,
              va: +a.act.v.toFixed(1), vb: +b.act.v.toFixed(1), ya: Math.round(deg(a.yaw)), yb: Math.round(deg(b.yaw)) }; }
        }
        for (const q of KB) {
          if (Math.hypot(q.o.u - a.u, q.o.v - a.v) > q.r) continue;
          if (!satMTV({ u: a.u, v: a.v, hw: HALF_W, hl: HALF_L, yaw: a.yaw }, q.o)) continue;
          const m = polyMTV(carHullPts(a.u, a.v, a.yaw), CAR_HULL.length, obsBuf(q.o), obsShape(q.o));
          if (m && m.depth > 0.02) { note('машина потока на поребрике, м (@city-kerb-flow-clear)', +m.depth.toFixed(2));
            if (!kerbHit) kerbHit = { t: +(k * dt).toFixed(1), u: +a.u.toFixed(1), v: +a.v.toFixed(1), yaw: Math.round(deg(a.yaw)), kerb: [+q.o.u.toFixed(1), +q.o.v.toFixed(1)] }; }
        }
        /* п. 13.2 и 14.4: стоять внутри перекрёстка или на зебре за очередью нельзя. Узел у светофора поток
           ждёт у стоп-линии, а не внутри; за машиной, которая сама ждёт въезда, — тоже снаружи */
        if (a.act.v < 0.25) {
          const bx = BX.find(b => inBox(b, a.u, a.v));
          let q = false;
          if (bx) { const f = fuv(a.yaw), rr = ruv(a.yaw);
            q = flow.some(o => o !== a && Math.abs(angNorm(o.yaw - a.yaw)) < rad(45)
              && ((du, dv) => { const lon = du * f.u + dv * f.v; return lon > 0 && lon - 2 * HALF_L < 4 && Math.abs(du * rr.u + dv * rr.v) < 1.6; })(o.u - a.u, o.v - a.v)); }
          const t = q ? (boxT.get(i) || 0) + dt * 3 : 0;
          boxT.set(i, t);
          if (t > 1) note('машина потока стоит в перекрёстке или на зебре за очередью, с (@traffic-flow-box-clear) ' + bx.id, +t.toFixed(1));
        } else boxT.set(i, 0);
        /* застряла без причины */
        const blocked = trafBlock(a, level.actors.indexOf(a)) < TRAF.see || trafLight(a) < TRAF.see
          || trafBoxBlock(a) < TRAF.see || trafRingYield(a) < TRAF.see || ruleBlock(a) < TRAF.see;
        const st = (a.act.v < 0.2 && !blocked) ? (stuck.get(i) || 0) + dt * 3 : 0;
        stuck.set(i, st);
        if (st > 20) note('машина стоит без помехи, с (@traffic-flow-stuck)', Math.round(st));
      }
      if (maxJump > 8) note('скачок курса машины потока за 0,1 с, ° (@traffic-heading-smooth)', +maxJump.toFixed(1));
      /* окно для выезжающего: сколько раз за прогон путь игрока свободен дольше 3 с */
      if (k % 90 === 0 && !flow.some(a => Math.hypot(a.u - level.start.u, a.v - level.start.v) < 18)) windows++;
    }
    return { name: level.def.name, cars: flow.length,
      err: err.concat(Object.keys(seen).map(k => k + ': ' + Math.abs(seen[k])))
        .concat(firstHit ? ['первое наложение: ' + JSON.stringify(firstHit)] : [])
        .concat(kerbHit ? ['первый наезд на поребрик: ' + JSON.stringify(kerbHit)] : [])
        .concat(firstGrid ? ['первая сцепка: ' + JSON.stringify(firstGrid)] : [])
        .concat(firstRed ? ['первый проезд на красный: ' + JSON.stringify(firstRed)] : []),
      vavg: +(vsum / vn).toFixed(2), minGap: +minGap.toFixed(1), windows };
  }, { li, secs: SECS, fault: process.env.FAULT || '' });

  const ok = !r.err.length && !pageErr;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'FAIL ') + r.name + ' · машин ' + (r.cars ?? 0)
    + ' · сред. скорость ' + (r.vavg ?? '-') + ' м/с · мин. дистанция ' + (r.minGap ?? '-') + ' м'
    + ' · окон ' + (r.windows ?? 0)
    + (r.err.length ? '\n     ' + r.err.join('\n     ') : ''));
  if (pageErr) { console.log('     PAGEERR ' + pageErr); pageErr = null; }
}
/* ступени плотности и авторский множитель: «час пик» заметно гуще «плотного», trafMul
   удваивает счёт до потолка; экзамен всегда dense и здесь не считается */
for (const li of levels) {
  const r = await page.evaluate(({ li, back }) => {
    if (LEVELS[li].examRoute) return null;
    /* только петли: колонна урока пробки ставится сверх ступени и потолка */
    const at = (k, mul) => { opt.traffic = k; LEVELS[li].trafMul = mul; loadLevel(li); hideOv(); paused = true;
      return level.actors.filter(a => a.act && a.act.flow && !a.act.jam).length; };
    const dense = at('dense');
    /* урок пробки: колонна занимает места, где рождались бы машины петель, — удвоение там меряет не множитель */
    if (level.jam) { opt.traffic = back; loadLevel(li); hideOv(); paused = true; return null; }
    const heavy = at('heavy'), mul2 = at('heavy', 2);
    delete LEVELS[li].trafMul; opt.traffic = back; loadLevel(li); hideOv(); paused = true;
    return { name: level.def.name, dense, heavy, mul2, cap: TRAF.cap };
  }, { li, back: TRAFFIC || 'normal' });
  if (!r) continue;
  const okHeavy = r.heavy >= r.dense * 1.4 && r.heavy <= r.cap;
  /* машины выпадают у стартовой позы игрока (TRAF_START_CLEAR) и в перекрёстках — там расстановка их не кладёт:
     это не дефект множителя */
  const okMul = r.mul2 >= Math.min(r.cap, Math.round(r.heavy * 1.8)) - 3;
  if (!okHeavy || !okMul) bad++;
  console.log((okHeavy ? 'OK   ' : 'FAIL ') + r.name + ' · «час пик» гуще «плотного» (@traffic-density-heavy) · ' + r.dense + ' → ' + r.heavy + ' из ' + r.cap);
  console.log((okMul ? 'OK   ' : 'FAIL ') + r.name + ' · trafMul 2 удваивает поток до потолка (@traffic-density-mul) · ' + r.heavy + ' → ' + r.mul2);
  if (pageErr) { console.log('     PAGEERR ' + pageErr); pageErr = null; bad++; }
}
await browser.close();
process.exit(bad ? 1 : 0);
