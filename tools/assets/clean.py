#!/usr/bin/env python3
"""Очистка картинок из ChatGPT (assets/src) перед сценой Blender.

Материалы (mat-*): выпрямление штрихов, выравнивание вшитого света, сведение шва плитки,
приведение среднего цвета к цели из брифа docs/prompts/car-cabin-assets.md.
Детали (dec-*): снятие зелёного фона с восстановлением цвета края, обрезка по детали;
у колеса окна между спицами заливаются тёмным (за ними тормозной диск, а не дорога).

    python3 tools/assets/clean.py            → build/assets/clean/*.png + отчёт в stdout
    python3 tools/assets/clean.py --only mat-trim-satin

Только Pillow и numpy: scipy на машине нет.
"""
import argparse
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
    'mat-wheel-leather': '1D1E20', 'mat-trim-satin': '8D9096',
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
    if name == 'dec-wheel':
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
    pad = 8
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, a.shape[1])
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, a.shape[0])
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only')
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    names = sorted({p.stem for p in SRC.iterdir() if p.suffix in ('.png', '.webp') and p.stem[:4] in ('mat-', 'dec-')})
    if args.only:
        names = [n for n in names if n == args.only]
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
        else:
            clean_decal(n, p)
    log(f'готово: {len(names)} файлов в {OUT.relative_to(ROOT)}, {time.time() - t0:.1f} с')
    return 0


if __name__ == '__main__':
    sys.exit(main())
