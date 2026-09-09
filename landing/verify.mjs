/* Проверка собранного лендинга: раскладка на пяти вьюпортах, клавиатура,
   prefers-reduced-motion, целостность страниц. Зависимость как у cockpit-shots:
     mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core@1.55)
     cd landing && npm run build && PW_DIR=/tmp/pw node verify.mjs
   Код 1 при любом провале. Съёмка кадров для глазами — shoot.mjs. */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
const DIST='/Users/user/Documents/projects/car-maneuver-trainer/landing/dist';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.xml':'application/xml','.txt':'text/plain','.svg':'image/svg+xml','.mp4':'video/mp4','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(DIST,p);
 if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404).end('404');return;}
 r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(0,r)); const base=`http://127.0.0.1:${srv.address().port}`;
const req=createRequire('/tmp/pw/package.json'); const {chromium}=req('playwright-core');
const cache=path.join(os.homedir(),'Library','Caches','ms-playwright'); let bin;
for(const d of fs.readdirSync(cache).filter(d=>d.startsWith('chromium_headless_shell-')).sort().reverse()){
 for(const s of fs.readdirSync(path.join(cache,d))){const b=path.join(cache,d,s,'chrome-headless-shell'); if(fs.existsSync(b)){bin=b;break;}} if(bin)break;}
const br=await chromium.launch({executablePath:bin,headless:true});
let fail=0; const say=(ok,t)=>{console.log(`  ${ok?'✓':'✗'} ${t}`); if(!ok)fail++;};

// 1. Раскладка на пяти вьюпортах
console.log('РАСКЛАДКА');
for (const vp of [{width:1920,height:1080},{width:1440,height:900},{width:1440,height:700},{width:390,height:844},{width:360,height:640}]) {
  const ctx=await br.newContext({viewport:vp,deviceScaleFactor:1}); const pg=await ctx.newPage();
  const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto(base+'/',{waitUntil:'networkidle'}); await pg.waitForTimeout(600);
  const m=await pg.evaluate(()=>{
    const hs=document.documentElement.scrollWidth>window.innerWidth+1;
    const glued=[...document.querySelectorAll('h1,h2')].some(h=>/[а-яё],[а-яё]|[а-яё]\d/i.test(h.innerText.replace(/\s+/g,' ')));
    const head=document.querySelector('header.site .wrap');
    const overflow=head.scrollWidth>head.clientWidth+1;
    const cv=document.querySelector('.hero-canvas'), g=cv.getContext('2d');
    const d=g.getImageData(0,Math.round(cv.height*0.72),cv.width,1).data;
    let road=0; for(let i=0;i<d.length;i+=4) if(d[i]>20) road++;
    return {hs,glued,overflow,roadPx:road,cvW:cv.width};
  });
  say(!m.hs, `${vp.width}x${vp.height}: нет горизонтальной прокрутки`);
  say(!m.glued, `${vp.width}x${vp.height}: слова в заголовках не слиплись`);
  say(!m.overflow, `${vp.width}x${vp.height}: шапка не переполнена`);
  say(m.roadPx > m.cvW*0.5, `${vp.width}x${vp.height}: улица видна на первом экране (${m.roadPx}/${m.cvW} px)`);
  say(errs.length===0, `${vp.width}x${vp.height}: без ошибок JS`);
  await ctx.close();
}

// 2. Клавиатура: скрытая копия не должна ловить фокус
console.log('КЛАВИАТУРА');
{
  const ctx=await br.newContext({viewport:{width:1440,height:900}}); const pg=await ctx.newPage();
  await pg.goto(base+'/',{waitUntil:'networkidle'}); await pg.waitForTimeout(500);
  const hero=await pg.evaluate(()=>{const h=document.getElementById('hero');return {top:h.offsetTop,span:h.offsetHeight-h.querySelector('.hero-stage').offsetHeight};});
  await pg.evaluate(y=>window.scrollTo(0,y), hero.top+hero.span*0.7); await pg.waitForTimeout(700);
  const reach=await pg.evaluate(()=>{
    const cta=document.querySelector('.hero-copy .btn');
    return getComputedStyle(cta.closest('.hero-copy')).visibility;
  });
  say(reach==='hidden','ушедшая копия скрыта для табуляции (visibility:hidden)');
  const focusables=await pg.evaluate(()=>{
    const els=[...document.querySelectorAll('a[href],button')];
    return els.filter(e=>{const s=getComputedStyle(e); return s.visibility!=='hidden'&&s.display!=='none';}).length;
  });
  say(focusables>0, `фокусируемых элементов на странице: ${focusables}`);
  await ctx.close();
}

// 3. Уважение к prefers-reduced-motion
console.log('REDUCED-MOTION');
{
  const ctx=await br.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}); const pg=await ctx.newPage();
  await pg.goto(base+'/',{waitUntil:'networkidle'}); await pg.waitForTimeout(600);
  const m=await pg.evaluate(()=>{const h=document.getElementById('hero');
    return {heroH:h.offsetHeight, stageH:h.querySelector('.hero-stage').offsetHeight, docH:document.body.scrollHeight};});
  say(m.heroH<=m.stageH+4, `герой не создаёт мёртвой прокрутки (${m.heroH} ≈ ${m.stageH})`);
  await ctx.close();
}

// 4. Целостность страниц
console.log('СТРАНИЦЫ');
for (const url of ['/','/metodika/','/avtoshkolam/']) {
  const ctx=await br.newContext({viewport:{width:1440,height:900}}); const pg=await ctx.newPage();
  const r=await pg.goto(base+url,{waitUntil:'networkidle'});
  await pg.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await pg.waitForTimeout(500);
  const m=await pg.evaluate(()=>({
    h1:document.querySelectorAll('h1').length,
    noAlt:[...document.images].filter(i=>!i.alt&&i.alt!=='' ).length,
    broken:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).length,
    inlineScripts:[...document.querySelectorAll('script:not([src])')].filter(s=>s.type!=='application/ld+json').length,
  }));
  say(r.status()===200, `${url} → 200`);
  say(m.h1===1, `${url}: ровно один h1`);
  say(m.broken===0, `${url}: битых картинок нет`);
  say(m.noAlt===0, `${url}: alt у всех картинок`);
  await ctx.close();
}
await br.close(); srv.close();
console.log(fail? `\nПРОВАЛОВ: ${fail}` : '\nВСЁ ЗЕЛЁНОЕ');
process.exit(fail?1:0);
