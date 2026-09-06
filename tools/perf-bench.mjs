#!/usr/bin/env node
/* Замер производительности из салона в НАСТОЯЩЕМ браузере с окном (не headless): fps и p95 интервала
   rAF за 3 с, JS-время кадра, число операций Canvas за кадр и число проходов рендера — по сценариям
   «всё», «зерно выкл», «картинки выкл», «градиенты выкл», «зеркала выкл», «обводка выкл».
   Зависимость playwright-core — как у cockpit-shots (PW_DIR, по умолчанию /tmp/pw):
     PW_DIR=/tmp/pw node tools/perf-bench.mjs                                   # Google Chrome, GPU, 1440×900 @2
     PW_DIR=/tmp/pw ARGS="--disable-gpu --disable-gpu-compositing" node tools/perf-bench.mjs   # программный Canvas
     PW_DIR=/tmp/pw OLD=4d3ea3d node tools/perf-bench.mjs                       # плюс та же сцена из коммита OLD
     BIN=/путь/к/Chromium W=2560 H=1440 DPR=2 — другой Chromium-браузер (временный профиль), размер окна.
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

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch (e) { console.error(`playwright-core не найден в ${PW_DIR}: mkdir -p ${PW_DIR} && (cd ${PW_DIR} && npm i playwright-core@1.55)`); process.exit(2); }
if (!fs.existsSync(BIN)) { console.error('браузер не найден: ' + BIN); process.exit(2); }

const browser = await chromium.launch({ executablePath: BIN, headless: false, args: ARGS });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await context.newPage();
page.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) console.error('PAGEERR', e.message); });

async function load(url) {
  await page.goto(url);
  await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0'); });
  await page.goto(url + 'r'); await page.waitForTimeout(400);
  await page.evaluate(() => { doAct('start'); pressKey('KeyV'); opt.fpYaw = 0; opt.fpPitch = rad(-2); });
  await page.waitForTimeout(800);
}
async function measure(scene, label, setup) {
  if (setup) await page.evaluate(setup);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => new Promise(res => { const d = []; let last = performance.now(); const t0 = last;
    (function f() { const t = performance.now(); d.push(t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b);
      res({ fps: +(d.length / ((last - t0) / 1000)).toFixed(0), jsMs: +frameCost.toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1), dpr: +DPR.toFixed(2), px: canvas.width + 'x' + canvas.height }); } })(); }));
  const ops = await page.evaluate(() => { const P = CanvasRenderingContext2D.prototype, c = {}, keep = {};
    for (const m of ['fill', 'stroke', 'clip', 'createLinearGradient', 'drawImage', 'save', 'restore', 'fillRect', 'createPattern']) { keep[m] = P[m]; c[m] = 0; P[m] = function () { c[m]++; return keep[m].apply(this, arguments); }; }
    const ff = flushFaces; let passes = 0; flushFaces = function () { passes++; ff(); };
    try { render(0.016); } finally { for (const m in keep) P[m] = keep[m]; flushFaces = ff; }
    return Object.assign({ passes, faces: typeof facesFrame === 'number' ? facesFrame : null }, c); });
  console.log(JSON.stringify(Object.assign({ scene, label }, r, { ops })));
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
await load('file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now());
for (const [label, setup] of SCENARIOS) await measure('HEAD', label, setup);
await browser.close();
