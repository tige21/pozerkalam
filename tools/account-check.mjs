#!/usr/bin/env node
/* Гейт аккаунта, аналитики и пейволла. Игра отдаётся с https://pozerkalam.space/play/ через
   page.route — с теми же вставками, что делает deploy-pozerkalam.sh (тег /rb/script.js,
   window.AUTH_PROVIDERS), а Rybbit и API аккаунта замоканы: проверяется поведение страницы,
   не сервер (его гоняет server/test_account.py).
   Запуск (playwright-core во временной папке, см. cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/account-check.mjs
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const ORIGIN = 'https://pozerkalam.space';
const PAGE = ORIGIN + '/play/';

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

const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* те же вставки, что делает деплой; rybbit — тег как в деплое, auth — список провайдеров */
function pageHtml({ rybbit = true, auth = null } = {}) {
  let head = '<script>window.BUILD="test"</script>';
  if (auth) head += '<script>window.AUTH_PROVIDERS=' + JSON.stringify(auth) + '</script>';
  if (rybbit) head += '<script defer src="/rb/script.js" data-site-id="9"></script>';
  return SRC.replace('</head>', head + '</head>');
}

/* мок трекера: тот же интерфейс, что у настоящего window.rybbit; вызовы — в window.__rb */
const RYBBIT_MOCK = `window.__rb=window.__rb||[];
window.rybbit={event:function(n,p){window.__rb.push(['event',n,p||{}])},
  identify:function(id){window.__rb.push(['identify',id])},
  clearIdentity:function(){window.__rb.push(['clear'])}};`;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

/* одна страница = один сценарий: свои вставки, свой мок API, своя задержка скрипта трекера */
async function openGame({ rybbit = true, auth = null, rbDelay = 0, api = null, storage = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [], apiCalls = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (url.split('#')[0].split('?')[0] === PAGE)
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml({ rybbit, auth }) });
    if (url === ORIGIN + '/rb/script.js') {
      if (rbDelay) await new Promise(r => setTimeout(r, rbDelay));
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: RYBBIT_MOCK });
    }
    if (url.startsWith(ORIGIN + '/api/v1/')) {
      const req = route.request();
      let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { body = req.postData(); }
      const call = { method: req.method(), path: url.slice((ORIGIN + '/api/v1').length), body, auth: req.headers()['authorization'] || '' };
      apiCalls.push(call);
      const res = api ? await api(call) : { status: 404, json: { error: 'not-mocked' } };
      return route.fulfill({ status: res.status || 200, contentType: 'application/json', body: JSON.stringify(res.json || {}) });
    }
    /* всё остальное — SW, иконки, внешние адреса — в тесте не нужно */
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript((st) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
    localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0');
    for (const k in st) localStorage.setItem(k, st[k]);
  }, storage);
  await page.goto(PAGE);
  await page.waitForTimeout(300);
  return { ctx, page, errors, apiCalls };
}
const rbEvents = (page, name) => page.evaluate(n => (window.__rb || []).filter(e => e[0] === 'event' && (!n || e[1] === n)).map(e => e[2]), name);

/* ---------- аналитика ---------- */
{
  const { ctx, page, errors } = await openGame({ rbDelay: 1500 });
  await page.waitForTimeout(1900);
  const opens = await rbEvents(page, 'app_open');
  check('app_open уходит один раз, дожидаясь загрузки трекера, с площадкой и устройством (@an-app-open)',
    opens.length === 1 && opens[0].platform === 'web' && opens[0].mob === 0 && opens[0].runs === 9 && opens[0].build === 'test',
    JSON.stringify(opens));

  const startsBoot = (await rbEvents(page, 'level_start')).length;
  await page.evaluate(() => { doAct('start'); });
  const s1 = await rbEvents(page, 'level_start');
  await page.evaluate(() => { cycleTraffic(); setExamMode(examTrain() ? 'real' : 'train'); setExamMode(examTrain() ? 'real' : 'train'); });
  const s2 = await rbEvents(page, 'level_start');
  await page.evaluate(() => { showLevelPick(); document.querySelector('.lvcard[data-lvl="4"]').click(); });
  const s3 = await rbEvents(page, 'level_start');
  await page.evaluate(() => { pressKey('Digit2'); });
  const s4 = await rbEvents(page, 'level_start');
  check('level_start шлёт игрок, а не загрузка: старт страницы, смена потока и режима экзамена молчат (@an-level-start-once)',
    startsBoot === 0 && s1.length === 1 && s1[0].li === 1 && s1[0].via === 'start' && s2.length === 1
      && s3.length === 2 && s3[1].li === 5 && s3[1].via === 'pick' && s4.length === 3 && s4[2].li === 2 && s4[2].via === 'digit',
    JSON.stringify({ boot: startsBoot, start: s1, after: s2.length, pick: s3[1], digit: s4[2] }));

  await page.evaluate(() => { game.hits = 0; game.t = 31.26; win(); });
  const wins = await rbEvents(page, 'level_win');
  check('победа уходит с номером уровня, временем и чистотой (@an-level-win)',
    wins.length === 1 && wins[0].li === 2 && wins[0].t === 31.3 && wins[0].clean === 1 && wins[0].kind === 'yard' && !('err_cm' in wins[0]),
    JSON.stringify(wins));

  check('консоль чиста', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

{
  const { ctx, page, errors } = await openGame({ rybbit: false });
  await page.evaluate(() => { doAct('start'); showLevelPick(); document.querySelector('.lvcard[data-lvl="3"]').click(); });
  const st = await page.evaluate(() => ({ rb: typeof window.rybbit, buf: AN_BUF.length, rbOn: AN_RB }));
  check('без тега Rybbit события никуда не копятся и не уходят (@an-off-without-tag)',
    st.rb === 'undefined' && st.buf === 0 && st.rbOn === false && errors.length === 0, JSON.stringify(st));
  await ctx.close();
}

/* ---------- вход в уровень ---------- */
{
  const { ctx, page } = await openGame({ rybbit: false });
  const r = await page.evaluate(() => {
    doAct('start'); showLevelPick();
    const i = LEVELS.findIndex(l => l.examRoute);
    document.querySelector('.lvcard[data-lvl="' + i + '"]').click();
    const ov = document.getElementById('overlay');
    return { i, shown: getComputedStyle(ov).display !== 'none', brief: /Экзаменационный маршрут/.test(ov.textContent) };
  });
  check('экзамен с карточки выбора открывается с брифом маршрута (@exam-brief-on-pick)',
    r.shown && r.brief, JSON.stringify(r));
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(f => f.name) }));
process.exit(failed.length ? 1 : 0);
