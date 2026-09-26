# Style lock — «По зеркалам» (тренажёр парковки, RU, телефон + десктоп)

Established: 2026-09-26. Source: user-specified brief + existing product pixels — токены сняты с `landing/src/layouts/Base.astro:36–46` и `index.html` (CSS 21–437), проверены `scripts/check_contrast.py --matrix`. Сгенерированная палитра (`generate_palette.py --mood technical --mode dark --seed 2026`, изумрудная #0a8662/#30b88b) отклонена: у продукта есть живой бренд и логотип, лендинг и игра уже делят одни токены — смена палитры дала бы ровно то расползание, которое этот файл должен предотвращать.

## Palette
- Background: `#0b0f14` `--asphalt` (страница, сцена под HUD). Тона: `#10171f` `--asphalt-2` (секция), `#151f2a` `--asphalt-3` (карточка лендинга)
- Surface: `#0c121a` (оверлей игры `rgba(12,18,26,.96)`); панели HUD — `rgba(9,14,20,.74)` + `backdrop-filter:blur(6px)`; лендинг — `--glass rgba(13,20,28,.72)`
- Primary: `#1b5faa` (синий знака «P»: главная кнопка, активный сегмент), border `#3e83cf`, hover `#2571c4`
- Accent: `#9fd0ff` `--beam` (свет приборов: заголовки уровня, подписи-ссылки, фокус-ринг `#7dd8ff`); низкий тон `#58b0ff` `--beam-lo` (полоса прогресса чипа, маркер списка)
- Text primary: `#e8eef6` `--ink` — contrast vs background 16.47 (AA pass)
- Text muted: `#93a7bd` `--mute` (7.78 vs bg), `#7b8fa5` `--faint` / `#7f93a9` подписи приборов (5.78 / 6.08 vs bg)
- Button label color: white — contrast vs Primary 6.43 (pass)
- Semantic (дорожные): `#ffd63c` `--kerb` предупреждение/бордюр/поворотник (13.67 vs bg), `#4ade80` `--go` зачёт/ok (11.03), `#f87171` `--stop` отказ/bad (6.95), `#ff9636` касание (8.85), `#fbbf24` warn (11.51), `#c08bff` демо (7.67), `#b6a4ea` экзамен
- Dark mode: single mode only — продукт тёмный по природе («ночь, приборы»); светлого режима нет и не планируется

## Color contract
Матрица `check_contrast.py --matrix text=#e8eef6 bg=#0b0f14 surface=#0c121a primary=#1b5faa accent=#9fd0ff border=#28303a on-primary=#ffffff` (2026-09-26):

- Text-safe (>=4.5): text/bg 16.47 · text/surface 16.11 · accent/bg 11.84 · accent/surface 11.58 · on-primary/primary 6.43 · text/primary 5.51 · mute/bg 7.78 · mute/surface 7.61 · faint/bg 5.78 · все семантические на bg (см. Palette) · bg-текст на kerb 13.67 и на go 11.03
- UI-safe (>=3.0 и <4.5): accent/primary 3.96 · focus `#7dd8ff`/primary 4.03 · primary-border `#3e83cf`/bg 4.90 (это и есть видимая граница кнопки) · primary-hover `#2571c4`/bg 3.88
- Decorative (<3.0): **primary fill/bg 2.99** и primary/surface 2.92 — заливка кнопки видна за счёт рамки `#3e83cf` (4.90), рамку с главной кнопки не снимать · border/bg 1.44 (hairline, декоративная) · bg/surface 1.02 · text/accent 1.39 · accent/on-primary 1.62 (белый текст на `#9fd0ff` запрещён)

Запрещённые пары, найденные в аудите 26.09: белый с `opacity:.22` на панели (1,95:1, `#bar .lever span`) — исправлено на `opacity:.5` (5,37:1). Любой новый оттенок — сначала в матрицу, потом на экран.

## Typography
- Family: **Onest** (variable 300–900, self-hosted `@font-face`, `font-display:swap`) — лендинг; игра — системный стек `ui-sans-serif, system-ui, "Segoe UI", Roboto` (один файл без зависимостей, кириллица покрыта системой). Новые экраны игры — системный стек; новые страницы сайта — Onest.
- Heading: 800, `letter-spacing:-.035em`, `line-height:1.0–1.04`, `text-wrap:balance`. Body: 400, 17px/1.62 (лендинг), 14px/1.5 (оверлеи игры), 13px/1.4 (панели HUD). Strong: 650.
- Подписи приборов: 11px uppercase `+.6px` (игра) / 0.69rem `+.09em` (`.tel-k`); пол — 10px, 7–8px (compact HUD) ниже пола — см. аудит.
- Числа: `font-variant-numeric:tabular-nums` везде, где значение меняется; десятичный разделитель — запятая («0,3 м», «5,1 с»), не точка.
- Кириллица: без искусственного сжатия трекинга ниже −.038em; `word-break` по умолчанию; `&nbsp;` между числом и единицей.
- Перенос: `text-wrap:balance` на h1/h2 оверлеев, `pretty` на абзацах, пунктах и описаниях карточек. Текст оверлеев выделяется (содержимое), игровой слой и кнопки — нет. Сглаживание `-webkit-font-smoothing:antialiased` один раз на корне.

## Shape language
- Corner radius: 4 (микро: `.kbd`, бейдж передачи), 8 (ячейки HUD, поля), 10 (панели, кнопки игры, боковые кнопки), 12 (тач-кнопки, карточки уровней, кнопки ≡), 16 (оверлей-карточка, тач-кластер), 999 (pill-кнопки лендинга, чип цели). Применено 26.09.2026: 5→4, 6→8, 9→10, 11→12, 15→16, 20→999; лендинг 14→12 при следующем касании.
- Shadow depth: почти нет — `0 2px 14px rgba(0,0,0,.35)` только на плавающих тач-кнопках; глубину даёт `backdrop-filter:blur(6px)` + полупрозрачный фон.
- Border usage: hairline `rgba(255,255,255,.09–.16)` (`--edge/--edge-2`) как граница панелей; состояние несёт цветная кромка 4px слева (`k-stop/k-hit/k-almost/k-ok`) + иконка, не только цвет.

## Density & spacing
- Base unit: 4px
- Section padding (лендинг): `--gap-sec clamp(58px,6.4vw,112px)`, гаттер `--gut clamp(20px,5vw,64px)`, контейнер 1240
- Content card internal padding: 24px (`space-6`; оверлей-карточка 26/30)
- Compact/dense card internal padding: HUD-ячейка 7×11px (compact 3×7) — ниже `space-3`, оправдано канвой; тач-кнопки 44–62px
- Showcase/hero card internal padding: 32px
- Overall density: dense, information-heavy в игре; лендинг — стандартный ритм секций
- Section separation: whitespace + смена тона `--asphalt-2`, без разделителей

## Structure
- App shell (игра): канва во весь экран, `#topleft` задание · `#coach` карточка в верхней полосе · `#topright` счётчик · `#bar` приборы внизу · зеркала и карта по углам; телефон — карточка над рядом передач. Оверлеи — одна карточка 760px по центру, один filled-button на экран (остальные `.ghost`).
- Лендинг: прикреплённый герой с лентой реплик (`tools/hero-tape.mjs` — гейт), дальше «пять вопросов посетителя» (CLAUDE.md).
- Shared chrome: логотип (контур машины + шеврон) + «По зеркалам»; подвал со ссылкой на /avtoshkolam/.
- Build stamp / log: `.tastemaker/log.json` пока нет — сборок через tastemaker не было.

## Reference intelligence
- Reference board: `.tastemaker/reference-board.md` — viewed sources (5 просмотрено 2026-09-26)
- Design read: тренажёр (HUD над 3D) для ученика автошколы 18–30, mode Operate (+ Persuade на лендинге), lane «приборная панель ночью»
- Dials: variance 4, motion 3, density 7, art direction 6
- Foundation: existing repo stack — vanilla JS + inline CSS (игра, zero deps), Astro (лендинг); реестров shadcn нет и не будет
- Quality bar: Car Parking Simulator 2026 (тёмная сцена, один тёплый сигнал), Parkwise (cockpit-композиция), собственный Base.astro (единые токены)
- Direction contract: Thesis «приборная панель ночью: асфальт, свет приборов, сигналы дороги»; First viewport — сцена + карточка коуча + приборы, ноль декора; System — токены Base.astro, Onest/системный стек, радиусы 8/10/12/16/999, hairline вместо теней, UI-motion ≤ .3s; Risk — жёлтый на всём подряд, девять одинаковых коробок HUD
- Anti-references: светлые «каталожные» страницы со скриншотами (pddtest.kz, avto-drom.uz), эмодзи как иконки, игровая подача

## Taste memory
- Profile priors used: none (`~/.tastemaker/profile.md` нет)
- Decision log: `.tastemaker/decisions.log`
- Last resolved decisions: 2026-09-26 palette kept (продуктовая, генерация отклонена); 2026-09-26 shape kept (ряд радиусов 4/8/10/12/16/999); 2026-09-26 HUD — `.opt`-ячейки без рамки, рамку несут три главные
- Pending review: none — палитра и ряд радиусов подтверждены запросом «примени style-lock» 26.09.2026 и применены
- Profile promotion: none
- Memory precedence note: бриф «сгенерировать палитру» разрешён в пользу существующего бренда (правило «preserve existing identity» + «real pixels over descriptions»); генератор прогнан, результат записан как отклонённый кандидат

## Navigation chrome
- Sidebar: нет. Панели HUD — `rgba(9,14,20,.74)` на канве; ≡-меню (тач) — сетка кнопок на `rgba(5,8,12,.86)`
- Active item: filled Primary `#1b5faa` + рамка `#58a0e0`; тач-передача `.on` — синий `rgba(56,132,214,.72)`, R — красный, D — зелёный
- Inactive hover: `border-color rgba(159,208,255,.35–.6)` + фон `rgba(159,208,255,.08)`; hover только под `@media (hover:hover)` (сейчас не так — см. аудит)
- Shell density: HUD-ячейка 13px/15px, подпись 11px; compact 12px/8px

## Mood descriptors
ночная приборка, спокойно, точно, по-инструкторски

## Assets
- Anchor asset: логотип — data-URI SVG в `index.html:20` (`<link rel=icon>`) и inline в `startHTML` (`index.html:8887`): контур машины, белый штрих 3/13, жёлтый шеврон `#ffd63c`; preserved existing brand mark, не перерисовывать
- Asset style: пиктограммы — текстовые глифы ⟲ ▶ ▸ ⏸ ⬆ ⚠ ◀ ▶ монохромом в цвете текста; эмодзи (✅ ❌ 🎓 💡 🚗 ✉ 📱) — не добавлять новых, существующие в очереди на замену
- Illustration vs. photography split: нет ни того, ни другого — визуал = живая 3D-сцена и клипы демонстраций (`landing/public/clips/*.mp4`, `tools/landing-clips.mjs`); фотостоки и unDraw не использовать
- Illustration source used: none
- Logo: см. Anchor asset; вордмарк «По зеркалам» — Onest 800

## Motion
- Feel: сдержанно, состояние — не спектакль
- Curves: `ease` (лендинг), `ease-out` (пульс ячейки); новых кривых не вводить
- Durations: hover/state .12–.2s, чип/руль-пиктограмма .3s, появление секций лендинга .45–.55s, туторный ринг 1.1s alternate, моргание сигнала .76–.9s step-end
- Entrance: лендинг `opacity + transform` .45s; игра — без entrance-анимаций (кадр рисует канва)
- Screen tracks: app shell — только смена состояния; лендинг — reveal по IntersectionObserver, клипы стартуют в зоне видимости, под reduce не стартуют
- Frequency rules: смена передачи, руль, тормоз — без анимации; hover ≤ .2s
- Reduced motion: лендинг — `.hero.open` статичен; игра — `@media (prefers-reduced-motion:reduce)` в конце CSS: кольцо онбординга, пульс ячейки и мигание стартера статичны, поворотники остаются (сигнал + цвет)
- Verified by: 26.09.2026 — `button:active scale(.96)` .1s ease-out, hover под `(hover:hover) and (pointer:fine)`, reduce-блок проверен эмуляцией; `scripts/audit_motion.py` не гонялся

## Do not
- Не вводить новые оттенки мимо Base.astro; не использовать indigo/фиолетовые градиенты, glass-на-glass, карточку в карточке
- Не ставить белый текст на `#9fd0ff` (1.62:1) и не класть `#1b5faa` без рамки на асфальт (2.99:1)
- Не кодировать состояние только цветом — всегда кромка/иконка/текст рядом
- Не писать кнопки статусом («Экран: выкл») — глагол или пара сегментов
- Не добавлять эмодзи как иконки; не использовать тире «—» в новых заголовках лендинга без нужды (voice-карточка: три формы заголовка)
- Не опускать подписи ниже 10px; числа — с запятой
