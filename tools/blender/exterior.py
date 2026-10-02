"""Помощники формы кузова: след на земле и линии взгляда своей машины.

Кузова в игре — готовые модели (tools/blender/models.py); здесь — то, чем их проверяют:
- след на земле — ровно CAR_HULL (выпуклая оболочка станций CAR_ST): по нему игра считает касание
  (hull-check, @render-car-footprint, ≤ 1 см);
- из глаза EYE ничто перед краем капота (HOOD_Z, HOOD_Y) и позади кромки заднего стекла (REAR_SILL) не
  поднимается над линией взгляда на них: по этим двум точкам blindZone считает «не видно перед / за»,
  а цифры слепых зон стоят в подсказках уровней;
- лобовое и заднее стекло обрамлены стойками — ни одной общей вершины с боковыми стёклами.
"""
import math

LENGTH_HALF = 2.21       # полудлина кузова — CAR.length / 2, по ней же идёт след
REAR_SILL = (-1.62, 1.05)  # кромка заднего стекла (z, y) — та же точка, что в blindZone


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


def norm(v):
    length = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / length for x in v)


def area(pts):
    ax = ay = az = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        ax += p[1] * q[2] - p[2] * q[1]
        ay += p[2] * q[0] - p[0] * q[2]
        az += p[0] * q[1] - p[1] * q[0]
    return 0.5 * math.sqrt(ax * ax + ay * ay + az * az)


def newell(pts):
    nx = ny = nz = 0.0
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        nx += (p[1] - q[1]) * (p[2] + q[2])
        ny += (p[2] - q[2]) * (p[0] + q[0])
        nz += (p[0] - q[0]) * (p[1] + q[1])
    return norm((nx, ny, nz))


class Mesh:
    def __init__(self, min_area=1e-4):
        self.v, self.key, self.f, self.min_area = [], {}, [], min_area

    def vid(self, p):
        k = tuple(round(x, 3) for x in p)
        if k not in self.key:
            self.key[k] = len(self.v)
            self.v.append(k)
        return self.key[k]

    def face(self, pts, m, away=None, toward=None, n=None, **extra):
        """Грань с нормалью наружу: от точки away или к точке toward (в кадре кузова) или заданной n.
        Грань меньше min_area не выдаётся: вырожденная грань стоит рендеру заливку и ничего не рисует."""
        if area(pts) < self.min_area:
            return
        if n is None:
            n = newell(pts)
            c = tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))
            ref, sgn = (away, 1) if away is not None else (toward, -1)
            if sum((c[i] - ref[i]) * n[i] for i in range(3)) * sgn < 0:
                n = tuple(-x for x in n)
        self.f.append(dict(i=[self.vid(p) for p in pts], m=m, n=[round(x, 3) for x in n], **extra))


def check(m, hull, C, tol=0.01, sightlines=True, glass_front=0.85):
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
        if z > glass_front and abs(lat) < 0.87:
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
        if sightlines and over > 0.05:
            fails.append(f'{key}: точка кузова на {over:.2f}° выше линии взгляда на край (blindZone)')
    # лобовое и заднее стекло обрамлены стойками: ни одной общей вершины с боковыми стёклами — иначе
    # стекло обтекает угол сплошной лентой, и окна читаются кривыми (так и было на первом кузове с чертежа)
    top_glass = {i for f in m.f if f['m'] == 'glass' and abs(f['n'][0]) < 0.5 for i in f['i']}
    side_glass = {i for f in m.f if f['m'] == 'glass' and abs(f['n'][0]) >= 0.5 for i in f['i']}
    if top_glass and side_glass and top_glass & side_glass:
        fails.append(f'лобовое или заднее стекло касается бокового: {len(top_glass & side_glass)} общих вершин — нет стойки')
    return fails, dict(dev_cm=round(dev * 100, 2), over_front=round(worst['перёд'], 2), over_rear=round(worst['зад'], 2),
                       verts=len(m.v), faces=len(m.f))
