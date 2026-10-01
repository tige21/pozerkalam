"""Сцена салона для пререндера куба из глаза водителя.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/car.py -- [--preview]

Всё строится из констант игры (build/blender/consts.json, tools/blender/consts.mjs): обшивка —
это лофт кузова CAR_ST, сдвинутый внутрь, проём лобового — ровно WSHIELD (по нему же light-check
судит, честно ли закрыта линза), руль, щиток, рычаг и салонное зеркало в сцену не входят — их
рисует игра поверх куба. Скрипт падает с текстом, если нарушено правило обзора или живой слой
закрыт обшивкой: с неподвижным глазом порядок «куб, потом живые слои» точен только тогда.
"""
import math
import sys
import time

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import BUILD, G, Gv, ROOT, cube_camera, load_consts, log, script_args, setup_cycles  # noqa: E402

ARGS = script_args()
DATA = load_consts()
C = DATA['consts']
HOOD_DEG = DATA['derived']['hoodDeg']
EYE = C['EYE']
EYE_V = G(EYE['lat'], EYE['y'], EYE['z'])
INSET = 0.05
FRIT = 0.14

CLEAN = ROOT / 'build' / 'assets' / 'clean'
# материал → (картинка из tools/assets/clean.py или цвет, плитка в метрах, шероховатость, рельеф, металл).
# Плитка ложится проекцией «коробкой» в координатах сцены (метры): развёртка не нужна, и узор идёт
# непрерывно через соседние детали. Торпедо мельче (10 см) — зерно у картинки как у кожи сидений
MATS = {
    'dash': ('mat-dash-soft', 0.10, 0.72, 0.30, 0.0), 'door': ('mat-dash-soft', 0.15, 0.72, 0.30, 0.0),
    'door_low': ('mat-plastic-hard', 0.25, 0.80, 0.25, 0.0), 'trim': ('mat-plastic-hard', 0.25, 0.78, 0.25, 0.0),
    'headliner': ('mat-headliner', 0.30, 0.95, 0.20, 0.0), 'seat': ('mat-seat-fabric', 0.12, 0.92, 0.45, 0.0),
    'leather': ('mat-seat-leather', 0.20, 0.55, 0.35, 0.0), 'carpet': ('mat-carpet', 0.25, 1.00, 0.40, 0.0),
    'satin': ('mat-trim-satin', 0.20, 0.35, 0.05, 0.4),
    'frit': ((0.004, 0.004, 0.005), None, 0.40, 0.0, 0.0), 'seal': ((0.010, 0.010, 0.011), None, 0.50, 0.0, 0.0),
    'panel': ((0.012, 0.012, 0.014), None, 0.30, 0.0, 0.0), 'lens': ((0.58, 0.58, 0.56), None, 0.60, 0.0, 0.0),
}
# ровная подсветка в долях цвета материала — как окружающий свет 0,48 в прежнем салоне игры:
# по физике потолок смотрит вниз, на тёмный салон, и получал в 10 раз меньше света, чем сиденья
# (светлый потолок выходил серее тёмной ткани); подсветка сохраняет разницу цвета материалов,
# прямой свет из окон оставлен слабым — он даёт объём, а не яркость
AMBIENT = 0.35
BAKED = []


def clean_image(stem):
    path = CLEAN / f'{stem}.png'
    if not path.exists():
        raise SystemExit(f'нет {path.relative_to(ROOT)} — сначала python3 tools/assets/clean.py')
    return bpy.data.images.load(str(path), check_existing=True)


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    src, tile, rough, bump, metal = MATS[name]
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    # матовые обивки почти не бликуют: со стандартным отражением тёмный верх панели ловил небо
    # под скользящим углом и выходил светло-серым (184 из 255 при цвете #34363A)
    bsdf.inputs['Specular IOR Level'].default_value = 0.5 if rough < 0.5 else 0.15
    bsdf.inputs['Emission Strength'].default_value = AMBIENT
    if tile is None:
        bsdf.inputs['Base Color'].default_value = (*src, 1)
        bsdf.inputs['Emission Color'].default_value = (*src, 1)
        return m
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = clean_image(src)
    tx.projection = 'BOX'
    tx.projection_blend = 0.3
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], tx.inputs['Vector'])
    nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tx.outputs['Color'], bsdf.inputs['Emission Color'])
    if bump:
        bw = nt.nodes.new('ShaderNodeRGBToBW')
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump
        bp.inputs['Distance'].default_value = 0.0015
        nt.links.new(tx.outputs['Color'], bw.inputs['Color'])
        nt.links.new(bw.outputs['Val'], bp.inputs['Height'])
        nt.links.new(bp.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def decal_material(stem, mirror):
    name = f'dec:{stem}{":m" if mirror else ""}'
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = 0.45
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = clean_image(stem)
    tx.extension = 'CLIP'
    nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tx.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = AMBIENT
    nt.links.new(tx.outputs['Alpha'], bsdf.inputs['Alpha'])
    return m


def panel_quad(name, center, normal, up, w, h, mat=None, stem=None, mirror=False, lift=0.002):
    """Плоская панель в кадре кузова: центр, нормаль к салону, «вверх». Либо материал плиткой,
    либо деталь из картинки (stem) с альфой; mirror — картинка зеркально (правая дверь)."""
    c, n = Gv(center), Gv(normal).normalized()
    u = Gv(up)
    u = (u - n * u.dot(n)).normalized()
    r = u.cross(n)
    c = c + n * lift
    verts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [[0, 1, 2, 3]])
    uvl = me.uv_layers.new(name='UV')
    uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
    if mirror:
        uvs = [(1 - a, b) for a, b in uvs]
    for loop, uv in zip(me.loops, uvs):
        uvl.data[loop.index].uv = uv
    me.materials.append(decal_material(stem, mirror) if stem else material(mat))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    BAKED.append(ob)
    return ob


