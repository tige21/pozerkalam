#!/usr/bin/env bash
# Деплой «По зеркалам» на pozerkalam.space (хост vdsina):
#   корень /            — лендинг (Astro, landing/dist)
#   /play/              — игра (минифицированный артефакт + Метрика + PWA)
#   /sw.js (корень)     — самоликвидатор старого SW (see sw-root-killer.js)
# Исходники в git читаемые; все подстановки (Метрика, пути /play/, версия SW,
# CSP-хэши) делаются только в build/. SSH-ретраи: сеть до сервера мигает.
set -euo pipefail
cd "$(dirname "$0")"

HOST=vdsina
DOCROOT=/var/www/pozerkalam
[ -f .deploy.env ] && source .deploy.env
: "${METRIKA_ID:=}"

# При включённом VPN (Happ) маршрут по умолчанию уходит в utun, и ssh к серверу
# виснет на banner exchange, а curl не доходит до сайта. Привязываем к физическому
# интерфейсу — деплой перестаёт зависеть от того, включён VPN или нет.
BIND_IF=""
if [ -n "${DEPLOY_IF:-}" ]; then BIND_IF="$DEPLOY_IF"
elif route -n get default 2>/dev/null | grep -q 'interface: utun' && ipconfig getifaddr en0 >/dev/null 2>&1; then
  BIND_IF=en0
fi
SSH_BIND=(); CURL_BIND=()
if [ -n "$BIND_IF" ]; then
  SSH_BIND=(-o "BindInterface=$BIND_IF"); CURL_BIND=(--interface "$BIND_IF")
  echo "==> VPN активен: соединения через $BIND_IF"
fi

sshr(){ # ssh с ретраями
  for i in 1 2 3 4 5; do
    if ssh -o ConnectTimeout=10 -o BatchMode=yes ${SSH_BIND[@]+"${SSH_BIND[@]}"} "$HOST" "$@"; then return 0; fi
    echo "   ssh-ретрай $i"; sleep 25
  done; return 1
}
scpr(){
  for i in 1 2 3 4 5; do
    if scp -q -o ConnectTimeout=10 ${SSH_BIND[@]+"${SSH_BIND[@]}"} "$@"; then return 0; fi
    echo "   scp-ретрай $i"; sleep 25
  done; return 1
}

echo "==> лендинг: билд"
(cd landing && npm run build >/dev/null 2>&1)
[ -f landing/dist/index.html ] || { echo "лендинг не собрался"; exit 1; }

echo "==> игра: минификация"
mkdir -p build/play
npx --yes html-minifier-terser index.html -o build/play/index.html \
  --collapse-whitespace --remove-comments --minify-css true --minify-js true

# Версию считаем от чистого минифицированного файла, до вставок: она попадает и в SW,
# и в window.BUILD. Без версии в отчёте об ошибке «у меня баг» неотличимо от «у меня
# старый кэш SW».
BUILD_SHA=$(shasum -a 256 build/play/index.html | cut -c1-16)

echo "==> игра: пути /play/ + версия сборки + Метрика"
python3 - "$METRIKA_ID" "$BUILD_SHA" <<'PYEOF'
import sys
mid, build = sys.argv[1], sys.argv[2]
s = open('build/play/index.html').read()
for a, b in [('href="/manifest.webmanifest"', 'href="/play/manifest.webmanifest"'),
             ('href="/icon-192.png"', 'href="/play/icon-192.png"'),
             ('register("/sw.js")', 'register("/play/sw.js")')]:
    assert a in s, a
    s = s.replace(a, b)
s = s.replace('</head>', '<script>window.BUILD="%s"</script></head>' % build, 1)
if mid:
    tag = ('<script>window.METRIKA_ID=%s;'
     '(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};'
     'm[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,'
     'k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script",'
     '"https://mc.yandex.ru/metrika/tag.js","ym");'
     'ym(%s,"init",{ssr:true,webvisor:true,clickmap:true,accurateTrackBounce:true,trackLinks:true});'
     '</script>'
     '<noscript><div><img src="https://mc.yandex.ru/watch/%s" style="position:absolute;left:-9999px" alt=""></div></noscript>') % (mid, mid, mid)
    s = s.replace('</head>', tag + '</head>', 1)
open('build/play/index.html','w').write(s)
PYEOF

