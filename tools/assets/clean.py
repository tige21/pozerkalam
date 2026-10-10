#!/usr/bin/env python3
"""Очистка картинок из ChatGPT (assets/src) перед сценой Blender.

Материалы (mat-*): выпрямление штрихов, выравнивание вшитого света, сведение шва плитки,
приведение среднего цвета к цели из брифа docs/prompts/car-cabin-assets.md.
Детали (dec-*): снятие зелёного фона с восстановлением цвета края, обрезка по детали;
у колеса окна между спицами заливаются тёмным (за ними тормозной диск, а не дорога).
Фасады (fac-*): обрезка по швам панелей, рядам кладки и ритму окон, наплыв на шве, размер плитки
в метрах и средний цвет — в build/assets/fac.json для embed.mjs.

    python3 tools/assets/clean.py            → build/assets/clean/*.png + отчёт в stdout
    python3 tools/assets/clean.py --only mat-trim-satin
    python3 tools/assets/clean.py --only fac → вся серия по префиксу

Только Pillow и numpy: scipy на машине нет.
"""
import argparse
import hashlib
import json
import math
import pathlib
import sys
import time

import numpy as np
from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'assets' / 'src'
OUT = ROOT / 'build' / 'assets' / 'clean'

TARGET = {
    'mat-seat-fabric': '3A3C40', 'mat-seat-leather': '2B2C2F', 'mat-dash-soft': '34363A',
    'mat-plastic-hard': '2F3134', 'mat-headliner': 'B9B6B0', 'mat-carpet': '26272A',
    'mat-trim-satin': '8D9096',
}
# штрихи отделки должны идти строго по горизонтали: наклон 1,6° даёт ступеньку ~35 px на стыке плиток
DESKEW = {'mat-trim-satin'}
SEAM_BAND = 0.15
HOLE_FILL = (28, 28, 30)
ALPHA_LO, ALPHA_HI = 0.08, 0.92


def log(msg):
    print('[clean] ' + msg, flush=True)


def source(name):
    for ext in ('.webp', '.png'):
        p = SRC / (name + ext)
        if p.exists():
            return p
    return None


def rgb(v):
    return tuple(int(round(x)) for x in v)


def seam_ratio(a):
    L = a[..., :3].mean(2)
    inner = (np.abs(np.diff(L, axis=1)).mean() + np.abs(np.diff(L, axis=0)).mean()) / 2
    seam = (np.abs(L[:, 0] - L[:, -1]).mean() + np.abs(L[0, :] - L[-1, :]).mean()) / 2
    return seam / max(inner, 1e-6)


def streak_angle(a):
    L = a.mean(2)
    gx = np.diff(L, axis=1)[:-1, :]
    gy = np.diff(L, axis=0)[:, :-1]
    jxx, jyy, jxy = (gx * gx).mean(), (gy * gy).mean(), (gx * gy).mean()
    grad = 0.5 * math.degrees(math.atan2(2 * jxy, jxx - jyy))
    return grad - 90 if grad > 0 else grad + 90


def deskew(img, a):
    ang = streak_angle(a)
    rot = img.rotate(ang, resample=Image.BICUBIC)
    m = math.ceil(img.width * abs(math.sin(math.radians(ang)))) + 2
    side = min(img.width, img.height) - 2 * m
    rot = rot.crop((m, m, m + side, m + side))
    return rot, ang