def on_profile(prof, k, t=0.5):
    """Отрезок k профиля (z, y): точка на доле t, нормаль к водителю (−z) и «вверх» вдоль отрезка
    — в кадре кузова (lat, y, z); последнее — длина отрезка."""
    (z0, y0), (z1, y1) = prof[k], prof[k + 1]
    dz, dy = z1 - z0, y1 - y0
    L = math.hypot(dz, dy)
    tz, ty = dz / L, dy / L
    if ty < 0:
        tz, ty = -tz, -ty
    nz, ny = -ty, tz
    if nz > 0:
        nz, ny = -nz, -ny
    return (z0 + dz * t, y0 + dy * t), (0, ny, nz), (0, ty, tz), L


def make_obj(name, verts, faces, mats, bevel=0.0, smooth_angle=None, segments=3):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    names = sorted(set(mats)) if isinstance(mats, list) else [mats]
    for n in names:
        me.materials.append(material(n))
    if isinstance(mats, list):
        for p, n in zip(me.polygons, mats):
            p.material_index = names.index(n)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if smooth_angle is not None:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    if bevel:
        md = ob.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = segments
        md.limit_method = 'ANGLE'
    BAKED.append(ob)
    return ob


def prism(name, prof_zy, lat0, lat1, mat, bevel=0.004, smooth_angle=40, segments=3):
    """Профиль (z, y), вытянутый поперёк кузова от lat0 до lat1."""
    n = len(prof_zy)
    verts = [G(lat0, y, z) for z, y in prof_zy] + [G(lat1, y, z) for z, y in prof_zy]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces += [list(range(n))[::-1], list(range(n, 2 * n))]
    return make_obj(name, verts, faces, mat, bevel, smooth_angle, segments)


def box(name, lo, hi, mat, bevel=0.006, segments=3):
    (a0, b0, c0), (a1, b1, c1) = lo, hi
    v = [G(a, b, c) for a in (a0, a1) for b in (b0, b1) for c in (c0, c1)]
    f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
    return make_obj(name, v, f, mat, bevel, 30, segments)


def cylinder(name, p0, p1, r, mat, seg=16):
    a, b = Gv(p0), Gv(p1)
    ax = (b - a).normalized()
    u = ax.orthogonal().normalized()
    w = ax.cross(u)
    ring = lambda c: [c + (u * math.cos(t) + w * math.sin(t)) * r for t in (i / seg * 2 * math.pi for i in range(seg))]
    verts = ring(a) + ring(b)
    faces = [[i, (i + 1) % seg, seg + (i + 1) % seg, seg + i] for i in range(seg)]
    faces += [list(range(seg))[::-1], list(range(seg, 2 * seg))]
    return make_obj(name, verts, faces, mat, 0, 60)


def station_pts(st):
    w, yb, ys, be, wg, wr, yt = (st[k] for k in ('w', 'yb', 'ys', 'be', 'wg', 'wr', 'yt'))
    return [(-(w - 0.10), yb), (-(w - 0.02), yb + 0.06), (-w, ys), (-(w - 0.03), be), (-wg, yt - 0.10), (-wr, yt),
            (wr, yt), (wg, yt - 0.10), (w - 0.03, be), (w, ys), (w - 0.02, yb + 0.06), (w - 0.10, yb)]


def inset_pts(pts, t):
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    out = []
    for i in range(n):
        p, q, r = pts[i - 1], pts[i], pts[(i + 1) % n]
        a = Vector((q[1] - p[1], -(q[0] - p[0]))).normalized()
        b = Vector((r[1] - q[1], -(r[0] - q[0]))).normalized()
        nrm = (a + b).normalized()
        if nrm.dot(Vector((q[0] - cx, q[1] - cy))) < 0:
            nrm = -nrm
        out.append((q[0] - nrm.x * t, q[1] - nrm.y * t))
    return out


