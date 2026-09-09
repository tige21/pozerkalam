#!/usr/bin/env node
/* Продуктовая съёмка для лендинга: несколько кадров игры в состояниях, которые
   стоит показать на странице. Зависимость та же, что у cockpit-shots.mjs:
     mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core@1.55)
     PW_DIR=/tmp/pw node tools/landing-shots.mjs
   Выход: landing/public/shots/<имя>.png (DPR 2, 1440x900 → 2880x1800). */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const OUT = path.join(ROOT, 'landing', 'public', 'shots');

function loadPlaywright() {
  try { return createRequire(path.join(PW_DIR, 'package.json'))('playwright-core'); }
  catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }
}
function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const d of dirs.reverse()) {
    const base = path.join(cache, d);
    for (const sub of fs.readdirSync(base)) {
      const bin = path.join(base, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  }
  console.error('Chromium не найден: задай PW_CHROME='); process.exit(2);
}

/* level — индекс в LEVELS (0-based), demoMs — сколько прокрутить демо до кадра */
const SHOTS = [
  { name: 'cockpit',  level: 0,  cam: 'fp',    demoMs: 9500,  refs: 1 },
  { name: 'parallel', level: 0,  cam: 'chase', demoMs: 12000, refs: 2 },
  { name: 'city',     level: 27, cam: 'chase', demoMs: 7000,  refs: 1 },
  { name: 'drill',    level: 13, cam: 'chase', demoMs: 0,     refs: 2 },
];

const { chromium } = loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) console.error('PAGEERR', e.message); });

await page.goto(url);
await page.evaluate(() => {
  for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9');
  localStorage.setItem('trainer_touch', '0');
});
await page.goto(url + 'r');
await page.waitForTimeout(400);

const made = [];
for (const s of SHOTS) {
  await page.evaluate((o) => {
    hideOv();
    loadLevel(o.level);
    opt.refs = o.refs; opt.marks = true; opt.mirrors = true; opt.gfx = 'max';
    if (o.cam === 'fp' && opt.camMode !== CAM_FP) pressKey('KeyV');
    if (o.cam === 'chase' && opt.camMode === CAM_FP) pressKey('KeyV');
    if (o.cam === 'chase') { opt.pitch = rad(26); opt.dist = 10.5; }
    doAct('start');
    /* полоса горячих клавиш и подсказка тача — служебные, в продуктовом кадре они мусор */
    for (const id of ['hint', 'thelp']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
    if (o.demoMs) startDemo();
  }, s);
  await page.waitForTimeout(s.demoMs || 700);
  await page.evaluate(() => { if (typeof stopDemo === 'function') stopDemo(); paused = true; });
  await page.waitForTimeout(250);
  const file = path.join(OUT, `${s.name}.png`);
  await page.screenshot({ path: file });
  made.push(`${s.name}.png ${(fs.statSync(file).size / 1024).toFixed(0)} КБ`);
}
await browser.close();
console.log(made.join('\n'));
