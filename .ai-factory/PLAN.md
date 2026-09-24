# Implementation Plan: Билд Яндекс Игр снова собирается + гейт на выход build-yandex.sh (#176)

Branch: main (create_branches: false)
Created: 2026-09-25
Доска: Vikunja «По зеркалам» #176 (P0) · блокирует #28 «подать в кабинет Яндекс Игр»

## Settings
- Testing: yes — новый инструмент `tools/yandex-check.mjs` (playwright-core из `PW_DIR`, как `mt-check`) поднимает `build/yandex/` со статического сервера и мок-`/sdk.js`; сценарии `@ui @dist` привязаны кодами требований; существующие гейты не трогаются
- Logging: standard — `echo` этапов в билд-скрипте (как сейчас), строки `ok/ПРОВАЛ` в инструменте; никаких логов в игре
- Docs: yes — строка запуска в CLAUDE.md «Commands», абзац в «Distribution builds» про урок с регэкспом, шаг в docs/PUBLISH.md

## Roadmap Linkage
Milestone: "M4 · Яндекс Игры"
Rationale: M4 отмечен выполненным, а ZIP с 9 сентября не собирается — канал закрыт, пока билд не починен и не защищён гейтом.

## Контекст (что сломано и почему)
- `build-yandex.sh:20` вырезает регистрацию SW регэкспом `try\{"serviceWorker"in navigator&&navigator\.serviceWorker\.register\("/sw\.js"\)\}catch\(\w+\)\{\}`.
- `index.html:10557` с коммита fb8b0f6 (2026-09-09) — `navigator.serviceWorker.register('/sw.js').catch(()=>{})`; после html-minifier-terser строка выглядит так:
  `try{"serviceWorker"in navigator&&navigator.serviceWorker.register("/sw.js").catch(()=>{})}catch(t){}`.
- Регэксп не совпадает → `assert 'serviceWorker' not in s` → `AssertionError: SW-регистрация не вырезана` (подтверждено запуском 25.09). `build/yandex.zip` лежит от 7.09.
- Ни один гейт не запускает `build-yandex.sh`, поэтому поломка жила 16 дней. «Мок-тест» из ROADMAP в репозитории отсутствует (grep по `sdk.js|YaGames` в tools/: 0).
- Из аудита 25.09 отдельной задачей #184 остаются GameplayAPI, getPayments, ценный rewarded, гейт формы отзывов — в этот план НЕ входят.

## Tasks

### Phase 1: Починить билд
- [x] Task 1: `build-yandex.sh` — вырезать регистрацию SW устойчиво к форме строки.
  Заменить регэксп на ленивый: `re.subn(r'try\{"serviceWorker"in navigator&&.*?\}catch\(\w+\)\{\}', '', s)` и проверять `n == 1` (assert с текстом «ожидалась ровно одна регистрация SW, найдено N»), затем прежний `assert 'serviceWorker' not in s`. Ленивое `.*?` останавливается на первом `}catch(x){}` — `()=>{}` внутри заканчивается `)`, а не `catch`, ложного среза нет. Прогнать `./build-yandex.sh` — должен дойти до «ГОТОВО», `build/yandex/index.html` без `serviceWorker`, с `window.BUILD="ya-…"` и адаптером перед `</body>`.
  Файлы: `build-yandex.sh`. Логи: существующие `echo "==> …"` + печать «SW-регистраций вырезано: 1».

