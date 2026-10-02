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

/* q 80 для граней салона: на 2048 px разница с q 90 не видна, а вес меньше на треть */
const ASSETS = [
  ...['pz', 'nz', 'px', 'nx', 'py', 'ny'].map((f) => ({ key: 'cabin-' + f, file: `cabin-${f}.png`, q: 80, required: true })),
  /* куб салонного зеркала: из своей точки (у стекла зеркала), куб из глаза для него неверен */
  ...['pz', 'nz', 'px', 'nx', 'py', 'ny'].map((f) => ({ key: 'cmir-' + f, file: `cmir-${f}.png`, q: 80, required: true })),
  /* подушка руля на экране ≈100 px шириной: исходник 1194 px весил 219 КБ */
  { key: 'wheel-pad', file: 'clean/dec-wheel-pad.png', q: 85, required: false, width: 320 },
  /* кузов снаружи: фара и фонарь на экране не шире 150 px даже у своей машины вблизи, диск — 120 */
  { key: 'car-headlight', file: 'clean/dec-headlight.png', q: 85, required: true, width: 384 },
  { key: 'car-taillight', file: 'clean/dec-taillight.png', q: 85, required: true, width: 384 },
  { key: 'car-grille', file: 'clean/dec-grille.png', q: 85, required: true, width: 320 },
  { key: 'car-wheel', file: 'clean/dec-wheel.png', q: 85, required: true, width: 256 },
];
/* модель кузова (tools/blender/export-exterior.py) — JSON в <template>: шаблон не исполняется и не
   попадает ни в скрипты страницы, ни в зеркало codegraph */
const CAR_MESH = path.join(SRC, 'car-mesh.json');

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
  }
  if (!/data-fingerprint="[0-9a-f]{64}"/.test(block)) fails.push('у блока нет data-fingerprint');
  const tpl = block.match(/<template id="car-mesh">([^<]*)<\/template>/);
  if (!tpl) fails.push('нет модели кузова <template id="car-mesh">');
  else { try { const d = JSON.parse(tpl[1]); if (!d.bodies || !['sedan', 'hatch', 'cross'].every((k) => d.bodies[k] && d.bodies[k].f.length)) fails.push('в модели кузова нет седана, хэтчбека или кроссовера'); } catch { fails.push('модель кузова — не JSON'); } }
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
  for (const a of ASSETS) {
    const file = path.join(SRC, a.file);
    if (!fs.existsSync(file)) {
      if (a.required) throw new Error('нет ' + path.relative(ROOT, file));
      log(`нет ${a.file} — пропущено`);
      continue;
    }
    const buf = webp(file, a.q, a.width);
    total += buf.length;
    lines.push(`<img data-asset="${a.key}" alt="" src="data:image/webp;base64,${buf.toString('base64')}">`);
    log(`${a.key}: ${(fs.statSync(file).size / 1024).toFixed(0)} КБ PNG → ${(buf.length / 1024).toFixed(0)} КБ WebP q${a.q}`);
  }
  if (!fs.existsSync(CAR_MESH)) throw new Error('нет build/assets/car-mesh.json — сначала python3 tools/blender/export-exterior.py');
  const mesh = JSON.parse(fs.readFileSync(CAR_MESH, 'utf8'));
  if (mesh.fingerprint !== stamp.fingerprint) throw new Error('модель кузова собрана на других константах — export-exterior.py заново');
  lines.push(`<template id="car-mesh">${JSON.stringify(mesh)}</template>`);
  if (!mesh.bodies || !mesh.bodies.sedan) throw new Error('в car-mesh.json нет кузова sedan — export-exterior.py заново');
  log(`car-mesh: ${Object.entries(mesh.bodies).map(([k, b]) => `${k} ${b.f.length}`).join(', ')} граней, ${(JSON.stringify(mesh).length / 1024).toFixed(0)} КБ`);
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
