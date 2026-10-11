#!/usr/bin/env node
/* Гейт ограничений скорости (план speed-limits-ribbon, Ф4). Владелец: «добавить скоростное ограничение и разные
   знаки связанные с этим». Проверяется то, что видит и на чём проверяется игрок:
   - знаки стоят там, где начинается зона, справа по ходу, лицом к водителю и за поребриком;
   - ограничение в точке (limitAt) — по зоне своей улицы и своего направления, на перекрёстке снова 60,
     «40» на Ленина кончается за перекрёстком без отдельного знака, во дворе — 20;
   - превышение больше чем на 2 км/ч дольше секунды ловится один раз, 41 в «40» — не ловится; настоящий
     экзамен проваливается сразу (п. 2.13), тренировочный разбирает, урок города даёт предупреждение;
   - знак «40» из салона читается: красное кольцо и тёмное число на своих местах в кадре;
   - значок ограничения виден на уроке и в тренировочном экзамене и скрыт в настоящем и во дворе.

     PW_DIR=/tmp/pw node tools/speed-check.mjs
     FAULT=nosigns|flatlimit|nodetect|badgereal PW_DIR=/tmp/pw node tools/speed-check.mjs   # каждая — красная

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
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 30000 });
await page.evaluate((fault) => {
  for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) try { localStorage.setItem(k, '1'); } catch (e) {}
  opt.traffic = 'off'; doAct('start'); hideOv();
  if (fault === 'nosigns') { const f = window.citySpeed; window.citySpeed = function (spec, V, E, obs, city) { const n = obs.length; f(spec, V, E, obs, city); obs.length = n; }; }
  if (fault === 'flatlimit') window.limitAt = () => 60;
  if (fault === 'nodetect') { const f = window.vio; window.vio = function (code) { if (code === 'speed') return; return f.apply(this, arguments); }; }
  if (fault === 'badgereal') window.examFlags = function () { return { line: false, zone: true, hints: true, map: false, dist: false, sensors: false, forgiving: false }; };
}, FAULT);

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };
const CITY = await page.evaluate(() => LEVELS.findIndex((l) => l.traffic === 'city'));

/* 1. Знаки на местах */
{
  const r = await page.evaluate((li) => {
    openLevel(li, 'pick'); hideOv(); paused = true;
    const g = cityGraph(), S = level.obs.filter((o) => o.kind === 'sign' && /^(lim|end|kids|zone)/.test(o.pic)), Z = level.city.speed, K = level.obs.filter((o) => o.kind === 'kerb');
    const kerbGap = (p) => { let m = 1e9; for (const o of K) { const f = fuv(o.yaw), rr = ruv(o.yaw), du = p.u - o.u, dv = p.v - o.v;
      m = Math.min(m, Math.hypot(Math.max(0, Math.abs(du * rr.u + dv * rr.v) - o.w / 2), Math.max(0, Math.abs(du * f.u + dv * f.v) - o.l / 2))); } return m; };
    const bad = [];
    for (const z of Z) {
      const yT = z.dir > 0 ? z.e.yaw : z.e.yaw + Math.PI, from = g.V[z.dir > 0 ? z.e.a : z.e.b], d0 = z.dir > 0 ? z.lo : z.e.len - z.hi;
      /* жилая зона со стороны тупика начинается у края карты — знака там нет */
      if (!from.r && !from.round && d0 < 0.5) continue;
      const s0 = z.dir > 0 ? z.lo : z.hi, A = g.V[z.e.a], f = fuv(z.e.yaw), p = { u: A.u + f.u * s0, v: A.v + f.v * s0 }, ft = fuv(yT), rt = ruv(yT);
      const near = S.filter((o) => Math.abs((o.u - p.u) * ft.u + (o.v - p.v) * ft.v) < 1.2 && (o.u - p.u) * rt.u + (o.v - p.v) * rt.v > z.e.hw);
      if (!near.length) bad.push('нет знака у начала зоны ' + z.e.name + (z.dir > 0 ? '+' : '−') + ' ' + z.lim);
      for (const o of near) if (Math.abs(angNorm(o.yaw - (yT + Math.PI))) > 0.05) bad.push(o.pic + ' смотрит не на водителя, ' + z.e.name);
    }
    for (const o of S) { const gp = kerbGap(o); if (gp < 0.4) bad.push(o.pic + ' ближе 0,4 м к поребрику (' + gp.toFixed(2) + ')');
      const sn = citySnap(o); if (sn && sn.e && sn.d < sn.e.hw + 0.3) bad.push(o.pic + ' на проезжей части'); }
    const cnt = {}; for (const o of S) cnt[o.pic] = (cnt[o.pic] || 0) + 1;
    return { bad, cnt, zones: Z.length };
  }, CITY);
  const want = { lim40: 6, kids: 2, lim20: 2, end20: 2, zone: 2, zoneEnd: 2 };
  const cntOk = Object.keys(want).every((k) => r.cnt[k] === want[k]);
  check('знаки ограничений стоят у начала зон, справа по ходу, лицом к водителю, за поребриком (@city-speed-signs)',
    r.bad.length === 0 && cntOk && r.zones === 12, JSON.stringify(r.cnt) + ', зон ' + r.zones + (r.bad.length ? ' — ' + r.bad.slice(0, 4).join('; ') : ''));
}

