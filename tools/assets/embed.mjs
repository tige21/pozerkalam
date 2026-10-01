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
];

const log = (m) => console.log('[embed] ' + m);

function webp(file, q) {
  const tmp = path.join(os.tmpdir(), `embed-${process.pid}-${path.basename(file)}.webp`);
  execFileSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', '100', '-m', '6', '-metadata', 'none', file, '-o', tmp]);
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
  const cube = { eye: stamp.eye, faces: Object.fromEntries(Object.entries(stamp.faces).map(([k, v]) => [k, v.look_right_up])) };
  const lines = [];
  let total = 0;
  for (const a of ASSETS) {
    const file = path.join(SRC, a.file);
    if (!fs.existsSync(file)) {
      if (a.required) throw new Error('нет ' + path.relative(ROOT, file));
      log(`нет ${a.file} — пропущено`);
      continue;
    }
    const buf = webp(file, a.q);
    total += buf.length;
    lines.push(`<img data-asset="${a.key}" alt="" src="data:image/webp;base64,${buf.toString('base64')}">`);
    log(`${a.key}: ${(fs.statSync(file).size / 1024).toFixed(0)} КБ PNG → ${(buf.length / 1024).toFixed(0)} КБ WebP q${a.q}`);
  }
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
