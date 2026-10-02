"""Кузов снаружи — меш из констант игры для машины ближе 20 м и своей.

Чистый Python без bpy: его зовут tools/blender/car.py (объект «exterior» в car.blend — посмотреть
глазами; из рендера куба он исключён) и tools/blender/export-exterior.py (build/assets/car-mesh.json).
Меш строится сразу в бюджете граней игры (≈330), поэтому упрощать нечего: прореживание дало бы
длинные треугольники, а их художник сортирует хуже квадов.

Что держит форму и проверяется здесь же (check):
- след на земле — ровно CAR_HULL: самая широкая точка каждого сечения лежит на выпуклой оболочке
  станций CAR_ST, а по ней игра считает касание (hull-check, ≤ 1 см);
- из глаза EYE ничто перед краем капота (HOOD_Z, HOOD_Y) и позади кромки заднего стекла
  (REAR_SILL) не поднимается над линией взгляда на них: по этим двум точкам blindZone считает
  «не видно перед / за», а цифры слепых зон стоят в подсказках уровней;
- сечения салона (стёкла, крыша, стойки) — те же, что у обшивки салона в кубе.
Нос и корма выше прежних (под линией взгляда), плечо над арками поднято до 0,76, арки — вырезы с
подкрылками, фары, фонари, решётка и номера — грани с картинками из build/assets/clean.
"""
import math

ARCH_R = 0.39            # вырез арки: колесо 0,33 и 6 см над ним
LINER_LAT = 0.60         # стенка подкрылка: колесо стоит от 0,67 до 0,89
SHOULDER_MIN = 0.76      # плечо над арками: при прежних 0,70 вырез арки резал плечо у переднего колеса
REAR_SILL = (-1.62, 1.05)  # кромка заднего стекла (z, y) — та же точка, что в blindZone
DECAL = 0.004            # отступ картинки от грани: сортировку решает bias, отступ — от z-конфликта
CAP_SPLIT = 0.30         # торцы режутся по краям решётки: фары и фонари лежат на своей полосе
# bias накладок на торце: торец высотой 0,4 м, и с камеры сверху его центр ближе нижней детали до 0,15 м
CAP_BIAS = 0.20
# нос и корма выше и вертикальнее прежних — по ref-car-sheet; линия взгляда из глаза их не видит
EXT = {
    -2.21: dict(yb=0.40, ys=0.62, be=0.82, wg=0.70, wr=0.58, yt=0.88),
    -2.06: dict(yb=0.32, ys=0.70, be=0.90, wg=0.80, wr=0.68, yt=0.95),
    1.98: dict(yb=0.36, ys=0.66, be=0.82, wg=0.78, wr=0.60),
    2.12: dict(yb=0.34, ys=0.62, be=0.78, wg=0.72, wr=0.56, yt=0.84),
    2.21: dict(yb=0.38, ys=0.56, be=0.74, wg=0.64, wr=0.50, yt=0.78),
}
# вставные сечения: z → подъём верха. Заднее и лобовое стёкла чуть выпуклые, капот — в два шага
EXTRA = {-1.235: 0.030, 0.575: 0.020, 1.125: 0.0, 1.69: 0.0}


def hull2(pts):
    pts = sorted(set(pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def half_width(hull, z):
    """Полуширина выпуклого следа (lat, z) на продольной координате z."""
    best = 0.0
    n = len(hull)
    for i in range(n):
        (a_lat, a_z), (b_lat, b_z) = hull[i], hull[(i + 1) % n]
        if (a_z - z) * (b_z - z) <= 0 and a_z != b_z:
            best = max(best, abs(a_lat + (b_lat - a_lat) * (z - a_z) / (b_z - a_z)))
    return best


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def norm(v):
    length = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / length for x in v)


def newell(pts):
    nx = ny = nz = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    return norm((nx, ny, nz))


class Mesh:
    def __init__(self):
        self.v, self.key, self.f = [], {}, []

    def vid(self, p):
        k = tuple(round(x, 4) for x in p)
        if k not in self.key:
            self.key[k] = len(self.v)
            self.v.append(k)
        return self.key[k]

    def face(self, pts, m, away=None, toward=None, n=None, **extra):
        """Грань с нормалью наружу: от точки away или к точке toward (в кадре кузова)."""
        if n is None:
            n = newell(pts)
            c = tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))
            ref, sgn = (away, 1) if away is not None else (toward, -1)
            if sum((c[i] - ref[i]) * n[i] for i in range(3)) * sgn < 0:
                n = tuple(-x for x in n)
        self.f.append(dict(i=[self.vid(p) for p in pts], m=m, n=[round(x, 4) for x in n], **extra))


