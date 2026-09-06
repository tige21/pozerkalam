/* Аудит painter's algorithm: сколько пар граней нарисовано в неверном порядке. В консоли страницы:
     sortAudit()                // текущая камера, печатает [FIX:sort] по проходам
     sortAudit({yaws:[0,-90]})  // из салона: обходит углы головы (градусы) и сравнивает
   Пара считается ошибкой, если грань B нарисована ПОСЛЕ A, лежит целиком за плоскостью A
   (дальше от камеры), A целиком перед плоскостью B, и их экранные полигоны пересекаются (SAT).
   Считает только явные ошибки (зазор ≥3 см), поэтому соседние панели с общим ребром не шумят.
   Появился при разборе «текстуры из салона мигают при повороте головы» (патч 2026-09-05-16.xx). */
function sortAudit(o){
  o=o||{};
  const EPS=o.eps||0.03;
  const satOverlap=(P,Q)=>{
    const axes=[];
    for(const poly of [P,Q]) for(let i=0;i<poly.length;i++){
      const a=poly[i], b=poly[(i+1)%poly.length]; axes.push([-(b.y-a.y), b.x-a.x]); }
    for(const ax of axes){
      let p0=1e18,p1=-1e18,q0=1e18,q1=-1e18;
      for(const p of P){ const v=p.x*ax[0]+p.y*ax[1]; p0=Math.min(p0,v); p1=Math.max(p1,v); }
      for(const q of Q){ const v=q.x*ax[0]+q.y*ax[1]; q0=Math.min(q0,v); q1=Math.max(q1,v); }
      const L=Math.hypot(ax[0],ax[1])||1;
      if(p1<q0+2*L||q1<p0+2*L) return false; }
    return true; };
  const toWorld=(c)=>({ u:-(cam.pos.x+c.x*cam.r.x+c.y*cam.u.x+c.d*cam.f.x),
                        y:  cam.pos.y+c.x*cam.r.y+c.y*cam.u.y+c.d*cam.f.y,
                        v:  cam.pos.z+c.x*cam.r.z+c.y*cam.u.z+c.d*cam.f.z });
  const toBody=(w)=>{ const c=bodyPos(), f=fuv(car.th), r=ruv(car.th), du=w.u-c.u, dv=w.v-c.v;
    return [+(du*r.u+dv*r.v).toFixed(2), +w.y.toFixed(2), +(du*f.u+dv*f.v).toFixed(2)]; };
  const analyse=(list)=>{
    const fs=[];
    for(const f of list){
      const c=clipNear(f.cp); if(c.length<3) continue;
      const sp=c.map(toScreen);
      let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
      for(const s of sp){ x0=Math.min(x0,s.x); y0=Math.min(y0,s.y); x1=Math.max(x1,s.x); y1=Math.max(y1,s.y); }
      const X0=Math.max(x0,VP.x), Y0=Math.max(y0,VP.y), X1=Math.min(x1,VP.x+VP.w), Y1=Math.min(y1,VP.y+VP.h);
      if(X1<=X0||Y1<=Y0) continue;
      let nx=0,ny=0,nz=0, mx=0,my=0,md=0;
      for(let i=0;i<c.length;i++){ const a=c[i], b=c[(i+1)%c.length];
        nx+=(a.y-b.y)*(a.d+b.d); ny+=(a.d-b.d)*(a.x+b.x); nz+=(a.x-b.x)*(a.y+b.y);
        mx+=a.x; my+=a.y; md+=a.d; }
      const L=Math.hypot(nx,ny,nz)||1; nx/=L; ny/=L; nz/=L;
      let off=nx*c[0].x+ny*c[0].y+nz*c[0].d;
      if(off>0){ nx=-nx; ny=-ny; nz=-nz; off=-off; }
      fs.push({bb:[X0,Y0,X1,Y1], sp, n:[nx,ny,nz], off, c, d:f.d, tag:f.tag,
               mid:{x:mx/c.length,y:my/c.length,d:md/c.length}});
    }
    const errs=[]; let errArea=0;
    for(let i=0;i<fs.length;i++){ const A=fs[i];
      for(let j=i+1;j<fs.length;j++){ const B=fs[j];
        if(A.bb[2]<=B.bb[0]||B.bb[2]<=A.bb[0]||A.bb[3]<=B.bb[1]||B.bb[3]<=A.bb[1]) continue;
        let mx=-1e9; for(const q of B.c) mx=Math.max(mx, A.n[0]*q.x+A.n[1]*q.y+A.n[2]*q.d-A.off);
        if(mx>-EPS) continue;
        let mn=1e9; for(const q of A.c) mn=Math.min(mn, B.n[0]*q.x+B.n[1]*q.y+B.n[2]*q.d-B.off);
        if(mn<EPS) continue;
        if(!satOverlap(A.sp,B.sp)) continue;
        const ov=(Math.min(A.bb[2],B.bb[2])-Math.max(A.bb[0],B.bb[0]))*(Math.min(A.bb[3],B.bb[3])-Math.max(A.bb[1],B.bb[1]));
        errArea+=ov;
        errs.push({px:Math.round(ov), under:(A.tag||'')+' '+toBody(toWorld(A.mid)).join('/'), dA:+A.d.toFixed(2),
                   over:(B.tag||'')+' '+toBody(toWorld(B.mid)).join('/'), dB:+B.d.toFixed(2)});
      } }
    errs.sort((p,q)=>q.px-p.px);
    return {faces:fs.length, errors:errs.length, px:Math.round(errArea), top:errs.slice(0,o.top||5)};
  };
  /* камера и вьюпорт снимаются в момент flush: после render() в cam стоит последнее зеркало,
     и разбор основного вида шёл бы в его проекции и в его прямоугольнике */
  const snap=()=>{
    const orig=flushFaces, passes=[];
    flushFaces=function(){
      passes.push({main:VP.w===W, list:faces.slice().sort((p,q)=>q.d-p.d),
                   vp:Object.assign({},VP), cam:{pos:cam.pos,f:cam.f,r:cam.r,u:cam.u,scale:cam.scale}});
      orig(); };
    try{ render(0.016); } finally{ flushFaces=orig; }
    return passes.map(p=>{ Object.assign(cam,p.cam); Object.assign(VP,p.vp);
                           return Object.assign({main:p.main}, analyse(p.list)); });
  };
  const runs={};
  if(o.yaws){ const keep=opt.fpYaw;
    for(const y of o.yaws){ opt.fpYaw=rad(y); runs['yaw '+y]=snap(); }
    opt.fpYaw=keep; }
  else runs['текущая камера']=snap();
  for(const k in runs) for(const p of runs[k])
    console.log('[FIX:sort] '+k+' · '+(p.main?'основной вид':'зеркало')+': граней '+p.faces
      +', ошибок порядка '+p.errors+', площадь '+p.px+' px²', p.top);
  return runs;
}
