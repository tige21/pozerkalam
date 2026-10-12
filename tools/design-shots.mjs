#!/usr/bin/env node
/* Кадры всех экранов интерфейса для дизайн-прохода: меню, разделы, пауза, HUD, итоги, бриф, пейволл,
   отзыв, редактор, портрет. Не проверка — снимки и замеры для глаз и для аудита, «до» и «после» одной
   командой:
     PW_DIR=/tmp/pw node tools/design-shots.mjs build/design-pass/before
     ONLY=main,pause PW_DIR=/tmp/pw node tools/design-shots.mjs build/design-pass/after
   Страница отдаётся с https://pozerkalam.space/play/ через перехват, как в account-check: только там живут
   вход (AUTH_PROVIDERS), вкладка «Премиум» и пейволл; API аккаунта замокан, ни один запрос не уходит наружу.
   Рядом с картинками — metrics.json: мелкий текст, тесные цели касания, вылезающие за край блоки. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'build', 'design-pass', 'shots'));
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
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
const pageHtml = () => SRC.replace('</head>', '<script>window.BUILD="shots";window.AUTH_PROVIDERS=["vk","yandex"]</script></head>');

const VP = {
  desk: { viewport: { width: 1440, height: 900 }, dpr: 1, touch: false },
  phone: { viewport: { width: 844, height: 390 }, dpr: 2, touch: true },
  se: { viewport: { width: 568, height: 320 }, dpr: 2, touch: true },
  port: { viewport: { width: 390, height: 844 }, dpr: 2, touch: true },
};
const ACCOUNT = { id: 'acc123456789', name: 'Егор Т.', avatar: null, providers: ['vk'] };
const LOGGED = { pz_auth: JSON.stringify({ refresh: 'R0', acct: { id: ACCOUNT.id, name: ACCOUNT.name, provider: 'vk', ent: [] } }) };

/* прогресс вернувшегося игрока: путь новичка наполовину пройден, пара дриллов, практика */
const SEED_BACK = `(() => {
  const nm = (i) => LEVELS[i].name;
  progAdd(nm(6), 18.4, 0); progAdd(nm(6), 16.2, 0); progAdd(nm(9), 24.9, 1); progAdd(nm(9), 21.3, 0);
  progAdd(nm(1), 41.7, 2); progAdd(nm(13), 12, 0, 0.14, false); progAdd(nm(22), 61.5, 0);
  try { localStorage.setItem('trainer_last', nm(1)); } catch (e) {}
})()`;

const examReal = `setExamMode('real');`;
/* синтетический след и протокол: экран протокола без заезда пуст, а заезд бота — минуты */
const fakeExamRun = (failed) => `(() => {
  const pts = examMapPath().pts.slice(0, 60); exam.trail = [];
  for (const p of pts) exam.trail.push(p.u, p.v);
  const at = (k) => pts[Math.min(pts.length - 1, k)] || { u: 0, v: 0 };
  exam.log.push({ code: 'no-blinker', pts: 3, t: 42, txt: PENALTIES['no-blinker'].txt, u: at(12).u, v: at(12).v });
  exam.log.push({ code: 'kerb', pts: 3, t: 97, txt: PENALTIES.kerb.txt, u: at(30).u, v: at(30).v });
  exam.score = 6; exam.stage = Math.min(3, exam.route.length - 1); game.t = 214.6;
  ${failed ? "exam.log.push({ code: 'yield', pts: 5, t: 151, txt: PENALTIES.yield.txt, u: at(44).u, v: at(44).v }); exam.score = 11; examFail(PENALTIES.yield.txt);" : 'exam.log.pop(); exam.score = 3; examPass();'}
})()`;

const S = [];
const scene = (id, vps, setup, o = {}) => S.push(Object.assign({ id, vps, setup, wait: 700 }, o));

scene('main-new', ['desk', 'phone', 'se'], `menuGo('main')`, { wait: 1200 });
scene('main-back', ['desk', 'phone'], `${SEED_BACK}; menuGo('main')`, { wait: 1200 });
for (const t of ['start', 'yard', 'drill', 'pad', 'city', 'own'])
  scene('levels-' + t, t === 'start' || t === 'city' ? ['desk', 'phone', 'se'] : ['desk', 'phone'], `${SEED_BACK}; menuGo('levels','${t}','main')`);
