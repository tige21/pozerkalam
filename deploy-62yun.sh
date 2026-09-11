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

# На сервер уезжает ровно то, что лежит в репозитории: иначе на проде оказывается код, которого
# нет в git — не воспроизвести, не отревьюить, не откатить. Поэтому сначала коммит и пуш.
# Аварийный обход: SKIP_GIT_GUARD=1 (в логе останется предупреждение).
git_guard() {
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "ВНИМАНИЕ: каталог не является git-репозиторием, проверка пропущена" >&2
    return 0
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "ДЕПЛОЙ ОСТАНОВЛЕН: есть незакоммиченные изменения — сначала коммит, потом деплой." >&2
    git status --short >&2
    exit 1
  fi
  local upstream ahead
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
  if [ -z "$upstream" ]; then
    echo "ВНИМАНИЕ: у ветки нет upstream — пушить некуда, деплой пойдёт из локальных коммитов" >&2
    return 0
  fi
  git fetch -q origin 2>/dev/null || true
  ahead=$(git rev-list --count "$upstream"..HEAD 2>/dev/null || echo 0)
  if [ "$ahead" != "0" ]; then
    echo "ДЕПЛОЙ ОСТАНОВЛЕН: $ahead коммит(ов) не отправлено в $upstream — сначала push, потом деплой." >&2
    exit 1
  fi
  echo "==> git: дерево чисто, всё отправлено в $upstream"
}

if [ "${SKIP_GIT_GUARD:-0}" = "1" ]; then
  echo "ВНИМАНИЕ: git-гард отключён (SKIP_GIT_GUARD=1) — на сервер может уехать код, которого нет в репозитории" >&2
else
  git_guard
fi

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
