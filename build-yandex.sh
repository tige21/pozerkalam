#!/usr/bin/env bash
# Билд «По зеркалам» для Яндекс Игр: build/yandex/index.html + build/yandex.zip.
# Отличия от веб-билда: без Метрики, без PWA (SW/manifest — в iframe площадки они
# мусор и unhandled rejection), с Games SDK (/sdk.js отдаёт площадка) и адаптером
# window.ADS + облачные сейвы trainer_* через player.setData/getData.
# Реклама зовётся с callbacks: onOpen/onClose → window.adsPause — п. 4.7 требований ЯИ
# (игра и звук на паузе во время полноэкранной рекламы).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> минификация"
mkdir -p build/yandex
npx --yes html-minifier-terser index.html -o build/yandex/index.html \
  --collapse-whitespace --remove-comments --minify-css true --minify-js true

echo "==> вырезание PWA, вставка SDK-адаптера"
python3 - <<'PYEOF'
import re
s = open('build/yandex/index.html').read()
# PWA-строки в билде площадки не нужны
s = s.replace('<link rel="manifest" href="/manifest.webmanifest">', '')
s = s.replace('<link rel="icon" type="image/png" href="/icon-192.png">', '')
# Ленивое .*? переживает любую форму строки регистрации: с 9.09 в index.html стоит
# .register('/sw.js').catch(()=>{}), и точный регэксп молча ронял билд 16 дней.
s, n = re.subn(r'try\{"serviceWorker"in navigator&&.*?\}catch\(\w+\)\{\}', '', s)
assert n == 1, 'ожидалась ровно одна регистрация SW, найдено %d' % n
assert 'serviceWorker' not in s, 'SW-регистрация не вырезана'
print('SW-регистраций вырезано:', n)
import hashlib
# Версия сборки нужна в отчётах об ошибках: без неё отчёт из Яндекс Игр не привязать
# к конкретному билду. Считаем до вставки адаптера.
s = s.replace('</head>', '<script>window.BUILD="ya-%s"</script></head>'
              % hashlib.sha256(s.encode()).hexdigest()[:16], 1)
adapter = (
 '<script src="/sdk.js"></script>'
 '<script>YaGames.init().then(function(ysdk){'
 'window.ysdk=ysdk;'
 'var P=function(on){if(window.adsPause)window.adsPause(on)};'
 'window.ADS={'
 'interstitial:function(){try{ysdk.adv.showFullscreenAdv({callbacks:{onOpen:function(){P(true)},onClose:function(){P(false)},onError:function(){P(false)}}})}catch(e){P(false)}},'
 'rewarded:function(cb){try{ysdk.adv.showRewardedVideo({callbacks:{onOpen:function(){P(true)},onRewarded:cb,onClose:function(){P(false)},onError:function(){P(false)}}})}catch(e){P(false)}}'
 '};'
 'ysdk.getPlayer().then(function(p){'
 'p.getData().then(function(d){'
 'try{for(var k in d)if(k.indexOf("trainer_")===0&&!localStorage.getItem(k))localStorage.setItem(k,d[k])}catch(e){}'
 'window.__ysave=function(){var o={};try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);'
 'if(k.indexOf("trainer_")===0)o[k]=localStorage.getItem(k)}}catch(e){}p.setData(o)};'
 'setInterval(window.__ysave,30000);'
 '});}).catch(function(){});'
 'if(ysdk.features&&ysdk.features.LoadingAPI)ysdk.features.LoadingAPI.ready();'
 '}).catch(function(e){console.warn("[ya] init",e)});</script>')
assert '</body>' in s
s = s.replace('</body>', adapter + '</body>', 1)
open('build/yandex/index.html','w').write(s)
print('адаптер вставлен,', len(s), 'байт')
PYEOF

echo "==> zip"
(cd build/yandex && rm -f ../yandex.zip && zip -q -9 ../yandex.zip index.html)
ls -la build/yandex.zip
echo "ГОТОВО: build/yandex.zip — загружать в кабинет Яндекс Игр"
