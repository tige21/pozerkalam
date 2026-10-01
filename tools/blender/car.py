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

MATS = {
    'door': ((0.055, 0.057, 0.062), 0.7), 'trim': ((0.040, 0.042, 0.046), 0.6),
    'headliner': ((0.47, 0.45, 0.42), 0.9), 'dash': ((0.045, 0.047, 0.052), 0.65),
    'seat': ((0.065, 0.067, 0.072), 0.85), 'carpet': ((0.020, 0.021, 0.023), 0.95),
    'frit': ((0.004, 0.004, 0.005), 0.4), 'seal': ((0.010, 0.010, 0.011), 0.5),
    'satin': ((0.30, 0.31, 0.33), 0.35), 'panel': ((0.012, 0.012, 0.014), 0.5),
}
BAKED = []
GLASS = []


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    rgb, rough = MATS[name]
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


def make_obj(name, verts, faces, mats, bevel=0.0, smooth_angle=None):
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
        md.segments = 3
        md.limit_method = 'ANGLE'
    BAKED.append(ob)
    return ob


def prism(name, prof_zy, lat0, lat1, mat, bevel=0.004, smooth_angle=40):
    """Профиль (z, y), вытянутый поперёк кузова от lat0 до lat1."""
    n = len(prof_zy)
    verts = [G(lat0, y, z) for z, y in prof_zy] + [G(lat1, y, z) for z, y in prof_zy]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces += [list(range(n))[::-1], list(range(n, 2 * n))]
    return make_obj(name, verts, faces, mat, bevel, smooth_angle)


def box(name, lo, hi, mat, bevel=0.006):
    (a0, b0, c0), (a1, b1, c1) = lo, hi
    v = [G(a, b, c) for a in (a0, a1) for b in (b0, b1) for c in (c0, c1)]
    f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
    return make_obj(name, v, f, mat, bevel, 30)


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
    inner = [inset_pts(p, INSET) for p in outer]
    E = range(0, 11)

    def glass(i, e):
        k = st[i]['k']
        return (k == 'glass' and e in (4, 5, 6)) or (k == 'cabin' and e in (3, 7))

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
        if e in (1, 2, 8, 9):
            return 'door'
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
    off = nrm * 0.003
    ring_in = [p + off for p in W]
    ring_out = [p + (p - cen).normalized() * FRIT + off for p in W]
    verts = ring_in + ring_out
    faces = [[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i] for i in range(4)]
    make_obj('frit', verts, faces, 'frit')
    return W, nrm


def srgb_to_linear(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def glass_material(name, rgb, alpha):
    """Прозрачность в кадре = alpha: смесь прозрачного и самосвечения, как emitLit в игре —
    тон не зависит от света сцены."""
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    mix = nt.nodes.new('ShaderNodeMixShader')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*(srgb_to_linear(c) for c in rgb), 1)
    mix.inputs['Fac'].default_value = alpha
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def build_glass(nrm):
    """Лобовое как в игре (emitDash): холодный тон 0,10 по всему WSHIELD и солнцезащитная
    полоса 0,30 сверху. Стекло на 1 мм дальше фритты — фритта закрывает его кромку."""
    W = [Gv(p) for p in C['WSHIELD']]
    back = -nrm * 0.001
    strip = [G(-0.74, 1.36, 0.29), G(0.74, 1.36, 0.29), G(0.74, 1.30, 0.35), G(-0.74, 1.30, 0.35)]
    for name, pts, rgb, a, off in (('glass_tint', W, (150, 180, 215), 0.10, back),
                                   ('glass_sunstrip', strip, (30, 45, 70), 0.30, back * 0.5)):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p + off) for p in pts], [], [[0, 1, 2, 3]])
        me.materials.append(glass_material(name, rgb, a))
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        GLASS.append(ob)
    log('лобовое: тон 0,10 и полоса 0,30 — значения emitDash')