def build_shell():
    """Обшивка: лофт кузова, сдвинутый внутрь на INSET. Стекло — дыра, на кромке дыры — откос
    до наружного стекла (иначе из глаза в щель между обшивкой и кузовом видно небо: снаружи
    кузов отсекается по нормали). Сегмент лобового пропущен: его закрывает фритта по WSHIELD."""
    st = [s for s in C['CAR_ST'] if -1.75 <= s['z'] <= 0.86]
    outer = [station_pts(s) for s in st]
    # WSHIELD — прямоугольник ±0,74 до y 1,36, а у лофта на станции лобового край крыши на 1,33:
    # верхние углы проёма уходили в потолок и стойку, обшивка закрывала их из глаза до +15°.
    # Верх стоек на этой станции поднят выше угла WSHIELD и отодвинут наружу: при одном подъёме
    # кромка стойки у верха всё равно заходила в проём на 0,5°. Только в салоне, кузов игры прежний
    w_top = max(p[1] for p in C['WSHIELD']) + 0.01
    w_lat = max(abs(p[0]) for p in C['WSHIELD']) + 0.04
    for i, s_ in enumerate(st):
        if s_['k'] == 'glass' and s_['z'] > 0.2:
            for k in (4, 7):
                x, y = outer[i][k]
                outer[i][k] = (math.copysign(max(abs(x), w_lat), x), max(y, w_top))
    inner = [inset_pts(p, INSET) for p in outer]
    E = range(0, 11)

    def glass(i, e):
        k = st[i]['k']
        # треугольник перед боковым окном (пояс → край крыши у лобового) — стекло двери, а не стойка:
        # плитой во всю высоту он закрывал боковое зеркало, а сама стойка — узкая обшивка по WSHIELD
        front = k == 'glass' and st[i]['z'] > 0.2 and e in (3, 7)
        return front or (k == 'glass' and e in (4, 5, 6)) or (k == 'cabin' and e in (3, 7))

    def skip(i, e):
        k, z = st[i]['k'], st[i]['z']
        if k == 'glass' and z > 0.2 and e in (4, 5, 6):
            return True
        if k == 'body' and z < -1.6 and e in (3, 4, 5, 6, 7):
            return True
        return False

    def mat(i, e):
        if e in (0, 10):
            return 'trim'
        if e in (2, 8):
            return 'door'
        if e in (1, 9):
            return 'door_low'
        if e in (3, 7):
            return 'trim'
        return 'headliner'

    verts, faces, mats = [], [], []
    vid = {}

    def v(which, i, k):
        key = (which, i, k)
        if key not in vid:
            pts = inner if which == 'in' else outer
            x, y = pts[i][k]
            vid[key] = len(verts)
            verts.append(G(x, y, st[i]['z']))
        return vid[key]

    def wsel(i, k):
        # у станции лобового (z 0,30) потолок и стойки стоят на наружной поверхности: сдвинутый
        # внутрь, их угол из глаза заходил в проём WSHIELD до +9,7°, то есть закрывал дорогу;
        # к соседним станциям обшивка сходится плавно, без шва
        return 'out' if st[i]['k'] == 'glass' and st[i]['z'] > 0.2 and 3 <= k <= 8 else 'in'

    def V(i, k):
        return v(wsel(i, k), i, k)

    holes = set()
    for i in range(len(st) - 1):
        for e in E:
            if skip(i, e):
                continue
            if glass(i, e):
                holes.add((i, e))
                continue
            faces.append([V(i, e), V(i, e + 1), V(i + 1, e + 1), V(i + 1, e)])
            mats.append(mat(i, e))
    reveal = 0
    for (i, e) in holes:
        sides = [((i, e - 1), [('in', i, e), ('in', i + 1, e), ('out', i + 1, e), ('out', i, e)]),
                 ((i, e + 1), [('in', i, e + 1), ('out', i, e + 1), ('out', i + 1, e + 1), ('in', i + 1, e + 1)]),
                 ((i - 1, e), [('in', i, e), ('out', i, e), ('out', i, e + 1), ('in', i, e + 1)]),
                 ((i + 1, e), [('in', i + 1, e), ('in', i + 1, e + 1), ('out', i + 1, e + 1), ('out', i + 1, e)])]
        for nb, quad in sides:
            if nb in holes or not (0 <= nb[0] < len(st) - 1):
                continue
            q = [V(i2, k) if w == 'in' else v('out', i2, k) for w, i2, k in quad]
            if len(set(q)) < 3:
                continue
            faces.append(q)
            mats.append('seal')
            reveal += 1
    ob = make_obj('shell', verts, faces, mats, 0.0, 35)
    log(f'обшивка: станций {len(st)}, граней {len(faces)}, проёмов стекла {len(holes)}, откосов {reveal}')
    return ob


