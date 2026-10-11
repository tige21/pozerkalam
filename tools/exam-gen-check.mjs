#!/usr/bin/env node
/* Гейт экзамена из графа (план exam-clarity-voice-sound, Ф2). Маршрут каждый раз новый (examGenRoute), поэтому
   проверяется не «три маршрута», а генератор: аккуратный водитель (tools/practice-bot.js) проезжает случайные
   маршруты чисто — в пустом городе и в плотном потоке, маршруты разные, а пропущенная команда не обрывает
   экзамен: инспектор перестраивает маршрут, пропуск — строка протокола без баллов.

     PW_DIR=/tmp/pw node tools/exam-gen-check.mjs
     PW_DIR=/tmp/pw URL=https://pozerkalam.space/play/ node tools/exam-gen-check.mjs
     FAULT=nodetect|noreroute|samegen|spotbad PW_DIR=/tmp/pw node tools/exam-gen-check.mjs   # каждая проверка обязана покраснеть

   Код 1 — хоть одна проверка не прошла. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || null;
let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

const url = process.env.URL || 'file://' + path.join(ROOT, 'index.html');
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'].concat(process.env.HOST_RULES ? ['--host-resolver-rules=' + process.env.HOST_RULES] : []) });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 20000 });
await page.evaluate(() => { try { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1'); } catch (e) {} });
/* evaluate, а не addScriptTag: CSP прода режет инлайновый <script> без хэша, а вычисление через протокол — нет */
await page.evaluate(fs.readFileSync(path.join(HERE, 'practice-bot.js'), 'utf8'));
await page.evaluate((fault) => {
  if (fault === 'nodetect') window.examPlanTick = function () {};
  if (fault === 'noreroute') window.examGenRoute = (function (f) { return function (seed, from, o) { return o && o.noStop ? null : f(seed, from, o); }; })(window.examGenRoute);
  if (fault === 'samegen') { const f = window.examRouteGen; window.examRouteGen = function () { window.EXAM_SEED = 1007; const r = f(); delete window.EXAM_SEED; return r; }; }
  /* место остановки вплотную к узлу: судья п. 12.4 обязан оштрафовать, и чистого проезда не будет */
  if (fault === 'spotbad') window.stopSpot = function (id) { const n = cityGraph().V[id]; return (n.round || n.r || 0) + 3; };
}, FAULT);

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };
const seeds = (k0, n) => Array.from({ length: n }, (_, i) => 1000 * (k0 + i) + 7);
const drive = (list, opts) => page.evaluate(([list, opts]) => list.map((s) => { const r = examDrive(s, Object.assign({ maxT: 300 }, opts));
  return { s, ok: r.done && !r.failed && r.score === 0 && !r.hits, r: (r.done ? '' : 'не доехал ') + 'этап ' + r.stage + '/' + r.stages + ' [' + r.log.join(' ') + ']', log: r.log }; }), [list, opts]);

/* 1. Маршруты разные: 30 зёрен — не меньше 20 разных цепочек команд, каждый маршрут кончается финишем у
      тротуара и укладывается в 5–12 этапов; на всех вместе есть кольцо и разворот с путей. Эстакады нет ни в
      одном: «трогание на подъёме» на автомате не сдают (владелец, 11.10.2026) */
{
  const r = await page.evaluate((list) => {
    const sig = new Set(), bad = [], kinds = { ring: 0, tram: 0, ramp: 0 };
    for (const s of list) {
      window.EXAM_SEED = s; loadLevel(LEVELS.findIndex((l) => l.examRoute)); hideOv(); delete window.EXAM_SEED;
      const rt = exam.route; sig.add(rt.map((x) => x.short).join('|'));
      if (!rt.length || rt[rt.length - 1].turn !== 'park') bad.push(s + ': нет финиша');
      if (rt.length < 5 || rt.length > 12) bad.push(s + ': этапов ' + rt.length);
      if (rt.some((x) => x.node && cityGraph().V[x.node].round)) kinds.ring++;
      if (rt.some((x) => x.turn === 'U' && !x.node)) kinds.tram++;
      if (rt.some((x) => x.ramp) || level.ramps.length) kinds.ramp++;
    }
    return { n: sig.size, bad, kinds };
  }, seeds(101, 30));
  check('маршрут экзамена каждый раз новый: 30 зёрен — разные цепочки команд, финиш, 5–12 этапов, кольцо и разворот встречаются, эстакады нет (@exam-gen-variety)',
    r.n >= 20 && !r.bad.length && r.kinds.ring > 0 && r.kinds.tram > 0 && r.kinds.ramp === 0,
    r.n + ' разных из 30; кольцо ' + r.kinds.ring + ', разворот ' + r.kinds.tram + ', эстакада ' + r.kinds.ramp + (r.bad.length ? '; ' + r.bad.slice(0, 4).join('; ') : ''));
}

/* 2. Аккуратный водитель проходит экзамен чисто — в пустом городе, настоящий режим, 16 маршрутов */
{
  const r = await drive(seeds(1, 16), {});
  const bad = r.filter((x) => !x.ok);
  check('аккуратный водитель проходит 16 случайных маршрутов чисто, пустой город (@exam-gen-clean-drive)', bad.length === 0,
    bad.length ? bad.slice(0, 4).map((x) => x.s + ': ' + x.r).join('; ') : '16 маршрутов');
}

/* 3. То же в плотном потоке: уступает по правилам, ждёт окна у кольца */
{
  const r = await drive(seeds(1, 8), { traffic: true });
  const bad = r.filter((x) => !x.ok);
  check('аккуратный водитель проходит 8 маршрутов чисто в плотном потоке (@exam-gen-traffic-drive)', bad.length === 0,
    bad.length ? bad.slice(0, 4).map((x) => x.s + ': ' + x.r).join('; ') : '8 маршрутов');
}

/* 4. Пропуск команды: водитель едет прямо там, где велено повернуть; инспектор перестраивает маршрут,
      пропуск — строка протокола без баллов, экзамен доходит до финиша */
{
  const r = await page.evaluate((list) => list.map((s) => { const x = examDrive(s, { misbehave: 'skipturn', maxT: 300 });
    return { s, ok: x.done && !x.failed && x.score === 0 && x.log.some((l) => /^missed/.test(l)), r: 'этап ' + x.stage + '/' + x.stages + ' [' + x.log.join(' ') + ']' }; }), [1007, 2007, 5007]);
  const bad = r.filter((x) => !x.ok);
  check('пропущенная команда: пропуск в протоколе без баллов, маршрут перестроен и пройден до финиша (@exam-missed-reroute-drive)', bad.length === 0,
    bad.length ? bad.map((x) => x.s + ': ' + x.r).join('; ') : '3 проезда с пропуском');
}

check('страница без исключений', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
