# Implementation Plan: Главное меню, пауза и машина на подиуме

Branch: release-demand (create_branches: false; ветка стоит на origin/main)
Created: 2026-10-05
Доска: Vikunja «По зеркалам» #290 (P2) · Спек: `docs/superpowers/specs/2026-10-05-main-menu-design.md`

## Settings
- Testing: yes — новый гейт `tools/menu-check.mjs` (`@app-menu-*`, у каждой проверки `FAULT=`), правка
  `touch-check`/`account-check`/`mirror-check`, сценарии `specs/features/app/menu.feature`, регрессия гейтов
- Logging: standard — `console.info('[menu] …')` на смену экрана, «Играть» (куда и почему), применение настройки;
  `console.warn('[menu] …')` один раз на отказ витрины (нет модели → лофт, исключение в сцене). Ничего в кадр.
- Docs: yes — CLAUDE.md (UI, клавиши, `localStorage`, полоса тач-кнопок, новый гейт), `docs/ANALYTICS.md`
  (`via=play`), лендинг «остальное — в меню ≡», чек-лист QA пересобрать

## Roadmap Linkage
Milestone: "none"
Rationale: правка UX по запросу владельца, вне майлстоунов M3/M7/M8.

## Research Context (codegraph + grep, 05.10.2026)
- Оверлей: `showOv(html)` `index.html:11699` (ставит `paused`, `body.ov`, вешает `doAct` на `button[data-act]`
  и `openLevel` на `.lvcard`), `hideOv` `:11718`, `doAct` `:11720`. CSS оверлея `:144–236`, кнопки `:195–205`.
  Замыкающие блоки CSS: `max-width:600px` `:501`, `hover` `:506`, `reduced-motion` `:521` — новые правила выше них.
- Экраны: `startHTML` `:11843` (ветка `MOB`), `helpHTML` `:11879`, `ctrlHTML` `:11772`, `touchCtrlHTML` `:11834`,
  `levelPickHTML` `:11801`, `showLevelPick` `:11704`, `toggleHelp` `:11956`, `examAbortHTML` `:8429`,
  `examBriefHTML` `:8407`, `showTask` `:13212`. ≡-меню: `buildMenu` `:13224`, `closeMenu` `:13211`,
  разметка `#tmenubtn` `:585`, `#tmenu` `:591`, CSS `#tmenubtn` `:326`, `#tmenu` `:375–383`, сжатия `:444,464,502`,
  слушатели `:13427–13430`. Плашка уровня `#topright/#lvlIdx` `:539`, пишется в `loadLevel` `:7780`.
- Вызовы `showOv(startHTML())`: `:11280,11285,11313` (вход), `:11397` (`acctRerender` ищет `[data-act="start"]`),
  `:11630` (`fbClose`, `fbBack==='start'`), `:11731`, `:11746`, `:11748`, `:12916`, `:13281`, `:13584` (старт).
- Клавиши: `pressKey` `:11995`, `KeyH/Escape` `:12035` (на экзамене — `examAbortHTML`), `KeyL` `:12019`,
  `KeyR` `:12005`. `doAct('start')` — счётчик запусков `trainer_runs`, `anLevelStart('start')`, цепочка
  `showTouchHelp` → `showOnboard` → `maybeStartTut` `:11756–11768`.
- `openLevel` `:11709` — единственный пользовательский вход в уровень (пейволл, предложение, `anLevelStart(via)`).
- Рендер: `render` `:10504` рисует сцену каждый кадр и на паузе; ветка редактора — образец раннего выхода.
  Машина: `emitCarMesh(u,v,th,col,st,lights,look)` `:3013` → `emitCarModel` `:2905`; своя — цвет `[206,214,226]`,
  `{own:true}`. Зависимости: `camInsideCabin` `:2016` (по позе игрока и `cam.pos`), `lodSync`/`lodD2` `:9231`,
  `RAMP_ON`/`carRampUse`/`carLift`, `carShadow` `:9340` (тень на y≈0,011).
- Прогресс: `progAll` `:12685`, `progPassed` `:12706`, `examRuns` `:12775`, `examReadiness` `:12785`,
  `readinessHTML` `:12795`. Вход: `acctBtnsHTML`/`acctLineHTML`/`acctStartHTML`/`acctPickHTML` `:11358–11379`,
  `acctRerender` `:11394`.
