#!/usr/bin/env node
/* Прогон быстрых утверждений (tools/units.js) в headless-браузере. Отдельно от
   gherkin-run: сценарий описывает правило словами заказчика, утверждение проверяет
   число из CAR и из норматива. Вместе они и есть набор, которым мутационный гейт
   убивает мутантов, поэтому оба обязаны укладываться в секунды.
     PW_DIR=/tmp/pw node tools/unit-check.mjs
     ROOT=/tmp/mutant-17 PW_DIR=/tmp/pw node tools/unit-check.mjs
   Код 1 — упавшее утверждение или исключение на странице. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const QUIET = process.env.QUIET === '1';

const { chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');
const cacheDir = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(cacheDir).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
const BIN = path.join(cacheDir, shell, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');

const browser = await chromium.launch({ executablePath: BIN });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
let pageErr = null;
page.on('pageerror', (e) => { pageErr = pageErr || e.message; });

const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
await page.goto(url);
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); });
await page.goto(url + '&r=1');
await page.waitForFunction(() => typeof window.loadLevel === 'function', null, { timeout: 15000 }).catch(() => {});
await page.addScriptTag({ path: path.join(HERE, 'exam-check.js') });
await page.addScriptTag({ path: path.join(HERE, 'units.js') });

const r = await page.evaluate(() => {
  try { return unitCheck(); }
  catch (e) { return { total: 0, failed: 1, fails: ['исключение: ' + e.message] }; }
});
await browser.close();

if (pageErr) r.fails.push('исключение на странице: ' + pageErr);
if (!QUIET) r.fails.forEach((f) => console.log('  FAIL ' + f));
console.log(JSON.stringify({ total: r.total, failed: r.fails.length }));
process.exit(r.fails.length ? 1 : 0);
