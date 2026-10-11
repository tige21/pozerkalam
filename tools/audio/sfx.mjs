#!/usr/bin/env node
/* Звуки игры из записей CC0 (план sound-samples.md, Ф2): assets/src/audio/*.mp3 → audio/loops.<хэш>.mp3,
   audio/shots.<хэш>.mp3 и манифест SFX_MAN в index.html между маркерами sfx:begin / sfx:end.

     node tools/audio/sfx.mjs           # пересобрать
     node tools/audio/sfx.mjs --check   # манифест свежий, файлы на месте, бюджет (@app-audio-sfx-fresh)

   Два файла-«спрайта», а не двадцать: петли — 64 кбит/с (мотор, шины, фон — низ и середина), разовые —
   80 кбит/с (щелчки реле и селектора — верх). Места в файлах — в манифесте.

   MP3 несёт задержку кодера, и не каждый декодер её срезает: без поправки «тик» реле звучал бы на 25 мс
   позже лампы, а петля начиналась бы не там. Поэтому в начале файла стоит метка — короткий тон, — игра
   находит её в декодированном буфере и сдвигает все места на разницу (sfxShift). Сверх того петля
   записана с запасом SFX_M по краям из того же периодического материала: окно [a, b] петлится без
   щелчка при любом сдвиге меньше запаса.

   Петля сшивается внахлёст: конец переходит в кусок перед началом. У мотора длина петли подбирается по
   корреляции — шов попадает в ту же фазу вспышек, и нахлёст линейный; у шума (шины, фон, трамвай)
   корреляции нет, нахлёст по равной мощности. Проезд машины для голоса потока сперва выравнивается по
   громкости: в записи машина приближается, и петля из неё «накатывала» бы раз в секунду.

   Отпечаток (fp) — от таблиц, версии обработки и байтов исходников, не от MP3 на выходе: кодер другой
   версии даст другие байты, а --check должен краснеть только когда правили исходник или таблицу. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'assets', 'src', 'audio');
const OUT = path.join(ROOT, 'audio');
const HTML = path.join(ROOT, 'index.html');
const CHECK = process.argv.includes('--check');
const SR = 44100;
const VER = 2;
const BUDGET = 400 * 1024;
const SFX_M = 0.15;
const LOOP_RMS = 0.1;
const SHOT_PEAK = 0.89;
const MARK = { pre: 0.05, len: 0.004, f: 2000, thr: 0.3, post: 0.1 };

/* время — от начала файла в assets/src/audio (длинные обрезаны, см. SOURCES.md); len — длина петли,
   xf — нахлёст шва, tonal — подбирать длину по корреляции, flat — выровнять громкость, rpm — обороты записи */
const LOOPS = [
  { id: 'idle', src: 'engine-idle.mp3', ss: 0.05, t: 3.0, len: 2.4, xf: 0.12, tonal: true, rpm: 840 },
  { id: 'load', src: 'engine-load.mp3', ss: 0.05, t: 2.0, len: 1.6, xf: 0.1, tonal: true, rpm: 1480 },
  { id: 'tyres', src: 'tyres.mp3', ss: 3.0, t: 7.0, len: 5.5, xf: 0.4 },
  { id: 'bed', src: 'city-bed.mp3', ss: 2.0, t: 10.0, len: 9.0, xf: 0.8 },
  { id: 'flow', src: 'car-pass.mp3', ss: 3.5, t: 1.6, len: 1.25, xf: 0.25, tonal: true, flat: true },
  { id: 'tram', src: 'tram-run.mp3', ss: 4.0, t: 5.5, len: 4.6, xf: 0.5 },
];
/* hp — срез низа (гул салона под щелчками); peak — момент, когда машина ближе всего, от начала записи */
const SHOTS = [
  { id: 'tick', src: 'blinker.mp3', ss: 3.247, t: 0.1, hp: 250 },
  { id: 'tock', src: 'blinker.mp3', ss: 3.608, t: 0.1, hp: 250 },
  { id: 'stalk', src: 'blinker.mp3', ss: 0.561, t: 0.14, hp: 250 },
  { id: 'sel', src: 'selector.mp3', ss: 5.545, t: 0.16, hp: 120 },
  { id: 'handOn', src: 'handbrake.mp3', ss: 3.52, t: 0.58, hp: 120 },
  { id: 'handOff', src: 'handbrake.mp3', ss: 2.96, t: 0.36, hp: 120 },
  { id: 'hit', src: 'hit.mp3', ss: 0, t: 0.54 },
  { id: 'kerb', src: 'kerb.mp3', ss: 0.04, t: 0.46 },
  { id: 'horn', src: 'horn.mp3', ss: 0, t: 0.75 },
  { id: 'bell', src: 'tram-bell.mp3', ss: 0.27, t: 1.56 },
  { id: 'clack', src: 'rail-clack.mp3', ss: 2.2, t: 0.85 },
  { id: 'pass', src: 'car-pass.mp3', ss: 2.8, t: 5.2, peak: 5.35 },
];

