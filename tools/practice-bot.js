/* Бот практики городского урока и экзамена: проезжает маршрут так, как его проехал бы аккуратный водитель, —
   по линии маршрута в нужной полосе (exam.leg, её строит сама игра), с поворотником заранее, со стопом на
   запрещающий и под STOP, пропуская пешеходов, и встаёт у тротуара. Нужен гейту practice-check: вариант,
   который такой водитель не проезжает чисто, — дефект варианта или детектора, а не урок.
   Работает в странице: шагает simTick(1/60) — те же актёры, детекторы и экзамен, что у игрока. */
(function () {
  let entered = false, botMode = null;           /* бот уже въехал в узел текущей команды — уступать поздно и незачем */
  const near = (a, b) => Math.hypot(a.u - b.u, a.v - b.v);
  function lookAhead(pts, c, L) {
    let bi = 0, bd = 1e9;
    for (let i = 0; i < pts.length; i++) { const d = near(pts[i], c); if (d < bd) { bd = d; bi = i; } }
    let acc = 0;
    for (let i = bi; i < pts.length - 1; i++) {
      const s = near(pts[i], pts[i + 1]);
      if (acc + s >= L) { const t = (L - acc) / s; return { u: pts[i].u + (pts[i + 1].u - pts[i].u) * t, v: pts[i].v + (pts[i + 1].v - pts[i].v) * t, i }; }
      acc += s;
    }
    return { u: pts[pts.length - 1].u, v: pts[pts.length - 1].v, i: pts.length - 1 };
  }
  function bend(pts, c, L) {
    const a = lookAhead(pts, c, 1), b = lookAhead(pts, c, L * 0.5), d = lookAhead(pts, c, L);
    const y1 = Math.atan2(b.u - a.u, b.v - a.v), y2 = Math.atan2(d.u - b.u, d.v - b.v);
    return Math.abs(angNorm(y2 - y1)) + Math.abs(angNorm(y1 - car.th));
  }
  /* ближайшая точка линии к передней оси и курс линии в ней */
  function closest(pts, q) {
    let best = null, bd = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], du = b.u - a.u, dv = b.v - a.v, L2 = du * du + dv * dv;
      if (L2 < 1e-6) continue;
      const t = clamp(((q.u - a.u) * du + (q.v - a.v) * dv) / L2, 0, 1), pu = a.u + du * t, pv = a.v + dv * t, d = Math.hypot(q.u - pu, q.v - pv);
      if (d < bd) { bd = d; best = { u: pu, v: pv, yaw: Math.atan2(du, dv), i, t }; }
    }
    return best;
  }
  /* Стэнли: курс линии плюс поправка на боковое отклонение передней оси — держит линию в тесном повороте,
     где погоня за точкой срезала угол по бордюру */
  function stanley(pts, bias) {
    const f = fuv(car.th), r = ruv(car.th), F = { u: car.ru + f.u * CAR.wheelbase, v: car.rv + f.v * CAR.wheelbase };
    const P = closest(pts, F); if (!P) return 0;
    const lat = (P.u - F.u) * r.u + (P.v - F.v) * r.v + (bias || 0);
    const eh = angNorm(P.yaw - car.th);
    return clamp(eh + Math.atan2(1.6 * lat, Math.abs(car.vel) + 0.6), -CAR.maxSteer, CAR.maxSteer);
  }
  function steerTo(p) {
    const c = bodyPos(), f = fuv(car.th), r = ruv(car.th), du = p.u - c.u, dv = p.v - c.v;
    const lat = du * r.u + dv * r.v, lon = du * f.u + dv * f.v;
    return clamp(Math.atan2(2 * CAR.wheelbase * lat, Math.max(1, lon * lon + lat * lat)), -CAR.maxSteer, CAR.maxSteer);
  }
  /* сколько метров до ближайшего места, где надо стоять: запрещающий светофор, STOP, пешеход на переходе */
  function stopAhead() {
    const c = bodyPos(), f = fuv(car.th), nu = c.u + f.u * HALF_L, nv = c.v + f.v * HALF_L;
    let best = 1e9;
    for (const sl of (level.city.stoplines || [])) {
      const lf = fuv(sl.yaw), lr = ruv(sl.yaw);
      if (f.u * lf.u + f.v * lf.v < 0.5) continue;
      const s = (nu - sl.u) * lf.u + (nv - sl.v) * lf.v, x = (nu - sl.u) * lr.u + (nv - sl.v) * lr.v;
      /* проехал линию — следующий подъезд к ней снова со стопом (маршрут из графа проходит эстакаду дважды) */
      if (s > 5) sl._botStopped = false;
      if (s > -0.2 || s < -40 || Math.abs(x) > sl.w / 2 + 0.6) continue;
      if (sl.light && lightLets(sl)) continue;
      /* STOP и стоп-линия эстакады: постоял — дальше */
      if (!sl.light && sl._botStopped) continue;
      best = Math.min(best, -s - 0.6);
    }
    const st = pedAhead(), zb = zebraAhead();
    if (botMode !== 'noyield' && zb && (st === 'yield' || st === 'kerb') && zb.ahead < 14) best = Math.min(best, zb.ahead - 0.8);
    return best;
  }
  /* перед узлом команды: есть ли кто-то с преимуществом по правилу узла ближе RULE_ETA+1,5 с — тогда
     стоим у края узла. Те же mustYield и проходы актёров, что у детектора: бот не знает больше игрока */
  function mustWait(st) {
    if (!st || !st.node || entered) return null;
    const n = cityGraph().V[st.node], R = n.round || n.r, c = bodyPos(), dn = Math.hypot(c.u - n.u, c.v - n.v);
    if (dn < R - 0.3) { entered = true; return null; }
    if (dn > R + 10) return null;
    const rule = level.city.rules && level.city.rules[n.id]; if (!rule || rule.kind === 'bend') return null;
    /* у кольца — по геометрии: едущая по кольцу машина, которой до нашего въезда против часовой меньше
       RULE_ETA + 1,5 с. Проход по графу терял машину, давно въехавшую на кольцо (её проход «почти кончен») */
    if (n.round) {
      const aY = (st.armIn || armOf(st.node, angNorm(car.th + Math.PI))).yaw;
      for (const a of level.actors) { const s = a.act; if (s.ped || !s.started || s.done || Math.abs(s.v) < 0.3) continue;
        if (Math.hypot(a.u - n.u, a.v - n.v) > n.round + 1) continue;
        const dx = ((Math.atan2(a.u - n.u, a.v - n.v) - aY) % TAU + TAU) % TAU;
        /* стоп не у самого кольца, а до зоны «уступи» (её край в 4,5 м перед кромкой): катиться по зоне к линии,
           пока по кольцу идёт машина, — уже непропуск */
        if (dx * (n.round - 3.5) / Math.abs(s.v) < RULE_ETA + 1.5) return dn - R - 5; }
    }
    const me = playerMove(n);
    for (const a of level.actors) {
      const s = a.act; if (s.ped || !s.started || s.done || !s.rt) continue;
      const pa = actorPassage(a, n.id); if (!pa) continue;
      const om = actorMove(a, pa);
      if (n.round) { if (!om.onRing || Math.abs(s.v) < 0.3) continue;
        const dx = ((om.bearing - me.aIn.yaw) % TAU + TAU) % TAU;
        if (dx * (n.round - 3.5) / Math.max(1, Math.abs(s.v)) > RULE_ETA + 1.5) continue; }
      /* стоящая машина не помеха и внутри узла: поток уступает игроку, и ждать её — запереть узел вдвоём */
      else if (Math.abs(s.v) < 0.3 || (pa.inside ? pa.done > 0.75 : pa.toIn / Math.max(1, Math.abs(s.v)) > RULE_ETA + 1.5)) continue;
      if (mustYield(rule, me, om)) return dn - R - 0.6;
    }
    return null;
  }
  /* трамвай у места разворота: ждём на своём пути, пока не пройдёт */
  /* разворот с путей ждёт трамвай и встречный поток (п. 8.8): машина на встречной половине, которой до места
     разворота меньше 6 с, проедет сквозь дугу. Бот ждал только трамвай, и проходил маршруты, пока ему везло
     со временем: с точным расстоянием до разворота он приезжал на секунду позже и ловил встречную */
  function tramWait(st) {
    if (!st || st.node || st.turn !== 'U') return false;
    const my = Math.sign(Math.cos(car.th));
    for (const a of level.actors) { const s = a.act; if (!s || s.ped || !s.started || s.done) continue;
      const toward = (st.at.v - a.v) * Math.cos(a.yaw) > 0, d = Math.abs(a.v - st.at.v);
      if (s.rail) { if ((toward && d / Math.max(1, Math.abs(s.v)) < 14) || d < 10) return true; continue; }
      if (Math.sign(Math.cos(a.yaw)) === my || Math.abs(a.u - st.at.u) > 12) continue;
      if ((toward && d / Math.max(1, Math.abs(s.v)) < 6) || d < 8) return true; }
    return false;
  }
  function blinkFor(st, distToAt) {
    if (!st) return null;
    if (st.turn === 'park' || (st.turn === 'stop' && st.spot)) return distToAt < 45 ? 'R' : null;
    if (st.turn === 'stop' || (st.turn === 'straight' && !st.node)) return null;
    const n = st.node && cityGraph().V[st.node];
    if (n && n.round) {
      const c = bodyPos(), d = Math.hypot(c.u - n.u, c.v - n.v);
      if (d > n.round) return d < n.round + 26 ? 'R' : null;
      /* на кольце: до своего съезда меньше 70° по ходу (против часовой азимут убывает) — правый */
      const brg = Math.atan2(c.u - n.u, c.v - n.v), left = ((brg - st.armOut.yaw) % TAU + TAU) % TAU;
      return left < rad(70) ? 'R' : null;
    }
    if (distToAt > ((st.turn === 'L' || st.turn === 'U') ? 70 : 45)) return null;
    return st.turn === 'L' || st.turn === 'U' ? 'L' : st.turn === 'R' ? 'R' : null;
  }
  /* путь этапа — тем же cityRoute, что ведёт поток (его дуги через узлы проверены traffic-check), до точки
     за узлом на луче выезда. Линия экзамена (exam.leg) для этого не годится: она склеивает маршрут «к центру
     узла» с маршрутом «от центра» и на правом повороте у N2 делала петлю через центр */
  function stagePath(st) {
    const c = bodyPos();
    if (st.turn === 'park') { const r = cityRoute(c, st.at, { side: 'right', th: car.th }); return r ? r.pts : null; }
    /* остановка с троганием, эстакада, старт «прямо»: к точке этапа и дальше по улице — после остановки
       этап закрывается только троганием, и ехать надо по той же улице */
    if (!st.node) {
      const r = cityRoute(c, st.at, { side: 'right', th: car.th }); if (!r) return null;
      /* продолжение — по курсу улицы этапа, а не по последнему отрезку: тот бывает диагональю к точке */
      const pts = r.pts.slice(), B = pts[pts.length - 1], fo = fuv(st._outYaw !== undefined ? st._outYaw : car.th);
      for (let k = 2; k <= 30; k += 2) pts.push({ u: B.u + fo.u * k, v: B.v + fo.v * k });
      return pts;
    }
    const n = cityGraph().V[st.node], R = n.round || n.r;
    /* дуга налево и разворот строятся с улицы подъезда. Если машина ещё до неё (изгиб N7 между узлами) —
       сначала по графу к улице подъезда, дугу достроит runDrive, когда машина на неё выйдет */
    if ((st.turn === 'U' && !n.round) || (st.turn === 'L' && botMode !== 'rightlane')) {
      if (st.armIn && onInArm(st) === false) {
        const A = laneStart(st.node, st.armIn.yaw * 180 / Math.PI, R + 30), r = cityRoute(c, A, { side: 'right', th: car.th });
        if (r) { st._viaInArm = true; return r.pts; }
      }
      st._viaInArm = false;
      return st.turn === 'U' ? uPath(st, n, R) : lPath(st, n, R);
    }
    const B = laneOut(st.node, st.armOut.yaw * 180 / Math.PI, R + 18);
    const r = cityRoute(c, B, { side: 'right', th: car.th });
    return r ? r.pts : null;
  }
  /* налево: из крайней левой полосы дугой игры (cornerArc: опорная точка на пересечении линий полос) в правую
     полосу выезда. Смещённый влево путь правого ряда давал дугу круче, чем позволяет руль */
  /* машина на улице подъезда к узлу этапа (или уже у самого узла — N5b и N5 стоят вплотную, и этап N5
     начинается внутри N5b): только тогда дуга строится с подъезда, иначе — сначала по графу до этой улицы */
  function onInArm(st) {
    const n = cityGraph().V[st.node], R = n.round || n.r, c = bodyPos();
    if (Math.hypot(c.u - n.u, c.v - n.v) < R + 8) return true;
    const sn = citySnap(c); return !!(sn && sn.e && sn.e === st.armIn.e);
  }
  /* курс подъезда — по лучу въезда, а не по машине: этап начинается, пока машина ещё доворачивает после
     прошлого узла, и 3° перекоса за 60 м уводили путь на бордюр */
  function lPath(st, n, R) {
    const aIn = st.armIn || armOf(st.node, angNorm(car.th + Math.PI)), h = angNorm(aIn.yaw + Math.PI), f = fuv(h), r = ruv(h), e = aIn.e;
    const latIn = (e.tram ? TRAM_HW : 0) + LANE_W * 0.5, eo = st.armOut.e, fo = fuv(st.armOut.yaw), ro = ruv(st.armOut.yaw);
    const latOut = (eo.tram ? TRAM_HW : 0) + LANE_W * ((eo.lanes || 1) - 0.5);
    const P = (al, lt) => ({ u: n.u + f.u * al + r.u * lt, v: n.v + f.v * al + r.v * lt });
    const c = bodyPos(), al0 = (c.u - n.u) * f.u + (c.v - n.v) * f.v, lat0 = (c.u - n.u) * r.u + (c.v - n.v) * r.v, pts = [];
    for (let al = al0; al < -(R + 0.6); al += 2) pts.push(P(al, lat0 + (latIn - lat0) * clamp((al - al0) / 16, 0, 1)));
    const p0 = P(-(R + 0.6), latIn), p1 = { u: n.u + fo.u * (R + 0.6) + ro.u * latOut, v: n.v + fo.v * (R + 0.6) + ro.v * latOut };
    pts.push(p0);
    cornerArc(n, p0, p1, (q) => pts.push(q), h, st.armOut.yaw);
    for (let k = 0; k <= 24; k += 2) pts.push({ u: p1.u + fo.u * k, v: p1.v + fo.v * k });
    return pts;
  }
  /* разворот на перекрёстке: из крайней левой полосы полукругом не уже 4,3 м в правую полосу обратного
     направления; где полукруг шире улицы — довести в полосу после дуги */
  function uPath(st, n, R) {
    const aIn = st.armIn || armOf(st.node, angNorm(car.th + Math.PI)), h = angNorm(aIn.yaw + Math.PI), f = fuv(h), r = ruv(h), e = aIn.e;
    const b0 = e.tram ? TRAM_HW : 0, latIn = b0 + LANE_W * 0.5, latOut = b0 + LANE_W * ((e.lanes || 1) - 0.5);
    const rr = Math.max(4.3, (latIn + latOut) / 2), P = (al, lt) => ({ u: n.u + f.u * al + r.u * lt, v: n.v + f.v * al + r.v * lt });
    const c = bodyPos(), al0 = (c.u - n.u) * f.u + (c.v - n.v) * f.v, pts = [];
    for (let al = al0; al < -2; al += 2) pts.push(P(al, latIn));
    for (let k = 0; k <= 18; k++) { const ph = Math.PI * k / 18; pts.push(P(-2 + rr * Math.sin(ph), latIn - rr + rr * Math.cos(ph))); }
    const lt0 = latIn - 2 * rr;
    for (let al = -4; al > -R - 24; al -= 2) { const t = clamp((-2 - al) / 10, 0, 1); pts.push(P(al, lt0 + (-latOut - lt0) * t)); }
    return pts;
  }
  window.practiceDrive = function (li, vi, opts) {
    opts = opts || {};
    window.PRACTICE_VARIANT = vi; window.PRACTICE_SEED = opts.seed || 11;
    /* плотность ставится явно: прошлый проезд мог оставить «без машин» */
    opt.traffic = opts.traffic ? (opts.traffic === true ? 'normal' : opts.traffic) : 'off';
    openLevel(li, 'practice', 'practice');
    delete window.PRACTICE_VARIANT; delete window.PRACTICE_SEED;
    return runDrive(opts);
  };
  /* экзамен из графа: маршрут по зерну, настоящий режим — ошибка не прощается. Поток у экзамена всегда
     плотный; без opts.traffic поток убирается — проверяется маршрут, а не уступание */
  const BOT_CRUISE = 5.2;
  window.examDrive = function (seed, opts) {
    opts = opts || {};
    const li = LEVELS.findIndex((l) => l.examRoute);
    window.EXAM_SEED = seed; opt.examMode = opts.mode || 'real';
    openLevel(li, 'pick');
    delete window.EXAM_SEED;
    /* машины потока — ещё и препятствия уровня: без потока убираются и оттуда, иначе стоят замороженными */
    if (!opts.traffic) { const A = new Set(level.actors); level.obs = level.obs.filter((o) => !A.has(o)); level.actors = []; }
    return runDrive(opts);
  };
  function runDrive(opts) {
    hideOv(); paused = false;
    botMode = opts.misbehave || null;
    if (!opts.actors) level.actors = level.actors.filter((a) => a.act.flow);
    if (opts.setup) opts.setup();
    if (opts.allGreen) level.lightShift = 0;
    car.sel = 'D'; car.gear = 1;
    let lastN = 1; entered = false;
    const log = []; let t = 0, stopT = 0, path = null, pathStage = null, dodge = 0, parkAt = null, parkOff = 0.45, parkT = 0, thEntry = null, goOn = false;
    /* разворот посреди квартала: по своему пути до места, дуга полного вылета (uturnArc игры), дальше —
       правая полоса обратного направления. Линия экзамена такой дуги не строит */
    const tramPath = (st) => {
      const site = st.at, north = site.v < 0, pts = [], c = bodyPos(), lu = north ? TRAM_HW / 2 : -TRAM_HW / 2, R = sweep(CAR.maxSteer).R;
      for (let d = 0; d < 60; d += 2) { const v = c.v + (north ? d : -d); if (north ? v > site.v - R / 2 : v < site.v + R / 2) break; pts.push({ u: lu, v }); }
      uturnArc({ u: 0, v: site.v, yaw: north ? 0 : Math.PI }, (q) => pts.push(q));
      for (let d = 2; d <= 60; d += 2) { const k = clamp((d - 2) / 16, 0, 1), uu = -6.08 + (-8.15 + 6.08) * k;
        pts.push({ u: north ? uu : -uu, v: site.v + (north ? -d : d) }); }
      return pts;
    };
    for (const sl of (level.city.stoplines || [])) sl._botStopped = false;
    while (t < (opts.maxT || 180) && !game.done) {
      for (const k in input) input[k] = false;
      const st = exam.route[exam.stage];
      if (!exam.leg) examLegBuild();
      const c = bodyPos(), v = Math.abs(car.vel);
      /* у узла команды линия заморожена: внутри узла игра перестраивает её от машины к центру, и по ней
         можно только кружить. Захваченная на подъезде линия уже несёт дугу поворота */
      /* линия этапа строится один раз — в начале этапа, издалека. Перестроенная от машины, стоящей
         у края узла (красный, пешеход), она уходила в центр перекрёстка */
      /* этап сравнивается объектом, а не номером: перестроенный инспектором маршрут кладёт новый этап
         под тем же номером */
      if (pathStage !== st) {
        if (st && st.turn === 'U' && !st.node) path = tramPath(st);
        else path = st ? stagePath(st) : null;
        pathStage = st; dodge = 0; thEntry = null; entered = false;
        if (st && (st.turn === 'park' || (st.turn === 'stop' && st.spot))) { parkAt = { u: st.at.u, v: st.at.v }; parkOff = 0.45; parkT = 0; goOn = false; }
      }
      if (st && st._viaInArm && onInArm(st)) path = stagePath(st);
      const pts = path;
      const dAt = exam.leg ? exam.leg.dist : (st && st.at ? near(st.at, c) : 99);
      let want = 6.0, aim = null;
      let bias = 0, useStanley = !!pts;
      if (pts) {
        const b = bend(pts, c, 12);
        aim = lookAhead(pts, c, Math.max(4.0, v * 1.1));
        if (b > 0.5) want = 3.0; else if (b > 0.25) want = 4.0;
        /* стоящая машина в своей полосе впереди — объезд соседней полосой слева (с поворотником) */
        const f = fuv(car.th), r = ruv(car.th);
        if (!dodge) for (const o of level.obs) {
          if (o.kind !== 'car' || o.act) continue;
          const du = o.u - c.u, dv = o.v - c.v, lon = du * f.u + dv * f.v, lat = du * r.u + dv * r.v;
          if (lon > 0 && lon < 30 && Math.abs(lat) < 1.6) { dodge = -LANE_W; break; }
        }
        /* стоящая машина позади на 6 м — вернуться в свою полосу */
        /* объезд держится до узла этапа: возвращаться в свою полосу между стоящей машиной и узлом некогда */
        if (dodge) bias += dodge;

        if (st && st.turn === 'U' && dAt < 14) want = Math.min(want, 2.6);
      }
      /* пропуск команды для гейта: бот едет прямо через узел, где велено повернуть */
      if (botMode === 'skipturn' && st && st.node && (st.turn === 'L' || st.turn === 'R') && !st._skipPath) {
        const n = cityGraph().V[st.node], aIn = armOf(st.node, angNorm(car.th + Math.PI));
        const aS = nodeArms(st.node).find((a) => a !== aIn && moveKind(aIn, a) === 'S');
        /* прямо в тупик бот не едет: оттуда маршрут продолжается разворотом, которого бот не умеет */
        if (aS && vertDeg(cityGraph(), edgeOther(aS.e, st.node)) >= 2) { const B = laneOut(st.node, aS.yaw * 180 / Math.PI, (n.round || n.r) + 18), r = cityRoute(c, B, { side: 'right' });
          if (r) { path = r.pts; st._skipPath = true; botMode = null; } }
      }
      const parking = st && (st.turn === 'park' || (st.turn === 'stop' && st.spot)) && !goOn;
      if (parking && pts && pts.length > 1) {
        /* к тротуару — по направлению улицы (последний отрезок линии), а не по курсу машины: правее середины
           полосы на parkOff; встали, а до бордюра дальше 0,6 м — ещё правее и чуть вперёд */
        const A = pts[pts.length - 2], B = pts[pts.length - 1], sy = Math.atan2(B.u - A.u, B.v - A.v), f2 = fuv(sy);
        const lon = (parkAt.u - c.u) * f2.u + (parkAt.v - c.v) * f2.v;
        if (lon < 30) bias += parkOff * clamp(1 - (lon - 4) / 22, 0, 1);
        want = Math.min(want, lon > 0.3 ? Math.max(0.8, Math.sqrt(2 * 1.6 * lon)) : 0);
        if (lon <= 0.3 && v < 0.05) { parkT += 1 / 60;
          /* остановка с троганием: постояли дольше удержания этапа — трогаемся по той же улице */
          if (st.turn === 'stop' && parkT > EXAM_HOLD + 0.4 && car.blink === 'R') { goOn = true; car.blink = null; }
          else if (parkT > 1.6 && parkOff < 1.05) { parkOff += 0.2; parkAt = { u: parkAt.u + f2.u * 4, v: parkAt.v + f2.v * 4 }; parkT = 0; } }
      }
      const sa = stopAhead();
      if (sa < 1e8) want = Math.min(want, Math.sqrt(2 * 2.4 * Math.max(0, sa)));
      /* пробка: попутная машина впереди — 2 м стоя и около 1,2 с на ходу; перед перекрёстком и зеброй, за которыми
         нет места для кузова, стоим (п. 13.2, 14.4). Бот объезжал только стоящие машины без act и на варианте 27e
         догонял колонну потока. botMode 'jamenter' — нарушитель для гейта: въезжает в занятый перекрёсток */
      const qg = queueGapAhead();
      if (qg < 30) want = Math.min(want, qg < 2 ? 0 : Math.min(Math.sqrt(2 * 2.4 * (qg - 2)), (qg - 2) / 1.2 + 0.5));
      if (botMode !== 'jamenter') { const jr = jamRoomAhead(12);
        if (jr && jr.room < JAM_ROOM && jr.entry < 12) want = Math.min(want, Math.sqrt(2 * 2.4 * Math.max(0, jr.entry - 0.6))); }
      if (!opts.misbehave) {
        const mw = mustWait(st);
        if (mw !== null) want = Math.min(want, Math.sqrt(2 * 2.4 * Math.max(0, mw)));
        if (tramWait(st) && st.at && Math.abs(c.v - st.at.v) < 9) want = 0;
      }
      /* STOP и эстакада: полная остановка у линии, потом дальше */
      for (const sl of (level.city.stoplines || [])) if (!sl.light && !sl._botStopped) {
        const f = fuv(car.th), lf = fuv(sl.yaw), nu = c.u + f.u * HALF_L, nv = c.v + f.v * HALF_L;
        const s = (nu - sl.u) * lf.u + (nv - sl.v) * lf.v;
        if (s > -3 && s < 0.2 && v < 0.1) { stopT += 1 / 60; if (stopT > 1.2) { sl._botStopped = true; stopT = 0; } }
      }
      if (opts.misbehave === 'noblink') car.blink = null;
      else { const lpb = lanePos(), bl = dodge && lpb && lpb.k !== 1 ? 'L' : blinkFor(st, dAt);
        if (bl && car.blink !== bl) { car.blink = bl; car.blinkTh = car.th; } }
      const tgt = useStanley ? stanley(pts, bias) : aim ? steerTo(aim) : 0, err = tgt - car.steer;
      if (Math.abs(err) > rad(0.8)) { if (err > 0) input.right = true; else input.left = true; }
      /* газ — не выше прежнего потолка машины 5,2 м/с: в городе машина теперь едет до 60 км/ч, а маршруты бота и
         детекторы откалиброваны на этом ходу; с газом до упора машина стояла на 5,2, так она стоит и сейчас */
      if (v > want + 0.25) input.back = true; else if (v < want - 0.25 && want > 0 && v < BOT_CRUISE) input.fwd = true;
      if (want === 0) input.back = true;
      if (opts.trace && Math.round(t * 60) % 30 === 0) {
        const lp = lanePos();
        opts.trace.push(t.toFixed(1) + 's st' + exam.stage + ' p=' + c.u.toFixed(1) + ',' + c.v.toFixed(1) + ' th=' + (car.th * 180 / Math.PI).toFixed(0)
          + ' v=' + v.toFixed(1) + ' want=' + want.toFixed(1) + ' sa=' + (sa < 1e8 ? sa.toFixed(1) : '-') + ' aim=' + (aim ? aim.u.toFixed(1) + ',' + aim.v.toFixed(1) : '-')
          + ' bl=' + car.blink + ' lane=' + (lp ? lp.k + '/' + lp.n : '-') + ' dAt=' + (dAt || 0).toFixed(0) + ' leg=' + (pts ? pts.length : 0));
      }
      simTick(1 / 60);
      t += 1 / 60;
      if (exam.log.length > log.length) log.push(...exam.log.slice(log.length).map((l) => l.code + '@' + l.t.toFixed(1)));
    }
    const res = { done: !!(exam && exam.done), failed: !!(exam && exam.failed), score: exam ? exam.score : null,
      stage: exam ? exam.stage : null, stages: exam ? exam.route.length : null, hits: game.hits, log, t: +t.toFixed(1),
      pos: (() => { const c = bodyPos(); return c.u.toFixed(1) + ',' + c.v.toFixed(1); })(), variant: level.pvar && level.pvar.id,
      cmds: exam ? exam.route.map((x) => x.short) : [] };
    hideOv();
    return res;
  }
})();
