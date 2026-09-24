# Implementation Plan: Устойчивость кадра и service worker (#177, #178)

Branch: main (create_branches: false)
Created: 2026-09-25
Доска: Vikunja «По зеркалам» #177 (P1) · #178 (P1) — из аудита production-ready 25.09

## Settings
- Testing: yes — два новых гейта: `tools/crash-check.mjs` (playwright-core, как `mt-check`) и `tools/sw-check.mjs` (только Node, без браузера); сценарии `@ui` привязаны кодами; существующие гейты не трогаются
- Logging: standard — в игре только `console.error` **один раз на место** (кадр ловит исключение каждые 8 мс, лог per-frame забьёт консоль и уронит fps); в гейтах строки `ok/ПРОВАЛ`
- Docs: yes — CLAUDE.md «Commands» + абзацы про защиту кадра и SW; `docs/FEEDBACK.md` — вид отчёта `[crash]`

## Roadmap Linkage
Milestone: "M2b · Перф и безопасность веб-билда"
Rationale: PWA/SW и устойчивость прод-страницы — часть M2b; аудит показал, что SW кэширует 502, а исключение в кадре живёт молча.

## Контекст
- `frame()` (`index.html:10467`): `render(dt)` и `updateHUD()` идут без try; `window.onerror`/`unhandledrejection` нет (grep: 0). Одно исключение в HUD повторяется каждый кадр — карточка замирает на прошлом тексте, мир рисуется (`render` выше), в проде никто не узнаёт. Уровень 18 в прошлом ронял так весь `updateHUD` (TypeError 120 раз в секунду).
- Приёмник отзывов уже умеет `kind:'bug'` (`server/feedback.py:39 KINDS`), `MIN_TEXT` 10, `ctx` свободной формы с `build` — крэш-отчёт ложится в него без правок сервера. Клиентский `fbCtx()` (`index.html:8587`) отдаёт уровень/коробку/камеру/fps/build/ua.
- `sw.js:24–31`: `fetch(e.request).then(r => put(r))` без `r.ok` — 502/504 при перезагрузке nginx становится офлайн-фолбэком до следующей успешной загрузки; `addAll(CORE)` — одна 404-иконка тихо валит install и новая версия не активируется. `deploy-pozerkalam.sh:118–127` переписывает sw.js **точными строками** (`assert a in s`) — любая правка sw.js обязана обновить этот список. nginx: `no-cache` стоит только на `/index.html` и `/play/index.html` (`deploy-pozerkalam.sh:170–171`), `/play/sw.js` — нет.
- Headless-инструменты (`cockpit-shots`, `level-audit`, `mt-check`, …) крутят настоящий `frame` под playwright — крэш-отчёт из них не должен улетать на прод: гейт по `navigator.webdriver`, с явным обходом для проверки.
- Мелочи из аудита в ту же тему: `doAct(a)` (`8730`) без проверки пустого `a`; `progAll()` (`9675`) не проверяет форму записи из localStorage — мусор в `trainer_progress` роняет `win()`.

## Commit Plan
- **Commit 1** (после задач 1–3): `fix(app): кадр переживает исключение — guard в frame, window.onerror, крэш-отчёт в приёмник отзывов`
- **Commit 2** (после задач 4–6): `fix(sw): не кэшировать ответы без ok, install без addAll, no-cache на /play/sw.js`

## Tasks

