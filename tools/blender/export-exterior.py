#!/usr/bin/env python3
"""Выгрузка кузовов снаружи для игры: build/assets/car-mesh.json.

    python3 tools/blender/export-exterior.py

Кузова строит tools/blender/exterior.py по build/blender/consts.json (tools/blender/consts.mjs) —
Blender для выгрузки не нужен: модели собираются сразу в бюджете граней, прореживать нечего. Скрипт
падает, если след любого кузова отходит от CAR_HULL больше чем на 1 см, а у седана (своя машина) —
ещё и если он поднимается над линией взгляда на край капота или кромку заднего стекла (по ним
считается blindZone).

Формат: bodies — {sedan, hatch, cross}, у каждого v (вершины подряд, lat y z в кадре кузова), f —
грани {i, m, n, s?, b?, img?, uv?, lamp?} и dy — подъём кузова (на него игра поднимает ручки, швы,
зеркала, дворники). m — материал (paint, glass, trim, liner, lamp, grille, plate), n — нормаль наружу,
s — нормали сглаживания у рёбер v0–v3 и v1–v2, b — bias в метрах, img/uv — картинка и её доля, lamp —
фара/фонарь (head-L, tail-R, …). zones — по стилям a…e доли картинок фонаря и фары, которые светятся
отдельно: задний ход и поворотник; размечаются по очищенным картинкам build/assets/clean.
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import exterior  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONSTS = ROOT / 'build' / 'blender' / 'consts.json'
CLEAN = ROOT / 'build' / 'assets' / 'clean'
OUT = ROOT / 'build' / 'assets' / 'car-mesh.json'
STYLES = 'abcde'
# стиль A размечен вручную: у его фонаря светлый контур по верху сливался с белой секцией, а
# поворотник фары — отражатель без жёлтого цвета
ZONES_A = {'tail': {'rev': [0.77, 0.24, 0.96, 0.50], 'turn': [0.77, 0.55, 0.96, 0.80]},
           'head': {'turn': [0.80, 0.15, 0.97, 0.80]}}


def log(m):
    print('[exterior] ' + m, flush=True)


def find_zone(path, pred, x0):
    """Доля картинки (u0, v0, u1, v1), где лежат пиксели pred правее доли x0; None — не нашлось.
    Ищется только у правого торца: там по брифу секции заднего хода и поворота, а блики стекла
    по всей длине дают ложные «белые» пиксели."""
    if not path.exists():
        return None
    a = np.asarray(Image.open(path).convert('RGBA')).astype(int)
    h, w = a.shape[:2]
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    mask = pred(r, g, b) & (al > 200)
    mask[:, :int(w * x0)] = False
    ys, xs = np.where(mask)
    if len(xs) < max(40, w * h // 4000):
        return None
    return [round(xs.min() / w, 3), round(ys.min() / h, 3), round((xs.max() + 1) / w, 3), round((ys.max() + 1) / h, 3)]


def white(r, g, b):
    return (r > 165) & (g > 165) & (b > 165) & ((np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)) < 45)


def amber(r, g, b):
    return (r > 160) & (g > 70) & (g < 200) & (b < 90) & ((r - g) > 45)


def zones():
    out = {}
    for st in STYLES:
        if st == 'a':
            out[st] = ZONES_A
            continue
        suf = '-' + st
        tail = CLEAN / f'dec-taillight{suf}.png'
        head = CLEAN / f'dec-headlight{suf}.png'
        rev = find_zone(tail, white, 0.65)
        tturn = find_zone(tail, amber, 0.65)
        hturn = find_zone(head, amber, 0.60)
        z = {'tail': {'rev': rev or ZONES_A['tail']['rev'], 'turn': tturn or ZONES_A['tail']['turn']},
             'head': {'turn': hturn or ZONES_A['head']['turn']}}
        miss = [n for n, v in (('задний ход', rev), ('поворот фонаря', tturn), ('поворот фары', hturn)) if v is None]
        log(f'зоны стиля {st.upper()}: ' + ('по картинкам' if not miss else 'нет ' + ', '.join(miss) + ' — взяты зоны A'))
        out[st] = z
    return out


def main():
    if not CONSTS.exists():
        raise SystemExit('нет build/blender/consts.json — сначала node tools/blender/consts.mjs')
    data = json.loads(CONSTS.read_text())
    C = data['consts']
    bodies, failed = {}, False
    for body, cfg in exterior.BODIES.items():
        m, sts, hull = exterior.build(C, body)
        fails, summ = exterior.check(m, hull, C, sightlines=body == 'sedan')
        log(f"{body}: сечений {len(sts)}, вершин {summ['verts']}, граней {summ['faces']}; след ±{summ['dev_cm']} см от CAR_HULL"
            + (f"; над линией взгляда: перёд {summ['over_front']}°, зад {summ['over_rear']}°" if body == 'sedan' else ''))
        for f in fails:
            print(f'ПРОВАЛ {body}: {f}', file=sys.stderr)
            failed = True
        bodies[body] = {'dy': cfg['dy'], 'v': [x for p in m.v for x in p], 'f': m.f}
    if failed:
        raise SystemExit(1)
    out = {'fingerprint': data['fingerprint'], 'bodies': bodies, 'zones': zones()}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text)
    log(f'→ {OUT.relative_to(ROOT)}, {len(text) / 1024:.1f} КБ')


main()
