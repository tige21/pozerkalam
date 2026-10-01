"""Общее для скриптов Blender: координаты игры, грани куба, загрузка констант, Cycles.

Кадр кузова игры — (lat, y, z): lat вправо, y вверх, z вперёд (index.html, EYE/WSHIELD/CAR_ST).
В Blender X вправо, Y вперёд, Z вверх, поэтому точка игры (lat, y, z) = Vector((lat, z, y)).
"""
import json
import math
import pathlib
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILD = ROOT / 'build' / 'blender'

# грани куба в кадре кузова игры: (взгляд, вправо по картинке, вверх по картинке).
# Эту же таблицу читает drawCabinCube в index.html — менять только вместе
FACES = {
    'pz': ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    'nz': ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
    'px': ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    'nx': ((-1, 0, 0), (0, 0, 1), (0, 1, 0)),
    'py': ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
    'ny': ((0, -1, 0), (1, 0, 0), (0, 0, 1)),
}


def log(msg):
    print('[blender] ' + msg, flush=True)


def G(lat, y, z):
    return Vector((lat, z, y))


def Gv(v):
    return G(v[0], v[1], v[2])


def script_args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def load_consts(path=None):
    p = pathlib.Path(path) if path else BUILD / 'consts.json'
    if not p.exists():
        raise SystemExit(f'нет {p} — сначала node tools/blender/consts.mjs')
    data = json.loads(p.read_text())
    log(f'константы {p.relative_to(ROOT)}, отпечаток {data["fingerprint"][:12]}')
    return data


def face_matrix(eye, face):
    fwd, right, up = (Gv(d) for d in FACES[face])
    m = Matrix((right, up, -fwd)).transposed().to_4x4()
    m.translation = eye
    return m


def setup_cycles(samples, gpu=True):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    device = 'CPU'
    if gpu:
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            sc.cycles.device = 'GPU'
            device = 'GPU/Metal'
        except Exception as e:  # noqa: BLE001 — без Metal рендерим на CPU, это медленнее, но верно
            log(f'Metal недоступен ({e}), рендер на CPU')
    log(f'Cycles: {samples} сэмплов, шумоподавление, прозрачная плёнка, устройство {device}')


def cube_camera(eye, face, res):
    sc = bpy.context.scene
    cam = bpy.data.objects.get('CubeCam')
    if cam is None:
        cam = bpy.data.objects.new('CubeCam', bpy.data.cameras.new('CubeCam'))
        sc.collection.objects.link(cam)
    cam.data.type = 'PERSP'
    cam.data.sensor_fit = 'HORIZONTAL'
    cam.data.angle = math.radians(90)
    cam.data.clip_start = 0.003
    cam.data.clip_end = 50
    cam.matrix_world = face_matrix(eye, face)
    sc.camera = cam
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    return cam
