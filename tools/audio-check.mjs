#!/usr/bin/env node
/* Гейт звука (план exam-clarity-voice-sound, Ф4; записи — план sound-samples, Ф3). Звук — записи CC0 из
   audio/ поверх графа WebAudio, синтез — запасной путь, поэтому проверяется граф и то, что из него выходит:
   записи качаются только после включения звука и встают в граф, при отказе загрузки звучит синтез с одним
   предупреждением, петли сшиты без скачка; всё звучит через мастер (иначе фон и реклама не глушат), мастер
   гаснет без звука, на паузе, в фоне и на рекламе; высота мотора следует оборотам автомата; реле щёлкает в
   такт лампе; машины потока слышны с той стороны, где их видно. Плюс офлайн-запись через
   OfflineAudioContext из тех же записей: без NaN и клиппинга, мотор под нагрузкой громче холостых, проезд
   слева направо — слева направо. Записи WAV ложатся в build/audio/ — для прослушки владельцем.

   fetch из file:// соседние файлы не читает, поэтому гейт сам раздаёт корень репозитория по http.

     PW_DIR=/tmp/pw node tools/audio-check.mjs
     FAULT=nomaster|nomute|flatrpm|relay|pan|clip|nosample|nofallback|seam PW_DIR=/tmp/pw node tools/audio-check.mjs

   Код 1 — хоть одна проверка не прошла. */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT || path.resolve(HERE, '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const FAULT = process.env.FAULT || null;
const OUT = path.join(ROOT, 'build', 'audio');
let chromium;
try { ({ chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core')); }
catch { console.error(`playwright-core не найден в ${PW_DIR}`); process.exit(2); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mp3': 'audio/mpeg', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
let server = null, url = process.env.URL;
if (!url) {
  server = http.createServer((req, res) => {
    const p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/index.html`;
}
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'].concat(process.env.HOST_RULES ? ['--host-resolver-rules=' + process.env.HOST_RULES] : []) });

/* рёбра графа записываются до загрузки страницы: по ним видно, проходит ли каждый источник через мастер */
function recordEdges(o) {
  window.__edges = [];
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dst) { window.__edges.push([this, dst]); return orig.apply(this, arguments); };
  if (o.noctx) { window.AudioContext = undefined; window.webkitAudioContext = undefined; }
}

async function openPage(o) {
  o = o || {};
  /* SW игры перехватил бы запросы записей мимо page.route — подмена ответа на 404 до них не доходила */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await ctx.addInitScript(recordEdges, o);
  const page = await ctx.newPage();
  const errors = [], warns = [], reqs = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'warning' && /\[audio\]/.test(m.text())) warns.push(m.text()); });
  page.on('request', (r) => { if (/\/audio\/[^/]+\.mp3/.test(r.url())) reqs.push(r.url()); });
  if (o.block) await page.route(/\/audio\/[^/]+\.mp3/, (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
  await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 20000 });
  await page.evaluate(() => { try { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1'); } catch (e) {} });
  await page.evaluate((fault) => {
    /* мастера всех графов: после прихода записей граф синтеза гаснет через свой мастер, и его источники
       выходят к динамикам законно — в обход считается только то, что минует любой мастер */
    window.__masters = [];
    const fb = window.audioBuild; window.audioBuild = (c, B) => { const S = fb(c, B); window.__masters.push(S.master); return S; };
    if (fault === 'nomaster') { const f = window.audioBuild; window.audioBuild = (c, B) => { const S = f(c, B); S.eGain.disconnect(); S.eGain.connect(c.destination); return S; }; }
    if (fault === 'nomute') { window.audioHide = () => {}; const f = window.audioTick; window.audioTick = function (dt) { const p = paused; paused = false; f(dt); paused = p; }; }
    if (fault === 'flatrpm') window.rpmStep = () => ENG.idle;
    if (fault === 'relay') window.sndRelay = () => {};
    if (fault === 'pan') window.sndPan = () => 0;
    if (fault === 'clip') { const f = window.audioUpdate; window.audioUpdate = (S, st, t) => { f(S, st, t); S.comp.threshold.value = 0; S.comp.ratio.value = 1; S.master.gain.cancelScheduledValues(0); S.master.gain.value = 6; }; }
    if (fault === 'nosample') window.sfxLoad = () => {};
    if (fault === 'nofallback') window.sfxLoad = () => { SFX.st = 1; fetch(SFX_MAN.files.loops).then((r) => { if (!r.ok) throw new Error(); }).catch(() => { SND = null; }); };
    if (fault === 'seam') for (const L of Object.values(SFX_MAN.loops)) L.b += 0.0137;
  }, FAULT);
  return { page, ctx, errors, warns, reqs };
}

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };
const exitPage = async (P) => { if (P.errors.length) check('страница без исключений', false, P.errors.slice(0, 3).join(' | ')); await P.ctx.close(); };
/* li < 0 — первый городской уровень с потоком. Записи грузятся после включения звука: ждём их, а если
   не пришли (FAULT=nosample) — проверки идут на синтезе, а красит это проверка записей */
const play = async (page, li) => {
  await page.evaluate((li) => {
    if (li < 0) li = LEVELS.findIndex((l) => l.traffic === 'city');
    opt.sound = true; initAudio(); openLevel(li, 'pick'); hideOv(); paused = false;
  }, li);
  await page.waitForFunction(() => SND && SND.B, null, { timeout: 8000 }).catch(() => {});
};

/* 1. Каждый источник звука доходит до выхода только через мастер: иначе пауза, фон и реклама его не глушат */
{
  const P = await openPage({});
  await play(P.page, 0);
  await P.page.waitForTimeout(400);
  const r = await P.page.evaluate(() => {
    tone(880, 0.05, 0.05, 'sine'); thud(1); sndEvent('sel'); honk(5, null);
    const E = window.__edges, dest = AC.destination, adj = new Map();
    for (const [a, b] of E) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
    const masters = new Set(window.__masters);
    const reach = (src, skip) => { const seen = new Set([src]), st = [src];
      while (st.length) { const x = st.pop(); if (x === dest) return true; for (const y of adj.get(x) || []) if (!(skip && skip.has(y)) && !seen.has(y)) { seen.add(y); st.push(y); } } return false; };
    const srcs = [...adj.keys()].filter((n) => n instanceof AudioScheduledSourceNode);
    const live = srcs.filter((s) => reach(s, null)), leak = live.filter((s) => reach(s, masters));
    return { srcs: srcs.length, live: live.length, leak: leak.length, comp: reach(SND.comp, null) && !reach(SND.master, new Set([SND.comp])), flow: SND.flow.length };
  });
  check('каждый источник звука выходит только через мастер и компрессор (@app-audio-master)',
    r.live >= 12 && r.leak === 0 && r.comp && r.flow === 4, 'источников ' + r.live + ' из ' + r.srcs + ', в обход мастера ' + r.leak + ', мастер→компрессор ' + r.comp + ', голосов потока ' + r.flow);
  await exitPage(P);
}

/* 2. Мастер гаснет: без звука, на паузе, в фоне (и контекст спит), на рекламе — и возвращается */
{
  const P = await openPage({});
  await play(P.page, 0);
  await P.page.waitForTimeout(500);
  const r = await P.page.evaluate(async () => {
    const m = () => +SND.master.gain.value.toFixed(3), w = (ms) => new Promise((res) => setTimeout(res, ms));
    const on0 = m();
    opt.sound = false; await w(500); const off = m(); opt.sound = true; await w(500); const on1 = m();
    paused = true; await w(500); const pz = m(); paused = false; await w(500);
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    /* спящий контекст не считает автоматизацию, и value держит прошлое: в фоне проверяется цель мастера */
    await w(150); const hid = SND.master.gain._v, st = AC.state;
    delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'));
    await w(600); const back = m(), st2 = AC.state;
    window.adsPause(true); await w(60); const ad = m(); window.adsPause(false); await w(600); const ad2 = m();
    return { on0, off, on1, pz, hid, st, back, st2, ad, ad2 };
  });
  const ok = r.on0 > 0.5 && r.off < 0.02 && r.on1 > 0.5 && r.pz < 0.02 && r.hid < 0.02 && r.st === 'suspended' && r.back > 0.5 && r.st2 === 'running' && r.ad < 0.05 && r.ad2 > 0.5;
  check('звук гаснет без звука, на паузе, в фоне (контекст спит) и на рекламе, потом возвращается (@app-audio-silent)', ok, JSON.stringify(r));
  await exitPage(P);
}

/* 3. Обороты автомата: холостые, разгон на первой, ровный ход на второй, нейтраль с газом, задний ход;
      частота мотора на живом кадре = обороты / 30 */
{
  const P = await openPage({});
  const r = await P.page.evaluate(async () => {
    const e = { rpm: ENG.idle, g: 1, thr: 0 }, dt = 1 / 60;
    for (let i = 0; i < 120; i++) rpmStep(e, 0, 1, 0, 0, dt);
    const idle = e.rpm;
    let kmh = 0, top = 0; for (let i = 0; i < 150; i++) { kmh = Math.min(19, kmh + 2.6 * 3.6 * dt); rpmStep(e, kmh, 1, 1, 2.6, dt); top = Math.max(top, e.rpm); }
    const g1 = e.g;
    for (let i = 0; i < 180; i++) rpmStep(e, 19, 1, 1, 0, dt);
    const cruise = e.rpm, g2 = e.g;
    const n = { rpm: ENG.idle, g: 1 }; for (let i = 0; i < 120; i++) rpmStep(n, 0, 0, 1, 0, dt);
    const rv = { rpm: ENG.idle, g: 1 }; for (let i = 0; i < 120; i++) rpmStep(rv, 12, -1, 0.5, 0, dt);
    opt.sound = true; initAudio(); openLevel(0, 'pick'); hideOv(); paused = false;
    for (let i = 0; i < 80 && !(SND && SND.B); i++) await new Promise((res) => setTimeout(res, 100));
    car.sel = 'D'; car.gear = 1; input.fwd = true;
    await new Promise((res) => setTimeout(res, 1600));
    /* записи: высота петли = обороты / обороты записи; синтез: частота вспышек = обороты / 30 */
    const M = SND.B && SND.B.man.loops;
    const live = M ? { rpm: AU.rpm, rec: true, got: SND.eI.playbackRate.value, want: sfxRate(AU.rpm, M.idle.rpm), got2: SND.eL.playbackRate.value, want2: sfxRate(AU.rpm, M.load.rpm) }
      : { rpm: AU.rpm, rec: false, got: SND.eo1.frequency.value, want: AU.rpm / 30 };
    input.fwd = false;
    return { idle, top, g1, cruise, g2, neutral: n.rpm, rev: rv.rpm, live };
  });
  const L = r.live, near = (a, b) => Math.abs(a - b) / b < 0.05;
  const ok = Math.abs(r.idle - 750) < 5 && r.top > 1900 && r.g1 === 1 && r.g2 === 2 && r.cruise > 1150 && r.cruise < 1400
    && r.neutral > 2500 && r.rev > 1300 && r.rev < 1700 && near(L.got, L.want) && (!L.rec || near(L.got2, L.want2)) && L.rpm > 1100;
  check('обороты автомата: холостые 750, разгон на первой, ровный ход на второй, мотор звучит по оборотам (@app-audio-rpm)', ok,
    'холостые ' + Math.round(r.idle) + ', разгон до ' + Math.round(r.top) + ' на ' + r.g1 + '-й, ровно ' + Math.round(r.cruise) + ' на ' + r.g2 + '-й, N ' + Math.round(r.neutral)
    + ', R ' + Math.round(r.rev) + ', кадр: ' + Math.round(L.rpm) + ' об/мин → ' + (L.rec ? 'скорость записей ' + L.got.toFixed(2) + ' / ' + L.got2.toFixed(2) : L.got.toFixed(1) + ' Гц'));
  await exitPage(P);
}

/* 4. Реле поворотника щёлкает на каждом фронте лампы — и только на нём */
{
  const P = await openPage({});
  await play(P.page, 0);
  const r = await P.page.evaluate(async () => {
    let clicks = 0, edges = 0, was = false, stop = false;
    /* считается звук, а не вызов: запуск записи «тик»/«так» из файла разовых, на синтезе — всплеск шума
       в полосе реле на шине салона */
    const f = window.sndBurst; window.sndBurst = function (S, t, bus, fr) { if (bus === SND.inn && (fr === 3400 || fr === 2300)) clicks++; return f.apply(this, arguments); };
    const st0 = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when, off) {
      const B = SND && SND.B;
      if (B && this.buffer === B.buf.shots && ['tick', 'tock'].some((k) => Math.abs(off - (B.man.shots[k].a + B.sh.shots)) < 1e-4)) clicks++;
      return st0.apply(this, arguments);
    };
    const watch = () => { const lamp = !!car.blink && Math.floor(game.t / 0.75) % 2 === 0; if (lamp !== was) { edges++; was = lamp; } if (!stop) requestAnimationFrame(watch); };
    setBlink('L'); requestAnimationFrame(watch);
    await new Promise((res) => setTimeout(res, 3200));
    stop = true; const c0 = clicks;
    setBlink('L');
    await new Promise((res) => setTimeout(res, 1600));
    return { clicks: c0, edges, off: Math.max(0, clicks - c0 - 1) };
  });
  check('реле поворотника щёлкает на каждом фронте лампы, выключенное молчит (@app-audio-relay)',
    r.clicks >= 4 && Math.abs(r.clicks - r.edges) <= 1 && r.off === 0, 'щелчков ' + r.clicks + ', фронтов лампы ' + r.edges + ', после выключения лишних ' + r.off);
  await exitPage(P);
}

/* 5. Машина потока слышна с той стороны, где её видно; голосов не больше четырёх */
{
  const P = await openPage({});
  await play(P.page, -1);
  await P.page.waitForTimeout(600);
  const r = await P.page.evaluate(async () => {
    const flow = level.actors.filter((a) => a.act && a.act.flow);
    if (flow.length < 5) return { err: 'потока мало: ' + flow.length };
    for (const a of flow) a.act.done = true;
    const c = bodyPos(), n = Math.hypot(viewCam.f.x, viewCam.f.z), fu = -viewCam.f.x / n, fv = viewCam.f.z / n, ru = fv, rv = -fu;
    const put = (a, k) => { a.u = c.u + fu * 10 + ru * 12 * k; a.v = c.v + fv * 10 + rv * 12 * k; a.act.started = true; a.act.v = 5; };
    put(flow[0], -1); for (let i = 1; i < flow.length; i++) { flow[i].u = 1e4; flow[i].v = 1e4; }
    await new Promise((res) => setTimeout(res, 500));
    const left = Math.min(...SND.flow.map((V) => (V.p ? V.p.pan.value : 0)));
    put(flow[0], 1);
    await new Promise((res) => setTimeout(res, 500));
    const right = Math.max(...SND.flow.map((V) => (V.p ? V.p.pan.value : 0)));
    for (let i = 0; i < Math.min(8, flow.length); i++) put(flow[i], (i % 2 ? 1 : -1) * 0.5);
    await new Promise((res) => setTimeout(res, 100));
    return { left, right, voices: AU.flow.length };
  });
  check('машина потока слева слышна слева, справа — справа, голосов не больше 4 (@app-audio-spatial)',
    !r.err && r.left < -0.4 && r.right > 0.4 && r.voices <= 4, r.err || ('слева pan ' + r.left.toFixed(2) + ', справа ' + r.right.toFixed(2) + ', голосов ' + r.voices));
  await exitPage(P);
}

/* 6. Офлайн-запись трёх сцен: машина из салона, проезд потока и гудок, трамвай. Без NaN и клиппинга,
      под нагрузкой мотор громче холостых, проезд слева направо слышен слева направо, трамвай громче рядом.
      Записи — build/audio/*.wav */
{
  const P = await openPage({});
  await play(P.page, 0);
  const r = await P.page.evaluate(async () => {
    const SR = 44100, rec = !!SFX.B;
    const scene = async (secs, script) => {
      const ctx = new OfflineAudioContext(2, SR * secs, SR), S = audioBuild(ctx, SFX.B);
      const st = { on: true, rpm: ENG.idle, load: 0, v: 0, cabin: false, scrape: 0, bed: 0, flow: [], tram: null }, e = { rpm: ENG.idle, g: 1, thr: 0 };
      const dt = 1 / 60;
      for (let i = 0, t = 0; t < secs; i++, t = i * dt) script(t, st, S, e, dt);
      const buf = await ctx.startRendering();
      return [buf.getChannelData(0), buf.getChannelData(1)];
    };
    const rms = (ch, a, b) => { let s = 0, n = 0; for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) { s += ch[i] * ch[i]; n++; } return Math.sqrt(s / Math.max(1, n)); };
    const stat = ([L, R]) => { let peak = 0, nan = 0; for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) { const x = ch[i]; if (x !== x) nan++; else if (Math.abs(x) > peak) peak = Math.abs(x); } return { peak, nan }; };
    const wav = ([L, R]) => {
      const n = L.length, buf = new ArrayBuffer(44 + n * 4), d = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); d.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 2, true);
      d.setUint32(24, SR, true); d.setUint32(28, SR * 4, true); d.setUint16(32, 4, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) { d.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); d.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
      let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s);
    };
    /* машина из салона: холостые → селектор → разгон в пол → ровный ход → поворотник → бордюр → удар → ручник */
    const car = await scene(12, (t, st, S, e, dt) => {
      st.cabin = true; st.bed = 0.015;
      const thr = t > 2 && t < 6.5 ? 1 : (t > 6.5 && t < 8 ? 0.35 : 0);
      if (t > 2) st.v = Math.min(5.2, Math.max(0, st.v + (thr > 0.5 ? 2.6 : thr > 0 ? 0 : -0.8) * dt));
      e.thr += (thr - e.thr) * Math.min(1, dt / 0.12);
      st.rpm = rpmStep(e, st.v * 3.6, t > 1.6 ? 1 : 0, e.thr, thr > 0.5 && st.v < 5.1 ? 2.6 : 0, dt); st.load = e.thr;
      st.scrape = t > 9.6 && t < 10.3 ? 0.6 : 0;
      audioUpdate(S, st, t);
      const k = Math.round(t * 60);
      if (k === 96) SND_EVT.sel(S, t);
      if (t > 8 && t < 11 && Math.floor(t / 0.75) !== Math.floor((t - dt) / 0.75)) sndRelay(S, t, Math.floor(t / 0.75) % 2 === 0);
      if (k === 640) sndHit(S, t, 1);
      if (k === 680) SND_EVT.handOn(S, t);
    });
    /* улица снаружи: фон города, машина потока проезжает слева направо в 8 м (с записями — и проезд мимо,
       пик которого приходится на 4-ю секунду), гудок справа */
    const city = await scene(8, (t, st, S) => {
      st.bed = 0.045; st.rpm = ENG.idle;
      const x = -40 + t * 10, d = Math.hypot(x, 8);
      st.flow = [{ d, sp: 10, pan: Math.max(-1, Math.min(1, x / d)) }];
      audioUpdate(S, st, t);
      const pt = 4 - (S.B ? S.B.man.shots.pass.p : 0);
      if (S.B && Math.round(t * 60) === Math.round(pt * 60)) sndPass(S, t, 4 - t, 8, (q) => { const xx = -40 + (t + q) * 10; return xx / Math.hypot(xx, 8); }, 1);
      if (Math.round(t * 60) === 440) { sndHorn(S, t, 0.6, 0.7, 0.2); sndHorn(S, t + 0.3, 0.6, 0.7, 0.32); }
    });
    /* трамвай подходит слева, звонит, стучит на стыках и уходит направо */
    const tram = await scene(10, (t, st, S) => {
      st.bed = 0.05; st.rpm = ENG.idle;
      const x = -50 + t * 9, d = Math.hypot(x, 6), pan = Math.max(-1, Math.min(1, x / d));
      st.tram = { d, sp: 9, pan };
      audioUpdate(S, st, t);
      const k = Math.round(t * 60);
      if (k === 210) sndBell(S, t, pan, 6 / Math.max(6, d));
      if (k > 0 && Math.floor(t * 9 / 12.5) !== Math.floor((t - 1 / 60) * 9 / 12.5)) sndClack(S, t, pan, 6 / Math.max(6, d), 0.25);
    });
    /* своя машина на холостых слышна всегда и громче трамвая за 40 м — это честно, поэтому проезд и трамвай
       сравниваются по своей энергии: из сцены вычитается та же сцена без них */
    const base = await scene(8, (t, st, S) => { st.bed = 0.045; st.rpm = ENG.idle; audioUpdate(S, st, t); });
    const own = (a, ch, t0, t1) => Math.sqrt(Math.max(0, rms(a[ch], t0, t1) ** 2 - rms(base[ch], t0, t1) ** 2));
    const out = {};
    for (const [nm, a] of [['car', car], ['city', city], ['tram', tram]]) out[nm] = { stat: stat(a), wav: wav(a) };
    out.rec = rec;
    out.car.idle = rms(car[0], 0.4, 1.4); out.car.load = rms(car[0], 3.5, 6);
    out.city.early = own(city, 0, 2, 3.2) / Math.max(1e-9, own(city, 1, 2, 3.2)); out.city.late = own(city, 0, 4.8, 6) / Math.max(1e-9, own(city, 1, 4.8, 6));
    out.tram.far = own(tram, 0, 0.6, 1.6) + own(tram, 1, 0.6, 1.6); out.tram.near = own(tram, 0, 5, 6.2) + own(tram, 1, 5, 6.2);
    return out;
  });
  fs.mkdirSync(OUT, { recursive: true });
  for (const nm of ['car', 'city', 'tram']) fs.writeFileSync(path.join(OUT, nm + '.wav'), Buffer.from(r[nm].wav, 'base64'));
  const st = ['car', 'city', 'tram'].map((nm) => nm + ' пик ' + r[nm].stat.peak.toFixed(2) + (r[nm].stat.nan ? ' NaN ' + r[nm].stat.nan : ''));
  const ok = ['car', 'city', 'tram'].every((nm) => !r[nm].stat.nan && r[nm].stat.peak <= 0.99 && r[nm].stat.peak > 0.02)
    && r.car.load > r.car.idle * 1.5 && r.city.early > 1.3 && r.city.late < 0.77 && r.tram.near > r.tram.far * 2;
  check('офлайн-запись из записей: без NaN и клиппинга, мотор под нагрузкой громче, проезд слева направо, трамвай громче рядом (@app-audio-render)', ok && r.rec,
    (r.rec ? 'записи' : 'СИНТЕЗ — записи не загрузились') + '; ' + st.join(', ') + '; мотор ×' + (r.car.load / r.car.idle).toFixed(1) + ', L/R ' + r.city.early.toFixed(2) + '→' + r.city.late.toFixed(2) + ', трамвай ×' + (r.tram.near / r.tram.far).toFixed(1) + ' → ' + path.relative(ROOT, OUT));
  await exitPage(P);
}

/* 7. Записи: до включения звука ни одного запроса за ними; после — оба файла декодированы, метка найдена,
      каждая петля графа — из записей и выходит через мастер, осцилляторов синтеза в графе нет */
{
  const P = await openPage({});
  await P.page.evaluate(() => { opt.sound = false; initAudio(); openLevel(0, 'pick'); hideOv(); paused = false; });
  await P.page.waitForTimeout(1200);
  const before = P.reqs.length;
  await play(P.page, 0);
  await P.page.waitForTimeout(400);
  const r = await P.page.evaluate(() => {
    const B = SND && SND.B;
    if (!B) return { st: SFX.st };
    const E = window.__edges, dest = AC.destination, adj = new Map();
    for (const [a, b] of E) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
    const viaMaster = (src) => { const seen = new Set([src]), st = [src]; let m = false;
      while (st.length) { const x = st.pop(); if (x === SND.master) m = true; if (x === dest) return m; for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); st.push(y); } } return false; };
    const loops = [SND.eI, SND.eL, SND.tyS, SND.bedS, SND.trRun, ...SND.flow.map((V) => V.s)];
    const len = (k) => B.buf[k].duration, need = Math.max(...Object.values(B.man.loops).map((L) => L.b)), needS = Math.max(...Object.values(B.man.shots).map((x) => x.a + x.d));
    return { st: SFX.st, files: Object.keys(B.buf).length, okLen: len('loops') >= need && len('shots') >= needS, sh: Object.values(B.sh),
      fromRec: loops.filter((s) => s && s.buffer === B.buf.loops && s.loop).length, total: loops.length, master: loops.filter(viaMaster).length, synth: !!SND.eo1 };
  });
  const ok = before === 0 && r.st === 2 && r.files === 2 && r.okLen && r.sh.every((x) => x > -0.002 && x < 0.08) && r.fromRec === r.total && r.master === r.total && !r.synth && P.reqs.length === 2;
  check('записи качаются только со звуком, обе декодированы, все петли графа — из записей и через мастер (@app-audio-samples)', ok,
    r.files ? 'запросов до звука ' + before + ', после ' + P.reqs.length + ', сдвиг метки ' + r.sh.map((x) => (x * 1000).toFixed(1) + ' мс').join(' / ') + ', петель из записей ' + r.fromRec + ' из ' + r.total + ', через мастер ' + r.master + (r.synth ? ', В ГРАФЕ СИНТЕЗ' : '')
      : 'записи не встали в граф (SFX.st ' + r.st + '), запросов до звука ' + before);
  await exitPage(P);
}

/* 8. Записи не загрузились (404): играет синтез, одно предупреждение «[audio]», исключений нет */
{
  const P = await openPage({ block: true });
  await P.page.evaluate(() => { opt.sound = true; initAudio(); openLevel(0, 'pick'); hideOv(); paused = false; });
  await P.page.waitForTimeout(1500);
  const r = await P.page.evaluate(() => ({ st: SFX.st, snd: !!SND, rec: !!(SND && SND.B), synth: !!(SND && SND.eo1), master: SND ? +SND.master.gain.value.toFixed(2) : 0 }));
  const ok = r.st === -1 && r.snd && !r.rec && r.synth && r.master > 0.5 && P.warns.length === 1 && !P.errors.length;
  check('записи не загрузились — звучит синтез, одно предупреждение «[audio]», без исключений (@app-audio-sample-fallback)', ok,
    'SFX.st ' + r.st + ', граф ' + (r.snd ? (r.rec ? 'записи' : r.synth ? 'синтез' : '?') : 'нет') + ', мастер ' + r.master + ', warn ' + P.warns.length + (P.warns[0] ? ' «' + P.warns[0].slice(0, 70) + '»' : ''));
  await exitPage(P);
}

/* 9. Петли сшиты: материал вокруг loopEnd повторяет материал вокруг loopStart — на декодированном буфере,
      с найденным сдвигом метки. Ошибка — СКО разности окон ±45 мс к СКО сигнала: сжатие даёт 0,02–0,12,
      окно не в фазе — около 1,4 */
{
  const P = await openPage({});
  await play(P.page, 0);
  const r = await P.page.evaluate(() => {
    const B = SFX.B;
    if (!B) return null;
    const d = B.buf.loops.getChannelData(0), sr = B.buf.loops.sampleRate, sh = B.sh.loops, out = {};
    for (const [id, L] of Object.entries(B.man.loops)) {
      const a = Math.round((L.a + sh) * sr), b = Math.round((L.b + sh) * sr), W = Math.round(0.045 * sr);
      let e = 0, s = 0; for (let j = -W; j < W; j++) { const x = d[a + j] - d[b + j]; e += x * x; s += d[b + j] * d[b + j]; }
      out[id] = +Math.sqrt(e / Math.max(1e-12, s)).toFixed(3);
    }
    return out;
  });
  const ok = !!r && Object.values(r).every((x) => x < 0.3);
  check('петли записей сшиты без скачка: материал у конца петли повторяет материал у начала (@app-audio-loop-seam)', ok,
    r ? Object.entries(r).map(([k, v]) => k + ' ' + v).join(', ') : 'записи не загрузились');
  await exitPage(P);
}

/* 10. Без WebAudio: игра идёт, звука нет, одно предупреждение, исключений нет */
{
  const P = await openPage({ noctx: true });
  const r = await P.page.evaluate(async () => {
    opt.sound = true; initAudio(); initAudio(); openLevel(0, 'pick'); hideOv(); paused = false;
    const t0 = game.t; tone(500, 0.1, 0.1); thud(1); sndEvent('sel'); honk(4, null); setBlink('L');
    await new Promise((res) => setTimeout(res, 500));
    return { dt: game.t - t0, ac: AC === null };
  });
  check('без WebAudio игра идёт без звука, предупреждение «[audio]», без исключений (@app-audio-no-ctx)',
    r.dt > 0.2 && r.ac && P.warns.length >= 1 && !P.errors.length, 'время ' + r.dt.toFixed(2) + ', warn ' + P.warns.length + (P.errors[0] ? ', ' + P.errors[0] : ''));
  await exitPage(P);
}

await browser.close();
if (server) server.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
