/* Синтетическая проверка детекторов нарушений на экзамене (уровень 32). В консоли страницы:
     examCheck()   // печатает PASS/FAIL по пяти сценариям и возвращает подробности
   Машину ведём setBody по траектории и на каждом шаге зовём violationsTick — как в кадре, но без
   физики, поэтому проверка занимает секунду. Появилась после бага, когда фильтр курса зоны
   поворота срабатывал внутри зоны и «без поворотника» не стоил ни балла (патч 2026-09-05-11.55). */
function examCheck(){
  const R=4;
  const run=(blink, path)=>{
    loadLevel(31); hideOv(); car.blink=blink;
    for(const [u,v,th] of path){ setBody(u,v,th); car.vel=1.5; violationsTick(1/60); }
    return {score:exam.score, log:exam.log.map(e=>e.code)};
  };
  /* правый поворот на регулируемом кресте Ленина × Садовая (зона у 0,−70): вход с юга */
  const rightTurn=[];
  for(let v=-90; v<-76; v+=0.35) rightTurn.push([8.15,v,0]);
  for(let a=0;a<=90;a+=3){ const t=rad(a);
    rightTurn.push([8.15+R-R*Math.cos(t), -76+R*Math.sin(t), t]); }
  for(let u=8.15+R+0.35; u<20; u+=0.35) rightTurn.push([u, -76+R, rad(90)]);
  const straight=[];
  for(let v=-90; v<-58; v+=0.35) straight.push([8.15,v,0]);
  /* разворот на трамвайных путях (зона у 0,−35): вход с юга по полотну */
  const uturn=[];
  for(let v=-48; v<-40; v+=0.35) uturn.push([1.6,v,0]);
  for(let a=0;a<=180;a+=3){ const t=rad(a);
    uturn.push([1.6-R*(1-Math.cos(t)), -40+R*Math.sin(t), -t]); }
  for(let v=-40; v>-50; v-=0.35) uturn.push([1.6-2*R, v, rad(180)]);
  const cases=[
    ['правый поворот без поворотника', null, rightTurn, 1],
    ['правый поворот с поворотником',  'R',  rightTurn, 0],
    ['прямо без поворотника',          null, straight,  0],
    ['разворот без поворотника',       null, uturn,     1],
    ['разворот с поворотником',        'L',  uturn,     0],
  ];
  const out=cases.map(([name, blink, path, want])=>{
    const r=run(blink, path);
    const ok=r.score===want;
    console.log((ok?'PASS':'FAIL')+' · '+name+' → '+r.score+' (ожидали '+want+') '+r.log.join(','));
    return {name, ok, got:r.score, want, log:r.log};
  });
  loadLevel(0);
  console.log(out.every(c=>c.ok) ? 'examCheck: всё зелено' : 'examCheck: есть FAIL');
  return out;
}

/* Синтетическая проверка городских детекторов на собственной площадке (светофор, сплошная,
   перестроение, разворот с трамвайных путей, знак STOP). В консоли страницы:
     detectorCheck()
   Площадка строится здесь, а не берётся с уровня: проверка не должна зависеть от того,
   какую геометрию сегодня носит уровень, — иначе правка карты молча ломает тест. */
