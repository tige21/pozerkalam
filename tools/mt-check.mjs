#!/usr/bin/env node
/* Сценарная проверка МКПП: скрипт жмёт настоящие клавиши (KeyboardEvent с физическими кодами)
   в живой игре и сверяет поведение с правилами механики — как это делал бы ученик.
   Запуск (playwright-core ставится во временную папку, см. cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/mt-check.mjs
     PW_DIR=/tmp/pw URL=https://pozerkalam.space/play/ node tools/mt-check.mjs   # проверить прод
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
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive', 'trainer_drive_mt']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0'); localStorage.removeItem('trainer_gearbox'); });
await page.goto(url + 'r');
await page.waitForTimeout(500);

/* клавиши идут через настоящие события: так проверяется весь путь, включая фильтр полей ввода */
const down = c => page.evaluate(k => document.dispatchEvent(new KeyboardEvent('keydown', { code: k, bubbles: true })), c);
const up = c => page.evaluate(k => document.dispatchEvent(new KeyboardEvent('keyup', { code: k, bubbles: true })), c);
const tap = async (c, hold = 60) => { await down(c); await page.waitForTimeout(hold); await up(c); };
const st = () => page.evaluate(() => ({ gearbox: opt.gearbox, mgear: car.mgear, clu: +car.clu.toFixed(2), rpm: Math.round(car.rpm),
  stalled: car.stalled, vel: +car.vel.toFixed(2), warn: selWarnT > 0 ? selWarn : '', hand: !!car.hand,
  gearHud: (document.getElementById('gearVal') || {}).textContent || '', stalls: game.stalls || 0 }));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

/* 1. включение механики со стартового экрана */
const gbSeg = await page.evaluate(() => [...document.querySelectorAll('.gbseg button')]
  .map(b => b.dataset.act + '|' + b.textContent + '|' + (b.classList.contains('on') ? 'on' : '')));
check('на старте виден выбор из двух коробок с отмеченной текущей',
  gbSeg.length === 2 && /gearbox:AT\|автомат\|on/.test(gbSeg[0]) && /gearbox:MT\|механика\|$/.test(gbSeg[1]), gbSeg.join(' '));
await page.evaluate(() => doAct('gearbox:MT'));
const afterToggle = await page.evaluate(() => ({ g: opt.gearbox, ls: localStorage.getItem('trainer_gearbox'),
  on: ([...document.querySelectorAll('.gbseg button.on')][0] || {}).dataset || {},
  bullet: (document.querySelector('.startlist') || { textContent: '' }).textContent.includes('Механика') }));
check('переключение на механику сохраняется и подписано',
  afterToggle.g === 'MT' && afterToggle.ls === 'MT' && afterToggle.on.act === 'gearbox:MT', JSON.stringify(afterToggle));
check('подсказка на старте меняется под механику', afterToggle.bullet);

await page.evaluate(() => { doAct('start'); loadLevel(0); });
await page.waitForTimeout(400);

/* 2. передача без сцепления не включается */
await tap('Period');
let s = await st();
check('без сцепления передача не включается', s.mgear === 0 && /сцеплени/i.test(s.warn), 'mgear=' + s.mgear + ' warn="' + s.warn + '"');

/* 3. со сцеплением включается первая */
await down('ShiftLeft'); await page.waitForTimeout(400);
await tap('Period');
s = await st();
check('со сцеплением включается 1-я', s.mgear === 1 && s.clu > 0.85, 'mgear=' + s.mgear + ' clu=' + s.clu);

/* 4. бросил сцепление без газа — глохнет */
await up('ShiftLeft'); await page.waitForTimeout(1400);
s = await st();
check('бросил сцепление без газа — глохнет', s.stalled === true && s.stalls >= 1, JSON.stringify({ stalled: s.stalled, rpm: s.rpm }));

/* 5. запуск двигателя: без сцепления на передаче — отказ, со сцеплением — заводится */
await tap('KeyY'); s = await st();
check('на передаче без сцепления не заводится', s.stalled === true && /сцеплен/i.test(s.warn), 'warn="' + s.warn + '"');
await down('ShiftLeft'); await page.waitForTimeout(300); await tap('KeyY');
s = await st();
check('с выжатым сцеплением заводится', s.stalled === false && s.rpm >= 800, JSON.stringify({ stalled: s.stalled, rpm: s.rpm }));

