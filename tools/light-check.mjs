#!/usr/bin/env node
/* Регрессия светофора: горит ли КАЖДАЯ линза там, где по фазе обязана. Проверяем не «есть
   красный где-то в кадре», а сам пиксель в центре линзы — иначе дефект порядка отрисовки
   маскируется соседними красными объектами города.
   Инвариант — вид chase: там кабина не мешает, и линза, закрытая в нём, это дефект геометрии.
   В салоне закрытая линза делится по лучу «глаз → линза»: вне проёма лобового (WSHIELD) или
   за корпусом салонного зеркала (CMIR) — честно, как в жизни; в проёме и не горит — дефект.
   И отдельно: с бампером на стоп-линии сигнал (основной или дублёр) обязан быть виден.
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
  const L=level.city.lights[0], SL=level.city.stoplines.find(s=>s.light===L);
  const cv=document.querySelector('canvas'), ctx2=cv.getContext('2d');
  const ON={ R:[238,58,52], Y:[244,190,52], G:[70,214,110] };
  /* высоты линз и вынос — те же выражения, что в emitTrafficLight */
  const LY={ R:LIGHT_H-0.16, Y:LIGHT_H-0.45, G:LIGHT_H-0.74 };
  const proj=(P)=>{ const d={x:P.x-viewCam.pos.x,y:P.y-viewCam.pos.y,z:P.z-viewCam.pos.z};
    const dep=d.x*viewCam.f.x+d.y*viewCam.f.y+d.z*viewCam.f.z; if(dep<=0.1) return null;
    return { x:viewCam.cx+(d.x*viewCam.r.x+d.y*viewCam.r.y+d.z*viewCam.r.z)/dep*viewCam.scale,
             y:viewCam.cy-(d.x*viewCam.u.x+d.y*viewCam.u.y+d.z*viewCam.u.z)/dep*viewCam.scale }; };
  /* луч «глаз → линза» в системе кузова: проходит ли через проём лобового (WSHIELD) и не упирается
     ли в корпус салонного зеркала (CMIR) — оба заданы в index.html рядом с emitDash. Линза вне
     проёма или за зеркалом закрыта честно, как в живой машине; в проёме и не горит — дефект */
  const inCabin=(Lo,y)=>{
    const b=bodyPos(), fu=fuv(car.th), ru=ruv(car.th), f=fuv(Lo.yaw);
    const du=Lo.u+f.u*0.15-b.u, dv=Lo.v+f.v*0.15-b.v;
    const T={lat:du*ru.u+dv*ru.v, y, z:du*fu.u+dv*fu.v}, E=EYE;
    const A=WSHIELD[0], B=WSHIELD[1], C=WSHIELD[3];
    const e1=[B[0]-A[0],B[1]-A[1],B[2]-A[2]], e2=[C[0]-A[0],C[1]-A[1],C[2]-A[2]];
    const n=[e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    const dir=[T.lat-E.lat, T.y-E.y, T.z-E.z];
    const den=n[0]*dir[0]+n[1]*dir[1]+n[2]*dir[2];
    let glass=false;
    if(Math.abs(den)>1e-9){ const t=(n[0]*(A[0]-E.lat)+n[1]*(A[1]-E.y)+n[2]*(A[2]-E.z))/den;
      const P=[E.lat+dir[0]*t, E.y+dir[1]*t, E.z+dir[2]*t];
      glass = t>0 && t<1 && Math.abs(P[0])<=0.74 && P[1]>=1.00 && P[1]<=1.36; }
    let tmin=0, tmax=1; const lo=[CMIR.lat-CMIR.w, CMIR.y-CMIR.h, CMIR.z-CMIR.d], hi=[CMIR.lat+CMIR.w, CMIR.y+CMIR.h, CMIR.z+CMIR.d];
    const o=[E.lat,E.y,E.z];
    for(let k=0;k<3;k++){ if(Math.abs(dir[k])<1e-12){ if(o[k]<lo[k]||o[k]>hi[k]){ tmin=2; break; } continue; }
      let a=(lo[k]-o[k])/dir[k], c=(hi[k]-o[k])/dir[k]; if(a>c){ const q=a; a=c; c=q; }
      tmin=Math.max(tmin,a); tmax=Math.min(tmax,c); }
    return { glass, mirror: tmin<=tmax };
  };
  const phaseAt=(ph)=>{ for(let t=0;t<24;t+=0.25){ const s=game.t; game.t=t; const p=lightPhase(L); game.t=s; if(p===ph){ game.t=t+0.5; return; } } };
  const lens=(Lo,ph)=>{
    const f=fuv(Lo.yaw), p=proj({ x:-(Lo.u+f.u*0.15), y:LY[ph], z:Lo.v+f.v*0.15 });
    if(!p) return { off:'за камерой' };
    const dpr=cv.width/cv.clientWidth, X=Math.round(p.x*dpr), Y=Math.round(p.y*dpr);
    if(X<0||Y<0||X>=cv.width||Y>=cv.height) return { off:'вне кадра' };
    const d=ctx2.getImageData(X,Y,1,1).data, c=ON[ph];
    const r={ y:Math.round(p.y), rgb:`${d[0]},${d[1]},${d[2]}`,
              lit: Math.abs(d[0]-c[0])<30 && Math.abs(d[1]-c[1])<30 && Math.abs(d[2]-c[2])<30 };
    if(!r.lit && opt.camMode===CAM_FP){ const k=inCabin(Lo, LY[ph]);
      r.honest = !k.glass ? 'крыша/стойка' : (k.mirror ? 'зеркало' : ''); }
    return r;
  };
  const out=[];
  for(const [mode,label] of [[CAM_CHASE,'chase'],[CAM_FP,'салон']]){
    opt.camMode=mode;
    for(const dist of DISTS){ const row={label,dist};
      for(const ph of ['R','Y','G']){ setBody(8.15, L.v-dist, 0); car.vel=0; car.steer=0; phaseAt(ph); render(0.016); row[ph]=lens(L,ph); }
      out.push(row); }
  }
  /* на стоп-линии, бампер на линии: хоть одна линия сигнала — основной светофор или дублёр —
     обязана гореть из салона, иначе ученик стоит на красный вслепую и не видит зелёного */
  opt.camMode=CAM_FP;
  const stop={label:'стоп-линия', dist:+(L.v-(SL.v-HALF_L)).toFixed(1)};
  for(const ph of ['R','Y','G']){ setBody(8.15, SL.v-HALF_L, 0); car.vel=0; car.steer=0; phaseAt(ph); render(0.016);
    const m=lens(L,ph), r=L.repeater ? lens(L.repeater,ph) : {off:'дублёра нет'};
    stop[ph]={ main:m, rep:r, lit: !!(m.lit || r.lit) }; }
  out.push(stop);
  return out;
}, DISTS);

