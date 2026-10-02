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

/* ---------- аккаунт ---------- */

/* мок сервиса: контракт server/account.py; состояние сценария — в объекте st */
function mockApi(st) {
  st.n = st.n || 0;
  const tokens = () => { st.n++; return { access: 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s' + st.n, refresh: 'R' + st.n }; };
  const account = { id: 'acc123456789', name: 'Егор Т.', providers: ['vk'] };
  return async (c) => {
    if (c.path === '/auth/start') {
      st.nonce = c.body.nonce; st.mode = c.body.mode;
      return { json: { authUrl: 'https://id.vk.ru/authorize?state=x', sid: 'SID_' + 'a'.repeat(30) } };
    }
    if (c.path === '/auth/claim') {
      if (st.nonce && c.body.nonce !== st.nonce) return { status: 403, json: { status: 'forbidden' } };
      if (st.pending > 0) { st.pending--; return { json: { status: 'pending' } }; }
      if (st.fail) return { json: { status: 'failed', reason: st.fail } };
      return { json: Object.assign({ status: 'ok', provider: 'vk', is_new: true, account, entitlements: st.ent || [] }, tokens()) };
    }
    if (c.path === '/auth/refresh') {
      if (st.refreshDead) return { status: 401, json: { error: 'invalid' } };
      return { json: Object.assign({ account, entitlements: st.ent || [] }, tokens()) };
    }
    if (c.path === '/me' && c.method === 'GET') {
      if (st.me401 > 0) { st.me401--; return { status: 401, json: { error: 'auth' } }; }
      return { json: { account, entitlements: st.ent || [] } };
    }
    if (c.path === '/me' && c.method === 'DELETE') return { json: { ok: true } };
    if (c.path === '/auth/logout') return { json: { ok: true } };
    if (c.path === '/progress' && c.method === 'PUT') {
      st.puts = (st.puts || 0) + 1;
      return { json: { data: Object.assign({}, st.server || {}, c.body.data), rev: st.puts } };
    }
    return { status: 404, json: { error: 'not-mocked' } };
  };
}
const LOGGED = { pz_auth: JSON.stringify({ refresh: 'R0', acct: { id: 'acc123456789', name: 'Егор Т.', provider: 'vk', ent: [] } }) };
const realErrors = (errs) => errs.filter(e => !/Failed to load resource/.test(e));
const ovText = (page) => page.evaluate(() => document.getElementById('overlay').textContent);

{
  const { ctx, page, apiCalls } = await openGame({ rybbit: false });
  await page.evaluate(() => doAct('start'));
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({ btns: document.querySelectorAll('.acctbtns').length, on: AUTH_ON, menu: (buildMenu(), document.getElementById('tmGrid').textContent.includes('Аккаунт')) }));
  check('без AUTH_PROVIDERS нет кнопок входа и ни одного запроса к API (@acct-off-by-default)',
    st.btns === 0 && !st.on && !st.menu && apiCalls.length === 0, JSON.stringify({ ...st, api: apiCalls.length }));
  await ctx.close();
}

{
  const { ctx, page, errors } = await openGame({ auth: ['yandex', 'vk', 'google'] });
  const r = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#overlay .acctbtns button')].map(x => x.textContent);
    const a = document.querySelector('#overlay .legal a');
    return { b, href: a && a.getAttribute('href'), start: !!document.querySelector('#overlay [data-act="start"]') };
  });
  check('кнопки входа на стартовом экране: VK ID → Яндекс ID, ссылка на политику (@acct-buttons-order)',
    JSON.stringify(r.b) === JSON.stringify(['Войти через VK ID', 'Войти через Яндекс ID']) && r.href === '/privacy/' && r.start,
    JSON.stringify(r));
  check('консоль чиста на стартовом экране со входом', realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(' | '));
  await ctx.close();
}

