#!/usr/bin/env node
/* Гейт голоса инструктора (план exam-clarity-voice-sound, Ф3). Настоящего голоса в headless нет, поэтому
   speechSynthesis подменяется моком до загрузки страницы: он записывает каждую фразу вместе с этапом
   экзамена и расстоянием до точки манёвра. Проверяется, ЧТО и ГДЕ звучит: команда — заранее, у манёвра —
   короткое напоминание; тишина без звука, с выключенным голосом, в фоне и на рекламе; повтор по Ё и
   кнопке; вслух — без скобок, кавычек и «м»; без русского голоса — молчание и один warn.

     PW_DIR=/tmp/pw node tools/voice-check.mjs
     FAULT=late|nosilent|hidden|ads|repeat|raw|novoice|reroute PW_DIR=/tmp/pw node tools/voice-check.mjs

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
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'].concat(process.env.HOST_RULES ? ['--host-resolver-rules=' + process.env.HOST_RULES] : []) });
const BOT = fs.readFileSync(path.join(HERE, 'practice-bot.js'), 'utf8');

/* мок речи: sync — фраза «звучит» мгновенно (бот гонит маршрут в одном вызове, таймеры не успели бы),
   иначе — 40 мс + 8 мс на символ, чтобы очередь и прерывание были настоящими */
function mockSpeech(o) {
  window.__said = []; window.__cancel = 0; window.__ssSync = !!o.sync;
  if (o.noss) { try { delete window.speechSynthesis; } catch (e) {} Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); window.SpeechSynthesisUtterance = undefined; return; }
  class U { constructor(t) { this.text = t; this.onend = null; this.onerror = null; this.volume = 1; } }
  const ss = {
    speaking: false, paused: false, pending: false, _u: null, _tm: 0,
    getVoices() { return o.novoice ? [{ name: 'Mock English', lang: 'en-US' }] : [{ name: 'Mock Milena', lang: 'ru-RU', localService: true }]; },
    speak(u) {
      if (!String(u.text).trim()) return;
      const rec = { t: u.text, ru: !!(u.voice && /^ru/.test(u.voice.lang)) };
      try { if (examActive()) { rec.stage = exam.stage; rec.d = examNav().dist; rec.v = Math.abs(car.vel); rec.route = exam.route.seed; } } catch (e) {}
      window.__said.push(rec);
      if (window.__ssSync) { if (u.onend) u.onend(); return; }
      this.speaking = true; this._u = u; clearTimeout(this._tm);
      this._tm = setTimeout(() => { if (this._u === u) { this.speaking = false; this._u = null; if (u.onend) u.onend(); } }, 40 + u.text.length * 8);
    },
    cancel() { window.__cancel++; const u = this._u; this._u = null; this.speaking = false; clearTimeout(this._tm); if (u && u.onerror) u.onerror({ error: 'interrupted' }); },
    pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: ss, configurable: true });
  window.SpeechSynthesisUtterance = U;
}

async function openPage(o) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(mockSpeech, o || {});
  const page = await ctx.newPage();
  const errors = [], warns = [];
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'warning' && /\[voice\]/.test(m.text())) warns.push(m.text()); });
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now());
  await page.waitForFunction(() => typeof LEVELS !== 'undefined' && LEVELS.length > 0, null, { timeout: 20000 });
  await page.evaluate(() => { try { for (const k of ['trainer_seen', 'trainer_drive', 'trainer_hint', 'pz_offer']) localStorage.setItem(k, '1'); } catch (e) {} });
  /* evaluate, а не addScriptTag: CSP прода режет инлайновый <script> без хэша */
  await page.evaluate(BOT);
  await page.evaluate((fault) => {
    if (fault === 'late') {
      const f = window.examVoiceTick;
      window.examVoiceTick = function () { const st = exam.route[exam.stage], d = st ? examNav().dist : null; if (d === null || d < 8) f(); };
    }
    if (fault === 'nosilent') window.voiceOn = () => !paused;
    if (fault === 'hidden') { window.voiceHalt = () => {}; window.voiceOn = () => opt.sound && opt.voice && !paused; }
    if (fault === 'ads') { window.voiceHalt = () => {}; window.voiceOn = () => opt.sound && opt.voice && document.visibilityState !== 'hidden'; }
    if (fault === 'repeat') window.voiceRepeat = () => {};
    if (fault === 'raw') window.speechText = (s) => String(s || '');
    if (fault === 'novoice') window.voicePick = () => (window.speechSynthesis.getVoices() || [])[0] || null;
    if (fault === 'reroute') { const f = window.examNodeExit; window.examNodeExit = function (n, out) { f(n, out); exam.rerouted = false; }; }
  }, FAULT);
  return { page, ctx, errors, warns };
}