echo "==> игра: SW с версией и путями /play/"
python3 - "$BUILD_SHA" <<'PYEOF'
import sys
s = open('sw.js').read().replace('__BUILD__', sys.argv[1])
for a, b in [("const CORE = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];",
              "const CORE = ['/play/', '/play/manifest.webmanifest', '/play/icon-192.png', '/play/icon-512.png'];"),
             ("caches.open(CACHE).then((c) => c.put('/', cp))", "caches.open(CACHE).then((c) => c.put('/play/', cp))"),
             ("catch(() => caches.match('/'))", "catch(() => caches.match('/play/'))"),
             ("url.pathname === '/' || url.pathname === '/index.html'",
              "url.pathname === '/play/' || url.pathname === '/play/index.html'")]:
    assert a in s, a
    s = s.replace(a, b)
open('build/play/sw.js','w').write(s)
PYEOF
python3 - <<'PYEOF'
import json
m = json.load(open('manifest.webmanifest'))
m['start_url'] = '/play/'; m['scope'] = '/play/'
for i in m['icons']: i['src'] = '/play' + i['src']
json.dump(m, open('build/play/manifest.webmanifest','w'), ensure_ascii=False, indent=2)
PYEOF
cp icon-192.png icon-512.png build/play/

echo "==> CSP-хэши инлайн-скриптов игры и лендинга"
# Astro инлайнит маленькие бандлы, и такой скрипт режется CSP уровня server —
# поэтому хэши считаем по всем отдаваемым HTML, а не только по игре.
CSP_HASHES=$(python3 - <<'PYCSP'
import re, hashlib, base64, glob
files = ['build/play/index.html'] + sorted(glob.glob('landing/dist/**/*.html', recursive=True))
out = []
for f in files:
    s = open(f).read()
    for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S):
        if 'ld+json' in m.group(0):
            continue
        h = base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()
        q = "'sha256-%s'" % h
        if q not in out:
            out.append(q)
print(' '.join(out))
PYCSP
)

echo "==> заголовки"
sshr "cat > /etc/nginx/snippets/pozerkalam-headers.conf" <<EOF
add_header Content-Security-Policy "default-src 'self'; script-src 'self' ${CSP_HASHES} https://mc.yandex.ru; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mc.yandex.ru; connect-src 'self' https://mc.yandex.ru https://*.mc.yandex.ru; worker-src 'self' blob:; child-src blob: https://mc.yandex.ru; frame-ancestors 'self' https://yandex.ru https://*.yandex.net https://playhop.com https://vk.com https://*.vk.com https://web.telegram.org; base-uri 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
EOF

echo "==> nginx: location для /play/"
sshr 'grep -q "location = /play/index.html" /etc/nginx/sites-available/pozerkalam.space || \
  sed -i "s|location = /index.html { add_header Cache-Control \"no-cache\"; include snippets/pozerkalam-headers.conf; }|location = /index.html { add_header Cache-Control \"no-cache\"; include snippets/pozerkalam-headers.conf; }\n    location = /play/index.html { add_header Cache-Control \"no-cache\"; include snippets/pozerkalam-headers.conf; }|" /etc/nginx/sites-available/pozerkalam.space'