/* 2. Ограничение в точке */
{
  const r = await page.evaluate((li) => {
    openLevel(li, 'pick'); hideOv(); paused = true;
    const N = 0, S = Math.PI, E = Math.PI / 2, W = -Math.PI / 2, got = {};
    const at = (k, u, v, th) => { got[k] = limitAt(u, v, th); };
    at('Ленина на север за знаком', 8.15, -90, N); at('Ленина на север до знака', 8.15, -100, N);
    at('Ленина на юг между N2 и N1', -8.15, -40, S); at('Ленина на север между N1 и N2', 8.15, -40, N);
    at('в перекрёстке N2', 3, 0, N); at('Ленина за N2 на север', 8.15, 30, N);
    at('Садовая на восток в школьной зоне', -40, -71.65, E); at('Садовая на восток после конца зоны', -10, -71.65, E);
    at('Садовая на запад в школьной зоне', -40, -68.35, W); at('Заводская', -40, -1.65, E);
    at('Парковая к тупику', 20, 68.35, E); at('Парковая от тупика', 21, 71.65, W);
    loadLevel(0);
    return { got, yard: limitAt(car.ru, car.rv, car.th) };
  }, CITY);
  const want = { 'Ленина на север за знаком': 40, 'Ленина на север до знака': 60, 'Ленина на юг между N2 и N1': 40, 'Ленина на север между N1 и N2': 40,
    'в перекрёстке N2': 60, 'Ленина за N2 на север': 40, 'Садовая на восток в школьной зоне': 20, 'Садовая на восток после конца зоны': 60,
    'Садовая на запад в школьной зоне': 20, 'Заводская': 60, 'Парковая к тупику': 20, 'Парковая от тупика': 20 };
  const bad = Object.keys(want).filter((k) => r.got[k] !== want[k]);
  check('ограничение в точке: зона своей улицы и направления, на перекрёстке 60, «40» до перекрёстка, во дворе 20 (@city-speed-limit-at)',
    bad.length === 0 && r.yard === 20, bad.length ? bad.map((k) => k + ': ' + r.got[k] + ' вместо ' + want[k]).join('; ') : 'двор ' + r.yard);
}

/* 3. Превышение: урок, тренировочный и настоящий экзамен */
{
  const r = await page.evaluate((li) => {
    const drive = (kmh, secs) => { const v = kmh / 3.6; for (let t = 0; t < secs; t += 1 / 60) { car.vel = v; violationsTick(1 / 60); } };
    openLevel(li, 'pick'); hideOv(); paused = true; setBody(8.15, -40, 0); car.vel = 0;
    vioEvents.length = 0; drive(41, 3); const n41 = vioEvents.filter((e) => e.code === 'speed').length;
    drive(47, 3); const n47 = vioEvents.filter((e) => e.code === 'speed').length;
    drive(47, 3); const again = vioEvents.filter((e) => e.code === 'speed').length;
    const lesson = { strikes: attempt.strikes, failed: attempt.failed };
    const ex = LEVELS.findIndex((l) => l.examRoute), run = (mode) => { opt.examMode = mode; loadLevel(ex); hideOv(); paused = true; setBody(8.15, -40, 0); car.vel = 0;
      examWhy = ''; drive(47, 2); return { failed: !!exam.failed, why: examWhy, log: exam.log.map((l) => l.code) }; };
    const real = run('real'), train = run('train');
    return { n41, n47, again, lesson, real, train };
  }, CITY);
  const ok = r.n41 === 0 && r.n47 === 1 && r.again === 1 && r.lesson.strikes === 1 && !r.lesson.failed
    && r.real.failed && r.real.log.includes('speed') && !r.train.failed && r.train.log.includes('speed') && /скорост/i.test(r.train.why);
  check('превышение: 41 в «40» не ловится, 47 — один раз; урок — предупреждение, настоящий экзамен проваливается, тренировочный разбирает (@city-speed-violation)',
    ok, JSON.stringify(r));
}

