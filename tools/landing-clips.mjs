#!/usr/bin/env node
/* Короткие ролики настоящей игры для лендинга: показ уровня пишется в headless-браузере,
   затем режется и жмётся в mp4 (h264, без звука) плюс постер webp. VP9-дорожка не нужна:
   на этом материале webm выходит вдвое тяжелее h264, а h264 играют все браузеры.
   Зависимости: playwright-core в PW_DIR (как у cockpit-shots) и ffmpeg в PATH.
     PW_DIR=/tmp/pw node tools/landing-clips.mjs
   Выход: landing/public/clips/<имя>.{mp4,webp}. Бюджет — 300 КБ на ролик:
   страница грузит их лениво, но лендинг обязан открываться на телефоне в поле. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const OUT = path.join(ROOT, 'landing', 'public', 'clips');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-'));
/* пишем в десктопном окне, а жмём в половинное: на 960 px HUD сваливается в узкую
   раскладку и панели налезают друг на друга */
const RW = 1280, RH = 800, W = 960, H = 600;

/* pre — сколько показа прокрутить до начала ролика, dur — длина ролика */
const CLIPS = [
  { name: 'mirrors', level: 0,  cam: 'fp',    refs: 1, pre: 11, dur: 9 },
  { name: 'city',    level: 29, cam: 'chase', refs: 1, pre: 13, dur: 10 },
];

function findChrome() {
  if (process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const d of dirs.reverse()) {
    const base = path.join(cache, d);
    for (const sub of fs.readdirSync(base)) {
      const bin = path.join(base, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  }
  console.error('Chromium не найден: задай PW_CHROME='); process.exit(2);
}
const { chromium } = createRequire(path.join(PW_DIR, 'package.json'))('playwright-core');
const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);

fs.mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.join(ROOT, 'index.html') + '?nocache=' + Date.now();
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const report = [];

for (const c of CLIPS) {
  const dir = path.join(TMP, c.name);
  const context = await browser.newContext({
    viewport: { width: RW, height: RH }, deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: RW, height: RH } },
  });
  const page = await context.newPage();
  page.on('pageerror', e => { if (!/ServiceWorker/.test(e.message)) console.error('PAGEERR', e.message); });
  await page.goto(url);
  await page.evaluate(() => {
    for (const k of ['trainer_seen', 'trainer_hint', 'trainer_drive']) localStorage.setItem(k, '1');
    localStorage.setItem('trainer_runs', '9'); localStorage.setItem('trainer_touch', '0');
  });
  await page.goto(url + 'r');
  await page.waitForTimeout(500);
  const t0 = Date.now();
  await page.evaluate((o) => {
    hideOv(); loadLevel(o.level);
    opt.refs = o.refs; opt.marks = true; opt.mirrors = true; opt.gfx = 'max';
    if (o.cam === 'fp' && opt.camMode !== CAM_FP) pressKey('KeyV');
    if (o.cam === 'chase' && opt.camMode === CAM_FP) pressKey('KeyV');
    if (o.cam === 'chase') { opt.pitch = rad(26); opt.dist = 10.5; }
    doAct('start');
    /* служебное в продуктовом кадре — мусор: полоса горячих клавиш, карточка задания,
       плавающие кнопки «заново/демонстрация/написать» */
    /* прячем стилем, а не remove(): updateHUD каждый кадр пишет в эти узлы */
    const st = document.createElement('style');
    st.textContent = '#hint,#thelp,#topleft,#restartBtn,#demoBtn,#fbBtn{display:none!important}';
    document.head.appendChild(st);
    /* карточка показа несёт служебное «Демо 3/7 · любая кнопка прерывает» — на странице
       это читается как отладка. Оставляем только фразу инструктора из сегмента */
    const cc = coachCard;
    coachCard = function (kind, icon, main, goal, ph) {
      if (kind === 'demo' && demo) {
        const dd = DEMOS[game.li], sg = dd.segs[Math.min(demo.i, dd.segs.length - 1)];
        const t = (sg && sg.say) || (curPhase && (curPhase.act || curPhase.hint)) || '';
        return cc('act', '▶', t);
      }
      return cc(kind, icon, main, goal, ph);
    };
    startDemo();
  }, c);
  await page.waitForTimeout((c.pre + c.dur) * 1000 + 700);
  const lead = (Date.now() - t0) / 1000 - (c.pre + c.dur) - 0.7;   /* задержка старта записи */
  await context.close();
  const raw = fs.readdirSync(dir).map(f => path.join(dir, f)).find(f => f.endsWith('.webm'));
  if (!raw) { console.error('запись не получилась: ' + c.name); continue; }

  const ss = String(Math.max(0, c.pre + lead + 0.5));
  const mp4 = path.join(OUT, c.name + '.mp4');
  const poster = path.join(OUT, c.name + '.webp');
  const vf = `fps=24,scale=${W}:${H}:flags=lanczos`;
  ff(['-ss', ss, '-t', String(c.dur), '-i', raw, '-an', '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '31', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', mp4]);
  /* у ffmpeg из homebrew нет кодека webp — постер снимаем в png и жмём cwebp */
  const png = path.join(TMP, c.name + '-poster.png');
  ff(['-ss', ss, '-i', raw, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=lanczos`, png]);
  execFileSync('cwebp', ['-quiet', '-q', '72', png, '-o', poster]);
  const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' КБ';
  report.push(`${c.name}: mp4 ${kb(mp4)} · постер ${kb(poster)}`);
}
await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(report.join('\n'));