- Настройки сейчас — пункты `buildMenu`: `cycleHud`, `toggleFull`, `pressKey` (F, −, =, O, B, G, T, Z, U, M),
  `applyMirPreset(0)`, `adsRewarded` → `opt.guides`, `setExamMode`, `cycleMirScale`, `opt.gfx`, `cycleTraffic`,
  вход/выход/удаление аккаунта, `showLevelPick`, `openEditor`. Таблицы значений: `REFS_NAMES` `:7617`,
  `MIR_PRESETS` `:9200`, `MIR_SCALES` `:10361` (5 шагов), `TRAF_NAMES/TRAF_ORDER` `:4844–4849`.
- Уровни по жанрам: 1–13 двор, 14–19 `drill:true`, 20–22 площадка (без флага — по имени/индексу), 23–31 `strict`,
  32 `examRoute`, `custom:true` — свои.
- Зависимости вне `index.html`:
  - `tools/account-check.mjs`: `:191` `buildMenu()`+`#tmGrid` «Аккаунт» (`@acct-off-by-default`); `:198–232`
    кнопки входа на стартовом экране и `[data-act="start"]` (`@acct-buttons-order`, `-brand`, `@acct-start-once`);
    `:355` `showOv(startHTML())` → `auth-logout`; `:122,143,405,447,470` `showLevelPick()` + `.lvcard[data-lvl=N]`;
    `:411` пейволл ведёт назад `[data-act="pick"]`.
  - `tools/touch-check.mjs:55–88`: цели полосы `.tsteer .tdrive #tgear #tmenubtn #trestart #tview #coach`
    и стрелки — пересечение > 40 px² и ширина < 36 px на 5 телефонах.
  - `tools/mirror-check.mjs:105–109`: строка «Зеркала крупнее: N%» в `#tmGrid`.
  - `tools/crash-check.mjs:101`: после `win()` ищет `[data-act="next"]` — не меняется.
  - `tools/landing-clips.mjs:78`, `landing-shots.mjs`: прячут HUD списком селекторов — добавить `#pauseBtn`.
  - `landing/src/pages/index.astro:41`: «Экранные кнопки вместо клавиш, остальное — в меню ≡».
  - ~25 инструментов зовут `doAct('start')` — контракт сохраняется.

## Commit Plan
- **Commit 1** (после задач 1–5): `feat(menu): главное меню с разделами вместо стартовой карточки`
- **Commit 2** (после задач 6–8): `feat(menu): настройки вкладками и пауза по Esc и ⏸ вместо ≡`
- **Commit 3** (после задачи 9): `feat(menu): машина игрока на подиуме в главном меню`
- **Commit 4** (после задач 10–13): `test(menu): гейт menu-check, сценарии, доки`

Пушить только после задачи 13 (все гейты зелёные). Сообщения коммитов без упоминаний ИИ.

## Tasks

### Phase 1: Каркас и главный экран
- [x] Task 1: Состояние меню и раскладки оверлея (`index.html`, раздел «UI»).
  `menu={scr,tab,from}` и `menuGo(scr,tab)`, `menuBack()`, `menuClose()`; `showOv(html, lay)` — второй параметр
  `'card'` по умолчанию (все нынешние вызовы не меняются), ставит класс `lay-main|lay-panel|lay-card` на `#overlay`;
  `body.menu` — открыт главный экран или раздел (не пауза), снимается в `hideOv` и в `showOv(…,'card')`.
  CSS (выше замыкающих блоков): `lay-main` — без фона и рамки карточки, фон оверлея прозрачный (витрина видна),
  `pointer-events` только у кнопок и плашек; `lay-panel` — панель слева `min(560px, 58vw)` во всю высоту
  со своим скроллом, шапка «← Назад · заголовок · вкладки»; `body.menu` прячет HUD (`#topleft #topright #coach
  #bar #hint .sidebtn #touchui #blinkers #handbrake`). Вкладки — `role="tablist"`, кнопки `role="tab"`
  `aria-selected`; фокус на главной кнопке экрана после показа.
  Лог: `console.info('[menu] экран', scr, tab||'', 'из', from)` в `menuGo`.
