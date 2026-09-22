#!/usr/bin/env node
/* Гейт связи «сценарий ↔ проверка».
   @ui-сценарий не исполняется — он описывает то, что проверяет инструмент. Чтобы он не
   остался просто текстом, его код требования обязан стоять в имени проверки:
       check('со сцеплением включается 1-я (@mt-clutch-gear1)', …)
   Связь проверяется в обе стороны: сценарий без проверки — дыра в покрытии, код в
   инструменте без сценария — переименованный код, связь порвалась молча.
   @domain-сценарий исполняет tools/gherkin-run.mjs; здесь у него проверяется только
   оформление — иначе сценарий с опечаткой в теге тихо выпадет из прогона.
     node tools/gherkin-check.mjs          # проверка
     node tools/gherkin-check.mjs --list   # таблица связей
   Код 1 — любая порванная связь или ошибка разбора. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeatures, AREA_TAGS, codesHash } from './gherkin-parse.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const TOOLS = path.join(REPO, 'tools');

const { scenarios, errors } = parseFeatures(REPO);
errors.forEach((e) => console.error('ОШИБКА РАЗБОРА · ' + e));

/* где искать коды: сами инструменты, включая вложенные словари шагов */
function toolSources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) toolSources(full, out);
    else if (/\.(mjs|js)$/.test(entry.name)) out.push({ file: path.relative(REPO, full), text: readFileSync(full, 'utf8') });
  }
  return out;
}
const sources = toolSources(TOOLS).filter((s) => !/gherkin-(check|parse|run)\.mjs$/.test(s.file));

/* код требования узнаётся по префиксу области: иначе в улов попадает любой «@» из кода —
   @font-face в css-строке инструмента исправно ломал гейт */
const RE_CODE = new RegExp('@((?:' + [...AREA_TAGS].join('|') + ')-[\\w-]+)', 'g');
const codesInTools = new Map();          /* код → где найден */
for (const s of sources)
  for (const m of s.text.matchAll(RE_CODE))
    if (!codesInTools.has(m[1])) codesInTools.set(m[1], s.file);

const bad = [];
const rows = [];
for (const s of scenarios) {
  if (!s.code) continue;
  if (s.kind === 'ui') {
    const where = codesInTools.get(s.code);
    if (!where) bad.push(`${s.file}:${s.line} — @ui-сценарий «${s.code}» без проверки в tools/`);
    rows.push({ code: s.code, kind: 'ui', at: `${s.file}:${s.line}`, by: where || '—' });
  } else {
    rows.push({ code: s.code, kind: 'авто', at: `${s.file}:${s.line}`, by: 'tools/gherkin-run.mjs' });
  }
}
const known = new Set(scenarios.map((s) => s.code));
for (const [code, file] of codesInTools)
  if (!known.has(code)) bad.push(`${file} — код «${code}» стоит в проверке, но сценария с ним нет (переименовали?)`);

if (LIST) {
  const w = Math.max(...rows.map((r) => r.code.length), 4);
  for (const r of rows.sort((a, b) => a.code.localeCompare(b.code)))
    console.log(r.code.padEnd(w) + '  ' + r.kind.padEnd(4) + '  ' + r.at.padEnd(46) + '  ' + r.by);
}

/* чек-лист собирается генератором и живёт в том же коммите, что и сценарии: устаревший
   файл хуже отсутствующего — владелец пройдёт по нему и решит, что проверил всё */
const clPath = path.join(REPO, 'docs', 'qa-checklist.md');
if (existsSync(clPath)) {
  const want = codesHash(scenarios);
  const got = (/<!-- codes: ([0-9a-f]+) -->/.exec(readFileSync(clPath, 'utf8')) || [])[1];
  if (got !== want) bad.push('docs/qa-checklist.md устарел — пересобери: node tools/qa-checklist.mjs');
}

bad.forEach((b) => console.error('РАЗРЫВ · ' + b));
const domain = scenarios.filter((s) => s.kind === 'domain').length;
console.log(`сценариев ${scenarios.length} (исполняемых ${domain}, инструментальных ${scenarios.length - domain})`
  + ` · разрывов ${bad.length} · ошибок разбора ${errors.length}`);
process.exit(bad.length || errors.length ? 1 : 0);
