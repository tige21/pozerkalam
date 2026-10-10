#!/usr/bin/env node
/* Встраивание ассетов в index.html. Картинки — только data: внутри страницы: инструменты открывают
   игру через file://, а внешняя картинка там закрывает канвасу getImageData, и все проверки
   пикселей падают. Блок стоит до основного <script> и сам скриптом не является: mirror-script.sh
   копирует содержимое любого <script…> в codegraph-src, а мутатор ищет <script> у "use strict".
     node tools/assets/embed.mjs           → WebP из build/assets в блок <!-- assets:begin/end -->
     node tools/assets/embed.mjs --check   → код 1: блока нет, не хватает картинки, битый WebP,
                                             страница больше бюджета (@dist-asset-budget)
   Отпечаток констант (build/assets/bake-stamp.json) уходит в data-fingerprint блока: по нему
   tools/blender/consts.mjs --check судит о свежести рендера без папки build/, которой нет в git. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'build', 'assets');
/* EMBED_BUDGET_MB — другой бюджет: так tools/cabin-check.mjs доказывает, что --check краснеет */
const BUDGET = (+process.env.EMBED_BUDGET_MB || 2.2) * 1024 * 1024;
const BEGIN = '<!-- assets:begin — генерат tools/assets/embed.mjs, руками не править -->';
const END = '<!-- assets:end -->';

const FAC_KEYS = ['panel-a', 'panel-b', 'panel-end', 'brick-red', 'brick-yellow', 'brick-end', 'plaster', 'shop-a', 'shop-b'].map((k) => 'fac-' + k);
const FAC_JSON = path.join(SRC, 'fac.json');
const FAC_MAX = 30 * 1024;
/* q 80 для граней салона: на 2048 px разница с q 90 не видна, а вес меньше на треть */
const ASSETS = [
  ...['pz', 'nz', 'px', 'nx', 'py', 'ny'].map((f) => ({ key: 'cabin-' + f, file: `cabin-${f}.png`, q: 80, required: true })),
  /* куб салонного зеркала: из своей точки (у стекла зеркала), куб из глаза для него неверен */
  ...['pz', 'nz', 'px', 'nx', 'py', 'ny'].map((f) => ({ key: 'cmir-' + f, file: `cmir-${f}.png`, q: 80, required: true })),
  /* подушка руля на экране ≈100 px шириной: исходник 1194 px весил 219 КБ */
  { key: 'wheel-pad', file: 'clean/dec-wheel-pad.png', q: 85, required: false, width: 320 },
  /* диски стилей A–E (на экране не шире 120 px). Фары, фонари и решётки стилей в страницу не идут:
     это грани самих моделей кузовов (tools/blender/models.py) */
  { key: 'car-wheel', file: 'clean/dec-wheel.png', q: 85, required: true, width: 256 },
  ...['b', 'c', 'd', 'e'].map((st) => ({ key: `car-wheel-${st}`, file: `clean/dec-wheel-${st}.png`, q: 85, required: true, width: 256 })),
  /* трамвай: торец 2,2 м на экране не шире 500 px даже вблизи, кусок борта 4,7 м — до 1000 */
  { key: 'tram-front', file: 'clean/tram-front.png', q: 82, required: true, width: 512 },
  { key: 'tram-side-end', file: 'clean/tram-side-end.png', q: 82, required: true, width: 1024 },
  { key: 'tram-side-mid', file: 'clean/tram-side-mid.png', q: 82, required: true, width: 1024 },
  /* небо — вся ширина: панорама 360° на экране растягивается втрое и без того */
  { key: 'sky-pano', file: 'clean/sky-pano.png', q: 80, required: true },
  /* фасады домов: 512 px на плитку 6 м — 85 px/м, ближе 45 м этого хватает, все девять ≈110 КБ.
     Размер в метрах и средний цвет — из build/assets/fac.json: игра читает их из атрибутов до
     распаковки картинки, и дальний дом сразу того цвета, что ближний */
  ...FAC_KEYS.map((key) => ({ key, file: `clean/${key}.png`, q: 80, required: true, width: 512, fac: true })),
  /* стекло зеркал (серия 4): боковое на экране не шире 130 px, салонное — 360 px при DPR 2. Контур из
     build/assets/mirror.json идёт в data-outline: по нему игра строит торец корпуса */
  { key: 'mirror-side', file: 'clean/dec-mirror-side.png', q: 85, required: true, width: 200, outline: 'dec-mirror-side' },
  { key: 'mirror-center', file: 'clean/dec-mirror-center.png', q: 85, required: true, width: 320, outline: 'dec-mirror-center' },
];
const MIRROR_JSON = path.join(SRC, 'mirror.json');
/* модель кузова (tools/blender/models.py) — JSON в <template>: шаблон не исполняется и не
   попадает ни в скрипты страницы, ни в зеркало codegraph */
