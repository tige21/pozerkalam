/* Герой лендинга: параллельная парковка, проматываемая скроллом.
   Траектория не нарисована на глаз: это тот же кинематический велосипед, что и в
   игре, с её же величинами — радиус задней оси 3,84 м, кузов 4,42 x 1,80 м,
   колёсная база 2,6 м. Поэтому точка «45 градусов» на экране стоит там же, где
   ученик увидит её в тренажёре и в машине. */

const WB = 2.6;
const RLOCK = 3.84;
const DMAX = Math.atan(WB / RLOCK);
const CAR_L = 4.42;
const CAR_W = 1.8;
const OV_R = 0.75;

/* Остановка перед манёвром — на 0,42 м ПОЗАДИ кормы передней машины, ровно как в
   показе первого уровня тренажёра. Встать бампер в бампер нельзя: при 6,4-метровом
   кармане и кузове 4,42 м второй дугой нос проходит сквозь соседа. Окно узкое — от
   −0,22 до −0,62 м, дальше корма достаёт заднего соседа; в середине окна зазор 20 см. */
const START_BACK = 0.42;
const POCKET_A = 10.0;
const POCKET_LEN = 6.4;
const POCKET_B = POCKET_A - POCKET_LEN;
const Y_PARK = 0.95;
const Y_LANE = 3.55;
const Y_ROAD = 9.4;
const Y_FAR = Y_ROAD - Y_PARK;
const PHI = (45 * Math.PI) / 180;

/* Полоса мира, которая обязана попасть в кадр: тротуар, проезжая часть и немного
   встречной. Вдоль улицы кадр не ограничен — дорога уходит за края. */
const BAND_LO = -2.2;
const BAND_HI = 8.3;
const ACT_LO = 1.4;
const ACT_HI = 15.6;

const C = {
  walk: '#0e141b',
  road: '#191f28',
  kerbTop: '#8d9cad',
  kerbFace: '#4a5563',
  line: 'rgba(236,243,250,.52)',
  pocketFill: 'rgba(159,208,255,.07)',
  pocketLine: 'rgba(159,208,255,.42)',
  body: '#39434f',
  bodyTop: '#495563',
  glass: '#232a33',
  ego: '#dde6ef',
  egoTop: '#f2f7fb',
  egoGlass: '#8497aa',
  tyre: '#0d1116',
  tail: '#f4626f',
  head: '#fff4d6',
  fwd: '#4ade80',
  rev: '#ff9636',
  beam: '#9fd0ff',
  mark: '#ffd63c',
  shadow: 'rgba(0,0,0,.42)',
};

function buildPath() {
  const dt = 0.02;
  const pts = [];
  let x = 2.4;
  let y = Y_LANE;
  let th = 0;
  let steer = 0;

  const push = (gear, phase) => pts.push({ x, y, th, gear, steer, phase });
  const step = (v, d) => {
    x += v * Math.cos(th) * dt;
    y += v * Math.sin(th) * dt;
    th += ((v * Math.tan(d)) / WB) * dt;
  };

  while (x < POCKET_A + OV_R - START_BACK) {
    step(2.1, 0);
    push(1, 0);
  }
  for (let i = 0; i < 30; i++) {
    steer = Math.min(1, steer + 1 / 30);
    push(0, 1);
  }
  while (th < PHI) {
    step(-1.0, -DMAX);
    push(-1, 2);
  }
  for (let i = 0; i < 12; i++) {
    steer = Math.max(0, steer - 1 / 12);
    push(-1, 3);
  }
  let run = 0;
  while (run < 0.5) {
    step(-1.0, 0);
    run += 0.02;
    push(-1, 3);
  }
  for (let i = 0; i < 16; i++) {
    steer = Math.max(-1, steer - 2 / 16);
    push(-1, 4);
  }
  while (th > 0.004) {
    step(-1.0, DMAX);
    push(-1, 4);
  }
  for (let i = 0; i < 12; i++) {
    steer = Math.min(0, steer + 1 / 12);
    push(0, 5);
  }
  th = 0;
  const target = POCKET_B + (POCKET_LEN - CAR_L) / 2 + OV_R;
  while (x < target) {
    step(0.7, 0);
    push(1, 5);
  }
  for (let i = 0; i < 26; i++) push(0, 6);
  return pts;
}

