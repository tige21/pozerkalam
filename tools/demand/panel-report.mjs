#!/usr/bin/env node
/* Сводка панели по лендингу: build/demand/landing/answers/*.json → reports/demand/landing-panel.md.
   Доли — share покупателей из personas.json; инструктор (role influencer) идёт отдельно.
   Каждая фраза, которую персона «процитировала» со страницы, сверяется с текстом экранов:
   выдуманная цитата помечается и в подсчёт не идёт — модель охотно цитирует то, чего нет. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIR = path.join(ROOT, 'build', 'demand', 'landing');
const OUT = path.join(ROOT, 'reports', 'demand', 'landing-panel.md');

const { personas } = JSON.parse(fs.readFileSync(path.join(HERE, 'personas.json'), 'utf8'));
const byId = new Map(personas.map(p => [p.id, p]));
const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„]/g, '').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
const manifests = {};
const textOf = dev => (manifests[dev] ??= JSON.parse(fs.readFileSync(path.join(DIR, dev, 'manifest.json'), 'utf8')));
const onPage = (dev, phrase) => {
  const m = textOf(dev), n = norm(phrase);
  return n.length > 0 && m.shots.some(s => norm(s.text).includes(n));
};

const answers = fs.readdirSync(path.join(DIR, 'answers')).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(DIR, 'answers', f), 'utf8')));
const missingIds = personas.map(p => p.id).filter(id => !answers.some(a => a.persona === id));

const buyers = answers.filter(a => byId.get(a.persona)?.role === 'buyer');
const shareSum = buyers.reduce((s, a) => s + byId.get(a.persona).share, 0);
const w = a => byId.get(a.persona).share / shareSum;
const pct = x => `${Math.round(x * 100)} %`;
const wsum = (list, f) => list.reduce((s, a) => s + w(a) * f(a), 0);
const screens = dev => textOf(dev).shots.length;

let fake = 0;
const phrases = new Map();
for (const a of answers) {
  for (const kind of ['unclear', 'convincing']) {
    for (const it of a[kind] ?? []) {
      const ok = onPage(a.device, it.phrase);
      if (!ok) fake++;
      const key = `${kind}|${norm(it.phrase)}`;
      if (!phrases.has(key)) phrases.set(key, { kind, phrase: it.phrase, ok, who: [] });
      phrases.get(key).who.push({ id: a.persona, why: it.why });
    }
  }
}

const name = id => byId.get(id)?.name ?? id;
const cell = s => String(s ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ');
const L = [];
const m0 = textOf('phone');
L.push('# Панель персон по лендингу', '');
L.push(`Страница ${m0.url}, снята ${m0.takenAt.slice(0, 16).replace('T', ' ')} UTC (телефон ${screens('phone')} экранов, десктоп ${fs.existsSync(path.join(DIR, 'desktop', 'manifest.json')) ? screens('desktop') : '—'}).`);
L.push(`Ответили ${answers.length} из ${personas.length}${missingIds.length ? ` (нет: ${missingIds.join(', ')})` : ''}. Сгенерировано \`tools/demand/panel-report.mjs\`, руками не править.`, '');
L.push('Синтетическая панель: проценты взвешены долями персон и показывают, где страница теряет', 'людей, но не сколько их будет на самом деле.', '');

L.push('## Сводка (покупатели, взвешено)', '');
L.push('| показатель | значение |', '|---|---|');
L.push(`| понял(а) с первого экрана (да = 1, отчасти = 0,5) | ${pct(wsum(buyers, a => ({ yes: 1, partly: 0.5 })[a.first_screen?.got_it] ?? 0))} |`);
L.push(`| листает дальше первого экрана | ${pct(wsum(buyers, a => a.first_screen?.scroll ? 1 : 0))} |`);
L.push(`| дочитал(а) до конца | ${pct(wsum(buyers, a => (a.stopped_at ?? 1) >= screens(a.device) ? 1 : 0))} |`);
L.push(`| средняя глубина чтения | ${pct(wsum(buyers, a => Math.min(1, (a.stopped_at ?? 1) / screens(a.device))))} страницы |`);
L.push(`| нажал(а) бы «Начать тренировку» — да / может / нет | ${pct(wsum(buyers, a => a.cta === 'yes' ? 1 : 0))} / ${pct(wsum(buyers, a => a.cta === 'maybe' ? 1 : 0))} / ${pct(wsum(buyers, a => a.cta === 'no' ? 1 : 0))} |`);
L.push(`| цитат, которых нет на странице | ${fake} |`, '');

L.push('## По персонам', '');
L.push('| персона | доля | понял(а) | листает | дочитал(а) до | кнопка | почему |', '|---|---|---|---|---|---|---|');
for (const a of answers) {
  const p = byId.get(a.persona);
  L.push(`| ${p.id} ${cell(p.name)} | ${p.role === 'buyer' ? p.share.toFixed(2) : '—'} | ${a.first_screen?.got_it} | ${a.first_screen?.scroll ? 'да' : 'нет'} | ${a.stopped_at}/${screens(a.device)} | ${a.cta} | ${cell(a.cta_why)} |`);
}
L.push('');

L.push('## Пять вопросов по первому экрану', '');
const Q = [['what', 'Что это'], ['for_whom', 'Для кого'], ['result', 'Что получу'], ['why_continue', 'Зачем смотреть дальше'], ['do_now', 'Что сделать сейчас']];
for (const [k, title] of Q) {
  L.push(`### ${title}`, '');
  for (const a of answers) L.push(`- **${a.persona}** ${cell(a.first_screen?.[k])}`);
  L.push('');
}

for (const [kind, title] of [['unclear', 'Непонятно'], ['convincing', 'Убедило']]) {
  L.push(`## ${title}`, '');
  const list = [...phrases.values()].filter(x => x.kind === kind).sort((a, b) => b.who.length - a.who.length);
  if (!list.length) L.push('—');
  for (const x of list) {
    L.push(`- «${x.phrase}»${x.ok ? '' : ' ⚠ нет на странице'} — ${x.who.map(o => o.id).join(', ')}`);
    for (const o of x.who) L.push(`  - ${o.id}: ${cell(o.why)}`);
  }
  L.push('');
}

L.push('## Возражения', '');
L.push('| персона | возражение | снято | чем |', '|---|---|---|---|');
for (const a of answers) {
  for (const o of a.objections ?? []) {
    const ok = !o.phrase || onPage(a.device, o.phrase);
    L.push(`| ${a.persona} | ${cell(o.objection)} | ${o.answered ? 'да' : 'нет'} | ${o.phrase ? `«${cell(o.phrase)}»${ok ? '' : ' ⚠'}` : '—'} |`);
  }
}
L.push('');

L.push('## Чего не хватило', '');
for (const a of answers) for (const m of a.missing ?? []) L.push(`- **${a.persona}** ${cell(m)}`);
L.push('');

L.push('## Голоса', '');
for (const a of answers) L.push(`- **${a.persona} ${name(a.persona)}:** ${cell(a.voice)}`);
L.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'));
console.log(`${answers.length} ответов, выдуманных цитат ${fake} → ${path.relative(ROOT, OUT)}`);
if (missingIds.length) console.log(`нет ответа: ${missingIds.join(', ')}`);
