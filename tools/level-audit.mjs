#!/usr/bin/env node
/* Аудит обучающего слоя всех уровней: то, чего не видят ни демо-регрессия, ни learner.js.
   Демо-регрессия доказывает, что манёвр проезжаем; learner.js читает карточку, но ходит
   в реальном времени и на городе спотыкается о собственное руление. Здесь показ каждого
   уровня прогоняется headless (как computeIdealPath), и на каждом кадре дёргается phaseTick:
   получается точная лента «какая карточка висела, сколько и что показывал её чип».

   Ловит: дыру без активной фазы, карточку короче выдержки, чип, шкала которого не доходит
   до 100 % за весь показ, фазу, которую не выигрывает ни одно состояние, касание препятствия
   на образцовом проезде, маркер не на траектории показа и падение updateHUD.

   Зависимость — playwright-core в PW_DIR (как у cockpit-shots.mjs).
     PW_DIR=/tmp/pw node tools/level-audit.mjs                    # локальный файл
     PW_DIR=/tmp/pw URL=https://pozerkalam.space/play/ node tools/level-audit.mjs
   Код 1, если есть падение updateHUD, дыра без фазы, уровень без живой подсказки,
   недостижимая фаза или касание препятствия на показе. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const JSON_OUT = process.argv.includes('--json');

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

const url = process.env.URL || 'file://' + path.join(ROOT, 'index.html');
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).split('\n')[0]));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 20000 });
/* онбординг и первый выезд перекрывают карточку своими шагами — уровень надо смотреть без них */
await page.evaluate(() => { try { localStorage.setItem('trainer_seen', '1'); localStorage.setItem('trainer_drive', '1'); localStorage.setItem('trainer_hint', '1'); } catch (e) {} });
await page.reload();
await page.waitForFunction(() => typeof LEVELS !== 'undefined', null, { timeout: 20000 });

