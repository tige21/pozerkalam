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

  const STEPS = [
    /* ---------- Дано ---------- */
    [new RegExp('^уровень ' + S + '$'), (name) => {
      loadLevel(levelByName(name)); hideOv(); paused = true;
      ctx.touches = 0;
    }],
    [new RegExp('^кузов в точке \\(' + N + ', ' + N + '\\) курсом ' + N + '°$'), (u, v, th) => {
      setBody(+u, +v, rad(+th)); car.vel = 0;
      for (const o of level.obs) o._touch = false;
      ctx.touches = 0;
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

    [new RegExp('^машина игрока едет вперёд со скоростью ' + N + ' м/с$'), (sp) => {
      car.sel = 'D'; car.gear = 1; car.vel = +sp;
    }],

    /* ---------- Когда ---------- */
    [/^проверяется касание$/, () => {
      const before = level.obs.filter((o) => o._touch).length;
      resolveCollisions(1 / 60);
      const after = level.obs.filter((o) => o._touch).length;
      if (after > before) ctx.touches += after - before;
    }],
    [/^измеряются зазоры$/, () => { ctx.clear = clearances(); }],
    [new RegExp('^игровое время ' + N + ' секунд[а-я]*$'), (t) => { game.t = +t; }],
    [new RegExp('^начислен штраф ' + S + '$'), (code) => { examPenalty(code); }],
    [/^срабатывают детекторы нарушений$/, () => {
      vioEvents.length = 0;
      violationsTick(1 / 60);
      ctx.vio = vioEvents.map((e) => e.code);
    }],
    [/^считается окно в потоке$/, () => { const c = bodyPos(); ctx.gap = trafficGap(c.u, c.v, 6); }],

    /* ---------- Тогда ---------- */
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
