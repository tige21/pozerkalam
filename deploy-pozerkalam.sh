#!/usr/bin/env bash
# Деплой «По зеркалам» на pozerkalam.space (хост vdsina):
#   корень /            — лендинг (Astro, landing/dist)
#   /play/              — игра (минифицированный артефакт + Метрика + PWA)
#   /sw.js (корень)     — самоликвидатор старого SW (see sw-root-killer.js)
# Исходники в git читаемые; все подстановки (Метрика, пути /play/, версия SW,
# CSP-хэши) делаются только в build/. SSH-ретраи: сеть до сервера мигает.
set -euo pipefail
cd "$(dirname "$0")"

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
# Файлом, а не heredoc'ом прямо в ssh: тот же самый набор хэшей нужен зеркалу, иначе оно
# отдаёт новую сборку под старым CSP и режет собственный скрипт игры.
mkdir -p build
cat > build/pozerkalam-headers.conf <<EOF
add_header Content-Security-Policy "default-src 'self'; script-src 'self' ${CSP_HASHES} https://mc.yandex.ru; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mc.yandex.ru; connect-src 'self' https://mc.yandex.ru https://*.mc.yandex.ru; worker-src 'self' blob:; child-src blob: https://mc.yandex.ru; frame-ancestors 'self' https://yandex.ru https://*.yandex.net https://playhop.com https://vk.com https://*.vk.com https://web.telegram.org; base-uri 'self'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
EOF
scpr build/pozerkalam-headers.conf "$HOST:/etc/nginx/snippets/pozerkalam-headers.conf"

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

# Домен под гео-DNS (Gcore): из РФ юзер приходит на vdsina, из-за рубежа и из-под VPN — на
# зеркало. С машины деплоя имя резолвится куда угодно, поэтому КАЖДАЯ проверка идёт по явному
# адресу: без этого смоук однажды весь прогон проверял зеркало вместо только что залитого прода.
PROD_IP="${PROD_IP:-83.217.215.66}"
MIRROR_HOST="${MIRROR_HOST:-assistant-box}"
MIRROR_IP="${MIRROR_IP:-194.5.65.182}"
RES_PROD=(--resolve "pozerkalam.space:443:$PROD_IP")

# CSP-хэши пересчитываются на каждой сборке. Страница с новыми инлайн-скриптами под старым
# заголовком не запускается вообще: браузер режет скрипт игры молча, файлы при этом целы
# и sha256 сходится — поймать это можно только сверкой хэшей с отданными заголовками.
csp_check(){
  python3 - "$1" "$2" "$3" "${4:-}" <<'PYCSPCHK'
import sys, re, hashlib, base64
html, hdr, where = open(sys.argv[1]).read(), open(sys.argv[2]).read(), sys.argv[3]
quiet = len(sys.argv) > 4 and sys.argv[4] == 'quiet' 
bad = []
for m in re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S):
    if 'ld+json' in m.group(0):
        continue
    q = "'sha256-%s'" % base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode()
    if q not in hdr:
        bad.append(q)
if bad:
    if not quiet:
        print("    CSP %s: %d инлайн-скрипт(ов) вне заголовка — страница не запустится" % (where, len(bad)))
    sys.exit(1)
if not quiet:
    print("    CSP %s: все инлайн-скрипты покрыты" % where)
PYCSPCHK
}

# CSP проверяется с ожиданием: `systemctl reload nginx` асинхронный — старые рабочие дослуживают
# соединения со старым конфигом, а файлы страниц уже новые. Сразу после перезагрузки страница
# приходила под прошлым заголовком, и смоук зеркала ложно падал «инлайн-скрипт вне заголовка»
# на каждом деплое, хотя через пару секунд всё сходилось (#145). Ждём до 15 с; не сошлось — провал.
csp_wait(){
  local ip="$1" path="$2" where="$3" i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} --resolve "pozerkalam.space:443:$ip" \
         -o /tmp/pz_csp.html -D /tmp/pz_csp.hdr "https://pozerkalam.space$path" || true
    if [ -s /tmp/pz_csp.html ] && csp_check /tmp/pz_csp.html /tmp/pz_csp.hdr "$where" quiet; then
      echo "    CSP $where: все инлайн-скрипты покрыты$([ "$i" -gt 1 ] && echo " (с $i-й попытки: nginx дочитывал конфиг)")"
      return 0
    fi
    sleep 1.5
  done
  csp_check /tmp/pz_csp.html /tmp/pz_csp.hdr "$where" || true
  echo "СМОУК ПРОВАЛЕН: CSP $where не сошёлся за 15 с"; exit 1
}

