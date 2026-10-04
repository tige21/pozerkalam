#!/usr/bin/env node
/* Файл для фокус-группы по цене: карточка персоны + тренажёр + варианты под нейтральными
   номерами в своём порядке на персону. Порядок фиксирован зерном из id, чтобы прогон
   повторялся; соответствие номер → вариант пишется в order.json и наружу не показывается.
     node tools/demand/price-setup.mjs   → build/demand/price/{pNN.md, order.json} */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { briefOf, personas } from './brief.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'build', 'demand', 'price');
const { product, offers } = JSON.parse(fs.readFileSync(path.join(HERE, 'offers.json'), 'utf8'));

function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, seed) {
  const r = rng(seed), a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

fs.mkdirSync(OUT, { recursive: true });
const order = {};
for (const p of personas.filter(x => x.role === 'buyer')) {
  const list = shuffled(offers, `price|${p.id}`);
  order[p.id] = Object.fromEntries(list.map((o, i) => [String(i + 1), o.id]));
  const md = [
    briefOf(p.id),
    '## Тренажёр',
    '',
    product,
    '',
    '## Варианты',
    '',
    ...list.flatMap((o, i) => [`### Вариант ${i + 1}`, '', `Когда появляется: ${o.when}`, '', `> ${o.card}`, '']),
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `${p.id}.md`), md);
}
fs.writeFileSync(path.join(OUT, 'order.json'), JSON.stringify(order, null, 1));
console.log(`${Object.keys(order).length} персон → ${path.relative(ROOT, OUT)}`);
