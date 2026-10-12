#!/usr/bin/env node
/* Замер «обычного ноутбука»: окно 1536×864 @1.25 (экран 1920×1080 с масштабом 125 %), процессор медленнее в
   CPU раз (CDP), GPU=0 — без видеокарты: программные Canvas и композитинг, как у Chrome с заблокированным
   драйвером или выключенным аппаратным ускорением. На сцену — fps, p50/p95 интервала rAF, уровень
   качества после регулятора, JS кадра по частям (simTick / render / updateHUD) и занятость потоков по
   трассе CDP в мс на кадр: главный (JS и отрисовка канвы), композитор (Viz) и процесс GPU.
   Замедление процессора через CDP не трогает процесс GPU и композитор: их время на M4 для ноутбука
   умножать на ≈3 (так найдено 12.10.2026: без GPU композитор ≈13 мс на кадр при любом уровне качества).
     PW_DIR=/tmp/pw node tools/laptop-bench.mjs                  # сцены по умолчанию, GPU, процессор ×3
     PW_DIR=/tmp/pw CPU=6 node tools/laptop-bench.mjs            # бюджетный ноутбук или режим экономии батареи
     PW_DIR=/tmp/pw GPU=0 node tools/laptop-bench.mjs            # без видеокарты
     PW_DIR=/tmp/pw OLD=HEAD node tools/laptop-bench.mjs         # каждая сцена: сначала коммит, потом рабочая копия
     SCENES=menu,L30c,L7f — menu — витрина главного меню, L<номер><c|f> — уровень, камера за машиной или салон
     SETTLE=8000 — мс на выход регулятора; FORCE_Q=4 — зафиксировать уровень; TRACE=0 — без трассы потоков
     W=1366 H=768 DPR=1 — другой экран; BIN — другой Chromium
   Браузеры владельца не запускать — только Chrome с временным профилем. Вывод — строка JSON на сцену и сборку. */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const BIN = process.env.BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GPU = process.env.GPU !== '0';
const CPU = +(process.env.CPU || 3);
const W = +(process.env.W || 1536), H = +(process.env.H || 864), DPR = +(process.env.DPR || 1.25);
const SETTLE = +(process.env.SETTLE || 8000);
const FORCE_Q = process.env.FORCE_Q === undefined ? null : +process.env.FORCE_Q;
const TRACE = process.env.TRACE !== '0';
const OLD = process.env.OLD || '';
const SCENES = (process.env.SCENES || 'menu,L7c,L7f,L30c,L32c').split(',').filter(Boolean);
const MEASURE_MS = 4000, TRACE_MS = 2500;

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch (e) { console.error(`playwright-core не найден в ${PW_DIR}: mkdir -p ${PW_DIR} && (cd ${PW_DIR} && npm i playwright-core@1.55)`); process.exit(2); }
if (!fs.existsSync(BIN)) { console.error('браузер не найден: ' + BIN); process.exit(2); }

function sceneOf(s) {
  if (s === 'menu') return { lv: 0, fp: false, menu: true };
  const m = /^L(\d+)([cf])$/.exec(s);
  if (!m) { console.error('сцена не разобрана: ' + s); process.exit(2); }
  return { lv: +m[1], fp: m[2] === 'f', menu: false };
}

async function open(browser, file, sc) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) console.error('PAGEERR', e.message); });
  const cdp = await ctx.newCDPSession(page);
  const url = 'file://' + file + '?nocache=' + Date.now();
  await page.goto(url);
  await page.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
    localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0'); });
  await page.goto(url + 'r');
  await page.waitForTimeout(500);
  await page.evaluate(([sc, fq]) => {
    const T = window.__lb = { sim: 0, rend: 0, hud: 0, n: 0 };
    const S = simTick, R = render, U = updateHUD;
    simTick = function (dt) { const t = performance.now(); try { return S(dt); } finally { T.sim += performance.now() - t; } };
    render = function (dt) { const t = performance.now(); try { return R(dt); } finally { T.rend += performance.now() - t; T.n++; } };
    updateHUD = function () { const t = performance.now(); try { return U(); } finally { T.hud += performance.now() - t; } };
    if (!sc.menu) {
      doAct('start'); if (sc.lv > 1) { loadLevel(sc.lv - 1); hideOv(); }
      if (sc.fp) { pressKey('KeyV'); opt.fpYaw = 0; opt.fpPitch = rad(-2); } else opt.camMode = CAM_CHASE;
    }
    if (fq !== null) { qApply(fq); qCoolT = 1e9; }
  }, [sc, FORCE_Q]);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  return { ctx, page, cdp };
}

