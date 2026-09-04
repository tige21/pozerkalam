#!/usr/bin/env bash
# Деплой «По зеркалам» на pozerkalam.space (хост vdsina из ~/.ssh/config).
# Конвейер: минификация -> вставка Метрики (ID из .deploy.env, в git его нет) ->
# версия SW из sha256 артефакта -> CSP-хэши инлайн-скриптов -> заливка -> смоук.
# Исходник index.html остаётся единым читаемым файлом — собирается только артефакт.
set -euo pipefail
cd "$(dirname "$0")"

HOST=vdsina
DOCROOT=/var/www/pozerkalam
[ -f .deploy.env ] && source .deploy.env
: "${METRIKA_ID:=}"

echo "==> минификация"
mkdir -p build
npx --yes html-minifier-terser index.html -o build/index.html \
  --collapse-whitespace --remove-comments --minify-css true --minify-js true

if [ -n "$METRIKA_ID" ]; then
  echo "==> вставка Метрики (id $METRIKA_ID)"
  python3 - "$METRIKA_ID" <<'PYEOF'
import sys
mid = sys.argv[1]
tag = ('<script>window.METRIKA_ID=%s;'
 '(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};'
 'm[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,'
 'k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script",'
 '"https://mc.yandex.ru/metrika/tag.js","ym");'
 'ym(%s,"init",{ssr:true,webvisor:true,clickmap:true,accurateTrackBounce:true,trackLinks:true});'
 '</script>'
 '<noscript><div><img src="https://mc.yandex.ru/watch/%s" style="position:absolute;left:-9999px" alt=""></div></noscript>') % (mid, mid, mid)
s = open('build/index.html').read()
assert '</head>' in s
open('build/index.html','w').write(s.replace('</head>', tag + '</head>', 1))
PYEOF
else
  echo "==> METRIKA_ID пуст — деплой без счётчика"
fi

echo "==> версия SW"
BUILD_SHA=$(shasum -a 256 build/index.html | cut -c1-16)
sed "s/__BUILD__/${BUILD_SHA}/" sw.js > build/sw.js
cp manifest.webmanifest icon-192.png icon-512.png build/

echo "==> CSP-хэши инлайн-скриптов"
CSP_HASHES=$(python3 - <<'PYEOF'
import re, hashlib, base64
s = open('build/index.html').read()
out = []
for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S):
    h = base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()
    out.append("'sha256-%s'" % h)
print(' '.join(out))
PYEOF
)
echo "    ${CSP_HASHES}"

echo "==> заголовки на сервер"
ssh "$HOST" "cat > /etc/nginx/snippets/pozerkalam-headers.conf" <<EOF
add_header Content-Security-Policy "default-src 'self'; script-src 'self' ${CSP_HASHES} https://mc.yandex.ru; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mc.yandex.ru; connect-src 'self' https://mc.yandex.ru https://*.mc.yandex.ru; worker-src 'self' blob:; child-src blob: https://mc.yandex.ru; frame-ancestors 'self' https://yandex.ru https://*.yandex.net https://playhop.com; base-uri 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
EOF
ssh "$HOST" "grep -q pozerkalam-headers /etc/nginx/sites-available/pozerkalam.space || \
  sed -i '/server_name pozerkalam.space/a\\    include snippets/pozerkalam-headers.conf;' /etc/nginx/sites-available/pozerkalam.space"

echo "==> заливка"
scp -q build/index.html build/sw.js build/manifest.webmanifest build/icon-192.png build/icon-512.png "$HOST:$DOCROOT/"
ssh "$HOST" "nginx -t >/dev/null 2>&1 && systemctl reload nginx"

echo "==> смоук"
sleep 1
code=$(curl -s -m 15 -o /tmp/pz_check.html -w "%{http_code}" https://pozerkalam.space/)
size=$(wc -c < /tmp/pz_check.html | tr -d ' ')
sha_local=$(shasum -a 256 build/index.html | cut -d' ' -f1)
sha_remote=$(shasum -a 256 /tmp/pz_check.html | cut -d' ' -f1)
echo "    HTTP $code, $size байт (исходник: $(wc -c < index.html | tr -d ' '))"
[ "$sha_local" = "$sha_remote" ] && echo "    sha256 артефакта: СОВПАДАЕТ" || { echo "    sha256: РАЗЛИЧАЕТСЯ!"; exit 1; }
if [ -n "$METRIKA_ID" ]; then
  grep -q "mc.yandex.ru/metrika" /tmp/pz_check.html && echo "    счётчик в отдаче: ДА" || { echo "    счётчик НЕ найден!"; exit 1; }
fi
curl -s -m 10 -I https://pozerkalam.space/ | grep -iE "content-security|x-content-type|referrer" | sed 's/^/    /'
curl -s -m 10 -o /dev/null -w "    sw.js: %{http_code}\n" https://pozerkalam.space/sw.js
echo "ГОТОВО: https://pozerkalam.space/ (build ${BUILD_SHA})"
