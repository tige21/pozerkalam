/* Разбор .feature — общий для трёх потребителей: исполнителя сценариев (gherkin-run),
   гейта связи (gherkin-check) и сборщика чек-листа (qa-checklist). Полноценный парсер
   Gherkin сюда тащить нечем и незачем: зависимостей в проекте нет, а нужный поднабор —
   теги, Функция, Сценарий, шаги и блок Ссылка — разбирается двумя десятками строк.
   Всё, что парсер не понимает, он обязан вернуть ошибкой, а не молча пропустить:
   тихо пропущенный сценарий выглядит как зелёный прогон. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

/* отпечаток набора сценариев: по нему гейт видит, что чек-лист собран не из этих файлов.
   Считается по отсортированным кодам — порядок обхода каталога роли играть не должен */
export function codesHash(scenarios) {
  return createHash('sha1').update(scenarios.map((s) => s.code).sort().join(',')).digest('hex').slice(0, 12);
}

/* теги-обвязки: они говорят про вид и область, а не про конкретное требование */
export const KIND_TAGS = new Set(['domain', 'ui']);
export const AREA_TAGS = new Set(['collision', 'clearance', 'city', 'traffic', 'exam', 'mt']);

const RE_TAG = /@([\w-]+)/g;
const RE_FEATURE = /^(Функция|Feature):\s*(.+)$/;
const RE_SCENARIO = /^(Сценарий|Scenario):\s*(.+)$/;
const RE_STEP = /^(Дано|Когда|Тогда|И|Но|Given|When|Then|And)\s+(.+)$/;
const RE_REF = /^Ссылка:\s*(.+)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.feature')) out.push(full);
  }
  return out;
}

/** @returns {{scenarios: Array, errors: Array<string>}} */
export function parseFeatures(root) {
  const dir = join(root, 'specs', 'features');
  let files = [];
  try { files = walk(dir).sort(); } catch { return { scenarios: [], errors: [`нет каталога ${relative(root, dir)}`] }; }

  const scenarios = [], errors = [];
  for (const file of files) {
    const rel = relative(root, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    if (!/^#\s*language:\s*ru/.test(lines[0] || '')) errors.push(`${rel}:1 — нет строки «# language: ru»`);
    let feature = null, ref = null, pending = [], cur = null;
    lines.forEach((raw, i) => {
      const line = raw.trim();
      const at = `${rel}:${i + 1}`;
      if (!line || line.startsWith('#')) return;
      if (line.startsWith('@')) { pending = [...line.matchAll(RE_TAG)].map((m) => m[1]); return; }
      let m;
      if ((m = RE_FEATURE.exec(line))) { feature = m[2].trim(); cur = null; return; }
      if ((m = RE_REF.exec(line))) { ref = m[1].trim(); return; }
      if ((m = RE_SCENARIO.exec(line))) {
        const tags = pending; pending = [];
        const kind = tags.find((t) => KIND_TAGS.has(t));
        const area = tags.find((t) => AREA_TAGS.has(t));
        const codes = tags.filter((t) => !KIND_TAGS.has(t) && !AREA_TAGS.has(t));
        if (!kind) errors.push(`${at} — нет тега вида (@domain или @ui)`);
        if (!area) errors.push(`${at} — нет тега области (${[...AREA_TAGS].join(', ')})`);
        if (codes.length !== 1) errors.push(`${at} — нужен ровно один код требования, найдено ${codes.length}`);
        if (!ref) errors.push(`${at} — в файле нет блока «Ссылка:»`);
        cur = { file: rel, line: i + 1, feature, ref, title: m[2].trim(), kind, area, code: codes[0], steps: [] };
        scenarios.push(cur);
        return;
      }
      if ((m = RE_STEP.exec(line))) {
        if (!cur) return;                 /* шаги до первого сценария — часть описания функции */
        cur.steps.push({ keyword: m[1], text: m[2].trim(), line: i + 1 });
        return;
      }
      /* описание функции — свободный текст до первого сценария; после него всё обязано разбираться */
      if (cur) errors.push(`${at} — строка не разобрана: «${line.slice(0, 60)}»`);
    });
    for (const s of scenarios.filter((x) => x.file === rel && !x.steps.length))
      errors.push(`${s.file}:${s.line} — сценарий без шагов`);
  }
  const seen = new Map();
  for (const s of scenarios) {
    if (!s.code) continue;
    if (seen.has(s.code)) errors.push(`${s.file}:${s.line} — код «${s.code}» уже занят (${seen.get(s.code)})`);
    else seen.set(s.code, `${s.file}:${s.line}`);
  }
  return { scenarios, errors };
}
