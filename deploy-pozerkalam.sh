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

sshr(){ # ssh с ретраями
  for i in 1 2 3 4 5; do
    if ssh -o ConnectTimeout=10 -o BatchMode=yes "$HOST" "$@"; then return 0; fi
    echo "   ssh-ретрай $i"; sleep 25
  done; return 1
}
scpr(){
  for i in 1 2 3 4 5; do
    if scp -q -o ConnectTimeout=10 "$@"; then return 0; fi
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

echo "==> игра: пути /play/ + Метрика"
python3 - "$METRIKA_ID" <<'PYEOF'
import sys
mid = sys.argv[1]
s = open('build/play/index.html').read()
for a, b in [('href="/manifest.webmanifest"', 'href="/play/manifest.webmanifest"'),
             ('href="/icon-192.png"', 'href="/play/icon-192.png"'),
             ('register("/sw.js")', 'register("/play/sw.js")')]:
    assert a in s, a
    s = s.replace(a, b)
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
BUILD_SHA=$(shasum -a 256 build/play/index.html | cut -c1-16)
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

echo "==> CSP-хэши инлайн-скриптов игры"
CSP_HASHES=$(python3 - <<'PYEOF'
import re, hashlib, base64
s = open('build/play/index.html').read()
out = []
for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S):
    h = base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()
    out.append("'sha256-%s'" % h)
print(' '.join(out))
PYEOF
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

echo "==> заливка"
sshr "mkdir -p $DOCROOT/play"
scpr -r landing/dist/* "$HOST:$DOCROOT/"
scpr build/play/index.html build/play/sw.js build/play/manifest.webmanifest build/play/icon-192.png build/play/icon-512.png "$HOST:$DOCROOT/play/"
scpr sw-root-killer.js "$HOST:$DOCROOT/sw.js"
sshr "nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo RELOADED"

echo "==> смоук"
sleep 1
for path in "/" "/play/" "/metodika/" "/avtoshkolam/"; do
  code=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "https://pozerkalam.space${path}")
  echo "    ${path} -> ${code}"
  [ "$code" = "200" ] || { echo "СМОУК ПРОВАЛЕН на ${path}"; exit 1; }
done
curl -s -m 15 https://pozerkalam.space/play/ -o /tmp/pz_play.html
sha_l=$(shasum -a 256 build/play/index.html | cut -d' ' -f1)
sha_r=$(shasum -a 256 /tmp/pz_play.html | cut -d' ' -f1)
[ "$sha_l" = "$sha_r" ] && echo "    /play/ sha256: СОВПАДАЕТ" || { echo "    /play/ sha256 РАЗЛИЧАЕТСЯ"; exit 1; }
grep -q "По зеркалам" /tmp/pz_play.html && echo "    игра на /play/: ДА"
curl -s -m 15 https://pozerkalam.space/ | grep -q "Научись парковаться" && echo "    лендинг на корне: ДА"
echo "ГОТОВО: лендинг https://pozerkalam.space/ · игра https://pozerkalam.space/play/ (build ${BUILD_SHA})"