def flatten(a):
    L = a.mean(2)
    img = Image.fromarray(np.clip(L, 0, 255).astype(np.uint8))
    blur = np.asarray(img.filter(ImageFilter.GaussianBlur(radius=a.shape[1] / 10))).astype(float)
    return a * (L.mean() / np.maximum(blur, 1.0))[..., None]


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def make_seamless(a):
    H, W = a.shape[:2]
    B = np.roll(np.roll(a, H // 2, 0), W // 2, 1)
    x, y = np.arange(W), np.arange(H)
    wx = smoothstep(np.minimum(x, W - 1 - x) / (W * SEAM_BAND))
    wy = smoothstep(np.minimum(y, H - 1 - y) / (H * SEAM_BAND))
    w = (wy[:, None] * wx[None, :])[..., None]
    m = a.mean((0, 1))
    # смешение с сохранением разброса: простое среднее двух шумов гасит контраст в полосе перехода
    norm = np.sqrt(w ** 2 + (1 - w) ** 2)
    return m + ((a - m) * w + (B - m) * (1 - w)) / norm


def to_target(a, hexcol):
    t = np.array([int(hexcol[i:i + 2], 16) for i in (0, 2, 4)], float)
    m = a.reshape(-1, 3).mean(0)
    return a * (t / np.maximum(m, 1.0)), m, t


def clean_material(name, path):
    t0 = time.time()
    img = Image.open(path).convert('RGB')
    a = np.asarray(img).astype(float)
    seam0 = seam_ratio(a)
    note = ''
    if name in DESKEW:
        img, ang = deskew(img, a)
        a = np.asarray(img).astype(float)
        note = f', наклон {ang:+.2f}° выпрямлен → {streak_angle(a):+.2f}°, плитка {img.width}px'
    a = flatten(a)
    a = make_seamless(a)
    a, m0, t = to_target(a, TARGET[name])
    a = np.clip(a, 0, 255)
    seam1 = seam_ratio(a)
    m1 = a.reshape(-1, 3).mean(0)
    clipped = ((a <= 0) | (a >= 255)).any(2).mean()
    Image.fromarray(a.astype(np.uint8)).save(OUT / (name + '.png'))
    log(f'{name}: цвет {rgb(m0)}→{rgb(m1)} '
        f'(цель {rgb(t)}), шов {seam0:.1f}×→{seam1:.1f}×, '
        f'обрезано по краям диапазона {clipped:.2%}{note}, {time.time() - t0:.1f} с')
    if clipped > 0.02:
        log(f'WARN {name}: больше 2 % пикселей упёрлись в 0/255 — контраст для цели слишком высок')


def clean_decal(name, path):
    t0 = time.time()
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    border = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3),
                             a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    G = np.median(border, 0)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = g - np.maximum(r, b)
    green_bg = G[1] - max(G[0], G[2])
    # мёртвая зона по краям: шум фона (σ ≈ 1,5) иначе давал фону частичную прозрачность, а тёмному
    # пластику с отсветом фона — частичную непрозрачность
    t = 1 - green / green_bg
    alpha = np.clip((t - ALPHA_LO) / (ALPHA_HI - ALPHA_LO), 0, 1)
    alpha[alpha < 0.1] = 0
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = (a - (1 - alpha)[..., None] * G) / safe
    # деталей зелёного цвета в брифе нет: остаток зелени на детали — отражение фона
    fg[..., 1] = np.minimum(fg[..., 1], np.maximum(fg[..., 0], fg[..., 2]) + 2)
    fg = np.clip(fg, 0, 255)
    note = ''
    if name.startswith('dec-wheel') and name != 'dec-wheel-pad':
        ys, xs = np.where(alpha > 0.5)
        cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
        rad = min(xs.max() - xs.min(), ys.max() - ys.min()) / 2 - 2
        yy, xx = np.mgrid[:a.shape[0], :a.shape[1]]
        disc = (xx - cx) ** 2 + (yy - cy) ** 2 <= rad ** 2
        holes = disc & (alpha < 0.5)
        fill = np.array(HOLE_FILL, float)
        fg[disc] = fg[disc] * alpha[disc][:, None] + fill * (1 - alpha[disc][:, None])
        alpha[disc] = 1
        note = f', окна между спицами залиты тёмным ({holes.sum()} px)'
    ys, xs = np.where(alpha > 0.5)
    # куски борта трамвая встают встык, и любой прозрачный отступ дал бы щель между ними; стекло
    # зеркала ложится на рамку корпуса, и отступ сузил бы его внутри корпуса
    pad = 0 if name.startswith(('tram-', 'dec-mirror-')) else 8
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, a.shape[1])
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, a.shape[0])
    if name == 'tram-front':
        # перёд ложится на торец шириной кузова, а зеркала торчат за кузов: ширина — по самой длинной
        # сплошной полосе на 70 % высоты, где зеркал уже нет
        row = alpha[y0 + int((y1 - y0) * 0.7)] > 0.5
        runs, start = [], None
        for x, on in enumerate(list(row) + [False]):
            if on and start is None:
                start = x
            if not on and start is not None:
                runs.append((start, x))
                start = None
        bx0, bx1 = max(runs, key=lambda r: r[1] - r[0])
        note += f', обрезан по кузову {bx1 - bx0} из {x1 - x0} px'
        x0, x1 = bx0, bx1
    rgba = np.dstack([fg, alpha * 255])[y0:y1, x0:x1]
    Image.fromarray(rgba.astype(np.uint8), 'RGBA').save(OUT / (name + '.png'))
    obj = rgba[..., 3] > 127
    fr = rgba[..., :3].astype(float)
    fringe = (obj & (fr[..., 1] > np.maximum(fr[..., 0], fr[..., 2]) + 25)).sum()
    log(f'{name}: фон {rgb(G)}, деталь {x1 - x0}×{y1 - y0} px '
        f'(пропорция {(x1 - x0) / (y1 - y0):.2f}), полупрозрачный край {((alpha > 0) & (alpha < 1)).sum()} px, '
        f'зелёная кайма после {fringe} px{note}, {time.time() - t0:.1f} с')
    if fringe > 50:
        log(f'WARN {name}: на детали осталось {fringe} px зелёной каймы')
    if name.startswith('dec-mirror-'):
        mirror_outline(name, rgba[..., 3] > 127)


