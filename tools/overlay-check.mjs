#!/usr/bin/env node
/* Гейт языка наложений (план exam-clarity-voice-sound, Ф1). На асфальте белое и жёлтое — только настоящая
   разметка; всё, что рисует тренажёр, говорит лентой маршрута (фиолетовая, задним ходом розовая), голубыми
   полосами и столбиками ориентира и зелёной заливкой зоны — без пунктира и в метрах. Владелец 11.10.2026:
   «вообще не понимаю, как работают эти пунктирные линии на экзамене и других уровнях».

     PW_DIR=/tmp/pw node tools/overlay-check.mjs
     PW_DIR=/tmp/pw URL=https://pozerkalam.space/play/ node tools/overlay-check.mjs
     FAULT=palette|dash|pixels|realline|card|label PW_DIR=/tmp/pw node tools/overlay-check.mjs   # каждая проверка обязана покраснеть

   Код 1 — хоть одна проверка не прошла. */
import { createRequire } from 'node:module';
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
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'].concat(process.env.HOST_RULES ? ['--host-resolver-rules=' + process.env.HOST_RULES] : []) });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 20000 });
await page.evaluate(() => { try { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1');
  localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_gfx', 'max'); } catch (e) {} });

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };

/* общий стенд в странице: запись цветов и пунктира, которыми рисуют наложения, и порча для FAULT */
await page.evaluate((fault) => {
  window.__ov = { rec: [], on: 0, ribbons: 0 };
  const P = window.__ov;
  for (const name of ['strokeGroundPath', 'fillGroundPolys', 'fillGroundPoly']) {
    const f = window[name];
    window[name] = function (...a) {
      if (P.on) P.rec.push({ fn: name, col: a[1], stroke: name === 'fillGroundPoly' ? a[2] : null, dash: name === 'strokeGroundPath' ? a[3] : null });
      return f.apply(this, a);
    };
  }
  const rb = window.drawRibbon;
  window.drawRibbon = function (...a) { P.ribbons++; return rb.apply(this, a); };
  for (const name of ['drawGoal', 'drawIdealPath', 'drawExamNav', 'drawMarks']) {
    const f = window[name];
    window[name] = function (...a) { P.on++; try { return f.apply(this, a); } finally { P.on--; } };
  }
  if (fault === 'palette') OVL.mark = [250, 204, 21];
  if (fault === 'dash') { const z = window.drawExamZone;
    window.drawExamZone = function () { z(); if (exam && exam.zone) strokeGroundPath([{ u: exam.zone.u, v: exam.zone.v }, { u: exam.zone.u + 3, v: exam.zone.v }], 'rgba(255,207,77,.85)', 2, [9, 8], 0.042); }; }
  if (fault === 'pixels') window.drawRibbon = function (r, col) { P.ribbons++; if (!r) return;
    for (const q of r.quads) strokeGroundPath([q.p[0], q.p[1]], ovlRGBA(col, .9), 3, null, 0.038); };
  if (fault === 'realline') { const ef = window.examFlags; window.examFlags = function () { const f = ef(); f.line = true; return f; }; }
  if (fault === 'card') { const cc = window.coachCard;
    window.coachCard = function (k, i, m, g, ph) { if (ph && (ph.pre || ph.post)) m = (ph.pre || []).join(' ') + ' ' + m + ' · ' + (ph.post || []).join(' · '); return cc(k, i, m, g, null); }; }
  if (fault === 'label') { const dl = window.drawMarkLabels;
    window.drawMarkLabels = function (s) { dl(s); if (examActive()) drawPill({ u: bodyPos().u, v: bodyPos().v + 12, y: 1.5 }, 'налево на Садовую', PILL_DEF); }; }
}, FAULT);

/* цвет разметки: жёлтый или белый — тот же признак, что у ovlMarkCol в игре, но по строке цвета канваса */
const MARKING_JS = `(c)=>{ if(!c||typeof c!=='string') return false; let r,g,b;
  const m=/rgba?\\((\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/.exec(c);
  if(m){ r=+m[1]; g=+m[2]; b=+m[3]; } else if(/^#[0-9a-f]{6}$/i.test(c)){ r=parseInt(c.slice(1,3),16); g=parseInt(c.slice(3,5),16); b=parseInt(c.slice(5,7),16); } else return false;
  return (r>200&&g>140&&b<120) || (r>205&&g>205&&b>205); }`;

/* 1. Палитра и пунктир: ни одно наложение уроков и экзамена (цель, путь показа, маркеры, маршрут и зона
      экзамена) не рисуется цветом разметки и не рисуется пунктиром по асфальту */
{
  const r = await page.evaluate((MJ) => {
    const isMark = eval(MJ), P = window.__ov, bad = [];
    const scan = (tag) => { for (const x of P.rec) {
      if (isMark(x.col) || isMark(x.stroke)) bad.push(tag + ': цвет разметки ' + (isMark(x.col) ? x.col : x.stroke) + ' в ' + x.fn);
      if (x.dash) bad.push(tag + ': пунктир в ' + x.fn); } P.rec.length = 0; };
    opt.marks = true; opt.guides = true; opt.refs = 0; opt.camMode = CAM_CHASE;
    for (let li = 0; li < LEVELS.length; li++) {
      if (LEVELS[li].custom) continue;
      loadLevel(li); hideOv(); paused = true;
      render(0.016);
      P.on++; try {
        drawGoal(); drawIdealPath();
        const all = []; for (const k in (level.marks || {})) all.push(...[].concat(level.marks[k]));
        drawMarks(all, curS, false, false);
      } finally { P.on--; }
      scan(LEVELS[li].name.slice(0, 2));
      if (LEVELS[li].examRoute) for (const mode of ['train', 'real']) {
        opt.examMode = mode;
        for (let k = 0; k < exam.route.length; k++) { exam.stage = k; exam.zoneStage = -1; examLegBuild(); drawExamNav(); scan('экзамен ' + mode + ' этап ' + (k + 1)); }
        exam.stage = 0;
      }
    }
    opt.examMode = 'train';
    return bad;
  }, MARKING_JS);
  check('наложения не цвета разметки и не пунктир по асфальту — все уровни и все этапы экзамена (@render-overlay-palette)',
    r.length === 0, r.slice(0, 5).join('; '));
}

/* 2. Лента в метрах: ширина ленты маршрута на экране равна проекции 0,9 м на двух дистанциях — у машины
      и вдали. Пунктир в 3 px экрана у машины был тоньше, а вдали толще, чем полоса, на которой лежит */
{
  const r = await page.evaluate(() => {
    const li = LEVELS.findIndex((l) => l.examRoute);
    opt.examMode = 'train'; opt.marks = false; opt.guides = false; opt.refs = 0; opt.mirrors = false; opt.camMode = CAM_CHASE;
    loadLevel(li); hideOv(); paused = true;
    /* этап «прямо по Ленина»: лента идёт по прямой полосе перед машиной */
    exam.stage = 0; setBody(8.15, -100, 0); car.vel = 0; examLegBuild();
    render(0.016); render(0.016);
    const cv = document.querySelector('canvas'), g = cv.getContext('2d'), dpr = cv.width / cv.clientWidth;
    const scr = (p) => { const c = toCam({ x: -p.u, y: 0.038, z: p.v }); return c.d < NEAR ? null : toScreen(c); };
    const rb = exam.leg.draw.segs[0].rb, out = [];
    for (const want of [9, 24]) {
      const c = bodyPos(); let q = null;
      for (const x of rb.quads) { const d = Math.hypot(x.u - c.u, x.v - c.v); if (Math.abs(d - want) < 1) { q = x; break; } }
      if (!q) { out.push({ want, err: 'нет куска ленты' }); continue; }
      const L = scr({ u: (q.p[0].u + q.p[1].u) / 2, v: (q.p[0].v + q.p[1].v) / 2 }), R = scr({ u: (q.p[2].u + q.p[3].u) / 2, v: (q.p[2].v + q.p[3].v) / 2 });
      if (!L || !R) { out.push({ want, err: 'за камерой' }); continue; }
      const proj = Math.hypot(R.x - L.x, R.y - L.y);
      /* отсчёт поперёк ленты: фиолетовые пиксели (синий заметно больше зелёного, красный меньше синего) */
      let px = 0; const n = Math.ceil(proj * 2) + 20;
      for (let i = 0; i <= n; i++) { const t = -0.5 + 2 * i / n;
        const x = Math.round((L.x + (R.x - L.x) * t) * dpr), y = Math.round((L.y + (R.y - L.y) * t) * dpr);
        const d = g.getImageData(x, y, 1, 1).data; if (d[2] - d[1] > 30 && d[2] > d[0]) px++; }
      const seen = px * (2 * proj / n);
      out.push({ want, proj: +proj.toFixed(1), seen: +seen.toFixed(1) });
    }
    return out;
  });
  const ok = r.every((x) => !x.err && Math.abs(x.seen - x.proj) <= Math.max(3, x.proj * 0.25));
  check('лента маршрута шириной в метрах: на экране ширина = проекция 0,9 м у машины и вдали (@render-overlay-metres)',
    ok, r.map((x) => x.err ? x.want + ' м: ' + x.err : x.want + ' м: проекция ' + x.proj + ' px, видно ' + x.seen + ' px').join('; '));
}

/* 3. Настоящий экзамен и практика: ленты нет. Инспектор говорит, куда ехать, полосу и знаки читает кандидат */
{
  const r = await page.evaluate(() => {
    const P = window.__ov, bad = [];
    const li = LEVELS.findIndex((l) => l.examRoute);
    opt.examMode = 'real'; loadLevel(li); hideOv(); paused = true; render(0.016);
    for (let k = 0; k < exam.route.length; k++) { exam.stage = k; examLegBuild(); P.ribbons = 0; drawExamNav();
      const st = exam.route[k];
      if (P.ribbons && !(st.turn === 'U' && exam.zone && exam.zone.kind === 'uturn')) bad.push('настоящий, этап ' + (k + 1) + ': лента'); }
    opt.examMode = 'train';
    const pl = LEVELS.findIndex((l) => l.practice);
    window.PRACTICE_VARIANT = 0; openLevel(pl, 'practice', 'practice'); delete window.PRACTICE_VARIANT; hideOv(); paused = true; render(0.016);
    P.ribbons = 0; P.rec.length = 0; P.on++; try { drawExamNav(); } finally { P.on--; }
    if (P.ribbons || P.rec.length) bad.push('практика: на асфальте ' + (P.ribbons + P.rec.length) + ' наложений');
    P.rec.length = 0;
    return bad;
  });
  check('настоящий экзамен и практика — без ленты маршрута (@render-overlay-real-exam)', r.length === 0, r.slice(0, 4).join('; '));
}

/* 4. Карточка экзамена — одна фраза команды; передача, метры и баллы — отдельными чипами */
{
  const r = await page.evaluate(() => {
    const li = LEVELS.findIndex((l) => l.examRoute);
    opt.examMode = 'train'; loadLevel(li); hideOv(); paused = true;
    exam.stage = Math.max(0, exam.route.findIndex((s) => s.turn === 'L' || s.turn === 'R'));
    const st = exam.route[exam.stage];
    setBody(st.at.u + 8.15, st.at.v - 30, 0); car.sel = 'P'; car.gear = 0; examLegBuild();
    examWhyT = 0; selWarnT = 0; noteT = 0; game.hitMsgT = 0; coachKey = '';
    updateHUD(0.016);
    const el = document.getElementById('coach');
    return { main: (el.querySelector('.cm') || {}).textContent || '', tags: [...el.querySelectorAll('.ctag')].map((t) => t.textContent) };
  });
  const glued = /P ·|баллы| м\b|·/.test(r.main);
  const ok = !glued && r.tags.some((t) => /^P/.test(t)) && r.tags.some((t) => /^баллы/.test(t));
  check('карточка экзамена: команда одной фразой, передача и баллы — чипами (@render-overlay-card-chips)', ok,
    'команда «' + r.main + '», чипы ' + JSON.stringify(r.tags));
}

/* 5. Подписи команды в воздухе нет: она висела у светофора; команда — на карточке и в голосе */
{
  const r = await page.evaluate(() => {
    const li = LEVELS.findIndex((l) => l.examRoute);
    opt.examMode = 'train'; opt.refs = 0; loadLevel(li); hideOv(); paused = true;
    exam.stage = 0; setBody(8.15, -100, 0); examLegBuild(); render(0.016);
    return labelBoxes.length;
  });
  check('на экзамене нет подписи команды в воздухе (@render-overlay-no-label)', r === 0, r + ' подписей');
}

check('страница без исключений', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
