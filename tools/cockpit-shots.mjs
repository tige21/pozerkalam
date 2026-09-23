#!/usr/bin/env node
/* Прогон салона одной командой: скриншоты на позах головы + chase-вид, sortAudit по 8 углам,
   регрессия демо (loadLevel по всем уровням с перехватом console.warn), frameCost.
   Зависимость playwright-core в репозиторий не входит — ставится во временную папку:
     mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core@1.55)
     PW_DIR=/tmp/pw node tools/cockpit-shots.mjs before            # база «до»
     PW_DIR=/tmp/pw node tools/cockpit-shots.mjs after-p1 --mobile # телефон 844×390 (альбомно), DPR 2, тач
     PW_DIR=/tmp/pw node tools/cockpit-shots.mjs after-p1 --sweep  # + поворот головы −60…+60°: переключения режима грани
   Chromium берётся из кэша Playwright (~/Library/Caches/ms-playwright/chromium_headless_shell-*)
   или из PW_CHROME. Выход: build/shots/<tag>-<поза>.png, build/shots/<tag>.json и та же JSON-строка
   в stdout; код 1, если в проходе салона есть ошибки порядка, демо дали предупреждения,
   страница бросила исключение, свип нашёл переключения режима или в полосе салона кадра «вперёд»
   больше SKY_GAP_MAX пикселей цвета неба (щели между гранями). Отдельные проверки — tools/sort-audit.js (консоль страницы). */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const tag = args.find(a => !a.startsWith('--')) || 'run';
const mobile = args.includes('--mobile');
const sweepOn = args.includes('--sweep');
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
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
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

const shots = []; let skyGap = null;
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
  /* щели между гранями салона: в полосе торпедо/руля кадра «вперёд» не должно быть пикселей цвета
     неба. Так пойман перевёрнутый знак расширения контура (грани сжимались — «всё в линиях») */
  /* стёкла корпусов зеркал отражают небо по праву: на телефоне (широкий кадр) левое зеркало попадает
     в полосу торпедо и давало 1300 «щелей» — пиксели внутри стекла не считаются */
  if (p.name === 'fwd') skyGap = await page.evaluate(() => {
    const g = canvas.getContext('2d'), k = DPR, x0 = Math.round(W * 0.18 * k), y0 = Math.round(H * 0.67 * k);
    const w = Math.round(W * 0.67 * k), h = Math.round(H * 0.25 * k), d = g.getImageData(x0, y0, w, h).data;
    const glass = ['left', 'right'].map(kd => typeof mirrorGlassRect === 'function' ? mirrorGlassRect(kd) : null).filter(Boolean)
      .map(r => ({ x0: (r.x - 2) * k - x0, y0: (r.y - 2) * k - y0, x1: (r.x + r.w + 2) * k - x0, y1: (r.y + r.h + 2) * k - y0 }));
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (!(d[i + 2] - d[i] > 25 && d[i + 2] > 120)) continue;
      const px = (i >> 2) % w, py = (i >> 2) / w | 0;
      if (glass.some(r => px >= r.x0 && px <= r.x1 && py >= r.y0 && py <= r.y1)) continue;
      n++;
    }
    return n;
  });
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

/* --sweep: поворот головы по градусу; грань салона не должна менять способ заливки между соседними
   шагами (flat/grad, картинка, вес зерна скачком > 0,5) — иначе это и есть «текстуры моргают».
   Заодно считаются вырожденные градиенты (концы ближе 1,5 px): Canvas такие не рисует вовсе */
let sweep = null;
if (sweepOn) {
  sweep = await page.evaluate((cfg) => {
    const toWorld = (c) => ({ u: -(cam.pos.x + c.x * cam.r.x + c.y * cam.u.x + c.d * cam.f.x), y: cam.pos.y + c.x * cam.r.y + c.y * cam.u.y + c.d * cam.f.y, v: cam.pos.z + c.x * cam.r.z + c.y * cam.u.z + c.d * cam.f.z });
    const toBody = (w) => { const c = bodyPos(), f = fuv(car.th), r = ruv(car.th), du = w.u - c.u, dv = w.v - c.v; return [du * r.u + dv * r.v, w.y, du * f.u + dv * f.v]; };
    const P = CanvasRenderingContext2D.prototype, origCLG = P.createLinearGradient; let degenerate = 0;
    P.createLinearGradient = function (x0, y0, x1, y1) { if (Math.hypot(x1 - x0, y1 - y0) < 1.5) degenerate++; return origCLG.apply(this, arguments); };
    const origFM = faceMode; let rec = null;
    faceMode = function (f, s0, s1, s2, s3) {
      const m = origFM(f, s0, s1, s2, s3);
      if (rec && VP.w === W) { const c = clipNear(f.cp); if (c.length >= 3) {
        const sp = c.map(toScreen); let a = 0; for (let i = 0; i < sp.length; i++) { const p = sp[i], q = sp[(i + 1) % sp.length]; a += p.x * q.y - q.x * p.y; } a = Math.abs(a) / 2;
        let mx = 0, my = 0, md = 0; for (const q of c) { mx += q.x; my += q.y; md += q.d; }
        const b = toBody(toWorld({ x: mx / c.length, y: my / c.length, d: md / c.length }));
        rec.set(b.map(v => Math.round(v * 500)).join('/') + (f.img ? 'i' : '') + f.cp.length, { m, gk: f.gk || 0, a }); } }
      return m; };
    let toggles = 0, steps = 0; const worst = [];
    for (const pitch of cfg.pitches) { let prev = null;
      for (let yaw = cfg.y0; yaw <= cfg.y1; yaw += cfg.step) { opt.fpYaw = rad(yaw); opt.fpPitch = rad(pitch); rec = new Map(); render(0.016); steps++;
        if (prev) for (const [k, v] of rec) { const p = prev.get(k); if (!p) continue;
          /* переход градиент → плоский у порога GRAD_MIN_PX (40 px) штатный и незаметный: считаем
             только грани крупнее 50×50 px, где он был бы виден */
          const fillT = v.m.split('+')[0] !== p.m.split('+')[0] && Math.min(v.a, p.a) > 2500;
          const imgT = v.m.includes('img') !== p.m.includes('img') && Math.min(v.a, p.a) > 100;
          /* у текстуры стен gk — номер мип-уровня, а не вес зерна: смена уровня при повороте головы —
             штатная работа мипов (контраст уровней выровнен), а не «моргание» */
          const grainT = !v.m.includes('tex') && !p.m.includes('tex') && Math.abs(v.gk - p.gk) > 0.5 && Math.min(v.a, p.a) > 100;
          if (fillT || imgT || grainT) { toggles++; if (worst.length < 8) worst.push({ pitch, yaw, key: k, from: p.m + ':' + p.gk.toFixed(2), to: v.m + ':' + v.gk.toFixed(2), area: Math.round(v.a) }); } }
        prev = rec; } }
    rec = null; faceMode = origFM; P.createLinearGradient = origCLG; opt.fpYaw = 0; opt.fpPitch = rad(-2);
    return { steps, toggles, degenerate, worst };
  }, { y0: -60, y1: 60, step: 1, pitches: [0, -20, 15] });
}

const SKY_GAP_MAX = 60;
const result = { tag, mobile, sort, demoWarns, frameCost, skyGap, sweep, shots, pageErrors };
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
const sweepBad = sweep && (sweep.toggles > 0 || sweep.degenerate > 0);
const gapBad = skyGap !== null && skyGap > SKY_GAP_MAX;
process.exit(sort.interior > 0 || demoWarns.length > 0 || pageErrors.length > 0 || sweepBad || gapBad ? 1 : 0);