MIRROR_JSON = ROOT / 'build' / 'assets' / 'mirror.json'
MIRROR_PTS = 16


def hull2d(pts):
    pts = sorted(set(pts))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def seg_dist(p, a, b):
    ax, ay, bx, by = a[0], a[1], b[0], b[1]
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)


def simplify_closed(poly, n_max):
    """Убирает по одной точке с наименьшим отклонением, пока их не останется n_max: у замкнутой
    выпуклой оболочки нет концов, от которых начинал бы Дуглас–Пекер."""
    pts = list(poly)
    while len(pts) > n_max:
        k = min(range(len(pts)), key=lambda i: seg_dist(pts[i], pts[i - 1], pts[(i + 1) % len(pts)]))
        pts.pop(k)
    return pts


def mirror_outline(name, obj):
    """Контур стекла зеркала для корпуса в игре: выпуклая оболочка детали, ≤ 16 точек в долях
    картинки (u вправо, v вниз). Корпус в игре строится по нему, и рамка картинки совпадает с
    торцом корпуса по построению."""
    h, w = obj.shape
    edge = obj & ~(np.roll(obj, 1, 0) & np.roll(obj, -1, 0) & np.roll(obj, 1, 1) & np.roll(obj, -1, 1))
    ys, xs = np.where(edge)
    corners = [(x + dx, y + dy) for x, y in zip(xs.tolist(), ys.tolist()) for dx in (0, 1) for dy in (0, 1)]
    hull = hull2d(corners)
    poly = simplify_closed(hull, MIRROR_PTS)
    dev = max(min(seg_dist(p, poly[i - 1], poly[i]) for i in range(len(poly))) for p in hull)
    area = lambda P: abs(sum(P[i - 1][0] * P[i][1] - P[i][0] * P[i - 1][1] for i in range(len(P)))) / 2
    fill = obj.sum() / area(hull)
    meta = json.loads(MIRROR_JSON.read_text()) if MIRROR_JSON.exists() else {}
    meta[name] = [[round(x / w, 4), round(y / h, 4)] for x, y in poly]
    MIRROR_JSON.write_text(json.dumps(meta, indent=1, sort_keys=True) + '\n')
    log(f'{name}: контур {len(poly)} точек, отклонение от оболочки до {dev:.1f} px из {w}, '
        f'деталь заполняет оболочку на {fill * 100:.1f} %')
    if fill < 0.97:
        log(f'WARN {name}: деталь не выпуклая — корпус по оболочке выйдет шире картинки')


SKY_BLEND = 0.06  # доля ширины неба, на которой правый край наплывает на левый


def clean_sky(name, path):
    """Небо: без ключа, края сводятся наплывом — панорама оборачивается на 360° без шва.
    Правая полоса ширины k накладывается на левую с весом, растущим к правому краю результата;
    результат короче на k, и его последний столбец — сосед первого в исходнике."""
    t0 = time.time()
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    h, w, _ = a.shape
    k = int(w * SKY_BLEND)
    before = np.abs(a[:, 0] - a[:, -1]).mean()
    wgt = (np.arange(k) / k)[None, :, None]
    out = a[:, :w - k].copy()
    out[:, :k] = a[:, :k] * wgt + a[:, w - k:] * (1 - wgt)
    after = np.abs(out[:, 0] - out[:, -1]).mean()
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGB').save(OUT / (name + '.png'))
    log(f'{name}: {w}×{h} → {w - k}×{h}, разница краёв {before:.1f} → {after:.1f} (из 255), {time.time() - t0:.1f} с')


