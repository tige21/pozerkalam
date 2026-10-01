"""Пререндер салона: 6 граней куба по 90° из глаза водителя (EYE) в кадре кузова и ещё 6 — из точки
камеры салонного зеркала (CMIR): зеркало смотрит из своей точки, и куб из глаза для него неверен.

    Blender -b build/blender/car.blend -P tools/blender/bake-cabin.py -- [--quick] [--samples N] [--only cabin|cmir]

Окна прозрачны полностью (плёнка Cycles прозрачная): тон лобового игра рисует до куба —
полупрозрачное стекло в кубе на перехлёстах ячеек легло бы дважды и дало сетку. Выход:
build/assets/cabin-<грань>.png и build/assets/bake-stamp.json с отпечатком констант, на которых
собрана сцена: tools/blender/consts.mjs --check сверяет его с index.html (@render-cabin-bake-fresh).
Разрешение граней: перёд 2048 — это ≈23 px на градус, 1:1 на экране 1280 px при DPR 2;
бока 1536; зад, верх и низ 1024 — туда смотрят реже и с меньшими деталями. Салонное зеркало видит
≈70° по горизонтали и до 25° по вертикали с поворотом на 18°/12° — это задняя грань и края боковых;
вперёд, вверх и вниз оно не смотрит, но шейдер выбирает из шести граней, поэтому там заглушки 128 px.
"""
import json
import sys
import time

import bpy

sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import FACES, G, ROOT, cube_camera, load_consts, log, script_args, setup_cycles  # noqa: E402

RES = {'pz': 2048, 'px': 1536, 'nx': 1536, 'nz': 1024, 'py': 1024, 'ny': 1024}
RES_CMIR = {'nz': 1024, 'px': 512, 'nx': 512, 'pz': 128, 'py': 128, 'ny': 128}
OUT = ROOT / 'build' / 'assets'


def bake(prefix, point, res_table, quick):
    sc = bpy.context.scene
    v = G(point['lat'], point['y'], point['z'])
    faces = {}
    for face, res in res_table.items():
        r = min(res, 384) if quick else res
        cube_camera(v, face, r)
        path = OUT / f'{prefix}-{face}.png'
        sc.render.filepath = str(path)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        faces[face] = {'file': path.name, 'res': r, 'look_right_up': FACES[face]}
        log(f'грань {prefix}-{face}: {r}×{r}, {time.time() - t:.1f} с → {path.relative_to(ROOT)}')
    return faces


def main():
    args = script_args()
    quick = '--quick' in args
    samples = int(args[args.index('--samples') + 1]) if '--samples' in args else (24 if quick else 128)
    only = args[args.index('--only') + 1] if '--only' in args else None
    sc = bpy.context.scene
    fp = sc.get('consts_fingerprint')
    if not fp:
        raise SystemExit('в сцене нет consts_fingerprint — собрать заново: tools/blender/car.py')
    data = load_consts()
    if data['fingerprint'] != fp:
        raise SystemExit(f'сцена собрана на других константах ({fp[:12]}), в consts.json {data["fingerprint"][:12]} — пересобрать car.py')
    C = data['consts']
    eye = C['EYE']
    # точка камеры салонного зеркала — та же, что mirrorCam('center') в index.html: у заднего края стекла
    cmir = {'lat': 0.0, 'y': C['CMIR']['y'], 'z': round(C['CMIR']['z'] - C['CMIR']['d'], 6)}
    setup_cycles(samples)
    OUT.mkdir(parents=True, exist_ok=True)
    stamp_path = OUT / 'bake-stamp.json'
    stamp = {}
    if only:
        stamp = json.loads(stamp_path.read_text()) if stamp_path.exists() else {}
        if stamp.get('fingerprint') != fp or stamp.get('quick') != quick:
            raise SystemExit('--only дописывает к готовому рендеру тех же констант и качества — его нет, нужен полный рендер')
    t0 = time.time()
    if only in (None, 'cabin'):
        stamp.update({'eye': eye, 'faces': bake('cabin', eye, RES, quick)})
    if only in (None, 'cmir'):
        stamp['cmir'] = {'eye': cmir, 'faces': bake('cmir', cmir, RES_CMIR, quick)}
    stamp.update({'fingerprint': fp, 'samples': samples, 'quick': quick, 'baked': time.strftime('%Y-%m-%dT%H:%M:%S')})
    stamp_path.write_text(json.dumps(stamp, ensure_ascii=False, indent=1))
    log(f'куб готов: {only or "cabin + cmir"}, {samples} сэмплов, {time.time() - t0:.0f} с; отпечаток {fp[:12]}')


main()
