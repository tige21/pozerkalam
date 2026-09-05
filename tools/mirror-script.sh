#!/bin/bash
# Зеркало inline-скрипта index.html для codegraph: строка N зеркала == строка N index.html.
# codegraph не индексирует .html и пропускает gitignored-файлы, поэтому зеркало трекается в git
# и пересобирается pre-commit/Stop-хуками. Правится только index.html.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=index.html
OUT=codegraph-src/index.js
MODE="${1:-write}"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
awk '
  /<\/script>/  { inside = 0; print ""; next }
  inside        { print; next }
  /<script[ >]/ { inside = 1; print ""; next }
                { print "" }
' "$SRC" > "$TMP"

case "$MODE" in
  --check)
    if ! cmp -s "$TMP" "$OUT" 2>/dev/null; then
      echo "$OUT устарел относительно $SRC — запусти tools/mirror-script.sh" >&2
      exit 1
    fi
    ;;
  write)
    mkdir -p "$(dirname "$OUT")"
    if ! cmp -s "$TMP" "$OUT" 2>/dev/null; then
      cp "$TMP" "$OUT"
    fi
    ;;
  *)
    echo "usage: tools/mirror-script.sh [--check]" >&2
    exit 2
    ;;
esac
