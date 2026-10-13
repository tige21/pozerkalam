#!/usr/bin/env node
/* Гейт аккаунта, аналитики и пейволла. Игра отдаётся с https://pozerkalam.space/play/ через
   page.route — с теми же вставками, что делает deploy-pozerkalam.sh (тег /rb/script.js,
   window.AUTH_PROVIDERS), а Rybbit и API аккаунта замоканы: проверяется поведение страницы,
   не сервер (его гоняет server/test_account.py).
   Запуск (playwright-core во временной папке, см. cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/account-check.mjs
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена.
   Предложение курса выключено в игре (OFFER.on=false), его проверки включают его window.OFFER_FORCE.
   FAULT=offer глушит его и с флагом — краснеют @acct-offer-once/-free/-skip и @an-offer-events;
   FAULT=offeroff показывает его без флага — @acct-offer-off; FAULT=offersite — на любой площадке —
   @acct-offer-site-only; FAULT=offerbuyer — и купившему — @acct-offer-not-buyer. FAULT=avatar — фото не рисуется —
   @acct-avatar-shown; FAULT=avfail — битое фото не убирается — @acct-avatar-fallback; FAULT=policy — строки об
   обновлении политики нет — @acct-policy-note; FAULT=consent — нет согласия в форме отзывов — @acct-feedback-consent; FAULT=premiumsite — замок вне сайта —
   @acct-premium-site-only; FAULT=premiumlogin — гость с покупкой — @acct-premium-login-first; FAULT=promo — промокод не
   применяется — @acct-promo-redeem. */
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