echo "==> смоук (прод $PROD_IP)"
sleep 1
for path in "/" "/play/" "/metodika/" "/avtoshkolam/"; do
  # `|| echo 000`: без него упавший curl под set -e убивает скрипт ВНУТРИ подстановки,
  # смоук не печатает ни строчки, и в логе остаётся только «==> смоук» без причины
  code=$(curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} "${RES_PROD[@]}" -o /dev/null -w "%{http_code}" "https://pozerkalam.space${path}" || echo 000)
  echo "    ${path} -> ${code}"
  [ "$code" = "200" ] || { echo "СМОУК ПРОВАЛЕН на ${path} (000 = сайт недоступен С ЭТОЙ машины; файлы уже залиты, проверить с сервера)"; exit 1; }
done
curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} "${RES_PROD[@]}" https://pozerkalam.space/play/ -o /tmp/pz_play.html -D /tmp/pz_play.hdr
sha_l=$(shasum -a 256 build/play/index.html | cut -d' ' -f1)
sha_r=$(shasum -a 256 /tmp/pz_play.html | cut -d' ' -f1)
[ "$sha_l" = "$sha_r" ] && echo "    /play/ sha256: СОВПАДАЕТ" || { echo "    /play/ sha256 РАЗЛИЧАЕТСЯ"; exit 1; }
grep -q "По зеркалам" /tmp/pz_play.html && echo "    игра на /play/: ДА"
curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} "${RES_PROD[@]}" https://pozerkalam.space/ -o /tmp/pz_root.html -D /tmp/pz_root.hdr
grep -q 'rel="canonical" href="https://pozerkalam.space/"' /tmp/pz_root.html && echo "    лендинг на корне: ДА"
csp_wait "$PROD_IP" /play/ "прод /play/"
csp_wait "$PROD_IP" / "прод /"
if [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
  # dry: эндпоинт проверяется целиком, но сообщение не уходит — иначе каждый деплой
  # присылал бы владельцу мусорный отчёт.
  fb=$(curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} "${RES_PROD[@]}" -X POST https://pozerkalam.space/api/feedback \
       -H 'Content-Type: application/json' \
       -d '{"kind":"note","text":"смоук деплоя, отправка не выполняется","dry":true}')
  echo "    /api/feedback -> ${fb}"
  case "$fb" in *'"ok": true'*|*'"ok":true'*) ;; *) echo "СМОУК ПРОВАЛЕН на /api/feedback"; exit 1;; esac
  pre=$(curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} "${RES_PROD[@]}" -o /dev/null -w "%{http_code}" \
        -X OPTIONS https://pozerkalam.space/api/feedback)
  echo "    /api/feedback OPTIONS -> ${pre}"
  [ "$pre" = "204" ] || { echo "СМОУК ПРОВАЛЕН: preflight не 204"; exit 1; }
fi
# Домен под гео-DNS (Gcore): из РФ юзер приходит на vdsina, из-за рубежа и из-под VPN — на
# зарубежное зеркало. Без этого шага зеркало застывает на прошлой сборке, причём надолго:
# sw.js закрепляет её в браузере. Зеркало — байтовая копия прода, источник правды vdsina.
if [ "${SKIP_MIRROR:-0}" = "1" ]; then
  echo "==> зеркало: ПРОПУЩЕНО (SKIP_MIRROR=1) — зарубежные юзеры остаются на прошлой сборке"