def build_frit():
    """Чёрная кайма лобового: внутренняя кромка ровно WSHIELD — проём куба совпадает с константой."""
    W = [Gv(p) for p in C['WSHIELD']]
    cen = sum(W, Vector()) / 4
    nrm = (W[1] - W[0]).cross(W[3] - W[0]).normalized()
    if nrm.dot(EYE_V - cen) < 0:
        nrm = -nrm
    # к глазу — вдоль луча, а не по нормали стекла: сдвиг по нормали уводил кромку из глаза на
    # 0,2° (≈3 px экрана) от WSHIELD, а по лучу проекция не меняется
    ring_in = [p + (EYE_V - p).normalized() * 0.003 for p in W]
    ring_out = [p + (p - cen).normalized() * FRIT + (EYE_V - p).normalized() * 0.003 for p in W]
    verts = ring_in + ring_out
    faces = [[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i] for i in range(4)]
    make_obj('frit', verts, faces, 'frit')
    return W, nrm


def build_a_pillars(W, nrm):
    """Стойка A — обшивка 8,5 см вдоль боковых кромок WSHIELD. Внутренний край — на кромке,
    сдвинутой к глазу вдоль луча, наружный — дальше от проёма и ближе к салону: из глаза вся
    обшивка лежит снаружи проёма, его край не сдвигается ни на пиксель."""
    cen = sum(W, Vector()) / 4
    for name, a, b in (('a_pillar_l', 3, 0), ('a_pillar_r', 1, 2)):
        e = (W[b] - W[a]).normalized()
        o = nrm.cross(e)
        if o.dot(W[a] - cen) < 0:
            o = -o
        verts, faces = [], []
        n = 12
        for i in range(n + 1):
            q = W[a].lerp(W[b], i / n)
            r = (EYE_V - q).normalized()
            # 1 мм наружу: край ровно на кромке округление относило бы то внутрь, то наружу
            verts += [q + o * 0.001 + r * 0.006, q + o * 0.085 + r * 0.035]
        for i in range(n):
            faces.append([2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2])
        make_obj(name, verts, faces, 'trim', 0, 40)


# профили панели (z, y) по полосам: перед водителем лицевая часть отодвинута до z 0,60 —
# циферблат (z 0,552) и обод руля (низ на 0,425, бока на 0,50) стоят перед ней, а не в ней
DASH_DRV = [(0.92, 0.985), (0.78, 1.000), (0.66, 1.012), (0.61, 1.008), (0.60, 0.990), (0.60, 0.700),
            (0.58, 0.620), (0.62, 0.520), (0.72, 0.480), (0.92, 0.480)]
DASH_CTR = [(0.92, 0.985), (0.78, 1.000), (0.64, 1.012), (0.56, 1.008), (0.52, 0.988), (0.50, 0.952),
            (0.47, 0.860), (0.38, 0.790), (0.28, 0.752), (0.24, 0.745), (0.24, 0.600), (0.40, 0.520),
            (0.72, 0.480), (0.92, 0.480)]
DASH_PAS = [(0.92, 0.985), (0.78, 1.000), (0.64, 1.012), (0.56, 1.008), (0.52, 0.988), (0.50, 0.952),
            (0.47, 0.860), (0.45, 0.740), (0.47, 0.620), (0.55, 0.520), (0.70, 0.480), (0.92, 0.480)]
CTR_HW = 0.17


def build_dash():
    cx, cy, cz = C['CLUSTER']['c']
    rd = C['CLUSTER']['rd']
    prism('dash_driver', DASH_DRV, -0.90, -CTR_HW, 'dash', 0.006, 35)
    prism('dash_center', DASH_CTR, -CTR_HW, CTR_HW, 'dash', 0.006, 35)
    prism('dash_passenger', DASH_PAS, CTR_HW, 0.90, 'dash', 0.006, 35)
    # центральная консоль: пара дефлекторов, ниже экран, ниже климат; аварийка над дефлекторами
    (z, y), n, up, L = on_profile(DASH_CTR, 5)
    for lat in (-0.085, 0.085):
        panel_quad(f'vent_c{lat:+.2f}', (lat, y, z), n, up, 0.150, 0.062, stem='dec-vent')
    (z, y), n, up, L = on_profile(DASH_CTR, 4)
    panel_quad('hazard', (0, y, z), n, up, 0.040, 0.025, stem='dec-hazard')
    (z, y), n, up, L = on_profile(DASH_CTR, 6)
    panel_quad('screen', (0, y, z), n, up, 0.180, 0.107, stem='dec-screen-off')
    (z, y), n, up, L = on_profile(DASH_CTR, 7)
    panel_quad('climate', (0, y, z), n, up, 0.240, 0.0996, stem='dec-climate')
    # боковые дефлекторы у краёв панели: слева на отодвинутой полосе водителя, справа на пассажирской
    (z, y), n, up, L = on_profile(DASH_DRV, 4, 0.35)
    panel_quad('vent_l', (-0.72, 0.90, 0.60), (0, 0, -1), (0, 1, 0), 0.150, 0.062, stem='dec-vent')
    (z, y), n, up, L = on_profile(DASH_PAS, 5)
    panel_quad('vent_r', (0.70, y, z), n, up, 0.150, 0.062, stem='dec-vent')
    # сатиновая полоса через пассажирскую часть — на стыке верхней и нижней граней лица
    (z, y), n, up, L = on_profile(DASH_PAS, 5, 0.02)
    panel_quad('satin_strip', ((CTR_HW + 0.90) / 2, y, z), n, up, 0.90 - CTR_HW - 0.02, 0.014, mat='satin')
    # козырёк щитка — тонкая полукруглая скоба: внутренняя кромка выше луча из глаза на верх
    # циферблата, наружная ниже луча на верх обода руля (обод проходит над козырьком)
    seg, r0, r1, yc = 16, rd + 0.006, rd + 0.013, cy + 0.006
    verts, faces = [], []
    for zz in (cz - 0.030, cz + 0.060):
        for i in range(seg + 1):
            t = math.pi * i / seg
            for r in (r0, r1):
                verts.append(G(cx + math.cos(t) * r, yc + math.sin(t) * r, zz))
    stride = (seg + 1) * 2
    for i in range(seg):
        a, b = i * 2, (i + 1) * 2
        faces += [[a, b, b + 1, a + 1], [stride + a, stride + a + 1, stride + b + 1, stride + b],
                  [a, a + stride, b + stride, b], [a + 1, b + 1, b + stride + 1, a + stride + 1]]
    make_obj('binnacle', verts, faces, 'dash', 0, 40)
    box('cluster_back', (cx - 0.112, cy - 0.072, cz + 0.030), (cx + 0.112, cy + 0.068, cz + 0.040), 'panel', 0.004)


