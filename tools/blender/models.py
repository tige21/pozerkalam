"""Кузова машин — готовые модели RgsDev (CC0, assets/src/models/rgsdev) → build/assets/car-mesh.json.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/models.py

Самодельные кузова владелец назвал «мятой бумагой»: ~300 граней по сечениям не дают формы машины, а
картинки с чертежей на них ложились заплатками. Здесь — готовые модели из бесплатного набора Free Low
Poly Vehicles Pack (Raphael Gonçalves, Rgsdev; CC0, автора указывать не обязательно): седан, хэтчбек и
кроссовер. Модели раскрашены материалами без текстур — это и нужно рендеру игры (грань — один цвет).

Модель масштабируется целиком — один множитель на ось, форма как в референсе. Первая версия гнула
её местами (свой множитель на каждое сечение, две полосы по высоте, ломаная по длине), чтобы след лёг
на прежний CAR_HULL, и владелец увидел, что машины «плывут»: нос растягивался в 2,4 раза, фары на нём
расползались. Теперь наоборот — след касаний берётся из модели (hull в JSON, игра ставит его в CAR_HULL
и в след чужих машин), а широкая проверка и датчики остаются на прямоугольнике 4,42 × 1,80 (по нему
откалиброваны демо): модель вписана ровно в него.
- поперёк — ширина кузова без зеркал = 1,80; по длине — длина без номера = 4,42; по высоте — колесо
  модели = колесо игры (CAR.wheelR), иначе колесо игры пробивало бы арку или висело в ней;
- колёса выкинуты — игра рисует свои (поворот, диски стилей) на осях модели (axles в JSON, это только
  рисунок: физика считает по осям CAR); зеркала выкинуты — у игры свой корпус MIR_H, по нему
  настраивают зеркала;
- номер выступал перед бампером на 2 см — он сдвинут на бампер (наклейка с bias), иначе он был бы
  самой передней точкой и вышел бы за прямоугольник;
- выхлопные трубы — отдельные детали длиной 37 см, торчащие из бампера на 4 см: рендер с сортировкой
  граней не умеет детали, вставленные одна в другую, и рисовал трубу целиком поверх бампера (а вторую —
  целиком под ним). Труба заменена чёрным торцом-наклейкой на бампере, как номер, и в длину и след не
  входит;
- у седана (своя машина) — линии взгляда на край капота и кромку заднего стекла: по ним blindZone
  считает «не видно перед / за». Модель набора выше настоящего седана (1,61 м при ширине 1,80, капот
  на 1,01), и из глаза EYE капот закрыл бы дорогу на 10 м вместо 5,4. Снаружи седан остаётся как в
  референсе, а из салона игра рисует свою машину ниже — одним множителем высоты cabinK (из салона
  виден только капот, остальное закрывает куб салона); cabinK — наибольший, при котором капот и
  багажник не выше линий взгляда.
"""
import json
import math
import pathlib
import sys

import bmesh
import bpy
import mathutils

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import exterior  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'assets' / 'src' / 'models' / 'rgsdev'
CONSTS = ROOT / 'build' / 'blender' / 'consts.json'
OUT = ROOT / 'build' / 'assets' / 'car-mesh.json'
BODIES = {'sedan': 'Sedan', 'hatch': 'Hatchback', 'cross': 'SUV'}
LH = 2.21                     # полудлина — CAR.length / 2
MIRROR_X = 1.16               # у моделей набора кузов не шире 1,141; всё, что шире, — зеркала
PAINT = ('body grey', 'body dark yellow', 'body dark purple')
DECAL_B = 0.02                # bias фар, фонарей и номеров: они лежат на грани кузова
MAX_POLY = 48                 # вершин в грани не больше: игра держит заготовки массивов на грань (carModel.scratch)


def log(m):
    print('[models] ' + m, flush=True)


def srgb(c):
    return [int(round(255 * (1.055 * v ** (1 / 2.4) - 0.055 if v > 0.0031308 else 12.92 * v))) for v in c[:3]]


def load(fname):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(SRC / f'{fname}.fbx'))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    body = next(o for o in objs if 'wheel' not in o.name.lower())
    wheels = [o for o in objs if 'wheel' in o.name.lower()]
    wy, wr, wz, wx = [], [], [], []
    for o in wheels:
        bb = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        wx.append(abs(sum(p.x for p in bb) / 8))
        wy.append(sum(p.y for p in bb) / 8)
        wz.append(sum(p.z for p in bb) / 8)
        wr.append((max(p.z for p in bb) - min(p.z for p in bb)) / 2)
    front_y = min(wy)
    rear_y = max(wy)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    mats = [s.material for s in body.material_slots]
    return bm, mats, dict(front_y=front_y, rear_y=rear_y, zc=sum(wz) / len(wz), r=sum(wr) / len(wr), x=sum(wx) / len(wx))


