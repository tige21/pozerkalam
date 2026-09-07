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
  const rightTurn=[];
  for(let v=4; v<9; v+=0.25) rightTurn.push([1.65,v,0]);
  for(let a=0;a<=90;a+=3){ const t=rad(a); rightTurn.push([1.65+R-R*Math.cos(t), 9+R*Math.sin(t), t]); }
  for(let u=1.65+R+0.25; u<10; u+=0.25) rightTurn.push([u, 9+R, rad(90)]);
  const straight=[];
  for(let v=4; v<22; v+=0.25) straight.push([1.65,v,0]);
  /* разворот на дальнем кресте (зона у u=38): вход с востока на курсе 90° */
  const uturn=[];
  for(let u=28; u<34; u+=0.25) uturn.push([u,13,rad(90)]);
  for(let a=0;a<=180;a+=3){ const t=rad(a); uturn.push([34+R*Math.sin(t), 13+R-R*Math.cos(t), rad(90)-t]); }
  for(let u=34; u>26; u-=0.25) uturn.push([u, 13+2*R, rad(-90)]);
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
  level.dec=dec; level.city=city; level.actors=[]; level.obs=[]; level.rend=[];
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
