#!/usr/bin/env node
/* Гейт практики городских уроков (23–31). Практика — тот же урок на общем городе: вариант маршрута по
   теме, команды инспектора, судят детекторы. Проверяется то, чего не видят ни демо-регрессия, ни
   level-audit: что каждый вариант проходим чисто — аккуратный водитель (tools/practice-bot.js: поворотник
   заранее, крайнее положение, уступает по правилам узла, пропускает пешеходов, встаёт у тротуара где
   можно) не получает ни одного штрафа, — и что плохой проезд ловится.

     PW_DIR=/tmp/pw node tools/practice-check.mjs
     PW_DIR=/tmp/pw URL=https://pozerkalam.space/play/ node tools/practice-check.mjs
     FAULT=noblink|startstop|noyield|nocatch|hints PW_DIR=/tmp/pw node tools/practice-check.mjs   # каждая проверка обязана покраснеть

   Код 1 — хоть одна проверка не прошла. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || null;
let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

const url = process.env.URL || 'file://' + path.join(ROOT, 'index.html');
/* HOST_RULES — какой бокс проверять под гео-DNS: «MAP pozerkalam.space 83.217.215.66» — прод РФ, без него —
   куда отправит DNS (из-под VPN это зарубежное зеркало) */
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'].concat(process.env.HOST_RULES ? ['--host-resolver-rules=' + process.env.HOST_RULES] : []) });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 20000 });
await page.evaluate(() => { try { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1'); } catch (e) {} });
await page.addScriptTag({ content: fs.readFileSync(path.join(HERE, 'practice-bot.js'), 'utf8') });

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };

/* 1. Чистый проезд каждого варианта в пустом городе: маршрут проходим, остановка у тротуара законна,
      детекторы молчат на правильной езде */
{
  const r = await page.evaluate((fault) => {
    const bad = [], all = [];
    LEVELS.forEach((d, li) => { if (!d.practice) return;
      d.practice.variants.forEach((V, vi) => {
        const x = practiceDrive(li, vi, fault === 'noblink' ? { misbehave: 'noblink' } : {});
        all.push(d.name.slice(0, 2) + V.id);
        if (!x.done || x.failed || x.score !== 0 || x.hits) bad.push(d.name.slice(0, 2) + V.id + ' [' + x.log.join(' ') + '] этап ' + x.stage + '/' + x.stages + (x.done ? '' : ' не доехал'));
      }); });
    /* старт не на жёлтом зигзаге 1.17: с первого кадра игрок стоял бы там, где стоять нельзя (п. 12.4) */
    LEVELS.forEach((d, li) => { if (!d.practice) return;
      d.practice.variants.forEach((V, vi) => {
        window.PRACTICE_VARIANT = vi; openLevel(li, 'practice', 'practice'); delete window.PRACTICE_VARIANT; hideOv(); paused = true;
        const st = level.start;
        for (const S of (level.city.stops || [])) { if (!S.zone) continue;
          const zu = S.zone.reduce((a, p) => a + p.u, 0) / 4, zv = S.zone.reduce((a, p) => a + p.v, 0) / 4;
          if (fault === 'startstop' && li === LEVELS.findIndex((l) => l.practice) && vi === 0) { st.u = zu; st.v = zv; }
          const f = fuv(S.yaw), r = ruv(S.yaw), lon = (st.u - zu) * f.u + (st.v - zv) * f.v, lat = (st.u - zu) * r.u + (st.v - zv) * r.v;
          if (Math.abs(lat) < 2.5 && Math.abs(lon) < S.len / 2 + HALF_L) bad.push(d.name.slice(0, 2) + V.id + ': старт на остановке «' + S.street + '»');
        }
      }); });
    return { bad, n: all.length };
  }, FAULT);
  check('все варианты практики проезжаются чисто в пустом городе и стартуют не на остановке (@city-practice-clean-drive)', r.bad.length === 0 && r.n >= 30,
    r.bad.length ? r.bad.slice(0, 6).join('; ') : r.n + ' вариантов');
}

/* 2. Тот же проезд в потоке, со статистами и пешеходами — два жребия: светофор, выход статистов и пешеходов
      каждый раз другие. Водитель уступает по правилам узла, и ни одного штрафа быть не должно */
{
  const r = await page.evaluate((fault) => {
    const bad = []; let n = 0;
    for (const seed of [11, 29]) LEVELS.forEach((d, li) => { if (!d.practice) return;
      d.practice.variants.forEach((V, vi) => {
        const x = practiceDrive(li, vi, { traffic: true, actors: true, seed, misbehave: fault === 'noyield' ? 'noyield' : null }); n++;
        if (!x.done || x.failed || x.score !== 0 || x.hits) bad.push(d.name.slice(0, 2) + V.id + '/' + seed + ' [' + x.log.join(' ') + ']' + (x.done ? '' : ' не доехал'));
      }); });
    return { bad, n };
  }, FAULT);
  check('все варианты проезжаются чисто в потоке со статистами и пешеходами, два жребия (@city-practice-traffic-drive)',
    r.bad.length === 0, r.bad.length ? r.bad.slice(0, 6).join('; ') : r.n + ' проездов');
}

/* 3. Плохой проезд ловится: без поворотника, налево из правой полосы, под пешехода на переходе */
{
  const r = await page.evaluate((fault) => {
    if (fault === 'nocatch') { const v0 = window.vio; window.vio = (code, msg) => { if (code !== 'no-blinker' && code !== 'turn-pos' && code !== 'ped') v0(code, msg); }; }
    const li23 = LEVELS.findIndex((d) => d.name.startsWith('23 ')), li25 = LEVELS.findIndex((d) => d.name.startsWith('25 '));
    const out = {};
    out.noblink = practiceDrive(li23, 0, { misbehave: 'noblink' }).log;
    out.rightlane = practiceDrive(li23, 0, { misbehave: 'rightlane' }).log;
    /* пешеход выходит на зебру Заводской с ближней стороны, когда машина в 14 м: водитель не тормозит */
    out.ped = practiceDrive(li25, 0, { misbehave: 'noyield', setup: () => {
      const Z = PR_ZEBRAS.zav, p = pedActor([Z.a, Z.b], 1.3, (s) => Math.hypot(s.u - Z.u, s.v - Z.v) < 16, 0, 2);
      p.hw = p.w / 2; p.hl = p.l / 2; level.obs.push(p); level.rend.push(p); level.actors.push(p);
    } }).log;
    return out;
  }, FAULT);
  const has = (log, code) => log.some((l) => l.startsWith(code + '@'));
  check('плохой проезд ловится: без поворотника, налево из правой полосы, под пешехода (@city-practice-catches)',
    has(r.noblink, 'no-blinker') && has(r.rightlane, 'turn-pos') && has(r.ped, 'ped'),
    'без поворотника [' + r.noblink.join(' ') + '], из правой [' + r.rightlane.join(' ') + '], пешеход [' + r.ped.join(' ') + ']');
}

/* 4. Практика без подсказок: нет фаз, маркеров, линии на асфальте, зоны и показа; команды называют улицы */
{
  const r = await page.evaluate((fault) => {
    const bad = [];
    LEVELS.forEach((d, li) => { if (!d.practice) return;
      d.practice.variants.forEach((V, vi) => {
        window.PRACTICE_VARIANT = vi; openLevel(li, 'practice', 'practice'); delete window.PRACTICE_VARIANT; hideOv(); paused = true;
        if (fault === 'hints') level.idealDraw = buildIdealDraw([{ u: 0, v: 0 }, { u: 1, v: 1 }, { u: 2, v: 2 }, { u: 3, v: 3 }, { u: 4, v: 4 }, { u: 5, v: 5 }]);
        phaseTick(1 / 60); const f = examFlags();
        const tag = d.name.slice(0, 2) + V.id;
        if (curPhase) bad.push(tag + ': фаза');
        if (Object.keys(level.marks || {}).length) bad.push(tag + ': маркеры');
        if (level.idealDraw) bad.push(tag + ': линия показа');
        if (f.line || f.zone || f.hints) bad.push(tag + ': линия/зона инспектора');
        startDemo(); if (demo) { bad.push(tag + ': показ'); stopDemo(); }
        for (const st of exam.route) if (/undefined|null/.test(st.cmd) || !st.cmd) bad.push(tag + ': команда «' + st.cmd + '»');
        if (exam.route.length < 2) bad.push(tag + ': этапов ' + exam.route.length);
      }); });
    return bad;
  }, FAULT);
  check('практика без подсказок: нет фаз, маркеров, линии, зоны и показа; команды называют улицы (@city-practice-no-hints)',
    r.length === 0, r.slice(0, 6).join('; '));
}

check('страница без исключений', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
