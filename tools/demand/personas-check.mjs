// Персона без опоры на цитату — это фантазия модели, а не голос покупателя.
// Проверка держит связь: каждая ссылка ev существует, каждая фраза из words
// дословно стоит в какой-то цитате, доли покупателей дают ровно 1.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const quotes = new Map(
  readFileSync(join(here, 'quotes.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map((l) => JSON.parse(l)).map((q) => [q.id, q]),
);
const { personas } = JSON.parse(readFileSync(join(here, 'personas.json'), 'utf8'));
const errors = [];
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const texts = [...quotes.values()].filter((q) => q.quote).map((q) => norm(q.quote));

const evOf = (node) => (Array.isArray(node) ? node.flatMap(evOf)
  : node && typeof node === 'object' ? [...(node.ev ?? []), ...Object.values(node).flatMap(evOf)] : []);

let share = 0;
for (const p of personas) {
  if (p.role === 'buyer') share += p.share;
  for (const id of new Set(evOf(p))) if (!quotes.has(id)) errors.push(`${p.id}: нет цитаты ${id}`);
  for (const w of p.words) if (!texts.some((t) => t.includes(norm(w)))) errors.push(`${p.id}: фразы нет в цитатах — «${w}»`);
  for (const k of ['pains', 'objections']) {
    for (const item of p[k]) if (!item.ev?.length && !item.assumed) errors.push(`${p.id}.${k}: без опоры — «${item.text}»`);
  }
  if (!(p.skepticism >= 1 && p.skepticism <= 5)) errors.push(`${p.id}: skepticism вне 1–5`);
}
if (Math.abs(share - 1) > 1e-9) errors.push(`доли покупателей дают ${share.toFixed(3)}, а не 1`);

const used = new Set(personas.flatMap(evOf));
console.log(`персон ${personas.length}, цитат ${quotes.size}, опирается ${used.size}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ок');
