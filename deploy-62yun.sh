#!/usr/bin/env bash
# Обновление тренажёра на сервере 62yun (194.5.65.182).
#
# Вход по SSH-ключу под пользователем hermes (запись "assistant-box" в ~/.ssh/config).
# Пароль root не нужен и не используется.
#
# Что уже настроено на сервере:
#   /var/www/car-trainer/index.html                      — сам файл игры
#   /etc/nginx/sites-available/car-trainer.conf          — vhost, server_name 194.5.65.182
#   /etc/nginx/sites-enabled/car-trainer.conf            — симлинк на него
#
# Vhost отвечает ТОЛЬКО на обращения по IP. Домены (yoube.space, doloy-unynie.duckdns.org,
# analytics.sparkcards.space, dify-farm.duckdns.org) и default_server не затрагиваются.
set -euo pipefail

HOST="${HOST:-assistant-box}"
URL="http://194.5.65.182/"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/index.html"

[ -f "$SRC" ] || { echo "нет файла $SRC"; exit 1; }
echo "==> файл: $(wc -c <"$SRC" | tr -d ' ') байт"

echo "==> заливаю"
scp -q -o BatchMode=yes "$SRC" "$HOST:/tmp/car-trainer.html"

echo "==> ставлю на место"
ssh -o BatchMode=yes "$HOST" '
  set -e
  sudo install -o www-data -g www-data -m 644 /tmp/car-trainer.html /var/www/car-trainer/index.html
  rm -f /tmp/car-trainer.html
  sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx
  curl -sS -o /dev/null -w "   на сервере: HTTP %{http_code}, %{size_download} байт\n" http://127.0.0.1/ -H "Host: 194.5.65.182"
'

echo "==> проверка снаружи"
curl -sS -m 15 -o /tmp/car-trainer-check.html -w "   $URL -> HTTP %{http_code}, %{size_download} байт\n" "$URL"
if cmp -s /tmp/car-trainer-check.html "$SRC"; then
  echo "   отданный файл совпадает с локальным: ДА"
else
  echo "   ВНИМАНИЕ: отданный файл отличается от локального"
fi
rm -f /tmp/car-trainer-check.html

echo
echo "ГОТОВО: $URL"
