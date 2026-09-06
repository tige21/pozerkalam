#!/usr/bin/env node
/* Прогон салона одной командой: скриншоты на позах головы + chase-вид, sortAudit по 8 углам,
   регрессия демо (loadLevel по всем уровням с перехватом console.warn), frameCost.
   Зависимость playwright-core в репозиторий не входит — ставится во временную папку:
     mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core@1.55)
     PW_DIR=/tmp/pw node tools/cockpit-shots.mjs before            # база «до»
     PW_DIR=/tmp/pw node tools/cockpit-shots.mjs after-p1 --mobile # 390×844, DPR 2, тач
   Chromium берётся из кэша Playwright (~/Library/Caches/ms-playwright/chromium_headless_shell-*)
   или из PW_CHROME. Выход: build/shots/<tag>-<поза>.png, build/shots/<tag>.json и та же JSON-строка
   в stdout; код 1, если в проходе салона есть ошибки порядка, демо дали предупреждения
   или страница бросила исключение. Отдельные проверки — tools/sort-audit.js (консоль страницы). */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tag = args.find(a => !a.startsWith('--')) || 'run';
const mobile = args.includes('--mobile');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const OUT = path.join(ROOT, 'build', 'shots');

const POSES = [
  { name: 'chase' },
  { name: 'fwd', yaw: 0, pitch: 0 },
  { name: 'left45', yaw: -45, pitch: 0 },
  { name: 'right45', yaw: 45, pitch: 0 },
  { name: 'cluster', yaw: 0, pitch: -20, blink: 'L' },
  { name: 'back165', yaw: 165, pitch: 0 },
];
const AUDIT_YAWS = [0, -45, 45, -90, 90, -135, 135, 165];

function loadPlaywright() {
  try {
    return createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');
  } catch (e) {
    console.error(`playwright-core не найден в ${PW_DIR}: mkdir -p ${PW_DIR} && (cd ${PW_DIR} && npm i playwright-core@1.55)`);
    process.exit(2);
  }
}

function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache)
    ? fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort()
    : [];
  for (const d of dirs.reverse()) {
    const base = path.join(cache, d);
    for (const sub of fs.readdirSync(base)) {
      const bin = path.join(base, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  }
  console.error('Chromium не найден: задай PW_CHROME=/путь/к/chrome-headless-shell');
  process.exit(2);
}

const { chromium } = loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const context = await browser.newContext(mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const pageErrors = [];
/* регистрация SW под file:// отвергается браузером — это не ошибка игры */
page.on('pageerror', e => {
  if (/ServiceWorker/.test(e.message)) return;
  pageErrors.push(e.message); console.error('PAGEERR', e.message);
});

await page.goto(url);
await page.evaluate((touch) => {
  for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9');
  localStorage.setItem('trainer_touch', touch);
}, mobile ? '1' : '0');
await page.goto(url + 'r');
await page.waitForTimeout(300);

const demoWarns = await page.evaluate(() => {
  const warns = [], orig = console.warn;
  console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
  try { for (let i = 0; i < LEVELS.length; i++) loadLevel(i); }
  finally { console.warn = orig; }
  loadLevel(0);
  return warns;
});

await page.evaluate(() => doAct('start'));
await page.waitForTimeout(500);

const shots = [];
for (const p of POSES) {
  if (p.name !== 'chase') {
    await page.evaluate((o) => {
      if (opt.camMode !== CAM_FP) pressKey('KeyV');
      opt.fpYaw = rad(o.yaw); opt.fpPitch = rad(o.pitch);
      car.blink = o.blink || null;
    }, p);
    await page.waitForTimeout(p.blink ? 420 : 200);
  }
  const file = path.join(OUT, `${tag}-${p.name}.png`);
  await page.screenshot({ path: file });
  shots.push(path.relative(ROOT, file));
}
await page.evaluate(() => { car.blink = null; opt.fpYaw = 0; opt.fpPitch = rad(-2); });
await page.waitForTimeout(3000);
const frameCost = await page.evaluate(() => +frameCost.toFixed(2));

await page.addScriptTag({ path: path.join(ROOT, 'tools', 'sort-audit.js') });
const runs = await page.evaluate((yaws) => {
  const log = console.log; console.log = () => {};
  try { return sortAudit({ yaws, top: 3 }); } finally { console.log = log; }
}, AUDIT_YAWS);
const sort = { interior: 0, world: 0, mirror: 0, worst: [] };
for (const [yaw, passes] of Object.entries(runs)) {
  const main = passes.filter(p => p.main), mirrors = passes.filter(p => !p.main);
  const world = main[0], interior = main[main.length - 1];
  if (main.length > 1) sort.interior += interior.errors;
  sort.world += world.errors;
  for (const m of mirrors) sort.mirror += m.errors;
  if (main.length > 1 && interior.errors) sort.worst.push({ yaw, px: interior.px, top: interior.top });
}

const result = { tag, mobile, sort, demoWarns, frameCost, shots, pageErrors };
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
process.exit(sort.interior > 0 || demoWarns.length > 0 || pageErrors.length > 0 ? 1 : 0);
