#!/usr/bin/env node
/* Калибровка порога непропуска на ЖИВОЙ геометрии уровня: машину ведём по идеальной
   траектории показа с растущей задержкой старта, статист едет своим маршрутом. Для каждой
   задержки печатаем минимальное расстояние между машинами и сработавшие коды.
   Ожидание монотонное: там, где машины реально сходятся ближе ~3,5 м, должен быть 'yield';
   там, где расходятся дальше ~4 м, кодов быть не должно. Так и подобраны YIELD_TCA/GAP/LAT.
     PW_DIR=/tmp/pw node tools/yield-sweep.mjs 29    # кольцо (индекс уровня, 0-based) */
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

const li = +(process.argv[2] || 29);
const browser = await chromium.launch({ executablePath: BIN });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', e => console.log('PAGEERR ' + e.message));
const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
await page.goto(url);
await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); });
await page.goto(url + '&r=1');
await page.waitForTimeout(400);
await page.evaluate(() => doAct('start'));

const rows = await page.evaluate((li) => {
  const out = [];
  for (let delay = 0; delay <= 14; delay += 0.5) {
    loadLevel(li); hideOv();
    const pts = computeIdealPath();
    if (!pts) return [{ err: 'нет показа' }];
    /* длины дуг */
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v));
    const total = acc[acc.length - 1];
    const SP = 2.6, dt = 1 / 60;
    vioEvents.length = 0;
    for (const a of level.actors) a.act.started = true;
    let minD = 99, s = 0;
    for (let t = 0; t < delay + total / SP + 2; t += dt) {
      if (t >= delay) s = Math.min(total, s + SP * dt);
      let i = 1; while (i < acc.length - 1 && acc[i] < s) i++;
      const k = (s - acc[i - 1]) / Math.max(acc[i] - acc[i - 1], 1e-6);
      const u = pts[i - 1].u + (pts[i].u - pts[i - 1].u) * k;
      const v = pts[i - 1].v + (pts[i].v - pts[i - 1].v) * k;
      const th = Math.atan2(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v);
      setBody(u, v, th); car.vel = (t >= delay && s < total) ? SP : 0;
      game.t = t;
      actorsTick(dt); violationsTick(dt);
      const b = bodyPos();
      for (const a of level.actors) if (a.act.started && !a.act.done)
        minD = Math.min(minD, Math.hypot(a.u - b.u, a.v - b.v));
    }
    out.push({ delay, minD: +minD.toFixed(2), codes: vioEvents.map(e => e.code) });
  }
  loadLevel(0);
  return out;
}, li);
for (const r of rows) console.log(JSON.stringify(r));
await browser.close();
