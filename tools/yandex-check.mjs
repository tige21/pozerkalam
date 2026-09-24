#!/usr/bin/env node
/* Гейт билда Яндекс Игр: собирает build/yandex/index.html (если его нет), раздаёт его со
   статического сервера вместе с мок-/sdk.js и проверяет в headless Chromium то, что ломалось
   без проверки: вырезана ли регистрация SW, вписан ли тег сборки, встал ли адаптер SDK, ставит
   ли реклама игру на паузу, сливаются ли облачные сейвы, чиста ли консоль.
   Запуск (playwright-core во временной папке, см. cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/yandex-check.mjs
     PW_DIR=/tmp/pw REBUILD=1 node tools/yandex-check.mjs   # пересобрать билд перед проверкой
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const BUILD_HTML = path.join(ROOT, 'build', 'yandex', 'index.html');

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

if (process.env.REBUILD === '1' || !fs.existsSync(BUILD_HTML)) {
  console.log('==> build-yandex.sh');
  execFileSync(path.join(ROOT, 'build-yandex.sh'), { cwd: ROOT, stdio: 'inherit' });
}
const html = fs.readFileSync(BUILD_HTML, 'utf8');

/* мок площадки: тот же контракт, что у настоящего /sdk.js — YaGames.init → ysdk; вызовы
   записываются в window.__ya, чтобы проверка читала их из страницы */
const SDK_MOCK = `window.__ya={calls:[],saved:null,ready:false};
window.YaGames={init:function(){
  var rec=function(n){window.__ya.calls.push(n)};
  var adv=function(name){return function(o){rec(name);var c=(o&&o.callbacks)||{};
    if(c.onOpen)c.onOpen();if(c.onRewarded)c.onRewarded();if(c.onClose)c.onClose();}};
  var ysdk={
    adv:{showFullscreenAdv:adv('fullscreen'),showRewardedVideo:adv('rewarded')},
    getPlayer:function(){rec('getPlayer');return Promise.resolve({
      getData:function(){rec('getData');return Promise.resolve({trainer_gearbox:'MT',trainer_marks:'0'})},
      setData:function(o){rec('setData');window.__ya.saved=o;return Promise.resolve()}})},
    features:{LoadingAPI:{ready:function(){rec('ready');window.__ya.ready=true}}},
    environment:{i18n:{lang:'ru'}}
  };
  return Promise.resolve(ysdk);
}};`;

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/sdk.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(SDK_MOCK); }
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', r => errors.push('request: ' + r.url()));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

await page.goto(base + '/?nocache=' + Date.now());
/* локальная коробка не задана — облачное значение обязано подхватиться; маркеры уже есть локально —
   облачное 'trainer_marks' не должно их затереть */
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('trainer_marks', '1');
  for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive', 'trainer_drive_mt']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0'); });
await page.goto(base + '/?nocache=' + Date.now() + 'r');
await page.waitForTimeout(800);

/* 1. регистрация SW вырезана */
const sw = await page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length }));
check('в билде площадки нет регистрации service worker (@dist-yandex-no-sw)',
  !html.includes('serviceWorker') && !html.includes('manifest.webmanifest') && sw.regs === 0,
  'serviceWorker в html: ' + html.includes('serviceWorker') + ', регистраций: ' + sw.regs);

/* 2. тег сборки */
const build = await page.evaluate(() => window.BUILD);
check('тег сборки вида ya-<16 hex> (@dist-yandex-build-tag)', /^ya-[0-9a-f]{16}$/.test(build || ''), 'BUILD=' + build);

/* 3. SDK инициализирован, адаптер на месте */
const sdk = await page.evaluate(() => ({ ysdk: !!window.ysdk, ready: window.__ya.ready,
  inter: typeof (window.ADS || {}).interstitial, rew: typeof (window.ADS || {}).rewarded, calls: window.__ya.calls.slice() }));
check('YaGames.init прошёл: ysdk, LoadingAPI.ready, window.ADS (@dist-yandex-sdk-ready)',
  sdk.ysdk && sdk.ready && sdk.inter === 'function' && sdk.rew === 'function', JSON.stringify(sdk));

/* 4. полноэкранная реклама ставит игру на паузу и снимает её; rewarded отдаёт награду */
const ads = await page.evaluate(() => {
  const seen = []; const orig = window.adsPause;
  window.adsPause = on => { seen.push(!!on); orig(on); };
  window.ADS.interstitial('check');
  let rewarded = false; window.ADS.rewarded(() => { rewarded = true; });
  window.adsPause = orig;
  return { seen, rewarded, calls: window.__ya.calls.filter(c => c === 'fullscreen' || c === 'rewarded') };
});
check('реклама: пауза на onOpen, снятие на onClose, награда на onRewarded (@dist-yandex-ads-pause)',
  ads.seen.join(',') === 'true,false,true,false' && ads.rewarded && ads.calls.length === 2, JSON.stringify(ads));

/* 5. облачные сейвы: merge без затирания локального, __ysave шлёт все trainer_* */
const cloud = await page.evaluate(() => {
  const gearbox = localStorage.getItem('trainer_gearbox'), marks = localStorage.getItem('trainer_marks');
  window.__ysave();
  const saved = window.__ya.saved || {};
  const keys = Object.keys(saved), all = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('trainer_')) all.push(k); }
  return { gearbox, marks, keys: keys.length, all: all.length, onlyTrainer: keys.every(k => k.startsWith('trainer_')) };
});
check('облако: пустой локальный ключ берётся из облака, занятый не затирается, __ysave шлёт все trainer_* (@dist-yandex-cloud-merge)',
  cloud.gearbox === 'MT' && cloud.marks === '1' && cloud.keys === cloud.all && cloud.keys > 0 && cloud.onlyTrainer, JSON.stringify(cloud));

/* 6. уровень стартует и едет без ошибок в консоли */
await page.evaluate(() => { doAct('start'); loadLevel(0); });
await page.waitForTimeout(3000);
/* opt.* читаются на буте, раньше, чем init SDK дольёт облако в localStorage — облачная настройка
   вступает в силу со следующего запуска, поэтому коробка здесь не проверяется (доска #184) */
const run = await page.evaluate(() => ({ level: game.li, paused, faces: typeof facesFrame === 'number' ? facesFrame : -1 }));
check('уровень 1 запущен из билда площадки: кадр идёт, консоль чистая (@dist-yandex-console-clean)',
  run.level === 0 && !run.paused && run.faces > 0 && errors.length === 0,
  JSON.stringify(run) + (errors.length ? ' ошибки: ' + errors.join(' | ') : ''));

await browser.close();
server.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(f => f.name), build }));
process.exit(failed.length ? 1 : 0);
