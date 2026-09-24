#!/usr/bin/env node
/* Гейт устойчивости кадра: ломает игру изнутри (бросает исключение в HUD, в рендере, в таймере)
   и проверяет, что цикл живёт, консоль получает одну запись, а крэш-отчёт уходит в приёмник
   отзывов ровно один раз за сессию и молчит под headless. Плюс мусор в trainer_progress и
   пустой doAct — то, что раньше роняло win() и кнопки.
   Запуск (playwright-core во временной папке, см. cockpit-shots.mjs):
     PW_DIR=/tmp/pw node tools/crash-check.mjs
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FB_URL = 'https://pozerkalam.space/api/feedback';

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
const errors = [], reports = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.route(FB_URL, async route => {
  try { reports.push(JSON.parse(route.request().postData() || '{}')); } catch { reports.push({ bad: true }); }
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
await page.goto(url);
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive', 'trainer_drive_mt']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0'); });
await page.goto(url + 'r');
await page.waitForTimeout(400);
await page.evaluate(() => { doAct('start'); loadLevel(0); });
await page.waitForTimeout(300);

/* 1. исключение в HUD: мир идёт, консоль — одна запись, тост на карточке */
const before = await page.evaluate(() => ({ t: game.t, n: Object.keys(crashN).length }));
await page.evaluate(() => { window.CRASH_REPORT_FORCE = true; window.__setClear = setClear; setClear = () => { throw new Error('boom-hud'); }; });
await page.waitForTimeout(1000);
const afterHud = await page.evaluate(() => ({ t: game.t, faces: facesFrame, hits: crashN.hud || 0, sent: crashSent,
  coach: (document.getElementById('coach') || { textContent: '' }).textContent }));
const crashErrs = errors.filter(e => e.includes('[crash]'));
check('исключение в HUD не останавливает кадр, консоль получает одну запись (@app-crash-hud-survives)',
  afterHud.t > before.t + 0.5 && afterHud.faces > 0 && afterHud.hits > 30 && crashErrs.length === 1 && /перезапусти уровень/.test(afterHud.coach),
  JSON.stringify({ dt: +(afterHud.t - before.t).toFixed(2), faces: afterHud.faces, hits: afterHud.hits, errs: crashErrs.length, toast: /перезапусти/.test(afterHud.coach) }));

/* 2. отчёт ушёл один раз с контекстом; второе место отчёт не шлёт */
await page.waitForTimeout(200);
const r0 = reports[0] || {};
await page.evaluate(() => { const orig = render; render = () => { throw new Error('boom-render'); }; setTimeout(() => { render = orig; }, 300); });
await page.waitForTimeout(600);
const afterRender = await page.evaluate(() => ({ renderHits: crashN.render || 0, t: game.t }));
check('крэш-отчёт уходит один раз за сессию: kind bug, текст [crash] hud, ctx с build и уровнем (@app-crash-report-once)',
  reports.length === 1 && r0.kind === 'bug' && /^\[crash\] hud: boom-hud/.test(r0.text || '') && r0.ctx && r0.ctx.build && r0.ctx.level && afterRender.renderHits > 5,
  JSON.stringify({ reports: reports.length, kind: r0.kind, text: (r0.text || '').split('\n')[0], build: r0.ctx && r0.ctx.build, level: r0.ctx && r0.ctx.level, renderHits: afterRender.renderHits }));

/* 3. необработанная ошибка вне кадра — отчёт с where=window */
await page.evaluate(() => { crashSent = false; setTimeout(() => { throw new Error('boom-async'); }, 0); });
await page.waitForTimeout(400);
const r1 = reports[1] || {};
check('window.onerror шлёт отчёт с местом window (@app-crash-window-error)',
  reports.length === 2 && /^\[crash\] window: boom-async/.test(r1.text || ''), JSON.stringify({ reports: reports.length, text: (r1.text || '').split('\n')[0] }));

/* 4. без обхода под headless отчёт молчит, кадр всё равно жив */
await page.evaluate(() => { crashSent = false; delete crashN.hud; window.CRASH_REPORT_FORCE = false; setClear = window.__setClear; });
const n0 = reports.length;
await page.evaluate(() => { setClear = () => { throw new Error('boom-silent'); }; });
await page.waitForTimeout(500);
const silent = await page.evaluate(() => ({ hits: crashN.hud || 0, sent: crashSent, webdriver: navigator.webdriver, t: game.t }));
check('под headless (navigator.webdriver) отчёт не уходит, кадр живёт (@app-crash-headless-silent)',
  reports.length === n0 && !silent.sent && silent.hits > 10 && silent.webdriver === true, JSON.stringify(silent));

/* 5. мусор в trainer_progress не роняет прогресс и победу */
await page.evaluate(() => { setClear = window.__setClear; });
const prog = await page.evaluate(() => {
  const out = {};
  localStorage.setItem('trainer_progress', '[1,2]'); progMigrated = true;
  out.arr = JSON.stringify(progAll());
  localStorage.setItem('trainer_progress', '{"x":5,"y":{"n":"3","clean":null},"z":null}');
  out.obj = JSON.stringify(progAll());
  try { progAdd('t', 10, 0); out.add = JSON.stringify(progOf('t')); } catch (e) { out.addErr = e.message; }
  try { game.done = false; win(); out.won = game.done && !!document.querySelector('.ov, #ov, [data-act="next"]'); } catch (e) { out.winErr = e.message; }
  return out;
});
check('мусор в trainer_progress вычищается, progAdd и win() не бросают (@app-progress-garbage)',
  prog.arr === '{}' && /"y":\{"n":3,"clean":0\}/.test(prog.obj) && !/"x"|"z"/.test(prog.obj) && prog.add && !prog.addErr && prog.won && !prog.winErr, JSON.stringify(prog));

/* 6. пустое действие */
const empty = await page.evaluate(() => { try { doAct(); doAct(''); doAct(null); return 'ok'; } catch (e) { return e.message; } });
check('doAct без действия не бросает (@app-doact-empty)', empty === 'ok', empty);

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map(f => f.name) }));
process.exit(failed.length ? 1 : 0);
