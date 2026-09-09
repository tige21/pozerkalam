/* Съёмка собранного лендинга для дизайн-ревью: несколько позиций скролла на
   десктопе и телефоне. Запуск: PW_DIR=/tmp/pw node landing/shoot.mjs [tag] */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, 'dist');
const tag = process.argv[2] || 'run';
const OUT = path.join(HERE, '..', 'build', 'landing-shots', tag);
const PW_DIR = process.env.PW_DIR || '/tmp/pw';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end('404');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

function loadPlaywright() {
  try { return createRequire(path.join(PW_DIR, 'package.json'))('playwright-core'); }
  catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }
}
function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const d of dirs.reverse()) {
    const b = path.join(cache, d);
    for (const sub of fs.readdirSync(b)) {
      const bin = path.join(b, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  }
  console.error('Chromium не найден'); process.exit(2);
}

const { chromium } = loadPlaywright();
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

const DEVICES = [
  { id: 'desk', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { id: 'phone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];
/* Доли высоты героя: 0 — заголовок, дальше манёвр по точкам руля. */
const HERO_AT = [0, 0.14, 0.36, 0.55, 0.78, 1];
const errors = [];
const made = [];

for (const d of DEVICES) {
  const ctx = await browser.newContext({ viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${d.id} ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${d.id} console ${m.text()}`); });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);

  const hero = await page.evaluate(() => {
    const h = document.getElementById('hero');
    return h ? { top: h.offsetTop, span: h.offsetHeight - h.querySelector('.hero-stage').offsetHeight } : { top: 0, span: 0 };
  });
  for (let i = 0; i < HERO_AT.length; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(hero.top + hero.span * HERO_AT[i]));
    await page.waitForTimeout(320);
    const f = path.join(OUT, `${d.id}-hero${i}.png`);
    await page.screenshot({ path: f });
    made.push(path.basename(f));
  }
  /* Ниже героя — по одному кадру на сцену */
  const tops = await page.evaluate(() => [...document.querySelectorAll('section.scene, section.final')].map((s) => s.offsetTop));
  for (let i = 0; i < tops.length; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), tops[i] - 40);
    await page.waitForTimeout(260);
    const f = path.join(OUT, `${d.id}-s${i + 1}.png`);
    await page.screenshot({ path: f });
    made.push(path.basename(f));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  for (const sub of ['/metodika/', '/avtoshkolam/']) {
    await page.goto(base + sub, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const f = path.join(OUT, `${d.id}-${sub.replace(/\//g, '')}.png`);
    await page.screenshot({ path: f, fullPage: d.id === 'desk' });
    made.push(path.basename(f));
  }
  await ctx.close();
}
await browser.close();
server.close();
console.log(made.join(' '));
if (errors.length) { console.error('ОШИБКИ СТРАНИЦЫ:\n' + errors.join('\n')); process.exit(1); }
console.log('без ошибок страницы');
