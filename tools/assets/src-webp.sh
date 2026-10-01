#!/bin/bash
# Исходники из ChatGPT хранятся в git как WebP q95: PNG серии весят 41 МБ и навсегда раздули бы
# историю, а q95 на этих картинках неотличим и для clean.py, и на глаз. PNG остаются локально
# (assets/src/*.png в .gitignore) — перегенерировать WebP можно в любой момент.
#   tools/assets/src-webp.sh            → assets/src/*.webp рядом с PNG, размеры в stdout
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/assets/src"
shopt -s nullglob
total_png=0; total_webp=0; n=0
for png in *.png; do
  webp="${png%.png}.webp"
  cwebp -quiet -q 95 -m 6 -metadata none "$png" -o "$webp"
  a=$(stat -f%z "$png"); b=$(stat -f%z "$webp")
  total_png=$((total_png + a)); total_webp=$((total_webp + b)); n=$((n + 1))
  printf '[src-webp] %-24s %6d КБ → %5d КБ\n' "$png" $((a / 1024)) $((b / 1024))
done
[ "$n" -gt 0 ] || { echo "[src-webp] в assets/src нет PNG" >&2; exit 1; }
printf '[src-webp] итого %d файлов: %d МБ → %.1f МБ\n' "$n" $((total_png / 1048576)) "$(echo "$total_webp / 1048576" | bc -l)"
