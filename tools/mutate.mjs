#!/usr/bin/env node
/* Мутатор скрипта игры. Stryker сюда не поставить: мутировать надо инлайновый <script>
   в index.html, а зависимостей в проекте нет вовсе. Поэтому правки текстовые, а область
   задана явным списком функций и констант (tools/mutation-zone.json) — мутировать девять
   тысяч строк рендера смысла нет, там ошибка видна глазами, а не расчётом.
     node tools/mutate.mjs --list              # все мутанты области
     node tools/mutate.mjs --list --only sweep # по одной функции
     node tools/mutate.mjs --apply 17 /tmp/m17 # собрать мутанта в каталог
   Мутант, ломающий загрузку страницы, считается убитым: набор обязан это заметить. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'index.html');
const ZONE = JSON.parse(readFileSync(path.join(REPO, 'tools', 'mutation-zone.json'), 'utf8'));

/** границы инлайнового скрипта в index.html */
export function scriptRange(html) {
  const open = html.indexOf('<script>', html.indexOf('"use strict"') - 400);
  const a = html.indexOf('>', open) + 1;
  const b = html.indexOf('</script>', a);
  if (open < 0 || b < 0) throw new Error('не найден инлайновый <script> с "use strict"');
  return { a, b };
}

/** отрезки кода, которые разрешено мутировать: тела функций зоны и объявления констант */
export function zoneRanges(code) {
  const out = [];
  for (const name of ZONE.functions) {
    const re = new RegExp('(^|\\n)function ' + name + '\\s*\\(', 'g');
    let m;
    while ((m = re.exec(code))) {
      const start = m.index + m[1].length;
      let i = code.indexOf('{', start), depth = 0;
      if (i < 0) break;
      for (; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { depth--; if (!depth) break; }
      }
      out.push({ name, a: start, b: i });
    }
  }
  for (const name of ZONE.constants) {
    const re = new RegExp('(^|\\n)const ' + name + '\\s*=', 'g');
    let m;
    while ((m = re.exec(code))) {
      const start = m.index + m[1].length;
      let i = start, depth = 0;
      for (; i < code.length; i++) {
        const c = code[i];
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') depth--;
        else if (c === ';' && !depth) break;
      }
      out.push({ name, a: start, b: i });
    }
  }
  return out.sort((x, y) => x.a - y.a);
}

/** позиции, которые нельзя трогать: строки, комментарии, регулярки */
function maskCode(code) {
  const mask = new Uint8Array(code.length);   /* 1 — не код */
  let i = 0;
  while (i < code.length) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '*') { const e = code.indexOf('*/', i + 2); const end = e < 0 ? code.length : e + 2; mask.fill(1, i, end); i = end; continue; }
    if (c === '/' && d === '/') { const e = code.indexOf('\n', i); const end = e < 0 ? code.length : e; mask.fill(1, i, end); i = end; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) { if (code[j] === '\\') j++; j++; }
      mask.fill(1, i, Math.min(j + 1, code.length)); i = j + 1; continue;
    }
    i++;
  }
  return mask;
}