def build_column():
    wc, tilt = C['WHEEL']['c'], C['WHEEL']['tilt']
    ax = (0, math.sin(tilt), -math.cos(tilt))
    p0 = [wc[i] - ax[i] * 0.030 for i in range(3)]
    p1 = [wc[i] - ax[i] * 0.20 for i in range(3)]
    cylinder('column', p0, p1, 0.042, 'trim')


def build_console():
    S = C['SELECTOR']
    top = S['top']
    box('tunnel', (-0.14, 0.30, -0.44), (0.14, top, 0.24), 'trim', 0.012)
    zs = [S['z0'] - k * S['step'] for k in range(len(C['SEL_ORDER']))]
    box('gate_plate', (-0.05, top, min(zs) - 0.05), (0.05, top + 0.004, max(zs) + 0.05), 'panel', 0.002)
    for z in (0.12, 0.19):
        cylinder(f'cupholder_{z:.2f}', (0, top - 0.004, z), (0, top + 0.002, z), 0.034, 'panel', 24)
    # подлокотник за рычагом: позади глаза по z, между глазом и рычагом его нет
    box('armrest_center', (-0.10, top, -0.66), (0.10, top + 0.11, -0.30), 'leather', 0.03, 4)
    return top


def seat(name, lat, z_front, z_back, y_cush, back_top, w, head_top):
    """Сиденье: подушка и спинка — вставка из ткани между боковинами из экокожи, скругления фаской."""
    cw, bw = w * 0.66, (w - w * 0.66) / 2
    box(name + '_cushion', (lat - cw / 2, y_cush - 0.10, z_back), (lat + cw / 2, y_cush, z_front), 'seat', 0.03, 4)
    for sg in (-1, 1):
        x0 = lat + sg * cw / 2
        box(f'{name}_bolster{sg:+d}', (min(x0, x0 + sg * bw), y_cush - 0.10, z_back), (max(x0, x0 + sg * bw), y_cush + 0.035, z_front),
            'leather', 0.025, 4)
    zb, zt = z_back + 0.02, z_back - 0.14
    back = [(zb, y_cush), (zt, back_top), (zt - 0.10, back_top), (zb - 0.12, y_cush)]
    prism(name + '_back', back, lat - cw / 2, lat + cw / 2, 'seat', 0.03, 35, 4)
    side = [(zb + 0.03, y_cush + 0.02), (zt + 0.03, back_top - 0.03), (zt - 0.10, back_top - 0.03), (zb - 0.12, y_cush + 0.02)]
    for sg in (-1, 1):
        x0 = lat + sg * cw / 2
        prism(f'{name}_backside{sg:+d}', side, min(x0, x0 + sg * bw), max(x0, x0 + sg * bw), 'leather', 0.025, 35, 4)
    hz = zt - 0.02
    box(name + '_headrest', (lat - 0.13, head_top - 0.12, hz - 0.08), (lat + 0.13, head_top, hz), 'leather', 0.035, 5)


