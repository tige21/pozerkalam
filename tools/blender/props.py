"""Обустройство города — готовые модели Kenney (CC0, assets/src/models/kenney) → build/assets/props-mesh.json.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/props.py

Деревья и кусты — из набора Kenney Nature Kit (CC0, автора указывать не обязательно); выбор владельца
04.10.2026 по листу превью из трёх наборов (план city-details.md). Скамьи, урны, павильоны и опоры контактной
сети в CC0-наборах Kenney не нашлись — они коробками в коде. Фонарь и бак City Kit Roads тоже заменены
коробками: фонарь там — толстый гнутый брус (на высоте 8,5 м стойка выходила толщиной 0,6 м), а бак после
разбора палитры по цветам — 148 граней на предмет, которых во дворе десятки.

- Масштаб целиком, одним множителем: высота модели = высоте из MODELS. У Kenney дерево — 1,1–1,9 единицы.
- Цвет: у Nature Kit материал называет листву и кору — игра красит их своей палитрой (листва набора
  бирюзовая, владелец выбирал по листу с натуральной зеленью). У модели на палитре-текстуре (City Kit) цвет
  грани берётся из текстуры в центре её UV, и до склейки граней каждому цвету — свой материал: иначе склейка
  по материалу слила бы в одну грань полосы разных цветов.
- Грани одной плоскости и одного цвета склеиваются, как у кузовов (models.py): рендер заливает грань одним
  цветом, а число граней — то, во что упирается кадр телефона.
- Дерево собирается заново: от модели берутся размеры кроны, сама крона — тело вращения по профилю породы
  (PROFILE) на оси ствола, ствол — призма до низа кроны; дальний вид — те же кольца реже (подробнее — в build).
- Начало координат — центр ствола у земли: генератор ставит предмет точкой, касание — по стволу.
"""
import json
import math
import pathlib
import sys

import bmesh
import bpy
import mathutils

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'assets' / 'src' / 'models' / 'kenney'
OUT = ROOT / 'build' / 'assets' / 'props-mesh.json'
MAX_POLY = 48                 # заготовки массивов на грань в игре — те же, что у кузовов (carModel.scratch)
CROWN_N, LOD_N = 8, 6         # граней кроны по кругу: вблизи и в дальнем виде
# профиль кроны породы: (доля высоты кроны, доля наибольшего радиуса) снизу вверх — силуэт модели Kenney,
# выпрямленный в тело вращения. Наклоны убывают (профиль вогнутый) — тело выпуклое
PROFILE = {
    'tree-a': [(0, .55), (.38, 1), (.8, .78), (1, .35)],      # липа: круглая крона
    'tree-b': [(0, .62), (.4, 1), (.8, .8), (1, .4)],         # дуб: шире и площе
    'tree-c': [(0, .75), (.4, 1), (.78, .78), (1, .3)],       # низкая пышная
    'tree-d': [(0, .55), (.3, 1), (.8, .75), (1, .28)],       # тополь: колонна
    'tree-e': [(0, .5), (.35, 1), (.8, .72), (1, .3)],        # яйцо
    'pine': [(0, 1), (.45, .6), (.8, .25), (1, 0)],           # ель: конус
    'bush': [(0, .8), (.45, 1), (1, .6)],                     # куст: подстриженный ком
}
TRUNK_R = 0.022               # радиус ствола у земли — доля высоты дерева: 8 м → 0,18 м
TRUNK_IN = 0.15               # ствол заходит в крону на 15 см: без захода между ними просвечивала щель

# имя в игре: файл, высота, м; leaf — у куста вся модель листва
MODELS = {
    'tree-a': ('nature/tree_default.glb', 8.0),
    'tree-b': ('nature/tree_oak.glb', 8.5),
    'tree-c': ('nature/tree_fat.glb', 6.0),
    'tree-d': ('nature/tree_tall.glb', 10.0),
    'tree-e': ('nature/tree_simple.glb', 7.0),
    'pine': ('nature/tree_pineTallA.glb', 9.0),
    'bush-a': ('nature/plant_bushDetailed.glb', 1.1),
    'bush-b': ('nature/plant_bush.glb', 0.8),
    'bush-c': ('nature/plant_bushLarge.glb', 0.9),
}
KIND = {'leafsGreen': 'leaf', 'leafsDark': 'leaf', 'grass': 'leaf', 'woodBark': 'wood', 'woodBarkDark': 'wood'}


def log(m):
    print('[props] ' + m, flush=True)


def srgb(c):
    return [int(round(255 * (1.055 * v ** (1 / 2.4) - 0.055 if v > 0.0031308 else 12.92 * v))) for v in c[:3]]