const OPS = [
  /* арифметика: знак и действие — самые дорогие ошибки в расчёте */
  { find: /(?<![+\-*/=<>!&|(,:?\s])\s\+\s(?![+=])/g, to: ' - ', kind: '+ → -' },
  { find: /(?<![+\-*/=<>!&|(,:?\s])\s-\s(?![-=])/g, to: ' + ', kind: '- → +' },
  { find: /\*(?![*=])/g, to: '/', kind: '* → /' },
  { find: /\/(?![/*=])/g, to: '*', kind: '/ → *' },
  /* границы условий */
  { find: /<=/g, to: '<', kind: '<= → <' },
  { find: />=/g, to: '>', kind: '>= → >' },
  { find: /<(?![=<])/g, to: '<=', kind: '< → <=' },
  { find: />(?![=>])/g, to: '>=', kind: '> → >=' },
  /* логика и равенство */
  { find: /&&/g, to: '||', kind: '&& → ||' },
  { find: /\|\|/g, to: '&&', kind: '|| → &&' },
  { find: /===/g, to: '!==', kind: '=== → !==' },
  { find: /!==/g, to: '===', kind: '!== → ===' },
  /* модуль и выбор края */
  { find: /Math\.abs\(/g, to: '(', kind: 'убран Math.abs' },
  { find: /Math\.min\(/g, to: 'Math.max(', kind: 'min → max' },
  { find: /Math\.max\(/g, to: 'Math.min(', kind: 'max → min' },
];
const NUM = /(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g;

export function mutants() {
  const html = readFileSync(SRC, 'utf8');
  const { a } = scriptRange(html);
  const code = html.slice(a, scriptRange(html).b);
  const mask = maskCode(code);
  const ranges = zoneRanges(code);
  const list = [];
  /* номер строки в index.html, а не в скрипте: по нему открывают файл и его же печатает
     зеркало codegraph — расхождение нумерации стоило бы разбора каждого выжившего вручную */
  const before = html.slice(0, a).split('\n').length - 1;
  const lineOf = (pos) => before + code.slice(0, pos).split('\n').length;
  for (const r of ranges) {
    const chunk = code.slice(r.a, r.b);
    for (const op of OPS) {
      op.find.lastIndex = 0;
      let m;
      while ((m = op.find.exec(chunk))) {
        const pos = r.a + m.index;
        if (mask[pos]) continue;
        list.push({ fn: r.name, pos, len: m[0].length, was: m[0], now: op.to, kind: op.kind, line: lineOf(pos) });
      }
    }
    NUM.lastIndex = 0;
    let m;
    while ((m = NUM.exec(chunk))) {
      const pos = r.a + m.index;
      if (mask[pos]) continue;
      const v = +m[1];
      const to = v === 0 ? '1' : v === 1 ? '0' : String(+(v + 1).toFixed(6));
      list.push({ fn: r.name, pos, len: m[0].length, was: m[0], now: to, kind: 'число ' + m[1] + ' → ' + to, line: lineOf(pos) });
    }
  }
  /* порядок фиксируем по позиции: номер мутанта обязан быть одним и тем же между прогонами */
  list.sort((x, y) => x.pos - y.pos || x.kind.localeCompare(y.kind));
  /* ключ мутанта — функция, правка и отпечаток самой строки, а не номер: номер съезжает от
     любой вставки выше по файлу, и список эквивалентных наутро указывал бы на чужие места.
     Строку правили — ключ меняется, и мутанта надо разобрать заново: это и требуется */
  const lineText = (pos) => {
    const s0 = code.lastIndexOf('\n', pos) + 1;
    const e0 = code.indexOf('\n', pos);
    return code.slice(s0, e0 < 0 ? code.length : e0).trim();
  };
  for (const m of list) {
    const t = lineText(m.pos);
    m.key = m.fn + '|' + m.kind + '|' + createHash('sha1').update(t).digest('hex').slice(0, 8);
  }
  /* одинаковая правка одинаковой строки в одной функции встречается дважды — нумеруем */
  const seen = {};
  for (const m of list) { const n = (seen[m.key] = (seen[m.key] || 0) + 1); if (n > 1) m.key += '#' + n; }
  return { html, a, code, list };
}

export function build(id, dir) {
  const { html, a, list } = mutants();
  const m = list[id];
  if (!m) throw new Error('нет мутанта ' + id);
  const at = a + m.pos;
  const out = html.slice(0, at) + m.now + html.slice(at + m.len);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), out, 'utf8');
  return m;
}

if (process.argv.includes('--list') || process.argv.includes('--apply')) {
  const oi = process.argv.indexOf('--only');
  const only = oi >= 0 ? process.argv[oi + 1] : null;
  if (process.argv.includes('--apply')) {
    const i = +process.argv[process.argv.indexOf('--apply') + 1];
    const dir = process.argv[process.argv.indexOf('--apply') + 2];
    const m = build(i, dir);
    console.log(`мутант ${i}: ${m.fn} · строка ${m.line} · ${m.kind} → ${dir}/index.html`);
  } else {
    const { list } = mutants();
    const sel = list.map((m, i) => ({ ...m, i })).filter((m) => !only || m.fn === only);
    for (const m of sel) console.log(String(m.i).padStart(4) + '  ' + m.fn.padEnd(16) + '  стр ' + String(m.line).padStart(5) + '  ' + m.kind);
    const byFn = {};
    for (const m of sel) byFn[m.fn] = (byFn[m.fn] || 0) + 1;
    console.log('\nвсего ' + sel.length + ' мутантов в ' + Object.keys(byFn).length + ' функциях и константах');
  }
}
