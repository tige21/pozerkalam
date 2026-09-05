/* Синтетическая проверка детекторов нарушений на экзамене (уровень 27). В консоли страницы:
     examCheck()   // печатает PASS/FAIL по пяти сценариям и возвращает подробности
   Машину ведём setBody по траектории и на каждом шаге зовём violationsTick — как в кадре, но без
   физики, поэтому проверка занимает секунду. Появилась после бага, когда фильтр курса зоны
   поворота срабатывал внутри зоны и «без поворотника» не стоил ни балла (патч 2026-09-05-11.55). */
function examCheck(){
  const R=4;
  const run=(blink, path)=>{
    loadLevel(26); hideOv(); car.blink=blink;
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