/* 6. трогание: газ и плавный отпуск сцепления */
await down('KeyW'); await page.waitForTimeout(300); await up('ShiftLeft');
await page.waitForTimeout(2200);
s = await st();
check('трогание с 1-й: машина едет и не глохнет', s.vel > 0.8 && !s.stalled, 'vel=' + s.vel + ' rpm=' + s.rpm);

/* 7. переключение 1 → 2 на ходу */
await tap('Period'); s = await st();
const noShiftNoClutch = s.mgear === 1 && /сцеплени/i.test(s.warn);
await down('ShiftLeft'); await page.waitForTimeout(300); await tap('Period'); await up('ShiftLeft');
await page.waitForTimeout(300);
const s2 = await st();
check('без сцепления на ходу передача не переключается', noShiftNoClutch, 'mgear=' + s.mgear);
check('со сцеплением 1 → 2 переключается', s2.mgear === 2, 'mgear=' + s2.mgear);

/* 8. задняя на ходу запрещена */
await down('ShiftLeft'); await page.waitForTimeout(300); await tap('Enter'); await up('ShiftLeft');
s = await st();
check('задняя на ходу запрещена', s.mgear === 2 && /останов/i.test(s.warn), 'mgear=' + s.mgear + ' warn="' + s.warn + '"');

/* 9. тормоз в пол на передаче без сцепления — двигатель глохнет (как в жизни) */
await up('KeyW'); await down('KeyS'); await page.waitForTimeout(2600); await up('KeyS');
s = await st();
check('остановка на передаче без сцепления глушит двигатель', s.stalled === true && s.vel === 0, JSON.stringify({ stalled: s.stalled, vel: s.vel }));

/* 10. остановка с выжатым сцеплением двигатель не глушит */
await down('ShiftLeft'); await page.waitForTimeout(300); await tap('KeyY'); await page.waitForTimeout(200);
await tap('Period'); await page.waitForTimeout(100);            /* 2-я → без ошибок при выжатом */
await down('KeyW'); await page.waitForTimeout(200); await up('ShiftLeft'); await page.waitForTimeout(1500);
await up('KeyW'); await down('ShiftLeft'); await down('KeyS'); await page.waitForTimeout(2200); await up('KeyS');
s = await st();
check('остановка с выжатым сцеплением двигатель не глушит', s.stalled === false && Math.abs(s.vel) < 0.2, JSON.stringify({ stalled: s.stalled, vel: s.vel, rpm: s.rpm }));

/* 11. после остановки включается задняя и машина едет назад */
await tap('Enter');
s = await st();
check('после остановки включается задняя', s.mgear === -1, 'mgear=' + s.mgear + ' vel=' + s.vel);
await down('KeyW'); await page.waitForTimeout(300); await up('ShiftLeft'); await page.waitForTimeout(1800);
s = await st();
check('на задней машина едет назад', s.vel < -0.4 && !s.stalled, 'vel=' + s.vel + ' stalled=' + s.stalled);
await up('KeyW'); await down('KeyS'); await page.waitForTimeout(1500); await up('KeyS');
await page.evaluate(() => { restart(); });
await page.waitForTimeout(300);

/* 12. ручник душит разгон */
await page.evaluate(() => { car.vel = 0; });
await tap('KeyJ');
await down('ShiftLeft'); await page.waitForTimeout(250); await tap('Enter'); await page.waitForTimeout(100); await up('ShiftLeft');
await down('KeyW'); await page.waitForTimeout(2200);
s = await st();
/* правильное поведение: машина либо ползёт, либо глохнет — но не разгоняется */
check('с ручником машина не разгоняется', s.hand === true && (Math.abs(s.vel) < 1.2 || s.stalled), 'hand=' + s.hand + ' vel=' + s.vel + ' stalled=' + s.stalled);
await up('KeyW'); await tap('KeyJ');

/* 13. демонстрация едет на автомате и возвращает механику */
await page.evaluate(() => { restart(); startDemo(); });
await page.waitForTimeout(600);
const inDemo = await page.evaluate(() => ({ g: opt.gearbox, demo: !!demo }));
await page.evaluate(() => { if (typeof stopDemo === 'function') stopDemo(); else restart(); });
await page.waitForTimeout(400);
const afterDemo = await page.evaluate(() => opt.gearbox);
check('демо едет на автомате', inDemo.demo && inDemo.g === 'AT', JSON.stringify(inDemo));
check('после демо механика возвращается', afterDemo === 'MT', 'gearbox=' + afterDemo);