/* 4. Знак «40» из салона читается */
{
  const r = await page.evaluate((li) => {
    openLevel(li, 'pick'); hideOv(); paused = true; setHud(2);
    opt.mirrors = false; opt.camMode = CAM_FP; opt.marks = false; opt.refs = 0;
    const o = level.obs.find((x) => x.kind === 'sign' && x.pic === 'lim40' && Math.abs(x.v + 96) < 1);
    if (!o) return { err: 'нет знака «40» на старте экзамена' };
    setBody(8.15, -104, 0); car.vel = 0;
    for (let k = 0; k < 3; k++) render(0.016);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), kx = canvas.width / W;
    const F = fwd(o.yaw), R = rgt(o.yaw), y = SIGN_H - 0.42;
    const px = (lat, dy) => { const s = viewProject({ x: -o.u + R.x * lat + F.x * 0.06, y: y + dy, z: o.v + R.z * lat + F.z * 0.06 }); if (!s) return null;
      const X = Math.round(s.x * kx), Y = Math.round(s.y * kx); if (X < 0 || Y < 0 || X >= canvas.width || Y >= canvas.height) return null;
      const q = (Y * canvas.width + X) * 4; return [img.data[q], img.data[q + 1], img.data[q + 2]]; };
    let red = 0, n = 0, dark = 0, m = 0;
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, p = px(Math.cos(a) * 0.31, Math.sin(a) * 0.31); if (!p) continue; n++; if (p[0] > 120 && p[0] > p[1] * 1.6 && p[0] > p[2] * 1.6) red++; }
    for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) { const p = px(i * 0.03, j * 0.025); if (!p) continue; m++; if (p[0] + p[1] + p[2] < 240) dark++; }
    return { red, n, dark, m };
  }, CITY);
  check('знак «40» из салона: красное кольцо и тёмное число на своих местах в кадре (@render-sign-speed)',
    !r.err && r.n >= 12 && r.red >= r.n * 0.6 && r.dark >= 4, r.err || JSON.stringify(r));
}

/* 5. Значок ограничения */
{
  const r = await page.evaluate(async (li) => {
    const show = async () => { paused = false; await new Promise((res) => setTimeout(res, 300)); const b = document.getElementById('limBadge'); return { hidden: b.hidden, txt: b.textContent }; };
    openLevel(li, 'pick'); hideOv(); setBody(8.15, -40, 0); car.vel = 0; const lesson = await show();
    const ex = LEVELS.findIndex((l) => l.examRoute);
    opt.examMode = 'train'; loadLevel(ex); hideOv(); setBody(8.15, -40, 0); car.vel = 0; const train = await show();
    opt.examMode = 'real'; loadLevel(ex); hideOv(); setBody(8.15, -40, 0); car.vel = 0; const real = await show();
    loadLevel(0); hideOv(); const yard = await show();
    paused = true;
    return { lesson, train, real, yard };
  }, CITY);
  const ok = !r.lesson.hidden && r.lesson.txt === '40' && !r.train.hidden && r.train.txt === '40' && r.real.hidden && r.yard.hidden;
  check('значок ограничения: виден на уроке и в тренировочном экзамене, скрыт в настоящем и во дворе (@city-speed-badge)', ok, JSON.stringify(r));
}

if (errors.length) check('страница без исключений', false, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
