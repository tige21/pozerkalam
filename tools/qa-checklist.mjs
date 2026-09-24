#!/usr/bin/env node
/* Чек-лист ручной проверки из тех же сценариев. Правится сценарий, а не чек-лист:
   файл перезаписывается целиком, и ручная правка в нём пропадёт при следующей сборке.
   Владелец здесь сам себе тестировщик, поэтому у каждого пункта стоит, кто его проходит:
   «авто» исполняет раннер и человеку он нужен как источник эталонных чисел, «руками» —
   то, что закрыто инструментом в браузере и что стоит пройти глазами перед деплоем.
     node tools/qa-checklist.mjs
     node tools/qa-checklist.mjs --area traffic --out docs/qa-potok.md */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeatures, codesHash } from './gherkin-parse.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const area = val('--area');
const only = val('--only');
const out = val('--out') || 'docs/qa-checklist.md';

const { scenarios, errors } = parseFeatures(REPO);
if (errors.length) { errors.forEach((e) => console.error('ОШИБКА РАЗБОРА · ' + e)); process.exit(1); }

const AREA_RU = { collision: 'Касания и габариты', clearance: 'Зазоры и обзор', city: 'Город и разметка',
  traffic: 'Поток машин', exam: 'Экзамен', mt: 'Механическая коробка', dist: 'Сборки для площадок', app: 'Устойчивость приложения' };

const list = scenarios
  .filter((s) => (!area || s.area === area) && (!only || s.kind === only))
  .sort((a, b) => (a.area + a.code).localeCompare(b.area + b.code));

const lines = [
  '# Чек-лист проверки',
  '',
  'Собран из `specs/features` командой `node tools/qa-checklist.mjs`. Руками не правится —',
  'правится сценарий, файл пересобирается в том же коммите.',
  '',
  '«авто» — исполняет `tools/gherkin-run.mjs`, человеку нужен как источник эталонных чисел.',
  '«руками» — закрыто инструментом в браузере, перед деплоем стоит пройти глазами.',
  '',
  /* отпечаток ставим только у полного чек-листа: частичный не вправе объявлять,
     что покрывает весь набор */
  ...(area || only ? [] : [`<!-- codes: ${codesHash(scenarios)} -->`, '']),
];
let curArea = null;
for (const s of list) {
  if (s.area !== curArea) {
    curArea = s.area;
    lines.push(`## ${AREA_RU[curArea] || curArea}`, '');
  }
  lines.push(`### ${s.title}`, '',
    `\`${s.code}\` · ${s.kind === 'domain' ? 'авто' : 'руками'} · \`${s.file}:${s.line}\``, '');
  if (s.ref) lines.push(`Ссылка: ${s.ref}`, '');
  for (const st of s.steps) lines.push(`- **${st.keyword}** ${st.text}`);
  lines.push('');
}
writeFileSync(path.join(REPO, out), lines.join('\n'), 'utf8');
const areas = new Set(list.map((s) => s.area)).size;
console.log(`собрано ${list.length} сценариев в ${areas} областях → ${out}`);
