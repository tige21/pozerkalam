#!/usr/bin/env node
/* Растеризация brand/*.svg в PNG и сборка контрольного листа.
   Зависимость playwright-core ставится во временную папку:
     mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core@1.55)
     PW_DIR=/tmp/pw node tools/brand-render.mjs
   Выход: brand/png/*.png и build/shots/brand-sheet.png. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(process.env.PW_DIR || '/tmp/pw', 'x.js'));
const { chromium } = req('playwright-core');
function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright');
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

const svg = n => fs.readFileSync(path.join(ROOT, 'brand', n), 'utf8');
const dataUrl = n => 'data:image/svg+xml;base64,' + Buffer.from(svg(n), 'utf8').toString('base64');

const EXPORTS = [
  ['icon.svg', 512, 'icon-512.png'],
  ['icon.svg', 192, 'icon-192.png'],
  ['icon.svg', 180, 'apple-touch-icon.png'],
  ['favicon.svg', 32, 'favicon-32.png'],
];

const browser = await chromium.launch({ executablePath: findChrome() });
const page = await browser.newPage();
fs.mkdirSync(path.join(ROOT, 'brand/png'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'build/shots'), { recursive: true });

for (const [src, size, out] of EXPORTS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}img{display:block;width:${size}px;height:${size}px}</style><img src="${dataUrl(src)}">`);
  await page.locator('img').screenshot({ path: path.join(ROOT, 'brand/png', out) });
}

const cell = (label, bg, html) =>
  `<div class="c" style="background:${bg}"><span style="color:${bg === '#08111b' ? '#7c8ea3' : '#8a95a3'}">${label}</span>${html}</div>`;
const img = (n, w) => `<img src="${dataUrl(n)}" style="width:${w}px">`;

const sheet = `<style>
 html,body{margin:0;background:#14181d;font:12px/1.4 ui-sans-serif,system-ui,sans-serif}
 .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;padding:2px}
 .c{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:26px;min-height:150px}
 .c span{font-size:11px;letter-spacing:.06em;text-transform:uppercase}
 .row{display:flex;align-items:flex-end;gap:18px}
</style>
<div class="grid">
${cell('знак 256', '#08111b', img('mark.svg', 230))}
${cell('знак · дорога голубая', '#08111b', img('mark-blue.svg', 230))}
${cell('знак на светлом', '#f2f7fb', img('mark-dark.svg', 230))}
${cell('иконка 512 → 128', '#14181d', img('icon.svg', 128))}
${cell('иконка: 128 / 64 / 48 / 32', '#14181d', `<div class="row">${img('icon.svg', 128)}${img('icon.svg', 64)}${img('icon.svg', 48)}${img('icon.svg', 32)}</div>`)}
${cell('фавикон: 32 / 24 / 16', '#14181d', `<div class="row">${img('favicon.svg', 32)}${img('favicon.svg', 24)}${img('favicon.svg', 16)}</div>`)}
${cell('знак мелко: 64 / 40 / 24', '#08111b', `<div class="row">${img('mark.svg', 64)}${img('mark.svg', 40)}${img('mark.svg', 24)}</div>`)}
${cell('монохром (белый)', '#08111b', img('mark.svg', 160))}
</div>
<div class="grid" style="grid-template-columns:1fr 1fr">
${cell('лок-ап на тёмном', '#08111b', img('lockup.svg', 560))}
${cell('лок-ап на светлом', '#f2f7fb', img('lockup-dark.svg', 560))}
</div>`;

await page.setViewportSize({ width: 1240, height: 900 });
await page.setContent(`<link rel="preload" as="font" type="font/woff2" crossorigin href="file://${ROOT}/landing/public/font/onest-cyrillic.woff2">
<style>@font-face{font-family:Onest;src:url('file://${ROOT}/landing/public/font/onest-cyrillic.woff2') format('woff2');font-weight:100 900;font-display:block}</style>${sheet}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(ROOT, 'build/shots/brand-sheet.png'), fullPage: true });
await browser.close();
console.log('ok: brand/png + build/shots/brand-sheet.png');
