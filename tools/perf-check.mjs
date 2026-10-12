#!/usr/bin/env node
/* Гейт кадра на слабом ноутбуке (план laptop-frame-perf). Замер 12.10.2026: в городе проход зеркала стоил
   30–45 % рендера, в салоне с выключенными зеркалами буферы рисовались вхолостую, без видеокарты композитор
   тратил на размытие под панелями четверть кадра, а куб салона перечитывался из WebGL каждый кадр.
   Проверяется поведение, не скорость: скорость — tools/laptop-bench.mjs.
   - зеркала обновляются не чаще одного прохода за кадр, раз в QUALITY[q].mirDiv кадров и не чаще 24 Гц;
   - в салоне с выключенными зеркалами проходов зеркал нет;
   - стоящая машина во дворе не перерисовывает зеркала, тронулась — перерисовывает; в городе — всегда;
   - ни один элемент над канвой не размывает фон (backdrop-filter) — ни в игре, ни на паузе, ни на телефоне;
   - куб салона перерисовывается через WebGL только при повороте головы, иначе берётся из своего холста;
   - без видеокарты игра стартует с q4 и один раз подсказывает включить аппаратное ускорение;
   - событие perf уходит раз за сессию с рендерером WebGL, p50/p95 и временем симуляции;
   - на паузе сцена под оверлеем перерисовывается ≤ 5 раз в секунду, ввод — сразу.

     PW_DIR=/tmp/pw node tools/perf-check.mjs
     FAULT=mirrate|mirhidden|mirstatic|backdrop|cubecache|gpunote|perfev|pauserender PW_DIR=/tmp/pw node tools/perf-check.mjs   # каждая — красная

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
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) errors.push(String(e).split('\n')[0]); });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 30000 });
await page.evaluate((fault) => {
  for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) try { localStorage.setItem(k, '1'); } catch (e) {}
  localStorage.setItem('trainer_runs', '9');
  doAct('start'); hideOv();
  const P = window.__mp = { center: 0, left: 0, right: 0, frames: 0 };
  const RMI = renderMirrorInto; renderMirrorInto = function (b, rect, kind) { P[kind]++; return RMI.apply(this, arguments); };
  const R = render; render = function (dt) { P.frames++; return R.apply(this, arguments); };
  if (fault === 'mirrate') mirPick = () => MIR_KINDS[mirTurn++ % 3];
  if (fault === 'mirhidden') { const R2 = render; render = function (dt) { R2.apply(this, arguments);
    if (opt.camMode === CAM_FP && !opt.mirrors) { const r = mirrorRects(); for (const k of MIR_KINDS) renderMirror(r[k], k, true, false); } }; }
  if (fault === 'mirstatic') mirStill = () => false;
}, FAULT);

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };
/* проходы зеркал за ms реальных кадров */
const passes = (ms) => page.evaluate((ms) => new Promise((res) => {
  const P = window.__mp; P.center = P.left = P.right = P.frames = 0; const t0 = performance.now();
  setTimeout(() => { const s = (performance.now() - t0) / 1000;
    res({ s: +s.toFixed(2), frames: P.frames, center: P.center, left: P.left, right: P.right, total: P.center + P.left + P.right }); }, ms);
}), ms);
const CITY = await page.evaluate(() => LEVELS.findIndex((l) => l.traffic === 'city'));

/* 1. Частота зеркал */
{
  await page.evaluate((li) => { loadLevel(li); hideOv(); opt.camMode = CAM_CHASE; opt.mirrors = true; qApply(0); qCoolT = 1e9; }, CITY);
  await page.waitForTimeout(600);
  const q0 = await passes(2000);
  await page.evaluate(() => { qApply(4); qCoolT = 1e9; });
  await page.waitForTimeout(400);
  const q4 = await passes(2000);
  await page.evaluate(() => { qApply(0); });
  const hz = (r, k) => r[k] / r.s, perFrame = (r) => r.total / Math.max(1, r.frames);
  const ok0 = perFrame(q0) <= 1.0001 && ['center', 'left', 'right'].every((k) => hz(q0, k) >= 8 && hz(q0, k) <= 26);
  const ok4 = perFrame(q4) <= 1 / 3 + 0.02 && ['center', 'left', 'right'].every((k) => hz(q4, k) >= 2);
  check('зеркала: не больше прохода за кадр, на q0 8–26 Гц на зеркало, на q4 раз в 3 кадра (@render-perf-mirror-rate)', ok0 && ok4,
    JSON.stringify({ q0, q4, perFrame0: +perFrame(q0).toFixed(2), perFrame4: +perFrame(q4).toFixed(2) }));
}