def drop_mirrors(bm):
    """Зеркала входят в меш кузова: убирается каждая грань, у которой хоть одна вершина шире кузова. По
    центру грани оставалось основание зеркала — срез у стойки A выходил шире на 8 %, и подгонка следа
    сужала там весь кузов."""
    gone = [f for f in bm.faces if any(abs(v.co.x) > MIRROR_X for v in f.verts)]
    n = len(gone)
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    return n


def exhausts(bm, name_of):
    """Выхлопные трубы — свободные детали из чёрного материала у кормы (ни одной общей вершины с
    остальным кузовом). Удаляются из меша; возвращаются контуры их торцов (x, z) и y торца."""
    black = {f for f in bm.faces if name_of(f) == 'body black'}
    seen, caps, gone = set(), [], []
    yc = (min(v.co.y for v in bm.verts) + max(v.co.y for v in bm.verts)) / 2
    for f0 in black:
        if f0 in seen:
            continue
        isl, stack = [], [f0]
        seen.add(f0)
        while stack:
            f = stack.pop()
            isl.append(f)
            for v in f.verts:
                for h in v.link_faces:
                    if h in black and h not in seen:
                        seen.add(h)
                        stack.append(h)
        vs = {v for f in isl for v in f.verts}
        loose = all(all(h in black for h in v.link_faces) for v in vs)
        if not loose or min(v.co.y for v in vs) < yc:
            continue
        tip = max(v.co.y for v in vs)
        caps.append((exterior.hull2([(round(v.co.x, 4), round(v.co.z, 4)) for v in vs if v.co.y > tip - 1e-3]), tip))
        gone.extend(isl)
    bmesh.ops.delete(bm, geom=gone, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    return caps


def surface_z(m, lat, y, kinds=('paint', 'trim')):
    """Самая задняя точка кузова на прямой (lat, y) вдоль машины — поверхность бампера за трубой;
    (z, центр грани бампера) или None."""
    best = None
    for f in m.f:
        if f['m'] not in kinds or abs(f['n'][2]) < 0.2:
            continue
        pts = [m.v[i] for i in f['i']]
        inside = False
        for i in range(len(pts)):
            a, b = pts[i], pts[i - 1]
            if (a[1] > y) != (b[1] > y) and lat < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]):
                inside = not inside
        if not inside:
            continue
        n, p0 = f['n'], pts[0]
        z = p0[2] - (n[0] * (lat - p0[0]) + n[1] * (y - p0[1])) / n[2]
        if best is None or z < best[0]:
            best = (z, tuple(sum(q[k] for q in pts) / len(pts) for k in range(3)))
    return best


