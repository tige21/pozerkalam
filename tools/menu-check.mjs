#!/usr/bin/env node
/* Главное меню, пауза и машина на подиуме — коды app-menu в specs/features/app/menu.feature.
   Запуск (playwright-core ставится во временную папку, см. cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/menu-check.mjs
     FAULT=sections|tabs|esc|pausebtn|fit|persist|play|showroom|hud PW_DIR=/tmp/pw node tools/menu-check.mjs
   FAULT ломает одно поведение в странице — соответствующая проверка обязана покраснеть, иначе она
   зелёная по построению.
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || '';

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
const url = (process.env.URL || 'file://' + path.join(ROOT, 'index.html')) + '?nocache=' + Date.now();
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail && !ok ? ' — ' + detail : '')); };
const errors = [];

/* поломки — подменой функций и стилей уже загруженной страницы, код игры не трогается */
const FAULTS = {
  sections: () => { menuBack = function () { menuGo('main'); }; },
  esc: () => { escAct = function () {}; },
  pausebtn: () => { const s = document.createElement('style'); s.textContent = '#pauseBtn{display:none!important}'; document.head.appendChild(s); },
  fit: () => { const s = document.createElement('style'); s.textContent = '#overlay .mm-item,#overlay .pstack button{padding:40px 18px!important}'; document.head.appendChild(s); },
  persist: () => { setOpt = function (k, v) { opt[k] = !!v; }; setRefs = function (v) { opt.refs = v; }; },
  play: () => { playTarget = function () { return { i: 0, why: 'FAULT' }; }; },
  showroom: () => { drawShowroom = function () { ctx.fillStyle = '#0e151f'; ctx.fillRect(0, 0, W, H); }; },
  hud: () => { const s = document.createElement('style'); s.textContent = 'body.menu #bar,body.menu #coach{display:flex!important}'; document.head.appendChild(s); },
  tabs: () => { const s = document.createElement('style'); s.textContent = '.lvgrid[hidden]{display:grid!important}'; document.head.appendChild(s); },
};
if (FAULT && !FAULTS[FAULT]) { console.error('неизвестный FAULT: ' + FAULT); process.exit(2); }

async function open(vp, opts = {}) {
  const p = await browser.newPage({ viewport: vp, deviceScaleFactor: opts.dpr || 1, hasTouch: !!opts.touch, isMobile: !!opts.touch });
  p.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) errors.push(vp.width + 'x' + vp.height + ': ' + e.message); });
  await p.goto(url);
  await p.evaluate((t) => {
    localStorage.clear();
    for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
    localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', t ? '1' : '0');
  }, !!opts.touch);
  await p.reload(); await p.waitForTimeout(500);
  if (FAULT) await p.evaluate(`(${FAULTS[FAULT].toString()})()`);
  return p;
}
/* исключение внутри блока — провал его требования, а не обрыв прогона: под FAULT страница ведёт себя
   неожиданно, и следующий шаг блока может не найти кнопку */
async function guard(code, fn) {
  const before = results.length;
  try { await fn(); }
  catch (e) { if (results.length === before) check('исключение в проверке (@' + code + ')', false, String(e.message).split('\n')[0]); }
  for (const pg of browser.contexts().flatMap(c => c.pages())) await pg.close().catch(() => {});
}
const state = (p) => p.evaluate(() => ({ scr: menu.scr, from: menu.from, root: menu.root, menuCls: document.body.classList.contains('menu'),
  ov: ovEl.style.display !== 'none', lay: ovEl.className, paused, li: game.li, done: game.done }));