const report = await page.evaluate(() => {
  const out = [];

  /* та же арифметика, что в coachGoalTick: игрок видит шкалу, а не строгое сравнение,
     и «цель 0°» закрывается на 99,5 % — иначе тул кричал бы на каждой фазе с нулём */
  const pctOf = (start, v, g) => {
    const den = start - g.target;
    if (Math.abs(den) < 1e-6) return 100;
    return Math.round(Math.max(0, Math.min(100, (start - v) / den * 100)));
  };

  function replay(i) {
    const d = DEMOS[i];
    if (!d) return null;
    const save = { ru: car.ru, rv: car.rv, th: car.th, steer: car.steer, vel: car.vel, gear: car.gear,
                   sel: car.sel, t: game.t, snd: opt.sound, box: opt.gearbox, clear: lastClear };
    opt.sound = false; opt.gearbox = 'AT';
    setBody(level.start.u, level.start.v, level.start.th);
    car.steer = 0; car.vel = 0; car.gear = 0; car.sel = 'P';
    if (d.start) setBody(d.start.u, d.start.v, d.start.th);
    demo = { i: 0, t: 0, dist: 0, guard: 0, say: 0 };
    curPhase = null; phaseCand = null; phaseHold = 0;
    for (const o of level.obs) { o._touch = false; o._audit = null; }
    const ph = level.def.phases || [];
    const samples = [], pts = [];
    let T = 0, reached = false;
    game.t = 0;
    while (demo && T < 160) {
      demo.say = 0; game.t += 1 / 60; game.hitCd = 1;
      /* поток крутим сами: actorsTick живёт в frame(), а здесь кадров нет — с замершими
         машинами показ упирался бы в них как в столбы, а чип «окно» стоял бы на 99 с */
      if (level.actors.length) actorsTick(1 / 60);
      demoStep(1 / 60);
      let rem = 1 / 60;
      while (rem > 1e-5) { const s = Math.min(1 / 120, rem); stepCar(s); rem -= s; }
      lastClear = clearances();
      phaseTick(1 / 60);
      const met = {};
      for (const k in COACH_METRICS) { try { met[k] = COACH_METRICS[k].get(); } catch (e) { met[k] = null; } }
      samples.push({ t: +T.toFixed(2), idx: curPhase ? ph.indexOf(curPhase) : -1, met });
      /* касание считаем по защёлке _touch: её ставит resolveCollisions ДО выталкивания,
         а satMTV после кадра у твёрдого препятствия уже ничего не видит */
      for (const o of level.obs) {
        if (!o._touch) continue;
        if (!o._audit) o._audit = { kind: o.kind || 'obs', u: +o.u.toFixed(1), v: +o.v.toFixed(1),
                                    t0: +T.toFixed(1), seg: demo ? demo.i : -1, frames: 0 };
        o._audit.frames++;
      }
      const bp = bodyPos(); pts.push({ u: bp.u, v: bp.v });
      if (goalPoseOk() && Math.abs(car.vel) < 0.12) { reached = true; break; }
      T += 1 / 60;
    }
    demo = null;
    for (const k in input) input[k] = false;
    car.ru = save.ru; car.rv = save.rv; car.th = save.th; car.steer = save.steer;
    car.vel = save.vel; car.gear = save.gear; car.sel = save.sel; game.t = save.t;
    opt.sound = save.snd; opt.gearbox = save.box; lastClear = save.clear;
    curPhase = null; phaseCand = null; phaseHold = 0;
    return { samples, reached, time: T, pts, hits: level.obs.filter(o => o._audit).map(o => o._audit) };
  }

  for (let i = 0; i < LEVELS.length; i++) {
    const warns = [];
    const ow = console.warn;
    console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
    let loadErr = null;
    try { loadLevel(i); hideOv(); } catch (e) { loadErr = String(e); }
    console.warn = ow;

    const def = level.def, ph = def.phases || [];
    const rec = { i, n: i + 1, name: def.name, warns, loadErr, nPhases: ph.length,
                  hasDemo: !!DEMOS[i], issues: [], cards: [] };

    /* карточка на старте уровня: игрок ещё ничего не нажал */
    curPhase = null; phaseCand = null; phaseHold = 0;
    lastClear = clearances();
    phaseTick(0.016);
    try { updateHUD(); } catch (e) { rec.issues.push('updateHUD падает: ' + String(e).slice(0, 70)); }
    rec.startCard = document.getElementById('coach').textContent.replace(/\s+/g, ' ').trim();

    ph.forEach((p, k) => {
      if (!p.act && !p.hint) rec.issues.push(`фаза ${k}: нет ни act, ни hint`);
      if (p.goal && p.goal.metric && !COACH_METRICS[p.goal.metric])
        rec.issues.push(`фаза ${k}: неизвестная метрика чипа «${p.goal.metric}»`);
      if (p.act && p.act.length > 52) rec.issues.push(`фаза ${k}: act ${p.act.length} симв. (>52)`);
    });
    if (!ph.length && !def.coach && !def.custom && !def.examRoute)
      rec.issues.push('нет ни phases, ни coach — живой подсказки не будет');

    /* фаза, которую не выигрывает ни одно состояние: карточку не увидит никто.
       Перебираем только те поля, которые цепочка реально читает, а узлы сетки берём
       из чисел самих условий — равномерная сетка проскакивает полосу в метр между
       двумя порогами. Фазы, смотрящие за пределы s (актёр рядом, фаза светофора),
       в переборе считаются ЛОЖНЫМИ: иначе они затеняют следующие и те выглядят мёртвыми,
       и сами такие фазы не проверяются — их состояние здесь не воспроизвести. */
    if (ph.length) {
      const RANGES = { gear: [-1, 0, 1], vel: [-5, -2, -0.05, 0, 0.05, 2, 5], steer: [-0.6, 0, 0.6],
        front: [0.05, 0.3, 1, 2, 3], rear: [0.05, 0.3, 1, 2, 3],
        left: [0.05, 0.3, 1, 2, 3], right: [0.05, 0.3, 1, 2, 3],
        blink: [null, 'L', 'R'], roll: [0, 0.5], hand: [false, true],
        /* окно в потоке: «нет окна», «на грани», «свободно». Без этой оси поле s.gap
           оставалось undefined, и любая фаза «уступи» считалась недостижимой */
        gap: [1, 4.9, 5.1, 99] };
      const b = level.bounds, used = new Set(), nums = new Set();
      for (const p of ph) if (p.when) {
        const src = String(p.when);
        for (const m of src.matchAll(/\bs\.(\w+)/g)) used.add(m[1]);
        for (const m of src.matchAll(/-?\d+(?:\.\d+)?/g)) nums.add(+m[0]);
      }
      const opaque = ph.map(p => p.when ? /\b(trafficGap|lightStops|level\.|game\.|car\.|demo)\b/.test(String(p.when)) : false);
      const consts = [...nums];
      const lin = (lo, hi, n) => Array.from({ length: n }, (_, k) => lo + (hi - lo) * (k + 0.5) / n);
      let nUV = 10, nTh = 16, axes = [], total = 0;
      const build = () => {
        axes = [];
        if (used.has('u')) axes.push(['u', [...lin(b.u0, b.u1, nUV), ...consts.flatMap(c => [c - 0.05, c + 0.05]).filter(x => x > b.u0 && x < b.u1)]]);
        if (used.has('v')) axes.push(['v', [...lin(b.v0, b.v1, nUV), ...consts.flatMap(c => [c - 0.05, c + 0.05]).filter(x => x > b.v0 && x < b.v1)]]);
        if (used.has('th')) axes.push(['th', [...lin(-Math.PI, Math.PI, nTh), ...consts.flatMap(c => [angNorm(rad(c - 1)), angNorm(rad(c + 1))])]]);
        for (const f in RANGES) if (used.has(f)) axes.push([f, RANGES[f]]);
        total = axes.reduce((a, x) => a * x[1].length, 1);
      };
      build();
      while (total > 4e6 && (nUV > 4 || nTh > 8)) { nUV = Math.max(4, nUV - 2); nTh = Math.max(8, nTh - 4); build(); }
      const wins = new Array(ph.length).fill(0);
      const st = { u: 0, v: 0, th: 0, gear: 0, vel: 0, steer: 0, front: 3, rear: 3, left: 3, right: 3, blink: null, roll: 0, hand: false, gap: 99 };
      const idx = new Array(axes.length).fill(0);
      const N = axes.length;
      for (let done = false; !done;) {
        for (let a = 0; a < N; a++) st[axes[a][0]] = axes[a][1][idx[a]];
        for (let k = 0; k < ph.length; k++) { if (opaque[k]) continue; if (!ph[k].when || ph[k].when(st)) { wins[k]++; break; } }
        let a = N - 1;
        while (a >= 0) { if (++idx[a] < axes[a][1].length) break; idx[a] = 0; a--; }
        if (a < 0 || N === 0) done = true;
      }
      wins.forEach((w, k) => { if (w === 0 && !opaque[k])
        rec.issues.push(`фаза ${k} недостижима (перебор ${total} состояний по полям ${[...used].join(',')}) — карточку «${(ph[k].act || ph[k].hint || '').slice(0, 45)}» игрок не увидит`); });
    }

    const r = DEMOS[i] ? replay(i) : null;
    if (r) {
      rec.demoTime = +r.time.toFixed(1);
      rec.demoReached = r.reached;
      const spans = [];
      let cur = null;
      for (const x of r.samples) {
        if (!cur || cur.idx !== x.idx) { cur = { idx: x.idx, t0: x.t, t1: x.t, pct: 0, g0: null }; spans.push(cur); }
        cur.t1 = x.t;
        const g = x.idx >= 0 && ph[x.idx] ? ph[x.idx].goal : null;
        if (g && g.metric && COACH_METRICS[g.metric]) {
          const v = x.met[g.metric];
          if (v !== null) { if (cur.g0 === null) cur.g0 = v; cur.pct = Math.max(cur.pct, pctOf(cur.g0, v, g)); }
        }
      }
      rec.cards = spans.map(sp => ({ idx: sp.idx, t0: sp.t0, dur: +(sp.t1 - sp.t0).toFixed(2), pct: sp.pct,
        act: sp.idx >= 0 ? (ph[sp.idx].act || ph[sp.idx].hint || '').slice(0, 60) : '(нет активной фазы)' }));

      const gapT = spans.filter(sp => sp.idx < 0).reduce((a, sp) => a + (sp.t1 - sp.t0), 0);
      if (gapT > 0.5 && !def.coach) rec.issues.push(`${gapT.toFixed(1)} с без активной фазы — карточка пустая`);
      for (const sp of spans) if (sp.idx >= 0 && (sp.t1 - sp.t0) < 0.35 && sp.t0 > 0.5)
        rec.issues.push(`фаза ${sp.idx} держится ${(sp.t1 - sp.t0).toFixed(2)} с — карточка мигает`);
      for (const sp of spans) {
        const g = sp.idx >= 0 && ph[sp.idx] ? ph[sp.idx].goal : null;
        if (g && g.metric && sp.pct < 100 && (sp.t1 - sp.t0) > 1.0)
          rec.issues.push(`фаза ${sp.idx}: шкала чипа «${g.metric}→${g.target}» дошла до ${sp.pct} % за ${(sp.t1 - sp.t0).toFixed(1)} с (${(ph[sp.idx].act || '').slice(0, 40)})`);
      }
      /* фаза, показанная дважды с чужой карточкой между ними: цепочка доигрывает назад */
      const seenAt = {};
      for (let k = 0; k < spans.length; k++) {
        const idx = spans[k].idx;
        if (idx < 0) continue;
        if (seenAt[idx] !== undefined && seenAt[idx] < k - 1 && spans[k].t0 > 1.0)
          rec.issues.push(`фаза ${idx} возвращается на ${spans[k].t0.toFixed(1)} с ("${(ph[idx].act || '').slice(0, 40)}")`);
        seenAt[idx] = k;
      }
      const never = ph.map((p, k) => k).filter(k => !spans.some(sp => sp.idx === k));
      rec.never = never;

      /* образцовый проезд не имеет права касаться препятствий: игрок ведёт машину по этой
         же зелёной линии и собирает те же касания */
      for (const h of r.hits)
        rec.issues.push(`показ задевает ${h.kind} (${h.u}, ${h.v}) на ${h.t0} с, сегмент ${h.seg}, ${h.frames} кадров`);

      /* маркер обязан стоять там, где реально едет показ */
      const dPath = (u, v) => { let d = 1e9; for (const q of r.pts) d = Math.min(d, Math.hypot(q.u - u, q.v - v)); return d; };
      for (const nm in level.marks) {
        const list = Array.isArray(level.marks[nm]) ? level.marks[nm] : [level.marks[nm]];
        for (const m of list) {
          let d = null;
          if (m.kind === 'ghost') d = dPath(m.u, m.v);
          else if (m.pts) { d = 1e9; for (const q of m.pts) d = Math.min(d, dPath(q.u, q.v)); }
          else if (m.u !== undefined) d = dPath(m.u, m.v);
          if (d === null) continue;
          if (m.kind === 'ghost' && d > 1.2)
            rec.issues.push(`призрак «${nm}» в ${d.toFixed(1)} м от траектории показа`);
          else if (m.kind !== 'ghost' && d > 8)
            rec.issues.push(`маркер «${nm}» в ${d.toFixed(1)} м от траектории показа`);
        }
      }
    }
    out.push(rec);
  }
  loadLevel(0);
  return out;
});

await browser.close();

if (JSON_OUT) { console.log(JSON.stringify({ pageErrors, report }, null, 1)); }
else {
  let bad = 0;
  for (const r of report) {
    if (!r.issues.length && !r.warns.length && !r.loadErr) continue;
    bad++;
    console.log(`\n#${r.n} ${r.name} · фаз ${r.nPhases}${r.demoTime !== undefined ? ` · показ ${r.demoTime} с` : ''}`);
    for (const w of r.warns) console.log('   warn: ' + w);
    if (r.loadErr) console.log('   ОШИБКА ЗАГРУЗКИ: ' + r.loadErr);
    for (const x of r.issues) console.log('   • ' + x);
  }
  console.log(`\nуровней с замечаниями: ${bad} из ${report.length}; исключений на странице: ${pageErrors.length}`);
  if (pageErrors.length) console.log(pageErrors.slice(0, 3).join('\n'));
}

const fatal = pageErrors.length
  || report.some(r => r.loadErr || r.issues.some(x => /updateHUD падает|без активной фазы|живой подсказки|недостижима|показ задевает/.test(x)));
process.exit(fatal ? 1 : 0);
