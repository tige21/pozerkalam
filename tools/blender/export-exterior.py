#!/usr/bin/env python3
"""Выгрузка кузова снаружи для игры: build/assets/car-mesh.json.

    python3 tools/blender/export-exterior.py

Меш строит tools/blender/exterior.py по build/blender/consts.json (tools/blender/consts.mjs) — Blender
для выгрузки не нужен: модель собирается сразу в бюджете граней, прореживать нечего. Скрипт падает,
если след модели отходит от CAR_HULL больше чем на 1 см или кузов поднимается над линией взгляда на
край капота или кромку заднего стекла (по ним считается blindZone).

Формат: v — вершины подряд (lat, y, z) в кадре кузова; f — грани {i, m, n, s?, b?, img?, uv?, lamp?}:
m — материал (paint, glass, trim, liner, lamp, grille, plate), n — нормаль наружу, s — нормали
сглаживания у рёбер v0–v3 и v1–v2 (градиент борта), b — bias сортировки в метрах (накладка на
грань), img/uv — картинка и её доля, lamp — фара/фонарь (head-L, tail-R, …). zones — доли картинок
фонаря и фары, которые светятся отдельно: задний ход, поворотник.
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import exterior  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONSTS = ROOT / 'build' / 'blender' / 'consts.json'
OUT = ROOT / 'build' / 'assets' / 'car-mesh.json'
# доли картинок (u0, v0, u1, v1), размечены по build/assets/clean: у фонаря белая и жёлтая секции
# у внутреннего торца, у фары поворотник — отражатель у наружного торца
ZONES = {
    'tail': {'rev': [0.77, 0.24, 0.96, 0.50], 'turn': [0.77, 0.55, 0.96, 0.80]},
    'head': {'turn': [0.80, 0.15, 0.97, 0.80]},
}


def log(m):
    print('[exterior] ' + m, flush=True)


def main():
    if not CONSTS.exists():
        raise SystemExit('нет build/blender/consts.json — сначала node tools/blender/consts.mjs')
    data = json.loads(CONSTS.read_text())
    C = data['consts']
    m, sts, hull = exterior.build(C)
    fails, summ = exterior.check(m, hull, C)
    log(f"сечений {len(sts)}, вершин {summ['verts']}, граней {summ['faces']}; след ±{summ['dev_cm']} см от CAR_HULL; "
        f"над линией взгляда: перёд {summ['over_front']}°, зад {summ['over_rear']}°")
    if fails:
        for f in fails:
            print('ПРОВАЛ ' + f, file=sys.stderr)
        raise SystemExit(1)
    by = {}
    for f in m.f:
        by[f['m']] = by.get(f['m'], 0) + 1
    log('по материалам: ' + ', '.join(f'{k} {v}' for k, v in sorted(by.items())))
    out = {'fingerprint': data['fingerprint'], 'v': [x for p in m.v for x in p], 'f': m.f, 'zones': ZONES}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    OUT.write_text(text)
    log(f'→ {OUT.relative_to(ROOT)}, {len(text) / 1024:.1f} КБ')


main()