/* ---------- разделы и «Назад» ---------- */
await guard('app-menu-sections', async () => {
  const p = await open({ width: 1280, height: 720 });
  const bad = [];
  for (const sec of ['levels', 'exam', 'profile', 'settings', 'help']) {
    for (const how of ['back', 'Escape']) {
      await p.evaluate((s) => { const b = document.querySelector('#overlay .mm-col [data-act="menu:' + s + '"]'); if (b) b.click(); }, sec);
      const a = await state(p);
      if (a.scr !== sec || a.lay !== 'lay-panel' || !a.menuCls) bad.push(sec + ': открылся ' + JSON.stringify(a));
      if (how === 'back') await p.evaluate(() => { const b = document.querySelector('#overlay [data-act="back"]'); if (b) b.click(); });
      else await p.keyboard.press('Escape');
      const b = await state(p);
      if (b.scr !== 'main') bad.push(sec + ' ' + how + ' → ' + b.scr);
    }
  }
  await p.evaluate(() => doAct('play'));
  for (const sec of ['settings', 'levels']) {
    await p.keyboard.press('Escape');
    await p.evaluate((s) => { const b = document.querySelector('#overlay [data-act="menu:' + s + '"]'); if (b) b.click(); }, sec);
    await p.keyboard.press('Escape');
    const b = await state(p);
    if (b.scr !== 'pause') bad.push('пауза → ' + sec + ' → Esc → ' + b.scr);
    await p.keyboard.press('Escape');
  }
  /* вкладка «Уровни» показывает на экране только свои карточки — считается по прямоугольникам, а не по атрибуту */
  const tabs = await p.evaluate(() => LEVEL_TABS.map(([k]) => { menuGo('levels', k, 'main');
    const shown = [...document.querySelectorAll('.lvcard')].filter(c => c.getBoundingClientRect().height > 0).length;
    const own = LEVELS.filter((l, i) => levelTab(i) === k).length;
    return { k, shown, own }; }));
  for (const t of tabs) if (t.shown !== t.own) bad.push('вкладка ' + t.k + ': на экране ' + t.shown + ' карточек из ' + t.own);
  await p.evaluate(() => { menuGo('pause'); doAct('resume'); });
  await p.keyboard.press('KeyL');
  const l = await state(p);
  await p.keyboard.press('Escape');
  const g = await state(p);
  if (l.scr !== 'levels' || l.from !== 'game' || g.ov || g.paused) bad.push('L в игре → ' + JSON.stringify(l) + ' → Esc → ' + JSON.stringify(g));
  check('каждый раздел открывается панелью, «Назад» и Esc ведут туда, откуда пришли (@app-menu-sections)', bad.length === 0, bad.join(' | '));
  await p.close();
});

/* ---------- Esc и пауза ---------- */
await guard('app-menu-esc-pause', async () => {
  const p = await open({ width: 1280, height: 720 });
  const bad = [];
  await p.evaluate(() => doAct('play'));
  await p.keyboard.press('Escape');
  const a = await state(p);
  if (a.scr !== 'pause' || !a.paused) bad.push('Esc в уровне → ' + JSON.stringify(a));
  const t0 = await p.evaluate(() => game.t); await p.waitForTimeout(300);
  if ((await p.evaluate(() => game.t)) !== t0) bad.push('на паузе время уровня идёт');
  await p.keyboard.press('Escape');
  const b = await state(p);
  if (b.ov || b.paused) bad.push('второй Esc → ' + JSON.stringify(b));
  await p.evaluate(() => { openLevel(examLevelIdx(), 'pick'); doAct('brief'); });
  await p.keyboard.press('Escape');
  const ex = await p.evaluate(() => ({ scr: menu.scr, abort: !!document.querySelector('#overlay [data-act="exam-abort"]'),
    route: !!document.querySelector('#overlay [data-act="route"]') }));
  if (ex.scr !== 'pause' || !ex.abort || !ex.route) bad.push('экзамен: ' + JSON.stringify(ex));
  await p.evaluate(() => { doAct('exam-abort'); doAct('exam-exit'); doAct('back'); openLevel(0, 'pick'); game.hits = 0; game.t = 9; win(); });
  await p.keyboard.press('Escape');
  const w = await state(p);
  if (!w.done || !w.ov) bad.push('итоги закрылись по Esc: ' + JSON.stringify(w));
  check('Esc в уровне — пауза, повторный — игра; на экзамене «Прервать» и «Маршрут»; итоги Esc не закрывает (@app-menu-esc-pause)',
    bad.length === 0, bad.join(' | '));
  await p.close();
});

