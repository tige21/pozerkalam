# Implementation Plan: Вырезать механику (МКПП) из игры

Branch: main (create_branches: false)
Created: 2026-09-28
Доска: Vikunja «По зеркалам» — на момент планирования 503, задачу завести при первой доступности (P1, label 2).
Запрос владельца: «уберем режим механики из игры, потому что сейчас ей пользоваться невозможно». Выбран вариант «вырезать целиком», не «спрятать»; вернуть — только из git.

## Settings
- Testing: yes — гейты проекта: демо-регрессия, `gherkin-check`, `gherkin-run`, `unit-check`, `crash-check`, `yandex-check`, `level-audit`, раскладка тач-полосы (переезжает из `mt-check` в `touch-check`)
- Logging: minimal — в игре нет лог-инфраструктуры; новых логов не добавляется, `window.mtDebug` удаляется вместе с режимом
- Docs: yes — CLAUDE.md (раздел МКПП, ключи localStorage, тач-полоса, список команд), лендинг, карточка стора

## Roadmap Linkage
Milestone: "none"
Rationale: запрос владельца по игровому содержанию, вне майлстоунов.

## Контекст
- В `index.html` ≈130 строк МКПП: блок `/* ---------- МКПП ---------- */` (`6068–6260`: `MT`, `mtOn`, `setGearbox`, `gearboxBtnHTML`, `HINT_MT`, `mtDebug`, `mtWarn`, `MT_ORDER/NAMES`, `mtSelect`, `mtShift`, `mtToggleRev`, `mtStall`, `mtStart`, `mtDrive`, ветка `mt` в `stepCar`), поля машины `mgear/clu/rpm/stalled` (`5550`, `5809`), `game.stalls`, щиток `dialCanvas(mode,…)` и рычаг (`1921–2085`), HUD (`8415–8488`, `#gearLbl`, `#rpmCell`), карточка (`8548–8574`), гайд `TUT_MT`/`tutSteps`/`tutKey` (`8611–8639`), клавиши (`9148–9171`: `,` `.` Enter P ShiftLeft Y `` ` ``, `swallow`), `doAct('gearbox…')` (`8863`), справка и старт (`8907`, `8973`, `8988`, `8995`, `9012`, `9031`), показ/идеальная линия (`9593–9766`), загрузка опции (`10266`), тач `#tstart`/`#tclutch`/`#tgear data-mg` (`539–541`, `10301–10322`, `10546`), ≡-меню (`10359–10366`), тур (`10450`, `10475`), звук (`7212`, `10647`), экзамен `stall` (`6374`, `6400`), CSS (`132–137`, `246–301`, `409–433`, `483`), meta description (`10`, `14`).
- Вне игры: `tools/mt-check.mjs` (40 проверок; неМКПП — только «графика: максимум», раскладка тач-полосы на 5 телефонах и чистая консоль), `specs/features/mt/sceplenie.feature` (9 `@ui @mt-*`), `docs/qa-checklist.md` (генерат), `tools/yandex-check.mjs` + `specs/features/dist/yandex.feature` (облачное слияние на примере `trainer_gearbox`), `tools/crash-check.mjs`/`yandex-check.mjs` (`trainer_drive_mt`), `tools/level-audit.mjs` (сохраняет `opt.gearbox`), `learner.js` (ветки `mtOn()`), `server/feedback.py` (строка «АКПП/МКПП» в заголовке отчёта), лендинг `index.astro` (карточка «Автомат и механика», лид), `landing/public/og.jpg` + `tools/og-render.mjs` («АКПП и МКПП»), `docs/store/yandex.md`.
- Миграция: у игроков с `trainer_gearbox='MT'` ключ просто перестаёт читаться — автомат по построению. Ключи `trainer_gearbox`/`trainer_drive_mt` не чистим: облачный сейв Яндекса вернул бы их при слиянии, а читать их некому.
- Экзамен: штраф `stall` возможен только на МКПП — уходит вместе с режимом; `handbrake-drive` и откат остаются (ручник есть и на автомате). Ручник на АКПП не трогаем.
- Метрика: цели `mt-at`/`mt-mt` (`track` в `setGearbox`) исчезают сами.

## Tasks

### Phase 1: Игра
- [x] Task 1: `index.html` — удалить логику МКПП.
  - Блок МКПП целиком; в `stepCar` оставить только ветку АКПП; поля `mgear/clu/rpm/stalled` из `car` и `restart`, `game.stalls`, `input.clutch`.
  - Клавиши: `,`/`.`/Enter/P без веток `mtOn()`; `ShiftLeft` → только `lookBack`; убрать `KeyY`, `Backquote` и `'Backquote'` из `swallow`; keyup `ShiftLeft` без `clutch`.
  - Показ и `computeIdealPath`: убрать сохранение/подмену `opt.gearbox` (`demoBox`, `save.box`).
  - Экзамен: `PENALTIES.stall`, `EXAM_TRAIN.stall`. Звук: `engGain` без `stalled`, `engineSound(Math.abs(car.vel))`.
  - `opt.gearbox` и чтение `trainer_gearbox` при загрузке; `fbCtx` без `gearbox`.
  - Проверка: `grep -nE "mtOn|mgear|\.clu\b|stalled|gearbox|MT_ORDER|clutch" index.html` пусто (кроме слова «ручник» и прочих АКПП-строк).
- [x] Task 2: `index.html` — удалить МКПП из интерфейса (depends on 1).
  - HUD: `#rpmCell`; `#gearLbl` — вернуть прежнюю подпись «селектор · Enter = D ⇄ R» (до c3cf894) без `title`, обработчик клика и курсор убрать; `#gearVal`/`#tgear` только `P R N D` (ветки `data-mg`).
  - Тач: `#tstart`, `#tclutch`, классы `needclutch`/`needstart`/`.stalled` и их CSS во всех медиа-блоках; `needbrake` оставить.
  - Щиток: `dialCanvas(sel)` без режима, рычаг по `car.sel`.
  - Карточка: ветки `mtOn()` в `updateHUD`; гайд — только `TUT_AT`, ключ `trainer_drive` (убрать `tutSteps`/`tutKey`, звать массив напрямую).
  - Тексты: `gearboxBtnHTML` (4 места; CSS `.gbrow/.gbseg` остаётся — на нём форма отзыва), раздел «Коробка передач» ≡-меню, строки справки про `` ` `` и механику, `HINT_ALL` без `` ` ``, тур без `#tclutch`, пояснение ячейки передач без «подпись меняет коробку на механику», `doAct('gearbox…')`, meta description и og:description без «АКПП и МКПП».
  - Новые строки для игрока — через `ru-copy-deslop` (сканер) и голос из `.ai-factory/references/pozerkalam-voice.md`.

### Phase 2: Гейты и инструменты
- [x] Task 3: `tools/mt-check.mjs` → `tools/touch-check.mjs` (depends on 2).
  - Оставить: «графика: максимум», раскладку тач-полосы на 5 телефонах (только АКПП, без `setGearbox`, без `#tclutch` в `parts`, без `trainer_drive_mt`), «в консоли нет ошибок». Шапку-комментарий переписать под новое имя.
  - `git rm tools/mt-check.mjs`, удалить `specs/features/mt/`, пример `@mt-clutch-gear1` в `specs/README.md` и `tools/gherkin-check.mjs` заменить на живой код (например `@traffic-yield-tca`).
- [x] Task 4: прочие инструменты (depends on 1).
  - `tools/yandex-check.mjs` + `specs/features/dist/yandex.feature`: пример облачного слияния на `trainer_traffic` вместо `trainer_gearbox`; убрать `trainer_drive_mt` из списков ключей там и в `tools/crash-check.mjs`.
  - `tools/level-audit.mjs`: без `box`/`opt.gearbox`.
  - `learner.js`: удалить ветки `mtOn()`.
  - `server/feedback.py`: заголовок отчёта без АКПП/МКПП.
  - `node tools/qa-checklist.mjs` — пересобрать чек-лист.
- [x] Task 5: прогон гейтов (depends on 3, 4).
  - Демо-регрессия (0 таймаутов по `DEMOS`), `node tools/gherkin-check.mjs`, `PW_DIR=/tmp/pw node tools/gherkin-run.mjs`, `unit-check`, `touch-check`, `crash-check`, `yandex-check` (`REBUILD=1`), `level-audit`, `tools/exam-check.js` (`detectorCheck`/`routeCheck`/`navCheck`), `mutation.mjs` (храповик не падает), `tools/mirror-script.sh --check`.
  - Скриншот тач-полосы на 667×375 и 568×320: ряд без дыр на месте сцепления.

### Phase 3: Лендинг и документы
- [x] Task 6: лендинг и стор (depends on 2).
  - `landing/src/pages/index.astro`: карточку «Автомат и механика» убрать (если сетка ломается на 8 карточках — заменить карточкой про городской поток), лид «…, АКПП и МКПП» переписать; сканер `ru-copy-deslop` по `landing/src`.
  - `tools/og-render.mjs` без «АКПП и МКПП», перерендер `landing/public/og.jpg`.
  - `docs/store/yandex.md`: абзац про коробку; `docs/monetization-m7.md`: убрать МКПП из тарифной таблицы.
- [x] Task 7: CLAUDE.md и доска (depends on 5, 6).
  - Удалить абзац **МКПП**; из UI-раздела — `trainer_gearbox`/`trainer_drive_mt`, `` ` ``, упоминания `#tclutch`/`#tstart`/`needclutch`; тач-полоса — 13 целей, гейт `touch-check`; блок команд — `touch-check` вместо `mt-check`; строка про `learner.js`, если упоминает МКПП. Одной фразой записать решение: МКПП вырезана 28.09.2026 по запросу владельца, вернуть — из git (коммит этого плана).
  - Доска: завести задачу, закрыть `done:true` полным payload. — НЕ сделано: Vikunja 28.09 отвечала 503/таймаут.

## Commit Plan
- Коммит 1 (после Task 1–2): `feat!(gearbox): убрать механику — в игре остаётся только автомат`
- Коммит 2 (после Task 3–5): `test: mt-check → touch-check, сценарии @mt-* удалены`
- Коммит 3 (после Task 6–7): `docs: лендинг, стор и CLAUDE.md без МКПП`
- Деплой — отдельным решением владельца после коммитов (`./deploy-pozerkalam.sh`).
