#!/usr/bin/env node
/* Исполнение @domain-сценариев из specs/features. Аналога pytest-bdd в проекте нет и быть
   не может — зависимостей нет вовсе, — поэтому раннер свой: страница поднимается один раз,
   словарь шагов (tools/steps/domain.js) загружается в неё, дальше каждый сценарий уходит
   одним вызовом ghRun. Один обмен со страницей на сценарий: их сотни, а прогон обязан
   укладываться в секунды — его на каждом мутанте гоняет мутационный гейт.
     PW_DIR=/tmp/pw node tools/gherkin-run.mjs                # все сценарии
     PW_DIR=/tmp/pw node tools/gherkin-run.mjs traffic exam    # только эти области
     ROOT=/tmp/mutant-17 PW_DIR=/tmp/pw node tools/gherkin-run.mjs   # проверить другую сборку
   Код 1 — упавший сценарий, ошибка разбора или исключение на странице. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeatures } from './gherkin-parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const ROOT = process.env.ROOT || REPO;
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const QUIET = process.env.QUIET === '1';
const areas = process.argv.slice(2);

const { scenarios, errors } = parseFeatures(REPO);
if (errors.length) { errors.forEach((e) => console.error('ОШИБКА РАЗБОРА · ' + e)); process.exit(1); }

const run = scenarios.filter((s) => s.kind === 'domain' && (!areas.length || areas.includes(s.area)));
if (!run.length) { console.error('нет @domain-сценариев' + (areas.length ? ' в областях ' + areas.join(', ') : '')); process.exit(1); }

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
await page.waitForFunction(() => typeof window.loadLevel === 'function', null, { timeout: 15000 })
  .catch(() => {});
await page.addScriptTag({ path: path.join(HERE, 'steps', 'domain.js') });

let failed = 0, byArea = {};
for (const s of run) {
  const r = await page.evaluate((steps) => {
    try { return window.ghRun(steps); }
    catch (e) { return { ok: false, i: -1, step: '(до первого шага)', err: e.message }; }
  }, s.steps.map((x) => x.text));
  byArea[s.area] = byArea[s.area] || { ok: 0, bad: 0 };
  if (r.ok && !pageErr) { byArea[s.area].ok++; if (!QUIET) console.log('  ok   ' + s.code + ' · ' + s.title); }
  else {
    failed++; byArea[s.area].bad++;
    console.log('  FAIL ' + s.code + ' · ' + s.title);
    console.log('       ' + s.file + ':' + (s.steps[r.i] ? s.steps[r.i].line : s.line) + ' · шаг «' + r.step + '»');
    console.log('       ' + (pageErr ? 'исключение на странице: ' + pageErr : r.err));
    pageErr = null;
  }
}
await browser.close();
console.log(Object.entries(byArea).map(([a, v]) => a + ' ' + v.ok + '/' + (v.ok + v.bad)).join(' · '));
console.log(JSON.stringify({ total: run.length, failed }));
process.exit(failed ? 1 : 0);