/* ---------- телефон: кнопка паузы ---------- */
const phones = [[568, 320], [667, 375], [740, 360], [844, 390], [932, 430]];
await guard('app-menu-pause-touch', async () => {
  const bad = [];
  for (const [w, h] of phones) {
    const p = await open({ width: w, height: h }, { touch: true, dpr: 2 });
    const r = await p.evaluate(() => {
      doAct('play'); document.getElementById('thelp').classList.remove('on'); paused = false; updateHUD();
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
        return r.width > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
      const btn = box(document.getElementById('pauseBtn'));
      const others = { тормоз_газ: box(document.querySelector('.tdrive')), руль: box(document.querySelector('.tsteer')), передачи: box(document.getElementById('tgear')),
        заново: box(document.getElementById('trestart')), вид: box(document.getElementById('tview')), подсказка: box(document.getElementById('coach')) };
      if (opt.mirrors) for (const [k, m] of Object.entries(mirrorRects())) others['зеркало ' + k] = { l: m.x, t: m.y, r: m.x + m.w, b: m.y + m.h };
      return { btn, others, vw: innerWidth, vh: innerHeight };
    });
    if (!r.btn) { bad.push(`${w}x${h}: кнопки паузы не видно`); await p.close(); continue; }
    const bw = r.btn.r - r.btn.l, bh = r.btn.b - r.btn.t;
    if (bw < 36 || bh < 36) bad.push(`${w}x${h}: кнопка ${Math.round(bw)}×${Math.round(bh)} px`);
    if (r.btn.l < 0 || r.btn.t < 0 || r.btn.r > r.vw || r.btn.b > r.vh) bad.push(`${w}x${h}: кнопка за краем экрана`);
    for (const [k, o] of Object.entries(r.others)) {
      if (!o) continue;
      const ix = Math.min(o.r, r.btn.r) - Math.max(o.l, r.btn.l), iy = Math.min(o.b, r.btn.b) - Math.max(o.t, r.btn.t);
      if (ix > 0 && iy > 0 && ix * iy > 4) bad.push(`${w}x${h}: кнопка паузы на «${k}» ${Math.round(ix * iy)} px²`);
    }
    const c = await p.evaluate(() => { document.getElementById('pauseBtn').click(); return { scr: menu.scr, paused }; });
    if (c.scr !== 'pause' || !c.paused) bad.push(`${w}x${h}: тап → ${JSON.stringify(c)}`);
    await p.close();
  }
  check('телефон: кнопка паузы видна, ≥36 px, ни на что не ложится, тап открывает паузу (@app-menu-pause-touch)', bad.length === 0, bad.join(' | '));
});

/* ---------- вёрстка: всё помещается ---------- */
await guard('app-menu-fit', async () => {
  const bad = [];
  const screens = phones.map(([w, h]) => [w, h, true]).concat([[1280, 720, false], [1440, 900, false]]);
  for (const [w, h, touch] of screens) {
    const p = await open({ width: w, height: h }, { touch, dpr: touch ? 2 : 1 });
    const r = await p.evaluate(() => {
      const out = [], vw = innerWidth, vh = innerHeight;
      const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden' ? r : null; };
      const name = (b) => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 18);
      /* все кнопки экрана — в окне, не мельче 30 px по высоте и не друг на друге */
      const whole = (scr) => {
        const bs = [...document.querySelectorAll('#overlay button')].map(b => [b, vis(b)]).filter(x => x[1]);
        for (const [b, q] of bs) {
          if (q.left < -0.5 || q.top < -0.5 || q.right > vw + 0.5 || q.bottom > vh + 0.5) out.push(scr + ': «' + name(b) + '» за краем');
          if (q.height < 30) out.push(scr + ': «' + name(b) + '» ' + Math.round(q.height) + ' px');
        }
        for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i][1], c = bs[j][1];
          const ix = Math.min(a.right, c.right) - Math.max(a.left, c.left), iy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
          if (ix > 0 && iy > 0 && ix * iy > 4) out.push(scr + ': «' + name(bs[i][0]) + '» на «' + name(bs[j][0]) + '»');
        }
      };
      whole('главное');
      /* панель раздела листается по высоте, но по ширине ничего не обрезано; вкладки листаются вбок сами */
      for (const sec of ['levels', 'exam', 'profile', 'help']) {
        menuGo(sec, null, 'main');
        const card = ovCard.getBoundingClientRect();
        for (const b of ovCard.querySelectorAll('button')) {
          if (b.closest('.mtabs')) continue;
          const q = vis(b); if (!q) continue;
          if (q.left < card.left - 0.5 || q.right > card.right + 0.5) out.push(sec + ': «' + name(b) + '» шире панели');
        }
        menuGo('main');
      }
      for (const tab of SET_TABS.map(t => t[0])) {
        menuGo('settings', tab, 'main');
        const card = ovCard.getBoundingClientRect();
        for (const b of ovCard.querySelectorAll('.mbody button')) {
          const q = vis(b); if (!q) continue;
          if (q.left < card.left - 0.5 || q.right > card.right + 0.5) out.push('настройки/' + tab + ': «' + name(b) + '» шире панели');
        }
      }
      menuGo('main'); doAct('play'); document.getElementById('thelp').classList.remove('on'); menuGo('pause');
      whole('пауза');
      return out;
    });
    for (const x of r) bad.push(`${w}x${h} ${x}`);
    await p.close();
  }
  check('кнопки главного меню и паузы в окне и не друг на друге, разделы не шире панели — 5 телефонов и 2 экрана ПК (@app-menu-fit)',
    bad.length === 0, bad.slice(0, 8).join(' | ') + (bad.length > 8 ? ` … ещё ${bad.length - 8}` : ''));
});

