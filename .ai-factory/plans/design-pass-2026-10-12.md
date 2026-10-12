# Implementation Plan: дизайн-проход 12.10.2026 — слоп и дефекты интерфейса

Branch: main (create_branches: false)
Created: 2026-10-12
Доска: #346 родитель · #347 каркас · #348 детали · #349 тексты · #350 вопросы владельцу

## Settings
- Testing: yes — гейты после каждой фазы: `tools/mirror-script.sh --check`, gherkin-run, gherkin-check,
  unit-check, crash-check, touch-check, menu-check, overlay-check, perf-check, account-check; look-check
  (+ `--mobile`) после правок HUD и зеркал. Красный гейт сначала прогоняется на HEAD через worktree:
  красный и там — задача на доске, не регрессия
- Logging: none — правится CSS, разметка и строки интерфейса; физика, уровни, демо и детекторы не трогаются
- Docs: yes — `.tastemaker/style-lock.md` (расхождения с CLAUDE.md), `.tastemaker/design-audit.md`,
  CLAUDE.md при изменении правила интерфейса

## Законы прохода
CLAUDE.md главнее style-lock. Новый цвет — только через `check_contrast.py --matrix` и запись в style-lock.
Одно действие — одно слово («Заново»); кнопка вне настроек называет переход; десятичная запятая; hover
только под `(hover:hover) and (pointer:fine)`; блоки `max-width:600px`, hover и reduced-motion — последние
в CSS; `maximum-scale=1` остаётся; ширина тач-полосы посчитана (touch-check); боковые кнопки в полосе
102–167 px; без `backdrop-filter` над живой канвой; `updateHUD` пишет в DOM только через `setText`.
Решения владельца (палитра, удаление функции, методика) не правятся — уходят в вопросы отчёта.

## Покрытие
`tools/design-shots.mjs` → `build/design-pass/{before,after}/` (1440×900, 844×390, 568×320, 390×844):
главное меню (новичок и вернувшийся), Уровни (6 вкладок), Экзамен, Профиль (гость, вошедший), Настройки
(5 вкладок), Помощь (2), пауза урока, экзамена и практики, «Как выполнять», HUD двора и города (погоня,
салон, показ), HUD экзамена, тач-строка и раскрытая карточка, предупреждение о грубой ошибке, итоги
(урок, дрилл, город), провал урока, протокол экзамена (сдан, не сдан), прерывание экзамена, бриф
экзамена (два режима), бриф и итог практики, пейволл (гость, вошедший), промокод, отзыв, редактор,
туториал кнопок, тур по HUD, портрет.

## Tasks

### Фаза 0 — подготовка
- [x] Task 1: законы прочитаны, PW_DIR на месте, `tools/design-shots.mjs`, базовые кадры

### Фаза 1 — аудит
- [x] Task 2: `/audit-ai-design-slop` + `/break` по кадрам и замерам → `.tastemaker/design-audit.md`
  (раздел 12.10), стенд `build/break/`, задачи на доске; вопросы владельцу — отдельным списком
- [x] Task 3: style-lock: сверка с CLAUDE.md (backdrop-filter, ≡-меню, счётчик, mt-check)

### Фаза 2 — каркас
- [x] Task 4: `/better-layout` → `/better-colors` → `/better-accessibility` по находкам аудита
  (экран со сломанной структурой — `/web-design-engineer` вместо трёх)

### Фаза 3 — детали
- [ ] Task 5: `/better-typography` → `/better-ui` → `/mobile-native`

### Фаза 4 — тексты
- [ ] Task 6: `/better-writing`, затем `deslop-scan.py` по новым строкам; подсказки манёвров и тексты
  уровней не трогать без прогона `learner.js`

### Фаза 5 — анимации (только если аудит нашёл)
- [ ] Task 7: `/review-animations` → `/improve-animations` → `/optimize-web-animations`; кадр упирается
  в JS — ничего тяжёлого

### Фаза 6 — итог
- [ ] Task 8: кадры «после», финальный отчёт, выкатка по CLAUDE.md (коммит, пуш, деплой, смоук)

## Commit Plan
- Коммит после каждой фазы через `/aif-commit`, по-русски, без трейлеров; перед пушем —
  `git log --format='%B' origin/main..HEAD | grep -in 'claude\|anthropic\|generated with'` пусто.
