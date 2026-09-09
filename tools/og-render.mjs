#!/usr/bin/env node
/* Картинка для соцсетей (og:image, 1200×630): кадр игры + знак и надпись.
   PW_DIR=/tmp/pw node tools/og-render.mjs → landing/public/og.jpg */
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
  for (const d of fs.readdirSync(cache).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse())
    for (const s of fs.readdirSync(path.join(cache, d))) {
      const bin = path.join(cache, d, s, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  console.error('Chromium не найден: задай PW_CHROME=');
  process.exit(2);
}

const b64 = (p, mime) => `data:${mime};base64,` + fs.readFileSync(path.join(ROOT, p)).toString('base64');
const shot = b64('landing/public/shots/parallel.webp', 'image/webp');
const mark = b64('brand/mark.svg', 'image/svg+xml');
const font = b64('landing/public/font/onest-cyrillic.woff2', 'font/woff2');

const html = `<style>
@font-face{font-family:Onest;src:url('${font}') format('woff2');font-weight:100 900;font-display:block}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;position:relative;background:#08111b;
  font-family:Onest,ui-sans-serif,system-ui,sans-serif;color:#fff}
.shot{position:absolute;inset:0;background:url('${shot}') 54% 55%/cover no-repeat}
.scrim{position:absolute;inset:0;background:
  linear-gradient(96deg,#08111b 0%,#08111b 44%,rgba(8,17,27,.92) 56%,rgba(8,17,27,.30) 74%,rgba(8,17,27,.04) 90%),
  linear-gradient(0deg,rgba(8,17,27,.88) 0%,rgba(8,17,27,.30) 18%,transparent 34%),
  linear-gradient(180deg,rgba(8,17,27,.55) 0%,transparent 16%)}
.wrap{position:absolute;left:72px;top:0;height:100%;width:640px;display:flex;flex-direction:column;justify-content:center;gap:0}
img.mark{width:172px;height:86px;display:block;margin-bottom:26px}
h1{font-size:78px;line-height:1;font-weight:700;letter-spacing:-2px}
p{font-size:31px;line-height:1.3;margin-top:16px;color:#c2e3ff;font-weight:500}
.facts{margin-top:30px;font-size:22px;color:#9fd0ff;font-weight:500;letter-spacing:.1px}
.url{position:absolute;left:72px;bottom:44px;font-size:23px;color:#7b8fa5;font-weight:500}
</style>
<div class="shot"></div><div class="scrim"></div>
<div class="wrap">
  <img class="mark" src="${mark}">
  <h1>По зеркалам</h1>
  <p>Тренажёр манёвров и парковки<br>прямо в браузере</p>
  <div class="facts">32 уровня · экзаменационный маршрут · АКПП и МКПП</div>
</div>
<div class="url">pozerkalam.space</div>`;

const browser = await chromium.launch({ executablePath: findChrome() });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(ROOT, 'landing/public/og.jpg'), type: 'jpeg', quality: 88 });
await browser.close();
console.log('ok: landing/public/og.jpg');