/* 2. Салон с выключенными зеркалами — без проходов */
{
  await page.evaluate(() => { loadLevel(0); hideOv(); if (opt.camMode !== CAM_FP) pressKey('KeyV'); opt.mirrors = false; });
  await page.waitForTimeout(300);
  const r = await passes(1000);
  await page.evaluate(() => { opt.mirrors = true; opt.camMode = CAM_CHASE; });
  check('салон с выключенными зеркалами не рисует их буферы (@render-perf-mirror-hidden)', r.total === 0 && r.frames > 10, JSON.stringify(r));
}

/* 3. Стоящая сцена */
{
  await page.evaluate(() => { loadLevel(6); hideOv(); opt.camMode = CAM_CHASE; opt.mirrors = true; qApply(0); qCoolT = 1e9; });
  await page.waitForTimeout(700);
  const still = await passes(1000);
  await page.evaluate(() => { setBody(car.ru + 0.4, car.rv + 0.4, car.th); });
  const moved = await passes(400);
  await page.evaluate((li) => { loadLevel(li); hideOv(); }, CITY);
  await page.waitForTimeout(600);
  const city = await passes(1000);
  const ok = still.total === 0 && still.frames > 10 && moved.total >= 1 && city.total >= 20;
  check('стоящая машина во дворе не перерисовывает зеркала, сдвиг и город — перерисовывают (@render-perf-mirror-static)', ok,
    JSON.stringify({ still, moved, city }));
}

/* 5. Куб салона: голова неподвижна — GL не рисует, повернулась — рисует */
{
  const r = await page.evaluate((fault) => new Promise((res) => {
    if (!cubeGL.gl || cabinBake.state !== 'ready') { res({ skip: cabinBake.state }); return; }
    if (fault === 'cubecache') cubeKeySame = () => false;
    loadLevel(0); hideOv(); if (opt.camMode !== CAM_FP) pressKey('KeyV'); opt.fpYaw = 0; opt.fpPitch = rad(-2); opt.mirrors = true;
    const gl = cubeGL.gl, D = gl.drawArrays; let n = 0;
    gl.drawArrays = function () { n++; return D.apply(this, arguments); };
    setTimeout(() => { n = 0;
      setTimeout(() => { const still = n; n = 0; opt.fpYaw = rad(20);
        setTimeout(() => { const turned = n; gl.drawArrays = D; opt.fpYaw = 0; opt.camMode = CAM_CHASE; res({ still, turned }); }, 300); }, 1000); }, 400);
  }), FAULT);
  check('куб салона: неподвижная голова — без GL-проходов, поворот головы — перерисовка (@render-perf-cube-cache)',
    r.skip === undefined && r.still === 0 && r.turned >= 1, JSON.stringify(r));
}

/* 4. Над живой канвой ничего не размывает фон: ни HUD, ни оверлей паузы, ни тач-кнопки */
{
  const r = await page.evaluate((fault) => {
    if (fault === 'backdrop') { const st = document.createElement('style'); st.textContent = '.panel{backdrop-filter:blur(6px)}'; document.head.appendChild(st); }
    loadLevel(0); hideOv(); escAct();
    document.body.classList.add('touch');
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el), bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (bf && bf !== 'none') bad.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + el.className) + ' ' + bf);
    }
    document.body.classList.remove('touch'); doAct('resume'); hideOv();
    return { bad: bad.slice(0, 6), n: bad.length, paused };
  }, FAULT);
  check('над канвой нет backdrop-filter — ни в игре, ни на паузе, ни на тач-кнопках (@render-perf-no-backdrop)', r.n === 0, JSON.stringify(r));
}