def load(rel):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SRC / rel))
    objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bm = bmesh.new()
    for o in objs:
        part = bmesh.new()
        part.from_mesh(o.data)
        part.transform(o.matrix_world)
        me = bpy.data.meshes.new('tmp')
        part.to_mesh(me)
        bm.from_mesh(me)
    return objs, bm


_PIX = {}


def pixels(img):
    # упакованная в glb картинка отдаёт пустые пиксели, пока её не загрузить явно, — и цвет грани выходил пустым
    if img.name not in _PIX:
        px = list(img.pixels)
        if not px:
            img.reload()
            px = list(img.pixels)
        if not px:
            raise SystemExit(f'картинка {img.name} не читается')
        _PIX[img.name] = px
    return _PIX[img.name]


def face_colors(objs):
    """Цвет или вид каждой грани исходных объектов в порядке их граней."""
    out = []
    for o in objs:
        me = o.data
        uv = me.uv_layers.active.data if me.uv_layers.active else None
        for p in me.polygons:
            m = o.material_slots[p.material_index].material if o.material_slots else None
            kind = KIND.get(m.name) if m else None
            if kind:
                out.append(kind)
                continue
            img = None
            if m and m.use_nodes:
                img = next((n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
            if img and uv:
                u = sum(uv[i].uv.x for i in p.loop_indices) / p.loop_total
                v = sum(uv[i].uv.y for i in p.loop_indices) / p.loop_total
                w, h = img.size
                x, y = min(w - 1, max(0, int(u % 1 * w))), min(h - 1, max(0, int(v % 1 * h)))
                k = (y * w + x) * 4
                px = pixels(img)[k:k + 3]
                # пиксели байтовой картинки Blender отдаёт линейными — в игру нужен sRGB
                out.append(tuple(srgb(px)))
            else:
                bsdf = m.node_tree.nodes.get('Principled BSDF') if m and m.use_nodes else None
                out.append(tuple(srgb(bsdf.inputs['Base Color'].default_value)) if bsdf else (128, 128, 128))
    return out


def to_mesh(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def prepare(objs, bm):
    cols = face_colors(objs)
    keys = sorted(set(cols), key=str)
    slot = {k: i for i, k in enumerate(keys)}
    for f, c in zip(bm.faces, cols):
        f.material_index = slot[c]
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    return keys


def revolve(cx, cy, zb, zt, R, prof, n):
    """Крона — тело вращения: n граней по кругу, кольца по профилю породы (доля высоты кроны, доля радиуса).
    Профиль вогнутый, поэтому тело выпуклое и его грани сортируются без ошибок; радиус 0 — вершина (ель),
    иначе сверху плоская шапка. Обход колец против часовой при взгляде сверху даёт нормали наружу"""
    bm = bmesh.new()
    a = [2 * math.pi * (i + 0.5) / n for i in range(n)]
    rings = []
    for f, r in prof:
        z = zb + (zt - zb) * f
        rings.append([bm.verts.new((cx, cy, z))] if r <= 1e-6 else
                     [bm.verts.new((cx + R * r * math.cos(t), cy + R * r * math.sin(t), z)) for t in a])
    bm.faces.new(list(reversed(rings[0])))
    for A, B in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((A[j], A[(j + 1) % n], B[0]) if len(B) == 1 else (A[j], A[(j + 1) % n], B[(j + 1) % n], B[j]))
    if len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    for f in bm.faces:
        f.material_index = 0
    return bm


def trunk(cx, cy, z0, z1, rb, rt, n):
    """Ствол — призма от земли до низа кроны; без торцов: низ на земле, верх внутри кроны. Обход боковых граней
    против часовой при взгляде сверху даёт нормали наружу"""
    bm = bmesh.new()
    a = [2 * math.pi * (i + 0.5) / n for i in range(n)]
    bot = [bm.verts.new((cx + rb * math.cos(t), cy + rb * math.sin(t), z0)) for t in a]
    top = [bm.verts.new((cx + rt * math.cos(t), cy + rt * math.sin(t), z1)) for t in a]
    for i in range(n):
        f = bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
        f.material_index = 1
    return bm


def export(bm, keys, frame):
    """Вершины и грани в кадре игры (lat, вверх, вперёд) с округлением до сантиметра."""
    bm.normal_update()
    vid, V, F = {}, [], []
    for f in bm.faces:
        if f.calc_area() < 1e-8:
            continue
        idx = []
        for v in f.verts:
            if v not in vid:
                p = frame(v.co)
                vid[v] = len(V)
                V.append([round(c, 2) for c in p])
            idx.append(vid[v])
        n0 = f.normal
        n = frame(n0, direction=True)
        L = math.sqrt(sum(c * c for c in n)) or 1
        k = keys[f.material_index]
        e = {'i': idx, 'n': [round(c / L, 2) for c in n]}
        if isinstance(k, str):
            e['m'] = k
        else:
            e['c'] = list(k)
        F.append(e)
    return V, F


def build(name):
    rel, height = MODELS[name]
    objs, bm = load(rel)
    tris0 = sum(len(f.verts) - 2 for f in bm.faces)
    keys = prepare(objs, bm)
    zs = [v.co.z for v in bm.verts]
    z0, z1 = min(zs), max(zs)
    k = height / (z1 - z0)
    # ствол — вершины в нижних 8 % высоты: их центр становится началом координат
    low = [v.co for v in bm.verts if v.co.z < z0 + 0.08 * (z1 - z0)]
    cx, cy = sum(p.x for p in low) / len(low), sum(p.y for p in low) / len(low)
    leaf_i = keys.index('leaf') if 'leaf' in keys else -1
    leaf = list({tuple(round(c, 5) for c in v.co): v.co.copy() for f in bm.faces if f.material_index == leaf_i for v in f.verts}.values())
    if len(leaf) < 4:
        raise SystemExit(f'{name}: у модели нет листвы')

    def frame(co, direction=False):
        p = co if direction else mathutils.Vector((co.x - cx, co.y - cy, co.z - z0))
        if direction:
            return (-p.x, p.z, -p.y)
        return (-p.x * k, p.z * k, -p.y * k)

    # Модель Kenney как есть не годится рендеру с сортировкой граней: части кроны вставлены друг в друга, ствол
    # уходит в крону до середины и рисовался поверх неё, а упрощение модели склеивало ствол с кроной в веретено.
    # Выпуклая оболочка листвы это лечила, но выходила неровной и местами заваленной набок (владелец: «сделаем
    # деревья более аккуратными»). От модели берутся только размеры кроны — низ, верх и радиус; сама крона —
    # тело вращения по профилю породы ровно на оси ствола, ствол — призма до низа кроны. Дальний вид — те же
    # кольца без промежуточных, шесть граней по кругу и четырёхгранный ствол
    tree = not name.startswith('bush')
    lc = (sum(p.x for p in leaf) / len(leaf), sum(p.y for p in leaf) / len(leaf))
    R = max(math.hypot(p.x - lc[0], p.y - lc[1]) for p in leaf)
    zb, zt = (min(p.z for p in leaf), max(p.z for p in leaf)) if tree else (z0, z1)
    prof = PROFILE['bush' if not tree else name]
    widest = max(range(len(prof)), key=lambda i: prof[i][1])
    lod_prof = [prof[i] for i in sorted({0, widest, len(prof) - 1})]
    crown = revolve(cx, cy, zb, zt, R, prof, CROWN_N)
    lod_crown = revolve(cx, cy, zb, zt, R, lod_prof, LOD_N)
    keys2 = ['leaf', 'wood']
    rb = TRUNK_R * (z1 - z0)
    parts, lod_parts = [crown], [lod_crown]
    if tree:
        ztop = zb + TRUNK_IN / k
        parts.append(trunk(cx, cy, z0, ztop, rb, rb * 0.6, 6))
        lod_parts.append(trunk(cx, cy, z0, ztop, rb, rb * 0.6, 4))

    def export_parts(ps):
        V, F = [], []
        for b in ps:
            v, f = export(b, keys2, frame)
            for e in f:
                e['i'] = [i + len(V) for i in e['i']]
            V += v
            F += f
        return V, F

    V, F = export_parts(parts)
    LV, LF = export_parts(lod_parts)
    cr = [V[i] for f in F if f.get('m') == 'leaf' for i in f['i']]
    meta = {'h': round(height, 2), 'r': round(max(math.hypot(p[0], p[2]) for p in cr), 2),
            'y0': round(min(p[1] for p in cr), 2)}
    if tree:
        meta['tr'] = round(rb * k, 2)
    max_n = max(len(f['i']) for f in F + LF)
    fails = []
    if max_n > MAX_POLY:
        fails.append(f'{name}: грань из {max_n} вершин — у игры заготовки до {MAX_POLY}')
    log(f'{name} ({rel}): {tris0} тр. → {len(F)} граней, дальний вид {len(LF)}; ×{k:.2f}, '
        + ', '.join(f'{a} {b}' for a, b in meta.items()))
    out = {**meta, 'v': [c for p in V for c in p], 'f': F}
    if tree:
        out['lod'] = {'v': [c for p in LV for c in p], 'f': LF}
    return out, fails


def main():
    models, fails = {}, []
    for name in MODELS:
        m, f = build(name)
        models[name] = m
        fails += f
    for f in fails:
        print('ПРОВАЛ ' + f, file=sys.stderr)
    if fails:
        raise SystemExit(1)
    out = {'source': 'Kenney Nature Kit 2.1, City Kit Roads (CC0)', 'models': models}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text)
    log(f'→ {OUT.relative_to(ROOT)}, {len(text) / 1024:.1f} КБ')


main()