echo "==> приёмник отзывов"
if [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
  scpr server/feedback.py "$HOST:/tmp/feedback.py"
  scpr server/pozerkalam-feedback.service "$HOST:/etc/systemd/system/pozerkalam-feedback.service"
  scpr server/nginx-feedback.conf "$HOST:/etc/nginx/snippets/pozerkalam-feedback.conf"
  sshr "mkdir -p /opt/pozerkalam-feedback && mv /tmp/feedback.py /opt/pozerkalam-feedback/feedback.py"
  # env кладём файлом, а не heredoc'ом через sshr: у ретрая ssh стандартный ввод уже пуст,
  # и вторая попытка записала бы пустой файл — сервис молча остался бы без токена.
  # Значения не эхоятся: никакого set -x в этом блоке.
  TMPENV=$(mktemp); chmod 600 "$TMPENV"
  {
    echo "# Прямого доступа к api.telegram.org с РФ-хостинга нет (замер: таймаут 15 с)."
    echo "# NO_PROXY=api.telegram.org уводит канал в офлайн — не добавлять."
    echo "TG_TOKEN=$TG_TOKEN"
    echo "TG_CHAT_ID=$TG_CHAT_ID"
    [ -n "${TG_PROXY:-}" ] && printf 'HTTPS_PROXY=%s\nhttps_proxy=%s\n' "$TG_PROXY" "$TG_PROXY"
  } > "$TMPENV"
  scpr "$TMPENV" "$HOST:/etc/pozerkalam-feedback.env"
  rm -f "$TMPENV"
  sshr "chown root:root /etc/pozerkalam-feedback.env && chmod 600 /etc/pozerkalam-feedback.env"
  sshr "printf 'limit_req_zone \$binary_remote_addr zone=fb:1m rate=6r/m;\n' > /etc/nginx/conf.d/pozerkalam-limits.conf"
  sshr 'grep -q "pozerkalam-feedback.conf" /etc/nginx/sites-available/pozerkalam.space || \
    sed -i "s|    location / { try_files|    include snippets/pozerkalam-feedback.conf;\n    location / { try_files|" /etc/nginx/sites-available/pozerkalam.space'
  sshr "systemctl daemon-reload && systemctl enable pozerkalam-feedback >/dev/null 2>&1; systemctl restart pozerkalam-feedback && echo '    сервис перезапущен'"
  sshr "sleep 1; systemctl is-active pozerkalam-feedback"
  # Виден ли Telegram через прокси — сервис проверяет сам на старте и пишет в journal.
  sshr "journalctl -u pozerkalam-feedback -n 5 --no-pager | grep -E 'telegram (доступен|НЕДОСТУПЕН)' || true"
else
  echo "    пропуск: в .deploy.env нет TG_TOKEN/TG_CHAT_ID"
fi

echo "==> заливка"
sshr "mkdir -p $DOCROOT/play"
scpr -r landing/dist/* "$HOST:$DOCROOT/"
scpr build/play/index.html build/play/sw.js build/play/manifest.webmanifest build/play/icon-192.png build/play/icon-512.png "$HOST:$DOCROOT/play/"
scpr sw-root-killer.js "$HOST:$DOCROOT/sw.js"
sshr "nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo RELOADED"

echo "==> смоук"
sleep 1
for path in "/" "/play/" "/metodika/" "/avtoshkolam/"; do
  code=$(curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} -o /dev/null -w "%{http_code}" "https://pozerkalam.space${path}")
  echo "    ${path} -> ${code}"
  [ "$code" = "200" ] || { echo "СМОУК ПРОВАЛЕН на ${path}"; exit 1; }
done
curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} https://pozerkalam.space/play/ -o /tmp/pz_play.html
sha_l=$(shasum -a 256 build/play/index.html | cut -d' ' -f1)
sha_r=$(shasum -a 256 /tmp/pz_play.html | cut -d' ' -f1)
[ "$sha_l" = "$sha_r" ] && echo "    /play/ sha256: СОВПАДАЕТ" || { echo "    /play/ sha256 РАЗЛИЧАЕТСЯ"; exit 1; }
grep -q "По зеркалам" /tmp/pz_play.html && echo "    игра на /play/: ДА"
curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} https://pozerkalam.space/ | grep -q 'rel="canonical" href="https://pozerkalam.space/"' && echo "    лендинг на корне: ДА"
if [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
  # dry: эндпоинт проверяется целиком, но сообщение не уходит — иначе каждый деплой
  # присылал бы владельцу мусорный отчёт.
  fb=$(curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} -X POST https://pozerkalam.space/api/feedback \
       -H 'Content-Type: application/json' \
       -d '{"kind":"note","text":"смоук деплоя, отправка не выполняется","dry":true}')
  echo "    /api/feedback -> ${fb}"
  case "$fb" in *'"ok": true'*|*'"ok":true'*) ;; *) echo "СМОУК ПРОВАЛЕН на /api/feedback"; exit 1;; esac
  pre=$(curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} -o /dev/null -w "%{http_code}" \
        -X OPTIONS https://pozerkalam.space/api/feedback)
  echo "    /api/feedback OPTIONS -> ${pre}"
  [ "$pre" = "204" ] || { echo "СМОУК ПРОВАЛЕН: preflight не 204"; exit 1; }
fi
echo "ГОТОВО: лендинг https://pozerkalam.space/ · игра https://pozerkalam.space/play/ (build ${BUILD_SHA})"
