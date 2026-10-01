#!/usr/bin/env node
/* Гейт салона из пререндера (коды требований render-cabin-… и dist-asset…; сценарии —
   specs/features/render/cabin.feature и specs/features/dist/assets.feature):
   куб салона распакован и рисуется, его проём лобового совпадает с WSHIELD и в нём выше линии
   капота нет ничего, рендер сделан на текущих константах, при битой картинке рисуется прежний
   салон, страница в бюджете, блок картинок вне <script>.
   Проём меряется по самим граням куба, а не по кадрам: глаз в кузове неподвижен, и куб от
   поворота головы не зависит — пять поз головы проверяли бы одну и ту же картинку.
     PW_DIR=/tmp/pw node tools/cabin-check.mjs
     FAULT=shift|eye|budget|normal|script — сломать нарочно и увидеть красный: сдвинуть грани на 4 px,
       поменять EYE после рендера, уронить бюджет до 0,5 МБ, проверить отказ на целой странице,
       завернуть блок картинок в <script>
   Вывод: строка на проверку (ok/ПРОВАЛ) и итоговый JSON; код 1, если хоть одна провалена. */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || '';
const BUILD = path.join(ROOT, 'build');

let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) for (const sub of fs.readdirSync(path.join(cache, d))) {
    const bin = path.join(cache, d, sub, 'chrome-headless-shell');
    if (fs.existsSync(bin)) return bin;
  }
  console.error('Chromium не найден: задай PW_CHROME'); process.exit(2);
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? '  ok   ' : 'ПРОВАЛ ') + name + (detail ? ' — ' + detail : '')); };

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
fs.mkdirSync(BUILD, { recursive: true });
/* битая сборка для проверки отказа: у передней грани обрезан base64, распаковка картинки падает */
const brokenPath = path.join(BUILD, 'cabin-fallback.html');
fs.writeFileSync(brokenPath, html.replace(/(data-asset="cabin-pz" alt="" src="data:image\/webp;base64,)[A-Za-z0-9+/=]+/, '$1AAAA'));

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });

async function openPage(file) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const url = 'file://' + file + '?nocache=' + Date.now();
  /* первая вкладка только кладёт ключи онбординга; считаем предупреждения второй — своей загрузки */
  const prep = await context.newPage();
  await prep.goto(url);
  await prep.evaluate(() => { for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1'); localStorage.setItem('trainer_runs', '9'); });
  await prep.close();
  const page = await context.newPage();
  const errors = [], warns = [];
  page.on('pageerror', (e) => { if (!/ServiceWorker/.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().startsWith('[assets]')) warns.push(m.text()); });
  await page.goto(url + 'r');
  await page.waitForFunction(() => typeof cabinBake !== 'undefined' && cabinBake.state !== 'loading', null, { timeout: 15000 });
  await page.evaluate(() => { loadLevel(0); doAct('start'); if (opt.camMode !== CAM_FP) pressKey('KeyV'); opt.fpYaw = 0; opt.fpPitch = 0; });
  await page.waitForTimeout(300);
  /* сколько раз за один кадр нарисован прежний салон и сколько раз — канвас куба */
  /* прежний салон считается только в основном виде: салонное зеркало смотрит из своей точки и
     рисует салон гранями по праву, а зеркала обновляются по кругу — в одном кадре есть, в другом нет */
  const frame = await page.evaluate(() => {
    let interior = 0, cube = 0, main = false;
    const origI = emitInterior, origS = drawSceneInto, origD = CanvasRenderingContext2D.prototype.drawImage;
    window.drawSceneInto = (o) => { main = !!o.cube; try { return origS(o); } finally { main = false; } };
    window.emitInterior = (...a) => { if (main) interior++; return origI(...a); };
    CanvasRenderingContext2D.prototype.drawImage = function (src, ...a) { if (cubeGL.canvas && src === cubeGL.canvas) cube++; return origD.call(this, src, ...a); };
    try { render(0); } finally { window.emitInterior = origI; window.drawSceneInto = origS; CanvasRenderingContext2D.prototype.drawImage = origD; }
    return { state: cabinBake.state, interior, cube };
  });
  return { page, context, errors, warns, frame };
}

/* ---- целая сборка ---- */
const okPage = await openPage(FAULT === 'normal' ? brokenPath : path.join(ROOT, 'index.html'));
check('куб салона распакован и рисуется вместо прежнего салона, предупреждений [assets] нет (@render-cabin-cube)',
  okPage.frame.state === 'ready' && okPage.frame.cube === 1 && okPage.frame.interior === 0 && !okPage.warns.length && !okPage.errors.length,
  JSON.stringify({ ...okPage.frame, warns: okPage.warns.length, errors: okPage.errors }));

if (okPage.frame.state === 'ready') {
  const geo = await okPage.page.evaluate((fault) => {
    const faces = cabinBake.faces;
    const hoodDeg = Math.atan2(HOOD_Y - EYE.y, HOOD_Z - EYE.z) * 180 / Math.PI;
    const px = {};
    const sh = fault === 'shift' ? 4 : 0;
    for (const f of faces) {
      const c = document.createElement('canvas'); c.width = c.height = f.size;
      const g = c.getContext('2d'); g.drawImage(f.img, sh, sh, f.size, f.size);
      px[f.key] = g.getImageData(0, 0, f.size, f.size).data;
    }
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const proj = (q) => {
      const d = [q[0] - EYE.lat, q[1] - EYE.y, q[2] - EYE.z];
      let best = null, bd = -1e9;
      for (const f of faces) { const t = dot(d, f.look); if (t > bd) { bd = t; best = f; } }
      return { f: best, x: (dot(d, best.right) / bd + 1) / 2 * best.size, y: (1 - dot(d, best.up) / bd) / 2 * best.size };
    };
    const alpha = (f, x, y) => {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= f.size || yi >= f.size) return null;
      return px[f.key][(yi * f.size + xi) * 4 + 3];
    };
    const rgba = (f, x, y) => { const i = (Math.round(y) * f.size + Math.round(x)) * 4, d = px[f.key]; return `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`; };
    const W = WSHIELD, cen = [0, 1, 2].map((k) => (W[0][k] + W[1][k] + W[2][k] + W[3][k]) / 4);
    const elev = (q) => Math.atan2(q[1] - EYE.y, q[2] - EYE.z) * 180 / Math.PI;
    const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const edges = {};
    /* у нижней кромки проём внутри может закрывать козырёк щитка — там капот, не дорога */
    for (const [name, a, b, checkIn] of [['верх', 0, 1, true], ['право', 1, 2, true], ['низ', 2, 3, false], ['лево', 3, 0, true]]) {
      let n = 0, badOut = 0, badIn = 0; const where = [];
      for (let i = 1; i < 40; i++) {
        const q = lerp(W[a], W[b], i / 40), p = proj(q), pin = proj(lerp(q, cen, 0.02)), p2 = proj(lerp(W[a], W[b], i / 40 + 0.01));
        if (pin.f !== p.f || p2.f !== p.f) continue;
        /* «внутрь» — перпендикуляр к кромке на картинке, развёрнутый к центру проёма: сдвиг к центру
           стекла в 3D у верхних углов идёт почти вдоль кромки, и точка «на 3 px внутрь» ложилась
           на саму кромку */
        let ex = p2.x - p.x, ey = p2.y - p.y; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
        let nx = -ey, ny = ex;
        if ((pin.x - p.x) * nx + (pin.y - p.y) * ny < 0) { nx = -nx; ny = -ny; }
        const aIn = alpha(p.f, p.x + nx * 3, p.y + ny * 3), aOut = alpha(p.f, p.x - nx * 3, p.y - ny * 3);
        if (aIn === null || aOut === null) continue;
        n++;
        const az = Math.atan2(q[0] - EYE.lat, q[2] - EYE.z) * 180 / Math.PI;
        const at = `${p.f.key} аз ${az.toFixed(1)}° выс ${elev(q).toFixed(1)}°`;
        if (aOut < 230) { badOut++; where.push('снаружи ' + at + ' rgba ' + rgba(p.f, p.x - nx * 3, p.y - ny * 3)); }
        if (checkIn && elev(q) > hoodDeg + 0.5 && aIn > 25) { badIn++; where.push('внутри ' + at + ' rgba ' + rgba(p.f, p.x + nx * 3, p.y + ny * 3) + ` px ${Math.round(p.x)},${Math.round(p.y)}`); }
      }
      edges[name] = { n, badOut, badIn, ...(where.length ? { where: where.slice(0, 4) } : {}) };
    }
    let inside = 0, insideBad = 0;
    for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) {
      const q = lerp(lerp(W[0], W[1], i / 20), lerp(W[3], W[2], i / 20), j / 20);
      if (elev(q) <= hoodDeg + 0.5) continue;
      const p = proj(q), a = alpha(p.f, p.x, p.y);
      if (a === null) continue;
      inside++; if (a > 25) insideBad++;
    }
    const pxPerDeg = faces.find((f) => f.key === 'pz').size / 90;
    return { edges, inside, insideBad, hoodDeg: +hoodDeg.toFixed(2), tolPx: 3, tolDeg: +(3 / pxPerDeg).toFixed(3) };
  }, FAULT);
  const e = Object.values(geo.edges);
  check('проём лобового в кубе совпадает с WSHIELD: за кромкой кайма, внутри стекло; выше линии капота в проёме пусто (@render-cabin-bake-align)',
    e.every((x) => x.n >= 20 && !x.badOut && !x.badIn) && geo.inside >= 100 && !geo.insideBad, JSON.stringify(geo));
}
await okPage.context.close();

