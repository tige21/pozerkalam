#!/usr/bin/env node
/* Карточка персоны для роли: поля из personas.json плюс её собственные цитаты.
   Цитаты идут дословно — по ним модель держит голос и не скатывается в вежливого
   «среднего пользователя».
     node tools/demand/brief.mjs            → build/demand/briefs/pNN.md для всех
     node tools/demand/brief.mjs p03        → карточка одной персоны в stdout */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MAX_QUOTES = 6;

const quotes = new Map(
  fs.readFileSync(path.join(HERE, 'quotes.jsonl'), 'utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l)).map(q => [q.id, q]),
);
export const { personas } = JSON.parse(fs.readFileSync(path.join(HERE, 'personas.json'), 'utf8'));

const norm = s => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/* Сначала цитаты, из которых взяты её слова, потом опоры болей и возражений */
function quotesOf(p) {
  const ids = [];
  const add = id => { if (quotes.get(id)?.quote && !ids.includes(id)) ids.push(id); };
  for (const w of p.words) for (const [id, q] of quotes) if (q.quote && norm(q.quote).includes(norm(w))) { add(id); break; }
  for (const k of ['pains', 'objections', 'triggers']) for (const it of p[k]) for (const id of it.ev ?? []) add(id);
  return ids.slice(0, MAX_QUOTES).map(id => quotes.get(id));
}

const line = it => `- ${it.text}`;

export function briefOf(id) {
  const p = personas.find(x => x.id === id);
  if (!p) throw new Error(`нет персоны ${id}`);
  const f = p.facts;
  return [
    `# ${p.name}`,
    '',
    p.situation,
    '',
    `Город: ${f.city}. Коробка: ${f.gearbox}. Сейчас: ${f.stage}. Устройство: ${f.device}. Деньги: ${f.money}.`,
    `Скепсис ${p.skepticism} из 5${p.skepticism >= 4 ? ' — по умолчанию отказываешься, пока страница не докажет обратное' : ''}.`,
    '',
    '## Что хочешь получить',
    ...p.jobs.map(j => `- ${j}`),
    '',
    '## Что болит',
    ...p.pains.map(line),
    '',
    '## Когда начинаешь искать',
    ...p.triggers.map(line),
    '',
    '## Что уже пробовал(а)',
    ...p.tried.map(line),
    '',
    '## Деньги',
    `- с чем сравниваешь: ${p.price.anchor}`,
    `- отношение: ${p.price.attitude}`,
    `- подписка: ${p.price.subscription}`,
    '',
    '## Твои возражения',
    ...p.objections.map(line),
    '',
    '## Как ты говоришь',
    ...p.words.map(w => `- «${w}»`),
    '',
    '## Живые слова людей, из которых ты собран(а)',
    ...quotesOf(p).map(q => `> ${q.quote}\n> — ${q.who || 'автор'}, ${q.site}`),
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const one = process.argv[2];
  if (one) process.stdout.write(briefOf(one));
  else {
    const dir = path.join(ROOT, 'build', 'demand', 'briefs');
    fs.mkdirSync(dir, { recursive: true });
    for (const p of personas) fs.writeFileSync(path.join(dir, `${p.id}.md`), briefOf(p.id));
    console.log(`${personas.length} карточек → ${path.relative(ROOT, dir)}`);
  }
}
