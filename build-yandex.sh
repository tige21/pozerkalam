#!/usr/bin/env bash
# Билд «По зеркалам» для Яндекс Игр: build/yandex/index.html + build/yandex.zip.
# Отличия от веб-билда: без Метрики, без PWA (SW/manifest — в iframe площадки они
# мусор и unhandled rejection), с Games SDK (/sdk.js отдаёт площадка) и адаптером
# window.ADS + облачные сейвы trainer_* через player.setData/getData.
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
s = re.sub(r'try\{"serviceWorker"in navigator&&navigator\.serviceWorker\.register\("/sw\.js"\)\}catch\(\w+\)\{\}', '', s)
assert 'serviceWorker' not in s, 'SW-регистрация не вырезана'
adapter = (
 '<script src="/sdk.js"></script>'
 '<script>YaGames.init().then(function(ysdk){'
 'window.ysdk=ysdk;'
 'window.ADS={'
 'interstitial:function(){try{ysdk.adv.showFullscreenAdv({})}catch(e){}},'
 'rewarded:function(cb){try{ysdk.adv.showRewardedVideo({callbacks:{onRewarded:cb}})}catch(e){}}'
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
