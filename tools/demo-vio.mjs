#!/usr/bin/env node
/* Показ уровня с ВКЛЮЧЁННЫМИ детекторами нарушений. Обычная регрессия демо (cockpit-shots)
   гоняет computeIdealPath и violationsTick не зовёт вовсе — поэтому показ спокойно совершал
   то самое нарушение, которому уровень учит, и каждый игрок, идущий по зелёной идеальной
   линии, получал тот же штраф. Здесь показ идёт в реальном времени, а детекторы дёргаются
   параллельно; правильный показ обязан пройти уровень с пустым списком кодов.
   Зависимость — playwright-core в PW_DIR (как у cockpit-shots).
     PW_DIR=/tmp/pw node tools/demo-vio.mjs 22 23 24 25 26 27 28 29 30   # индексы уровней, 0-based
   В выводе на каждый уровень: имя, время показа, коды нарушений и снимок состояния в момент
   каждого — позиция и курс игрока, позиция и курс статиста, фазы светофоров. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const ROOT = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');
const cacheDir = path.join(process.env.HOME, 'Library/Caches/ms-playwright');
const shell = fs.readdirSync(cacheDir).filter(d => d.startsWith('chromium_headless_shell')).sort().pop();
const BIN = path.join(cacheDir, shell, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');

const levels = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ executablePath: BIN });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('console', m => { const t = m.text(); if (/FIX:|vio|zebra/.test(t)) console.log('  ' + t); });
page.on('pageerror', e => console.log('PAGEERR ' + e.message));

const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
await page.goto(url);
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); });
await page.goto(url + '&r=1');
await page.waitForTimeout(400);
await page.evaluate(() => doAct('start'));

for (const li of levels) {
  await page.evaluate((li) => {
    loadLevel(li); hideOv(); vioEvents.length = 0;
    if (!window.__vioPatched) { window.__vioPatched = 1; const _v = vio; window.vioSnap = [];
      vio = function (code, msg) { const a = level.actors[0], b = bodyPos();
        window.vioSnap.push({ code, t: +game.t.toFixed(1), pu: +b.u.toFixed(1), pv: +b.v.toFixed(1),
          pth: Math.round(deg(car.th)), pvel: +car.vel.toFixed(2),
          au: a ? +a.u.toFixed(1) : null, av: a ? +a.v.toFixed(1) : null,
          ayaw: a ? Math.round(deg(a.yaw)) : null,
          lights: (level.city.lights||[]).map(L => L.group + ':' + lightPhase(L)),
          sl: (level.city.stoplines||[]).map(x => (x.light ? x.light.group + '/' + lightPhase(x.light) : '-') + '@' + x.v) });
        return _v(code, msg); }; }
    window.vioSnap.length = 0;
    window.__probe = setInterval(() => { if (demo) violationsTick(1 / 60); }, 16);
    startDemo();
  }, li);
  await page.waitForFunction(() => !demo, null, { timeout: 180000 }).catch(() => {});
  const r = await page.evaluate(() => {
    clearInterval(window.__probe);
    return { name: level.def.name, t: +game.t.toFixed(1), vio: vioEvents.map(e => e.code), snap: window.vioSnap };
  });
  console.log(JSON.stringify(r));
}
await browser.close();
