#!/usr/bin/env node
/* Лендинг глазами посетителя: экран за экраном, как он листает, и текст, который
   на каждом экране виден. Панель персон читает именно это, а не исходник страницы.
     PW_DIR=/tmp/pw node tools/demand/landing-capture.mjs [url]
   Выход: build/demand/landing/<phone|desktop>/NN.png + manifest.json.
   Метрика, Rybbit и API отрезаны: съёмка не должна попадать в аналитику прода. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const URL = process.argv[2] || 'https://pozerkalam.space/';
const OUT = path.join(ROOT, 'build', 'demand', 'landing');
const MAX_SHOTS = 40;

const DEVICES = {
  phone: {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

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

/* park.js перерисовывает героя внутри requestAnimationFrame: таймер в 10 мс давал
   один и тот же кадр то с репликой, то без (см. hero-tape.mjs) — ждём два кадра */
const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

function visibleText() {
  const vh = innerHeight, vw = innerWidth, seen = new Set(), out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || !el || seen.has(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.15) continue;
    let o = 1;
    for (let p = el; p; p = p.parentElement) o *= +getComputedStyle(p).opacity;
    if (o < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw || r.width * r.height < 4) continue;
    seen.add(el);
    out.push(el.innerText.replace(/\s+/g, ' ').trim());
  }
  return out.filter((t, i) => t && out.indexOf(t) === i).join('\n');
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
for (const [name, dev] of Object.entries(DEVICES)) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext(dev);
  await context.route(/mc\.yandex\.ru|\/rb\/|\/api\//, r => r.abort());
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await settle(page);
  const shots = [];
  const { total, vh } = await page.evaluate(() => ({ total: document.documentElement.scrollHeight, vh: innerHeight }));
  const step = Math.round(vh * 0.85);
  for (let y = 0, i = 1; i <= MAX_SHOTS; y += step, i++) {
    const at = Math.min(y, total - vh);
    await page.evaluate(v => window.scrollTo(0, v), at);
    await settle(page);
    await page.waitForTimeout(250);
    await settle(page);
    const file = `${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(dir, file) });
    shots.push({ file, y: at, text: await page.evaluate(visibleText) });
    if (at >= total - vh) break;
  }
  const manifest = { url: URL, device: name, viewport: dev.viewport, scrollHeight: total, takenAt: new Date().toISOString(), shots };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(dir, 'page-text.txt'), await page.evaluate(() => document.body.innerText));
  console.log(`${name}: ${shots.length} экранов, высота ${total}px → ${path.relative(ROOT, dir)}`);
  await context.close();
}
await browser.close();