/* 6. Программный рендер: старт с q4 и одна подсказка, когда игрок уже едет. Автоматизация его не включает
   сама (headless рисует через SwiftShader) — включает GPU_SOFT_FORCE; без него — q0 и без подсказки */
{
  const run = async (force) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    if (force) await ctx.addInitScript(() => { window.GPU_SOFT_FORCE = true; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) errors.push(String(e).split('\n')[0]); });
    await p.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
    await p.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 30000 });
    const boot = await p.evaluate(() => { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1');
      localStorage.removeItem('pz_gpu_note'); return { q: qLevel, soft: gpuSoft(), desc: SETTINGS.find((s) => s.id === 'gfx').desc() }; });
    await p.evaluate(() => { doAct('start'); hideOv(); loadLevel(0); hideOv(); });
    await p.waitForTimeout(4200);
    const after = await p.evaluate(() => ({ coach: (document.getElementById('coach') || {}).textContent || '', mark: localStorage.getItem('pz_gpu_note') }));
    await ctx.close();
    return { boot, note: /аппаратное ускорение/.test(after.coach), mark: after.mark };
  };
  const soft = await run(FAULT !== 'gpunote'), hard = await run(false);
  const ok = soft.boot.q === 4 && soft.note && soft.mark === '1' && /аппаратное ускорение/.test(soft.boot.desc)
    && hard.boot.q === 0 && !hard.note && !hard.mark;
  check('программный рендер: старт с q4, подсказка про аппаратное ускорение один раз; с видеокартой — нет (@app-perf-gpu-note)', ok, JSON.stringify({ soft, hard }));
}

/* 8. Пауза: сцена под оверлеем перерисовывается ≤ 5 раз в секунду, ввод перерисовывает её сразу */
{
  const r = await page.evaluate((fault) => new Promise((res) => {
    if (fault === 'pauserender') renderDue = () => true;
    loadLevel(0); hideOv(); opt.camMode = CAM_CHASE; escAct();
    const P = window.__mp;
    setTimeout(() => { P.frames = 0;
      setTimeout(() => { const idle = P.frames; P.frames = 0;
        window.dispatchEvent(new PointerEvent('pointerdown'));
        requestAnimationFrame(() => requestAnimationFrame(() => { const poked = P.frames; const was = paused; doAct('resume'); hideOv();
          res({ idle, poked, paused: was }); })); }, 1000); }, 300);
  }), FAULT);
  check('пауза: сцена под оверлеем ≤ 7 перерисовок в секунду, ввод перерисовывает сразу (@app-perf-pause)',
    r.paused && r.idle <= 7 && r.idle >= 3 && r.poked >= 1, JSON.stringify(r));
}

/* 7. Событие perf: одно за сессию после 20 с езды, с рендерером и временем симуляции — без них по аналитике
   не узнать, у кого программный рендер и кто упирается в физику, а не в картинку */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('pz_debug', 'an'); } catch (e) {} });
  const p = await ctx.newPage(), got = [];
  p.on('console', (m) => { const t = m.text(); if (t.startsWith('[an] perf')) got.push(m.args().length > 1 ? m.args()[1] : null); });
  await p.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
  await p.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 30000 });
  await p.evaluate((fault) => { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1');
    if (fault === 'perfev') { const t = track; track = function (n, pr) { if (n === 'perf' && pr) { delete pr.gpu; delete pr.sim; } return t(n, pr); }; }
    doAct('start'); hideOv(); loadLevel(0); hideOv(); }, FAULT);
  await p.waitForTimeout(26000);
  const props = got.length && got[0] ? await got[0].jsonValue() : null;
  await ctx.close();
  const need = ['q', 'qb', 'fps', 'p50', 'p95', 'js', 'sim', 'vw', 'vh', 'gpu', 'soft', 'li'];
  const miss = props ? need.filter((k) => !(k in props)) : need;
  check('событие perf одно за сессию после 20 с езды, с рендерером, p95 и временем симуляции (@an-perf-sample)',
    got.length === 1 && miss.length === 0, JSON.stringify({ n: got.length, miss, props }));
}

if (errors.length) check('страница без исключений', false, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