scene('levels-new', ['desk', 'phone'], `menuGo('levels',null,'main')`);
scene('levels-locked', ['desk', 'phone'], `window.PAYWALL_FORCE = [19, 20, 21]; menuGo('levels','pad','main')`);
scene('exam', ['desk', 'phone'], `${SEED_BACK}; menuGo('exam',null,'main')`);
scene('profile-guest', ['desk', 'phone', 'se'], `${SEED_BACK}; menuGo('profile',null,'main')`);
scene('profile-logged', ['desk', 'phone'], `${SEED_BACK}; menuGo('profile',null,'main')`, { logged: true, wait: 1400 });
for (const t of ['screen', 'hints', 'mirrors', 'sound'])
  scene('settings-' + t, ['desk', 'phone'], `menuGo('settings','${t}','main')`);
scene('settings-premium', ['desk', 'phone'], `menuGo('settings','premium','main')`, { query: '?paytest=1' });
scene('settings-premium-logged', ['desk'], `menuGo('settings','premium','main')`, { query: '?paytest=1', logged: true, wait: 1400 });
scene('help-ctrl', ['desk', 'phone'], `menuGo('help','ctrl','main')`);
scene('help-how', ['desk', 'phone'], `menuGo('help','how','main')`);
scene('pause-lesson', ['desk', 'phone', 'se'], `openLevel(1,'pick'); menuGo('pause')`);
scene('pause-exam', ['desk', 'phone'], `openLevel(examLevelIdx(),'pick'); doAct('brief'); menuGo('pause')`);
scene('pause-practice', ['desk'], `openLevel(22,'pick','practice'); doAct('brief'); menuGo('pause')`);
scene('task', ['desk', 'phone'], `openLevel(0,'pick'); showTask()`);
scene('hud-yard-chase', ['desk', 'phone', 'se'], `openLevel(0,'pick')`, { wait: 1600 });
scene('hud-yard-cabin', ['desk', 'phone'], `openLevel(0,'pick'); pressKey('KeyV')`, { wait: 1600 });
scene('hud-yard-demo', ['desk', 'phone'], `openLevel(6,'pick'); startDemo()`, { wait: 4200 });
scene('hud-city-chase', ['desk', 'phone'], `openLevel(26,'pick')`, { wait: 1800 });
scene('hud-city-cabin', ['desk', 'phone'], `openLevel(26,'pick'); pressKey('KeyV')`, { wait: 1800 });
scene('hud-exam', ['desk', 'phone'], `openLevel(examLevelIdx(),'pick'); doAct('brief')`, { wait: 1800 });
scene('hud-touch-open', ['phone', 'se'], `openLevel(0,'pick'); setTimeout(() => coachLineToggle(), 900)`, { wait: 1600 });
scene('hud-strike', ['desk', 'phone'], `openLevel(22,'pick'); attemptVio('stopline','')`, { wait: 1200 });
scene('win', ['desk', 'phone', 'se'], `${SEED_BACK}; openLevel(6,'pick'); game.hits = 1; game.t = 23.4; win()`);
scene('win-drill', ['desk'], `openLevel(13,'pick'); game.t = 11; win()`);
scene('win-city', ['desk', 'phone'], `openLevel(22,'pick'); attempt.log.push({code:'no-blinker',txt:PENALTIES['no-blinker'].txt,t:12}); game.hits = 1; game.t = 48; win()`);
scene('fail-lesson', ['desk', 'phone', 'se'], `openLevel(22,'pick'); attemptVio('stopline',''); failAttempt('redlight', PENALTIES.redlight.txt)`);
scene('exam-brief', ['desk', 'phone'], `openLevel(examLevelIdx(),'pick')`, { wait: 1000 });
scene('exam-brief-real', ['desk'], `${examReal} openLevel(examLevelIdx(),'pick')`, { wait: 1000 });
scene('exam-fail', ['desk', 'phone'], `${examReal} openLevel(examLevelIdx(),'pick'); doAct('brief'); ${fakeExamRun(true)}`, { wait: 1000 });
scene('exam-pass', ['desk', 'phone'], `${examReal} openLevel(examLevelIdx(),'pick'); doAct('brief'); ${fakeExamRun(false)}`, { wait: 1000 });
scene('exam-abort', ['desk'], `openLevel(examLevelIdx(),'pick'); doAct('brief'); showOv(examAbortHTML())`);
scene('practice-brief', ['desk', 'phone'], `openLevel(22,'pick','practice')`, { wait: 1000 });
scene('practice-result', ['desk', 'phone'], `openLevel(22,'pick','practice'); doAct('brief'); exam.log.push({code:'no-blinker',pts:3,t:12,txt:PENALTIES['no-blinker'].txt,u:0,v:0}); exam.score = 3; practiceEnd(true)`, { wait: 1000 });
scene('practice-fail', ['desk'], `openLevel(22,'pick','practice'); doAct('brief'); exam.failWhy = PENALTIES.redlight.txt; exam.log.push({code:'redlight',pts:5,t:30,txt:PENALTIES.redlight.txt,u:0,v:0}); exam.score = 5; practiceEnd(false)`, { wait: 1000 });
scene('paywall-guest', ['desk', 'phone', 'se'], `window.PAYWALL_FORCE = [19]; openLevel(19,'pick')`);
scene('paywall-logged', ['desk'], `window.PAYWALL_FORCE = [19]; openLevel(19,'pick')`, { logged: true, wait: 1400 });
scene('feedback', ['desk', 'phone'], `openFeedback('start')`);
scene('editor', ['desk', 'phone'], `openEditor()`, { wait: 1000 });
scene('touch-help', ['phone', 'se'], `openLevel(0,'pick'); showTouchHelp()`, { wait: 900 });
scene('onboard', ['desk'], `openLevel(0,'pick'); showOnboard()`, { wait: 900 });
scene('portrait', ['port'], ``, { wait: 900 });