def build_dash():
    cx, cy, cz = C['CLUSTER']['c']
    rd = C['CLUSTER']['rd']
    # перед водителем лицевая панель отодвинута до z 0,60: циферблат (z 0,552) и обод руля
    # (низ на z 0,425, бока на 0,50) стоят перед ней, а не внутри неё — иначе живые слои
    # оказались бы «за» обшивкой и рисовать их поверх куба было бы неверно
    drv = [(0.92, 0.985), (0.78, 1.000), (0.66, 1.012), (0.61, 1.008), (0.60, 0.990), (0.60, 0.700),
           (0.58, 0.620), (0.62, 0.520), (0.72, 0.480), (0.92, 0.480)]
    pas = [(0.92, 0.985), (0.78, 1.000), (0.64, 1.012), (0.56, 1.008), (0.52, 0.988), (0.50, 0.952),
           (0.47, 0.860), (0.45, 0.740), (0.47, 0.620), (0.55, 0.520), (0.70, 0.480), (0.92, 0.480)]
    prism('dash_driver', drv, -0.90, -0.12, 'dash', 0.006, 35)
    prism('dash_main', pas, -0.12, 0.90, 'dash', 0.006, 35)
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
    top = S['y'] + S['hh'] - 0.033
    box('tunnel', (-0.14, 0.30, -0.44), (0.14, top, 0.24), 'trim', 0.012)
    zs = [S['z0'] - k * S['step'] for k in range(len(C['SEL_ORDER']))]
    box('gate_plate', (-0.05, top, min(zs) - 0.05), (0.05, top + 0.004, max(zs) + 0.05), 'panel', 0.002)
    prism('center_stack', [(0.47, 0.86), (0.48, 0.70), (0.24, 0.66), (0.24, top), (0.40, 0.80)], -0.15, 0.15, 'dash')
    return top


def build_seats():
    def seat(lat, name):
        box(name + '_cushion', (lat - 0.25, 0.42, -0.52), (lat + 0.25, 0.58, 0.02), 'seat', 0.035)
        verts, faces = [], []
        for (zb, zt, yb, yt) in [(-0.50, -0.64, 0.56, 1.06)]:
            for dl in (-0.26, 0.26):
                verts += [G(lat + dl, yb, zb), G(lat + dl, yt, zt), G(lat + dl, yt, zt - 0.11), G(lat + dl, yb, zb - 0.13)]
        faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
        o = make_obj(name + '_back', verts, faces, 'seat', 0.04, 30)
        box(name + '_headrest', (lat - 0.13, 1.08, -0.70), (lat + 0.13, 1.19, -0.62), 'seat', 0.03)
        return o
    seat(EYE['lat'], 'seat_l')
    seat(-EYE['lat'], 'seat_r')
    box('bench_cushion', (-0.72, 0.42, -1.30), (0.72, 0.60, -0.84), 'seat', 0.04)
    verts = []
    for dl in (-0.74, 0.74):
        verts += [G(dl, 0.58, -1.28), G(dl, 1.00, -1.40), G(dl, 1.00, -1.52), G(dl, 0.58, -1.42)]
    faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
    make_obj('bench_back', verts, faces, 'seat', 0.04, 30)
    for lat in (-0.48, 0.0, 0.48):
        box(f'rear_headrest_{lat:+.2f}', (lat - 0.12, 1.03, -1.48), (lat + 0.12, 1.14, -1.41), 'seat', 0.03)


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
        box(f'visor_{sg:+d}', (sg * 0.14 if sg > 0 else -0.62, 1.355, 0.08), (0.62 if sg > 0 else -0.14, 1.372, 0.22), 'headliner', 0.006)
        for z0, z1 in ((-0.20, 0.42), (-1.02, -0.46)):
            lat = sg * 0.80
            box(f'armrest_{sg:+d}_{z0:+.2f}', (min(lat, lat - sg * 0.05), 0.70, z0), (max(lat, lat - sg * 0.05), 0.745, z1), 'door', 0.012)
    box('header', (-0.74, 1.362, 0.20), (0.74, 1.40, 0.255), 'headliner', 0.008)


def build_lights():
    world = bpy.context.scene.world or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (0.70, 0.78, 0.92, 1)
    bg.inputs['Strength'].default_value = 1.0
    li = bpy.data.lights.new('windshield_sky', 'AREA')
    li.shape = 'RECTANGLE'
    li.size, li.size_y = 2.2, 1.2
    li.energy = 260
    ob = bpy.data.objects.new('windshield_sky', li)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = G(0, 2.4, 1.9)
    ob.rotation_euler = (G(0, 0.9, -0.3) - ob.location).to_track_quat('-Z', 'Y').to_euler()


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
    log(f'обзор: в проёме WSHIELD выше линии капота ({HOOD_DEG:.2f}°) ничего нет')


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
    build_glass(nrm)
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