def stations(C):
    """Сечения кузова: станции CAR_ST с поправками носа/кормы, полуширина плеча — по следу."""
    hull = hull2([(s * st['w'], st['z']) for st in C['CAR_ST'] for s in (-1, 1)])
    hood_z, hood_y = C['HOOD_Z'], C['HOOD_Y']
    out = []
    for st in C['CAR_ST']:
        s = dict(st)
        s.update(EXT.get(round(st['z'], 2), {}))
        if abs(st['z'] - hood_z) < 1e-6:
            s['yt'] = hood_y
        if -1.75 < st['z'] < 1.75:
            s['ys'] = max(s['ys'], SHOULDER_MIN)
        s['w'] = half_width(hull, st['z'])
        s['green'] = -1.42 - 1e-6 <= st['z'] <= 0.30 + 1e-6
        s['sec'] = section(s)
        out.append(s)
    for z, lift in sorted(EXTRA.items()):
        i = max(k for k, s in enumerate(out) if s['z'] < z)
        a, b = out[i], out[i + 1]
        t = (z - a['z']) / (b['z'] - a['z'])
        sec = [lerp(p, q, t) for p, q in zip(a['sec'], b['sec'])]
        # верх (точки 4 и 5) поднимается на lift — середина стекла выпуклая, как у настоящего
        sec = [(p[0], p[1] + (lift if k >= 4 else 0.0)) for k, p in enumerate(sec)]
        sec[2] = (half_width(hull, z), sec[2][1])
        s = dict(z=z, k=a['k'], green=a['green'] and b['green'], sec=sec, inserted=True)
        out.insert(i + 1, s)
    return out, hull


def section(s):
    """Правая половина сечения снизу вверх: p0 низ порога, p1 порог, p2 плечо (самое широкое),
    p3 пояс, p4 верх борта/стекла, p5 край крыши. Верх между ±p5 — одна грань: с коньком на оси
    половины крыши заливались каждая со своим бликом (вектор взгляда — от центра грани), и по оси
    шёл шов светлее/темнее.
    У салонных станций p4 на 10 см ниже верха, как в CAR_ST (обшивка куба построена по ним);
    у капота и багажника — плавный переход пояс→верх без прежней ступеньки."""
    w, yb, ys, be, wg, wr, yt = (s[k] for k in ('w', 'yb', 'ys', 'be', 'wg', 'wr', 'yt'))
    y4 = yt - 0.10 if s['green'] else be + 0.6 * (yt - be)
    return [(w - 0.10, yb), (w - 0.025, yb + 0.05), (w, ys), (w - 0.03, be), (wg, y4), (wr, yt)]


def edge_mat(kind, e):
    """Материал полосы сечения e (между точками e и e+1) в сегменте kind."""
    if e == 0:
        return 'trim'
    if kind == 'cabin' and e == 3:
        return 'glass'
    if kind == 'pillar' and e == 3:
        return 'trim'
    if kind == 'glass' and e >= 4:  # 4 — скат стекла, 5 — верх между ±p5
        return 'glass'
    return 'paint'


def flank_at(sec, y):
    """Точка на линии борта p1→p2 на высоте y (lat, y)."""
    (x1, y1), (x2, y2) = sec[1], sec[2]
    t = (y - y1) / (y2 - y1)
    return (x1 + (x2 - x1) * t, y)