# make_seamless фасаду не годится: он сдвигает плитку на полпериода и смешивает по всей площади — у края
# оказалось бы окно из середины. Фасад сводится обрезкой по швам панелей, рядам кладки и ритму окон
# (замеры — assets/src/SOURCES.md, «Серия 3»), остаток шва — наплывом, как у неба. Обрезка мерена на
# конкретной картинке: ChatGPT отдаёт переделку того же размера, поэтому сверяется отпечаток WebP-исходника
# (sha256, 12 знаков), а не размер. Шов по пикселям не проверяется: он стоит на растворе и пазе панели,
# где шаг яркости и в исходнике выше любого среднего; ритм окон и швов меряет гейт по готовым плиткам
FAC_W = 1024          # ширина выхода; в страницу embed.mjs кладёт 512
FAC_BLEND = 24        # наплыв не шире: дальше поля за линией обрезки у части картинок нет
# тот же кирпич на торце должен быть того же размера, что на фасаде: ряд fac-brick-red — 28,0 px
# (30 рядов на этаж 3,2 м), у торца — 34,35 px, поэтому торец меряется кирпичом, а не этажом
BRICK_PXM_RED = 840 / 3.2
FAC = {
    'fac-panel-a':      dict(sha='fab3907b55f7', src=(1835, 857), crop=(69, 75, 1756, 785), m=(6.0, 2.8)),
    'fac-panel-b':      dict(sha='59c8142a42f3', src=(1834, 858), crop=(76, 109, 1757, 852), m=(6.0, 2.8)),
    # вертикальный шов один, посередине: без его половинок на краях две панели при повторе слились бы в одну
    'fac-panel-end':    dict(sha='afe2fe6e0f1b', src=(1836, 857), crop=(0, 53, 1836, 817), m=(6.0, 2.8), joint=(910, 916, 921)),
    'fac-brick-red':    dict(sha='73ce63e4b672', src=(1717, 916), crop=(9, 21, 1702, 861), m=(6.0, 3.2)),
    'fac-brick-yellow': dict(sha='ca13b7f98aec', src=(1717, 916), crop=(8, 80, 1713, 894), m=(6.0, 3.2)),
    'fac-brick-end':    dict(sha='c82a7c4d0ff1', src=(1717, 916), crop=(4, 24, 1653, 788), pxm=BRICK_PXM_RED * 34.35 / 28.0, like='fac-brick-red'),
    'fac-plaster':      dict(sha='28d1e47e65d3', src=(1717, 916), crop=(39, 0, 1677, 916), m=(6.0, 3.2)),
    'fac-shop-a':       dict(sha='2239e05a8185', src=(1717, 916), crop=(0, 0, 1717, 916), m=(6.0, 3.2), wrap_y=False),
    'fac-shop-b':       dict(sha='e34bbe8c02b4', src=(1717, 916), crop=(0, 0, 1717, 916), m=(6.0, 3.2), wrap_y=False),
}
FAC_JSON = ROOT / 'build' / 'assets' / 'fac.json'


def fac_crop(a, lo, hi, axis):
    """Обрезка [lo, hi) по оси с наплывом: поле исходника за hi ложится на начало плитки с весом, растущим
    к её краю, и последний столбец результата становится соседом первого, как в исходнике."""
    t = np.take(a, np.arange(lo, hi), axis=axis).copy()
    k = min(FAC_BLEND, a.shape[axis] - hi)
    if k <= 0:
        return t, 0
    shape = [1, 1, 1]
    shape[axis] = k
    w = (np.arange(k) / k).reshape(shape)
    head = np.take(a, np.arange(lo, lo + k), axis=axis)
    tail = np.take(a, np.arange(hi, hi + k), axis=axis)
    idx = [slice(None)] * 3
    idx[axis] = slice(0, k)
    t[tuple(idx)] = head * w + tail * (1 - w)
    return t, k


def fac_seam(a, axis):
    """Шаг через шов к 95-му перцентилю шагов между соседними строками (столбцами) — для лога."""
    L = a.mean(2)
    steps = np.abs(np.diff(L, axis=axis)).mean(1 - axis)
    edge = np.abs(L[:, 0] - L[:, -1]).mean() if axis == 1 else np.abs(L[0] - L[-1]).mean()
    return edge / max(np.percentile(steps, 95), 1e-6)


def brick_mean(a):
    """Средний цвет тела кирпича, без швов, окон и перемычек: у них насыщенность R−B низкая."""
    px = a.reshape(-1, 3)
    return px[(px[:, 0] - px[:, 2]) > 50].mean(0)


_fac_cache = {}


