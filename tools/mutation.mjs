#!/usr/bin/env node
/* Мутационный прогон расчётного ядра.
   Покрытие показывает, что строка выполнилась, а не что её проверили. В расчёте это разные
   вещи: тест может вызвать формулу и не сверить результат. Мутант меняет саму формулу —
   знак, границу, коэффициент — и смотрит, заметит ли это хоть одна проверка. Выживший
   мутант означает, что такую же правку может внести человек, и никто не узнает, пока
   игрок не проедет по неверной подсказке.
   Набор для убийства — tools/units.js и @domain-сценарии: оба работают в одной странице,
   поэтому мутант стоит секунду-полторы, а не минуты.
     PW_DIR=/tmp/pw node tools/mutation.mjs               # весь прогон + гейт
     PW_DIR=/tmp/pw node tools/mutation.mjs --only sweep  # одна функция
     PW_DIR=/tmp/pw node tools/mutation.mjs --jobs 6
     MUTATION_MIN_SCORE=92 PW_DIR=/tmp/pw node tools/mutation.mjs
   Порог — храповик: поднимается вслед за фактическим результатом и вниз не опускается.
   Опускать его, чтобы прогон позеленел, нельзя: это отказ от единственной проверки,
   которая ловит «тест вызвал и не сверил». */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutants, build } from './mutate.mjs';
import { parseFeatures } from './gherkin-parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const TMP = path.join(os.tmpdir(), 'pozerkalam-mutation');
const REPORT = path.join(REPO, 'reports', 'mutation.md');
const EQUIV = path.join(REPO, 'tools', 'mutation-equivalent.json');

/* порог-храповик: поднимается вместе с фактическим результатом, вниз не опускается */
/* база 2026-09-22: 394 из 1159. Порог чуть ниже факта — иначе округление печатает
   «34.0 %» при 33,99 и гейт валит собственную базу */
const DEFAULT_MIN_SCORE = 35.6;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ONLY = arg('--only', null);
const JOBS = +arg('--jobs', 4);
const MIN_SCORE = +(process.env.MUTATION_MIN_SCORE || DEFAULT_MIN_SCORE);

const equivalent = existsSync(EQUIV) ? JSON.parse(readFileSync(EQUIV, 'utf8')) : {};

const { list } = mutants();
const work = list.map((m, i) => ({ ...m, i })).filter((m) => !ONLY || m.fn === ONLY);
if (!work.length) { console.error('нет мутантов' + (ONLY ? ' в «' + ONLY + '»' : '')); process.exit(1); }

const { scenarios, errors } = parseFeatures(REPO);
if (errors.length) { errors.forEach((e) => console.error('ОШИБКА РАЗБОРА · ' + e)); process.exit(1); }
const domain = scenarios.filter((s) => s.kind === 'domain').map((s) => ({ code: s.code, steps: s.steps.map((x) => x.text) }));

const { chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');
const cacheDir = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const shell = readdirSync(cacheDir).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
const BIN = path.join(cacheDir, shell, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');

const EXAMCHK = readFileSync(path.join(HERE, 'exam-check.js'), 'utf8');
const UNITS = readFileSync(path.join(HERE, 'units.js'), 'utf8');
const STEPS = readFileSync(path.join(HERE, 'steps', 'domain.js'), 'utf8');

const EVAL_TIMEOUT = +(process.env.MUTATION_TIMEOUT || 25000);
/** один прогон обоих наборов по указанной сборке; возвращает список провалов.
    Зависание — тоже смерть мутанта: правка вроде «i < n» → «i <= n» уводит цикл в
    бесконечность, и без этого ограничения прогон стоял на таком мутанте вечно. */
async function runSuite(browser, dir) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('страница: ' + e.message));
  try {
    const url = 'file://' + path.join(dir, 'index.html') + '?nocache=' + Date.now();
    await page.goto(url, { timeout: 15000 });
    await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); });
    await page.goto(url + '&r=1', { timeout: 15000 });
    await page.waitForFunction(() => typeof window.loadLevel === 'function', null, { timeout: 8000 });
    await page.addScriptTag({ content: EXAMCHK });
    await page.addScriptTag({ content: UNITS });
    await page.addScriptTag({ content: STEPS });
    const r = await withTimeout(page.evaluate((scen) => {
      const out = [];
      try { const u = unitCheck(); out.push(...u.fails); }
      catch (e) { out.push('units: ' + e.message); }
      for (const s of scen) {
        let res;
        try { res = window.ghRun(s.steps); } catch (e) { res = { ok: false, err: e.message, step: '(исключение)' }; }
        if (!res.ok) out.push(s.code + ': ' + res.err);
      }
      return out;
    }, domain));
    errs.push(...r);
  } catch (e) { errs.push('прогон: ' + e.message); }
  await page.close().catch(() => {});
  return errs;
}
function withTimeout(p) {
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error('таймаут ' + (EVAL_TIMEOUT / 1000) + ' с')), EVAL_TIMEOUT); }),
  ]);
}