const FAULT = process.env.FAULT || '';
const SRC0 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
/* поломки предложения курса: каждая обязана покрасить свою проверку, иначе та зелёная по построению */
const FAULTS = {
  offer: ["  if(!OFFER.on && !window.OFFER_FORCE) return 'выключено';\n", "  return 'выключено';\n"],
  offeroff: ["  if(!OFFER.on && !window.OFFER_FORCE) return 'выключено';\n", ''],
  offersite: ["  if(pl!=='web' && pl!=='pwa') return 'площадка '+pl;\n  if(anFramed()) return 'во фрейме';\n", ''],
  offerbuyer: ["  if(entitled(PAYWALL.product)) return 'курс уже куплен';\n", ''],
  avatar: ["const src = acct && avOk(acct.avatar) && !AV_FAIL.has(acct.avatar) ? acct.avatar : '';", "const src = '';"],
  avfail: ["AV_FAIL.add(t.getAttribute('src')); t.remove();", ''],
  policy: ["return !!acct && localStorage.getItem('pz_policy')!==POLICY_REV;", 'return false;'],
};
const SRC = FAULTS[FAULT] ? SRC0.replace(FAULTS[FAULT][0], FAULTS[FAULT][1]) : SRC0;
if (FAULTS[FAULT] && SRC === SRC0) { console.error(`FAULT=${FAULT}: заменяемая строка не найдена в index.html`); process.exit(2); }

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
async function openGame({ rybbit = true, auth = null, rbDelay = 0, api = null, storage = {}, files = {} } = {}) {
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
    if (files[url]) return route.fulfill(files[url]);
    /* на проде /sw.js есть; на 404 Chrome пишет в консоль «bad HTTP response code… fetching the script», и каждая
       проверка «консоль чиста» краснела от окружения, а не от игры (#294). Пустой SW без fetch ничего не перехватывает */
    if (url === ORIGIN + '/sw.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
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

/* мок сервиса: контракт server/account.py; состояние сценария — в объекте st */
function mockApi(st) {
  st.n = st.n || 0;
  const tokens = () => { st.n++; return { access: 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s' + st.n, refresh: 'R' + st.n }; };
  const account = { id: 'acc123456789', name: 'Егор Т.', avatar: st.avatar || null, providers: ['vk'] };
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
    if (c.path === '/pay/create' && c.method === 'POST') {
      st.creates = (st.creates || 0) + 1;
      if ((st.ent || []).some((e) => e.product === 'premium')) return { status: 409, json: { error: 'owned' } };
      return { json: { url: 'https://auth.robokassa.ru/Merchant/Index.aspx?MerchantLogin=pozerkalam&InvId=777&IsTest=1', inv: 777, test: true } };
    }
    if (c.path.startsWith('/pay/status')) return { json: { status: st.paid ? 'paid' : 'pending' } };
    if (c.path === '/promo/redeem' && c.method === 'POST') {
      st.redeems = (st.redeems || []).concat([c.body && c.body.code]);
      const r = (st.promo || {})[c.body && c.body.code];
      if (!r) return { status: 404, json: { error: 'promo-unknown' } };
      if (r.status) return { status: r.status, json: { error: r.error } };
      st.ent = [{ product: 'premium', expires_at: null }];
      return { json: { ok: true, product: 'premium', tag: r.tag || '', entitlements: st.ent } };
    }
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
  /* вход живёт в профиле и в чипе главного меню: без провайдеров нет ни кнопок там, ни «войти» на чипе */
  const st = await page.evaluate(() => {
    const btns = document.querySelectorAll('.acctbtns').length;
    menuGo('profile'); const prof = document.querySelectorAll('#overlay .acctbtns, #overlay [data-act="auth-logout"]').length;
    menuGo('main'); const chip = /войти/.test(document.querySelector('#overlay .mm-chip').textContent);
    return { btns, on: AUTH_ON, menu: prof > 0 || chip }; });
  check('без AUTH_PROVIDERS нет кнопок входа и ни одного запроса к API (@acct-off-by-default)',
    st.btns === 0 && !st.on && !st.menu && apiCalls.length === 0, JSON.stringify({ ...st, api: apiCalls.length }));
  await ctx.close();
}

{
  const { ctx, page, errors } = await openGame({ auth: ['yandex', 'vk', 'google'] });
  const r = await page.evaluate(() => {
    const chip = /войти/.test(document.querySelector('#overlay .mm-chip').textContent);
    menuGo('profile');
    const b = [...document.querySelectorAll('#overlay .acctbtns button')].map(x => x.textContent);
    const a = document.querySelector('#overlay .legal a');
    return { b, href: a && a.getAttribute('href'), chip };
  });
  check('кнопки входа в профиле: VK ID → Яндекс ID, ссылка на политику; на чипе главного меню «войти» (@acct-buttons-order)',
    JSON.stringify(r.b) === JSON.stringify(['Войти через VK ID', 'Войти через Яндекс ID']) && r.href === '/privacy/' && r.chip,
    JSON.stringify(r));
  const brand = await page.evaluate(() => [...document.querySelectorAll('#overlay .acctbtns button')].map(b => {
    const cs = getComputedStyle(b), r = b.getBoundingClientRect();
    return { cls: b.className, bg: cs.backgroundColor, color: cs.color, h: Math.round(r.height), logo: !!b.querySelector('svg path') };
  }));
  check('кнопки входа фирменные, как в spark: VK ID синяя с логотипом, Яндекс ID чёрная с логотипом, высота 48 (@acct-buttons-brand)',
    brand.length === 2 && brand[0].cls === 'oauth oauth-vk' && brand[0].bg === 'rgb(0, 119, 255)' && brand[1].cls === 'oauth oauth-yandex'
      && brand[1].bg === 'rgb(0, 0, 0)' && brand.every(x => x.logo && x.color === 'rgb(255, 255, 255)' && x.h === 48), JSON.stringify(brand));
  check('консоль чиста в профиле со входом', realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(' | '));
  await ctx.close();
}

{
  /* сервис отвечает не сразу: второе нажатие в это время не должно начинать второй вход */
  const st = {};
  const slow = async (c) => { if (c.path === '/auth/start') await new Promise(r => setTimeout(r, 600)); return mockApi(st)(c); };
  const { ctx, page, apiCalls } = await openGame({ auth: ['vk', 'yandex'], api: slow });
  await page.evaluate(() => { window.__nav = []; });
  await page.route('https://id.vk.ru/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: 'vk' }));
  const r = await page.evaluate(() => {
    menuGo('profile');
    const vk = document.querySelector('#overlay [data-act="auth:vk"]'), ya = document.querySelector('#overlay [data-act="auth:yandex"]');
    vk.click(); vk.click(); ya.click();
    return { busy: vk.classList.contains('busy'), vkDis: vk.disabled, yaDis: ya.disabled, spinner: getComputedStyle(vk, '::before').content !== 'none' };
  });
  await page.waitForTimeout(1200);
  const starts = apiCalls.filter(c => c.path === '/auth/start');
  check('пока сервис отвечает, кнопки заблокированы, на нажатой — индикатор, вход начат один раз (@acct-start-once)',
    r.busy && r.vkDis && r.yaDis && r.spinner && starts.length === 1 && starts[0].body.provider === 'vk', JSON.stringify({ ...r, starts: starts.length }));
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
    claim && claim.body.nonce === nonce && r.hash === '' && r.acct === 'Егор Т.' && r.li === 4 && /Егор Т\./.test(r.ov) && r.stored,
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
  await frame.evaluate(() => menuGo('profile'));
  await frame.click('#overlay [data-act="auth:vk"]');
  const popup = await popupP;
  await frame.waitForTimeout(300);
  const waiting = await frame.evaluate(() => document.getElementById('overlay').textContent);
  await frame.waitForTimeout(4800);
  const r = await frame.evaluate(() => ({ acct: acct && acct.name, wait: !!authWait, ov: document.getElementById('overlay').textContent }));
  const claims = apiCalls.filter(c => c.path === '/auth/claim').length;
  check('в iframe вход идёт во вкладке: режим poll, опрос до ok, вкладка закрыта (@acct-poll-flow)',
    st.mode === 'poll' && !!popup && /Подтверди вход в новой вкладке/.test(waiting) && claims === 3 && r.acct === 'Егор Т.' && !r.wait && /Егор Т\./.test(r.ov) && popup.isClosed(),
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

/* фото профиля — ссылка на CDN провайдера: стоит кружком в чипе главного меню и в профиле, поверх буквы; не
   загрузилось — картинки нет, видна буква, и на перерисовке меню битая ссылка не возвращается */
const AV_OK = 'https://sun9-21.userapi.com/s/v1/ig2/test.jpg?size=200x200', AV_BAD = 'https://sun9-21.userapi.com/s/v1/ig2/gone.jpg';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4YWODFTEMLQkAZZlQAVIPr1MAAAAASUVORK5CYII=', 'base64');
async function avatarState(page) {
  return page.evaluate(() => {
    const one = (sel) => { const av = document.querySelector(sel); if (!av) return null; const img = av.querySelector('img'), a = av.getBoundingClientRect();
      const r = img && img.getBoundingClientRect();
      return { img: img ? img.getAttribute('src') : null, loaded: !!(img && img.complete && img.naturalWidth > 0), ref: img && img.getAttribute('referrerpolicy'),
        covers: !!(img && Math.abs(r.width - a.width) < 1 && Math.abs(r.left - a.left) < 1), letter: av.textContent.trim() }; };
    menuGo('main'); const chip = one('#overlay .mm-chip .av');
    menuGo('profile'); const prof = one('#overlay .pwho .av');
    return { chip, prof, stored: (JSON.parse(localStorage.getItem('pz_auth') || '{}').acct || {}).avatar || null };
  });
}
{
  const st = { avatar: AV_OK };
  const { ctx, page, errors } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED,
    files: { [AV_OK]: { status: 200, contentType: 'image/png', body: PNG } } });
  await page.waitForTimeout(900);
  const r = await avatarState(page);
  const good = (x) => x && x.img === AV_OK && x.loaded && x.ref === 'no-referrer' && x.covers;
  check('фото профиля после входа — в чипе главного меню и в профиле, поверх буквы, без referrer (@acct-avatar-shown)',
    good(r.chip) && good(r.prof) && r.stored === AV_OK, JSON.stringify(r));
  check('консоль чиста с фото профиля', realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(' | '));
  await ctx.close();
}
/* политика обещает сказать в тренажёре о новом составе данных: вошедший видит строку со ссылкой на политику в главном
   меню и в профиле; после открытия профиля строка уходит; гостю её нет — его данные не менялись */
{
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({ avatar: AV_OK }), storage: LOGGED });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const note = () => { const p = document.querySelector('#overlay .policynote'); return p ? { t: p.textContent, href: (p.querySelector('a') || {}).getAttribute && p.querySelector('a').getAttribute('href') } : null; };
    menuGo('main'); const main1 = note();
    menuGo('profile'); const prof = note();
    acctRerender(); const prof2 = note();
    menuGo('main'); const main2 = note();
    return { main1, prof, prof2, main2, key: localStorage.getItem('pz_policy') };
  });
  await ctx.close();
  /* гость строки не видит; только что вошедший тоже — вход по ссылке под кнопками и есть согласие с редакцией */
  const g = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  const guest = await g.page.evaluate(() => {
    menuGo('main'); const a = !!document.querySelector('#overlay .policynote'); menuGo('profile'); const before = a || !!document.querySelector('#overlay .policynote');
    authClaimed('vk', { status: 200, json: { status: 'ok', provider: 'vk', account: { id: 'acc1', name: 'Егор Т.', providers: ['vk'] }, access: 'h.e30.s', refresh: 'R9' } });
    menuGo('main'); return { before, after: !!document.querySelector('#overlay .policynote'), logged: !!acct };
  });
  await g.ctx.close();
  check('обновление политики: вошедший видит строку со ссылкой в меню и профиле, перерисовка профиля её не стирает, уход из профиля гасит; гостю и только что вошедшему её нет (@acct-policy-note)',
    r.main1 && /VK ID/.test(r.main1.t) && r.main1.href === '/privacy/' && r.prof && r.prof2 && !r.main2 && r.key === '2026-10-07'
      && !guest.before && guest.logged && !guest.after, JSON.stringify({ ...r, guest }));
}
{
  const st = { avatar: AV_BAD };
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.waitForTimeout(900);
  const a = await avatarState(page);
  await page.waitForTimeout(300);
  const b = await avatarState(page);
  const letter = (x) => x && x.img === null && x.letter === 'Е';
  check('фото не загрузилось — в кружке буква, и перерисовка меню битую ссылку не возвращает (@acct-avatar-fallback)',
    letter(a.chip) && letter(a.prof) && letter(b.chip) && letter(b.prof), JSON.stringify({ a, b }));
  await ctx.close();
}

{
  const st = { refreshDead: true };
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { menuGo('profile'); return { acct: !!acct, stored: !!localStorage.getItem('pz_auth'), btns: document.querySelectorAll('#overlay .acctbtns button').length, note: (document.querySelector('#overlay .acctnote') || {}).textContent }; });
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

  await page.evaluate(() => { hideOv(); menuGo('profile'); });
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
  await page.evaluate(() => { menuGo('profile'); document.querySelector('#overlay [data-act="auth-delete"]').click(); });
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

{
  const { ctx, page, errors } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  const r = await page.evaluate(() => {
    window.PAYWALL_FORCE = [19];
    doAct('start'); showLevelPick();
    const card = document.querySelector('.lvcard[data-lvl="19"]');
    const lock = { cls: card.classList.contains('locked'), n: !!card.querySelector('.n .lk[aria-label]'), d: card.querySelector('.d').textContent };
    card.click();
    const ov = document.getElementById('overlay');
    return { lock, li: game.li, shown: ov.style.display !== 'none', h1: (ov.querySelector('h1') || {}).textContent,
      login: [...ov.querySelectorAll('.acctbtns button')].length, buy: !!ov.querySelector('[data-act="pay-buy"]'),
      back: !!ov.querySelector('[data-act="pick"]'), restore: !!ov.querySelector('[data-act="pay-restore"]') };
  });
  const pv = await rbEvents(page, 'paywall_view');
  check('закрытый уровень: замок на карточке, пейволл гостю с входом, без «Купить» до провайдера (@acct-paywall-screen)',
    r.lock.cls && r.lock.n && /Премиум/.test(r.lock.d) && r.li !== 19 && r.shown && r.h1 === 'Эстакада: трогание в горку'
      && r.login === 2 && !r.buy && r.back && !r.restore && pv.length === 1 && pv[0].li === 20 && pv[0].via === 'pick',
    JSON.stringify({ ...r, pv }));
  check('консоль чиста на пейволле', realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(' | '));
  await ctx.close();
}

{
  const st = {};
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.PAYWALL_FORCE = [19]; doAct('start'); openLevel(19, 'pick'); });
  const before = await page.evaluate(() => ({ li: game.li, restore: !!document.querySelector('#overlay [data-act="pay-restore"]') }));
  st.ent = [{ product: 'premium', expires_at: null }];
  await page.evaluate(() => document.querySelector('#overlay [data-act="pay-restore"]').click());
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ li: game.li, ov: document.getElementById('overlay').style.display, ent: acct.ent.length }));
  check('«Восстановить покупку»: /me с премиумом открывает закрытый уровень (@acct-paywall-restore)',
    before.li !== 19 && before.restore && after.li === 19 && after.ov === 'none' && after.ent === 1, JSON.stringify({ before, after }));
  const buyer = await page.evaluate(() => { delete window.PAYWALL_FORCE; window.OFFER_FORCE = true; openLevel(20, 'pick');
    return { li: game.li, offer: !!document.querySelector('#overlay .offer') }; });
  const views = await rbEvents(page, 'offer_view');
  check('у кого курс уже есть, тот предложения не видит — ни после восстановления, ни на следующем уровне (@acct-offer-not-buyer)',
    after.li === 19 && buyer.li === 20 && !buyer.offer && views.length === 0, JSON.stringify({ buyer, views }));
  await ctx.close();
}

