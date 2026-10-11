/* Быстрые утверждения по расчётному ядру. Живут в странице и не рисуют ни одного кадра:
   этот набор гоняется на КАЖДОМ мутанте, и его бюджет — секунды.
   Числа берутся из правил и из CAR, а не из текущего вывода: набор, списанный с
   реализации, проходит всегда и не убивает ни одного мутанта.
   В консоли страницы: unitCheck() */
function unitCheck() {
  const fails = [], done = [];
  let group = '';
  const g = (name) => { group = name; };
  const ok = (what, cond) => { if (cond) done.push(group + ' · ' + what);
    else fails.push(group + ' · ' + what); };
  const near = (what, got, want, tol) => {
    if (Math.abs(got - want) <= tol) done.push(group + ' · ' + what);
    else fails.push(group + ' · ' + what + ': ожидали ' + want + ' ±' + tol + ', получили ' + (+got.toFixed(4)));
  };

  g('геометрия поворота');
  const sw = sweep(CAR.maxSteer);
  near('радиус задней оси на упоре 3,84 м', sw.R, 3.84, 0.01);
  near('габаритный радиус 5,89 м', sw.out, 5.89, 0.01);
  near('разница габаритов', sw.corr, sw.out - sw.inn, 1e-9);
  near('диаметр разворота 11,8 м', sw.out * 2, 11.79, 0.02);
  near('колея внутреннего колеса 3,06 м', sw.R - CAR.track / 2, 3.06, 0.01);
  near('колея наружного колеса 4,62 м', sw.R + CAR.track / 2, 4.62, 0.01);
  ok('прямой руль — бесконечный радиус', sweep(0).R === Infinity);
  ok('прямой руль — нулевая разница габаритов', sweep(0).corr === 0);
  near('внутренний радиус 2,94 м', sw.inn, sw.R - HALF_W, 1e-9);
  near('разница габаритов 2,95 м', sw.corr, 2.952, 0.01);
  /* влево и вправо машина заметает одинаково: без модуля радиус уходит в минус,
     а мёртвая зона «почти прямо» ловит весь левый поворот */
  const swL = sweep(-CAR.maxSteer);
  near('левый поворот зеркален правому по радиусу', swL.R, sw.R, 1e-9);
  near('левый поворот зеркален правому по габариту', swL.out, sw.out, 1e-9);
  near('левый поворот зеркален правому изнутри', swL.inn, sw.inn, 1e-9);
  const ack = ackermann(CAR.maxSteer);
  ok('внутреннее колесо повёрнуто сильнее наружного', ack.r > ack.l);
  near('радиус Аккермана совпадает со sweep', Math.abs(ack.R), sw.R, 1e-9);

  g('скорость руления');
  car.vel = 0; near('стоя — медленно', steerRateNow(), CAR.steerStill, 1e-9);
  car.vel = 5; ok('в движении быстрее', steerRateNow() > CAR.steerStill * 1.8);
  ok('быстрее предела не бывает', steerRateNow() <= CAR.steerRoll);
  car.vel = 0;

  g('столкновения');
  const A = { u: 0, v: 0, hw: HALF_W, hl: HALF_L, yaw: 0 };
  ok('далёкие прямоугольники не пересекаются', satMTV(A, { ...A, v: 5 }) === null);
  near('совпавшие расходятся по ширине', satMTV(A, { ...A, v: 0 }).depth, CAR.width, 1e-6);
  const mtv = satMTV(A, { ...A, v: CAR.length - 0.2 });
  ok('касание по длине замечено', mtv && mtv.depth > 0.19 && mtv.depth < 0.21);
  /* оболочка кузова уже прямоугольника: нос седана скруглён, его дальний угол — (0,87; 1,94), и под
     35° след короче прямоугольника на 24 см (у прежнего лофта было 5–14) */
  /* carHullPts пишет в готовый буфер — свой массив создаём заполненным */
  const hull = carHullPts(0, 0, rad(35), CAR_HULL.map(() => ({ u: 0, v: 0 })));
  let maxV = -9; for (const p of hull) maxV = Math.max(maxV, p.v);
  const rectV = HALF_L * Math.cos(rad(35)) + HALF_W * Math.sin(rad(35));
  ok('под 35° оболочка короче прямоугольника', rectV - maxV > 0.18 && rectV - maxV < 0.30);

  g('зазоры');
  loadLevel(LEVELS.findIndex((d) => d.name === '14 · Габарит: нос к стене')); hideOv(); paused = true;
  setBody(0, -11, 0); car.vel = 0;
  near('дальше предела не меряем', clearances().front, SENS_MAX, 1e-6);
  setBody(0, -3.0, 0);
  near('до стены 0,49 м', clearances().front, 0.49, 0.02);
  near('сзади пусто', clearances().rear, SENS_MAX, 1e-6);
  ok('угол назван', typeof clearances().corner === 'object' || clearances().corner === null);

  g('город: полосы');
  loadLevel(LEVELS.findIndex((d) => d.name === '32 · Экзамен: маршрут с инспектором')); hideOv(); paused = true;
  const G = level.city.graph;
  const lenina = G.E.find((e) => e.name === 'Ленина');
  const sadovaya = G.E.find((e) => e.name === 'Садовая');
  near('полуширина Ленина 9,8 м', roadHW({ tram: true, lanes: 2 }), 9.8, 1e-9);
  near('правый ряд Ленина 8,15 м от оси', laneOffset(lenina, 'right'), 8.15, 1e-9);
  near('левый ряд Ленина 4,85 м от оси', laneOffset(lenina, 'left'), TRAM_HW + LANE_W * 0.5, 1e-9);
  near('трамвайное полотно посередине', laneOffset(lenina, 'tram'), TRAM_HW / 2, 1e-9);
  near('правый ряд Садовой 1,65 м от оси', laneOffset(sadovaya, 'right'), 1.65, 1e-9);

  g('город: маршрут');
  const route = cityRoute({ u: 8.15, v: -60 }, { u: 8.15, v: -20 }, { side: 'right' });
  ok('маршрут построен', route && route.pts.length > 4);
  ok('маршрут идёт по своей стороне', route.pts.every((p) => p.u > 0));
  near('длина примерно равна расстоянию', route.len, 40, 6);
  const ring = [];
  ringArc(G.V.N4, { u: 66.5, v: 0 }, { u: 78, v: 11.5 }, (p) => ring.push(p));
  ok('дуга кольца построена', ring.length > 3);
  ok('дуга обходит островок против часовой', ring[1].v < ring[0].v);

  g('поток');
  near('свободно — крейсерская скорость', trafSpeed(TRAF.see + 1), TRAF.sp, 1e-9);
  near('на дистанции — стоп', trafSpeed(TRAF.gap), 0, 1e-9);
  ok('ближе — тоже стоп', trafSpeed(TRAF.gap * 0.5) === 0);
  ok('чем дальше, тем быстрее', trafSpeed(12) > trafSpeed(9));
  const loop = trafPath([{ u: 0, v: -35 }, { u: -40, v: -70 }, { u: -78, v: -35 }, { u: -40, v: 0 }]);
  ok('петля замкнута', loop && loop.len > 200);
  const p0 = trafPose(loop, 0), pl = trafPose(loop, loop.len);
  near('конец петли совпадает с началом', Math.hypot(p0.u - pl.u, p0.v - pl.v), 0, 1e-6);
  const fwd = fuv(0), rgt = ruv(0);
  near('поперёк машина занимает свою длину', carExtent(rad(90), fwd, rgt).lat, HALF_L, 1e-6);
  near('вдоль машина занимает свою ширину', carExtent(rad(90), fwd, rgt).lon, HALF_W, 1e-6);

  g('окно в потоке');
  setBody(0, 0, 0);
  const actor = (u, v, yaw, sp) => {
    const a = pcar(u, v, yaw, PALETTE[1]);
    a.act = { wps: [], sp, v: sp, trig: null, i: 0, started: true, done: false, u0: u, v0: v, yaw0: a.yaw };
    level.actors = [a];
  };
  actor(0, -8, 0, 6); ok('попутный сзади не помеха', trafficGap(0, 0, 6) >= 9);
  actor(-30, 6, 90, 6); ok('поперечный закрывает окно', trafficGap(0, 0, 6) < 5);
  actor(-80, 6, 90, 6); ok('далёкий не мешает', trafficGap(0, 0, 6) >= 9);
  actor(-10, 6, 90, 0); ok('стоящий не мешает', trafficGap(0, 0, 6) >= 9);
  /* время подъезда — числами, шаг 0,5 с. Точка опасности в 6 м перед капотом, радиус по умолчанию 6,5 м:
     поперечный в 3 м/с с 20 м входит в радиус ровно через 13,5 м — 4,5 с */
  actor(-20, 6, 90, 3); near('радиус окна по умолчанию — 6,5 м', trafficGap(0, 0), 4.5, 1e-9);
  actor(-30, 6, 90, 6); near('поперечный в 6 м/с с 30 м — 4 с', trafficGap(0, 0, 6), 4, 1e-9);
  actor(-80, 6, 90, 6); ok('путь свободен — ровно 99', trafficGap(0, 0, 6) === 99);
  actor(-30, 6, 90, 6); ok('своя точка опасности уровня вдали от его пути — окно свободно', trafficGap(0, 0, 6, { u: 0, v: 30 }) === 99);
  actor(0, 10, 0, 6); ok('уходящий вперёд от точки не помеха', trafficGap(0, 0, 6) === 99);
  actor(-30, 6, 90, 0.2); ok('почти стоящий (0,2 м/с) не помеха', trafficGap(0, 0, 6) === 99);
  /* сзади, но поперёк — помеха: исключение только для попутного. Путь по v = −1 проходит в 7 м от точки,
     в радиус 8 м он входит за 3,87 м до неё — через 16,1 м, на 3-й секунде */
  actor(-20, -1, 90, 6); near('поперечный из-за спины — помеха', trafficGap(0, 0, 8), 3, 1e-9);
  /* точка опасности — по курсу своей машины: курсом на восток она в 6 м восточнее, встречный с севера
     в 5 м/с доходит до неё за 24 м — 5 с */
  setBody(0, 0, rad(90)); actor(6, 30, 180, 5); near('точка опасности по курсу машины', trafficGap(0, 0, 6), 5, 1e-9); setBody(0, 0, 0);
  /* машина потока разгоняется к своему крейсеру с TRAF.acc. С 2 м/с до 8,3 м/с — 4,85 с и 25 м, дальше 8,3 м/с:
     54 м до радиуса — на 8,5 с; по текущей скорости вышло бы 27 с, то есть «окно свободно» */
  const onRoute = (u0, sp, v) => { const rt = actorPath(u0, 6, [{ u: 60, v: 6 }]), a = pcar(u0, 6, 90, PALETTE[1]);
    a.act = { wps: [], rt, s: 0, sp, v, trig: null, i: 0, started: true, done: false, u0, v0: 6, yaw0: a.yaw };
    level.actors = [a]; };
  onRoute(-60, 8.3, 2); near('поток из поворота разгоняется к крейсеру', trafficGap(0, 0, 6), 8.5, 1e-9);
  onRoute(-60, 8.3, 8.3); near('поток на крейсере — без разгона', trafficGap(0, 0, 6), 7, 1e-9);
  /* трогающийся считается не медленнее 0,5 м/с: с места до 34 м — 6 с разгона (26,4 м) и ещё 1 с */
  onRoute(-40, 8.3, 0.4); near('трогающийся — с 0,5 м/с', trafficGap(0, 0, 6), 7, 1e-9);
  level.actors = [];

  g('светофор');
  const L = level.city.lights.find((x) => x.group === 'NS' && !x.offset);
  game.t = 5; ok('зелёный в начале цикла', lightPhase(L) === 'G' && !lightStops(L));
  game.t = 11; ok('жёлтый запрещает', lightPhase(L) === 'Y' && lightStops(L));
  game.t = 20; ok('красный запрещает', lightPhase(L) === 'R' && lightStops(L));
  game.t = LIGHT_CYCLE + 5; ok('цикл повторяется', lightPhase(L) === 'G');
  game.t = 0;

  g('экзамен');
  ok('аварийная валит сразу', PENALTIES.yield.fatal === true);
  ok('откат не аварийный', !PENALTIES.rollback.fatal);
  ok('сумма провала 7', EXAM_FAIL_SUM === 7);
  ok('бордюр не грубая', !PENALTIES.kerb.fatal && !PENALTIES.kerb.hard);

  g('эстакада');
  loadLevel(LEVELS.findIndex((d) => d.name === '20 · Эстакада: трогание в горку')); hideOv(); paused = true;
  ok('вне зоны земля ровная', groundH(0, -60) === 0);
  ok('на настиле земля поднята', level.ramps.length > 0);

  /* Детекторы уже проверены синтетикой в tools/exam-check.js — она гоняет 15 сценариев на
     собственной фикстуре за долю секунды. До сих пор эта проверка жила отдельно и в
     мутационный набор не входила: 274 мутанта в violationsTick выживали при том, что
     проверка на них есть. Подключаем её сюда, а не переписываем. */
  g('продольная физика');
  /* stepCar гоняем напрямую: без кадров и без рендера — это те же подшаги, что в игре.
     Перед каждым замером машину возвращаем на старт: за двадцать секунд газа она уезжает
     на сто метров и упирается в край площадки, и замер превращается в замер упора */
  loadLevel(LEVELS.findIndex((d) => d.name === '13 · Полигон: круги разворота')); hideOv(); paused = true;
  const drive = (secs, keys) => {
    for (const k in input) input[k] = false;
    Object.assign(input, keys || {});
    for (let t = 0; t < secs; t += 1 / 120) stepCar(1 / 120);
    for (const k in input) input[k] = false;
  };
  const reset = (sel) => {
    setBody(level.start.u, level.start.v, level.start.th);
    car.sel = sel; car.gear = sel === 'D' ? 1 : sel === 'R' ? -1 : 0;
    car.vel = 0; car.steer = 0; car.hand = false;
  };
  reset('P'); drive(2, { fwd: true });
  near('в режиме P газ не трогает машину', car.vel, 0, 1e-9);
  reset('D'); drive(4, {});
  near('в D без газа машина ползёт на крипе', car.vel, CAR.creep, 0.2);
  reset('D'); drive(4, { fwd: true });
  ok('газ разгоняет заметно выше крипа', car.vel > CAR.creep * 2);
  reset('D'); car.vel = CAR.maxF; drive(3, { fwd: true });
  ok('выше предела машина не разгоняется', car.vel <= CAR.maxF + 1e-6);
  reset('D'); car.vel = CAR.maxF; drive(3, { back: true });
  near('тормоз останавливает', car.vel, 0, 0.05);
  reset('R'); drive(6, { fwd: true });
  ok('назад машина едет назад', car.vel < 0);
  ok('задний ход не быстрее своего предела', Math.abs(car.vel) <= CAR.maxR + 1e-6);
  ok('задний предел ниже переднего', CAR.maxR < CAR.maxF);
  /* руль замеряем на тормозе: крип за секунду разгоняет машину, и скорость руления растёт */
  reset('D'); drive(1, { right: true, back: true });
  near('стоя руль идёт со своей скоростью', car.steer, CAR.steerStill, rad(2));
  drive(5, { right: true, back: true });   /* до упора хватает 1,5 с */
  near('дальше упора руль не уходит', car.steer, CAR.maxSteer, 1e-9);
  /* кастор возвращает руль только выше порога: ниже него парковка была бы невозможна */
  reset('D'); car.steer = CAR.maxSteer; car.vel = CAR.casterV * 0.6; drive(3, {});
  ok('на парковочной скорости руль не распускается', car.steer > CAR.maxSteer * 0.98);
  reset('D'); car.steer = CAR.maxSteer; car.vel = CAR.casterV * 3; drive(3, {});
  ok('на ходу руль возвращается сам', car.steer < CAR.maxSteer * 0.9);
  reset('D'); car.hand = true; drive(6, { fwd: true });
  ok('с ручником машина не разгоняется', Math.abs(car.vel) < CAR.maxF * 0.5);
  car.hand = false;

  /* скорость в городе (план speed-limits-ribbon, Ф2): потолок — уровня, выше 5,2 м/с разгон по мощности,
     накат слабее, кривизна по сцеплению, руль медленнее. Ниже 5,2 м/с — ни одной разницы с прежним */
  g('скорость в городе');
  ok('во дворе потолок прежний', level.vmax === CAR.maxF && vmaxNow() === CAR.maxF);
  level.vmax = CAR.vCity;
  ok('в городе потолок 60 км/ч', Math.abs(vmaxNow() * 3.6 - 60) < 1e-9);
  demo = {}; ok('показ и в городе едет со старым потолком', vmaxNow() === CAR.maxF); demo = null;
  reset('D'); car.vel = 4; drive(0.5, { fwd: true });
  near('до 5,2 м/с разгон прежний', car.vel, 4 + CAR.accel * 0.5, 0.02);
  reset('D'); car.vel = 10; drive(0.5, { fwd: true });
  near('на 36 км/ч разгон по мощности: a = 3,1 · 5,2 / v', car.vel, 10 + CAR.accel * CAR.maxF / 10 * 0.5, 0.03);
  reset('D'); car.vel = CAR.vCity - 0.05; drive(1, { fwd: true });
  near('выше 60 км/ч в городе машина не разгоняется', car.vel, CAR.vCity, 1e-6);
  reset('D'); car.vel = 12; drive(1, {});
  near('накат на 43 км/ч слабее парковочного', car.vel, 12 - CAR.drag * 0.45, 0.03);
  reset('D'); car.vel = 7; drive(1, {});
  /* на 25 км/ч накат 1,35 · 5,2 / v: v dv = −1,35 · 5,2 dt → v = √(49 − 2 · 1,35 · 5,2) */
  near('накат на 25 км/ч слабеет как 5,2 / v', car.vel, Math.sqrt(49 - 2 * CAR.drag * CAR.maxF), 0.02);
  reset('D'); car.vel = 4; drive(1, {});
  near('накат на парковочном ходу прежний', car.vel, 4 - CAR.drag, 0.02);
  const turnRate = (v) => { reset('D'); car.vel = v; car.steer = CAR.maxSteer; input.right = true; const th0 = car.th;
    stepCar(1 / 120); input.right = false; return { got: angNorm(car.th - th0) * 120, v: car.vel }; };
  let tr = turnRate(5);
  near('на 18 км/ч полный руль поворачивает как раньше', tr.got, tr.v * Math.tan(CAR.maxSteer) / CAR.wheelbase, 1e-9);
  tr = turnRate(12);
  near('на 43 км/ч поворот ограничен сцеплением 7,2 м/с²', tr.got, CAR.grip / tr.v, 1e-9);
  reset('D'); car.vel = 12; car.steer = -CAR.maxSteer; input.left = true; { const th0 = car.th; stepCar(1 / 120); input.left = false;
    near('влево сцепление ограничивает так же', angNorm(car.th - th0) * 120, -CAR.grip / car.vel, 1e-9); }
  reset('D'); car.vel = 12;
  near('на 43 км/ч руль вращается вдвое медленнее', steerRateNow(), (CAR.steerStill + (CAR.steerRoll - CAR.steerStill) * (1 - Math.exp(-12 / CAR.steerVref))) * 0.5, 1e-9);
  car.vel = 40;
  near('на любой скорости руль не медленнее трети', steerRateNow(), (CAR.steerStill + (CAR.steerRoll - CAR.steerStill) * (1 - Math.exp(-40 / CAR.steerVref))) * 0.35, 1e-9);
  car.vel = -2;
  near('задним ходом руль вращается так же, как вперёд', steerRateNow(), CAR.steerStill + (CAR.steerRoll - CAR.steerStill) * (1 - Math.exp(-2 / CAR.steerVref)), 1e-9);
  car.vel = 5;
  near('на парковочном ходу руль прежний', steerRateNow(), CAR.steerStill + (CAR.steerRoll - CAR.steerStill) * (1 - Math.exp(-5 / CAR.steerVref)), 1e-9);
  level.vmax = CAR.maxF; reset('D');
  loadLevel(LEVELS.findIndex((d) => d.traffic === 'city')); hideOv(); paused = true;
  ok('городской уровень получает потолок 60 км/ч', level.vmax === CAR.vCity);

  /* превышение (ПДД 10.2, экзамен п. 2.13): больше чем на 2 км/ч дольше секунды, одна запись до тех пор,
     пока машина не сбросит скорость до ограничения. На Ленина за знаком «40» */
  g('скорость: превышение');
  attempt = null;
  const speedN = () => vioEvents.filter((e) => e.code === 'speed').length;
  const ride = (kmh, secs) => { for (let i = 0; i < Math.round(secs * 60); i++) { setBody(8.15, -40, 0); car.vel = kmh / 3.6; violationsTick(1 / 60); } };
  vioEvents.length = 0; speedOverT = 0; speedFired = false;
  ride(41.9, 3); ok('41,9 в «40» — в пределах погрешности спидометра', speedN() === 0);
  ok('ограничение там, где машина, — 40', game.lim === 40);
  ride(43, 0.9); ok('43 меньше секунды — ещё не нарушение', speedN() === 0);
  ride(43, 0.2); ok('43 дольше секунды — нарушение', speedN() === 1);
  ride(50, 3); ok('одно превышение — одна запись', speedN() === 1);
  ride(41, 0.5); ride(50, 1.5); ok('сбросил до 41 — превышение не кончилось, новой записи нет', speedN() === 1);
  ride(40, 1 / 60); ride(50, 1.2); ok('сбросил до ограничения — следующее превышение снова записано', speedN() === 2);
  ride(40, 1 / 60); ride(-50, 1.2); ok('задним ходом скорость считается по модулю', speedN() === 3);
  vioEvents.length = 0; speedOverT = 0; speedFired = false; car.vel = 0;

  g('зазоры: борт и углы');
  loadLevel(LEVELS.findIndex((d) => d.name === '14 · Габарит: нос к стене')); hideOv(); paused = true;
  setBody(0, -3.0, 0); car.vel = 0;
  const cl = clearances();
  near('сзади пусто', cl.rear, SENS_MAX, 1e-6);
  /* угловой луч подмешивается в оба соседних показания: сбоку от машины пусто, но стена
     впереди-слева видна диагональю — без этого датчик был слеп к препятствию наискось */
  ok('стена впереди видна и боковыми показаниями', cl.left < SENS_MAX - 0.5 && cl.right < SENS_MAX - 0.5);
  near('слева и справа симметрично', cl.left, cl.right, 0.01);
  ok('ближний угол назван, когда стена рядом', cl.corner && cl.corner.d < 1.2);
  setBody(0, -11, 0);
  ok('вдали ближний угол не выделяется', !clearances().corner);
  const far = clearances();
  near('вдали спереди предел', far.front, SENS_MAX, 1e-6);
  near('вдали слева предел', far.left, SENS_MAX, 1e-6);

  g('зазоры: низкий бордюр');
  /* датчики обязаны видеть и бордюр в 16 см: лучи идут по списку ближних препятствий с minH=0,
     и подмена нуля на единицу молча выкидывала бы всё ниже метра — именно бордюры у тротуара */
  loadLevel(LEVELS.findIndex((d) => d.name === '14 · Габарит: нос к стене')); hideOv(); paused = true;
  const kb = (u, v, w, l) => { const o = kerb(u, v, w, l); o.hw = w / 2; o.hl = l / 2; return o; };
  level.obs = [kb(0, HALF_L + 0.5, 6, 0.2), kb(0, -(HALF_L + 0.5), 6, 0.2),
               kb(-(HALF_W + 0.5), 0, 0.2, 6), kb(HALF_W + 0.5, 0, 0.2, 6)];
  setBody(0, 0, 0); car.vel = 0; cornerHold = null;
  const lk = clearances();
  near('бордюр спереди 0,39 м', lk.front, 0.39, 0.02);
  near('бордюр сзади 0,39 м', lk.rear, 0.39, 0.02);
  near('бордюр слева 0,39 м', lk.left, 0.39, 0.02);
  near('бордюр справа 0,39 м', lk.right, 0.39, 0.02);
  ok('у бордюра ближний угол назван', lk.corner && lk.corner.d < 0.45);
  /* кубик наискось от правого переднего угла: перпендикулярные лучи его не задевают, видит
     только диагональ — она обязана попасть и в «спереди», и в «справа», и в выбор угла */
  const dg = 0.5 * Math.SQRT1_2 + 0.15;
  level.obs = [kb(HALF_W + dg, HALF_L + dg, 0.3, 0.3)];
  setBody(0, 0, 0); cornerHold = null;
  const dk = clearances();
  ok('кубик наискось виден спереди', dk.front < SENS_MAX - 0.5);
  ok('кубик наискось виден справа', dk.right < SENS_MAX - 0.5);
  near('слева пусто', dk.left, SENS_MAX, 1e-6);
  ok('ближний угол — правый передний', dk.corner && dk.corner.sf === 1 && dk.corner.sr === 1);

  g('поток: кто кого держит');
  loadLevel(LEVELS.findIndex((d) => d.name === '30 · Круговое движение')); hideOv(); paused = true;
  setBody(200, 200, 0); car.vel = 0;          /* игрок далеко: мешать некому */
  /* pcar принимает курс в ГРАДУСАХ и сам переводит его в радианы */
  const flow = (u, v, yawDeg, sp) => {
    const a = pcar(u, v, yawDeg, PALETTE[2]);
    a.act = { wps: [], sp, v: sp, trig: null, i: 0, started: true, done: false, u0: u, v0: v, yaw0: a.yaw };
    return a;
  };
  level.actors = [flow(0, 0, 0, 6), flow(0, 9, 0, 6)];
  ok('попутный впереди держит дистанцию', trafBlock(level.actors[0], 0) < TRAF.see);
  near('дистанция меряется до самой машины', trafBlock(level.actors[0], 0), 9, 1.5);
  level.actors = [flow(0, 0, 0, 6), flow(3.3, 9, 180, 6)];
  ok('встречный в соседней полосе не помеха', trafBlock(level.actors[0], 0) >= TRAF.see);
  level.actors = [flow(0, 0, 0, 6), flow(0, 9, 0, 0)];
  ok('стоящий впереди — помеха', trafBlock(level.actors[0], 0) < TRAF.see);
  /* на перекрёстке уступает тот, кто приедет в точку конфликта ПОЗЖЕ: ближнему тормозить
     незачем, и без этого правила две машины уступали бы друг другу до бесконечности.
     Здесь первому ехать 10 м, второму — 12: первый проезжает, второй ждёт */
  level.actors = [flow(0, 0, 0, 6), flow(12, 10, -90, 6)];
  ok('ближний к точке конфликта едет', trafBlock(level.actors[0], 0) >= TRAF.see);
  ok('дальний от точки конфликта уступает', trafBlock(level.actors[1], 1) < TRAF.see);
  level.actors = [flow(0, 0, 0, 6), flow(60, 10, -90, 6)];
  ok('далёкий поперечный никого не тормозит', trafBlock(level.actors[0], 0) >= TRAF.see
    && trafBlock(level.actors[1], 1) >= TRAF.see);
  level.actors = [];

  g('маршрут по городу');
  loadLevel(LEVELS.findIndex((d) => d.name === '32 · Экзамен: маршрут с инспектором')); hideOv(); paused = true;
  const gg = level.city.graph;
  const north = cityRoute({ u: 8.15, v: -60 }, { u: 8.15, v: 40 }, { side: 'right' });
  ok('длинный маршрут построен', north && north.len > 90);
  ok('маршрут назвал улицы', north.legs.length > 0 && north.legs.every((l) => l.name));
  const left = cityRoute({ u: 8.15, v: -60 }, { u: 8.15, v: -20 }, { side: 'left' });
  ok('перед левым поворотом линия уходит левее правого ряда',
    left.pts[left.pts.length - 2].u < north.pts[1].u);
  /* кольцо — не пункт назначения: линия обязана кончаться на въезде, а не в островке */
  const toRing = cityRoute({ u: 46, v: -4.95 }, { u: gg.V.N4.u, v: gg.V.N4.v }, { side: 'right' });
  ok('линия к кольцу не идёт в центр островка', toRing && toRing.pts.every(
    (p) => Math.hypot(p.u - gg.V.N4.u, p.v - gg.V.N4.v) > gg.V.N4.round - 7.5));

  g('кузов снаружи');
  /* след модели кузова на земле обязан быть тем, по которому считается касание (CAR_HULL): модель
     уже следа рисовала бы касание до металла, шире — металл входил бы в стену без касания */
  if (carModel.state === 'ready') {
    const toPoly = (p, poly) => {
      let best = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t));
      }
      return best;
    };
    /* все три кузова: седан своей машины (его след — CAR_HULL), хэтчбек и кроссовер чужих — касание
       машина-машина считается по следу кузова соседа (carHullOf) */
    ok('след своей машины — след седана (@render-car-footprint)', CAR_HULL === carModel.bodies.sedan.hull);
    for (const name of ['sedan', 'hatch', 'cross']) {
      const B = carModel.bodies[name];
      if (!B) { fails.push('кузов снаружи · нет кузова ' + name + ' (@render-car-footprint)'); continue; }
      const ch = carHullOf({ kind: 'car', body: name }).map((h) => [h.lat, h.z]);
      const V = B.V, pts = [];
      for (let i = 0; i < V.length; i += 3) pts.push({ u: V[i], v: V[i + 2] });
      const mh = hull2(pts).map((q) => [q.u, q.v]);
      const dev = Math.max(...mh.map((p) => toPoly(p, ch)), ...ch.map((p) => toPoly(p, mh)));
      ok('след кузова ' + name + ' совпадает со следом касаний в пределах 1 см (@render-car-footprint)', dev <= 0.01);
      /* грубая проверка — прямоугольник 4,42 × 1,80: след, вышедший за него, пропускал бы касания */
      ok('след кузова ' + name + ' не выходит за прямоугольник (@render-car-footprint)',
        ch.every(([lat, z]) => Math.abs(lat) <= HALF_W + 1e-3 && Math.abs(z) <= HALF_L + 1e-3));
    }
  } else fails.push('кузов снаружи · модель не загружена (@render-car-footprint)');

  g('пейволл и покупки');
  {
    /* состояние игрока подменяется на время группы и возвращается: набор гоняется в живой странице */
    const acct0 = acct, pf0 = window.PAYWALL_FORCE, po0 = window.premiumOn, t = Math.floor(Date.now() / 1000);
    let prog0 = null; try { prog0 = localStorage.getItem(PROG_KEY); } catch (e) {}
    try {
      window.PAYWALL_FORCE = [19];
      acct = null;
      ok('без покупки уровень из списка гейта закрыт', levelLocked(19) === true);
      ok('соседние уровни вне списка открыты', levelLocked(18) === false && levelLocked(20) === false);
      window.PAYWALL_FORCE = [0, 19];
      ok('первый уровень не закрывается, даже если он в списке', levelLocked(0) === false);
      acct = { id: 'u', name: 'u', provider: 'vk', ent: [{ product: 'premium', expires_at: null }] };
      ok('бессрочный премиум открывает', entitled('premium') && levelLocked(19) === false);
      acct.ent = [{ product: 'premium', expires_at: t + 60 }];
      ok('премиум со сроком через минуту открывает', entitled('premium') === true);
      acct.ent = [{ product: 'premium', expires_at: t - 1 }];
      ok('премиум, истёкший секунду назад, не открывает', entitled('premium') === false && levelLocked(19) === true);
      acct.ent = [{ product: 'course', expires_at: null }];
      ok('другой продукт премиум не открывает', entitled('premium') === false);
      acct.ent = [];
      ok('пустой список покупок — ничего не открыто', entitled('premium') === false);
      acct = null;
      LEVELS.push({ name: '★ проверка', custom: true });
      window.PAYWALL_FORCE = [19, LEVELS.length - 1];
      ok('своя площадка не закрывается, даже если её номер в списке', levelLocked(LEVELS.length - 1) === false && levelLocked(19) === true);
      LEVELS.pop();
      delete window.PAYWALL_FORCE;
      /* замок Премиума: на file:// и без флага его нет; включённый — граница между 10-м и 11-м уровнем */
      ok('без включённой оплаты закрытых уровней нет', LEVELS.every((l, i) => levelLocked(i) === false));
      window.premiumOn = () => true;
      try { localStorage.setItem(PROG_KEY, '{}'); } catch (e) {}
      ok('уровни 1–10 бесплатны', [0, 1, 6, 9].every((i) => levelLocked(i) === false));
      ok('уровни 11–32 закрыты без премиума', [10, 13, 19, 26, LEVELS.length - 1].every((i) => levelLocked(i) === true));
      acct = { id: 'u', name: 'u', provider: 'vk', ent: [{ product: 'premium', expires_at: null }] };
      ok('с премиумом открыты все', LEVELS.every((l, i) => levelLocked(i) === false));
      acct = null;
      try { localStorage.setItem(PROG_KEY, JSON.stringify({ [LEVELS[10].name]: { n: 1, clean: 1, best: 30 } })); } catch (e) {}
      ok('прошедший уровень после 10-го до замка сохраняет доступ', premiumGrand() === true && levelLocked(25) === false);
      try { localStorage.setItem(PROG_KEY, JSON.stringify({ [LEVELS[9].name]: { n: 3, clean: 1, best: 30 } })); } catch (e) {}
      ok('прогресс только по бесплатным уровням доступ не даёт', premiumGrand() === false && levelLocked(10) === true);
      ok('путь новичка — только бесплатные уровни', noviceIdx().length === 5 && noviceIdx().every((i) => i < PAYWALL.from));
    } finally {
      acct = acct0; window.PAYWALL_FORCE = pf0; window.premiumOn = po0;
      try { if (prog0 === null) localStorage.removeItem(PROG_KEY); else localStorage.setItem(PROG_KEY, prog0); } catch (e) {}
      if (LEVELS.length && LEVELS[LEVELS.length - 1].name === '★ проверка') LEVELS.pop();
    }
  }

  g('детекторы нарушений');
  if (typeof detectorCheck === 'function') {
    for (const c of detectorCheck()) ok(c.name, c.ok);
  } else fails.push('детекторы · tools/exam-check.js не загружен');
  g('экзамен: зоны и поворотники');
  if (typeof examCheck === 'function') {
    for (const c of examCheck()) ok(c.name, c.ok);
  } else fails.push('экзамен · tools/exam-check.js не загружен');
  g('экзамен: маршруты');
  if (typeof routeCheck === 'function') {
    for (const r of routeCheck(3)) {
      ok('маршрут ' + r.run + ' проходится целиком', r.done === r.n && !r.stuck);
      ok('маршрут ' + r.run + ' без мгновенных этапов', !r.instant.length);
    }
  } else fails.push('маршруты · tools/exam-check.js не загружен');
  g('экзамен: навигация');
  if (typeof navCheck === 'function') {
    const n = navCheck(3);
    ok('линия маршрута без замечаний', Array.isArray(n) && n.length === 0);
  } else fails.push('навигация · tools/exam-check.js не загружен');

  return { total: done.length + fails.length, failed: fails.length, fails };
}
