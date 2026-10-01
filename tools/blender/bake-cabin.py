"""Пререндер салона: 6 граней куба по 90° из глаза водителя (EYE) в кадре кузова.

    Blender -b build/blender/car.blend -P tools/blender/bake-cabin.py -- [--quick] [--samples N]

Окна прозрачны полностью (плёнка Cycles прозрачная): тон лобового игра рисует до куба —
полупрозрачное стекло в кубе на перехлёстах ячеек легло бы дважды и дало сетку. Выход:
build/assets/cabin-<грань>.png и build/assets/bake-stamp.json с отпечатком констант, на которых
собрана сцена: tools/blender/consts.mjs --check сверяет его с index.html (@render-cabin-bake-fresh).
Разрешение граней: перёд 2048 — это ≈23 px на градус, 1:1 на экране 1280 px при DPR 2;
бока 1536; зад, верх и низ 1024 — туда смотрят реже и с меньшими деталями.
"""
import json
import sys
import time

import bpy

sys.path.insert(0, __import__('os').path.dirname(__file__))
from common import FACES, G, ROOT, cube_camera, load_consts, log, script_args, setup_cycles  # noqa: E402

RES = {'pz': 2048, 'px': 1536, 'nx': 1536, 'nz': 1024, 'py': 1024, 'ny': 1024}
OUT = ROOT / 'build' / 'assets'


def main():
    args = script_args()
    quick = '--quick' in args
    samples = int(args[args.index('--samples') + 1]) if '--samples' in args else (24 if quick else 128)
    sc = bpy.context.scene
    fp = sc.get('consts_fingerprint')
    if not fp:
        raise SystemExit('в сцене нет consts_fingerprint — собрать заново: tools/blender/car.py')
    data = load_consts()
    if data['fingerprint'] != fp:
        raise SystemExit(f'сцена собрана на других константах ({fp[:12]}), в consts.json {data["fingerprint"][:12]} — пересобрать car.py')
    eye = data['consts']['EYE']
    eye_v = G(eye['lat'], eye['y'], eye['z'])
    setup_cycles(samples)
    OUT.mkdir(parents=True, exist_ok=True)
    faces = {}
    t0 = time.time()
    for face, res in RES.items():
        r = 384 if quick else res
        cube_camera(eye_v, face, r)
        path = OUT / f'cabin-{face}.png'
        sc.render.filepath = str(path)
        t = time.time()
        bpy.ops.render.render(write_still=True)
        faces[face] = {'file': path.name, 'res': r, 'look_right_up': FACES[face]}
        log(f'грань {face}: {r}×{r}, {time.time() - t:.1f} с → {path.relative_to(ROOT)}')
    stamp = {'fingerprint': fp, 'eye': eye, 'samples': samples, 'quick': quick, 'faces': faces,
             'baked': time.strftime('%Y-%m-%dT%H:%M:%S')}
    (OUT / 'bake-stamp.json').write_text(json.dumps(stamp, ensure_ascii=False, indent=1))
    log(f'куб готов: {len(faces)} граней, {samples} сэмплов, {time.time() - t0:.0f} с; отпечаток {fp[:12]}')


main()