def sec_at(sts, z):
    i = max(k for k, s in enumerate(sts) if s['z'] <= z + 1e-9)
    if i == len(sts) - 1:
        return sts[i]['sec']
    a, b = sts[i], sts[i + 1]
    t = (z - a['z']) / (b['z'] - a['z'])
    return [lerp(p, q, t) for p, q in zip(a['sec'], b['sec'])]


def nrm2(a, b, side):
    """Нормаль отрезка a→b сечения наружу, в 3D (lat, y, 0)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = norm((dy, -dx))
    if n[0] < 0:
        n = (-n[0], -n[1])
    return norm((n[0] * side, n[1], 0.0))


def avg(a, b):
    return norm(tuple(x + y for x, y in zip(a, b)))


def build(C):
    sts, hull = stations(C)
    m = Mesh()
    car = C['CAR']
    c2r = C['C2R']
    axles = [-c2r, -c2r + car['wheelbase']]
    wheel_r = car['wheelR']
    P = lambda side, q, z: (side * q[0], q[1], z)  # noqa: E731

    # --- лофт: всё, кроме борта p1→p2 (его рисует панель с арками) ---
    for a, b in zip(sts, sts[1:]):
        za, zb = a['z'], b['z']
        for side in (-1, 1):
            for e in (0, 2, 3, 4):
                mat = edge_mat(a['k'], e)
                pts = [P(side, a['sec'][e], za), P(side, a['sec'][e + 1], za), P(side, b['sec'][e + 1], zb), P(side, b['sec'][e], zb)]
                extra = {}
                if e == 2:
                    # верх борта заливается градиентом: от плеча (среднее борта и верха) к поясу
                    na = [avg(nrm2(s['sec'][1], s['sec'][2], side), nrm2(s['sec'][2], s['sec'][3], side)) for s in (a, b)]
                    nb = [nrm2(s['sec'][2], s['sec'][3], side) for s in (a, b)]
                    extra['s'] = [[round(x, 4) for x in avg(*na)], [round(x, 4) for x in avg(*nb)]]
                m.face(pts, mat, away=(0.0, 0.6, (za + zb) / 2), **extra)
        top = [P(-1, a['sec'][5], za), P(1, a['sec'][5], za), P(1, b['sec'][5], zb), P(-1, b['sec'][5], zb)]
        m.face(top, edge_mat(a['k'], 5), away=(0.0, 0.6, (za + zb) / 2))
    # --- торцы: вертикальные плоскости носа и кормы, тремя полосами по lat ±CAP_SPLIT ---
    # одним многоугольником торец сортировался по центру на оси, и фара у его края (на 0,5 м
    # дальше от камеры, смотрящей сбоку) рисовалась под ним: деталь на большой грани проигрывает
    # её центру, а у полосы центр рядом с фарой
    for s, sgn in ((sts[0], -1), (sts[-1], 1)):
        sec = s['sec']
        ring = [(q[0], q[1]) for q in sec] + [(-q[0], q[1]) for q in reversed(sec)]
        for lo, hi in ((-9, -CAP_SPLIT), (-CAP_SPLIT, CAP_SPLIT), (CAP_SPLIT, 9)):
            part = clip_lat(ring, lo, hi)
            if len(part) >= 3:
                m.face([(p[0], p[1], s['z']) for p in part], 'paint', n=(0.0, 0.0, float(sgn)))

    # --- борт p1→p2 с вырезами арок и порог p0→p1 вне арок ---
    cols = sorted({s['z'] for s in sts} | {zc + ARCH_R * math.cos(math.pi * k / 8) for zc in axles for k in range(9)})

    def arch_y(z):
        for zc in axles:
            dz = z - zc
            if abs(dz) < ARCH_R:
                return wheel_r + math.sqrt(ARCH_R * ARCH_R - dz * dz)
        return -1.0
    for side in (-1, 1):
        prev = None
        for z in cols:
            sec = sec_at(sts, z)
            ay = arch_y(z)
            bottom = flank_at(sec, ay) if ay > sec[1][1] else sec[1]
            top = sec[2]
            n_bot = nrm2(sec[1], sec[2], side)
            n_top = avg(nrm2(sec[1], sec[2], side), nrm2(sec[2], sec[3], side))
            cur = dict(z=z, bottom=bottom, top=top, sec=sec, arch=ay > sec[1][1], nb=n_bot, nt=n_top)
            if prev:
                pts = [P(side, prev['bottom'], prev['z']), P(side, prev['top'], prev['z']), P(side, top, z), P(side, bottom, z)]
                s_ = [[round(x, 4) for x in avg(prev['nb'], n_bot)], [round(x, 4) for x in avg(prev['nt'], n_top)]]
                m.face(pts, 'paint', away=(0.0, 0.6, (prev['z'] + z) / 2), s=s_)
                if not prev['arch'] and not cur['arch'] and not (arch_y((prev['z'] + z) / 2) > sec[1][1]):
                    ps, cs = prev['sec'], sec
                    m.face([P(side, ps[0], prev['z']), P(side, ps[1], prev['z']), P(side, cs[1], z), P(side, cs[0], z)],
                           'trim', away=(0.0, 0.6, (prev['z'] + z) / 2))
            prev = cur

    # --- подкрылки: свод над колесом и стенка изнутри, чтобы сквозь арку не было видно насквозь ---
    for zc in axles:
        for side in (-1, 1):
            ring = []
            for k in range(9):
                a_ = math.pi * k / 8
                z = zc + ARCH_R * math.cos(a_)
                y = wheel_r + ARCH_R * math.sin(a_)
                sec = sec_at(sts, z)
                outer = flank_at(sec, max(y, sec[1][1])) if y > sec[1][1] else sec[1]
                ring.append((z, y, outer[0]))
            for (z0, y0, l0), (z1, y1, l1) in zip(ring, ring[1:]):
                pts = [(side * l0, y0, z0), (side * l1, y1, z1), (side * LINER_LAT, y1, z1), (side * LINER_LAT, y0, z0)]
                m.face(pts, 'liner', toward=(side * 0.75, wheel_r, zc))
            wall = [(side * LINER_LAT, y, z) for z, y, _ in ring]
            m.face(wall, 'liner', n=(float(side), 0.0, 0.0))

    decals(m, sts, C)
    smooth(m)
    return m, sts, hull


SMOOTH_DEG = 50          # сглаживаются соседние окрашенные грани, если угол между ними меньше


def smooth(m):
    """Нормали сглаживания для всех окрашенных квадов: у каждого угла грани — среднее нормалей
    соседних окрашенных граней не круче SMOOTH_DEG к ней (капот, крыша и крышка багажника читаются
    гладкими, а кромка капота над торцом остаётся кромкой). Игра заливает грань градиентом от ребра
    v0–v3 к ребру v1–v2, поэтому s — средние по этим рёбрам."""
    cos_t = math.cos(math.radians(SMOOTH_DEG))
    around = {}
    for k, f in enumerate(m.f):
        if f['m'] == 'paint':
            for i in f['i']:
                around.setdefault(i, []).append(k)
    for f in m.f:
        if f['m'] != 'paint' or len(f['i']) != 4:
            continue
        n0 = f['n']
        corner = []
        for i in f['i']:
            acc = [0.0, 0.0, 0.0]
            for k in around[i]:
                n = m.f[k]['n']
                if sum(a * b for a, b in zip(n, n0)) >= cos_t:
                    acc = [a + b for a, b in zip(acc, n)]
            corner.append(norm(acc))
        f['s'] = [[round(x, 4) for x in avg(corner[0], corner[3])], [round(x, 4) for x in avg(corner[1], corner[2])]]


def clip_lat(poly, lo, hi):
    """Многоугольник (lat, y), обрезанный полосой lo ≤ lat ≤ hi (Сазерленд — Ходжмен)."""
    def cut(pts, keep, x0):
        out = []
        for i, p in enumerate(pts):
            q = pts[(i + 1) % len(pts)]
            if keep(p):
                out.append(p)
            if keep(p) != keep(q):
                t = (x0 - p[0]) / (q[0] - p[0])
                out.append((x0, p[1] + (q[1] - p[1]) * t))
        return out
    return cut(cut(poly, lambda p: p[0] >= lo, lo), lambda p: p[0] <= hi, hi)


def chamfer_pt(a, b, t, y):
    """Точка на полосе плеча p2→p3 между сечениями a и b: t — доля пути от a к b, y — высота."""
    def on(s):
        (x2, y2), (x3, y3) = s['sec'][2], s['sec'][3]
        u = (y - y2) / (y3 - y2)
        return (x2 + (x3 - x2) * u, y)
    pa, pb = on(a), on(b)
    return (pa[0] + (pb[0] - pa[0]) * t, y, a['z'] + (b['z'] - a['z']) * t)


def cap_lat(s, y):
    """Край торца (по полосе плеча) на высоте y."""
    (x2, y2), (x3, y3) = s['sec'][2], s['sec'][3]
    return x2 + (x3 - x2) * (y - y2) / (y3 - y2)


def lamp(m, sts, end, y0, y1, lat_in, img, kind, inner_first):
    """Фара или фонарь из двух граней: внутренняя на плоскости торца, наружная — на скосе угла.
    Картинка делится между ними по длине верхней кромки (uv). inner_first: у фары картинка идёт от
    внутреннего торца (линза у решётки), у фонаря — от наружного (белая и жёлтая секции у багажника)."""
    cap, nxt = (sts[-1], sts[-2]) if end > 0 else (sts[0], sts[1])
    z = cap['z'] + end * DECAL
    for side in (-1, 1):
        lat_cap = min(cap_lat(cap, y0), cap_lat(cap, y1))
        inner = [(side * lat_in, y1, z), (side * lat_cap, y1, z), (side * lat_cap, y0, z), (side * lat_in, y0, z)]
        # наружная часть на скосе: от торца до трети следующего сечения, на DECAL наружу по нормали
        t1 = 0.85
        o = [chamfer_pt(cap, nxt, 0.0, y1), chamfer_pt(cap, nxt, t1, y1), chamfer_pt(cap, nxt, t1, y0), chamfer_pt(cap, nxt, 0.0, y0)]
        n = newell([(side * p[0], p[1], p[2]) for p in o])
        if n[0] * side < 0:
            n = tuple(-x for x in n)
        outer = [(side * p[0] + n[0] * DECAL, p[1] + n[1] * DECAL, p[2] + n[2] * DECAL) for p in o]
        len_in = abs(lat_cap - lat_in)
        len_out = math.dist(o[0], o[1])
        split = len_in / (len_in + len_out)
        lamp_id = f'{kind}-{"R" if side > 0 else "L"}'
        if inner_first:
            m.face(inner, 'lamp', n=(0.0, 0.0, float(end)), b=CAP_BIAS, img=img, uv=[0, 0, round(split, 4), 1], lamp=lamp_id)
            m.face(outer, 'lamp', n=n, b=0.03, img=img, uv=[round(split, 4), 0, 1, 1], lamp=lamp_id)
        else:
            # картинка от наружного края: наружная грань — левая часть, внутренняя — правая
            outer_r = [outer[1], outer[0], outer[3], outer[2]]
            inner_r = [inner[1], inner[0], inner[3], inner[2]]
            split = len_out / (len_in + len_out)
            m.face(outer_r, 'lamp', n=n, b=0.03, img=img, uv=[0, 0, round(split, 4), 1], lamp=lamp_id)
            m.face(inner_r, 'lamp', n=(0.0, 0.0, float(end)), b=CAP_BIAS, img=img, uv=[round(split, 4), 0, 1, 1], lamp=lamp_id)


def plate_rect(m, z, end, lat, y0, y1, mat, bias, **extra):
    pts = [(-lat * end, y1, z), (lat * end, y1, z), (lat * end, y0, z), (-lat * end, y0, z)]
    m.face(pts, mat, n=(0.0, 0.0, float(end)), b=bias, **extra)


def decals(m, sts, C):
    zf, zr = sts[-1]['z'] + DECAL, sts[0]['z'] - DECAL
    # перёд: решётка в проёме между фарами (картинка сжата по высоте 1,85 — проём ниже исходника),
    # воздухозаборник и номер под ней, фары в верхних углах с заходом на скос
    plate_rect(m, zf, 1, CAP_SPLIT, 0.565, 0.685, 'grille', CAP_BIAS, img='grille', uv=[0, 0, 1, 1])
    # воздухозаборник шире полосы решётки — тремя кусками, каждый на своей полосе торца
    plate_rect(m, zf, 1, CAP_SPLIT, 0.405, 0.515, 'trim', CAP_BIAS)
    for sg in (-1, 1):
        y0, y1 = 0.405, 0.515
        m.face([(sg * CAP_SPLIT, y1, zf), (sg * 0.46, y1, zf), (sg * 0.46, y0, zf), (sg * CAP_SPLIT, y0, zf)], 'trim', n=(0.0, 0.0, 1.0), b=CAP_BIAS)
    plate_rect(m, zf + 0.002, 1, 0.26, 0.42, 0.53, 'plate', CAP_BIAS + 0.02, img='plate', uv=[0, 0, 1, 1])
    lamp(m, sts, 1, 0.615, 0.735, 0.33, 'headlight', 'head', True)
    # корма: фонари под крышкой багажника, номер по центру, тёмный диффузор внизу
    plate_rect(m, zr, -1, 0.26, 0.56, 0.68, 'plate', CAP_BIAS, img='plate', uv=[0, 0, 1, 1])
    plate_rect(m, zr, -1, CAP_SPLIT, 0.42, 0.48, 'trim', CAP_BIAS)
    lamp(m, sts, -1, 0.705, 0.805, 0.40, 'taillight', 'tail', False)


def check(m, hull, C, tol=0.01):
    """Провалы формы: след шире/уже CAR_HULL больше tol, точка над линией взгляда на капот или
    на кромку заднего стекла. Возвращает (список провалов, сводка)."""
    fails = []
    pts2 = [(v[0], v[2]) for v in m.v]
    mh = hull2(pts2)

    def dist_to_poly(p, poly):
        best = 1e9
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            ax, az, bx, bz = a[0], a[1], b[0], b[1]
            dx, dz = bx - ax, bz - az
            t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz or 1)))
            best = min(best, math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t))
        return best
    dev = max(max(dist_to_poly(p, hull) for p in mh), max(dist_to_poly(p, mh) for p in hull))
    if dev > tol:
        fails.append(f'след модели отходит от CAR_HULL на {dev * 100:.1f} см (порог {tol * 100:.0f})')
    eye = C['EYE']
    ex, ey, ez = eye['lat'], eye['y'], eye['z']
    worst = {'перёд': -1e9, 'зад': -1e9}
    for lat, y, z in m.v:
        dlat, dz = lat - ex, z - ez
        if z > 0.85 and abs(lat) < 0.87:
            edge_z, edge_y, key = C['HOOD_Z'], C['HOOD_Y'], 'перёд'
        elif z < REAR_SILL[0] and abs(lat) < 0.87:
            edge_z, edge_y, key = REAR_SILL[0], REAR_SILL[1], 'зад'
        else:
            continue
        cos_a = abs(dz) / math.hypot(dlat, dz)
        d_edge = abs(edge_z - ez) / max(cos_a, 1e-6)
        over = math.degrees(math.atan2(y - ey, math.hypot(dlat, dz)) - math.atan2(edge_y - ey, d_edge))
        worst[key] = max(worst[key], over)
    for key, over in worst.items():
        if over > 0.05:
            fails.append(f'{key}: точка кузова на {over:.2f}° выше линии взгляда на край (blindZone)')
    return fails, dict(dev_cm=round(dev * 100, 2), over_front=round(worst['перёд'], 2), over_rear=round(worst['зад'], 2),
                       verts=len(m.v), faces=len(m.f))
