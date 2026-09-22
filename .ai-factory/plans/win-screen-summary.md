# Implementation Plan: Итоги урока — только итоги, комментарий и три кнопки

Branch: main (create_branches: false)
Created: 2026-09-23
Доска: Vikunja «По зеркалам» #149 (P1) · Ralph-цикл `.ai-factory/RALPH-CUSTOMER-2026-09-23.md`

## Settings
- Testing: yes — проектные гейты (headless-регрессия DEMOS, gherkin-check/run, unit-check) + скриншот экрана победы на десктопе и телефоне
- Logging: minimal — UI-вёрстка без новых путей отказа; `console.warn` не нужен
- Docs: yes — CLAUDE.md, раздел Levels (`hacks[]`/`transfer`) и UI, если меняется описание экрана победы

## Roadmap Linkage
Milestone: "none"
Rationale: правка заказчика по UX, вне майлстоунов ROADMAP.

## Research Context (codegraph)
- `win()` — `index.html:9674`: `game.done`, `progAdd`, `showOv(winHTML())`.
- `winHTML()` — `index.html:8092`: две ветки (дрилл `precDef()` и обычный уровень); обе в конце
  дописывают `lvlListHTML()` (список всех 32+ уровней + кнопка «Выбрать уровень»), затем
  «Следующий уровень (N)», «Повторить (R)», «✉ Что-то не так».
- `lvlListHTML()` — `index.html:7978`, ещё два вызова: `startHTML`, `helpHTML` — их не трогаем.
- `doAct`: `pick` → `showLevelPick()`, `next` → `loadLevel(game.li+1)` (по модулю — после последнего идёт первый),
  `again` → `restart()`; `resume` при `game.done` пересобирает `winHTML()` — новая разметка обязана пережить повтор.
- Имя уровня: `'2 · Задним ходом в перпендикулярный карман'`, у своих площадок `custom:true` (★).
- CSS оверлея — `index.html:140-190` (`#overlay button{margin:18px 8px 0 0}`), codegraph CSS не индексирует.
- Инструменты/сценарии на разметку экрана победы не завязаны (grep по tools/specs/learner.js пуст).

## Tasks

### Phase 1: Разметка
- [x] Task 1: В `winHTML()` (`index.html:8092`) обе ветки собрать из общего хвоста `winActsHTML()`:
  убрать `lvlListHTML()`; ряд кнопок — «Выбрать уровень» (`pick`, ghost), «Повторить (R)» (`again`, ghost),
  «Следующий уровень (N)» (`next`, primary) и рядом с ней подпись — имя следующего уровня
  (`LEVELS[(game.li+1)%LEVELS.length]`, ★ для своей площадки). Итоги (время/касания/ошибка, рекорд)
  и комментарий (совет + «Запомни для реальной дороги») остаются.
  «✉ Что-то не так» — не кнопкой ряда, а тихой строкой-ссылкой под ним (канал обратной связи с экрана
  победы сохраняется; решение отметить в отчёте владельцу).
- [x] Task 2: CSS: `.winacts` — flex-ряд с переносом; `.nextgo` — кнопка + подпись имени в одну связку
  (на узком экране подпись уходит под кнопку, не наезжает); `.linkbtn` — кнопка-ссылка без рамки.

### Phase 2: Проверка
- [x] Task 3: Гейты: headless-регрессия DEMOS (0 warn), `gherkin-check`, `gherkin-run`, `unit-check`.
- [x] Task 4: Скриншоты экрана победы (обычный уровень и дрилл) 1440×900 и 667×375; последний встроенный
  уровень → подпись показывает уровень 1 (или первую площадку ★); `doAct('resume')` пересобирает тот же экран.
