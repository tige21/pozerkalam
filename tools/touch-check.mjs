#!/usr/bin/env node
/* Раскладка тач-полосы на телефонах и настройка «графика: максимум».
   Запуск (playwright-core ставится во временную папку, см. cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/touch-check.mjs
     PW_DIR=/tmp/pw URL=https://pozerkalam.space/play/ node tools/touch-check.mjs   # проверить прод
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const URL_OVERRIDE = process.env.URL || '';

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  for (const d of fs.readdirSync(cache).filter(x => x.startsWith('chromium_headless_shell-')).sort().reverse())
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const bin = path.join(cache, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  console.error('Chromium не найден'); process.exit(2);
}

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });

const url = (URL_OVERRIDE || 'file://' + path.join(ROOT, 'index.html')) + '?nocache=' + Date.now();
await page.goto(url);
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0'); });
await page.goto(url + 'r');
await page.waitForTimeout(500);

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

/* «максимум» отключает регулятор: сниженный уровень качества игрок читает как пропавшие текстуры */
const gfx = await page.evaluate(() => { const before = opt.gfx; opt.gfx = 'max'; qBest = 0; qApply(0); frameGap = 40; qCoolT = 0;
  qTick(2); const held = qLevel; opt.gfx = 'auto'; qCoolT = 0; qTick(2); return { before, held, after: qLevel }; });
check('«графика: максимум» держит уровень качества', gfx.held === 0 && gfx.after > 0, JSON.stringify(gfx));

/* ни одна цель тач-полосы не должна лежать под другой. Стрелки поворотников были полностью
   накрыты кнопками ≡ и ⟲, потому что их смещения считали ряд по четырём буквам передач,
   а плиток в нём шесть */
const sizes = [[568, 320], [667, 375], [740, 360], [844, 390], [932, 430]];
const layoutBad = [];
for (const [W, H] of sizes) {
  const p2 = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await p2.goto(url);
  await p2.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive'])
    localStorage.setItem(k, '1'); });
  await p2.reload(); await p2.waitForTimeout(400);
  const bad = await p2.evaluate(() => {
    doAct('start'); setTouch(true); updateHUD();
    const g = sel => { const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect();
      if (!r.width || getComputedStyle(e).display === 'none') return null;
      return { x: [r.left, r.right], y: [r.top, r.bottom] }; };
    const parts = { руль: g('.tsteer'), газ: g('.tdrive'), передачи: g('#tgear'),
      меню: g('#tmenubtn'), заново: g('#trestart'), вид: g('#tview'), карточка: g('#coach'),
      поворотникL: g('#tgear span[data-blink="L"]'), поворотникR: g('#tgear span[data-blink="R"]') };
    /* меряем ПЛОЩАДЬ пересечения: на 932x430 угол карточки задевает кластер газа на 1x8 px
       и ничего не перехватывает, а накрытая кнопка даёт сотни px² */
    const area = (a, c) => { if (!a || !c) return 0;
      const w = Math.min(a.x[1], c.x[1]) - Math.max(a.x[0], c.x[0]);
      const h = Math.min(a.y[1], c.y[1]) - Math.max(a.y[0], c.y[0]);
      return w > 0 && h > 0 ? w * h : 0; };
    const keys = Object.keys(parts), out = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      if (keys[i] === 'передачи' && keys[j].startsWith('поворотник')) continue;  /* стрелки внутри ряда */
      const s = area(parts[keys[i]], parts[keys[j]]);
      if (s > 40) out.push(keys[i] + '×' + keys[j] + ' ' + Math.round(s) + 'px²');
    }
    /* палец должен попадать: ниже 36 px цель считаем непопадаемой */
    for (const k of keys) if (parts[k] && k !== 'карточка' && (parts[k].x[1] - parts[k].x[0]) < 36)
      out.push(k + ' уже 36 px');
    return out;
  });
  if (bad.length) layoutBad.push(`${W}x${H}: ${bad.join(', ')}`);
  await p2.close();
}
check('тач-полоса не перекрывается ни на одном телефоне', layoutBad.length === 0, layoutBad.join(' | '));

check('в консоли нет ошибок', errors.length === 0, errors.join(' | '));

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(r => r.name) }));
await browser.close();
process.exit(failed.length ? 1 : 0);