def build_seats():
    seat('seat_l', EYE['lat'], 0.02, -0.52, 0.58, 1.06, 0.52, 1.19)
    seat('seat_r', -EYE['lat'], 0.02, -0.52, 0.58, 1.06, 0.52, 1.19)
    box('bench_cushion', (-0.72, 0.42, -1.30), (0.72, 0.60, -0.84), 'seat', 0.04, 4)
    prism('bench_back', [(-1.28, 0.58), (-1.40, 1.00), (-1.52, 1.00), (-1.42, 0.58)], -0.74, 0.74, 'seat', 0.04, 35, 4)
    for lat in (-0.48, 0.0, 0.48):
        box(f'rear_headrest_{lat:+.2f}', (lat - 0.12, 1.03, -1.48), (lat + 0.12, 1.14, -1.41), 'leather', 0.03, 5)


def build_doors():
    """Двери изнутри: вставка из ткани, подлокотник, ручка, карман. Плоскость двери — по лофту:
    между плечом (y 0,75) и поясом (y 0,99) обшивка наклонена внутрь кверху."""
    for sg in (-1, 1):
        for name, z0, z1, handle in (('front', -0.24, 0.42, True), ('rear', -1.02, -0.46, False)):
            zc, zw = (z0 + z1) / 2, z1 - z0
            lat_ins = sg * 0.830
            n = (-sg * 0.97, 0.24, 0)
            panel_quad(f'door_{name}{sg:+d}_insert', (lat_ins, 0.83, zc), n, (sg * 0.24, 0.97, 0), zw - 0.10, 0.10, mat='seat', lift=0.004)
            box(f'armrest_{name}{sg:+d}', (min(sg * 0.79, sg * 0.85), 0.70, z0 + 0.04), (max(sg * 0.79, sg * 0.85), 0.75, z1 - 0.04), 'leather', 0.015, 4)
            box(f'pocket_{name}{sg:+d}', (min(sg * 0.80, sg * 0.86), 0.42, z0 + 0.06), (max(sg * 0.80, sg * 0.86), 0.50, z1 - 0.10), 'door_low', 0.01, 3)
            if handle:
                panel_quad(f'handle{sg:+d}', (sg * 0.836, 0.905, z1 - 0.12), n, (sg * 0.24, 0.97, 0), 0.15, 0.069,
                           stem='dec-door-handle', mirror=sg > 0, lift=0.005)


def build_cabin_rest():
    box('floor', (-0.90, 0.30, -1.50), (0.90, 0.36, 0.86), 'carpet', 0.0)
    # моторный щит и передний тоннель: без них под панелью в ногах было видно небо
    box('firewall', (-0.90, 0.28, 0.83), (0.90, 0.99, 0.92), 'carpet', 0.0)
    box('rear_bulkhead', (-0.88, 0.28, -1.56), (0.88, 0.99, -1.50), 'trim', 0.0)
    box('tunnel_front', (-0.12, 0.28, 0.24), (0.12, 0.60, 0.88), 'carpet', 0.02)
    box('parcel_shelf', (-0.80, 0.98, -1.72), (0.80, 1.00, -1.40), 'trim', 0.004)
    for lat, h in ((EYE['lat'] - 0.06, 0.07), (EYE['lat'] + 0.14, 0.11)):
        box(f'pedal_{lat:+.2f}', (lat - 0.04, 0.36, 0.62), (lat + 0.04, 0.36 + h, 0.64), 'panel', 0.004)
    for sg in (-1, 1):
        box(f'visor_{sg:+d}', (0.20 if sg > 0 else -0.58, 1.352, 0.05), (0.58 if sg > 0 else -0.20, 1.372, 0.22), 'headliner', 0.008, 4)
    box('header', (-0.74, 1.362, 0.20), (0.74, 1.40, 0.255), 'headliner', 0.008)
    box('dome', (-0.10, 1.355, -0.06), (0.10, 1.372, 0.06), 'trim', 0.006, 3)
    # рассеиватель матовый: с гладким светлым стеклом плафон бликовал белым пятном в салонном зеркале
    box('dome_lens', (-0.06, 1.350, -0.035), (0.06, 1.356, 0.035), 'lens', 0.003)
    build_doors()


def area_light(name, size, size_y, energy, at, target):
    li = bpy.data.lights.new(name, 'AREA')
    li.shape = 'RECTANGLE'
    li.size, li.size_y = size, size_y
    li.energy = energy
    ob = bpy.data.objects.new(name, li)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Gv(at)
    ob.rotation_euler = (Gv(target) - ob.location).to_track_quat('-Z', 'Y').to_euler()