const results = [];
const check = (name, ok, info) => { results.push({ name, ok, info }); console.log((ok ? '  ok   ' : '  FAIL ') + name + (info ? ' — ' + info : '')); };
const exitPage = async (P) => { if (P.errors.length) check('страница без исключений', false, P.errors.slice(0, 3).join(' | ')); await P.ctx.close(); };

/* экзамен на живых кадрах: бриф закрыт, игра идёт, звук включён */
const startExamLive = (page) => page.evaluate(() => {
  opt.sound = true; opt.voice = true; opt.examMode = 'real';
  window.EXAM_SEED = 1007; openLevel(LEVELS.findIndex((l) => l.examRoute), 'pick'); delete window.EXAM_SEED;
  hideOv(); paused = false; window.__said.length = 0;
});

/* 1. Команда звучит заранее, напоминание — у манёвра. Бот проезжает 4 маршрута; для каждого поворота,
      до которого от начала этапа было не меньше 20 м, команда прозвучала, пока до узла оставалось ≥ 15 м;
      если этап длинный (≥ 70 м), у манёвра звучит ещё и короткое напоминание — ближе max(25 м, 5 с хода) */
{
  const P = await openPage({ sync: true });
  const r = await P.page.evaluate((seeds) => {
    const bad = []; let turns = 0, rem = 0;
    opt.sound = true; opt.voice = true;
    for (const s of seeds) {
      const st0 = [];
      const f = window.examTick;
      window.examTick = function (dt) { f(dt); if (examActive() && st0[exam.stage] === undefined) st0[exam.stage] = examNav().dist; };
      window.__said.length = 0;
      const x = examDrive(s, { maxT: 300 });
      window.examTick = f;
      if (!x.done || x.failed) { bad.push(s + ': бот не доехал'); continue; }
      const rt = exam.route;
      rt.forEach((st, i) => {
        if ('LRU'.indexOf(st.turn) < 0 || !st.at) return;
        const d0 = st0[i]; if (d0 === undefined || d0 === null || d0 < 20) return;
        turns++;
        const mine = window.__said.filter((q) => q.stage === i);
        if (!mine.some((q) => q.d >= 15)) bad.push(s + '/' + i + ' «' + st.short + '»: команды не было за 15 м (' + mine.map((q) => Math.round(q.d)).join(',') + ')');
        if (d0 >= 70) {
          const late = mine.filter((q, k) => k > 0);
          const ok = late.some((q) => q.d <= Math.max(25, q.v * 5) + 3 && q.d >= 3);
          if (ok) rem++; else bad.push(s + '/' + i + ' «' + st.short + '»: нет напоминания у манёвра (' + mine.map((q) => Math.round(q.d)).join(',') + ')');
        }
      });
      if (window.__said.some((q) => !q.ru)) bad.push(s + ': фраза не русским голосом');
    }
    return { bad, turns, rem };
  }, [1007, 2007, 5007, 8007]);
  check('команда инспектора звучит заранее, у манёвра — короткое напоминание (@exam-voice-ahead)',
    !r.bad.length && r.turns >= 6, r.bad.length ? r.bad.slice(0, 4).join('; ') : r.turns + ' поворотов, напоминаний ' + r.rem);
  await exitPage(P);
}

/* 2. Без звука и с выключенным голосом — ни одной фразы */
{
  const P = await openPage({ sync: true });
  const r = await P.page.evaluate(() => {
    opt.sound = false; opt.voice = true; examDrive(1007, { maxT: 120 }); const a = window.__said.length;
    opt.sound = true; opt.voice = false; window.__said.length = 0; examDrive(1007, { maxT: 120 }); const b = window.__said.length;
    return { a, b };
  });
  check('без звука и с выключенным голосом инспектор молчит (@exam-voice-silent-off)', r.a === 0 && r.b === 0, 'без звука ' + r.a + ', без голоса ' + r.b);
  await exitPage(P);
}

