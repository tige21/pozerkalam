#!/usr/bin/env node
/* Проверка размера зеркал: рост по ступеням, границы экрана, попадание перетаскивания, колесо
   над зеркалом, сохранение и мобильный режим. Скриншоты — build/shots/mirror-<масштаб>.png.
     PW_DIR=/tmp/pw node tools/mirror-check.mjs
   Код 1, если хоть одна проверка провалена. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const OUT = path.join(ROOT, 'build', 'shots');
let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }
function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const d of fs.readdirSync(cache).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse())
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const bin = path.join(cache, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  console.error('Chromium не найден'); process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const errors = [];
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

async function open(page, touch) {
  const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
  await page.goto(url);
  await page.evaluate(t => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
    localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', t); localStorage.removeItem('trainer_mirscale'); }, touch ? '1' : '0');
  await page.goto(url + 'r');
  await page.waitForTimeout(400);
  await page.evaluate(() => { doAct('start'); loadLevel(0); pressKey('KeyV'); });
  await page.waitForTimeout(400);
}
const rects = page => page.evaluate(() => { const r = mirrorRects();
  return { scale: opt.mirScale, W, H, ...Object.fromEntries(Object.entries(r).map(([k, b]) =>
    [k, { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }])) }; });

/* --- рабочий стол --- */
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
await open(page, false);

const base = await rects(page);
check('по умолчанию зеркала штатного размера', base.scale === 1, 'масштаб=' + base.scale);

await page.evaluate(() => cycleMirScale(1));
await page.waitForTimeout(200);
const up1 = await rects(page);
check('ступень вверх увеличивает зеркала', up1.scale === 1.25 && up1.left.w > base.left.w && up1.center.w > base.center.w,
  `боковое ${base.left.w}→${up1.left.w}, салонное ${base.center.w}→${up1.center.w}`);
check('масштаб сохраняется', (await page.evaluate(() => localStorage.getItem('trainer_mirscale'))) === '1.25');

/* перетаскивание должно попадать в увеличенное зеркало */
const hit = await page.evaluate(() => { const r = mirrorRects(), b = r.left, rc = canvas.getBoundingClientRect();
  const cx = rc.left + (b.x + b.w - 6) * (rc.width / W), cy = rc.top + (b.y + b.h - 6) * (rc.height / H);
  return mirrorAt(cx, cy); });
check('перетаскивание попадает в увеличенное зеркало', hit === 'left', 'mirrorAt=' + hit);

/* максимум: всё на экране и боковые не лезут под кнопки «заново»/«демонстрация» */
await page.evaluate(() => setMirScale(1.8));
await page.waitForTimeout(200);
const big = await rects(page);
const onScreen = ['center', 'left', 'right'].every(k => big[k].x >= 0 && big[k].y >= 0
  && big[k].x + big[k].w <= big.W && big[k].y + big[k].h <= big.H);
check('на максимуме зеркала целиком на экране', onScreen, JSON.stringify(big));
check('боковые не поднимаются под кнопки', big.left.y >= 116 && big.right.y >= 116, 'верх=' + big.left.y);
const cardR = await page.evaluate(() => { const r = document.getElementById('topleft').getBoundingClientRect(); return Math.round(r.right); });
check('салонное не наезжает на карточку уровня и правые панели',
  big.center.x >= cardR && big.center.x + big.center.w <= big.W - 130,
  `x=${big.center.x} ширина=${big.center.w} карточка до ${cardR}`);
await page.screenshot({ path: path.join(OUT, 'mirror-180.png') });

/* колесо над зеркалом меняет размер, вне зеркала — приближает камеру */
await page.evaluate(() => setMirScale(1));
await page.waitForTimeout(150);
const before = await page.evaluate(() => ({ fov: opt.fpFov, scale: opt.mirScale }));
const wheelAt = async (px, py, dy) => page.evaluate(([x, y, d]) => {
  const rc = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent('wheel', { clientX: rc.left + x, clientY: rc.top + y, deltaY: d, bubbles: true, cancelable: true }));
}, [px, py, dy]);
const lm = (await rects(page)).left;
await wheelAt(lm.x + lm.w / 2, lm.y + lm.h / 2, -100);
await page.waitForTimeout(150);
const afterMirror = await page.evaluate(() => ({ fov: opt.fpFov, scale: opt.mirScale }));
check('колесо над зеркалом увеличивает зеркало, а не камеру',
  afterMirror.scale > before.scale && afterMirror.fov === before.fov, JSON.stringify(afterMirror));
await wheelAt(20, 700, -100);
await page.waitForTimeout(150);
const afterScene = await page.evaluate(() => ({ fov: opt.fpFov, scale: opt.mirScale }));
check('колесо вне зеркала по-прежнему меняет обзор',
  afterScene.fov !== afterMirror.fov && afterScene.scale === afterMirror.scale, JSON.stringify(afterScene));

/* меню предлагает размер */
const menuItem = await page.evaluate(() => { buildMenu();
  const t = [...document.querySelectorAll('#tmGrid *')].map(e => (e.textContent || '').trim()).find(x => /^Зеркала: \d+%$/.test(x));
  closeMenu();
  return t || null; });
check('в меню есть строка размера зеркал', !!menuItem, menuItem || 'строки нет');

/* --- телефон --- */
const mob = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
mob.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
await open(mob, true);
await mob.evaluate(() => setMirScale(1.8));
await mob.waitForTimeout(250);
const mr = await rects(mob);
const mobOk = ['center', 'left', 'right'].every(k => mr[k].x >= 0 && mr[k].y >= 0
  && mr[k].x + mr[k].w <= mr.W && mr[k].y + mr[k].h <= mr.H);
check('на телефоне увеличенные зеркала помещаются', mobOk, JSON.stringify(mr));
await mob.screenshot({ path: path.join(OUT, 'mirror-mobile-180.png') });

check('в консоли нет ошибок', errors.length === 0, errors.join(' | '));
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(r => r.name) }));
await browser.close();
process.exit(failed.length ? 1 : 0);
