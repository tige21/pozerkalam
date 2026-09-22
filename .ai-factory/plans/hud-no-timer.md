# Implementation Plan: Убрать таймер из интерфейса занятия

Branch: main (create_branches: false)
Created: 2026-09-23
Доска: Vikunja «По зеркалам» #150 (P1, блокер #149 закрыт) · Ralph-цикл `.ai-factory/RALPH-CUSTOMER-2026-09-23.md`

## Settings
- Testing: yes — гейты (регрессия DEMOS, gherkin-check/run, unit-check, mt-check — HUD) + скриншоты HUD 1440×900 и 667×375
- Logging: minimal — удаление элемента HUD, новых путей отказа нет
- Docs: yes — CLAUDE.md, если где-то описан таймер HUD

## Roadmap Linkage
Milestone: "none"
Rationale: правка заказчика по UX.

## Research Context (codegraph)
- `updateHUD()` — `index.html:7536`: `setText($('timeVal'), game.t.toFixed(1)+' с')` каждый кадр.
- Разметка (codegraph HTML не индексирует, строка открыта по номеру): `#topright` — `index.html:444-448`:
  `#timeVal` (.big), `#hitsVal`, `#lvlIdx`.
- Остальные потребители `game.t` не выводят его на экран во время занятия: итоги урока (`winHTML`, «Время: X с»,
  `index.html:8140`), экзамен-протокол (`examPassHTML` «Время маршрута»), `progAdd` (лучшее время), отчёт отзыва.
  Итоговое время в итогах уже есть — ничего добавлять не нужно.
- Дрилл (`precDef()`) в итогах время не показывает намеренно (комментарий в `winHTML`: мерило — сантиметры,
  хвалить за время — толкать игрока торопиться). Оставляем как есть.
- tools/, learner.js на `#timeVal` не завязаны.

## Tasks

### Phase 1
- [x] Task 1: Удалить `#timeVal` из `#topright` и строку `setText($('timeVal'), …)` из `updateHUD`.
  Первой строкой панели становится «касаний: N» — поднять её до `.big`-стиля (класс `big` переходит к `#hitsVal`),
  чтобы панель не превратилась в две мелкие серые строки.
- [x] Task 2: Проверить CSS `#topright .big` в compact-медиа — работает для нового `.big` без правок.

### Phase 2: Проверка
- [x] Task 3: Гейты: регрессия DEMOS (без новых таймаутов сверх известных #154), gherkin-check/run, unit-check, mt-check.
- [x] Task 4: Скриншоты HUD во время занятия (десктоп и телефон) — таймера нет, итоги урока по-прежнему показывают время.
