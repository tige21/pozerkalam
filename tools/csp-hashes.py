#!/usr/bin/env python3
"""Хэши инлайн-скриптов для CSP: python3 tools/csp-hashes.py <html>... → 'sha256-…' через пробел.

Деплой считает этим скриптом и новую сборку на своей машине, и страницы, которые боксы отдают
прямо сейчас (скрипт копируется туда в /tmp), — счёт обязан совпадать до байта, иначе объединённый
заголовок пропустит не тот скрипт. Скрипты с src и JSON-LD хэша не требуют. Несуществующий файл
пропускается: на свежем боксе живых страниц может не быть.
"""
import base64
import hashlib
import re
import sys

out = []
for path in sys.argv[1:]:
    try:
        with open(path, encoding='utf-8') as f:
            s = f.read()
    except OSError:
        continue
    for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S):
        if 'ld+json' in m.group(0):
            continue
        q = "'sha256-%s'" % base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()
        if q not in out:
            out.append(q)
print(' '.join(out))