/* 14. возврат на автомат из меню восстанавливает селектор */
await page.evaluate(() => setGearbox('AT'));
await page.waitForTimeout(300);
const back = await page.evaluate(() => ({ g: opt.gearbox, sel: car.sel, ls: localStorage.getItem('trainer_gearbox') }));
check('возврат на автомат восстанавливает P R N D', back.g === 'AT' && back.sel === 'P' && back.ls === 'AT', JSON.stringify(back));

/* 15. интерфейс механики: никакого P R N D в кабине, панели и на тач-кнопках */
await page.evaluate(() => { setGearbox('MT'); loadLevel(0); });
await page.waitForTimeout(400);
await down('ShiftLeft'); await page.waitForTimeout(300); await tap('Period'); await up('ShiftLeft');
await page.waitForTimeout(300);
const ui = await page.evaluate(() => {
  const bar = (document.getElementById('gearVal') || {}).textContent || '';
  const lbl = (document.getElementById('gearLbl') || {}).textContent || '';
  const rpmLbl = ((document.getElementById('rpmCell') || {}).querySelector ? document.getElementById('rpmCell').querySelector('.k').textContent : '');
  /* кэш чистим и рисуем кадр из салона: важно, какие буквы щиток запросит СЕЙЧАС,
     а не что осталось от прошлых шагов теста */
  for (const k of Object.keys(imgCache)) if (k.startsWith('dial-')) delete imgCache[k];
  if (opt.camMode !== CAM_FP) pressKey('KeyV');
  render(0.016);
  const keys = Object.keys(imgCache).filter(k => k.startsWith('dial-'));
  let lever = null;
  const keep = pushBox; const seen = [];
  pushBox = function (u, y, v, hw, hh, hl, yaw, col, bias, o) { seen.push(v); return keep.apply(null, arguments); };
  try { emitSelector(cabinCtx(bodyPos().u, bodyPos().v, car.th)); } finally { pushBox = keep; }
  lever = seen.length;
  return { bar, lbl, rpmLbl, keys, lever, touch: [...document.querySelectorAll('#tgear span[data-gear]')].map(e => e.textContent) };
});
check('в панели передачи механики, а не P R N D', /R\s*N\s*1\s*2/.test(ui.bar.replace(/\s+/g, ' ')) && !/P/.test(ui.bar), 'панель="' + ui.bar.trim() + '"');
check('подпись панели предлагает сменить коробку', /механик/i.test(ui.lbl) && /смен/i.test(ui.lbl), 'подпись="' + ui.lbl + '"');
check('ячейка оборотов называет клавишу сцепления', /сцеплен/i.test(ui.rpmLbl) && /Shift/.test(ui.rpmLbl), 'подпись="' + ui.rpmLbl + '"');
check('щиток в салоне рисует буквы механики', ui.keys.length > 0 && ui.keys.every(k => k.startsWith('dial-MT')), ui.keys.join(',') || 'щиток не рисовался');
check('рычаг на тоннеле рисуется по передаче механики', ui.lever > 0, 'граней рычага=' + ui.lever);

/* 17. Enter из нейтрали даёт первую, а не заднюю: новичок жмёт его, чтобы поехать */
await page.evaluate(() => { restart(); });
await page.waitForTimeout(300);
await down('ShiftLeft'); await page.waitForTimeout(300); await tap('Enter'); await up('ShiftLeft');
s = await st();
check('Enter из нейтрали включает первую, а не заднюю', s.mgear === 1, 'mgear=' + s.mgear);