- [x] Task 2: Главный экран и «Играть» (depends on 1).
  `startHTML()` возвращает главный экран (имя сохраняется — его зовут вход, отзыв, `acctRerender`); все
  `showOv(startHTML())` → `menuGo('main')`. Состав: логотип (нынешний SVG) и «По зеркалам», чип профиля
  (`menu:profile`; имя/провайдер или «Гость · войти», без `AUTH_ON` — «Гость»), ⚙ (`menu:settings`,
  `aria-label`), колонка: ИГРАТЬ (подпись — «N · имя уровня»), Уровни, Экзамен (готовность %), Профиль,
  Настройки, Помощь; внизу «✉ написать нам» (`feedback:start`). Подпись «потяни, чтобы повернуть» у витрины.
  `playTarget()`: `trainer_last` (имя) → не пройден → он; иначе первый непройденный встроенный после него;
  всё пройдено → следующий; нет записи → 0. `trainer_last` пишется в `openLevel` и в `doAct('start')`.
  Вынести из `doAct('start')` в `beginRun()` счётчик `trainer_runs` и цепочку первого запуска; `doAct('play')`:
  цель == `game.li` → `doAct('start')`, иначе `openLevel(i,'play')` + `beginRun()` (без второго `anLevelStart`).
  `acctRerender` узнаёт экран по `menu.scr`, а не по `[data-act="start"]`.
  Лог: `console.info('[menu] играть →', i, LEVELS[i].name, причина)`.
- [x] Task 3: Раздел «Уровни» (depends on 1). `levelPickHTML(tab)` → панель с вкладками Двор · Габариты ·
  Площадка · Город и экзамен · Свои ★ (классификатор `levelTab(i)`: `custom`→own, `drill`→drill,
  `strict||examRoute`→city, индексы 19–21→pad, иначе yard); по умолчанию вкладка текущего уровня; пояснения
  жанров — одна строка под вкладками; карточки `.lvcard` и `data-lvl` без изменений (на них гейты);
  во вкладке «Свои» — кнопка «Редактор площадок». `showLevelPick()` → `menuGo('levels')`, «Назад» — откуда
  пришли (главный экран, пауза, итоги уровня — итоги пересобираются через `doAct('resume')`). Вход из
  выбора уровня убирается (он в Профиле). Лог — через `menuGo`.
- [x] Task 4: Разделы «Экзамен» и «Профиль» (depends on 1).
  Экзамен: готовность и три слабых уровня кнопками `train:N`, «настоящих маршрутов x из 3» (`examRuns`),
  переключатель режима (действие `exammode`, перерисовка раздела на месте), «Начать экзамен» →
  `openLevel(examIdx,'pick')` → бриф. Профиль: имя/«Гость», блок входа (`acctBtnsHTML`, если `AUTH_ON`),
  плитки: пройдено N из 31, чистых заездов, готовность %, лучшая точность см (min `bestErr` по дриллам),
  маршрутов x/3; «Выйти», «Удалить аккаунт» (существующие действия; «Назад» из удаления — в Профиль);
  `pay-restore`, если `PAY_ON`. Тексты — по voice-карточке.
- [x] Task 5: Раздел «Помощь» (depends on 1). Вкладки: Управление (`ctrlHTML` на ПК / `touchCtrlHTML` на тач,
  пункт про ≡ → ⏸), Как устроено (абзацы линий траекторий и физики из нынешнего `helpHTML`), «Показать
  обучение снова» (сбрасывает `trainer_hint`, `trainer_seen`, `trainer_drive`; из паузы — сразу закрыть меню и
  запустить цепочку, с главного — при следующем «Играть»; лог `[menu] обучение сброшено`). `helpHTML()` →
  раздел «Помощь»; действие `help` и клавиша H ведут туда же. Кнопка «экранное управление» уходит в Настройки.
<!-- Commit checkpoint: tasks 1-5 -->