/* ---- свежесть рендера ---- */
let constsEnv = { ...process.env };
if (FAULT === 'eye') {
  const p = path.join(BUILD, 'cabin-fault-eye.html');
  fs.writeFileSync(p, html.replace('const EYE = { lat:-0.36, y:1.22, z:-0.20 };', 'const EYE = { lat:-0.36, y:1.24, z:-0.20 };'));
  constsEnv = { ...constsEnv, CONSTS_SRC: p };
}
const fresh = spawnSync('node', [path.join(ROOT, 'tools/blender/consts.mjs'), '--check'], { env: constsEnv, encoding: 'utf8' });
check('куб отрендерен на текущих константах index.html: отпечаток EYE/WSHIELD/WHEEL/… совпадает с вписанным в блок (@render-cabin-bake-fresh)',
  fresh.status === 0, (fresh.stderr || fresh.stdout).trim().split('\n').pop());

/* ---- отказ ---- */
const bad = await openPage(FAULT === 'normal' ? path.join(ROOT, 'index.html') : brokenPath);
check('битая грань куба: рисуется прежний салон, предупреждение [assets] одно, исключений нет (@render-cabin-fallback)',
  bad.frame.state === 'failed' && bad.frame.interior === 1 && bad.frame.cube === 0 && bad.warns.length === 1 && !bad.errors.length,
  JSON.stringify({ ...bad.frame, warns: bad.warns, errors: bad.errors }));