/* база: непомутированная сборка обязана быть зелёной, иначе «убит» получит каждый мутант
   и балл окажется сотней при полностью сломанном наборе */
const base = await chromium.launch({ executablePath: BIN });
const baseFails = await runSuite(base, REPO);
await base.close();
if (baseFails.length) {
  console.error('БАЗА КРАСНАЯ — мутационный прогон бессмыслен:');
  baseFails.slice(0, 10).forEach((f) => console.error('  ' + f));
  process.exit(1);
}
console.error(`база зелёная · мутантов ${work.length} · потоков ${JOBS}`);

const results = new Array(work.length);
let next = 0, doneN = 0;
async function worker(w) {
  const dir = path.join(TMP, 'w' + w);
  mkdirSync(dir, { recursive: true });
  let browser = await chromium.launch({ executablePath: BIN });
  while (true) {
    const k = next++;
    if (k >= work.length) break;
    const m = work[k];
    build(m.i, dir);
    const fails = await runSuite(browser, dir);
    /* страница зависшего мутанта продолжает крутиться и тормозит соседей — браузер
       воркера поднимаем заново, это дешевле, чем делить процессор с мёртвым циклом */
    if (fails.some((f) => f.includes('таймаут'))) {
      await browser.close().catch(() => {});
      browser = await chromium.launch({ executablePath: BIN });
    }
    results[k] = { ...m, killed: fails.length > 0, by: fails[0] || null };
    doneN++;
    if (doneN % 25 === 0 || doneN === work.length)
      process.stderr.write(`\r  ${doneN}/${work.length}`);
  }
  await browser.close();
}
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, (_, w) => worker(w)));
process.stderr.write('\n');

const survived = results.filter((r) => !r.killed && !equivalent[r.key]);
const equiv = results.filter((r) => !r.killed && equivalent[r.key]);
const killed = results.filter((r) => r.killed);
const counted = results.length - equiv.length;
const score = counted ? (killed.length / counted) * 100 : 100;

const byFn = {};
for (const r of survived) (byFn[r.fn] = byFn[r.fn] || []).push(r);

/* частичный прогон (--only) отчёт не пишет и гейтом не считается: он для разбора одной
   функции, а перезапись общего отчёта стёрла бы базу, ради которой прогон и держат */
const partial = !!ONLY;
mkdirSync(path.dirname(REPORT), { recursive: true });
const lines = [
  '# Мутационное тестирование расчётного ядра',
  '',
  `Прогон: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  'Область: `tools/mutation-zone.json`. Убивают `tools/units.js` и `@domain`-сценарии.',
  '',
  `**Убито ${killed.length} из ${counted} — ${score.toFixed(1)} %** (порог ${MIN_SCORE.toFixed(1)} %)`,
  equiv.length ? `Эквивалентных, не в счёт: ${equiv.length}` : '',
  '',
  '| Функция | Выжило |',
  '|---|---|',
  ...Object.entries(byFn).sort((a, b) => b[1].length - a[1].length)
    .map(([fn, arr]) => `| \`${fn}\` | ${arr.length} |`),
  '',
  '## Выжившие',
  '',
  survived.length ? '' : 'Нет.',
  ...survived.slice(0, 150).map((r) => `- **${r.fn}** · index.html:${r.line} · ${r.kind} · \`${r.key}\``),
  survived.length > 150 ? `\n…и ещё ${survived.length - 150}. Разбирают по функциям: \`--only <имя>\`.` : '',
  '',
].filter((x) => x !== '');
if (!partial) writeFileSync(REPORT, lines.join('\n'), 'utf8');

if (partial) {
  console.log(`убито ${killed.length}/${counted} — ${score.toFixed(1)} % по «${ONLY}» (частичный прогон, гейт не применяется)`);
  for (const r of survived) console.log('  выжил · index.html:' + r.line + ' · ' + r.kind + ' · ' + r.key);
  process.exit(0);
}
console.log(`убито ${killed.length}/${counted} — ${score.toFixed(1)} % (порог ${MIN_SCORE.toFixed(1)} %), отчёт ${path.relative(REPO, REPORT)}`);
if (score + 1e-9 < MIN_SCORE) {
  console.error(`балл ниже порога — разбери выживших в ${path.relative(REPO, REPORT)}; порог не опускать`);
  process.exit(1);
}