async function frames(page) {
  return page.evaluate((ms) => new Promise(res => {
    const T = window.__lb; T.sim = T.rend = T.hud = T.n = 0;
    const d = []; let last = performance.now(); const t0 = last;
    (function f() { const t = performance.now(); d.push(t - last); last = t;
      if (t - t0 < ms) { requestAnimationFrame(f); return; }
      d.shift(); const s = d.slice().sort((a, b) => a - b), n = T.n || 1, r1 = x => +x.toFixed(1), r2 = x => +x.toFixed(2);
      res({ fps: r1(d.length / ((last - t0) / 1000)), p50: r1(s[Math.floor(s.length * 0.5)]), p95: r1(s[Math.floor(s.length * 0.95)]),
        max: r1(s[s.length - 1]), q: qLevel, dpr: r2(DPR), px: canvas.width + 'x' + canvas.height,
        sim: r2(T.sim / n), render: r2(T.rend / n), hud: r2(T.hud / n) }); })();
  }), MEASURE_MS);
}

/* занятость потока — сумма ThreadControllerImpl::RunTask: вложенные RunTask того же потока считались бы дважды */
async function threads(page, cdp) {
  const events = [], onData = e => events.push(...e.value);
  cdp.on('Tracing.dataCollected', onData);
  const done = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['toplevel', 'devtools.timeline', 'viz', 'cc', 'gpu', 'blink'] } });
  const n = await page.evaluate((ms) => new Promise(res => { let k = 0; const t0 = performance.now(); (function f() { k++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(k); })(); }), TRACE_MS);
  await cdp.send('Tracing.end'); await done; cdp.off('Tracing.dataCollected', onData);
  const name = new Map(), busy = {};
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') name.set(e.pid + ':' + e.tid, e.args.name);
  for (const e of events) if (e.ph === 'X' && e.dur && e.name === 'ThreadControllerImpl::RunTask') {
    const t = name.get(e.pid + ':' + e.tid); if (t) busy[t] = (busy[t] || 0) + e.dur; }
  const per = x => +((x || 0) / 1000 / Math.max(1, n)).toFixed(2);
  return { main: per(busy.CrRendererMain), viz: per(busy.VizCompositorThread), gpuproc: per(busy.CrGpuMain) };
}

const browser = await chromium.launch({ executablePath: BIN, headless: false, args: GPU ? [] : ['--disable-gpu', '--disable-gpu-compositing'] });
const builds = [];
if (OLD) {
  const tmp = path.join(os.tmpdir(), `pozerkalam-${OLD.replace(/[^\w.-]/g, '_')}.html`);
  /* maxBuffer: со встроенными картинками index.html больше 2 МБ — предела execSync по умолчанию */
  fs.writeFileSync(tmp, execSync(`git -C "${ROOT}" show ${OLD}:index.html`, { maxBuffer: 64 * 1024 * 1024 }));
  builds.push([OLD, tmp]);
}
builds.push(['work', path.join(ROOT, 'index.html')]);
for (const s of SCENES) {
  const sc = sceneOf(s);
  for (const [build, file] of builds) {
    const { ctx, page, cdp } = await open(browser, file, sc);
    await page.waitForTimeout(SETTLE);
    const r = await frames(page);
    await page.evaluate(() => { qCoolT = 1e9; });
    const t = TRACE ? await threads(page, cdp) : {};
    console.log(JSON.stringify(Object.assign({ build, scene: s, gpu: GPU, cpu: CPU }, r, t)));
    await ctx.close();
  }
}
await browser.close();