/* 18. коробка переключается всеми видимыми путями, а не только со стартового экрана */
const paths = await page.evaluate(() => {
  const out = { start: opt.gearbox };
  document.getElementById('gearLbl').click(); out.byLabel = opt.gearbox;
  pressKey('Backquote'); out.byKey = opt.gearbox;
  buildMenu();
  const menu = [...document.querySelectorAll('#tmGrid button')].map(b => b.textContent);
  out.menuHas = menu.indexOf('Автомат') >= 0 && menu.indexOf('Механика') >= 0;
  out.menuTop = menu.indexOf('Механика') >= 0 && menu.indexOf('Механика') < 6;
  return out;
});
check('клик по подписи панели меняет коробку', paths.start === 'MT' && paths.byLabel === 'AT', JSON.stringify(paths));
check('клавиша ` меняет коробку', paths.byKey === 'MT', 'после клавиши=' + paths.byKey);
check('в меню ≡ коробка отдельным блоком в начале', paths.menuHas && paths.menuTop, JSON.stringify(paths));

/* 19. телефон: сцепление слева, стартер вместо ручника, подсветка адресная */
const touch = await page.evaluate(() => {
  restart(); setTouch(true); noteT = 0; selWarnT = 0; updateHUD();
  const el = document.getElementById('tclutch'), b = el.getBoundingClientRect();
  const r = { clutchShown: getComputedStyle(el).display !== 'none',
              clutchLeft: b.left < innerWidth / 2,
              needbrake: document.body.classList.contains('needbrake'),
              needclutch: document.body.classList.contains('needclutch') };
  car.stalled = true; updateHUD();
  r.startShown = document.getElementById('tstart').style.display !== 'none';
  r.handHidden = document.getElementById('thand').style.display === 'none';
  r.needstart = document.body.classList.contains('needstart');
  car.clu = 1; mtStart(); r.started = !car.stalled;
  updateHUD(); r.startHidden = document.getElementById('tstart').style.display === 'none';
  setTouch(false); noteT = 0;
  return r;
});
check('на телефоне сцепление видно и лежит в левой половине экрана', touch.clutchShown && touch.clutchLeft, JSON.stringify(touch));
check('на механике не горит ложный ТОРМОЗ, горит СЦЕПЛЕНИЕ', touch.needbrake === false && touch.needclutch === true, JSON.stringify(touch));
check('заглох на телефоне: появляется ЗАВЕСТИ вместо РУЧН', touch.startShown && touch.handHidden && touch.needstart, JSON.stringify(touch));
check('кнопка ЗАВЕСТИ заводит двигатель и прячется', touch.started && touch.startHidden, JSON.stringify(touch));

/* 20. гайд первого троганья на механике исполним: раньше он ждал car.sel==='D' и залипал */
await page.evaluate(() => { localStorage.removeItem('trainer_drive_mt');
  loadLevel(0); tut = null; noteT = 0; selWarnT = 0; maybeStartTut(); });
await page.waitForTimeout(300);
const card = () => page.evaluate(() => (document.getElementById('coach') || {}).textContent || '');
const cards = [await card()];
await down('ShiftLeft'); await page.waitForTimeout(500); cards.push(await card());
await tap('Enter'); await page.waitForTimeout(400); cards.push(await card());
await down('KeyW'); await page.waitForTimeout(300); await up('ShiftLeft'); await page.waitForTimeout(2000);
cards.push(await card());
await page.waitForTimeout(2500); await up('KeyW');
const tutEnd = await page.evaluate(() => ({ live: !!tut, ls: localStorage.getItem('trainer_drive_mt'),
  mgear: car.mgear, vel: +car.vel.toFixed(2) }));
check('гайд троганья на механике доходит до конца', tutEnd.live === false && tutEnd.ls === '1', JSON.stringify(tutEnd));
check('гайд механики нигде не зовёт включать D', !cards.some(t => /включится D|тапни D/.test(t)), cards.join(' ⟶ '));
check('первый шаг гайда механики — про сцепление', /1\/4/.test(cards[0]) && /сцеплен/i.test(cards[0]), cards[0]);

/* 16. настройка графики: «максимум» отключает регулятор */
const gfx = await page.evaluate(() => { const before = opt.gfx; opt.gfx = 'max'; qBest = 0; qApply(0); frameGap = 40; qCoolT = 0;
  qTick(2); const held = qLevel; opt.gfx = 'auto'; qCoolT = 0; qTick(2); return { before, held, after: qLevel }; });
check('«графика: максимум» держит уровень качества', gfx.held === 0 && gfx.after > 0, JSON.stringify(gfx));

check('в консоли нет ошибок', errors.length === 0, errors.join(' | '));

const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(r => r.name) }));
await browser.close();
process.exit(failed.length ? 1 : 0);