### Phase 1: Кадр (#177)
- [x] Task 1: Защита кадра и крэш-отчёт в `index.html` (секция «цикл» и «обратная связь»).
  - `frameGuard(where, fn)`: try/catch; при первом исключении на `where` — `console.error('[crash]', where, e)`, `crashReport(where, e)`, `toast('Что-то сломалось в кадре — перезапусти уровень (R)', 6)`; повторы того же `where` считаются в `crashN[where]` молча. В `frame()` обернуть три блока: симуляцию (`if(!paused && !game.done){…}` + детекторы/фазы), `render(dt)`, `updateHUD()` — чтобы падение HUD не останавливало мир и наоборот. `requestAnimationFrame(frame)` остаётся первой строкой.
  - `window.addEventListener('error', …)` и `'unhandledrejection'` → `crashReport('window', err)`.
  - `crashReport(where, e)` рядом с `fbCtx()`: один раз за сессию (`crashSent`), `fetch(FB_URL, {kind:'bug', text:'[crash] '+where+': '+msg+'\n'+stack(≤6 строк), contact:'', hp:'', ctx:fbCtx()})`, без снимка, без кулдауна `trainer_fb_t`; молчит при `navigator.webdriver` (headless-гейты гоняют настоящий frame) и `location.protocol==='file:'`, если не выставлен `window.CRASH_REPORT_FORCE`. Ошибки отправки глотаются (`catch(()=>{})`).
  - `doAct(a)`: `if(!a) return;` первой строкой. `progAll()`: если разобранное — не объект или массив → `{}`; записи не-объекты удалять; `n/clean` приводить к числу.
  Файлы: `index.html` (10467–10510, 8577–8600, 8730, 9675). Логи: `console.error` один раз на место; ничего per-frame.
- [x] Task 2: `tools/crash-check.mjs` (шапка и запуск как `mt-check`; `page.route(FB_URL)` перехватывает и считает отчёты, отдаёт `{ok:true}`), проверки с кодами (depends on 1):
  - `@app-crash-hud-survives` — `window.CRASH_REPORT_FORCE=true`, `goalMiss=()=>{throw new Error('boom')}`, 1 с: `game.t` растёт, `facesFrame>0`, консоль: ровно один `console.error` с `[crash]`, тост виден в `#coach`;
  - `@app-crash-report-once` — перехвачен ровно один POST на `FB_URL` с `kind:'bug'`, `text` начинается с `[crash] hud`, `ctx.build` и `ctx.level` заданы; второй throw в другом месте (`render`) отчёт не шлёт;
  - `@app-crash-window-error` — `crashSent=false`, `setTimeout(()=>{throw new Error('async')})` → один отчёт с `where='window'`;
  - `@app-crash-headless-silent` — без `CRASH_REPORT_FORCE` (`navigator.webdriver`) отчёт не уходит, кадр всё равно жив;
  - `@app-progress-garbage` — `localStorage.trainer_progress='[1,2]'` и `'{"x":5,"y":{"n":"3"}}'` → `progAll()` объект без `x`, `progAdd('t',10,0)` не бросает, `win()` после `game.done=false` открывает оверлей;
  - `@app-doact-empty` — `doAct()` и `doAct('')` не бросают.
  Файлы: `tools/crash-check.mjs` (новый). Логи: `ok/ПРОВАЛ` + итоговый JSON.
