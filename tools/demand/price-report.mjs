#!/usr/bin/env node
/* Сводка фокус-группы по цене: build/demand/price/answers/*.json → reports/demand/price-panel.md.
   Намерение купить считается двумя способами: SSR по живому ответу (ssr.mjs) и прямой
   оценкой 1–5. Первый прогон показал, что SSR не годится в судьи один: ответ «бесплатной
   попытки хватит, платить незачем» не содержит слов отказа, и эмбеддинг ставит его в середину
   шкалы. Поэтому рядом — прямая оценка, выбор и доля «никогда», а при расхождении решают тексты.
     SSR_DIR=/tmp/ssr node tools/demand/price-report.mjs [--answers <папка>] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rate, MODEL } from './ssr.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const PRICE = path.join(ROOT, 'build', 'demand', 'price');
const ai = process.argv.indexOf('--answers');
const ANSWERS = ai > 0 ? process.argv[ai + 1] : path.join(PRICE, 'answers');
const OUT = path.join(ROOT, 'reports', 'demand', 'price-panel.md');

const { personas } = JSON.parse(fs.readFileSync(path.join(HERE, 'personas.json'), 'utf8'));
const { offers } = JSON.parse(fs.readFileSync(path.join(HERE, 'offers.json'), 'utf8'));
const order = JSON.parse(fs.readFileSync(path.join(PRICE, 'order.json'), 'utf8'));
const byId = new Map(personas.map(p => [p.id, p]));

const answers = fs.readdirSync(ANSWERS).filter(f => /^p\d+\.json$/.test(f)).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(ANSWERS, f), 'utf8')));
const problems = [];
const rows = [];
for (const a of answers) {
  const map = order[a.persona];
  if (!map) { problems.push(`${a.persona}: нет в order.json`); continue; }
  for (const [num, offer] of Object.entries(map)) {
    const r = a.offers?.[num];
    if (!r?.text) { problems.push(`${a.persona}: нет ответа на вариант ${num} (${offer})`); continue; }
    rows.push({ persona: a.persona, offer, pos: +num, ...r });
  }
}
const scores = await rate(rows.map(r => r.text));
rows.forEach((r, i) => Object.assign(r, { ssr: scores[i].mean, pmf: scores[i].pmf }));

const present = [...new Set(rows.map(r => r.persona))];
const shareSum = present.reduce((s, id) => s + byId.get(id).share, 0);
const w = id => byId.get(id).share / shareSum;
const wmean = (list, f) => {
  const ws = list.reduce((s, r) => s + w(r.persona), 0);
  return ws ? list.reduce((s, r) => s + w(r.persona) * f(r), 0) / ws : NaN;
};
const wmedian = pairs => {
  const xs = pairs.filter(([v]) => Number.isFinite(v) && v > 0).sort((a, b) => a[0] - b[0]);
  const total = xs.reduce((s, [, ww]) => s + ww, 0);
  let acc = 0;
  for (const [v, ww] of xs) { acc += ww; if (acc >= total / 2) return v; }
  return NaN;
};
const f2 = x => Number.isFinite(x) ? x.toFixed(2).replace('.', ',') : '—';
const pc = x => Number.isFinite(x) ? `${Math.round(x * 100)} %` : '—';
const rub = x => Number.isFinite(x) ? `${Math.round(x).toLocaleString('ru-RU')} ₽` : '—';
const cell = s => String(s ?? '—').replace(/\|/g, '/').replace(/\s+/g, ' ');
const seg = id => byId.get(id).segment;
const WHEN = { now: 'сразу', later: 'когда упрусь', exam: 'перед экзаменом', fail: 'после провала', never: 'никогда' };

const L = [];
L.push('# Фокус-группа по цене', '');
L.push(`Ответили ${present.length} из ${personas.filter(p => p.role === 'buyer').length} персон-покупателей, вариантов ${offers.length}. SSR — \`${MODEL}\`, 4 набора эталонов.`);
L.push('Сгенерировано `tools/demand/price-report.mjs`, руками не править.', '');
L.push('Синтетика: годится, чтобы расставить варианты по порядку и найти, что останавливает. Это не', 'прогноз доли купивших. SSR и прямая оценка могут расходиться: SSR не слышит отказ без слов', 'отказа («бесплатного хватит»). При расхождении читать тексты ниже.', '');
if (problems.length) L.push('**Пропуски:** ' + problems.join('; '), '');

L.push('## Варианты (взвешено долями персон)', '');
L.push('| вариант | SSR, среднее 1–5 | «да» P(4)+P(5) | «нет» P(1)+P(2) | прямая оценка | выбрали бы | SSR, ученики (A) | SSR, водители (B) |', '|---|---|---|---|---|---|---|---|');
const picks = Object.fromEntries(offers.map(o => [o.id, 0]));
let pickNone = 0;
for (const a of answers) {
  const id = a.pick != null ? order[a.persona]?.[String(a.pick)] : null;
  if (id) picks[id] += w(a.persona); else pickNone += w(a.persona);
}
const ranked = offers.map(o => ({ o, list: rows.filter(r => r.offer === o.id) }))
  .map(x => ({ ...x, mean: wmean(x.list, r => r.ssr) })).sort((a, b) => b.mean - a.mean);
for (const { o, list, mean } of ranked) {
  L.push(`| ${o.id} | ${f2(mean)} | ${pc(wmean(list, r => r.pmf[3] + r.pmf[4]))} | ${pc(wmean(list, r => r.pmf[0] + r.pmf[1]))} | ${f2(wmean(list, r => r.direct))} | ${pc(picks[o.id])} | ${f2(wmean(list.filter(r => seg(r.persona) === 'A'), r => r.ssr))} | ${f2(wmean(list.filter(r => seg(r.persona) === 'B'), r => r.ssr))} |`);
}
L.push(`| ни один | | | | | ${pc(pickNone)} | | |`, '');
L.push('Варианты: ' + offers.map(o => `**${o.id}** — ${o.card.split('.')[0]}`).join('; ') + '.', '');

L.push('## Когда заплатили бы', '');
L.push(`| вариант | ${Object.values(WHEN).join(' | ')} |`, `|---|${Object.keys(WHEN).map(() => '---').join('|')}|`);
for (const { o, list } of ranked) L.push(`| ${o.id} | ${Object.keys(WHEN).map(k => pc(wmean(list, r => r.when === k ? 1 : 0))).join(' | ')} |`);
L.push('');

L.push('## Цена «курса» одним платежом (взвешенная медиана)', '');
const wtp = k => wmedian(answers.map(a => [Number(a.wtp?.[k]), w(a.persona)]));
L.push('| подозрительно дёшево | выгодно | дорого, но подумал(а) бы | не куплю ни при каких |', '|---|---|---|---|');
L.push(`| ${rub(wtp('too_cheap'))} | ${rub(wtp('cheap'))} | ${rub(wtp('expensive'))} | ${rub(wtp('too_expensive'))} |`, '');
L.push('| персона | дёшево | выгодно | дорого | не куплю | разово или подписка |', '|---|---|---|---|---|---|');
for (const a of answers) {
  const v = a.wtp ?? {};
  L.push(`| ${a.persona} ${cell(byId.get(a.persona).name)} | ${rub(+v.too_cheap)} | ${rub(+v.cheap)} | ${rub(+v.expensive)} | ${rub(+v.too_expensive)} | ${a.once_vs_sub?.choice ?? '—'}: ${cell(a.once_vs_sub?.why)} |`);
}
L.push('');
const sub = k => answers.reduce((s, a) => s + (a.once_vs_sub?.choice === k ? w(a.persona) : 0), 0);
L.push(`Разово ${pc(sub('once'))}, подписка ${pc(sub('sub'))}, никак ${pc(sub('none'))}.`, '');

L.push('## Порядок показа', '');
L.push('Среднее SSR по месту варианта в списке. Сильный наклон — признак того, что ответы зависят от', 'порядка, а не от варианта.', '');
L.push('| место | 1 | 2 | 3 | 4 |', '|---|---|---|---|---|');
L.push(`| SSR | ${[1, 2, 3, 4].map(p => f2(wmean(rows.filter(r => r.pos === p), r => r.ssr))).join(' | ')} |`, '');

L.push('## Ответы', '');
for (const { o } of ranked) {
  L.push(`### ${o.id}`, '');
  for (const r of rows.filter(x => x.offer === o.id)) {
    L.push(`- **${r.persona} ${byId.get(r.persona).name}** — SSR ${f2(r.ssr)}, прямо ${r.direct}, ${WHEN[r.when] ?? r.when}: ${cell(r.text)}${r.stopper ? ` *Остановит: ${cell(r.stopper)}*` : ''}`);
  }
  L.push('');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'));
console.log(`${present.length} персон, ${rows.length} ответов → ${path.relative(ROOT, OUT)}`);
for (const { o, mean } of ranked) console.log(`${o.id}: SSR ${mean.toFixed(2)}`);
if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