function detFixture(){
  loadLevel(0); hideOv();
  const dec=[], city={stoplines:[],zebras:[],oncoming:[],turnZones:[],yieldZones:[],
                      lanes:[],trams:[],rounds:[],lights:[]};
  const L=trafficLight(4.5, 18, rad(180), 'NS', 0);
  const sl=stoplineDec(dec, 0, 18, 0, 6.6); sl.light=L; city.stoplines.push(sl);
  const st=stoplineDec(dec, 0, -30, 0, 6.6); st.stop=true; city.stoplines.push(st);
  city.lanes.push(roadDec2(dec,  0, 0, 0, 120, {lanes:2, solid:'center'}));
  city.lanes.push(roadDec2(dec, 20, 0, 0, 120, {lanes:2}));
  city.lanes.push(roadDec2(dec, 40, 0, 0,  80, {lanes:1, tram:true}));
  city.trams.push({kind:'tram', u:40, v:0, yaw:0, len:80, hw:TRAM_HW});
  city.turnZones.push({u:40, v:0, yaw:0, w:18, l:9, uturn:true});
  city.oncoming.push({u:-60, v:0, yaw:0, w:6.6, l:60});
  city.zebras.push(zebraDec(dec, 0, 50, 0, 6.6));
  city.yieldZones.push({u:-20, v:0, yaw:0, w:6.6, l:8, dist:12});
  const act=actorCar(-20, 8, 180, PALETTE[1], [{u:-20,v:-20}], 2.0, null);
  act.hw=act.w/2; act.hl=act.l/2;
  level.dec=dec; level.city=city; level.actors=[act]; level.obs=[act]; level.rend=[];
  level.bounds={u0:-40,u1:80,v0:-80,v1:80};
  decBounds(dec); cityReset(); game.t=0; car.blink=null;
}
function detectorCheck(){
  const run=(setup, path)=>{
    detFixture(); if(setup) setup();
    for(const st of path){ setBody(st[0],st[1],st[2]); car.vel=(st[3]!==undefined?st[3]:2);
                           violationsTick(1/60); }
    return vioEvents.map(e=>e.code);
  };
  const line=(u0,v0,u1,v1,th,n,vel)=>{ const p=[];
    for(let i=0;i<=n;i++){ const k=i/n; p.push([u0+(u1-u0)*k, v0+(v1-v0)*k, th, vel]); } return p; };
  /* разворот: вход с юга по полосе x, дуга 180° внутри зоны, выход на юг */
  const uturn=(x)=>{ const p=[], R=4;
    p.push(...line(40+x,-9, 40+x,-4, 0, 12));
    for(let a=0;a<=180;a+=6){ const t=rad(a);
      p.push([40+x-R*(1-Math.cos(t)), -4+R*Math.sin(t), -t, 1.5]); }
    p.push(...line(40+x-2*R, -4, 40+x-2*R, -10, rad(180), 12));
    return p; };
  const cases=[
    ['красный: проезд стоп-линии',   ()=>{ game.t=15; }, line(1.65,12, 1.65,24, 0, 40), ['redlight'], []],
    ['зелёный: проезд стоп-линии',   ()=>{ game.t=2;  }, line(1.65,12, 1.65,24, 0, 40), [], ['redlight','stopline']],
    ['знак STOP без остановки',      null, line(1.65,-36, 1.65,-24, 0, 40), ['stop-sign'], []],
    ['стоп-линия позади: молчит',    null, line(1.65,-20, 1.65,-8,  0, 40), [], ['stop-sign','stopline']],
    ['пересечение сплошной',         null, line(1.65,0, -1.65,0, 0, 24), ['solid-line'], []],
    ['перестроение без поворотника', null, line(21.65,0, 24.95,0, 0, 24), ['lane-blinker'], []],
    ['перестроение с поворотником',  ()=>{ car.blink='R'; }, line(21.65,0, 24.95,0, 0, 24), [], ['lane-blinker']],
    ['разворот не с путей',          null, uturn(4.8), ['tram-turn'], []],
    ['разворот с путей',             null, uturn(1.6), [], ['tram-turn']],
    ['выезд на встречную',           null, line(-58,-10, -58,10, 0, 24), ['oncoming'], []],
    ['своя полоса после разворота',  null, line(-58,10, -58,-10, rad(180), 24), [], ['oncoming']],
    ['стоянка на зебре',             null, line(0,50, 0,50, 0, 90, 0), ['zebra'], []],
    ['проезд зебры без остановки',   null, line(0,46, 0,55, 0, 30), [], ['zebra']],
    ['не уступил помехе',            null, line(-20,-6, -20,3, 0, 24), ['yield'], []],
    ['наезд на участника',           ()=>{ level.actors[0]._hitByPlayer=true; },
                                     line(0,-6, 0,-4, 0, 6), ['collision-actor'], []],
  ];
  const out=cases.map(([name, setup, path, want, forbid])=>{
    const got=run(setup, path);
    const miss=want.filter(c=>got.indexOf(c)<0);
    const bad =forbid.filter(c=>got.indexOf(c)>=0);
    const ok=!miss.length && !bad.length;
    console.log((ok?'PASS':'FAIL')+' · '+name+' → ['+got.join(',')+']'
      +(miss.length?' нет: '+miss.join(','):'')+(bad.length?' лишнее: '+bad.join(','):''));
    return {name, ok, got, miss, bad};
  });
  loadLevel(0);
  console.log(out.every(c=>c.ok) ? 'detectorCheck: всё зелено' : 'detectorCheck: есть FAIL');
  return out;
}