### Phase 2: Настройки и пауза
- [x] Task 6: Раздел «Настройки» (depends on 1). Таблица `SETTINGS`: `{id, tab, label, kind:'switch'|'seg'|'step',
  values, get(), set(v)}`; `set` зовёт существующие пути (`pressKey('KeyO'|'KeyB'|'KeyG'|'KeyT'|'KeyZ'|'KeyM')`,
  `cycleHud`, `toggleFull`, `setTouch`, `applyMirPreset`, `cycleMirScale`, `cycleTraffic`, переключение
  `opt.gfx` с `qApply`) — сохранение в `localStorage` не дублируется. Вкладки: Экран (графика, панели HUD,
  во весь экран — если есть API, экранное управление), Подсказки (ориентиры, габариты 3 положения, линии,
  след), Зеркала (показ, размер шагом `MIR_SCALES`, положение `MIR_PRESETS`, сброс), Звук и поток (звук,
  поток шагом `TRAF_ORDER`, на экзамене поток не трогается — подпись «на экзамене всегда плотный»).
  `doAct('set:<id>:<v>')` — применить и перерисовать раздел, сохранив скролл панели и фокус.
  Лог: `console.info('[menu] настройка', id, '→', значение)`.
- [x] Task 7: Пауза и клавиши (depends on 1, 6). `pauseHTML()` — карточка (`lay-card`): заголовок «Пауза ·
  N. имя уровня»; Продолжить, Заново, Как выполнять (`task`), ▶ Демонстрация (если `DEMOS[game.li]`),
  Подсказка-траектория через `adsRewarded` (только при `window.ADS` — шов рекламы ЯИ из ≡ сохраняется),
  Настройки, Уровни, Главное меню (`mainmenu`: `restart()` не нужен — уровень остаётся загруженным,
  `stopDemo()`, `menuGo('main')`). Экзамен: Продолжить, Маршрут и команды, Настройки, Прервать экзамен
  (→ `examAbortHTML` подтверждением). `escAct()`: игра → пауза; пауза → продолжить; раздел → `menuBack()`;
  главный → ничего; итоги/провал (`game.done`) и бриф экзамена — как сейчас. H → Помощь (из игры через
  паузу), L → Уровни. В `body.menu` игровые клавиши (кроме Escape, H, L) не действуют. `toggleHelp`/`helpOpen`
  удаляются, `KeyR` на паузе закрывает её.
- [x] Task 8: Кнопка ⏸ и полоса тач-кнопок (depends on 7). `<button id="pauseBtn" aria-label="Пауза и меню"
  title="Меню (Esc)">` в `#topright` на ПК и телефоне; на тач `#lvlIdx` скрыт (номер — в заголовке паузы);
  цель ≥ 44 px (≥ 38 на `max-height:420px`), скрыта при `body.ov` и `body.edit`; при `hud-off` остаётся —
  со скрытыми панелями выход в меню обязан быть. Удалить `#tmenubtn`, `#tmenu`, `buildMenu`, `closeMenu`, их CSS и
  слушатели; `#trestart` в полосе пересчитать от половины ряда `#tgear` без ≡ (симметрию не ломать), на
  `max-width:600px` ⟲ остаётся в правом верхнем углу под ⏸ без пересечения. `showTouchHelp`: метка на
  `#pauseBtn` «Пауза и меню: настройки, уровни, задание». `CAMNAME`, «Камеру за машину» — двойной тап
  по экрану уже есть, пункт не переносится.
<!-- Commit checkpoint: tasks 6-8 -->

### Phase 3: Витрина
- [x] Task 9: Машина на подиуме (depends on 1). Состояние `showroom={yaw, vel, holdT, dragged}`; в `render`
  первой строкой: `body.menu` → `drawShowroom(dt)` и выход. Сцена: фон — радиальный градиент на 2D-канве;
  `setVP` со сдвигом центра вправо (правее колонки, с панелью — правее панели, на узком экране — по центру
  свободной части); на время прохода сохранить и выключить `RAMP_ON`, `carRampUse`, `cabinLit`, `camPivot`
  = (0,0), `lodSync()`; камера по орбите R≈6,2 м, высота ≈2,3 м, цель (0,0,6,0). Проход 1: пол — кольца
  на y −0,30 с яркостью, падающей от центра; подиум — 36-гранный цилиндр R 2,9 от −0,30 до 0, верх —
  многоугольник, кромка `MO.emit`; `flushFaces`; тень `carShadow(0,0,yaw)`. Проход 2:
  `emitCarMesh(0,0,yaw,[206,214,226],0,{own:true},{body:'sedan',style:'a'})`; `flushFaces`. Вращение:
  12°/с, тяга по свободному месту оверлея (`pointerdown` не на кнопке/панели) — `vel` по смещению, инерция
  `exp(−3·dt)`, автоповорот ждёт 3 с после тяги; `prefers-reduced-motion` — без автоповорота; подпись
  «потяни» гаснет после первой тяги. Отказы: `carModel.state!=='ready'` → лофт + один
  `console.warn('[menu] витрина без модели кузова — лофт')`; исключение — `crashHit('render')` как сейчас.
  Бюджет: ≤ 3 мс JS на кадр витрины (замер в задаче 10).