const cell=(r)=> r.off ? r.off.padStart(12) : (r.lit ? 'горит'.padStart(12)
  : (r.honest ? ('честно: '+r.honest).padStart(12) : ('закрыт '+r.rgb).padStart(12)));
let chaseBad=0, cabinBad=0, stopBad=0;
console.log('камера      дист(м)   красный      жёлтый      зелёный');
for(const r of res){
  if(r.label==='стоп-линия'){
    const c=(x)=>(x.lit?'видно':'НЕ ВИДНО').padStart(9)+' (осн. '+(x.main.lit?'горит':(x.main.honest||x.main.off||'закрыт'))+', дублёр '+(x.rep.lit?'горит':(x.rep.honest||x.rep.off||'закрыт'))+')';
    for(const ph of ['R','Y','G']) if(!r[ph].lit) stopBad++;
    console.log(`стоп-линия ${String(r.dist).padStart(6)}  ${c(r.R)}\n                    ${c(r.Y)}\n                    ${c(r.G)}`);
    continue;
  }
  for(const ph of ['R','Y','G']){ const x=r[ph];
    if(x.off || x.lit) continue;
    if(r.label==='chase') chaseBad++; else if(!x.honest) cabinBad++; }
  console.log(`${r.label.padEnd(10)} ${String(r.dist).padStart(6)}  ${cell(r.R)} ${cell(r.Y)} ${cell(r.G)}`);
}
for(const e of errs) console.error('PAGEERR', e);
const line=(ok,txt)=>console.log((ok?'OK   ':'ПРОВАЛ ')+txt);
console.log('');
line(!chaseBad, 'из-за машины все линзы горят на всех дистанциях (@city-light-lens-chase)' + (chaseBad?' — закрыто '+chaseBad:''));
line(!cabinBad, 'из салона закрыты только честно — крышей, стойкой, зеркалом (@city-light-lens-cabin)' + (cabinBad?' — дефектов '+cabinBad:''));
line(!stopBad, 'с бампером на стоп-линии сигнал виден из салона (@city-light-stopline)' + (stopBad?' — не видно фаз '+stopBad:''));
await browser.close();
process.exit(chaseBad || cabinBad || stopBad || errs.length ? 1 : 0);
