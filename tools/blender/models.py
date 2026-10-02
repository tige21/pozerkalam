"""Кузова машин — готовые модели RgsDev (CC0, assets/src/models/rgsdev) → build/assets/car-mesh.json.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/models.py

Самодельные кузова владелец назвал «мятой бумагой»: ~300 граней по сечениям не дают формы машины, а
картинки с чертежей на них ложились заплатками. Здесь — готовые модели из бесплатного набора Free Low
Poly Vehicles Pack (Raphael Gonçalves, Rgsdev; CC0, автора указывать не обязательно): седан, хэтчбек и
кроссовер. Модели раскрашены материалами без текстур — это и нужно рендеру игры (грань — один цвет).

Что меняется в модели и почему:
- колёса выкинуты — игра рисует свои (поворот, диски стилей); зеркала выкинуты — у игры свой корпус
  зеркала (MIR_H), по нему настраивают зеркала;
- по длине — ломаная: торцы на ±2,21 (CAR.length), центры колёс модели — на осях игры; по высоте —
  ниже верха колеса масштаб такой, чтобы колесо модели совпало с колесом игры (CAR.wheelR), выше —
  до заданной высоты кузова: у мультяшных моделей кабина высокая, и одним масштабом машина вышла бы
  высотой 1,7 м или с колесом, пробивающим арку;
- поперёк каждое сечение растягивается так, чтобы след на земле лёг на CAR_HULL: по нему игра
  считает касание (exterior.check и @render-car-footprint, ≤ 1 см);
- у седана (своя машина) капот и багажник прижаты под линии взгляда на край капота и кромку заднего
  стекла — по ним blindZone считает «не видно перед / за», а капот своей машины виден из салона.
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
# кузов игры → файл модели и высота кузова (м, без рейлингов)
BODIES = {'sedan': ('Sedan', 1.44), 'hatch': ('Hatchback', 1.46), 'cross': ('SUV', 1.62)}
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
    wy, wr, wz = [], [], []
    for o in wheels:
        bb = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        wy.append(sum(p.y for p in bb) / 8)
        wz.append(sum(p.z for p in bb) / 8)
        wr.append((max(p.z for p in bb) - min(p.z for p in bb)) / 2)
    front_y = min(wy)
    rear_y = max(wy)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.transform(body.matrix_world)
    mats = [s.material for s in body.material_slots]
    return bm, mats, dict(front_y=front_y, rear_y=rear_y, zc=sum(wz) / len(wz), r=sum(wr) / len(wr))


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


def cut_at(bm, ys):
    """Разрез плоскостями y = const у углов CAR_HULL: там появляются свои вершины, иначе хорда между
    соседними сечениями модели срезала угол следа на 1–3 см. Режутся только грани у края следа (вершина
    не уже 85 % среза): разрез всего меша добавлял 100–150 граней на машину, а соседи разрезанной грани
    получают вершину в ребро и новых граней не дают."""
    w = slice_width(bm)
    for y in ys:
        faces = [f for f in bm.faces if min(v.co.y for v in f.verts) < y < max(v.co.y for v in f.verts)
                 and any(abs(v.co.x) >= 0.85 * w.get(round(v.co.y, 5), 1.0) for v in f.verts)]
        geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=(0.0, y, 0.0), plane_no=(0.0, 1.0, 0.0))
    return len(ys)


def slice_width(bm):
    """Полуширина меша в срезе y = const для каждого y вершины: самая широкая точка среза (вершины на
    плоскости и пересечения рёбер с ней). По выпуклой оболочке следа нельзя: у вогнутых мест оболочка
    шире среза, и самая широкая точка не ложилась на CAR_HULL."""
    eps = 1e-4
    edges = [(e.verts[0].co.copy(), e.verts[1].co.copy()) for e in bm.edges]
    pts = [(v.co.x, v.co.y) for v in bm.verts]
    out = {}
    for v in bm.verts:
        y0 = round(v.co.y, 5)
        if y0 in out:
            continue
        # вершины на плоскости — сами по себе: с допуском, иначе ребро от вершины ровно на y0 из-за
        # округления не считалось пересекающим, и вершина шире среза уходила за CAR_HULL
        w = max(abs(x) for x, y in pts if abs(y - y0) < eps)
        for a, b in edges:
            lo, hi = min(a.y, b.y), max(a.y, b.y)
            if lo < y0 - eps and hi > y0 + eps:
                t = (y0 - a.y) / (b.y - a.y)
                w = max(w, abs(a.x + (b.x - a.x) * t))
        out[y0] = w
    return out


def interp(xs, ys, x):
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + (ys[i] - ys[i - 1]) * t
    return ys[-1]


def build(C, body):
    fname, height = BODIES[body]
    bm, mats, wh = load(fname)
    dropped = drop_mirrors(bm)
    # грани одной плоскости и одного материала склеиваются: у модели панели порезаны на квады, и без
    # склейки граней было 380–470 на кузов — на телефоне +1,2–1,7 мс JS на кадр уровня 1. Вид тот же:
    # рендер заливает грань одним цветом, а многоугольник (и вогнутый) он рисует как есть
    n0 = len(bm.faces)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=bm.verts[:], edges=bm.edges[:], delimit={'MATERIAL'})
    merged = n0 - len(bm.faces)
    hull = exterior.hull2([(s * st['w'], st['z']) for st in C['CAR_ST'] for s in (-1, 1)])
    car = C['CAR']
    zr_g = -C['C2R']
    zf_g = zr_g + car['wheelbase']
    # номер выступает перед бампером на 2–3 см и был самой передней точкой модели: подгонка следа
    # растягивала его до ширины машины (1,48 м). Он ставится на бампер — дальше лежит наклейкой с bias
    plate_v = {v for f in bm.faces if mats[f.material_index] and mats[f.material_index].name == 'body white' for v in f.verts}
    ys = [v.co.y for v in bm.verts if v not in plate_v]
    y_front, y_rear = min(ys), max(ys)
    for v in plate_v:
        v.co.y = min(max(v.co.y, y_front + 1e-4), y_rear - 1e-4)
    # по длине: перёд модели — −y; торцы → ±LH, центры колёс → оси игры
    ky = [y_front, wh['front_y'], wh['rear_y'], y_rear]
    kz = [LH, zf_g, zr_g, -LH]
    zmap = lambda y: interp(ky, kz, y)  # noqa: E731
    # углы бамперов: у прямого борта (z 1,40 и −1,70) хорда лежит на самом следе и разрез не нужен
    corners = sorted({round(z, 4) for _, z in hull if 1.9 < abs(z) < LH - 1e-6})
    cuts = cut_at(bm, [interp(kz[::-1], ky[::-1], z) for z in corners])
    widths = slice_width(bm)
    w_body = max(widths.values())
    # по высоте: до верха колеса — колесо модели на колесо игры, выше — до высоты кузова
    s_low = car['wheelR'] / wh['zc']
    z_top_wheel = wh['zc'] + wh['r']
    y_top_wheel = z_top_wheel * s_low
    paint_top = max(v.co.z for f in bm.faces if mats[f.material_index] and mats[f.material_index].name in PAINT for v in f.verts)
    k_up = (height - y_top_wheel) / (paint_top - z_top_wheel)
    ymap = lambda z: z * s_low if z <= z_top_wheel else y_top_wheel + (z - z_top_wheel) * k_up  # noqa: E731
    own = body == 'sedan'
    eye = C['EYE']
    hood_line = lambda z: eye['y'] + (C['HOOD_Y'] - eye['y']) * (z - eye['z']) / (C['HOOD_Z'] - eye['z'])  # noqa: E731
    rear_line = lambda z: eye['y'] + (exterior.REAR_SILL[1] - eye['y']) * (z - eye['z']) / (exterior.REAR_SILL[0] - eye['z'])  # noqa: E731
    glass_z = [zmap(v.co.y) for f in bm.faces if mats[f.material_index] and mats[f.material_index].name == 'windows' for v in f.verts]
    glass_front = max(glass_z)
    pos = {}
    for v in bm.verts:
        z = zmap(v.co.y)
        # поперёк: самая широкая точка среза ложится на CAR_HULL в этом z; номер — общим масштабом
        # кузова: у острого носа срез узкий, и номер выходил шириной 0,83 м вместо 0,5
        if v in plate_v:
            lat = -v.co.x * 0.90 / w_body
        else:
            lat = -v.co.x * exterior.half_width(hull, z) / (widths[round(v.co.y, 5)] or 1.0)
        y = ymap(v.co.z)
        if own and z > glass_front:
            y = min(y, hood_line(z) - 0.004)
        if own and z <= exterior.REAR_SILL[0]:
            y = min(y, rear_line(z) - 0.004)
        pos[v] = (lat, y, z)
    m = exterior.Mesh(min_area=1e-6)
    lamps = {'headlights': 'head', 'rear lights': 'tail'}
    plates = {}
    for f in bm.faces:
        mat = mats[f.material_index]
        name = mat.name if mat else ''
        pts = [pos[v] for v in f.verts]
        n0 = f.normal
        ref = (-n0.x, n0.z, -n0.y)            # нормаль модели в кадре игры (lat = −x, вверх = z, вперёд = −y)
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
        m.face([(a, y1, z), (b, y1, z), (b, y0, z), (a, y0, z)], 'plate', n=(0.0, 0.0, float(end)), b=DECAL_B,
               img='plate', uv=[0, 0, 1, 1])
    fails, summ = exterior.check(m, hull, C, sightlines=own, glass_front=glass_front)
    # мест под зеркало: низ окна у стойки A (z 0,77–0,85, как у MIR_H) — от него игра поднимает
    # корпуса зеркал, ручки, швы и дворники кузова (dy относительно 0,975 — низа корпуса MIR_H)
    win = [p for f, k in ((f, f['m']) for f in m.f) if k == 'glass' for p in (m.v[i] for i in f['i'])]
    near = [p for p in win if 0.6 < p[2] < 1.0] or win
    belt = min(p[1] for p in near)
    dy = round(belt - 0.975, 3)
    front_glass = [p for p in win if p[2] > glass_front - 0.25 and abs(p[0]) < 0.4]
    wz = glass_front - 0.03
    wy = min(p[1] for p in front_glass) + 0.006 if front_glass else 1.0
    lamp_ids = sorted({f['lamp'] for f in m.f if f.get('lamp')})
    plates = sum(1 for f in m.f if f.get('img') == 'plate')
    log(f"{body}: фары и фонари {lamp_ids}, номеров с картинкой {plates}")
    max_n = max(len(f['i']) for f in m.f)
    if max_n > MAX_POLY:
        fails.append(f'грань из {max_n} вершин — у игры заготовки до {MAX_POLY}')
    log(f"{body} ({fname}): граней {summ['faces']} (склеено {merged}, до {max_n} вершин), вершин {summ['verts']}, зеркал убрано граней {dropped}, разрезов {cuts}; "
        f"след ±{summ['dev_cm']} см; низ окна {belt:.2f} → dy {dy:+.3f}; лобовое от z {glass_front:.2f}"
        + (f"; над линией взгляда: перёд {summ['over_front']}°, зад {summ['over_rear']}°" if own else ''))
    for f in fails:
        print(f'ПРОВАЛ {body}: {f}', file=sys.stderr)
    return m, dict(dy=max(0.0, dy), wiper=[round(wz, 3), round(wy, 3)]), not fails


def main():
    if not CONSTS.exists():
        raise SystemExit('нет build/blender/consts.json — сначала node tools/blender/consts.mjs')
    data = json.loads(CONSTS.read_text())
    C = data['consts']
    bodies, ok = {}, True
    for body in BODIES:
        m, meta, good = build(C, body)
        ok = ok and good
        bodies[body] = {'dy': meta['dy'], 'wiper': meta['wiper'], 'v': [x for p in m.v for x in p], 'f': m.f}
    if not ok:
        raise SystemExit(1)
    out = {'fingerprint': data['fingerprint'], 'source': 'RgsDev Free Low Poly Vehicles Pack (CC0)', 'bodies': bodies}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text)
    log(f'→ {OUT.relative_to(ROOT)}, {len(text) / 1024:.1f} КБ')


main()