<!-- Commit checkpoint: task 9 -->

### Phase 4: Проверки и доки
- [x] Task 10: Гейт `tools/menu-check.mjs` + `specs/features/app/menu.feature` (depends on 2–9). Проверки
  (код требования в имени, `FAULT=` для каждой): `@app-menu-sections` (каждый раздел открывается с главного,
  «Назад» и Esc возвращают откуда пришли, из паузы — в паузу); `@app-menu-esc-pause` (Esc в уровне → пауза,
  Esc → игра, на экзамене в паузе есть «Прервать», итоги по Esc не закрываются); `@app-menu-pause-touch`
  (⏸ виден и открывает паузу на 5 телефонах, не лежит на зеркалах, карточке и ⟲); `@app-menu-fit` (ни одна
  кнопка меню, паузы и вкладок не обрезана, не перекрыта и не меньше 36 px на 568×320…932×430, 1280×720,
  1440×900); `@app-menu-settings-persist` (каждая строка `SETTINGS` меняет `opt` и переживает перезагрузку);
  `@app-menu-play-target` (правило `trainer_last` на четырёх случаях); `@app-menu-showroom` (пиксели в
  центре подиума ≠ фону, тяга меняет кадр, без модели — лофт и одно предупреждение, JS кадра ≤ 3 мс при
  CPU×4); `@app-menu-no-hud` (в меню HUD скрыт, уровень не считается). Запуск ≈ 20–40 с.
  Лог гейта — строка на проверку и итоговый JSON, код 1 на провал, как у соседей.
- [x] Task 11: Правка старых инструментов (depends on 2–8). `account-check`: `@acct-off-by-default` — нет
  блока входа ни в Профиле, ни на главном; `@acct-buttons-*` и `@acct-start-once` — кнопки входа в разделе
  Профиль (открыть `menuGo('profile')`), «на главном» — чип профиля; `:355` — `menuGo('profile')`; пейволл
  «Назад» → раздел «Уровни». `touch-check`: убрать `#tmenubtn` из целей, добавить `#pauseBtn`. `mirror-check`:
  размер зеркал — строка `SETTINGS` вместо `#tmGrid`. `landing-clips`/`landing-shots`: прятать `#pauseBtn`.
  Сценарии `@acct-*`, `@app-hud-mobile-*` — тексты под новые места. `gherkin-check`, `qa-checklist` пересобрать.
- [x] Task 12: Тексты (depends on 2–8). Все новые строки — голосом `pozerkalam-voice.md` (короткий императив,
  второе лицо, без «это не X, это Y»); `python3 ~/.claude/skills/ru-copy-deslop/scripts/deslop-scan.py` по
  выдержке новых строк; лендинг `index.astro:41` «остальное — в меню ≡» → «настройки и уровни — по кнопке ⏸».
- [x] Task 13: Доки и регрессия (depends on 10–12). CLAUDE.md: раздел UI (меню, раскладки `lay-*`, `body.menu`,
  `SETTINGS`, пауза, Esc/H/L, ⏸ вместо ≡, полоса тач-кнопок, `trainer_last`), витрина (раздел рендера —
  абзац), строка гейта `menu-check`; `docs/ANALYTICS.md` — `via=play`. Прогон: `gherkin-run`, `gherkin-check`,
  `unit-check`, `menu-check`, `touch-check`, `account-check`, `mirror-check`, `crash-check`, `cockpit-shots`,
  `yandex-check`, headless-регрессия DEMOS; снимки главного, разделов, паузы, витрины — ПК 1440×900 и
  телефон 844×390, 568×320 — владельцу до выкатки. Доску #290 обновить (полный payload).
<!-- Commit checkpoint: tasks 10-13 -->