else
  echo "==> зарубежное зеркало ($MIRROR_HOST)"
  MIRROR_TMP=$(mktemp -d)
  trap 'rm -rf "$MIRROR_TMP"' EXIT

  # Один из двух боксов недостижим при любом фиксированном маршруте: из РФ напрямую не везде
  # виден зарубежный бокс, из-под VPN — московский. Поэтому каждый rsync пробуем дважды:
  # с привязкой к физическому интерфейсу и без неё.
  mirror_rsync(){
    local desc="$1"; shift
    if rsync -az --delete -e "ssh -o ConnectTimeout=10 -o BatchMode=yes ${SSH_BIND[*]-}" "$@"; then return 0; fi
    echo "    $desc: ретрай без привязки к интерфейсу"
    rsync -az --delete -e "ssh -o ConnectTimeout=10 -o BatchMode=yes" "$@"
  }
  mirror_ssh(){
    if ssh -o ConnectTimeout=10 -o BatchMode=yes ${SSH_BIND[@]+"${SSH_BIND[@]}"} "$MIRROR_HOST" "$@"; then return 0; fi
    ssh -o ConnectTimeout=10 -o BatchMode=yes "$MIRROR_HOST" "$@"
  }
  mirror_scp(){
    if scp -q -o ConnectTimeout=10 -o BatchMode=yes ${SSH_BIND[@]+"${SSH_BIND[@]}"} "$1" "$MIRROR_HOST:$2"; then return 0; fi
    scp -q -o ConnectTimeout=10 -o BatchMode=yes "$1" "$MIRROR_HOST:$2"
  }

  MIRROR_OK=1
  mirror_rsync "выгрузка с vdsina" "$HOST:$DOCROOT/" "$MIRROR_TMP/" || MIRROR_OK=0
  if [ "$MIRROR_OK" = "1" ]; then
    mirror_rsync "заливка на зеркало" --rsync-path="sudo rsync" "$MIRROR_TMP/" "$MIRROR_HOST:$DOCROOT/" || MIRROR_OK=0
  fi

  # Конфиг зеркала — не только файлы. CSP считается от содержимого страниц, а страницы
  # у зеркала те же: со старым заголовком браузер режет скрипт игры, и зарубежный игрок
  # видит пустую страницу при целых файлах и сошедшемся sha256.
  if [ "$MIRROR_OK" = "1" ]; then
    mirror_scp build/pozerkalam-headers.conf /tmp/pz-headers.conf || MIRROR_OK=0
    mirror_ssh "sudo cp /tmp/pz-headers.conf /etc/nginx/snippets/pozerkalam-headers.conf" || MIRROR_OK=0
    if [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
      # На зеркале своего приёмника нет: локация проксирует отчёт на прод.
      mirror_scp server/nginx-feedback-mirror.conf /tmp/pz-feedback.conf || MIRROR_OK=0
      mirror_ssh "sudo cp /tmp/pz-feedback.conf /etc/nginx/snippets/pozerkalam-feedback.conf" || MIRROR_OK=0
      mirror_ssh "grep -q 'snippets/pozerkalam-feedback.conf' /etc/nginx/sites-available/pozerkalam.space || sudo sed -i 's|    location / { try_files|    include snippets/pozerkalam-feedback.conf;\n    location / { try_files|' /etc/nginx/sites-available/pozerkalam.space" || MIRROR_OK=0
    fi
    mirror_ssh "sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx && echo '    зеркало: nginx перезагружен'" || MIRROR_OK=0
  fi

  if [ "$MIRROR_OK" = "1" ]; then
    # Смоук зеркала идёт через --resolve: гео-DNS с этой машины отдаст московский адрес,
    # а проверить надо именно зарубежное плечо.
    m_code=$(curl -s -m 15 ${CURL_BIND[@]+"${CURL_BIND[@]}"} -o /tmp/pz_mirror.html -D /tmp/pz_mirror.hdr -w "%{http_code}" \
             --resolve "pozerkalam.space:443:$MIRROR_IP" https://pozerkalam.space/play/ || echo 000)
    m_sha=$(shasum -a 256 /tmp/pz_mirror.html | cut -d' ' -f1)
    echo "    зеркало /play/ -> ${m_code}"
    if [ "$m_code" = "200" ] && [ "$m_sha" = "$sha_l" ]; then
      echo "    зеркало sha256: СОВПАДАЕТ с продом"
    else
      echo "ЗЕРКАЛО РАСХОДИТСЯ С ПРОДОМ (код ${m_code}) — зарубежные юзеры на другой сборке"; exit 1
    fi
    csp_wait "$MIRROR_IP" /play/ "зеркало /play/"
    if [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ]; then
      m_fb=$(curl -s -m 20 ${CURL_BIND[@]+"${CURL_BIND[@]}"} --resolve "pozerkalam.space:443:$MIRROR_IP" \
             -X POST https://pozerkalam.space/api/feedback -H 'Content-Type: application/json' \
             -d '{"kind":"note","text":"смоук зеркала, отправка не выполняется","dry":true}' || echo err)
      echo "    зеркало /api/feedback -> ${m_fb}"
      case "$m_fb" in *'"ok": true'*|*'"ok":true'*) ;; *) echo "СМОУК ПРОВАЛЕН: зеркало не проксирует отчёты на прод"; exit 1;; esac
    fi
  else
    echo "ЗЕРКАЛО НЕ ОБНОВЛЕНО: не достучался до $MIRROR_HOST."
    echo "Прод в РФ уже обновлён, зарубежные юзеры остались на прошлой сборке. Догнать вручную:"
    echo "  rsync -az --delete -e 'ssh -J assistant-box' vdsina:$DOCROOT/ /tmp/pz-mirror/"
    echo "  rsync -az --delete --rsync-path='sudo rsync' /tmp/pz-mirror/ $MIRROR_HOST:$DOCROOT/"
    exit 1
  fi
fi

echo "ГОТОВО: лендинг https://pozerkalam.space/ · игра https://pozerkalam.space/play/ (build ${BUILD_SHA})"