/* ---------- настройки переживают перезагрузку ---------- */
await guard('app-menu-settings-persist', async () => {
  const p = await open({ width: 1280, height: 720 });
  const want = await p.evaluate(() => {
    const out = {};
    for (const s of SETTINGS) {
      if (s.id === 'full' || (s.show && !s.show())) continue;
      menuGo('settings', s.tab, 'main');
      const v = s.get();
      let ix;
      if (s.kind === 'switch') ix = v ? 0 : 1;
      else { const i = s.vals.findIndex(x => x[0] === v); ix = (i + 1) % s.vals.length; }
      const b = ovCard.querySelector('[data-act="set:' + s.id + ':' + ix + '"]');
      if (!b) { out[s.id] = { missing: true }; continue; }
      b.click();
      const exp = s.kind === 'switch' ? ix === 1 : s.vals[ix][0];
      out[s.id] = { exp, now: SETTINGS.find(x => x.id === s.id).get() };
    }
    return out;
  });
  await p.reload(); await p.waitForTimeout(500);
  const got = await p.evaluate(() => Object.fromEntries(SETTINGS.map(s => [s.id, s.get()])));
  const bad = [];
  for (const [id, w] of Object.entries(want)) {
    if (w.missing) { bad.push(id + ': нет кнопки в разделе'); continue; }
    if (w.now !== w.exp) bad.push(id + ': сразу ' + JSON.stringify(w.now) + ' вместо ' + JSON.stringify(w.exp));
    if (got[id] !== w.exp) bad.push(id + ': после перезагрузки ' + JSON.stringify(got[id]) + ' вместо ' + JSON.stringify(w.exp));
  }
  check('каждая настройка действует сразу и переживает перезагрузку (@app-menu-settings-persist)', bad.length === 0, bad.join(' | '));
  await p.close();
});

/* ---------- «Играть» ---------- */
await guard('app-menu-play-target', async () => {
  const p = await open({ width: 1280, height: 720 });
  const r = await p.evaluate(() => {
    const prog = (names) => localStorage.setItem('trainer_progress', JSON.stringify(Object.fromEntries(names.map(n => [n, { n: 1, clean: 1, best: 10 }]))));
    const out = {};
    localStorage.removeItem('trainer_last'); localStorage.removeItem('trainer_progress'); out.fresh = playTarget().i;
    localStorage.setItem('trainer_last', LEVELS[4].name); out.unpassed = playTarget().i;
    prog([LEVELS[4].name]); out.passed = playTarget().i;
    prog([LEVELS[4].name, LEVELS[5].name, LEVELS[6].name]); out.skip = playTarget().i;
    localStorage.setItem('trainer_last', 'нет такого уровня'); out.gone = playTarget().i;
    localStorage.setItem('trainer_last', LEVELS[4].name); prog([LEVELS[4].name]);
    menuGo('main'); out.label = document.querySelector('#overlay .mm-play span').textContent;
    doAct('play'); out.opened = game.li; out.saved = localStorage.getItem('trainer_last');
    out.names = { l5: LEVELS[5].name };
    return out;
  });
  const ok = r.fresh === 0 && r.unpassed === 4 && r.passed === 5 && r.skip === 7 && r.gone === 0
    && r.label === r.names.l5 && r.opened === 5 && r.saved === r.names.l5;
  check('«Играть»: новичок — уровень 1, непройденный — снова он, после пройденного — первый непройденный (@app-menu-play-target)', ok, JSON.stringify(r));
  await p.close();
});