def build_lights():
    """Дневной свет без солнца: солнце дало бы тени, которые не двигаются с курсом машины (в игре
    свет салона идёт от лобового, cabinLight). Окружение — небо сверху и тёмная земля снизу, свет
    через окна почти горизонтальный, на уровне головы: при ровном небе со всех сторон сиденья
    получали в 10 раз больше света, чем потолок, и светлый потолок выходил серее тёмной ткани."""
    world = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get('Background')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.15
    mr.inputs['From Max'].default_value = 0.25
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (0.20, 0.19, 0.17, 1)
    mix.inputs['B'].default_value = (0.74, 0.82, 0.96, 1)
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], mix.inputs['Factor'])
    nt.links.new(mix.outputs['Result'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 1.0
    area_light('windshield_sky', 2.4, 1.0, 40, (0, 1.45, 1.9), (0, 1.25, -0.6))
    for sg in (-1, 1):
        area_light(f'side_sky{sg:+d}', 2.2, 0.7, 80, (sg * 1.9, 1.35, -0.3), (0, 1.25, -0.3))
    area_light('rear_sky', 1.4, 0.7, 50, (0, 1.40, -2.6), (0, 1.2, -1.0))


def evaluated_bvh():
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for ob in BAKED:
        me = ob.evaluated_get(dg).to_mesh()
        tmp = bmesh.new()
        tmp.from_mesh(me)
        tmp.transform(ob.matrix_world)
        m2 = bpy.data.meshes.new('tmp')
        tmp.to_mesh(m2)
        bm.from_mesh(m2)
        bpy.data.meshes.remove(m2)
        tmp.free()
        ob.evaluated_get(dg).to_mesh_clear()
    return BVHTree.FromBMesh(bm), bm


def point_in_quad(p, W, nrm):
    s = None
    for i in range(4):
        a, b = W[i], W[(i + 1) % 4]
        c = (b - a).cross(p - a).dot(nrm)
        if s is None:
            s = c > 0
        elif (c > 0) != s:
            return False
    return True


def check_sightlines(W, nrm):
    """Ничто, кроме проёма, не заходит в лобовое выше линии капота (−8,9° из EYE): ниже неё
    из-за панели видно только капот, выше — дорогу."""
    dg = bpy.context.evaluated_depsgraph_get()
    bad = []
    for ob in BAKED:
        if ob.name == 'frit':
            continue
        me = ob.evaluated_get(dg).to_mesh()
        for vx in me.vertices:
            p = ob.matrix_world @ vx.co
            d = p - EYE_V
            den = d.dot(nrm)
            if abs(den) < 1e-9:
                continue
            t = (W[0] - EYE_V).dot(nrm) / den
            if t <= 1.0:
                continue
            hit = EYE_V + d * t
            elev = math.degrees(math.atan2(p.z - EYE_V.z, p.y - EYE_V.y))
            if point_in_quad(hit, W, nrm) and elev > HOOD_DEG - 0.2:
                bad.append((ob.name, round(elev, 2), (round(p.x, 3), round(p.z, 3), round(p.y, 3))))
        ob.evaluated_get(dg).to_mesh_clear()
    if bad:
        worst = {}
        for n, e, at in bad:
            if e > worst.get(n, (-99, None))[0]:
                worst[n] = (e, at)
        raise SystemExit('ПРОВАЛ обзор: в проёме лобового выше линии капота ' +
                         ', '.join(f'{n} до {e}° (lat, y, z = {at})' for n, (e, at) in sorted(worst.items())) +
                         f'; точек {len(bad)}')
    # вершины ловят не всё: грань может зайти в проём, не заводя туда ни одной вершины, — поэтому
    # ещё лучи из глаза в сетку точек проёма и вдоль кромок на 0,15° внутрь
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    cen = sum(W, Vector()) / 4
    pts = []
    for i in range(1, 30):
        for j in range(1, 30):
            top = W[0].lerp(W[1], i / 30)
            bot = W[3].lerp(W[2], i / 30)
            pts.append(top.lerp(bot, j / 30))
    for a, b in ((0, 1), (1, 2), (3, 0)):
        for i in range(1, 60):
            q = W[a].lerp(W[b], i / 60)
            d = (q - EYE_V).normalized()
            # внутрь — перпендикулярно кромке в поле зрения: к центру стекла у углов почти вдоль кромки
            inward = d.cross(W[b] - W[a]).normalized()
            if inward.dot(cen - q) < 0:
                inward = -inward
            pts.append(EYE_V + (d + inward * math.radians(0.15)).normalized() * (q - EYE_V).length)
    hits = {}
    for q in pts:
        elev = math.degrees(math.atan2(q.z - EYE_V.z, q.y - EYE_V.y))
        if elev <= HOOD_DEG + 0.3:
            continue
        d = q - EYE_V
        ok, loc, _n, _i, ob, _m = sc.ray_cast(dg, EYE_V, d.normalized(), distance=d.length - 0.004)
        if ok and ob.name != 'frit':
            hits.setdefault(ob.name, []).append((round(elev, 1), (round(loc.x, 3), round(loc.z, 3), round(loc.y, 3))))
    if hits:
        raise SystemExit('ПРОВАЛ обзор (лучи): проём лобового выше линии капота закрывают ' +
                         ', '.join(f'{n} ({len(e)} лучей, выс до {max(x[0] for x in e)}°, точки lat/y/z {[x[1] for x in e[:3]]})'
                                   for n, e in sorted(hits.items())))
    log(f'обзор: в проёме WSHIELD выше линии капота ({HOOD_DEG:.2f}°) ничего нет — {len(pts)} лучей')


def live_samples(tunnel_top):
    """Точки живых слоёв: каждая обязана быть видна из глаза — порядок куб→слой тогда точен."""
    pts = {}
    cx, cy, cz = C['CLUSTER']['c']
    rd = C['CLUSTER']['rd']
    pts['щиток'] = [G(cx + math.cos(a) * r, cy + math.sin(a) * r, cz) for r in (0, rd * 0.5, rd * 0.97)
                    for a in (i / 12 * 2 * math.pi for i in range(12))]
    R = C['REPEATER']
    pts['повторители'] = [G(cx + s * R['dx'], R['y'], R['z']) for s in (-1, 1)]
    S = C['SELECTOR']
    pts['рычаг'] = [G(S['lat'] + dx, y, S['z0'] - k * S['step'] + dz)
                    for k in range(len(C['SEL_ORDER'])) for dx in (-S['hw'], S['hw'])
                    for dz in (-S['hd'], S['hd']) for y in (tunnel_top + 0.006, S['y'] + S['hh'])]
    M = C['CMIR']
    H = C['MIR_H']
    pts['боковые зеркала'] = [G(sg * (H['lin'] + (H['lout'] - H['lin']) * fl), H['y0'] + (H['y1'] - H['y0']) * fy, H['zb'])
                              for sg in (-1, 1) for fl in (0.25, 0.5, 0.75) for fy in (0.3, 0.5, 0.7)]
    pts['салонное зеркало'] = [G(M['lat'] + dx, M['y'] + dy, M['z'] - M['d']) for dx in (-M['w'], 0, M['w']) for dy in (-M['h'], M['h'])]
    Wh = C['WHEEL']
    tilt, wc = Wh['tilt'], Wh['c']
    ax = Vector((0, math.sin(tilt), -math.cos(tilt)))
    b1 = Vector((1, 0, 0))
    b2 = ax.cross(b1)
    pts['руль'] = [Gv([wc[i] + (b1[i] * math.cos(a) + b2[i] * math.sin(a)) * Wh['r'] for i in range(3)])
                   for a in (i / 32 * 2 * math.pi for i in range(32))]
    return pts


def check_live(bvh, tunnel_top):
    fails = []
    for name, pts in live_samples(tunnel_top).items():
        hidden = []
        for p in pts:
            d = p - EYE_V
            dist = d.length
            hit = bvh.ray_cast(EYE_V, d.normalized(), dist - 0.004)
            if hit[0] is not None:
                hidden.append(f'({p.x:.3f}, {p.z:.3f}, {p.y:.3f}) закрыта на {dist - hit[3]:.3f} м до точки')
        log(f'живой слой «{name}»: видно {len(pts) - len(hidden)} из {len(pts)} точек' +
            (' — ' + '; '.join(hidden[:3]) if hidden else ''))
        hidden = len(hidden)
        if hidden:
            fails.append(f'{name} ({hidden}/{len(pts)})')
    if fails:
        raise SystemExit('ПРОВАЛ живые слои закрыты обшивкой: ' + ', '.join(fails))


def check_headrests():
    cam_y = C['CMIR']['y']
    for ob in BAKED:
        if 'headrest' in ob.name:
            top = max((ob.matrix_world @ Vector(c)).z for c in ob.bound_box)
            if top > cam_y - 0.06 + 1e-6:
                raise SystemExit(f'ПРОВАЛ {ob.name}: верх {top:.3f} ближе 6 см к камере салонного зеркала ({cam_y})')
    log('подголовники ≥ 6 см ниже камеры салонного зеркала')


def preview():
    setup_cycles(48)
    for face in ('pz', 'nz', 'px', 'nx', 'py', 'ny'):
        cube_camera(EYE_V, face, 512)
        out = BUILD / f'preview-{face}.png'
        bpy.context.scene.render.filepath = str(out)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        log(f'превью {face}: {out.relative_to(ROOT)}, {time.time() - t:.1f} с')


def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_shell()
    W, nrm = build_frit()
    build_a_pillars(W, nrm)
    build_dash()
    build_column()
    tunnel_top = build_console()
    build_seats()
    build_cabin_rest()
    build_lights()
    check_sightlines(W, nrm)
    bvh, bm = evaluated_bvh()
    check_live(bvh, tunnel_top)
    bm.free()
    check_headrests()
    polys = sum(len(o.data.polygons) for o in BAKED)
    bpy.context.scene['consts_fingerprint'] = DATA['fingerprint']
    BUILD.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BUILD / 'car.blend'))
    log(f'сцена: объектов {len(BAKED)}, граней до модификаторов {polys}, {time.time() - t0:.1f} с → build/blender/car.blend')
    if '--preview' in ARGS:
        preview()


main()
