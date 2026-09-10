#!/usr/bin/env node
/* Регрессия светофора: горит ли КАЖДАЯ линза там, где по фазе обязана. Проверяем не «есть
   красный где-то в кадре», а сам пиксель в центре линзы — иначе дефект порядка отрисовки
   маскируется соседними красными объектами города.
   Инвариант — вид chase: там кабина не мешает, и линза, закрытая в нём, это дефект геометрии.
   Салон печатается справочно: выше определённой высоты на экране светофор честно уходит
   за верхнюю кромку лобового, как в жизни.
   Запуск: PW_DIR=/tmp/pw node tools/light-check.mjs   (установка playwright-core — см. cockpit-shots.mjs) */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW_DIR = process.env.PW_DIR || '/tmp/pw';
const DISTS = [12, 10, 8, 7, 6, 5, 4.5, 4];

function loadPlaywright(){ try { return createRequire(path.join(PW_DIR,'package.json'))('playwright-core'); }
  catch { console.error(`playwright-core нет в ${PW_DIR}: mkdir -p ${PW_DIR} && (cd ${PW_DIR} && npm i playwright-core@1.55)`); process.exit(2); } }
function findChrome(){ if(process.env.PW_CHROME) return process.env.PW_CHROME;
  const cache=path.join(os.homedir(),'Library','Caches','ms-playwright');
  const dirs=fs.existsSync(cache)?fs.readdirSync(cache).filter(d=>d.startsWith('chromium_headless_shell-')).sort():[];
  for(const d of dirs.reverse()){ const base=path.join(cache,d);
    for(const sub of fs.readdirSync(base)){ const bin=path.join(base,sub,'chrome-headless-shell'); if(fs.existsSync(bin)) return bin; } }
  console.error('Chromium не найден: задай PW_CHROME='); process.exit(2); }

const { chromium } = loadPlaywright();
const url = 'file://' + path.join(ROOT,'index.html') + '?nocache=' + Date.now();
const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await (await browser.newContext({ viewport:{width:1280,height:720}, deviceScaleFactor:1 })).newPage();
const errs=[]; page.on('pageerror', e => { if(!/ServiceWorker/.test(e.message)) errs.push(e.message); });
await page.goto(url);
await page.evaluate(()=>{ for(const k of ['trainer_seen','trainer_hint','trainer_drive']) localStorage.setItem(k,'1');
  localStorage.setItem('trainer_runs','9'); localStorage.setItem('trainer_touch','0'); });
await page.goto(url+'r'); await page.waitForTimeout(400);

const res = await page.evaluate((DISTS)=>{
  loadLevel(26);
  opt.marks=false; opt.guides=false; opt.camYaw=0;
  const L=level.city.lights[0], f=fuv(L.yaw);
  const cv=document.querySelector('canvas'), ctx2=cv.getContext('2d');
  const ON={ R:[238,58,52], Y:[244,190,52], G:[70,214,110] };
  /* высоты линз и вынос — те же выражения, что в emitTrafficLight */
  const LY={ R:LIGHT_H-0.16, Y:LIGHT_H-0.45, G:LIGHT_H-0.74 };
  const proj=(P)=>{ const d={x:P.x-viewCam.pos.x,y:P.y-viewCam.pos.y,z:P.z-viewCam.pos.z};
    const dep=d.x*viewCam.f.x+d.y*viewCam.f.y+d.z*viewCam.f.z; if(dep<=0.1) return null;
    return { x:viewCam.cx+(d.x*viewCam.r.x+d.y*viewCam.r.y+d.z*viewCam.r.z)/dep*viewCam.scale,
             y:viewCam.cy-(d.x*viewCam.u.x+d.y*viewCam.u.y+d.z*viewCam.u.z)/dep*viewCam.scale }; };
  const shot=(dist,ph)=>{
    setBody(8.15, L.v-dist, 0); car.vel=0; car.steer=0;
    for(let t=0;t<24;t+=0.25){ const s=game.t; game.t=t; const p=lightPhase(L); game.t=s; if(p===ph){ game.t=t+0.5; break; } }
    render(0.016);
    const p=proj({ x:-(L.u+f.u*0.15), y:LY[ph], z:L.v+f.v*0.15 });
    if(!p) return { off:'за камерой' };
    const dpr=cv.width/cv.clientWidth, X=Math.round(p.x*dpr), Y=Math.round(p.y*dpr);
    if(X<0||Y<0||X>=cv.width||Y>=cv.height) return { off:'вне кадра' };
    const d=ctx2.getImageData(X,Y,1,1).data, c=ON[ph];
    return { y:Math.round(p.y), rgb:`${d[0]},${d[1]},${d[2]}`,
             lit: Math.abs(d[0]-c[0])<30 && Math.abs(d[1]-c[1])<30 && Math.abs(d[2]-c[2])<30 };
  };
  const out=[];
  for(const [mode,label] of [[CAM_CHASE,'chase'],[CAM_FP,'салон']]){
    opt.camMode=mode;
    for(const dist of DISTS){ const row={label,dist};
      for(const ph of ['R','Y','G']) row[ph]=shot(dist,ph);
      out.push(row); }
  }
  return out;
}, DISTS);

const cell=(r)=> r.off ? r.off.padStart(12) : (r.lit ? 'горит'.padStart(12) : ('закрыт '+r.rgb).padStart(12));
let bad=0;
console.log('камера  дист(м)   красный      жёлтый      зелёный');
for(const r of res){
  if(r.label==='chase') for(const ph of ['R','Y','G']) if(!r[ph].off && !r[ph].lit) bad++;
  console.log(`${r.label.padEnd(6)} ${String(r.dist).padStart(6)}  ${cell(r.R)} ${cell(r.Y)} ${cell(r.G)}`);
}
for(const e of errs) console.error('PAGEERR', e);
console.log(bad ? `\nв chase закрытых линз: ${bad} — дефект геометрии` : '\nchase: все линзы горят на всех дистанциях ✓');
await browser.close();
process.exit(bad || errs.length ? 1 : 0);