function mockApi(logged) {
  let n = 0;
  const tokens = () => { n++; return { access: 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s' + n, refresh: 'R' + n }; };
  return (p) => {
    if (!logged) return { status: 401, json: { error: 'auth' } };
    if (p === '/auth/refresh') return { json: Object.assign({ account: ACCOUNT, entitlements: [] }, tokens()) };
    if (p === '/me') return { json: { account: ACCOUNT, entitlements: [] } };
    if (p === '/progress') return { json: { data: {}, rev: 1 } };
    return { status: 404, json: { error: 'not-mocked' } };
  };
}

/* замеры, которые глаз пропускает: текст мельче 11 px, цели касания мельче 40 px, блоки за краем экрана */
const PROBE = `(() => {
  const vw = innerWidth, vh = innerHeight, out = { small: [], tight: [], offscreen: [], clipped: [] };
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const name = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''))
    + ' «' + (el.textContent || '').trim().slice(0, 28) + '»';
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('#assets')) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (own && fs < 11) out.small.push(name(el) + ' ' + fs + 'px');
    const r = el.getBoundingClientRect();
    if (own && (r.right > vw + 1 || r.left < -1 || r.bottom > vh + 1 && !el.closest('.mbody,#overlay'))) out.offscreen.push(name(el));
    if (own && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && getComputedStyle(el).textOverflow !== 'ellipsis') out.clipped.push(name(el));
    if ((el.tagName === 'BUTTON' || el.dataset.hold || el.dataset.gear || el.dataset.blink) && (r.width < 40 || r.height < 40)) out.tight.push(name(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  for (const k in out) out[k] = [...new Set(out[k])].slice(0, 30);
  return out;
})()`;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const metrics = {};
let shots = 0;
for (const sc of S) {
  if (ONLY.length && !ONLY.some(o => sc.id.startsWith(o))) continue;
  for (const v of sc.vps) {
    const cfg = VP[v];
    const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: cfg.dpr, hasTouch: cfg.touch, isMobile: cfg.touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const api = mockApi(!!sc.logged);
    await ctx.route('**/*', async route => {
      const url = route.request().url();
      if (url.split('#')[0].split('?')[0] === PAGE) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pageHtml() });
      if (url.startsWith(ORIGIN + '/api/v1/')) { const r = api(url.slice((ORIGIN + '/api/v1').length).split('?')[0]);
        return route.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(r.json || {}) }); }
      if (url === ORIGIN + '/sw.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return route.fulfill({ status: 404, body: '' });
    });
    await page.addInitScript(([st, touch]) => {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
      localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', touch ? '1' : '0');
      localStorage.setItem('pz_policy', '2026-10-07');
      for (const k in st) localStorage.setItem(k, st[k]);
    }, [sc.logged ? LOGGED : {}, cfg.touch]);
    await page.goto(PAGE + (sc.query || ''));
    await page.waitForTimeout(sc.logged ? 900 : 400);
    try { if (sc.setup) await page.evaluate(sc.setup); }
    catch (e) { errors.push('setup: ' + e.message.split('\n')[0]); }
    await page.waitForTimeout(sc.wait);
    const file = sc.id + '--' + v + '.png';
    await page.screenshot({ path: path.join(OUT, file) });
    let m = {};
    try { m = await page.evaluate(PROBE); } catch (e) { m = { probe: e.message }; }
    if (errors.length) m.errors = errors.slice(0, 5);
    metrics[file] = m;
    shots++;
    console.log((errors.length ? '!  ' : '   ') + file + (errors.length ? '  ' + errors[0] : ''));
    await ctx.close();
  }
}
fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 1));
console.log(`\n${shots} кадров → ${path.relative(ROOT, OUT)}`);
await browser.close();