/* 3. Фон: голос обрывается, пока вкладка скрыта — тишина; вернулся — команда звучит заново */
{
  const P = await openPage({});
  await startExamLive(P.page);
  await P.page.waitForFunction(() => window.__said.length > 0, null, { timeout: 5000 }).catch(() => {});
  const r = await P.page.evaluate(async () => {
    const first = window.__said.length;
    window.__said.length = 0;
    say('На перекрёстке — налево, на Садовую', { tag: 'exam', prio: 2, keep: true, interrupt: true });
    const c0 = window.__cancel;
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const cut = window.__cancel > c0;
    const n0 = window.__said.length;
    say('Ещё одна фраза в фоне', { tag: 'card' });
    await new Promise((res) => setTimeout(res, 800));
    const inBg = window.__said.length - n0;
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((res) => setTimeout(res, 400));
    return { first, cut, inBg, back: window.__said.slice(n0).map((q) => q.t) };
  });
  check('в фоне голос обрывается и молчит, по возвращении команда звучит заново (@exam-voice-hidden)',
    r.first > 0 && r.cut && r.inBg === 0 && r.back.some((t) => /Садову/.test(t)),
    'первая команда ' + r.first + ', оборвана ' + r.cut + ', в фоне ' + r.inBg + ', после — ' + JSON.stringify(r.back));
  await exitPage(P);
}

/* 4. Реклама (adsPause площадки): то же — замолчать сразу, после рекламы повторить команду */
{
  const P = await openPage({});
  await startExamLive(P.page);
  await P.page.waitForFunction(() => window.__said.length > 0, null, { timeout: 5000 }).catch(() => {});
  const r = await P.page.evaluate(async () => {
    window.__said.length = 0;
    say('На кольце — второй съезд, на Заводскую', { tag: 'exam', prio: 2, keep: true, interrupt: true });
    const c0 = window.__cancel;
    window.adsPause(true);
    const cut = window.__cancel > c0;
    const n0 = window.__said.length;
    await new Promise((res) => setTimeout(res, 800));
    const inAd = window.__said.length - n0;
    window.adsPause(false);
    await new Promise((res) => setTimeout(res, 400));
    return { cut, inAd, back: window.__said.slice(n0).map((q) => q.t) };
  });
  check('на рекламе голос обрывается и молчит, после неё команда звучит заново (@exam-voice-ads)',
    r.cut && r.inAd === 0 && r.back.some((t) => /съезд/.test(t)), 'оборвана ' + r.cut + ', на рекламе ' + r.inAd + ', после — ' + JSON.stringify(r.back));
  await exitPage(P);
}

/* 5. Повтор: Ё и кнопка на карточке говорят текущую команду; без звука — объяснение, а не тишина */
{
  const P = await openPage({});
  await startExamLive(P.page);
  await P.page.waitForTimeout(1200);
  await P.page.evaluate(() => { window.__said.length = 0; });
  await P.page.keyboard.press('Backquote');
  await P.page.waitForTimeout(300);
  const key = await P.page.evaluate(() => ({ said: window.__said.map((q) => q.t), cmd: exam.route[exam.stage].cmd }));
  await P.page.evaluate(() => { window.__said.length = 0; });
  const btn = await P.page.$('#coach .crep');
  if (btn) await btn.click();
  await P.page.waitForTimeout(300);
  const click = await P.page.evaluate(() => window.__said.map((q) => q.t));
  await P.page.evaluate(() => { opt.sound = false; window.__said.length = 0; });
  await P.page.keyboard.press('Backquote');
  await P.page.waitForTimeout(200);
  const off = await P.page.evaluate(() => ({ n: window.__said.length, note: typeof note === 'string' ? note : '' }));
  const cmdSp = key.cmd.replace(/[«»—–·]/g, '').split(/\s+/).filter((w) => w.length > 4)[0] || '';
  check('повтор команды: Ё и кнопка на карточке говорят текущую команду, без звука — подсказка (@exam-voice-repeat)',
    key.said.length >= 1 && key.said.some((t) => t.indexOf(cmdSp) >= 0) && !!btn && click.length >= 1 && off.n === 0 && /звук/.test(off.note),
    'Ё: ' + JSON.stringify(key.said) + '; кнопка ' + (btn ? JSON.stringify(click) : 'нет') + '; без звука ' + off.n + ' «' + off.note + '»');
  await exitPage(P);
}