const PATH = buildPath();

/* Реплики привязаны к фазам траектории, поэтому текст не может разойтись с тем,
   что происходит на экране. */
const STEPS = [
  { t: 'Зеркала вровень', a: 'Едешь вдоль ряда в 0,8 м: твоё зеркало против его зеркала, твоя корма — на полметра позади его кормы. Стоп.', g: 'D', w: 'прямо' },
  { t: 'Точка 1', a: 'Руль вправо до упора, медленно назад. Корма пошла в карман.', g: 'R', w: 'вправо до упора' },
  { t: 'Точка 2', a: 'Встал под 45°: в зеркале появился угол задней машины. Руль прямо, назад ещё полметра.', g: 'R', w: 'прямо' },
  { t: 'Точка 3', a: 'Руль влево до упора — нос заходит следом за кормой.', g: 'R', w: 'влево до упора' },
  { t: 'Доводка', a: 'Встал вдоль бордюра — выпрямись и подай вперёд, на середину кармана.', g: 'D', w: 'прямо' },
  { t: 'Готово', a: 'До бордюра пять сантиметров, спереди и сзади поровну.', g: 'P', w: 'прямо' },
];

/* Ряд стоящих машин: два соседа кармана плюс по паре за кадром, чтобы улица
   не обрывалась на краю. */
const ROW = [
  POCKET_A + OV_R,
  POCKET_A + OV_R + CAR_L + 0.7,
  POCKET_A + OV_R + 2 * (CAR_L + 0.7),
  POCKET_B - CAR_L + OV_R,
  POCKET_B - 2 * CAR_L - 0.7 + OV_R,
  POCKET_B - 3 * CAR_L - 1.4 + OV_R,
];
/* Ряд у противоположного бордюра — просто улица, по нему не паркуются. */
const ROW_FAR = [-1.6, 3.9, 9.2, 14.8, 20.1];

const MARK_PHASES = [2, 3, 4];
const MARK_AT = MARK_PHASES.map((ph) => PATH.findIndex((p) => p.phase === ph));

/* Фазы 0 и 1 (заезд вдоль ряда и остановка по зеркалам) делят одну реплику: обе идут в D
   с прямым рулём, поэтому объединение не расходится ни с картинкой, ни с телеметрией. */
function stepOf(p) {
  return p.phase === 0 ? 0 : Math.min(STEPS.length - 1, p.phase - 1);
}

/* Каждой реплике — равная доля прокрутки. Без этого доля считалась длиной участка пути:
   замер на 1440×900 дал «Зеркала вровень» 315 px, «Точку 2» 30 px, а «Готово» не
   показывалось вовсе — прокрутка кончалась раньше. Доворот на 45° и есть главный ориентир
   методики, и он пролетал за полщелчка колеса. Машина внутри реплики едет чуть неравномерно
   (короткие участки растянуты, длинный заезд сжат), зато читается каждая. */
const STEP_SPAN = STEPS.map((_, k) => {
  let a = -1;
  let b = -1;
  for (let i = 0; i < PATH.length; i++) {
    if (stepOf(PATH[i]) !== k) continue;
    if (a < 0) a = i;
    b = i;
  }
  return a < 0 ? null : { a, b };
});

function indexAt(t) {
  const n = STEPS.length;
  const k = Math.min(n - 1, Math.floor(t * n));
  const seg = STEP_SPAN[k];
  if (!seg) return Math.min(PATH.length - 1, Math.round(t * (PATH.length - 1)));
  const u = Math.min(1, Math.max(0, t * n - k));
  return Math.round(seg.a + (seg.b - seg.a) * u);
}

