#!/usr/bin/env node
/* Замер производительности из салона в НАСТОЯЩЕМ браузере с окном (не headless): fps и p95 интервала
   rAF за 3 с, JS-время кадра, число операций Canvas за кадр и число проходов рендера — по сценариям
   «всё», «зерно выкл», «картинки выкл», «градиенты выкл», «зеркала выкл», «обводка выкл».
   Зависимость playwright-core — как у cockpit-shots (PW_DIR, по умолчанию /tmp/pw):
     PW_DIR=/tmp/pw node tools/perf-bench.mjs                                   # Google Chrome, GPU, 1440×900 @2
     PW_DIR=/tmp/pw ARGS="--disable-gpu --disable-gpu-compositing" node tools/perf-bench.mjs   # программный Canvas
     PW_DIR=/tmp/pw OLD=4d3ea3d node tools/perf-bench.mjs                       # плюс та же сцена из коммита OLD
     BIN=/путь/к/Chromium W=2560 H=1440 DPR=2 — другой Chromium-браузер (временный профиль), размер окна.
     SETTLE=12000 — подождать 12 с перед замером, чтобы регулятор качества (QUALITY/qTick) вышел на уровень.
     FORCE_Q=3 ONLY=1 — зафиксировать уровень качества 3 и померить только сценарий «всё».
     URL=https://pozerkalam.space/play/ — померить выложенную сборку вместо локального файла.
     MOBILE=1 CPU=4 — эмуляция телефона (844×390 @3, тач) с процессором в 4 раза медленнее.
     LEVEL=30 CAM=chase TRAFFIC=dense — номер уровня (с 1), камера (fp — салон, по умолчанию; chase — за
       машиной) и плотность потока: город с машинами дороже площадки, и замер одной площадки его не видит.
   Браузеры владельца (Яндекс и т.п.) не запускать — только Chrome/Chromium с временным профилем.
   Вывод: по строке JSON на сценарий; PAGEERR — в stderr. */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const BIN = process.env.BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARGS = (process.env.ARGS || '').split(' ').filter(Boolean);
const DPR = +(process.env.DPR || 2), W = +(process.env.W || 1440), H = +(process.env.H || 900);
const OLD = process.env.OLD || '';
const SETTLE = +(process.env.SETTLE || 0);   /* мс ожидания перед замером — дать регулятору качества выйти на уровень */
const FORCE_Q = process.env.FORCE_Q === undefined ? null : +process.env.FORCE_Q;   /* зафиксировать уровень качества */
const ONLY = !!process.env.ONLY;             /* только сценарий «всё» */
const URL_OVERRIDE = process.env.URL || '';  /* померить прод: URL=https://pozerkalam.space/play/ */
const MOBILE = !!process.env.MOBILE;         /* телефон: 844×390, DPR 3, тач, трекер touch */
const CPU = +(process.env.CPU || 1);         /* замедление процессора через CDP (4 ≈ средний телефон) */
const LEVEL = +(process.env.LEVEL || 1);     /* номер уровня, с 1 */
const CAM = process.env.CAM || 'fp';          /* fp — салон, chase — за машиной */
const TRAFFIC = process.env.TRAFFIC || '';    /* off | calm | normal | dense */

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch (e) { console.error(`playwright-core не найден в ${PW_DIR}: mkdir -p ${PW_DIR} && (cd ${PW_DIR} && npm i playwright-core@1.55)`); process.exit(2); }
if (!fs.existsSync(BIN)) { console.error('браузер не найден: ' + BIN); process.exit(2); }

const browser = await chromium.launch({ executablePath: BIN, headless: false, args: ARGS });
const context = await browser.newContext(MOBILE
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await context.newPage();
if (CPU > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }
page.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) console.error('PAGEERR', e.message); });

async function load(url) {
  await page.goto(url);
  await page.evaluate(([t, tr]) => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', t);
    if (tr) localStorage.setItem('trainer_traffic', tr); }, [MOBILE ? '1' : '0', TRAFFIC]);
  await page.goto(url + 'r'); await page.waitForTimeout(400);
  await page.evaluate(([fq, lv, cam]) => { doAct('start');
    if (lv > 1) { loadLevel(lv - 1); hideOv(); }
    /* поток едет сам: без газа машина игрока стоит, а город живёт — ровно то, что грузит телефон */
    if (cam === 'fp') { pressKey('KeyV'); opt.fpYaw = 0; opt.fpPitch = rad(-2); } else opt.camMode = CAM_CHASE;
    if (fq !== null && typeof qApply === 'function') { qApply(fq); qCoolT = 1e9; } }, [FORCE_Q, LEVEL, CAM]);
  await page.waitForTimeout(800 + SETTLE);
}
async function measure(scene, label, setup) {
  if (setup) await page.evaluate(setup);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => new Promise(res => { const d = []; let last = performance.now(); const t0 = last;
    (function f() { const t = performance.now(); d.push(t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b);
      res({ fps: +(d.length / ((last - t0) / 1000)).toFixed(0), jsMs: +frameCost.toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1), dpr: +DPR.toFixed(2), q: typeof qLevel === 'number' ? qLevel : null, px: canvas.width + 'x' + canvas.height }); } })(); }));
  const ops = await page.evaluate(() => { const P = CanvasRenderingContext2D.prototype, c = {}, keep = {};
    for (const m of ['fill', 'stroke', 'clip', 'createLinearGradient', 'drawImage', 'save', 'restore', 'fillRect', 'createPattern']) { keep[m] = P[m]; c[m] = 0; P[m] = function () { c[m]++; return keep[m].apply(this, arguments); }; }
    const ff = flushFaces; let passes = 0; flushFaces = function () { passes++; ff(); };
    try { render(0.016); } finally { for (const m in keep) P[m] = keep[m]; flushFaces = ff; }
    return Object.assign({ passes, faces: typeof facesFrame === 'number' ? facesFrame : null }, c); });
  const extra = await page.evaluate(() => ({ level: level.def.name.split(' · ')[0], cam: opt.camMode === CAM_FP ? 'fp' : 'chase',
    cars: level.actors.filter(a => a.act && a.act.flow).length }));
  console.log(JSON.stringify(Object.assign({ scene, label }, extra, r, { ops })));
}
const SCENARIOS = [
  ['всё', null],
  ['зерно выкл', () => { grainFace = () => {}; }],
  ['картинки выкл', () => { imgFace = () => {}; }],
  ['градиенты выкл', () => { CanvasRenderingContext2D.prototype.createLinearGradient = function () { return { addColorStop() {} }; }; }],
  ['зеркала выкл', () => { opt.mirrors = false; }],
  ['обводка выкл', () => { CanvasRenderingContext2D.prototype.stroke = function () {}; }],
];
if (OLD) {
  const tmp = path.join(os.tmpdir(), `pozerkalam-${OLD}.html`);
  fs.writeFileSync(tmp, execSync(`git -C "${ROOT}" show ${OLD}:index.html`));
  await load('file://' + tmp + '?nocache=' + Date.now());
  await measure(OLD, 'всё');
}
await load(URL_OVERRIDE ? URL_OVERRIDE + '?nocache=' + Date.now() : 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now());
for (const [label, setup] of (ONLY ? SCENARIOS.slice(0, 1) : SCENARIOS)) await measure('HEAD', label, setup);
await browser.close();
