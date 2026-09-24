#!/usr/bin/env node
/* Экспорт всех учебных текстов городских уровней (23–32) в docs/prompts/hints-current.md —
   таблица для промпта переписывания (docs/prompts/hints-rewrite.md). Тексты берутся из живой
   страницы: name/task/tip/steps/hacks/transfer уровня, все поля фаз (act/hint/why/goal/wheel/
   move/blinker), подписи маркеров marks(), команды экзамена cmd/short по всем трём маршрутам.
   Ключ фазы — её индекс в phases[]: ответ модели вносится по нему.
     PW_DIR=/tmp/pw node tools/hints-export.mjs            # пишет docs/prompts/hints-current.md
     PW_DIR=/tmp/pw node tools/hints-export.mjs --json     # тот же набор в JSON на stdout */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const asJson = process.argv.includes('--json');
const FROM = 22, TO = 31;                 /* индексы LEVELS: 23 … 32 */
let pw;
try { pw = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core'); }
catch { console.error(`playwright-core не найден в ${PW_DIR}: mkdir -p ${PW_DIR} && (cd ${PW_DIR} && npm i playwright-core@1.55)`); process.exit(2); }
function chromeBin() {
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(cache)) return null;
  for (const d of fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse())
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const b = path.join(cache, d, sub, 'chrome-headless-shell'); if (fs.existsSync(b)) return b; }
  return null;
}
const bin = chromeBin();
if (!bin) { console.error('chrome-headless-shell не найден в ~/Library/Caches/ms-playwright'); process.exit(2); }
const browser = await pw.chromium.launch({ executablePath: bin, headless: true });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
page.on('pageerror', (e) => { console.error('PAGEERR', e.message); });
const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
await page.goto(url);
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); });
await page.goto(url + '&r=1'); await page.waitForTimeout(300);
const data = await page.evaluate(([from, to]) => {
  const levels = [];
  for (let i = from; i <= to; i++) {
    const d = LEVELS[i]; loadLevel(i); hideOv(); paused = true;
    const marks = []; const mk = level.marks || {};
    for (const k in mk) if (mk[k] && mk[k].label) marks.push({ key: k, label: mk[k].label });
    const phases = (d.phases || []).map((p, j) => ({
      i: j, icon: p.icon || '', act: p.act || '', hint: p.hint || '', why: p.why || '',
      goal: p.goal ? (p.goal.text ? 'text: ' + p.goal.text : p.goal.metric + ' ' + (p.goal.dir === 'up' ? '≥' : '≤') + ' ' + p.goal.target) : '',
      wheel: p.wheel || '', move: p.move || '', blinker: p.blinker || '', marks: (p.marks || []).join(', ') }));
    const demo = DEMOS[i] ? DEMOS[i].segs.filter((s) => s.say).map((s, j) => ({ i: j, say: s.say })) : [];
    let exam = null;
    if (d.examRoute) {
      const seen = new Map();
      for (let k = 0; k < 24; k++) for (const st of d.examRoute()) if (!seen.has(st.cmd)) seen.set(st.cmd, st.short);
      exam = [...seen].map(([cmd, short]) => ({ cmd, short }));
    }
    levels.push({ i, name: d.name, task: d.task || '', tip: d.tip || '', steps: d.steps || [], refs: d.refs || '',
      hacks: d.hacks || [], transfer: d.transfer || '', marks, phases, demo, exam });
  }
  loadLevel(0);
  return levels;
}, [FROM, TO]);
await browser.close();
if (asJson) { console.log(JSON.stringify(data, null, 1)); process.exit(0); }
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const out = [];
out.push('# Тексты городских уровней — текущая версия');
out.push('');
out.push('Генерат `tools/hints-export.mjs`, руками не править. Ключ фазы — индекс в `phases[]` уровня.');
out.push('Число фаз, порядок, `goal`, названия улиц и цифры — фиксированы (см. hints-rewrite.md).');
out.push('');
for (const L of data) {
  out.push('## ' + L.name);
  out.push('');
  out.push('- **task:** ' + L.task);
  if (L.tip) out.push('- **tip:** ' + L.tip);
  if (L.refs) out.push('- **refs:** ' + L.refs);
  if (L.steps.length) { out.push('- **steps:**'); L.steps.forEach((s, j) => out.push('  ' + (j + 1) + '. ' + s)); }
  if (L.hacks.length) { out.push('- **hacks:**'); L.hacks.forEach((s) => out.push('  - ' + s)); }
  if (L.transfer) out.push('- **transfer:** ' + L.transfer);
  if (L.marks.length) { out.push('- **marks:** ' + L.marks.map((m) => '`' + m.key + '` «' + m.label + '»').join(' · ')); }
  if (L.demo.length) { out.push('- **demo say:**'); L.demo.forEach((s) => out.push('  - ' + s.say)); }
  if (L.phases.length) {
    out.push('');
    out.push('| # | icon | act | goal | wheel / move / blinker | hint | why |');
    out.push('|---|---|---|---|---|---|---|');
    for (const p of L.phases)
      out.push('| ' + p.i + ' | ' + p.icon + ' | ' + esc(p.act) + ' | ' + esc(p.goal) + ' | ' + [p.wheel, p.move, p.blinker].filter(Boolean).join(' / ') + ' | ' + esc(p.hint) + ' | ' + esc(p.why) + ' |');
  }
  if (L.exam) {
    out.push('');
    out.push('| cmd | short |'); out.push('|---|---|');
    for (const e of L.exam) out.push('| ' + esc(e.cmd) + ' | ' + esc(e.short) + ' |');
  }
  out.push('');
}
const dst = path.join(ROOT, 'docs', 'prompts', 'hints-current.md');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, out.join('\n') + '\n');
console.log('записано ' + path.relative(ROOT, dst) + ': уровней ' + data.length + ', фаз ' + data.reduce((n, l) => n + l.phases.length, 0));