/* Проходимость экзаменационных маршрутов: машину ведём телепортом по ломаной через точки
   at этапов и на каждом шаге зовём examTick. Проверка отвечает на два вопроса, которые
   стоили правок: не срабатывает ли этап МГНОВЕННО (условие истинно уже на входе) и
   доходит ли маршрут до конца вообще. В консоли страницы:  routeCheck()  */
function routeCheck(runs){
  const N=runs||6, out=[];
  for(let r=0;r<N;r++){
    loadLevel(31); hideOv();
    const route=exam.route, pts=[];
    const c0=bodyPos(); pts.push({u:c0.u, v:c0.v});
    for(const st of route) if(st.at) pts.push({u:st.at.u, v:st.at.v});
    /* после последней точки ещё немного вперёд: финишный этап требует стоянки В кармане */
    let stuck=null, instant=[], prev=0, dist=0;
    for(let i=1;i<pts.length && exam.stage<route.length;i++){
      const a=pts[i-1], b=pts[i];
      const d=Math.hypot(b.u-a.u, b.v-a.v), n=Math.max(2,Math.ceil(d/0.5));
      dist+=d;
      const th=Math.atan2(b.u-a.u, b.v-a.v);
      for(let k=1;k<=n && exam.stage<route.length;k++){
        setBody(a.u+(b.u-a.u)*k/n, a.v+(b.v-a.v)*k/n, th);
        car.vel=2; car.blink=null; car.gear=1; phaseTick(1/60); examTick();
        if(exam.stage!==prev){ if(k<=2 && i>1) instant.push(prev); prev=exam.stage; }
      }
      /* в каждой точке дважды повторяем «постоял — тронулся»: этап остановки по требованию
         засчитывается только парой (полная остановка, затем движение), и одного цикла мало,
         когда предыдущий этап закрылся уже внутри этой же точки */
      for(let rep=0; rep<2 && exam.stage<route.length; rep++){
        for(let k=0;k<140;k++){ car.vel=0; phaseTick(1/60); examTick(); }
        for(let k=0;k<8;k++){ car.vel=2; phaseTick(1/60); examTick(); }
      }
      prev=exam.stage;
    }
    if(exam.stage<route.length) stuck=exam.stage;
    out.push({run:r, n:route.length, done:exam.stage, dist:Math.round(dist),
              stuck, instant, cmd: stuck!==null ? route[stuck].cmd : ''});
    console.log((stuck===null?'PASS':'FAIL')+' · маршрут '+r+': этапов '+route.length
      +', пройдено '+exam.stage+', длина '+Math.round(dist)+' м'
      +(stuck!==null?' · застрял на «'+route[stuck].cmd+'»':'')
      +(instant.length?' · мгновенные этапы: '+instant.join(','):''));
  }
  loadLevel(0);
  console.log(out.every(o=>o.stuck===null) ? 'routeCheck: всё зелено' : 'routeCheck: есть FAIL');
  return out;
}