/* ---------- машина на подиуме ---------- */
await guard('app-menu-showroom', async () => {
  const p = await open({ width: 1280, height: 720 });
  const warns = [];
  p.on('console', m => { if (m.type() === 'warning' && /\[menu\]/.test(m.text())) warns.push(m.text()); });
  const Y0 = -0.66;
  const probe = (fix) => p.evaluate((y) => {
    if (y !== null) { showroom.yaw = y; showroom.vel = 0; showroom.holdT = 99; }
    render(0.016);
    showroomVP(); const s = toScreen(toCam({ x: 0, y: 0.75, z: 0 })); setVP(0, 0, W, H);
    const k = canvas.width / W, g = canvas.getContext('2d');
    const x0 = Math.round((s.x - 70) * k), y0 = Math.round((s.y - 40) * k), w = Math.round(140 * k), h = Math.round(80 * k);
    const d = g.getImageData(x0, y0, w, h).data;
    let bright = 0, sum = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; if (l > 120) bright++; sum += l; }
    return { bright: bright / (d.length / 4), sum, sx: s.x, sy: s.y, yaw: showroom.yaw };
  }, fix);
  const bad = [];
  const a = await probe(Y0);
  if (a.bright < 0.08) bad.push('в центре подиума нет машины: светлых пикселей ' + (a.bright * 100).toFixed(1) + '%');
  /* тяга по свободному месту справа от колонки меню */
  await p.mouse.move(a.sx + 40, a.sy + 150); await p.mouse.down(); await p.mouse.move(a.sx + 200, a.sy + 150, { steps: 10 }); await p.mouse.up();
  await p.evaluate(() => { showroom.vel = 0; showroom.holdT = 99; });
  const b = await probe(null);
  if (Math.abs(b.yaw - a.yaw) < 0.3 || Math.abs(b.sum - a.sum) / a.sum < 0.03)
    bad.push('тяга не повернула машину: курс ' + a.yaw.toFixed(2) + ' → ' + b.yaw.toFixed(2));
  const fb = await p.evaluate(() => { carModel._st = carModel.state; carModel.state = 'fail'; showroom.warned = false;
    render(0.016); render(0.016); return true; });
  const c = await probe(Y0);
  await p.evaluate(() => { carModel.state = carModel._st; });
  if (!fb || c.bright < 0.05) bad.push('без модели кузова машины не видно');
  if (warns.length !== 1) bad.push('предупреждений без модели: ' + warns.length);
  /* бюджет кадра — телефон с замедлением CPU в 4 раза */
  const ph = await open({ width: 844, height: 390 }, { touch: true, dpr: 2 });
  const cdp = await ph.context().newCDPSession(ph);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const ms = await ph.evaluate(async () => {
    const t = [];
    for (let i = 0; i < 40; i++) { await new Promise(r => requestAnimationFrame(r)); const t0 = performance.now(); render(0.016); t.push(performance.now() - t0); }
    t.sort((x, y) => x - y); return t[20];
  });
  if (ms > 3) bad.push('кадр витрины ' + ms.toFixed(2) + ' мс при CPU×4');
  await ph.close();
  check('машина на подиуме видна, крутится тягой, без модели — прежний кузов и одно предупреждение, кадр < 3 мс (@app-menu-showroom)',
    bad.length === 0, bad.join(' | ') || `кадр ${ms.toFixed(2)} мс`);
  console.log('         витрина: кадр ' + ms.toFixed(2) + ' мс при CPU×4, светлых пикселей ' + (a.bright * 100).toFixed(0) + '%');
  await p.close();
});

/* ---------- за меню нет игры ---------- */
await guard('app-menu-no-hud', async () => {
  const bad = [];
  for (const touch of [false, true]) {
    const p = await open(touch ? { width: 844, height: 390 } : { width: 1280, height: 720 }, { touch, dpr: touch ? 2 : 1 });
    const r = await p.evaluate(async () => {
      const shown = ['bar', 'coach', 'topleft', 'topright', 'touchui', 'hint'].filter(id => {
        const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; });
      const t0 = game.t; await new Promise(r => setTimeout(r, 300));
      return { shown, ran: game.t !== t0, paused };
    });
    if (r.shown.length) bad.push((touch ? 'телефон' : 'ПК') + ': видно ' + r.shown.join(', '));
    if (r.ran || !r.paused) bad.push((touch ? 'телефон' : 'ПК') + ': время уровня идёт');
    await p.close();
  }
  check('за главным меню HUD, подсказка и тач-кнопки скрыты, время уровня стоит (@app-menu-no-hud)', bad.length === 0, bad.join(' | '));
});

check('в консоли нет ошибок', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT || null, names: failed.map(r => r.name) }));
await browser.close();
process.exit(failed.length ? 1 : 0);