function corners(p, len = CAR_L, wid = CAR_W, back = OV_R) {
  const c = Math.cos(p.th);
  const s = Math.sin(p.th);
  const hw = wid / 2;
  const a = -back;
  const b = len - back;
  return [
    [p.x + b * c - hw * s, p.y + b * s + hw * c],
    [p.x + b * c + hw * s, p.y + b * s - hw * c],
    [p.x + a * c + hw * s, p.y + a * s - hw * c],
    [p.x + a * c - hw * s, p.y + a * s + hw * c],
  ];
}

/* геометрия наружу — для tools/park-path-check.mjs: показ на лендинге обязан
   проезжать мимо соседей, и это проверяется, а не проверяется на глаз */
export { PATH, ROW, corners, CAR_L, CAR_W, OV_R, POCKET_A, POCKET_B, POCKET_LEN, Y_PARK, START_BACK };

export function mount(root) {
  const canvas = root.querySelector('.hero-canvas');
  const stage = root.querySelector('.hero-stage');
  const cardT = root.querySelector('[data-step-title]');
  const cardA = root.querySelector('[data-step-act]');
  const telKerb = root.querySelector('[data-tel="kerb"]');
  const telRear = root.querySelector('[data-tel="rear"]');
  const telWheel = root.querySelector('[data-tel="wheel"]');
  const telGear = root.querySelector('[data-tel="gear"]');
  const wheelIcon = root.querySelector('.hero-wheel');
  const progress = root.querySelector('.hero-prog i');
  if (!canvas || !stage) return;

  const ctx = canvas.getContext('2d');
  if (!ctx || !ctx.roundRect) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let shownStep = -1;
  let V = null;
  let copyBottom = 0;

  function resize() {
    const r = stage.getBoundingClientRect();
    const copy = root.querySelector('.hero-copy');
    if (copy) {
      copyBottom = copy.offsetTop + copy.offsetHeight;
      root.style.setProperty('--scrim-a', copyBottom + 8 + 'px');
      root.style.setProperty('--scrim-b', copyBottom + 44 + 'px');
    }
    dpr = Math.min(2, devicePixelRatio || 1);
    W = Math.max(320, Math.round(r.width));
    H = Math.max(300, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }

  /* Улица лежит поперёк широкого экрана и вдоль узкого: на телефоне манёвр идёт
     снизу вверх, и все 14 метров помещаются без сжатия. */
  /* Вписать поперечную полосу мира [y0,y1] в полосу экрана [top,bottom].
     Явная посадка вместо подгонки коэффициентов: её видно и можно проверить. */
  function fitBand(y0, y1, top, bottom, kMax) {
    const k = Math.min((bottom - top) / (y1 - y0), kMax);
    return { k, oy: (top + bottom) / 2 + ((y0 + y1) / 2) * k };
  }

  /* Пока держится заголовок, кадр показывает не всю улицу, а полосу под текстом:
     свою полосу движения и ряд у бордюра. Первый экран обязан показывать продукт,
     а не пустой асфальт. Когда копия ушла — вид отъезжает на всю улицу. */
  function setView(open) {
    const portrait = H > W * 1.15;
    const mix = (a, b) => a + (b - a) * open;
    if (portrait) {
      const k = (W * 0.96) / (Y_ROAD + 5.2);
      V = { portrait, k, ox: W * 0.5 + (Y_ROAD / 2) * k, oy: mix(H * 0.72, H * 0.52) + 8.3 * k };
      return;
    }
    const kMax = (W * 0.98) / 21;
    const stripTop = Math.min(copyBottom + 44, H * 0.58);
    const shut = fitBand(-1.8, 7.2, stripTop, H, kMax);
    const wide = fitBand(-2.4, Y_ROAD + 2.4, H * 0.09, H * 0.93, kMax);
    const k = mix(shut.k, wide.k);
    V = { portrait, k, ox: W * 0.5 - 8.5 * k, oy: mix(shut.oy, wide.oy) };
  }

  const SX = (X, Y) => (V.portrait ? V.ox - Y * V.k : V.ox + X * V.k);
  const SY = (X, Y) => (V.portrait ? V.oy - X * V.k : V.oy - Y * V.k);

  /* Полоса мира поперёк улицы, залитая на весь кадр вдоль неё. */
  function band(y0, y1, fill) {
    ctx.fillStyle = fill;
    if (V.portrait) {
      const a = SX(0, y1);
      ctx.fillRect(a, -10, (y1 - y0) * V.k, H + 20);
    } else {
      const a = SY(0, y1);
      ctx.fillRect(-10, a, W + 20, (y1 - y0) * V.k);
    }
  }

  function lineAlong(y, dash, col, lw) {
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    if (V.portrait) {
      ctx.moveTo(SX(0, y), -10);
      ctx.lineTo(SX(0, y), H + 10);
    } else {
      ctx.moveTo(-10, SY(0, y));
      ctx.lineTo(W + 10, SY(0, y));
    }
    ctx.stroke();
    ctx.restore();
  }

  function path2(pts) {
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(SX(q[0], q[1]), SY(q[0], q[1])) : ctx.moveTo(SX(q[0], q[1]), SY(q[0], q[1]))));
    ctx.closePath();
  }

  function fillPoly(pts, fill) {
    path2(pts);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function roundBody(pts, r, fill) {
    const s = pts.map((q) => [SX(q[0], q[1]), SY(q[0], q[1])]);
    ctx.beginPath();
    ctx.moveTo((s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2);
    for (let i = 0; i < 4; i++) {
      const a = s[(i + 1) % 4];
      const b = s[(i + 2) % 4];
      ctx.arcTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, r);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /* Локальная рамка кузова: dx вдоль машины от задней оси, dy влево. */
  function rect(p, x0, x1, y0, y1) {
    const c = Math.cos(p.th);
    const s = Math.sin(p.th);
    const P = (a, b) => [p.x + a * c - b * s, p.y + a * s + b * c];
    return [P(x1, y1), P(x1, y0), P(x0, y0), P(x0, y1)];
  }

  function drawCar(p, ego) {
    const k = V.k;
    roundBody(corners({ x: p.x + 0.2, y: p.y - 0.2, th: p.th }), Math.max(2, k * 0.17), C.shadow);

    const st = ego ? p.steer * DMAX : 0;
    const c = Math.cos(p.th);
    const s2 = Math.sin(p.th);
    const wheel = (ax, ay, ang) => {
      roundBody(
        corners({ x: p.x + ax * c - ay * s2, y: p.y + ax * s2 + ay * c, th: p.th + ang }, 0.62, 0.2, 0.31),
        Math.max(1.5, k * 0.05),
        C.tyre
      );
    };
    const hw = CAR_W / 2 - 0.06;
    wheel(0, hw, 0);
    wheel(0, -hw, 0);
    wheel(WB, hw, st);
    wheel(WB, -hw, st);

    const mir = (side) => fillPoly(rect(p, 2.72, 3.0, side * (CAR_W / 2), side * (CAR_W / 2 + 0.19)), ego ? C.ego : C.body);
    mir(1);
    mir(-1);

    roundBody(corners(p), Math.max(2.5, k * 0.18), ego ? C.ego : C.body);
    const gh = CAR_W / 2 - 0.2;
    fillPoly(rect(p, 1.12, 2.58, -gh, gh), ego ? C.egoTop : C.bodyTop);
    fillPoly(rect(p, 2.58, 3.22, -gh + 0.06, gh - 0.06), ego ? C.egoGlass : C.glass);
    fillPoly(rect(p, 0.48, 1.12, -gh + 0.08, gh - 0.08), ego ? C.egoGlass : C.glass);

    fillPoly(rect(p, -OV_R + 0.05, -OV_R + 0.2, -CAR_W / 2 + 0.14, CAR_W / 2 - 0.14), C.tail);
    if (ego) fillPoly(rect(p, CAR_L - OV_R - 0.2, CAR_L - OV_R - 0.05, -CAR_W / 2 + 0.14, CAR_W / 2 - 0.14), C.head);
  }

  /* Рамка габаритов — та же, что игра рисует по контуру столкновений: передняя
     кромка жёлтая, задняя оранжевая, ближний к бордюру угол краснеет. */
  function drawRefs(p) {
    const cs = corners(p);
    ctx.setLineDash([]);
    path2(cs);
    ctx.strokeStyle = 'rgba(159,208,255,.55)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    const edge = (a, b, col) => {
      ctx.beginPath();
      ctx.moveTo(SX(cs[a][0], cs[a][1]), SY(cs[a][0], cs[a][1]));
      ctx.lineTo(SX(cs[b][0], cs[b][1]), SY(cs[b][0], cs[b][1]));
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      ctx.stroke();
    };
    edge(0, 1, C.mark);
    edge(2, 3, C.rev);
    let worst = 0;
    for (let i = 1; i < 4; i++) if (cs[i][1] < cs[worst][1]) worst = i;
    if (cs[worst][1] < 1.1) {
      ctx.beginPath();
      ctx.arc(SX(cs[worst][0], cs[worst][1]), SY(cs[worst][0], cs[worst][1]), Math.max(3, V.k * 0.1), 0, 7);
      ctx.fillStyle = C.tail;
      ctx.fill();
    }
  }

  function strokeRoute(from, to, alpha, width, glow) {
    let seg = null;
    ctx.save();
    if (glow) ctx.shadowBlur = width * 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    for (let j = from; j <= to; j += 3) {
      const q = PATH[j];
      if (!q || !q.gear) continue;
      if (!seg || seg !== q.gear) {
        if (seg) ctx.stroke();
        seg = q.gear;
        ctx.beginPath();
        ctx.strokeStyle = q.gear > 0 ? C.fwd : C.rev;
        if (glow) ctx.shadowColor = q.gear > 0 ? 'rgba(74,222,128,.45)' : 'rgba(255,150,54,.45)';
        ctx.moveTo(SX(q.x, q.y), SY(q.x, q.y));
      } else ctx.lineTo(SX(q.x, q.y), SY(q.x, q.y));
    }
    if (seg) ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* Точки 2 и 3 разделяет полметра — на общем плане их кружки налезали друг на
     друга, поэтому крупная и подписанная только та, которую машина проходит
     сейчас; остальные остаются мелкими засечками. */
  function drawMarks(i) {
    let live = -1;
    MARK_AT.forEach((at, n) => {
      if (at >= 0 && i >= at) live = n;
    });
    MARK_AT.forEach((at, n) => {
      if (at < 0) return;
      const q = PATH[at];
      const x = SX(q.x, q.y);
      const y = SY(q.x, q.y);
      const big = n === live;
      const r = big ? Math.max(12, V.k * 0.3) : Math.max(3.5, V.k * 0.085);
      if (big) {
        ctx.beginPath();
        ctx.arc(x, y, r + 6, 0, 7);
        ctx.fillStyle = 'rgba(159,208,255,.13)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.fillStyle = big ? C.beam : i >= at ? 'rgba(159,208,255,.55)' : 'rgba(159,208,255,.22)';
      ctx.fill();
      if (!big) return;
      ctx.fillStyle = '#0a141f';
      ctx.font = `700 ${Math.round(r * 1.06)}px Onest, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n + 1), x, y + r * 0.06);
    });
  }

  function drawScene(i, showRefs) {
    const p = PATH[i];
    band(-40, 0, C.walk);
    band(0, Y_ROAD, C.road);
    band(Y_ROAD, 40, C.walk);
    band(-0.17, 0, C.kerbTop);
    band(0, 0.05, C.kerbFace);
    band(Y_ROAD, Y_ROAD + 0.17, C.kerbTop);
    band(Y_ROAD - 0.05, Y_ROAD, C.kerbFace);
    lineAlong(Y_ROAD / 2, [V.k * 2.2, V.k * 1.8], C.line, Math.max(1.4, V.k * 0.1));

    fillPoly(
      [
        [POCKET_B, 0.06],
        [POCKET_A, 0.06],
        [POCKET_A, 1.9],
        [POCKET_B, 1.9],
      ],
      C.pocketFill
    );
    ctx.save();
    ctx.setLineDash([V.k * 0.34, V.k * 0.28]);
    path2([
      [POCKET_B, 0.06],
      [POCKET_A, 0.06],
      [POCKET_A, 1.9],
      [POCKET_B, 1.9],
    ]);
    ctx.strokeStyle = C.pocketLine;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    strokeRoute(0, PATH.length - 1, 0.2, Math.max(1.4, V.k * 0.05), false);
    strokeRoute(0, i, 0.95, Math.max(2.2, V.k * 0.085), true);

    for (const x of ROW_FAR) drawCar({ x, y: Y_FAR, th: Math.PI }, false);
    for (const x of ROW) drawCar({ x, y: Y_PARK, th: 0 }, false);
    drawMarks(i);
    drawCar(p, true);
    if (showRefs) drawRefs(p);

    let gapK = Infinity;
    for (const c of corners(p)) gapK = Math.min(gapK, c[1]);
    return { gapK, p };
  }

  function paint(prog) {
    const open = reduce ? 1 : Math.min(1, Math.max(0, (prog - 0.02) / 0.14));
    const t = reduce ? 1 : Math.min(1, Math.max(0, (prog - 0.09) / 0.87));
    const i = indexAt(t);

    setView(open);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { gapK, p } = drawScene(i, open > 0.5);

    const st = stepOf(p);
    if (st !== shownStep) {
      shownStep = st;
      const s = STEPS[st];
      if (cardT) cardT.textContent = s.t;
      if (cardA) cardA.textContent = s.a;
      if (telGear) {
        telGear.textContent = s.g;
        telGear.style.color = s.g === 'R' ? C.tail : s.g === 'D' ? C.fwd : C.beam;
      }
      if (telWheel) telWheel.textContent = s.w;
    }
    if (wheelIcon) wheelIcon.style.transform = `rotate(${p.steer * 100}deg)`;
    if (telKerb) telKerb.textContent = (gapK < 0 ? 0 : gapK).toFixed(2).replace('.', ',');
    if (telRear) {
      const back = Math.min(...corners(p).map((c) => c[0]));
      const d = back - (POCKET_B - 0.02);
      telRear.textContent = (d > 3 ? 3 : d < 0 ? 0 : d).toFixed(2).replace('.', ',') + (d > 3 ? '+' : '');
    }
    if (progress) progress.style.transform = `scaleX(${t})`;
    root.classList.toggle('open', open > 0.55);
  }

  let raf = 0;
  let last = -1;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = root.getBoundingClientRect();
      const span = root.offsetHeight - stage.offsetHeight;
      const prog = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      if (Math.abs(prog - last) < 0.0004) return;
      last = prog;
      paint(prog);
    });
  }

  resize();
  paint(0);
  const refresh = () => {
    resize();
    shownStep = -1;
    last = -1;
    onScroll();
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);
  if (window.ResizeObserver) {
    const copy = root.querySelector('.hero-copy');
    if (copy) new ResizeObserver(refresh).observe(copy);
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => {
    resize();
    shownStep = -1;
    last = -1;
    onScroll();
  });
  root.classList.add('ready');
}