def build(C, body):
    fname = BODIES[body]
    bm, mats, wh = load(fname)
    dropped = drop_mirrors(bm)
    name_of = lambda f: mats[f.material_index].name if mats[f.material_index] else ''  # noqa: E731
    caps = exhausts(bm, name_of)
    # грани одной плоскости и одного материала склеиваются: у модели панели порезаны на квады, и без
    # склейки граней было 380–470 на кузов — на телефоне +1,2–1,7 мс JS на кадр уровня 1. Вид тот же:
    # рендер заливает грань одним цветом, а многоугольник (и вогнутый) он рисует как есть
    n0 = len(bm.faces)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts[:], edges=bm.edges[:], delimit={'MATERIAL'})
    merged = n0 - len(bm.faces)
    car = C['CAR']
    plate_v = {v for f in bm.faces if name_of(f) == 'body white' for v in f.verts}
    body_v = [v for v in bm.verts if v not in plate_v]
    y_front, y_rear = min(v.co.y for v in body_v), max(v.co.y for v in body_v)
    w_m = max(abs(v.co.x) for v in body_v)
    yc = (y_front + y_rear) / 2
    sx = (car['width'] / 2) / w_m
    sz = (2 * LH) / (y_rear - y_front)
    sy = car['wheelR'] / wh['r']
    for v in plate_v:
        v.co.y = min(max(v.co.y, y_front + 1e-4), y_rear - 1e-4)
    # кадр игры: lat = −x (перёд модели — −y, правый борт — −x), вверх = z, вперёд = −y
    tr = lambda co: (-co.x * sx, co.z * sy, -(co.y - yc) * sz)  # noqa: E731
    pos = {v: tr(v.co) for v in bm.verts}
    own = body == 'sedan'
    glass_front = max(pos[v][2] for f in bm.faces if name_of(f) == 'windows' for v in f.verts)
    m = exterior.Mesh(min_area=1e-6)
    lamps = {'headlights': 'head', 'rear lights': 'tail'}
    plates = {}
    for f in bm.faces:
        mat = mats[f.material_index]
        name = name_of(f)
        pts = [pos[v] for v in f.verts]
        n0 = f.normal
        ref = (-n0.x, n0.z, -n0.y)            # нормаль модели в кадре игры
        nn = exterior.newell(pts)
        if sum(a * b for a, b in zip(nn, ref)) < 0:
            nn = tuple(-c for c in nn)
        extra = {}
        if name in PAINT:
            kind = 'paint'
        elif name == 'windows':
            kind = 'glass'
        elif name == 'body black':
            kind = 'trim'
        elif name == 'body white':
            # номер у модели разрезан по оси на две половины — картинка легла бы на каждую; половины
            # одного торца собираются в одну грань после обхода
            plates.setdefault(1 if nn[2] > 0 else -1, []).extend(pts)
            continue
        elif name in lamps:
            kind = 'lamp'
            c = sum(p[0] for p in pts) / len(pts)
            extra.update(b=DECAL_B, lamp=f"{lamps[name]}-{'R' if c > 0 else 'L'}", c=srgb(mat.diffuse_color))
        else:
            kind = 'trim'
        m.face(pts, kind, n=nn, **extra)
    for end, pts in plates.items():
        # номер — картинка игры; вершина 0 — верхний угол со стороны −lat·end, как у прежних номеров
        lo, hi = min(p[0] for p in pts), max(p[0] for p in pts)
        y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
        z = sum(p[2] for p in pts) / len(pts)
        a, b = (lo, hi) if end > 0 else (hi, lo)
        m.face([(a, y1, z), (b, y1, z), (b, y0, z), (a, y0, z)], 'plate', n=(0.0, 0.0, float(end)), b=DECAL_B)
    for cap, _ in caps:
        ring = [tr(mathutils.Vector((x, 0.0, z))) for x, z in cap]
        lat_c = sum(q[0] for q in ring) / len(ring)
        y_c = sum(q[1] for q in ring) / len(ring)
        hit = surface_z(m, lat_c, y_c)
        if hit is None:
            print(f'ПРОВАЛ {body}: за выхлопной трубой ({lat_c:+.2f}, {y_c:.2f}) нет бампера', file=sys.stderr)
            continue
        zb, hc = hit
        # торец сбоку большой склеенной грани бампера: её центр ближе к камере, чем торец, на расстояние
        # до него, и с bias наклейки 0,02 вторая труба целиком уходила под бампер
        bias = math.dist(hc, (lat_c, y_c, zb)) + DECAL_B
        m.face([(q[0], q[1], zb - 0.002) for q in ring], 'trim', n=(0.0, 0.0, -1.0), b=round(bias, 3))
    # след касаний — выпуклая оболочка самой модели (без номера и труб: они наклейки на бампере)
    hull = exterior.hull2([(round(pos[v][0], 4), round(pos[v][2], 4)) for v in body_v])
    fails, summ = exterior.check(m, hull, C, sightlines=False, glass_front=glass_front)
    cabin_k, over = 1.0, None
    if own:
        class Low:
            pass

        def sight(k):
            low = Low()
            low.v, low.f = [(a, b * k, c) for a, b, c in m.v], m.f
            f_, s_ = exterior.check(low, hull, C, sightlines=True, glass_front=glass_front)
            return not any('линии взгляда' in x for x in f_), s_
        _, over = sight(1.0)
        lo, hi = 0.5, 1.0
        if not sight(hi)[0]:
            for _ in range(30):
                mid = (lo + hi) / 2
                lo, hi = (mid, hi) if sight(mid)[0] else (lo, mid)
            cabin_k = math.floor(lo * 1000) / 1000
        ok_k, low_s = sight(cabin_k)
        if not ok_k:
            fails.append(f'из салона капот выше линии взгляда и при cabinK {cabin_k}')
    old = exterior.hull2([(s_ * st['w'], st['z']) for st in C['CAR_ST'] for s_ in (-1, 1)])
    _, cmp_ = exterior.check(m, old, C, sightlines=False)
    # оси колёс модели — там игра рисует колёса; колея и высота центра — для сверки с CAR
    axles = [round(-(wh['front_y'] - yc) * sz, 3), round(-(wh['rear_y'] - yc) * sz, 3)]
    # место под зеркало: низ окна у стойки A (z 0,77–0,85, как у MIR_H) — от него игра поднимает
    # корпуса зеркал, ручки, швы, дворники и камеру бокового зеркала своей машины
    win = [m.v[i] for f in m.f if f['m'] == 'glass' for i in f['i']]
    near = [p for p in win if 0.6 < p[2] < 1.0] or win
    belt = min(p[1] for p in near)
    dy = round(belt - 0.975, 3)
    # надстройка — стёкла, стойки, крыша и рамы окон: всё выше низа окон между кромками лобового и
    # заднего стекла. Из салона её заменяет куб салона, а грани рам модели, смотрящие внутрь проёмов,
    # проходят отсечение по нормали и рисовались поверх обзора: окна модели стоят не там, где окна
    # куба. Игра пропускает грани с g для своей машины, пока камера в салоне
    g_zmin = min(p[2] for p in win)
    n_g = 0
    for f in m.f:
        pts = [m.v[i] for i in f['i']]
        cy = sum(p[1] for p in pts) / len(pts)
        cz = sum(p[2] for p in pts) / len(pts)
        if f['m'] == 'glass' or (cy > belt - 0.01 and g_zmin < cz < glass_front):
            f['g'] = 1
            n_g += 1
    front_glass = [p for p in win if p[2] > glass_front - 0.25 and abs(p[0]) < 0.4]
    wz = glass_front - 0.03
    wy = min(p[1] for p in front_glass) + 0.006 if front_glass else 1.0
    lamp_ids = sorted({f['lamp'] for f in m.f if f.get('lamp')})
    n_plates = sum(1 for f in m.f if f['m'] == 'plate')
    max_n = max(len(f['i']) for f in m.f)
    if max_n > MAX_POLY:
        fails.append(f'грань из {max_n} вершин — у игры заготовки до {MAX_POLY}')
    top = max(p[1] for p in m.v)
    log(f"{body} ({fname}): множители поперёк {sx:.4f}, вверх {sy:.4f}, вдоль {sz:.4f}; габарит "
        f"{2 * LH:.2f} × {car['width']:.2f} × {top:.2f} м; оси колёс z {axles[0]:+.3f} / {axles[1]:+.3f} "
        f"(CAR {-C['C2R'] + car['wheelbase']:+.3f} / {-C['C2R']:+.3f}), колея {wh['x'] * sx * 2:.3f}, центр колеса {wh['zc'] * sy:.3f}")
    log(f"{body}: граней {summ['faces']} (склеено {merged}, до {max_n} вершин), зеркал убрано граней {dropped}, труб {len(caps)}; "
        f"фары и фонари {lamp_ids}, номеров {n_plates}; от прежнего следа CAR_ST до {cmp_['dev_cm']} см; "
        f"низ окна {belt:.2f} → dy {dy:+.3f}, надстройка {n_g} граней"
        + (f"; как в референсе над линией взгляда: перёд {over['over_front']}°, зад {over['over_rear']}° → из салона "
           f"высота × {cabin_k} (капот {low_s['over_front']}°, багажник {low_s['over_rear']}°)" if own else ''))
    for f in fails:
        print(f'ПРОВАЛ {body}: {f}', file=sys.stderr)
    meta = dict(dy=max(0.0, dy), wiper=[round(wz, 3), round(wy, 3)], hull=[[round(a, 4), round(b, 4)] for a, b in hull],
                axles=axles)
    if own:
        meta['cabinK'] = cabin_k
    return m, meta, not fails


def main():
    if not CONSTS.exists():
        raise SystemExit('нет build/blender/consts.json — сначала node tools/blender/consts.mjs')
    data = json.loads(CONSTS.read_text())
    C = data['consts']
    bodies, ok = {}, True
    for body in BODIES:
        m, meta, good = build(C, body)
        ok = ok and good
        bodies[body] = {**meta, 'v': [x for p in m.v for x in p], 'f': m.f}
    if not ok:
        raise SystemExit(1)
    out = {'fingerprint': data['fingerprint'], 'source': 'RgsDev Free Low Poly Vehicles Pack (CC0)', 'bodies': bodies}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text)
    log(f'→ {OUT.relative_to(ROOT)}, {len(text) / 1024:.1f} КБ')


main()
