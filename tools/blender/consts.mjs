#!/usr/bin/env node
/* Константы машины и салона из index.html для сцены Blender. Пререндер салона обязан стоять ровно
   там, где игра рисует руль, щиток, рычаг и считает линии обзора, поэтому числа не переписываются
   руками, а вынимаются из самого index.html: объявления берутся по именам и исполняются в
   песочнице node:vm — весь скрипт игры без DOM не исполнить.
     node tools/blender/consts.mjs           → build/blender/consts.json + отпечаток в stdout
     node tools/blender/consts.mjs --check   → код 1, если отпечаток не равен data-fingerprint блока ассетов
   --check — это гейт @render-cabin-bake-fresh: правка EYE или WHEEL без перерендера куба валит его.
   Отпечаток рендера берётся из самого index.html (его вписывает tools/assets/embed.mjs), а не из
   build/: папки build/ нет в git, а судить надо о той сборке, что уедет на прод. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/* CONSTS_SRC — другой файл вместо index.html: так tools/cabin-check.mjs доказывает, что --check краснеет */
const SRC = process.env.CONSTS_SRC ? path.resolve(process.env.CONSTS_SRC) : path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'build', 'blender', 'consts.json');

/* порядок — порядок зависимостей: HALF_L читает CAR, CAR_HULL_LOFT читает CAR_ST и hull2. В игре
   CAR_HULL — след модели кузова (из car-mesh.json, который сам строится по этим константам), сюда
   идёт след лофта под прежним именем: отпечаток рендера салона от модели кузова не зависит */
const STATEMENTS = ['PI', 'rad', 'CAR', 'HALF_L', 'C2R', 'EYE', 'CAR_ST', 'HOOD_Z', 'MIR_H', 'WSHIELD',
  'CMIR', 'WHEEL', 'CLUSTER', 'REPEATER', 'SELECTOR', 'SEL_ORDER'];
const FUNCTIONS = ['hull2'];
const TAIL = ['CAR_HULL_LOFT'];
const EXPORT = ['CAR', 'C2R', 'EYE', 'CAR_ST', 'HOOD_Z', 'HOOD_Y', 'MIR_H', 'WSHIELD', 'CMIR', 'WHEEL',
  'CLUSTER', 'REPEATER', 'SELECTOR', 'SEL_ORDER', 'CAR_HULL'];

/* конец объявления — `;` на нулевой глубине скобок; строки и комментарии пропускаются, иначе
   точка с запятой внутри комментария к станции кузова обрезала бы массив */
function statementEnd(src, from, untilBrace) {
  let depth = 0, seenBrace = false;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if ('([{'.includes(c)) { depth++; if (c === '{') seenBrace = true; continue; }
    if (')]}'.includes(c)) { depth--; if (untilBrace && seenBrace && depth === 0 && c === '}') return i + 1; continue; }
    if (!untilBrace && c === ';' && depth === 0) return i + 1;
  }
  throw new Error('объявление не закрыто, начало ' + from);
}

function extract(src, name, kind) {
  const re = kind === 'function' ? new RegExp('^function ' + name + '\\(', 'm') : new RegExp('^const ' + name + '\\b', 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`в index.html нет объявления ${kind === 'function' ? 'function ' : 'const '}${name}`);
  return src.slice(m.index, statementEnd(src, m.index, kind === 'function'));
}

const html = fs.readFileSync(SRC, 'utf8');
const parts = [
  ...STATEMENTS.map((n) => extract(html, n, 'const')),
  ...FUNCTIONS.map((n) => extract(html, n, 'function')),
  ...TAIL.map((n) => extract(html, n, 'const')),
];
const code = parts.join('\n') + `\nconst CAR_HULL = CAR_HULL_LOFT;\n;({${EXPORT.join(',')}})`;
const consts = vm.runInNewContext(code, { Math });

const hoodDeg = Math.atan2(consts.HOOD_Y - consts.EYE.y, consts.HOOD_Z - consts.EYE.z) * 180 / Math.PI;
const data = { consts, derived: { hoodDeg } };
const fingerprint = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');

const short = (v) => {
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
};
for (const k of EXPORT) console.log(`${k.padEnd(9)} ${Array.isArray(consts[k]) ? `[${consts[k].length}] ` : ''}${short(consts[k])}`);
console.log(`hoodDeg   ${hoodDeg.toFixed(2)}° (линия капота из EYE)`);
console.log(`отпечаток ${fingerprint}`);

if (process.argv.includes('--check')) {
  const baked = (html.match(/<div id="assets"[^>]*data-fingerprint="([0-9a-f]{64})"/) || [])[1];
  if (!baked) {
    console.error('ПРОВАЛ: в index.html нет встроенного салона с отпечатком (tools/assets/embed.mjs)');
    process.exit(1);
  }
  if (baked !== fingerprint) {
    console.error(`ПРОВАЛ: константы изменились после рендера куба — ${baked.slice(0, 12)} в рендере, ${fingerprint.slice(0, 12)} в index.html; перерендерить салон`);
    process.exit(1);
  }
  console.log('ok: рендер салона сделан на текущих константах');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ fingerprint, ...data }, null, 1));
  console.log('записано ' + path.relative(ROOT, OUT));
}
