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
- Дальний вид (lod) — та же модель, упрощённая до LOD_TRI треугольников: силуэт тот же, граней втрое меньше.
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
LOD_TRI = 14
TRUNK_K = 0.5

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


def merge(bm):
    n0 = len(bm.faces)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts[:], edges=bm.edges[:], delimit={'MATERIAL'})
    return n0 - len(bm.faces)


def decimated(bm, tris):
    ob = to_mesh(bm, 'lod')
    mod = ob.modifiers.new('d', 'DECIMATE')
    mod.ratio = min(1.0, LOD_TRI / max(1, tris))
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out = bmesh.new()
    out.from_mesh(me)
    return out


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
    # ствол или стойка — вершины в нижних 8 % высоты: их центр становится началом координат
    low = [v.co for v in bm.verts if v.co.z < z0 + 0.08 * (z1 - z0)]
    cx, cy = sum(p.x for p in low) / len(low), sum(p.y for p in low) / len(low)
    # ствол Kenney — брус: при высоте 8 м он выходил толщиной до 0,9 м против ~0,3 у живого дерева. Вершины, у
    # которых все грани — кора, стягиваются к оси ствола; крона и место, где в неё входит ствол, не меняются
    if 'wood' in keys:
        wood = keys.index('wood')
        for v in bm.verts:
            if v.link_faces and all(f.material_index == wood for f in v.link_faces):
                v.co.x = cx + (v.co.x - cx) * TRUNK_K
                v.co.y = cy + (v.co.y - cy) * TRUNK_K

    def frame(co, direction=False):
        p = co if direction else mathutils.Vector((co.x - cx, co.y - cy, co.z - z0))
        if direction:
            return (-p.x, p.z, -p.y)
        return (-p.x * k, p.z * k, -p.y * k)

    merged = merge(bm)
    V, F = export(bm, keys, frame)
    lod_bm = decimated(bm, tris0)
    merge(lod_bm)
    LV, LF = export(lod_bm, keys, frame)
    leaf = [V[i] for f in F if f.get('m') == 'leaf' for i in f['i']]
    wood = [V[i] for f in F if f.get('m') == 'wood' for i in f['i']]
    meta = {'h': round(height, 2)}
    if leaf:
        meta['r'] = round(max(math.hypot(p[0], p[2]) for p in leaf), 2)
        meta['y0'] = round(min(p[1] for p in leaf), 2)
    if wood:
        meta['tr'] = round(max(math.hypot(p[0], p[2]) for p in wood if p[1] < 0.3), 2) if any(p[1] < 0.3 for p in wood) else 0.15
    max_n = max(len(f['i']) for f in F)
    fails = []
    if max_n > MAX_POLY:
        fails.append(f'{name}: грань из {max_n} вершин — у игры заготовки до {MAX_POLY}')
    log(f'{name} ({rel}): {tris0} тр. → {len(F)} граней (склеено {merged}), дальний вид '
        f'{str(len(LF)) + " граней" if len(LF) <= 0.6 * len(F) else "не нужен"}; '
        f'×{k:.2f}, ' + ', '.join(f'{a} {b}' for a, b in meta.items()))
    out = {**meta, 'v': [c for p in V for c in p], 'f': F}
    # дальний вид — только если он правда дешевле: у мелкой модели упрощение до LOD_TRI граней не убавляет
    if len(LF) <= 0.6 * len(F):
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