const sha = (b) => createHash('sha256').update(b).digest('hex');
function fingerprint() {
  const h = createHash('sha256').update(JSON.stringify({ VER, SFX_M, LOOP_RMS, SHOT_PEAK, MARK, LOOPS, SHOTS }));
  for (const f of [...new Set([...LOOPS, ...SHOTS].map((x) => x.src))].sort()) h.update(f).update(fs.readFileSync(path.join(SRC, f)));
  return h.digest('hex').slice(0, 16);
}

const MAN_RE = /\/\* sfx:begin[^*]*\*\/\n[\s\S]*?\n\/\* sfx:end \*\//;
function readMan() {
  const m = /\/\* sfx:begin[^*]*\*\/\nconst SFX_MAN=(\{.*\});\n\/\* sfx:end \*\//.exec(fs.readFileSync(HTML, 'utf8'));
  return m ? JSON.parse(m[1]) : null;
}

if (CHECK) {
  const man = readMan(), bad = [];
  if (!man) bad.push('в index.html нет блока sfx:begin … sfx:end');
  else {
    if (man.fp !== fingerprint()) bad.push(`манифест устарел (fp ${man.fp} ≠ ${fingerprint()}) — пересобери: node tools/audio/sfx.mjs`);
    let total = 0;
    for (const f of Object.values(man.files)) {
      const p = path.join(ROOT, f);
      if (!fs.existsSync(p)) { bad.push(`нет файла ${f}`); continue; }
      total += fs.statSync(p).size;
    }
    const listed = new Set(Object.values(man.files).map((f) => path.basename(f)));
    for (const f of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) if (!listed.has(f)) bad.push(`лишний файл audio/${f} — его зальёт деплой`);
    if (total > BUDGET) bad.push(`звуки ${(total / 1024).toFixed(0)} КБ больше бюджета ${BUDGET / 1024} КБ`);
    console.log(`[sfx] ${Object.keys(man.loops).length} петель, ${Object.keys(man.shots).length} разовых, ${(total / 1024).toFixed(0)} КБ из ${BUDGET / 1024}`);
  }
  const name = 'звуки собраны из текущих исходников, файлы на месте, бюджет 400 КБ (@app-audio-sfx-fresh)';
  console.log((bad.length ? '  FAIL ' : '  ok   ') + name + (bad.length ? ' — ' + bad.join('; ') : ''));
  process.exit(bad.length ? 1 : 0);
}

function decode(src, ss, t, hp) {
  const af = hp ? ['-af', `highpass=f=${hp}`] : [];
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(ss), '-t', String(t), '-i', path.join(SRC, src),
    '-ac', '1', '-ar', String(SR), ...af, '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
}
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / Math.max(1, x.length)); };
const peak = (x) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; };

function flatten(x) {
  const W = Math.round(0.2 * SR), e = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i] * x[i]; if (i >= W) s -= x[i - W] * x[i - W];
    e[i] = Math.sqrt(Math.max(0, s) / Math.min(i + 1, W));
  }
  const y = new Float32Array(x.length), half = W >> 1;
  for (let i = 0; i < x.length; i++) y[i] = x[i] / Math.max(1e-4, e[Math.min(x.length - 1, i + half)]);
  return y;
}

function ncorr(x, i, j, n) {
  let ab = 0, aa = 0, bb = 0;
  for (let k = 0; k < n; k++) { const a = x[i + k], b = x[j + k]; ab += a * b; aa += a * a; bb += b * b; }
  return ab / Math.sqrt(aa * bb + 1e-12);
}

function makeLoop(L) {
  let x = decode(L.src, L.ss, L.t);
  if (L.flat) x = flatten(x);
  const X = Math.round(L.xf * SR), T = Math.round(L.len * SR), A = X;
  const hi = Math.min(Math.round(T * 1.15), x.length - A);
  if (hi < T * 0.85) throw new Error(`${L.id}: запись короче петли`);
  let N = Math.min(T, hi), c = 0;
  if (L.tonal) {
    const W = Math.min(X, Math.round(0.04 * SR)), at = A - (X >> 1) - (W >> 1);
    let best = -2;
    for (let n = Math.round(T * 0.85); n <= hi; n++) { const r = ncorr(x, at, at + n, W); if (r > best) { best = r; N = n; } }
    c = best;
  }
  const lin = L.tonal && c > 0.6, y = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (i < N - X) { y[i] = x[A + i]; continue; }
    const k = (i - (N - X)) / X, fo = lin ? 1 - k : Math.cos(k * Math.PI / 2), fi = lin ? k : Math.sin(k * Math.PI / 2);
    y[i] = x[A + i] * fo + x[A + i - N] * fi;
  }
  let g = LOOP_RMS / Math.max(1e-6, rms(y));
  if (peak(y) * g > 0.95) g = 0.95 / peak(y);
  for (let i = 0; i < N; i++) y[i] *= g;
  return { y, N, c, lin };
}