- [x] Task 3: Сценарии `specs/features/app/crash.feature` (`# language: ru`, `Ссылка:` → доска #177, аудит 25.09, уровень 18 TypeError в истории), шесть `@ui @app @app-*`; область `app` в `AREA_TAGS` (`tools/gherkin-parse.mjs:19`) и `AREA_RU` (`tools/qa-checklist.mjs:24`, «Устойчивость приложения»); строка `app/` в таблице `specs/README.md`; `node tools/qa-checklist.mjs`; `node tools/gherkin-check.mjs` → 0 разрывов (depends on 2).
  Файлы: `specs/features/app/crash.feature` (новый), `tools/gherkin-parse.mjs`, `tools/qa-checklist.mjs`, `docs/qa-checklist.md` (генерат), `specs/README.md`. Логи: вывод gherkin-check.

### Phase 2: Service worker (#178)
- [x] Task 4: `sw.js` + список замен в `deploy-pozerkalam.sh`.
  - Вынести `const PAGE = '/';` и `const CORE = [PAGE, '/manifest.webmanifest', …]`; в fetch-ветке страницы: `r.ok ? put(PAGE, clone) и вернуть r : caches.match(PAGE).then(hit => hit || r)` (502 при перезагрузке nginx → игроку кэшированная игра, а не страница ошибки; если кэша нет — честный ответ сервера); в ветке ресурсов `put` только при `r.ok`; `install`: `Promise.allSettled(CORE.map(u => c.add(u)))` вместо `addAll` — одна битая иконка не блокирует новую версию.
  - `deploy-pozerkalam.sh:119–125`: заменить список пар на новый: `const PAGE = '/';` → `'/play/'`, CORE-строка, `url.pathname === PAGE || url.pathname === PAGE + 'index.html'` не требует замены, если написать так; оставить `assert a in s`.
  Файлы: `sw.js`, `deploy-pozerkalam.sh`. Логи: нет (SW без console).
- [x] Task 5: `tools/sw-check.mjs` — без браузера: `vm.runInNewContext(sw.js, sandbox)` с фейковыми `self.addEventListener`, `caches` (Map), `fetch` (по таблице ответов, `Response` из Node), `location.origin`; вызвать `install`/`activate`/`fetch` через захваченные обработчики с фейковым `event {request, respondWith, waitUntil}`. Дважды: исходный `sw.js` и вариант `/play/`, полученный **теми же парами замен, что в `deploy-pozerkalam.sh`** (прочитать скрипт, вытащить пары регэкспом, `assert` каждой `a` в исходнике — гейт падает, если sw.js и деплой разъехались). Проверки (depends on 4):
  - `@dist-sw-page-not-ok-not-cached` — страница 502 не попадает в кэш, отдаётся кэшированная копия, если есть;
  - `@dist-sw-page-ok-cached` — страница 200 кладётся под `PAGE`;
  - `@dist-sw-install-tolerates-404` — install с одной 404-иконкой завершается, остальные CORE в кэше;
  - `@dist-sw-asset-not-ok-not-cached` — ресурс 404 не кэшируется;
  - `@dist-sw-deploy-anchors` — все строки-якоря из `deploy-pozerkalam.sh` найдены в `sw.js`.
  Файлы: `tools/sw-check.mjs` (новый). Логи: `ok/ПРОВАЛ` + JSON.
- [x] Task 6: nginx + сценарии + доки (depends on 5).
  - `deploy-pozerkalam.sh`: рядом с блоком `/play/index.html` (170–171) такой же guarded `sed` для `location = /play/sw.js { add_header Cache-Control "no-cache"; include snippets/pozerkalam-headers.conf; }`; то же в блоке зеркала (≈337). Проверяется на следующем деплое: `curl -sI --resolve … https://pozerkalam.space/play/sw.js | grep -i cache-control` → `no-cache`.
  - `specs/features/dist/sw.feature` — пять `@ui @dist @dist-sw-*`; `node tools/qa-checklist.mjs`; `gherkin-check` → 0 разрывов.
  - CLAUDE.md: строки запуска `crash-check`/`sw-check` в блоке проверок; абзац в «UI»/«Deployment» про guard кадра, крэш-отчёт (`[crash]`, один на сессию, молчит под webdriver) и правила SW (`r.ok`, allSettled, якоря деплоя под гейтом). `docs/FEEDBACK.md`: раздел «Крэш-отчёты» (как выглядит в Telegram, чем отличается от ручного).
  - Доска: #177 и #178 → `done:true` полным payload с итогом.
  Файлы: `deploy-pozerkalam.sh`, `specs/features/dist/sw.feature` (новый), `docs/qa-checklist.md`, `CLAUDE.md`, `docs/FEEDBACK.md`. Логи: нет.

## Проверка перед коммитами
- `PW_DIR=/tmp/pw node tools/crash-check.mjs` → `{"failed":0}`; `node tools/sw-check.mjs` → `{"failed":0}`
- `node tools/gherkin-check.mjs` → 0 разрывов; `PW_DIR=/tmp/pw node tools/gherkin-run.mjs` → 24/0
- `PW_DIR=/tmp/pw node tools/mt-check.mjs` и `node tools/level-audit.mjs` — frame тронут, регрессия обязательна; `cockpit-shots` — `frameCost` не вырос (guard — один try на блок, не per-face)
- `bash tools/mirror-script.sh --check` после правки `index.html`; `bash -n deploy-pozerkalam.sh`
- Оба коммита без упоминаний ИИ; после push — `git log --format='%B' origin/main..HEAD | grep -in 'claude\|anthropic'` пусто