{
  /* предложение курса уже показано: иначе на первом входе в экзамен вместо брифа стоит оно */
  const { ctx, page } = await openGame({ rybbit: false, storage: { pz_offer: '1' } });
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

/* предложение курса — фальшивая дверь (#280): спрашивает, считает ответ, ничего не закрывает */
const offerState = (page) => page.evaluate(() => {
  const ov = document.getElementById('overlay');
  return { li: game.li, shown: ov.style.display !== 'none', offer: !!ov.querySelector('.offer'), text: ov.textContent,
    take: !!ov.querySelector('[data-act="offer-take"]'), skip: !!ov.querySelector('[data-act="offer-skip"]'),
    go: !!ov.querySelector('[data-act="offer-go"]'), key: localStorage.getItem('pz_offer') };
});
/* без кнопки клик ничего не делает: при FAULT=offer гейт обязан сказать «ПРОВАЛ», а не упасть */
const clickAct = (target, act) => target.evaluate(a => { const b = document.querySelector('#overlay [data-act="' + a + '"]'); if (b) b.click(); return !!b; }, act);
let offerViewA = [], offerClickA = [];
{
  const { ctx, page, errors, apiCalls } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  await page.evaluate(() => { window.OFFER_FORCE = true; doAct('start'); showLevelPick(); document.querySelector('.lvcard[data-lvl="19"]').click(); });
  const first = await offerState(page);
  await clickAct(page, 'offer-take');
  const thanks = await offerState(page);
  await clickAct(page, 'offer-go');
  const went = await offerState(page);
  await page.evaluate(() => openLevel(20, 'pick'));
  const second = await offerState(page);
  offerViewA = await rbEvents(page, 'offer_view');
  offerClickA = await rbEvents(page, 'offer_click');
  const locks = await page.evaluate(() => ({ payOn: PAY_ON, locked: LEVELS.filter((_, i) => levelLocked(i)).length }));
  check('первый вход в уровни 20–32 — предложение «Площадка, город и экзамен — 249 ₽ навсегда», на автомате; второй вход — без него (@acct-offer-once)',
    first.shown && first.offer && /Площадка, город и экзамен — 249 ₽ навсегда/.test(first.text) && /на автомате/.test(first.text)
      && first.take && first.skip && first.li !== 19 && first.key === '1' && second.li === 20 && !second.shown && offerViewA.length === 1,
    JSON.stringify({ first: { li: first.li, offer: first.offer, key: first.key }, second: { li: second.li, shown: second.shown }, views: offerViewA.length }));
  check('«Беру за 249 ₽»: оплату не подключили, списаний нет, замков нет, «Поехали» открывает уровень (@acct-offer-free)',
    thanks.offer && /Оплату ещё не подключили/.test(thanks.text) && /Списаний не будет/.test(thanks.text) && thanks.go && thanks.li !== 19
      && went.li === 19 && !went.shown && !locks.payOn && locks.locked === 0 && apiCalls.every(c => !/pay|purchase|order/i.test(c.path)),
    JSON.stringify({ thanks: { offer: thanks.offer, go: thanks.go }, went: { li: went.li, shown: went.shown }, locks, api: apiCalls.map(c => c.path) }));
  check('консоль чиста на предложении курса', realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(' | '));
  await ctx.close();
}

{
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  await page.evaluate(() => { window.OFFER_FORCE = true; doAct('start'); openLevel(19, 'pick'); });
  const shown = await offerState(page);
  await clickAct(page, 'offer-skip');
  const after = await offerState(page);
  const skips = await rbEvents(page, 'offer_skip');
  check('«Пока бесплатно» сразу открывает уровень (@acct-offer-skip)',
    shown.offer && after.li === 19 && !after.shown, JSON.stringify({ shown: shown.offer, li: after.li, ov: after.shown }));
  const ok = (e) => e && e.li === 20 && e.via === 'pick' && e.price === 249;
  check('ответ на предложение уходит в аналитику: offer_view, offer_click, offer_skip с уровнем 20, «pick» и ценой 249 (@an-offer-events)',
    offerViewA.length === 1 && ok(offerViewA[0]) && offerClickA.length === 1 && ok(offerClickA[0]) && skips.length === 1 && ok(skips[0]),
    JSON.stringify({ view: offerViewA, click: offerClickA, skip: skips }));
  await ctx.close();
}

{
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  await page.evaluate(() => { window.PAYWALL_FORCE = [19]; window.OFFER_FORCE = true; doAct('start'); openLevel(19, 'pick'); });
  const r = await page.evaluate(() => ({ paywall: !!document.querySelector('#overlay .paywall'), offer: !!document.querySelector('#overlay .offer'),
    key: localStorage.getItem('pz_offer'), li: game.li }));
  const views = await rbEvents(page, 'offer_view');
  check('на закрытом уровне — пейволл, предложения нет (@acct-offer-paywall-first)',
    r.paywall && !r.offer && r.key === null && r.li !== 19 && views.length === 0, JSON.stringify({ ...r, views: views.length }));
  await ctx.close();
}

{
  /* выключенное предложение (как сейчас на проде): без тестового флага его нет нигде */
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  const r = await page.evaluate(() => { doAct('start'); openLevel(19, 'pick');
    const ov = document.getElementById('overlay');
    return { on: OFFER.on, li: game.li, offer: ov.style.display !== 'none' && !!ov.querySelector('.offer'), key: localStorage.getItem('pz_offer') }; });
  const views = await rbEvents(page, 'offer_view');
  check('выключенное предложение не показывается: уровень 20 открыт сразу, событий нет (@acct-offer-off)',
    r.li === 19 && !r.offer && r.key === null && views.length === 0, JSON.stringify({ ...r, views: views.length }));
  await ctx.close();
}

{
  /* та же страница на четырёх площадках: на сайте предложение было бы (проверено выше), здесь — нет */
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  const probe = (target) => target.evaluate(() => { localStorage.removeItem('pz_offer'); window.OFFER_FORCE = true; doAct('start'); openLevel(19, 'pick');
    return { li: game.li, offer: !!document.querySelector('#overlay .offer') }; });
  const res = {};
  res.ya = await page.evaluate(() => { window.BUILD = 'ya-test'; return true; }).then(() => probe(page));
  await page.goto(PAGE + '?vk_app_id=1&vk_platform=mobile_web'); await page.waitForTimeout(300);
  res.vk = await probe(page);
  await page.goto(PAGE + '?r=tg#tgWebAppData=x'); await page.waitForTimeout(300);
  res.tg = await probe(page);
  await page.route('https://frame.test/', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<iframe src="' + PAGE + '?r=frame" style="width:1200px;height:700px;border:0"></iframe>' }));
  await page.goto('https://frame.test/'); await page.waitForTimeout(500);
  const frame = page.frames().find(f => f.url().startsWith(PAGE));
  res.frame = frame ? await probe(frame) : null;
  const views = (await rbEvents(page, 'offer_view')).length;
  check('в Яндекс Играх, VK, Telegram и во фрейме предложения нет, уровень открывается сразу (@acct-offer-site-only)',
    ['ya', 'vk', 'tg', 'frame'].every(k => res[k] && res[k].li === 19 && !res[k].offer) && views === 0, JSON.stringify({ ...res, views }));
  await ctx.close();
}

/* согласие на обработку у формы отзывов (#180): контакт — персональные данные, согласие названо у кнопки
   «Отправить» со ссылкой на политику; в Яндекс Играх ссылки наружу запрещены — там политика без ссылки */
{
  const { ctx, page } = await openGame({});
  const r = await page.evaluate((fault) => {
    const probe = () => { openFeedback('game'); const n = document.querySelector('#overlay .fbnote'), b = document.getElementById('fbSend');
      const a = n && n.querySelector('a');
      return { text: n ? n.textContent : '', href: a ? a.getAttribute('href') : null, before: !!n && !!b && n.compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING }; };
    if (fault === 'consent') { const f = window.fbHTML; window.fbHTML = () => f().replace(/<p class="fbnote">[\s\S]*?<\/p>/, ''); }
    const site = probe(); fbClose();
    window.YaGames = {}; const ya = probe(); fbClose(); delete window.YaGames;
    return { site, ya };
  }, FAULT);
  await ctx.close();
  check('форма отзывов: согласие на обработку у кнопки «Отправить», на сайте — со ссылкой на политику, в Яндекс Играх — без ссылки наружу (@acct-feedback-consent)',
    /соглашаешься/.test(r.site.text) && /\/privacy\/$/.test(r.site.href || '') && r.site.before && /соглашаешься/.test(r.ya.text) && r.ya.href === null,
    JSON.stringify(r));
}

/* ---------- Премиум за 149 ₽ (#335) ---------- */
/* замок: уровни 1–10 бесплатны, 11–32 закрыты; только сайт — в ЯИ, VK, Telegram и во фрейме замка нет */
{
  const { ctx, page, errors } = await openGame({ auth: ['vk', 'yandex'], api: mockApi({}) });
  await page.goto(PAGE + '?paytest=1'); await page.waitForTimeout(300);
  const r = await page.evaluate((fault) => {
    if (fault === 'premiumsite') window.paySite = () => true;
    doAct('start'); showLevelPick();
    /* у непройденной открытой карточки строки .d нет: под названием только прогресс или замок */
    const card = (i) => { const c = document.querySelector('.lvcard[data-lvl="' + i + '"]'), d = c.querySelector('.d');
      return { lock: c.classList.contains('locked'), d: d ? d.textContent : '' }; };
    const out = { l10: card(9), l11: card(10), l32: card(31), path: noviceIdx().every((i) => !levelLocked(i)) };
    openLevel(10, 'pick'); const ov = document.getElementById('overlay');
    out.pay = { shown: !!ov.querySelector('.paywall'), price: /149 ₽ навсегда/.test(ov.textContent), login: ov.querySelectorAll('.acctbtns button').length,
      buy: !!ov.querySelector('[data-act="pay-buy"]'), promo: !!ov.querySelector('[data-act="promo-open"]'), li: game.li };
    menuGo('settings'); out.tab = [...document.querySelectorAll('#overlay [data-act^="tab:"]')].some((b) => b.dataset.act === 'tab:premium');
    menuGo('exam'); out.ceiling = /в Премиуме/.test(document.getElementById('overlay').textContent);
    const fr = window.anFramed, b0 = window.BUILD;
    window.BUILD = 'ya-0123456789abcdef'; out.ya = levelLocked(10); window.BUILD = b0;
    window.anFramed = () => true; out.frame = levelLocked(10); window.anFramed = fr;
    /* метка VK в адресе — не площадка: её дописывает кто угодно (ревью 12.10.2026) */
    history.replaceState(null, '', location.pathname + '?vk_platform=desktop_web'); out.vkParam = levelLocked(10); history.replaceState(null, '', location.pathname);
    return out;
  }, FAULT);
  check('Премиум: уровни 1–10 открыты, 11–32 закрыты с ценой, путь новичка свободен; пейволл гостю — цена и вход, без «Купить»; вкладка и потолок готовности (@acct-premium-lock)',
    !r.l10.lock && r.l11.lock && /Премиум · 149 ₽/.test(r.l11.d) && r.l32.lock && r.path && r.pay.shown && r.pay.price && r.pay.login === 2 && !r.pay.buy && r.pay.promo
      && r.pay.li !== 10 && r.tab && r.ceiling, JSON.stringify(r));
  check('Премиум только на сайте: в сборке Яндекс Игр и во фрейме замка нет, метка VK в адресе его не снимает (@acct-premium-site-only)',
    !r.ya && !r.frame && r.vkParam, JSON.stringify({ ya: r.ya, frame: r.frame, vkParam: r.vkParam }));
  check('консоль чиста на Премиуме', realErrors(errors).length === 0, realErrors(errors).slice(0, 2).join(' | '));
  await ctx.close();
}
/* покупка: только вошедший; «Купить» → /pay/create → форма Robokassa; возврат с InvId → статус → /me → уровень открыт */
{
  const st = {};
  const { ctx, page, apiCalls } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.goto(PAGE + '?paytest=1'); await page.waitForTimeout(600);
  await page.evaluate((fault) => { if (fault === 'premiumlogin') window.__acct = acct; doAct('start'); openLevel(12, 'pick'); }, FAULT);
  const pay = await page.evaluate(() => ({ buy: !!document.querySelector('#overlay [data-act="pay-buy"]'), restore: !!document.querySelector('#overlay [data-act="pay-restore"]') }));
  await Promise.all([page.waitForURL(/auth\.robokassa\.ru/, { timeout: 5000 }).catch(() => null), page.evaluate(() => document.querySelector('#overlay [data-act="pay-buy"]').click())]);
  const went = page.url();
  const create = apiCalls.find((c) => c.path === '/pay/create');
  st.paid = true; st.ent = [{ product: 'premium', expires_at: null }];
  await page.goto(PAGE + '?OutSum=149.00&InvId=777&SignatureValue=abc&IsTest=1&Shp_product=premium');
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => ({ li: game.li, url: location.search, ov: document.getElementById('overlay').style.display, prem: entitled('premium') }));
  const ok = await rbEvents(page, 'purchase_ok');
  check('покупка: «Купить за 149 ₽» у вошедшего ведёт на форму Robokassa, возврат с InvId открывает уровень, адрес очищен (@acct-premium-buy)',
    pay.buy && pay.restore && /auth\.robokassa\.ru/.test(went) && create && /^Bearer /.test(create.auth) && create.body.product === 'premium'
      && back.prem && back.li === 12 && back.url === '' && ok.length === 1, JSON.stringify({ pay, went: went.slice(0, 60), create: !!create, back, ok: ok.length }));
  await ctx.close();
}
/* без аккаунта купить нельзя: у гостя нет «Купить», а payStart без входа на сервис не ходит */
{
  const st = {};
  const { ctx, page, apiCalls } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st) });
  await page.goto(PAGE + '?paytest=1'); await page.waitForTimeout(300);
  const r = await page.evaluate(async (fault) => { doAct('start'); openLevel(12, 'pick');
    if (fault === 'premiumlogin') { acct = { id: 'x', name: 'x', provider: 'vk', ent: [] }; }
    await payStart('premium'); return { buy: !!document.querySelector('#overlay [data-act="pay-buy"]'), login: document.querySelectorAll('#overlay .acctbtns button').length }; }, FAULT);
  const creates = apiCalls.filter((c) => c.path === '/pay/create').length;
  check('гость не может купить: «Купить» нет, вход на месте, запроса оплаты нет (@acct-premium-login-first)', !r.buy && r.login === 2 && creates === 0, JSON.stringify({ ...r, creates }));
  await ctx.close();
}
/* промокод: ссылка ?promo= подставляет код и открывает вкладку; гостю — вход; вошедшему — ответ сервера; ошибки — текстом */
{
  const st = { promo: { VK2026: { tag: 'vk' }, OLD: { status: 410, error: 'promo-expired' } } };
  const { ctx, page } = await openGame({ auth: ['vk', 'yandex'], api: mockApi(st), storage: LOGGED });
  await page.goto(PAGE + '?paytest=1&promo=vk2026'); await page.waitForTimeout(700);
  const link = await page.evaluate(() => ({ tab: menu.scr === 'settings' && menu.tab === 'premium', val: (document.getElementById('promoInput') || {}).value, url: location.search }));
  await page.evaluate(() => { document.getElementById('promoInput').value = 'old'; doAct('promo-go'); });
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => document.getElementById('overlay').textContent);
  await page.evaluate((fault) => { if (fault === 'promo') window.promoRedeem = () => {}; document.getElementById('promoInput').value = 'VK2026'; doAct('promo-go'); }, FAULT);
  await page.waitForTimeout(500);
  const good = await page.evaluate(() => ({ text: document.getElementById('overlay').textContent, prem: entitled('premium'), lock: levelLocked(20) }));
  const ev = await rbEvents(page, 'promo_redeem');
  check('промокод: ссылка ?promo= открывает «Премиум» с кодом, ошибка — текстом, верный код открывает премиум, событие с меткой (@acct-promo-redeem)',
    link.tab && link.val === 'VK2026' && link.url === '?paytest=1' && /Срок этого промокода закончился/.test(bad) && good.prem && !good.lock
      && /Премиум активен/.test(good.text) && ev.length === 1 && ev[0].tag === 'vk' && (st.redeems || []).join(',') === 'OLD,VK2026',
    JSON.stringify({ link, bad: /Срок/.test(bad), good: { prem: good.prem, lock: good.lock }, ev, redeems: st.redeems }));
  await ctx.close();
}

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(f => f.name) }));
process.exit(failed.length ? 1 : 0);