function makeShot(S) {
  const x = decode(S.src, S.ss, S.t, S.hp), n = x.length;
  const fi = Math.round(0.002 * SR), fo = Math.round(Math.min(0.06, 0.25 * S.t) * SR);
  for (let i = 0; i < fi; i++) x[i] *= i / fi;
  for (let i = 0; i < fo; i++) x[n - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / fo);
  const g = SHOT_PEAK / Math.max(1e-6, peak(x));
  for (let i = 0; i < n; i++) x[i] *= g;
  return x;
}

/* метка: тон с окном Ханна; mk — первый отсчёт выше порога в несжатом сигнале, его ищет игра */
function header(parts) {
  const pre = Math.round(MARK.pre * SR), len = Math.round(MARK.len * SR), post = Math.round(MARK.post * SR);
  const m = new Float32Array(pre + len + post);
  for (let i = 0; i < len; i++) m[pre + i] = 0.9 * Math.sin(2 * Math.PI * MARK.f * i / SR) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / len));
  parts.push(m);
  let mk = 0; while (Math.abs(m[mk]) <= MARK.thr) mk++;
  return mk / SR;
}
const silence = (s) => new Float32Array(Math.round(s * SR));
const lenOf = (parts) => parts.reduce((s, p) => s + p.length, 0);

function encode(parts, kbps, name) {
  const pcm = new Float32Array(lenOf(parts));
  let o = 0; for (const p of parts) { pcm.set(p, o); o += p.length; }
  /* в файл, а не в поток: заголовок Xing/LAME с задержкой кодера ffmpeg дописывает в начало после
     кодирования, и в трубу он не попадал — без него декодер не знает, сколько срезать */
  const tmp = path.join(OUT, `.${name}.tmp.mp3`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-',
    '-c:a', 'libmp3lame', '-b:a', kbps + 'k', tmp], { input: Buffer.from(pcm.buffer), maxBuffer: 1 << 26 });
  const mp3 = fs.readFileSync(tmp);
  fs.rmSync(tmp);
  const file = `${name}.${sha(mp3).slice(0, 8)}.mp3`;
  fs.writeFileSync(path.join(OUT, file), mp3);
  console.log(`[sfx] ${file} ${(pcm.length / SR).toFixed(1)} с, ${(mp3.length / 1024).toFixed(0)} КБ`);
  return 'audio/' + file;
}

fs.mkdirSync(OUT, { recursive: true });
const man = { fp: fingerprint(), mk: 0, files: {}, loops: {}, shots: {} };
const r3 = (v) => +v.toFixed(6);

{
  const parts = [];
  man.mk = r3(header(parts));
  for (const L of LOOPS) {
    const { y, N, c, lin } = makeLoop(L), M = Math.round(SFX_M * SR);
    const a = lenOf(parts) + M;
    parts.push(y.slice(N - M), y, y.slice(0, M), silence(0.06));
    man.loops[L.id] = { a: r3(a / SR), b: r3((a + N) / SR), ...(L.rpm ? { rpm: L.rpm } : {}) };
    console.log(`[sfx] петля ${L.id}: ${(N / SR).toFixed(3)} с` + (L.tonal ? `, шов по корреляции ${c.toFixed(2)}, нахлёст ${lin ? 'линейный' : 'по мощности'}` : ''));
  }
  man.files.loops = encode(parts, 64, 'loops');
}
{
  const parts = [];
  const mk = header(parts);
  if (r3(mk) !== man.mk) throw new Error('метки файлов разошлись');
  for (const S of SHOTS) {
    const x = makeShot(S);
    parts.push(silence(0.08));
    const a = lenOf(parts);
    parts.push(x);
    man.shots[S.id] = { a: r3(a / SR), d: r3(x.length / SR), ...(S.peak ? { p: r3(S.peak - S.ss) } : {}) };
  }
  parts.push(silence(0.08));
  man.files.shots = encode(parts, 80, 'shots');
}

for (const f of fs.readdirSync(OUT)) if (!Object.values(man.files).includes('audio/' + f)) fs.rmSync(path.join(OUT, f));
const html = fs.readFileSync(HTML, 'utf8');
if (!MAN_RE.test(html)) throw new Error('в index.html нет маркеров sfx:begin / sfx:end');
const block = '/* sfx:begin — генерат tools/audio/sfx.mjs по assets/src/audio, руками не править */\nconst SFX_MAN=' + JSON.stringify(man) + ';\n/* sfx:end */';
fs.writeFileSync(HTML, html.replace(MAN_RE, block));
let total = 0; for (const f of Object.values(man.files)) total += fs.statSync(path.join(ROOT, f)).size;
console.log(`[sfx] манифест записан, fp ${man.fp}, всего ${(total / 1024).toFixed(0)} КБ из ${BUDGET / 1024}`);
