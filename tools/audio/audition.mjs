#!/usr/bin/env node
/* Страница прослушки кандидатов звука для владельца (план sound-samples.md, Ф1).
   node tools/audio/audition.mjs <candidates.json> <out-dir>
   candidates.json: {synth:[{title,file}], cats:[{id,title,hint,fast?,rep?,items:[{file,src,author,lic,note,ss?,t?}]}]}
   Каждый кандидат приводится к одной громкости: на разной громкости громкий всегда кажется лучше,
   и выбор делался бы не по звуку. Длинные — по EBU R128 к −20 LUFS; короче 3 с интегральная
   громкость не меряется (стробирование выкидывает почти всё), их ведём по пику к −3 dBFS.
   rep — короткую петлю повторяем до rep секунд: двухсекундный отрывок мотора не дослушать,
   а щелчок на шве сразу говорит, что запись петлёй не встанет.
   fast — множитель скорости: мотор в игре идёт по оборотам, и запись, которая хороша на месте,
   может «бурундучить» на ×1,5; это надо слышать до выбора. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const [, , specPath, out] = process.argv;
if (!specPath || !out) { console.error('usage: audition.mjs <candidates.json> <out-dir>'); process.exit(2); }
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
mkdirSync(join(out, 'a'), { recursive: true });

const probe = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
const stderrOf = (args) => spawnSync('ffmpeg', ['-hide_banner', ...args, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;

function render(src, dst, { ss = 0, t = 8, up = 1, rep = 0 }) {
  const cut = Math.min(t, probe(src) - ss);
  const dur = rep > cut ? rep : cut;
  const len = dur / up;
  const tmp = dst.replace(/\.mp3$/, '.tmp.wav');
  const rate = up !== 1 ? `asetrate=44100*${up},aresample=44100,` : '';
  const loop = rep > cut ? `aloop=loop=-1:size=${Math.round(cut * 44100)},atrim=0:${rep},` : '';
  ff(['-ss', String(ss), '-t', String(cut), '-i', src, '-ac', '1', '-ar', '44100',
    '-af', `aresample=44100,${loop}${rate}afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, len - 0.15).toFixed(3)}:d=0.15`, tmp]);
  let gain;
  if (len >= 3) {
    const s = stderrOf(['-i', tmp, '-af', 'loudnorm=I=-20:TP=-2:print_format=json']);
    const j = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(s)[0]);
    gain = -20 - +j.input_i;
    const tp = +j.input_tp + gain;
    if (tp > -1) gain -= tp + 1;
  } else {
    const s = stderrOf(['-i', tmp, '-af', 'volumedetect']);
    gain = -3 - +(/max_volume: (-?[\d.]+)/.exec(s) || [0, 0])[1];
  }
  ff(['-i', tmp, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'libmp3lame', '-b:a', '128k', dst]);
  rmSync(tmp, { force: true });
  return +len.toFixed(1);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const comma = (x) => String(x).replace('.', ',');
const files = {};
let n = 0;
const synth = (spec.synth || []).map((s, i) => {
  const name = `a/synth-${i}.mp3`;
  render(s.file, join(out, name), { t: 12 });
  files[name] = join(out, name);
  return { ...s, name };
});
const cats = spec.cats.map((c) => ({
  ...c,
  items: c.items.filter((it) => existsSync(it.file)).map((it, k) => {
    const name = `a/${c.id}-${k + 1}.mp3`;
    const d = render(it.file, join(out, name), { ...it, rep: c.rep });
    files[name] = join(out, name);
    n++;
    let fast = null;
    if (c.fast) {
      fast = `a/${c.id}-${k + 1}-x${c.fast}.mp3`;
      render(it.file, join(out, fast), { ...it, up: c.fast, rep: c.rep && c.rep * c.fast });
      files[fast] = join(out, fast);
    }
    console.log(`[audition] ${c.id}-${k + 1} ${basename(it.file)} ${d} с`);
    return { ...it, name, fast, d };
  }),
}));

const tile = (c, it, k) => `
<article class="cand">
  <label class="pick"><input type="radio" name="${c.id}" value="${k + 1}" id="${c.id}-${k + 1}"><span>${k + 1}</span></label>
  <div class="body">
    <audio controls preload="none" src="${it.name}"></audio>
    ${it.fast ? `<div class="fast"><span>так же на разгоне, ×${comma(c.fast)}</span><audio controls preload="none" src="${it.fast}"></audio></div>` : ''}
    <p class="note">${esc(it.note)}</p>
    <p class="src"><a href="${esc(it.src)}" target="_blank" rel="noopener">${esc(it.author)}</a> · ${esc(it.lic)} · ${comma(it.d)} с</p>
  </div>
</article>`;

const html = `<title>Звуки тренажёра</title>
<style>
/* одна колонка групп; в группе — кандидаты под номерами, выбор кружком слева, внизу — строка выбора */
:root{--bg:#f3f4f1;--fg:#1d2321;--mute:#5d6863;--line:#d8dcd5;--card:#ffffff;--acc:#2f6f5a;--accfg:#ffffff;
--f-head:"Golos Text",system-ui,sans-serif;--f-body:"Golos Text",system-ui,sans-serif;--f-num:"JetBrains Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141816;--fg:#e6ebe7;--mute:#9aa59f;--line:#2b322e;--card:#1c211e;--acc:#6cc3a2;--accfg:#0c1411;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141816;--fg:#e6ebe7;--mute:#9aa59f;--line:#2b322e;--card:#1c211e;--acc:#6cc3a2;--accfg:#0c1411;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.5 var(--f-body)}
main{max-width:760px;margin:0 auto;padding-inline:16px;padding-block:28px 120px;display:grid;gap:30px}
h1{font:600 26px/1.2 var(--f-head);margin:0;text-wrap:balance}
h2{font:600 18px/1.3 var(--f-head);margin:0;text-wrap:balance}
.lead{color:var(--mute);margin:6px 0 0;max-width:62ch}
section{display:grid;gap:10px}
.hint{color:var(--mute);margin:0;font-size:14px;max-width:62ch}
.grid{display:grid;gap:10px}
.cand{display:grid;grid-template-columns:44px 1fr;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.body{min-width:0;display:grid;gap:6px}
audio{width:100%;height:36px}
.fast{display:grid;gap:2px}.fast span{font-size:12px;color:var(--mute)}
.note{margin:0}
.src{margin:0;font-size:12px;color:var(--mute);overflow-wrap:anywhere}
.src a{color:inherit}
.pick{display:grid;place-items:center;cursor:pointer;position:relative}
.pick input{position:absolute;opacity:0;width:1px;height:1px}
.pick span{width:34px;height:34px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;font:600 15px var(--f-num)}
.pick input:checked+span{background:var(--acc);border-color:var(--acc);color:var(--accfg)}
.pick input:focus-visible+span{outline:2px solid var(--acc);outline-offset:2px}
.none{font-size:13px;color:var(--mute);display:flex;gap:8px;align-items:center}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap}
.bar code{font:13px var(--f-num);color:var(--mute);min-width:0;overflow-wrap:anywhere}
.bar button{font:600 15px var(--f-body);background:var(--acc);color:var(--accfg);border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
.bar button:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600&family=JetBrains+Mono:wght@600&display=swap">
<main>
<header>
  <h1>Звуки тренажёра</h1>
  <p class="lead">Все записи под свободной лицензией CC0 и приведены к одной громкости. В каждой группе отметьте лучший вариант или «ни один», нажмите «Скопировать выбор» внизу и пришлите текст в чат.</p>
</header>
${synth.length ? `<section><h2>Сейчас в игре — синтез</h2><p class="hint">Для сравнения: так звучит текущая версия.</p><div class="grid">${synth.map((s) => `
<article class="cand"><span></span><div class="body"><audio controls preload="none" src="${s.name}"></audio><p class="note">${esc(s.title)}</p></div></article>`).join('')}</div></section>` : ''}
${cats.map((c) => `
<section>
  <h2>${esc(c.title)}</h2>
  ${c.hint ? `<p class="hint">${esc(c.hint)}</p>` : ''}
  <div class="grid">${c.items.map((it, k) => tile(c, it, k)).join('')}</div>
  <label class="none"><input type="radio" name="${c.id}" value="0" id="${c.id}-0"> ни один не подходит</label>
</section>`).join('')}
</main>
<div class="bar"><code id="sel">выбор пока пуст</code><button id="copy" type="button">Скопировать выбор</button></div>
<script>
const CATS=${JSON.stringify(cats.map((c) => ({ id: c.id, title: c.title })))};
const sel=document.getElementById('sel');
function text(){return CATS.map(c=>{const v=document.querySelector('input[name="'+c.id+'"]:checked');return v?c.title+': '+(v.value==='0'?'ни один':v.value):null}).filter(Boolean).join('; ')}
document.addEventListener('change',()=>{sel.textContent=text()||'выбор пока пуст'});
document.addEventListener('play',e=>{document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true);
document.getElementById('copy').addEventListener('click',()=>{const t=text();if(!t){sel.textContent='сначала отметьте варианты';return}
navigator.clipboard.writeText(t).then(()=>{sel.textContent='скопировано: '+t},()=>{sel.textContent=t;const r=document.createRange();r.selectNodeContents(sel);const s=getSelection();s.removeAllRanges();s.addRange(r)})});
</script>
`;
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, 'files.json'), JSON.stringify(files, null, 1));
console.log(`[audition] ${n} кандидатов, страница ${join(out, 'index.html')}`);
