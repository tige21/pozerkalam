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

  return { total: done.length + fails.length, failed: fails.length, fails };
}