await bad.context.close();
await browser.close();

/* ---- сборка ---- */
const budgetEnv = FAULT === 'budget' ? { ...process.env, EMBED_BUDGET_MB: '0.5' } : process.env;
const budget = spawnSync('node', [path.join(ROOT, 'tools/assets/embed.mjs'), '--check'], { env: budgetEnv, encoding: 'utf8' });
check('index.html в бюджете 2,2 МБ, блок картинок цел, все грани — WebP (@dist-asset-budget)',
  budget.status === 0, (budget.stdout + budget.stderr).trim().split('\n').filter(Boolean).slice(-2).join(' · '));

/* блок картинок не внутри <script>: иначе base64 уехал бы в зеркало codegraph и под мутатор */
const htmlS = FAULT === 'script'
  ? html.replace('<div id="assets"', '<script type="text/plain"><div id="assets"').replace('</div>\n<!-- assets:end -->', '</div></script>\n<!-- assets:end -->')
  : html;
const scripts = [...htmlS.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const mirror = fs.readFileSync(path.join(ROOT, 'codegraph-src/index.js'), 'utf8');
check('картинки встроены вне <script>: в скриптах страницы и в зеркале codegraph-src нет base64 граней (@dist-assets-outside-script)',
  !scripts.some((s) => s.includes('data:image/webp;base64,')) && !mirror.includes('data:image/webp;base64,'),
  `скриптов ${scripts.length}, зеркало ${(mirror.length / 1024).toFixed(0)} КБ`);

fs.rmSync(brokenPath, { force: true });
fs.rmSync(path.join(BUILD, 'cabin-fault-eye.html'), { force: true });
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, names: failed.map((r) => r.name), fault: FAULT || null }));
process.exit(failed.length ? 1 : 0);