### Phase 2: Гейт на собранный билд
- [x] Task 2: `tools/yandex-check.mjs` — проверка `build/yandex/index.html` в headless Chromium (depends on 1).
  Шапка и запуск браузера как в `tools/mt-check.mjs` (`PW_DIR`, `PW_CHROME`, `check(name, ok, detail)`, exit 1 при провале). Если `build/yandex/index.html` нет — вызвать `./build-yandex.sh` через `child_process.execFileSync` (сам билд — часть проверки). Поднять `node:http` на `127.0.0.1:0` с раздачей `build/yandex/` и мок-`/sdk.js`: `window.YaGames={init:()=>Promise.resolve(ysdk)}`, где `ysdk.adv.showFullscreenAdv/showRewardedVideo` зовут `callbacks.onOpen → onRewarded → onClose` синхронно и пишут в `window.__ya.calls`, `ysdk.getPlayer()` → `{getData:()=>Promise.resolve({trainer_gearbox:'MT'}), setData:(o)=>{window.__ya.saved=o}}`, `ysdk.features.LoadingAPI.ready` → флаг. Проверки с кодами требований в имени:
  - `@dist-yandex-no-sw` — в отданном HTML нет `serviceWorker`, `navigator.serviceWorker.getRegistrations()` пуст;
  - `@dist-yandex-build-tag` — `window.BUILD` начинается с `ya-` и имеет 19 символов;
  - `@dist-yandex-sdk-ready` — `window.ysdk` есть, `LoadingAPI.ready` вызван, `window.ADS.interstitial/rewarded` — функции;
  - `@dist-yandex-ads-pause` — прямой вызов `window.ADS.interstitial()` даёт `paused===true` внутри `onOpen` и `false` после `onClose` (проверять через `window.adsPause`-обёртку: перед вызовом подменить `window.adsPause` на запись состояний);
  - `@dist-yandex-cloud-merge` — облачный `trainer_gearbox:'MT'` попал в localStorage только при пустом локальном; `window.__ysave()` кладёт в `setData` все `trainer_*` ключи;
  - `@dist-yandex-console-clean` — ноль `pageerror` и ноль `console.error` за 3 с после старта уровня 1 (`doAct('start')` через `pressKey`/кнопку, как в mt-check).
  Файлы: `tools/yandex-check.mjs` (новый). Логи: строки `ok/ПРОВАЛ` + итоговый JSON `{total, failed, names}` как у mt-check.
- [x] Task 3: Сценарии `specs/features/dist/yandex.feature` (`# language: ru`, блок `Ссылка:` → доска #176, аудит 25.09) — шесть `@ui @dist @dist-yandex-*` сценариев с теми же кодами, что в Task 2; добавить область `dist` в `AREA_TAGS` (`tools/gherkin-parse.mjs:19`) и `AREA_RU` (`tools/qa-checklist.mjs:24`, «Сборки для площадок»); пересобрать `docs/qa-checklist.md` (`node tools/qa-checklist.mjs`); `node tools/gherkin-check.mjs` → 0 разрывов (depends on 2).
  Файлы: `specs/features/dist/yandex.feature` (новый), `tools/gherkin-parse.mjs`, `tools/qa-checklist.mjs`, `docs/qa-checklist.md` (генерат), `specs/README.md` (строка `dist/` в таблице каталогов). Логи: вывод gherkin-check.

### Phase 3: Документация и доска
- [x] Task 4: CLAUDE.md — в «Commands»/блок проверок строка `PW_DIR=/tmp/pw node tools/yandex-check.mjs   # билд Яндекс Игр + мок SDK`; в «Distribution builds» одно предложение: регэксп вырезания SW должен переживать любую форму строки регистрации, поломка 9–25.09 жила без гейта. `docs/PUBLISH.md`: перед загрузкой ZIP — прогнать `yandex-check`. Vikunja #176 → `done:true` полным payload (GET → правка → POST) с итогом в описании (depends on 3).
  Файлы: `CLAUDE.md`, `docs/PUBLISH.md`. Логи: нет.

## Проверка перед коммитом
- `./build-yandex.sh` → «ГОТОВО», `unzip -l build/yandex.zip` показывает один `index.html`
- `PW_DIR=/tmp/pw node tools/yandex-check.mjs` → `{"failed":0}`
- `node tools/gherkin-check.mjs` → 0 разрывов; `git diff --stat docs/qa-checklist.md` непустой
- `bash tools/mirror-script.sh --check` — index.html не менялся, зеркало в паритете
- Коммит один: `fix(yandex): билд площадки не вырезал регистрацию SW — гейт tools/yandex-check.mjs`