{
  const st = {};
  const guest = JSON.stringify({ '1 · Гостевой': { n: 2, clean: 1, best: 40, bestHits: 0 } });
  const nonce = 'N'.repeat(43);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const apiCalls = [];
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (url.split('#')[0] === PAGE) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml({ auth: ['vk', 'yandex'] }) });
    if (url === ORIGIN + '/rb/script.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: RYBBIT_MOCK });
    if (url.startsWith(ORIGIN + '/api/v1/')) {
      const req = route.request(); const call = { method: req.method(), path: url.slice((ORIGIN + '/api/v1').length), body: JSON.parse(req.postData() || 'null') };
      apiCalls.push(call); const res = await mockApi(st)(call);
      return route.fulfill({ status: res.status || 200, contentType: 'application/json', body: JSON.stringify(res.json || {}) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(([g, n]) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
    localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0');
    localStorage.setItem('trainer_progress', g);
    sessionStorage.setItem('pz_nonce', n); sessionStorage.setItem('pz_ret', JSON.stringify({ li: 4 }));
  }, [guest, nonce]);
  st.nonce = nonce;
  await page.goto(PAGE + '#auth=SID_' + 'a'.repeat(30));
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => ({ hash: location.hash, acct: acct && acct.name, li: game.li, ov: document.getElementById('overlay').textContent,
    stored: !!localStorage.getItem('pz_auth'), prog: JSON.parse(localStorage.getItem('trainer_progress') || '{}'),
    rb: (window.__rb || []).filter(e => e[0] === 'identify').map(e => e[1]),
    leak: Object.keys(localStorage).filter(k => k.indexOf('trainer_') === 0 && /R\d/.test(localStorage.getItem(k) || '') && (localStorage.getItem(k) || '').includes('"refresh"')) }));
  const claim = apiCalls.find(c => c.path === '/auth/claim'), put = apiCalls.find(c => c.path === '/progress');
  check('возврат с редиректа: claim с nonce, hash убран, аккаунт на экране, уровень восстановлен (@acct-redirect-return)',
    claim && claim.body.nonce === nonce && r.hash === '' && r.acct === 'Егор Т.' && r.li === 4 && /Аккаунт: Егор Т\./.test(r.ov) && r.stored,
    JSON.stringify({ claim: !!claim, hash: r.hash, acct: r.acct, li: r.li }));
  check('гостевой прогресс уходит первым PUT после входа (@acct-guest-merge)',
    put && put.body.data['1 · Гостевой'] && put.body.data['1 · Гостевой'].clean === 1 && r.prog['1 · Гостевой'], JSON.stringify(put && put.body));
  check('после входа identify в аналитике, токен не лежит в ключах trainer_* (@acct-identify, @acct-no-trainer-keys)',
    r.rb.length === 1 && r.rb[0] === 'acc123456789' && r.leak.length === 0, JSON.stringify({ identify: r.rb, leak: r.leak }));
  await ctx.close();
}

{
  /* iframe площадки: редирект невозможен — вход во вкладке и опрос сервера */
  const st = { pending: 2 };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const apiCalls = [];
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (url === 'https://vk.test/app') return route.fulfill({ status: 200, contentType: 'text/html', body: '<iframe src="' + PAGE + '?vk_app_id=1" style="width:1200px;height:700px;border:0"></iframe>' });
    if (url.split('#')[0].split('?')[0] === PAGE) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml({ auth: ['vk', 'yandex'] }) });
    if (url === ORIGIN + '/rb/script.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: RYBBIT_MOCK });
    if (url.startsWith(ORIGIN + '/api/v1/')) {
      const req = route.request(); const call = { method: req.method(), path: url.slice((ORIGIN + '/api/v1').length), body: JSON.parse(req.postData() || 'null') };
      apiCalls.push(call); const res = await mockApi(st)(call);
      return route.fulfill({ status: res.status || 200, contentType: 'application/json', body: JSON.stringify(res.json || {}) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await ctx.newPage();
  await page.goto('https://vk.test/app');
  await page.waitForTimeout(500);
  const frame = page.frames().find(f => f.url().startsWith(PAGE));
  await frame.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); });
  const popupP = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
  await frame.click('#overlay [data-act="auth:vk"]');
  const popup = await popupP;
  await frame.waitForTimeout(300);
  const waiting = await frame.evaluate(() => document.getElementById('overlay').textContent);
  await frame.waitForTimeout(4800);
  const r = await frame.evaluate(() => ({ acct: acct && acct.name, wait: !!authWait, ov: document.getElementById('overlay').textContent }));
  const claims = apiCalls.filter(c => c.path === '/auth/claim').length;
  check('в iframe вход идёт во вкладке: режим poll, опрос до ok, вкладка закрыта (@acct-poll-flow)',
    st.mode === 'poll' && !!popup && /Подтверди вход в новой вкладке/.test(waiting) && claims === 3 && r.acct === 'Егор Т.' && !r.wait && /Аккаунт: Егор Т\./.test(r.ov) && popup.isClosed(),
    JSON.stringify({ mode: st.mode, popup: !!popup, claims, acct: r.acct, closed: popup && popup.isClosed() }));
  await ctx.close();
}

{
  const st = { me401: 1 };
  const { ctx, page, apiCalls } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.waitForTimeout(800);
  const seq = apiCalls.filter(c => c.path === '/auth/refresh' || c.path === '/me').map(c => c.path + (c.auth ? '(' + c.auth.slice(-3) + ')' : ''));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pz_auth')).refresh);
  check('access нет — refresh; 401 на запросе — ещё refresh и повтор (@acct-refresh-on-401)',
    seq.join(',') === '/auth/refresh,/me(.s1),/auth/refresh,/me(.s2)' && stored === 'R2', seq.join(',') + ' · refresh=' + stored);
  await ctx.close();
}

