# Reference board — «По зеркалам»

Created: 2026-09-26
Mode: Operate (игра/тренажёр) + Persuade (лендинг pozerkalam.space)
Design read: тренажёр манёвров и экзамена для ученика автошколы 18–30 с телефона и десктопа, mode Operate (HUD поверх 3D-сцены) с лендингом в режиме Persuade, visual lane «приборная панель ночью: асфальт, свет фар, дорожные знаки», dials 4/3/7/6.
Dials: variance 4, motion 3, density 7, art direction 6
Sourcing: viewed via WebSearch/WebFetch 2026-09-26 (5 источников просмотрены, 1 fetch провалился — Dribbble отдаёт пустую страницу). «Inspo»-инструмента в сессии нет; ближайший скилл `daily-ui-inspiration-capture` — конвейер статей для другого проекта, к этому брифу не относится.

## Quality bar
- Собственный продукт (index.html + landing/src/layouts/Base.astro): токены `--asphalt/--ink/--beam/--kerb/--go/--stop` уже общие для игры и лендинга; планка — «страница и продукт читаются как одна вещь» (комментарий в Base.astro:38).
- Car Parking Simulator: 2026 (store page, mwm.ai, viewed): мини-карта сверху, маркеры парковочного места, оранжевые конусы на тёмном городе, ночные сцены — категория живёт в тёмной палитре с одним тёплым сигнальным цветом.
- Parkwise (github.com/chris-kc-cheng/parking-simulator PR #1, viewed): cockpit-раскладка — лобовое, три зеркала, приборка, мини-виды; P/R/D, сценарии reverse/front-in/parallel; та же композиция, что у нас, подтверждает жанровую норму.

## Borrow
- Palette/material: собственный продукт -> асфальт #0b0f14 как единственный фон, «свет фар» #9fd0ff как акцент, «бордюр» #ffd63c как предупреждение; ни одного нового оттенка.
- Type/hierarchy: Base.astro -> Onest 300–900 variable, заголовки 800 с −.035em, `.tel-k` 0.69rem uppercase +.09em для подписей приборов, `tabular-nums` на всех меняющихся числах.
- Layout/composition: Parkwise + собственный HUD -> зеркала и карта по углам, карточка инструктора в верхней полосе, приборы внизу; на телефоне низ занят кнопками.
- Motion/interaction: собственный лендинг -> `transition: opacity/transform .45–.5s ease` для появления секций, .18s для кнопок; в игре — только смена состояния (.12–.3s), моргание = сигнал (поворотник, стартер).
- Asset language: собственный логотип (data-URI SVG в `<link rel=icon>` и inline в startHTML: контур машины + жёлтый шеврон) — сохранить байт в байт.

## Avoid
- Светлая «учебная» страница со скриншотами в ряд и эмодзи вместо иконок (pddtest.kz/products/game, avto-drom.uz — viewed): читается как каталог ПО, не как тренажёр.
- «Игровая» подача: яркие ливреи, HD-графика как обещание, слово «игроки» (Car Parking Simulator store copy) — voice-карточка запрещает.
- Indigo/фиолетовые градиенты, glass поверх glass, карточка в карточке — не из мира асфальта.
- Второй сатурированный акцент рядом с #9fd0ff: жёлтый и зелёный уже заняты сигналами (бордюр/зачёт).

## Direction contract
- Thesis: приборная панель ночью — тёмный асфальт, холодный свет приборов, тёплые сигналы дороги; каждый цвет означает одно и то же в игре и на лендинге.
- First viewport (лендинг): прикреплённый герой с живой репликой инструктора над сценой; (игра): сцена + карточка коуча + приборы, ноль декоративных слоёв.
- System: токены Base.astro как единый источник, Onest, радиусы 8/12/16 + 999, hairline-рамки rgba(255,255,255,.09–.16) вместо теней, motion ≤ .3s в UI.
- Risk: перегруз HUD одинаковыми коробками (9 ячеек одной рамкой), жёлтый на всём подряд (weak-карточки, поворотник, упор, warn).

Sources viewed 2026-09-26: https://mwm.ai/apps/car-parking-simulator-2026/1568155390 · https://github.com/chris-kc-cheng/parking-simulator/pull/1 · https://pddtest.kz/products/game · https://avto-drom.uz/ru · https://blog.tubikstudio.com/case-study-car-safety-mobile-app/ (adjacent: цвет = тип события, один акцент). Failed: https://dribbble.com/shots/21364928-Driving-School-App-UI-Interfaces (пустой ответ).
