/* Словарь шагов исполняемых сценариев. Загружается в страницу и работает с живой игрой:
   уровень грузится настоящим loadLevel, поза ставится настоящим setBody, ответы берутся
   у тех же функций, что отвечают игроку. Шаг не лезет в приватные детали мимо поведения —
   сценарий обязан пережить рефакторинг.
   Весь сценарий исполняется одним вызовом ghRun: обмен со страницей стоит дороже,
   чем сами шаги, а прогон обязан укладываться в секунды (его гоняет мутационный гейт). */
(function () {
  const N = '(-?\\d+(?:\\.\\d+)?)';
  const S = '"([^"]*)"';
  const ctx = {};                       /* что шаги передают друг другу внутри сценария */

  function levelByName(name) {
    const i = LEVELS.findIndex((d) => d.name === name);
    if (i < 0) throw new Error('нет уровня «' + name + '»; есть: ' + LEVELS.slice(0, 3).map((d) => d.name).join(', ') + ' …');
    return i;
  }
  function near(got, want, tol, what) {
    if (Math.abs(got - want) > tol) throw new Error(what + ': ожидали ' + want + ', получили ' + (+got.toFixed(3)));
  }
  /* смещение — часть адреса светофора, а не деталь: на одной улице они сдвинуты друг
     относительно друга ради зелёной волны, и «группа NS» без смещения адресует разные фазы */
  function lightOf(group, off) {
    const L = ((level.city && level.city.lights) || []).find((x) => x.group === group && (x.offset || 0) === +off);
    if (!L) throw new Error('на уровне нет светофора группы «' + group + '» со смещением ' + off
      + '; есть: ' + ((level.city && level.city.lights) || []).map((x) => x.group + '/' + (x.offset || 0)).join(', '));
    return L;
  }
  const PHASE_RU = { G: 'зелёный', Y: 'жёлтый', R: 'красный' };
  /* hideOv прячет карточку, но не чистит её: пейволл прошлого сценария остаётся в DOM */
  const paywallShown = () => document.getElementById('overlay').style.display !== 'none' && !!document.querySelector('#overlay .paywall');

  const STEPS = [
    /* ---------- Дано ---------- */
    [new RegExp('^в курс входят уровни ' + N + ' и ' + N + '$'), (a, b) => { window.PAYWALL_FORCE = [+a - 1, +b - 1]; }],
    [new RegExp('^в курс входит уровень ' + N + '$'), (a) => { window.PAYWALL_FORCE = [+a - 1]; }],
    [/^игрок без покупки$/, () => { acct = null; }],
    [new RegExp('^у игрока покупка ' + S + '$'), (product) => {
      acct = { id: 'gh', name: 'gh', provider: 'vk', ent: [{ product, expires_at: null }] };
    }],
    [new RegExp('^у игрока покупка ' + S + ', истёкшая вчера$'), (product) => {
      acct = { id: 'gh', name: 'gh', provider: 'vk', ent: [{ product, expires_at: Math.floor(Date.now() / 1000) - 86400 }] };
    }],
    [new RegExp('^уровень ' + S + '$'), (name) => {
      loadLevel(levelByName(name)); hideOv(); paused = true;
      ctx.touches = 0;
    }],
    [new RegExp('^кузов в точке \\(' + N + ', ' + N + '\\) курсом ' + N + '°$'), (u, v, th) => {
      setBody(+u, +v, rad(+th)); car.vel = 0;
      for (const o of level.obs) o._touch = false;
      ctx.touches = 0;
    }],
    /* обустройство города: ближайший к точке ствол или опора, машина носом к нему со стороны точки */
    [new RegExp('^кузов в ' + N + ' м перед (стволом дерева|опорой фонаря) у точки \\(' + N + ', ' + N + '\\)$'), (gap, what, u, v) => {
      const kind = what === 'стволом дерева' ? 'tree' : 'pole';
      let best = null, bd = 1e9;
      for (const p of (level.props || [])) {
        const c = p._col; if (!c || c.kind !== kind) continue;
        const d = Math.hypot(c.u - +u, c.v - +v); if (d < bd) { bd = d; best = c; }
      }
      if (!best || bd > 12) throw new Error('у точки (' + u + ', ' + v + ') нет: ' + what);
      const L = Math.hypot(+u - best.u, +v - best.v) || 1, du = (+u - best.u) / L, dv = (+v - best.v) / L;
      const k = HALF_L + best.hw + +gap;
      /* руль — прямо: сценарий раньше мог оставить его повёрнутым, и машина под газом уезжала в поребрик */
      setBody(best.u + du * k, best.v + dv * k, Math.atan2(-du, -dv)); car.vel = 0; car.steer = 0; game.hitCd = 0;
      for (const o of level.obs) o._touch = false;
      for (const p of level.props) if (p._col) p._col._touch = false;
      ctx.touches = 0; ctx.target = best;
    }],
    [new RegExp('^режим экзамена ' + S + '$'), (mode) => {
      const m = mode === 'настоящий' ? 'real' : 'train';
      opt.examMode = m;
      if (level.def.examRoute) { examTeardown(); examInit(); }
    }],
    [new RegExp('^на дороге одна машина в точке \\(' + N + ', ' + N + '\\) курсом ' + N + '° со скоростью ' + N + ' м/с$'),
      (u, v, yaw, sp) => {
        /* фикстура вместо живого потока: сценарию нужна одна машина в известном месте,
           а не то, что успел наехать trafficInit к этому кадру */
        const a = pcar(+u, +v, +yaw, PALETTE[1]);
        a.act = { wps: [], sp: +sp, v: +sp, trig: null, i: 0, started: true, done: false,
                  u0: +u, v0: +v, yaw0: a.yaw };
        level.actors = [a];
      }],

    [new RegExp('^на дороге один трамвай в точке \\(' + N + ', ' + N + '\\) курсом ' + N + '° со скоростью ' + N + ' м/с$'),
      (u, v, yaw, sp) => {
        const t = tramCar(+u, +v, +yaw, 100, +sp, null);
        level.actors = [t];
      }],

    /* фикстура пешехода: уже идёт по переходу в заданную сторону, других актёров нет */
    [new RegExp('^на переходе один пешеход в точке \\(' + N + ', ' + N + '\\) идёт курсом ' + N + '° со скоростью ' + N + ' м/с$'),
      (u, v, yaw, sp) => {
        const f = fuv(rad(+yaw));
        const o = pedActor([{ u: +u, v: +v }, { u: +u + f.u * 20, v: +v + f.v * 20 }], +sp, null, 0, 1);
        o.act.v = +sp; level.actors = [o];
      }],
    /* правила приоритета на всех узлах общего города — как в практике */
    [/^на перекрёстках действуют правила приоритета$/, () => {
      level.city.rules = cityRuleMap(level.city, { lights: ['N1', 'N2'], signs: { N6: { main: ['Заводская', 'Косой съезд'] } } });
      cityReset();
    }],
    [/^на дороге нет машин$/, () => { level.actors = []; }],
    /* машина со своим маршрутом по городу: путь строит тот же cityRoute, что ведёт поток */
    [new RegExp('^по городу едет машина из точки \\(' + N + ', ' + N + '\\) в точку \\(' + N + ', ' + N + '\\) со скоростью ' + N + ' м/с$'),
      (u0, v0, u1, v1, sp) => {
        const r = cityRoute({ u: +u0, v: +v0 }, { u: +u1, v: +v1 }, { side: 'right' });
        if (!r) throw new Error('маршрут не построен');
        const pts = r.pts.filter((q, i) => i > 0 && i < r.pts.length - 1);
        const rt = actorPath(pts[0].u, pts[0].v, pts.slice(1));
        const o = pcar(pts[0].u, pts[0].v, 0, PALETTE[2]);
        const q = trafPose(rt, 0, {}); o.yaw = q.yaw; o.hw = o.w / 2; o.hl = o.l / 2;
        o.act = { rt, s: 0, s0: 0, sp: +sp, v: +sp, started: true, done: false, flow: false, wps: null, i: 0, trig: null,
                  u0: o.u, v0: o.v, yaw0: o.yaw };
        level.actors.push(o); ctx.actor = o;
      }],
    /* куда игрок поедет из узла: команда маршрута — так же, как её даёт инспектор практики */
    [new RegExp('^игрок поворачивает на узле ' + S + ' к лучу курсом ' + N + '°$'), (id, yaw) => {
      if (!exam || !exam.route) throw new Error('маршрута нет — нужен уровень экзамена');
      const arm = armOf(id, rad(+yaw));
      exam.route[exam.stage] = Object.assign({}, exam.route[exam.stage], { node: id, armOut: arm });
    }],
    [new RegExp('^машина игрока въезжает в узел ' + S + '$'), (id) => {
      const g = cityGraph(), n = g && g.V[id];
      if (!n) throw new Error('нет узла ' + id);
      vioEvents.length = 0; violationsTick(1 / 60);
      const f = fuv(car.th);
      for (let k = 0; k < 200; k++) {
        const c = bodyPos();
        if (Math.hypot(c.u - n.u, c.v - n.v) < (n.round || n.r) - 0.3) break;
        setBody(c.u + f.u * 0.3, c.v + f.v * 0.3, car.th); game.t += 0.05; violationsTick(1 / 60);
      }
      ctx.vio = vioEvents.map((e) => e.code);
    }],
    [/^машина (без преимущества уступает игроку|проезжает, не уступая игроку)$/, (what) => {
      if (!ctx.actor) throw new Error('нет машины');
      const d = ruleBlock(ctx.actor), yields = d < TRAF.see;
      if (what.startsWith('без') !== yields) throw new Error('ruleBlock ' + d.toFixed(1) + ' м — ' + (yields ? 'встаёт' : 'едет'));
    }],
    [new RegExp('^машина игрока едет вперёд со скоростью ' + N + ' м/с$'), (sp) => {
      car.sel = 'D'; car.gear = 1; car.vel = +sp;
    }],

    /* ---------- Когда ---------- */
    /* касание — это засчитанный наезд (hitPenalty), а не число препятствий под кузовом: угол поребрика
       из двух коробок одной цепочки держит обе, а наезд один (kerbHeld) */
    [/^проверяется касание$/, () => {
      const orig = window.hitPenalty; let n = 0;
      window.hitPenalty = function () { n++; return orig.apply(this, arguments); };
      try { resolveCollisions(1 / 60); } finally { window.hitPenalty = orig; }
      ctx.touches += n;
    }],
    /* как в frame(): два подшага физики на кадр 1/60, газ держится, кулдаун отсчитывается. Считаются
       засчитанные наезды (hitPenalty) — по ним и счётчик в итогах уровня */
    [new RegExp('^машина давит газом в препятствие ' + N + ' секунд[а-я]*$'), (secs) => {
      const orig = window.hitPenalty; let n = 0;
      window.hitPenalty = function () { n++; return orig.apply(this, arguments); };
      car.sel = 'D'; car.gear = 1; game.moved = true;
      try {
        for (let k = 0; k < Math.round(+secs * 60); k++) {
          input.fwd = true; stepCar(1 / 120); stepCar(1 / 120); game.hitCd -= 1 / 60;
        }
      } finally { input.fwd = false; window.hitPenalty = orig; }
      ctx.touches += n;
    }],
    [/^измеряются зазоры$/, () => { ctx.clear = clearances(); }],
    [new RegExp('^игрок открывает уровень ' + N + '$'), (n) => {
      ctx.before = game.li; hideOv(); openLevel(+n - 1, 'pick');
    }],
    [new RegExp('^игровое время ' + N + ' секунд[а-я]*$'), (t) => { game.t = +t; }],
    [new RegExp('^начислен штраф ' + S + '$'), (code) => { examPenalty(code); }],
    [/^срабатывают детекторы нарушений$/, () => {
      vioEvents.length = 0;
      violationsTick(1 / 60);
      ctx.vio = vioEvents.map((e) => e.code);
    }],
    /* нарушение во время заезда — тем же путём, что у детектора: vio() → попытка строгого уровня */
    [new RegExp('^игрок нарушает правило ' + S + '$'), (code) => {
      if (!PENALTIES[code]) throw new Error('нет кода нарушения «' + code + '»');
      vio(code, PENALTIES[code].txt);
    }],
    /* зачёт уровня: прогресс до и после — по имени уровня в localStorage */
    [/^уровень пройден$/, () => {
      const p0 = progOf(level.def.name) || { n: 0, clean: 0 };
      ctx.prog0 = { n: p0.n || 0, clean: p0.clean || 0 };
      win();
      const p1 = progOf(level.def.name) || { n: 0, clean: 0 };
      ctx.prog1 = { n: p1.n || 0, clean: p1.clean || 0 };
    }],
    [/^считается окно в потоке$/, () => { const c = bodyPos(); ctx.gap = trafficGap(c.u, c.v, 6); }],
    /* смена зелёного на жёлтый у первого светофора уровня: детектор видит последний кадр зелёного
       и первый кадр жёлтого — п. 6.14 решается ровно в этот миг */
    [/^загорается жёлтый$/, () => {
      const L = ((level.city && level.city.lights) || [])[0];
      if (!L) throw new Error('на уровне нет светофора');
      const base = (L.group === 'EW' ? LIGHT_CYCLE / 2 : 0) + (L.offset || 0);
      const tY = ((LIGHT_GREEN - base) % LIGHT_CYCLE + LIGHT_CYCLE) % LIGHT_CYCLE;
      vioEvents.length = 0;
      game.t = tY - 0.05; violationsTick(1 / 60);
      game.t = tY + 0.05; violationsTick(1 / 60);
      if (lightPhase(L) !== 'Y') throw new Error('жёлтый не загорелся: ' + lightPhase(L));
      ctx.vio = vioEvents.map((e) => e.code);
    }],
    /* проезд по ломаной: шаг 0,3 м, курс по отрезку, на каждом шаге — кадр детекторов, как в frame */
    [/^машина проезжает через точки (.+)$/, (list) => {
      const pts = [...list.matchAll(/\((-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\)/g)].map((m) => ({ u: +m[1], v: +m[2] }));
      if (pts.length < 2) throw new Error('нужно хотя бы две точки');
      vioEvents.length = 0; car.vel = Math.max(car.vel, 3); car.sel = 'D'; car.gear = 1;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = Math.hypot(b.u - a.u, b.v - a.v), th = Math.atan2(b.u - a.u, b.v - a.v);
        for (let d = 0; d < L; d += 0.3) {
          setBody(a.u + (b.u - a.u) * d / L, a.v + (b.v - a.v) * d / L, th);
          game.t += 0.1; violationsTick(1 / 60);
        }
      }
      ctx.vio = (ctx.vio || []).concat(vioEvents.map((e) => e.code));
    }],
    [/^включён (левый|правый) поворотник$/, (side) => { car.blink = side === 'левый' ? 'L' : 'R'; car.blinkTh = car.th; }],
    /* въезд на ближайший переход впереди: кадр детекторов до кромки, потом нос на 0,3 м за ней */
    [/^машина въезжает на переход$/, () => {
      const zb = zebraAhead();
      if (!zb) throw new Error('впереди нет перехода');
      vioEvents.length = 0; violationsTick(1 / 60);
      const f = fuv(car.th), c = bodyPos(), k = zb.ahead + 0.3;
      setBody(c.u + f.u * k, c.v + f.v * k, car.th);
      violationsTick(1 / 60);
      ctx.vio = vioEvents.map((e) => e.code);
    }],
    /* машина переезжает линию светофора на своей скорости: нос — на 0,5 м за линией */
    [/^машина пересекает стоп-линию$/, () => {
      const sl = ((level.city && level.city.stoplines) || []).find((x) => x.light);
      if (!sl) throw new Error('на уровне нет стоп-линии светофора');
      const f = fuv(car.th), c = bodyPos(), lf = fuv(sl.yaw);
      const s = (c.u + f.u * HALF_L - sl.u) * lf.u + (c.v + f.v * HALF_L - sl.v) * lf.v;
      setBody(c.u + f.u * (0.5 - s), c.v + f.v * (0.5 - s), car.th);
      vioEvents.length = 0; violationsTick(1 / 60);
      ctx.vio = (ctx.vio || []).concat(vioEvents.map((e) => e.code));
    }],

    /* ---------- Тогда ---------- */
    [/^открыт пейволл, уровень не сменился$/, () => {
      if (!paywallShown()) throw new Error('пейволла нет на экране');
      if (game.li !== ctx.before) throw new Error('уровень сменился на ' + (game.li + 1));
    }],
    [new RegExp('^загружен уровень ' + N + '$'), (n) => {
      if (game.li !== +n - 1) throw new Error('загружен уровень ' + (game.li + 1) + ', ожидали ' + n);
      if (paywallShown()) throw new Error('на экране пейволл');
    }],
    [/^машина не проехала насквозь$/, () => {
      const c = bodyPos(), f = fuv(car.th), T = ctx.target;
      const ahead = (T.u - c.u) * f.u + (T.v - c.v) * f.v;
      if (ahead < HALF_L) throw new Error('препятствие уже не впереди бампера: ' + (+ahead.toFixed(2)) + ' м от центра кузова');
    }],
    [/^касания нет$/, () => { if (ctx.touches) throw new Error('засчитано касаний: ' + ctx.touches); }],
    [/^касание засчитано$/, () => { if (!ctx.touches) throw new Error('касание не засчитано'); }],
    [new RegExp('^засчитано ' + N + ' касани[ея]$'), (n) => {
      if (ctx.touches !== +n) throw new Error('касаний ' + ctx.touches + ', ожидали ' + n);
    }],
    [new RegExp('^зазор (спереди|сзади|слева|справа) ' + N + ' м$'), (side, m) => {
      if (!ctx.clear) throw new Error('зазоры не измерены — нет шага «Когда измеряются зазоры»');
      const key = { спереди: 'front', сзади: 'rear', слева: 'left', справа: 'right' }[side];
      near(ctx.clear[key], +m, 0.02, 'зазор ' + side);
    }],
    [new RegExp('^светофор группы ' + S + ' со смещением ' + N + ' показывает ' + S + '$'), (group, off, want) => {
      const got = PHASE_RU[lightPhase(lightOf(group, off))];
      if (got !== want) throw new Error('светофор ' + group + '/' + off + ': ' + got + ', ожидали ' + want);
    }],
    [new RegExp('^светофор группы ' + S + ' со смещением ' + N + ' запрещает движение$'), (group, off) => {
      if (!lightStops(lightOf(group, off))) throw new Error('светофор ' + group + '/' + off + ' разрешает движение');
    }],
    [new RegExp('^нарушение ' + S + ' стоит ' + N + ' балл[а-я]*$'), (code, pts) => {
      const p = PENALTIES[code];
      if (!p) throw new Error('нет кода нарушения «' + code + '»');
      if (p.pts !== +pts) throw new Error(code + ': ' + p.pts + ' баллов, ожидали ' + pts);
    }],
    [new RegExp('^нарушение ' + S + ' (не )?аварийное$'), (code, not) => {
      const p = PENALTIES[code];
      if (!p) throw new Error('нет кода нарушения «' + code + '»');
      if (!!p.fatal === !!not) throw new Error(code + ': fatal=' + !!p.fatal);
    }],
    [new RegExp('^сумма баллов ' + N + '$'), (n) => {
      if (!exam) throw new Error('экзамен не идёт');
      if (exam.score !== +n) throw new Error('баллов ' + exam.score + ', ожидали ' + n);
    }],
    [/^экзамен (не )?провален$/, (not) => {
      if (!exam) throw new Error('экзамен не идёт');
      if (!!exam.failed === !!not) throw new Error('failed=' + !!exam.failed);
    }],
    [/^маркеры выключены$/, () => { if (opt.marks) throw new Error('opt.marks включён'); }],
    [/^подсказки траектории выключены$/, () => { if (opt.guides) throw new Error('opt.guides включён'); }],
    [/^непропуска нет$/, () => {
      if (!ctx.vio) throw new Error('детекторы не запускались — нет шага «Когда срабатывают детекторы нарушений»');
      if (ctx.vio.includes('yield')) throw new Error('засчитан непропуск: ' + ctx.vio.join(', '));
    }],
    [/^засчитан непропуск$/, () => {
      if (!ctx.vio) throw new Error('детекторы не запускались — нет шага «Когда срабатывают детекторы нарушений»');
      if (!ctx.vio.includes('yield')) throw new Error('непропуск не засчитан: [' + ctx.vio.join(', ') + ']');
    }],
    /* светофоры группируются по ближайшему узлу графа; на цикле с шагом 0,1 с поперечные группы
       одного узла не горят зелёным одновременно */
    [/^на перекрёстках нет одновременного зелёного поперечным направлениям$/, () => {
      const g = level.city && level.city.graph, Ls = (level.city && level.city.lights) || [];
      if (!g || !Ls.length) throw new Error('на уровне нет графа или светофоров');
      const byNode = {};
      for (const L of Ls) {
        let best = null, bd = 1e9;
        for (const id in g.V) { const n = g.V[id], d = Math.hypot(n.u - L.u, n.v - L.v); if (d < bd) { bd = d; best = id; } }
        (byNode[best] = byNode[best] || []).push(L);
      }
      const t0 = game.t;
      try {
        for (const id in byNode) {
          const list = byNode[id];
          for (let t = 0; t < LIGHT_CYCLE; t += 0.1) {
            game.t = t;
            const green = new Set(list.filter((L) => lightPhase(L) === 'G').map((L) => L.group));
            if (green.size > 1) throw new Error('узел ' + id + ': зелёный у ' + [...green].join(' и ') + ' на t=' + t.toFixed(1)
              + ' (смещения ' + list.map((L) => L.group + '/' + (L.offset || 0)).join(', ') + ')');
          }
        }
      } finally { game.t = t0; }
    }],
    [new RegExp('^засчитано нарушение ' + S + '$'), (code) => {
      if (!ctx.vio) throw new Error('детекторы не запускались');
      if (!ctx.vio.includes(code)) throw new Error('нарушение «' + code + '» не засчитано: [' + ctx.vio.join(', ') + ']');
    }],
    [new RegExp('^нарушения ' + S + ' нет$'), (code) => {
      if (!ctx.vio) throw new Error('детекторы не запускались');
      if (ctx.vio.includes(code)) throw new Error('засчитано «' + code + '»: [' + ctx.vio.join(', ') + ']');
    }],
    [/^заезд засчитан (не )?чистым$/, (not) => {
      if (!ctx.prog1) throw new Error('уровень не пройден — нет шага «уровень пройден»');
      if (ctx.prog1.n !== ctx.prog0.n + 1) throw new Error('пройденных не прибавилось');
      const got = ctx.prog1.clean - ctx.prog0.clean;
      if (not ? got !== 0 : got !== 1) throw new Error('чистых прибавилось ' + got);
    }],
    [/^путь свободен$/, () => {
      if (ctx.gap < 9) throw new Error('окно ' + ctx.gap.toFixed(1) + ' с — путь занят');
    }],
    [new RegExp('^окно (меньше|больше) ' + N + ' секунд[а-я]*$'), (cmp, n) => {
      const ok = cmp === 'меньше' ? ctx.gap < +n : ctx.gap > +n;
      if (!ok) throw new Error('окно ' + ctx.gap.toFixed(1) + ' с, ожидали ' + cmp + ' ' + n);
    }],
  ];

  window.GH_STEP_COUNT = STEPS.length;
  /* текст шага без ключевого слова — тот же шаг под «Дано» и «И» не должен дублироваться */
  window.ghHasStep = (text) => STEPS.some(([re]) => re.test(text));
  window.ghRun = function (steps) {
    for (const k in ctx) delete ctx[k];
    ctx.touches = 0;
    /* замки и аккаунт задаёт сам сценарий: пейволл соседнего сценария не должен протечь сюда */
    delete window.PAYWALL_FORCE; acct = null;
    for (let i = 0; i < steps.length; i++) {
      const text = steps[i];
      const hit = STEPS.find(([re]) => re.test(text));
      if (!hit) return { ok: false, i, step: text, err: 'нет такого шага в словаре' };
      try { hit[1](...text.match(hit[0]).slice(1)); }
      catch (e) { return { ok: false, i, step: text, err: e.message }; }
    }
    return { ok: true };
  };
})();
