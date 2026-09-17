#!/usr/bin/env node
/* Замер ленты реплик в герое лендинга: сколько пикселей прокрутки достаётся каждой реплике
   и сколько прокрутки страница молчит после ухода копии.
     mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core@1.55)
     cd landing && npx astro build && cd ..
     PW_DIR=/tmp/pw node tools/hero-tape.mjs
   Порог читаемости: 110 px на десктопе и 90 px на телефоне — это примерно один щелчок
   колеса, то есть реплику успевают прочитать до её замены. Выход 1, если порог пробит или
   страница бросила исключение.

   Замер устойчив: каждая позиция прокрутки ждёт двух кадров rAF, границы реплик уточняются
   делением до 1 px. Обе меры нужны — с таймером вместо кадров одна и та же сборка давала
   минимум от 101 до 110 px при пороге 110.

   Зачем инструмент: доля прокрутки у реплики считается длиной её участка пути, а участки
   разной длины. До правки «Точка 2» (доворот на полметра, тот самый ориентир 45°) получала
   30 px из 675, а «Готово» не показывалось вовсе — прокрутка кончалась раньше. Проверять
   это глазами нельзя: на глаз лента выглядит рабочей, потому что сам знаешь, что там
   написано. Гоняй после правки высоты `.hero`, списка STEPS или разбивки PATH по фазам. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'landing', 'dist');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const MIN = { desk: 110, mob: 90 };
const DEVS = [
  { n: 'desk', w: 1440, h: 900, dpr: 1, mobile: false },
  { n: 'mob', w: 390, h: 844, dpr: 2, mobile: true },
];
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('нет landing/dist/index.html — сначала: cd landing && npx astro build');
  process.exit(1);
}

const require_ = createRequire(path.join(PW_DIR, 'x.js'));
let chromium;
try {
  ({ chromium } = require_('playwright-core'));
} catch {
  console.error(`playwright-core не найден в ${PW_DIR} — см. шапку файла`);
  process.exit(1);
}

function chromePath() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const base = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
  const dirs = fs.readdirSync(base).filter((d) => d.startsWith('chromium-')).sort();
  for (const d of dirs.reverse()) {
    for (const rel of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const p = path.join(base, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Chromium не найден в кэше Playwright; задай PW_CHROME');
}

const srv = http.createServer((rq, rs) => {
  let f = path.join(DIST, decodeURIComponent(rq.url.split('?')[0]));
  if (!path.extname(f)) f = path.join(f, 'index.html');
  fs.readFile(f, (e, b) => {
    if (e) { rs.statusCode = 404; rs.end('404'); return; }
    rs.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
    rs.end(b);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;

const browser = await chromium.launch({ executablePath: chromePath() });
let bad = 0;
const out = {};

for (const dev of DEVS) {
  const ctx = await browser.newContext({
    viewport: { width: dev.w, height: dev.h },
    deviceScaleFactor: dev.dpr,
    isMobile: dev.mobile,
    hasTouch: dev.mobile,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  /* Герой начинается не с нуля: шапка sticky и занимает свои 58 px в потоке. Прокрутку
     сцены считает сам park.js как `hero.offsetHeight − stage.offsetHeight`, поэтому отсчёт
     ведём от offsetTop героя, иначе первая и последняя реплики уезжают на высоту шапки. */
  const geo = await page.evaluate(() => {
    const h = document.getElementById('hero');
    const s = h.querySelector('.hero-stage');
    return { top: h.offsetTop, span: h.offsetHeight - s.offsetHeight, vh: innerHeight };
  });

  /* Ждём не таймером, а двумя кадрами: обработчик прокрутки в `park.js` перерисовывает
     сцену внутри `requestAnimationFrame`, и фиксированные 10 мс то попадали в кадр, то нет —
     одна и та же сборка давала минимум на реплику от 101 до 110 px, то есть инструмент
     срабатывал случайно. Двойной rAF гарантирует, что колбэк уже отработал. */
  const titleAt = async (s) => {
    await page.evaluate((v) => {
      window.scrollTo(0, v);
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, geo.top + s);
    return page.evaluate(() => ({
      t: (document.querySelector('[data-step-title]') || {}).textContent || '',
      open: document.getElementById('hero').classList.contains('open'),
    }));
  };

  /* Грубый проход шагом 10 px находит интервалы смены реплики, дальше каждая граница
     уточняется делением до 1 px. Простой замер шагом 5 px давал ±5 px на границу, и на
     пороге 110 px инструмент срабатывал через раз на одной и той же сборке. */
  const coarse = [];
  let copyGone = null;
  for (let s = 0; s <= geo.span; s += 10) {
    const st = await titleAt(s);
    if (copyGone === null && st.open) copyGone = s;
    coarse.push({ s, t: st.t });
  }

  const marks = [{ s: 0, t: coarse[0].t }];
  for (let k = 1; k < coarse.length; k++) {
    if (coarse[k].t === coarse[k - 1].t) continue;
    let lo = coarse[k - 1].s;
    let hi = coarse[k].s;
    while (hi - lo > 1) {
      const mid = Math.round((lo + hi) / 2);
      const st = await titleAt(mid);
      if (st.t === coarse[k - 1].t) lo = mid; else hi = mid;
    }
    marks.push({ s: hi, t: coarse[k].t });
  }

  const tape = marks.map((m, k) => ({
    t: m.t,
    px: (k + 1 < marks.length ? marks[k + 1].s : geo.span) - m.s,
  }));
  const min = Math.min(...tape.map((e) => e.px));
  const silent = geo.span - (copyGone === null ? 0 : copyGone);
  out[dev.n] = { span: geo.span, silentPx: silent, silentScreens: +(silent / geo.vh).toFixed(2), min, tape };

  console.log(`\n== ${dev.n} ${dev.w}×${dev.h} == прокрутка сцены ${geo.span} px`);
  console.log(`копия уходит на ${copyGone} px · молчит ${silent} px = ${(silent / geo.vh).toFixed(2)} экрана`);
  for (const e of tape) console.log(`  ${String(e.px).padStart(4)} px  ${e.t}`);
  console.log(`  минимум ${min} px · порог ${MIN[dev.n]} px · ${min >= MIN[dev.n] ? 'OK' : 'ПРОБИТ'}`);
  if (min < MIN[dev.n]) bad++;
  if (errs.length) { console.log('  ИСКЛЮЧЕНИЯ:', errs.join(' | ')); bad++; }

  await ctx.close();
}

await browser.close();
srv.close();
console.log(`\n${JSON.stringify(out)}`);
console.log(bad ? 'hero-tape: ПРОБЛЕМЫ' : 'hero-tape: всё зелено');
process.exit(bad ? 1 : 0);
