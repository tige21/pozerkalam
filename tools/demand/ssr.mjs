#!/usr/bin/env node
/* Semantic Similarity Rating (Maier и др., 2025; pymc-labs/semantic-similarity-rating):
   ответ персоны текстом переводится в распределение по шкале 1–5 через близость его
   эмбеддинга к эталонным фразам каждой ступени. Прямой вопрос «оцени от 1 до 5» модель
   почти всегда закрывает тройкой или четвёркой; текст, разложенный по эталонам, даёт
   распределение, похожее на людское.
   Эмбеддинги — локальная многоязычная модель, без сети после первой загрузки:
     mkdir -p /tmp/ssr && npm --prefix /tmp/ssr i @huggingface/transformers@3
     SSR_DIR=/tmp/ssr node tools/demand/ssr.mjs --calibrate */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SSR_DIR = process.env.SSR_DIR || '/tmp/ssr';
/* e5-base, а не MiniLM и не e5-small: на калибровке MiniLM не отличает «точно нет» от
   «скорее нет», e5-small перекрывает ступени 1 и 2; e5-base разводит все пять без перекрытия */
export const MODEL = process.env.SSR_MODEL || 'Xenova/multilingual-e5-base';
const EPS = 0.02;

/* Наборы эталонов на русском: разговорный регистр, ценовой и «поможет ли» — среднее по
   наборам сглаживает зависимость от формулировки одного из них */
export const REFS = [
  ['Точно не куплю.', 'Скорее всего не куплю.', 'Не знаю, может быть куплю.', 'Скорее всего куплю.', 'Точно куплю.'],
  ['Нет, мне это не нужно, платить не буду.', 'Вряд ли, жалко денег на такое.', 'Не знаю, надо подумать.', 'Наверное возьму.', 'Да, беру сразу, это то, что мне нужно.'],
  ['За такие деньги ни за что.', 'Дороговато, скорее нет.', 'Цена нормальная, но не уверен, что мне надо.', 'Цена подходящая, скорее заплачу.', 'Заплачу не раздумывая.'],
  ['Мне это никак не поможет, не стану покупать.', 'Сомневаюсь, что поможет, скорее не стану.', 'Может и поможет, посмотрим.', 'Думаю, это поможет, скорее куплю.', 'Это ровно то, что мне сейчас нужно, куплю.'],
];

let embedder;
async function embed(texts) {
  if (!embedder) {
    let tf;
    try { tf = await import(createRequire(path.join(SSR_DIR, 'package.json')).resolve('@huggingface/transformers')); }
    catch { console.error(`@huggingface/transformers не найден в ${SSR_DIR}`); process.exit(2); }
    const pipeline = tf.pipeline ?? tf.default.pipeline;
    /* q8, а не fp32: полная модель в разы больше, и загрузка fp32 однажды оборвалась,
       оставив пустой model.onnx; квантованная шкалу различает (--calibrate) */
    embedder = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  }
  /* e5 обучали с префиксом «query: » на обеих сторонах симметричного сравнения; без него
     близости съезжают */
  const prefix = /e5/i.test(MODEL) ? 'query: ' : '';
  const out = await embedder(texts.map(t => prefix + t), { pooling: 'mean', normalize: true });
  return out.tolist();
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

let refVecs;
export async function rate(texts) {
  refVecs ??= await Promise.all(REFS.map(set => embed(set)));
  const vecs = await embed(texts);
  return vecs.map(v => {
    const pmf = [0, 0, 0, 0, 0];
    for (const set of refVecs) {
      const sim = set.map(r => dot(v, r));
      const lo = Math.min(...sim), at = sim.indexOf(lo);
      const raw = sim.map((s, k) => s - lo + (k === at ? EPS : 0));
      const sum = raw.reduce((a, b) => a + b, 0);
      raw.forEach((x, k) => { pmf[k] += x / sum / refVecs.length; });
    }
    return { pmf, mean: pmf.reduce((s, p, k) => s + p * (k + 1), 0) };
  });
}

/* Проверка шкалы до прогона: фразы с заранее известным намерением обязаны
   выстроиться по возрастанию, иначе модель эмбеддингов не различает ступени */
const CAL = [
  [1, 'Нет. Мне это вообще не надо, деньги на ветер.'],
  [1, 'Ни за что не стану за это платить.'],
  [2, 'Ну не знаю, жалко отдавать за игру, скорее нет.'],
  [2, 'Дорого для такого, вряд ли возьму.'],
  [3, 'Может быть, посмотрю ещё, пока не решил.'],
  [3, 'Не уверена, подумаю перед экзаменом.'],
  [4, 'Наверное куплю, если бесплатные уровни понравятся.'],
  [4, 'Скорее да, цена нормальная.'],
  [5, 'Да, беру сразу, это то, что мне нужно перед экзаменом.'],
  [5, 'Конечно заплачу, сразу.'],
];

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--calibrate')) {
  const res = await rate(CAL.map(c => c[1]));
  const levels = [1, 2, 3, 4, 5].map(l => res.filter((_, i) => CAL[i][0] === l).map(r => r.mean));
  CAL.forEach(([l, t], i) => console.log(`${l} → ${res[i].mean.toFixed(2)}  ${t}`));
  console.log('ступени:', levels.map(xs => `${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)}`).join(' | '));
  const mono = levels.every((xs, i) => i === 0 || Math.min(...xs) > Math.max(...levels[i - 1]));
  console.log(mono ? `ок: ${MODEL} разводит ступени без перекрытия` : `ПЕРЕКРЫТИЕ СТУПЕНЕЙ: ${MODEL} не годится`);
  process.exit(mono ? 0 : 1);
}