/* 6. Карточка урока звучит тем же текстом, что на экране, без скобок и кавычек; первая — после выдержки */
{
  const P = await openPage({});
  const r = await P.page.evaluate(async () => {
    opt.sound = true; opt.voice = true;
    openLevel(0, 'pick'); hideOv(); paused = false; window.__said.length = 0;
    await new Promise((res) => setTimeout(res, 1500));
    const cm = document.querySelector('#coach .cm'), shown = cm ? cm.textContent : '';
    return { said: window.__said.map((q) => q.t), shown, expect: speechText(shown) };
  });
  check('подсказка карточки урока звучит тем же текстом без клавиш в скобках и кавычек (@app-voice-card)',
    r.said.length >= 1 && r.said.indexOf(r.expect) >= 0 && r.said.every((t) => !/[()«»]/.test(t)),
    'на карточке «' + r.shown + '», вслух ' + JSON.stringify(r.said));
  await exitPage(P);
}

/* 7. Текст для речи: единицы словами, клавиши и кавычки убраны, буквы селектора названы */
{
  const P = await openPage({});
  const r = await P.page.evaluate(() => {
    const cases = [
      ['Назад с прямым рулём до 0,1 м', 'Назад с прямым рулём до 0,1 метра'],
      ['Полный ЛЕВЫЙ: от 45° к нулю', 'Полный левый: от 45 градусов к нулю'],
      ['Сними ручник (J) — машина душится', 'Сними ручник, машина душится'],
      ['Включи R и трогайся крипом', 'Включи задний ход и трогайся крипом'],
      ['К главной под знаком «уступи»', 'К главной под знаком уступи'],
      ['Крипом к конусу — стоп в 30 см', 'Крипом к конусу, стоп в 30 сантиметров'],
      ['Через 21 м — налево на Заводскую', 'Через 21 метр, налево на Заводску́ю'],
      ['P · зажми тормоз (пробел) и включи передачу (Enter).', 'паркинг, зажми тормоз и включи передачу.'],
    ];
    return cases.map(([a, b]) => ({ a, b, got: speechText(a) })).filter((x) => x.got !== x.b);
  });
  check('текст для речи: метры и градусы словами, без клавиш и кавычек, буквы селектора названы (@app-voice-speech-text)',
    r.length === 0, r.map((x) => '«' + x.a + '» → «' + x.got + '»').join('; '));
  await exitPage(P);
}

/* 8. Пропущенная команда: инспектор говорит, что маршрут меняется, и даёт новую команду */
{
  const P = await openPage({ sync: true });
  const r = await P.page.evaluate(() => {
    opt.sound = true; opt.voice = true; window.__said.length = 0;
    const x = examDrive(1007, { misbehave: 'skipturn', maxT: 300 });
    return { missed: x.log.some((l) => /^missed/.test(l)), said: window.__said.map((q) => q.t).filter((t) => /Маршрут меняется/.test(t)) };
  });
  check('пропущена команда — голос: «Маршрут меняется» и новая команда (@exam-voice-reroute)',
    r.missed && r.said.length >= 1 && r.said.every((t) => t.length > 'Маршрут меняется. '.length), JSON.stringify(r.said.slice(0, 2)));
  await exitPage(P);
}

/* 9. Нет русского голоса или нет синтеза вовсе: молчание, один warn, повтор объясняет, ошибок нет */
{
  const P = await openPage({ sync: true, novoice: true });
  const r = await P.page.evaluate(() => {
    opt.sound = true; opt.voice = true; examDrive(1007, { maxT: 60 });
    const n = window.__said.length; voiceRepeat();
    return { n, note: typeof note === 'string' ? note : '' };
  });
  const Q = await openPage({ sync: true, noss: true });
  const q = await Q.page.evaluate(() => {
    opt.sound = true; opt.voice = true; const x = examDrive(1007, { maxT: 60 }); voiceRepeat();
    return { t: x.t, note: typeof note === 'string' ? note : '' };
  });
  check('без русского голоса и без синтеза — тишина, один warn, повтор объясняет, без исключений (@app-voice-no-voice)',
    r.n === 0 && P.warns.length === 1 && /голос/.test(r.note) && !Q.errors.length && q.t > 0 && /голос/.test(q.note),
    'фраз ' + r.n + ', warn ' + P.warns.length + ', «' + r.note + '»; без синтеза: ' + (Q.errors[0] || 'ок') + ' «' + q.note + '»');
  await exitPage(P); await exitPage(Q);
}

await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(JSON.stringify({ total: results.length, failed: failed.length, fault: FAULT, names: failed.map((x) => x.name) }));
process.exit(failed.length ? 1 : 0);