const CAR_MESH = path.join(SRC, 'car-mesh.json');
/* обустройство города (tools/blender/props.py): деревья и кусты — тем же шаблоном */
const PROPS_MESH = path.join(SRC, 'props-mesh.json');
const PROPS_NEED = ['tree-a', 'bush-a'];

const log = (m) => console.log('[embed] ' + m);

function webp(file, q, width) {
  const tmp = path.join(os.tmpdir(), `embed-${process.pid}-${path.basename(file)}.webp`);
  const resize = width ? ['-resize', String(width), '0'] : [];
  execFileSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', '100', '-m', '6', '-metadata', 'none', ...resize, file, '-o', tmp]);
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return buf;
}

function blockRange(html) {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  return a >= 0 && b > a ? [a, b + END.length] : null;
}

function check() {
  const html = fs.readFileSync(HTML, 'utf8');
  const size = Buffer.byteLength(html);
  const fails = [];
  const r = blockRange(html);
  if (!r) fails.push('в index.html нет блока ассетов');
  const block = r ? html.slice(r[0], r[1]) : '';
  for (const a of ASSETS.filter((x) => x.required)) {
    const m = block.match(new RegExp(`data-asset="${a.key}"[^>]*src="data:image/webp;base64,([A-Za-z0-9+/=]+)"`));
    if (!m) { fails.push(`нет картинки ${a.key}`); continue; }
    const head = Buffer.from(m[1].slice(0, 24), 'base64');
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP') fails.push(`${a.key}: не WebP`);
    if (a.fac && !new RegExp(`data-asset="${a.key}" data-m="[0-9.]+x[0-9.]+" data-mean="\\d+,\\d+,\\d+"`).test(block)) fails.push(`${a.key}: нет data-m или data-mean`);
    if (a.outline) {
      const o = block.match(new RegExp(`data-asset="${a.key}" data-outline="([0-9.,;]+)"`));
      if (!o || o[1].split(';').length < 6) fails.push(`${a.key}: нет data-outline или в контуре меньше 6 точек`);
    }
  }
  if (!/data-fingerprint="[0-9a-f]{64}"/.test(block)) fails.push('у блока нет data-fingerprint');
  const tpl = block.match(/<template id="car-mesh">([^<]*)<\/template>/);
  if (!tpl) fails.push('нет модели кузова <template id="car-mesh">');
  else { try { const d = JSON.parse(tpl[1]); if (!d.bodies || !['sedan', 'hatch', 'cross'].every((k) => d.bodies[k] && d.bodies[k].f.length)) fails.push('в модели кузова нет седана, хэтчбека или кроссовера'); } catch { fails.push('модель кузова — не JSON'); } }
  const ptpl = block.match(/<template id="props-mesh">([^<]*)<\/template>/);
  if (!ptpl) fails.push('нет моделей обустройства <template id="props-mesh">');
  else { try { const d = JSON.parse(ptpl[1]); if (!d.models || !PROPS_NEED.every((k) => d.models[k] && d.models[k].f.length)) fails.push(`в моделях обустройства нет ${PROPS_NEED.join(', ')}`); } catch { fails.push('модели обустройства — не JSON'); } }
  log(`index.html ${(size / 1048576).toFixed(2)} МБ, бюджет ${(BUDGET / 1048576).toFixed(1)} МБ, блок ${(block.length / 1048576).toFixed(2)} МБ`);
  if (size > BUDGET) fails.push(`страница ${(size / 1048576).toFixed(2)} МБ больше бюджета`);
  for (const f of fails) console.error('ПРОВАЛ: ' + f);
  if (!fails.length) log('ok: блок цел, картинки WebP, бюджет соблюдён');
  process.exit(fails.length ? 1 : 0);
}

