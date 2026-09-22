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
  /* оболочка кузова уже прямоугольника: нос сужается, и углы прямоугольника висят вне металла */
  /* carHullPts пишет в готовый буфер — свой массив создаём заполненным */
  const hull = carHullPts(0, 0, rad(35), CAR_HULL.map(() => ({ u: 0, v: 0 })));
  let maxV = -9; for (const p of hull) maxV = Math.max(maxV, p.v);
  const rectV = HALF_L * Math.cos(rad(35)) + HALF_W * Math.sin(rad(35));
  ok('под 35° оболочка короче прямоугольника', rectV - maxV > 0.05 && rectV - maxV < 0.14);

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