def fac_tile(name):
    if name in _fac_cache:
        return _fac_cache[name]
    t0 = time.time()
    spec = FAC[name]
    path = source(name)
    a = np.asarray(Image.open(path).convert('RGB')).astype(float)
    h, w, _ = a.shape
    sha = hashlib.sha256(path.read_bytes()).hexdigest()[:12] if path.suffix == '.webp' else None
    if sha is None:
        log(f'WARN {name}: нет WebP-исходника, отпечаток не сверен — читается {path.name}')
    elif sha != spec['sha']:
        raise SystemExit(f'[clean] ПРОВАЛ {name}: отпечаток исходника {sha}, а обрезка мерена на {spec["sha"]} — '
                         'картинку переделали, обрезку надо мерить заново (assets/src/SOURCES.md, «Серия 3»)')
    if (w, h) != spec['src']:
        raise SystemExit(f'[clean] ПРОВАЛ {name}: исходник {w}×{h}, а обрезка мерена на {spec["src"][0]}×{spec["src"][1]} — '
                         'картинку переделали, обрезку надо мерить заново (assets/src/SOURCES.md, «Серия 3»)')
    x0, y0, x1, y1 = spec['crop']
    if 'joint' in spec:
        jl, jc, jr = spec['joint']
        a = a.copy()
        a[:, 0:jr - jc] = a[:, jc:jr]
        a[:, w - (jc - jl):w] = a[:, jl:jc]
    wrap_y = spec.get('wrap_y', True)
    raw = a[y0:y1, x0:x1]
    s0 = (fac_seam(raw, 1), fac_seam(raw, 0))
    t, kx = fac_crop(a, x0, x1, 1)
    ky = 0
    if wrap_y:
        t, ky = fac_crop(t, y0, y1, 0)
    else:
        t = t[y0:y1]
    note = ''
    if 'like' in spec:
        ref, _ = fac_tile(spec['like'])
        m0, m1 = brick_mean(t), brick_mean(ref)
        t = t * (m1 / np.maximum(m0, 1.0))
        note = f', кирпич {rgb(m0)} → {rgb(m1)} как у {spec["like"]}'
    t = np.clip(t, 0, 255)
    s1 = (fac_seam(t, 1), fac_seam(t, 0))
    if 'pxm' in spec:
        mw, mh = t.shape[1] / spec['pxm'], t.shape[0] / spec['pxm']
    else:
        mw, mh = spec['m']
    out = Image.fromarray(t.astype(np.uint8), 'RGB').resize((FAC_W, round(FAC_W * mh / mw)), Image.LANCZOS)
    o = np.asarray(out).astype(float)
    info = {'w': round(mw, 3), 'h': round(mh, 3), 'mean': list(rgb(o.reshape(-1, 3).mean(0))), 'wrapY': wrap_y}
    log(f'{name}: {w}×{h} → обрезка ({x0},{y0},{x1},{y1}) {x1 - x0}×{y1 - y0} → {out.width}×{out.height} '
        f'({mw:.2f} × {mh:.2f} м), наплыв {kx}/{ky} px, шов по ширине {s0[0]:.2f}×→{s1[0]:.2f}×'
        + (f', по высоте {s0[1]:.2f}×→{s1[1]:.2f}×' if wrap_y else ', по высоте не повторяется')
        + f', цвет {tuple(info["mean"])}{note}, {time.time() - t0:.1f} с')
    _fac_cache[name] = (t, (out, info))
    return _fac_cache[name]


def clean_facades(names):
    meta = json.loads(FAC_JSON.read_text()) if FAC_JSON.exists() else {}
    for n in names:
        if n not in FAC:
            log(f'WARN {n}: нет в таблице FAC — пропущен')
            continue
        _, (out, info) = fac_tile(n)
        out.save(OUT / (n + '.png'))
        meta[n] = info
    FAC_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=1, sort_keys=True) + '\n')
    log(f'фасады: {len([n for n in names if n in FAC])} плиток, описание — {FAC_JSON.relative_to(ROOT)}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='имя картинки или серия по префиксу: mat, dec, tram, sky, fac')
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    names = sorted({p.stem for p in SRC.iterdir() if p.suffix in ('.png', '.webp') and p.stem.split('-')[0] in ('mat', 'dec', 'tram', 'sky', 'fac')})
    if args.only:
        names = [n for n in names if n == args.only or n.split('-')[0] == args.only]
    missing = [n for n in TARGET if n not in names and not args.only]
    if missing:
        log('WARN нет материалов: ' + ', '.join(missing))
    t0 = time.time()
    for n in names:
        p = source(n)
        if n.startswith('mat-'):
            if n not in TARGET:
                log(f'WARN {n}: нет цели цвета в TARGET — пропущен')
                continue
            clean_material(n, p)
        elif n.startswith('sky-'):
            clean_sky(n, p)
        elif n.startswith('fac-'):
            continue
        else:
            clean_decal(n, p)
    facs = [n for n in names if n.startswith('fac-')]
    if facs:
        clean_facades(facs)
    log(f'готово: {len(names)} файлов в {OUT.relative_to(ROOT)}, {time.time() - t0:.1f} с')
    return 0


if __name__ == '__main__':
    sys.exit(main())