{
  const st = { refreshDead: true };
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ acct: !!acct, stored: !!localStorage.getItem('pz_auth'), btns: document.querySelectorAll('#overlay .acctbtns button').length, note: (document.querySelector('#overlay .acctnote') || {}).textContent }));
  check('отвергнутый refresh — выход с объяснением, кнопки входа вернулись (@acct-session-expired)',
    !r.acct && !r.stored && r.btns === 2 && /Сессия истекла/.test(r.note || ''), JSON.stringify(r));
  await ctx.close();
}

{
  const st = {};
  const prog = JSON.stringify({ '2 · Местный': { n: 1, clean: 1, best: 20, bestHits: 0 } });
  const { ctx, page, apiCalls } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: Object.assign({ trainer_progress: prog }, LOGGED) });
  await page.waitForTimeout(800);
  const putsBoot = apiCalls.filter(c => c.path === '/progress').length;
  st.server = { '9 · С другого устройства': { n: 3, clean: 2, best: 50, bestHits: 0 } };
  await page.evaluate(() => { doAct('start'); game.hits = 0; game.t = 12; win(); });
  await page.waitForTimeout(3000);
  const putsMid = apiCalls.filter(c => c.path === '/progress').length;
  await page.waitForTimeout(2600);
  const puts = apiCalls.filter(c => c.path === '/progress');
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem('trainer_progress')));
  check('победа: один отложенный PUT через 5 с, итог сервера лёг в localStorage (@acct-sync-after-win)',
    putsBoot === 1 && putsMid === 1 && puts.length === 2 && !!local['9 · С другого устройства'] && !!local['2 · Местный'] && Object.keys(local).length === 3,
    JSON.stringify({ boot: putsBoot, mid: putsMid, total: puts.length, keys: Object.keys(local) }));

  await page.evaluate(() => { hideOv(); showOv(startHTML()); });
  await page.evaluate(() => document.querySelector('#overlay [data-act="auth-logout"]').click());
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ acct: !!acct, stored: !!localStorage.getItem('pz_auth'), prog: Object.keys(JSON.parse(localStorage.getItem('trainer_progress'))).length,
    clear: (window.__rb || []).some(e => e[0] === 'clear'), note: (document.querySelector('#overlay .acctnote') || {}).textContent }));
  const lo = apiCalls.find(c => c.path === '/auth/logout');
  check('выход: токены стёрты, прогресс на устройстве остался, сессия отозвана на сервере (@acct-logout-keeps-progress)',
    !r.acct && !r.stored && r.prog >= 3 && r.clear && lo && /^R\d+$/.test(lo.body.refresh) && /Выход выполнен/.test(r.note || ''), JSON.stringify({ ...r, logout: lo && lo.body }));
  await ctx.close();
}

{
  const st = {};
  const { ctx, page, apiCalls } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('#overlay [data-act="auth-delete"]').click());
  const ask = await ovText(page);
  await page.evaluate(() => document.querySelector('#overlay [data-act="auth-delete-yes"]').click());
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ acct: !!acct, stored: !!localStorage.getItem('pz_auth'), note: (document.querySelector('#overlay .acctnote') || {}).textContent }));
  check('удаление аккаунта: подтверждение, DELETE /me, на экране итог (@acct-delete)',
    /Удалить аккаунт\?/.test(ask) && apiCalls.some(c => c.path === '/me' && c.method === 'DELETE') && !r.acct && !r.stored && /Аккаунт удалён/.test(r.note || ''), JSON.stringify(r));
  await ctx.close();
}

{
  const st = { fail: 'denied' };
  const nonce = 'M'.repeat(43);
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: {} });
  await page.evaluate((n) => { sessionStorage.setItem('pz_nonce', n); }, nonce);
  st.nonce = nonce;
  await page.goto(PAGE + '?r=1#auth=SID_' + 'b'.repeat(30));
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ acct: !!acct, note: (document.querySelector('#overlay .acctnote') || {}).textContent }));
  check('отказ провайдера: «Вход отменён.», аккаунта нет (@acct-fail-denied)', !r.acct && r.note === 'Вход отменён.', JSON.stringify(r));
  await ctx.close();
}

{
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  const first = await page.evaluate(() => { doAct('start'); game.hits = 0; game.t = 9; win(); return document.querySelectorAll('#overlay .acctbtns').length; });
  const second = await page.evaluate(() => { doAct('again'); game.hits = 0; game.t = 9; win(); return document.querySelectorAll('#overlay .acctbtns').length; });
  check('после первой победы гостя — одно предложение войти, дальше не повторяется (@acct-win-nudge-once)', first === 1 && second === 0, JSON.stringify({ first, second }));
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