function build() {
  const stampPath = path.join(SRC, 'bake-stamp.json');
  if (!fs.existsSync(stampPath)) throw new Error('нет build/assets/bake-stamp.json — сначала bake-cabin.py');
  const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  if (stamp.quick) throw new Error('рендер куба быстрый (--quick) — в игру идёт только полный');
  if (!stamp.cmir) throw new Error('в рендере нет куба салонного зеркала — bake-cabin.py без --only');
  const axes = (faces) => Object.fromEntries(Object.entries(faces).map(([k, v]) => [k, v.look_right_up]));
  const cube = { eye: stamp.eye, faces: axes(stamp.faces), cmir: { eye: stamp.cmir.eye, faces: axes(stamp.cmir.faces) } };
  const lines = [];
  let total = 0;
  const fac = fs.existsSync(FAC_JSON) ? JSON.parse(fs.readFileSync(FAC_JSON, 'utf8')) : {};
  const mirror = fs.existsSync(MIRROR_JSON) ? JSON.parse(fs.readFileSync(MIRROR_JSON, 'utf8')) : {};
  for (const a of ASSETS) {
    const file = path.join(SRC, a.file);
    if (!fs.existsSync(file)) {
      if (a.required) throw new Error('нет ' + path.relative(ROOT, file));
      log(`нет ${a.file} — пропущено`);
      continue;
    }
    const buf = webp(file, a.q, a.width);
    total += buf.length;
    let attrs = '';
    if (a.fac) {
      const m = fac[a.key];
      if (!m) throw new Error(`нет ${a.key} в build/assets/fac.json — сначала clean.py --only fac`);
      if (buf.length > FAC_MAX) throw new Error(`${a.key}: ${(buf.length / 1024).toFixed(1)} КБ больше предела ${FAC_MAX / 1024} КБ на плитку`);
      attrs = ` data-m="${m.w}x${m.h}" data-mean="${m.mean.join(',')}"`;
    }
    if (a.outline) {
      const pts = mirror[a.outline];
      if (!pts || pts.length < 6) throw new Error(`нет контура ${a.outline} в build/assets/mirror.json — сначала clean.py --only ${a.outline}`);
      attrs = ` data-outline="${pts.map((p) => p.join(',')).join(';')}"`;
    }
    lines.push(`<img data-asset="${a.key}"${attrs} alt="" src="data:image/webp;base64,${buf.toString('base64')}">`);
    log(`${a.key}: ${(fs.statSync(file).size / 1024).toFixed(0)} КБ PNG → ${(buf.length / 1024).toFixed(0)} КБ WebP q${a.q}`);
  }
  if (!fs.existsSync(CAR_MESH)) throw new Error('нет build/assets/car-mesh.json — сначала Blender -b -P tools/blender/models.py');
  const mesh = JSON.parse(fs.readFileSync(CAR_MESH, 'utf8'));
  if (mesh.fingerprint !== stamp.fingerprint) throw new Error('модель кузова собрана на других константах — tools/blender/models.py заново');
  lines.push(`<template id="car-mesh">${JSON.stringify(mesh)}</template>`);
  if (!mesh.bodies || !mesh.bodies.sedan) throw new Error('в car-mesh.json нет кузова sedan — tools/blender/models.py заново');
  log(`car-mesh: ${Object.entries(mesh.bodies).map(([k, b]) => `${k} ${b.f.length}`).join(', ')} граней, ${(JSON.stringify(mesh).length / 1024).toFixed(0)} КБ`);
  if (!fs.existsSync(PROPS_MESH)) throw new Error('нет build/assets/props-mesh.json — сначала Blender -b -P tools/blender/props.py');
  const props = JSON.parse(fs.readFileSync(PROPS_MESH, 'utf8'));
  if (!props.models || !PROPS_NEED.every((k) => props.models[k])) throw new Error(`в props-mesh.json нет ${PROPS_NEED.join(', ')} — tools/blender/props.py заново`);
  lines.push(`<template id="props-mesh">${JSON.stringify(props)}</template>`);
  log(`props-mesh: ${Object.keys(props.models).length} моделей, ${(JSON.stringify(props).length / 1024).toFixed(0)} КБ`);
  const block = [BEGIN,
    `<div id="assets" hidden data-fingerprint="${stamp.fingerprint}" data-baked="${stamp.baked}" data-cube='${JSON.stringify(cube)}'>`,
    ...lines, '</div>', END].join('\n');
  let html = fs.readFileSync(HTML, 'utf8');
  const r = blockRange(html);
  if (r) html = html.slice(0, r[0]) + block + html.slice(r[1]);
  else {
    const at = html.lastIndexOf('<script>', html.indexOf('"use strict"'));
    if (at < 0) throw new Error('не найден основной <script> с "use strict"');
    html = html.slice(0, at) + block + '\n' + html.slice(at);
  }
  fs.writeFileSync(HTML, html);
  log(`картинок ${lines.length}, ${(total / 1024).toFixed(0)} КБ WebP, в base64 ${(total * 4 / 3 / 1024).toFixed(0)} КБ; index.html ${(Buffer.byteLength(html) / 1048576).toFixed(2)} МБ; отпечаток ${stamp.fingerprint.slice(0, 12)}`);
}

if (process.argv.includes('--check')) check();
else build();
