# Implementation Plan: фальшивая дверь — предложение курса за 249 ₽ (фаза 4 задачи #280)

Branch: demand-check (git.create_branches: false — ветку не создаём, работаем в worktree `facades`)
Created: 2026-10-04

## Settings
- Testing: yes — `@ui`-сценарии в `specs/features/`, проверки в `tools/account-check.mjs`, связь кодом требования (скилл `pozerkalam-gherkin`)
- Logging: verbose по правилам проекта — одна строка `console.info('[pay] …')` на каждое действие с предложением (показ, «беру», «пока бесплатно»), причина «не показано» — только под `pz_debug=an` (`AN_DEBUG`), ничего покадрово
- Docs: yes — обязательный шаг документации в конце

## Roadmap Linkage
Milestone: "M7 · B2C-freemium"
Rationale: клики по предложению отвечают на вопросы 2–3 из `docs/monetization-m7.md` (состав и цена) до подключения приёма денег.

## Research Context
Source: `docs/demand/personas.md`, `docs/demand/landing.md`, `docs/demand/price.md` (фазы 1–3 #280)

Goal: на живых посетителях сайта измерить долю тех, кто нажимает «беру» на предложение курса, не беря денег и не закрывая уровни.
Constraints:
- **Цена — 249 ₽ навсегда, одно плечо** (решение владельца 04.10.2026; фокус-группа рекомендовала 499 — владелец выбрал 249).
- Ничего не списывается и не закрывается: после любого ответа уровень открывается как сейчас. `PAYWALL.levels` и `PAY_ON` не трогаем.
- Только сайт: `anPlatform()` = `web` или `pwa` и страница не во фрейме. В билде Яндекс Игр покупки — только через их SDK; в VK и Telegram — свои правила цифровых покупок.
- Никаких контактов и персональных данных (юрстраницы #180 ещё не готовы): только событие клика.
- Тексты — голосом `.ai-factory/references/pozerkalam-voice.md`, через `ru-copy-deslop`; «на автомате» не прятать (главный стоп учеников на механике, фаза 3).
Decisions:
- Момент — первый вход в любой из уровней 20–32 (`openLevel`), один раз на устройство (`pz_offer` в localStorage: ключ `pz_*`, чтобы адаптер ЯИ не зеркалил его в облако).
- Пейволл главнее предложения: закрытый уровень показывает пейволл, предложение на нём не всплывает.
- Название — по ценности для обоих сегментов: «Площадка, город и экзамен», не «Экзаменационный курс» (фаза 3: водителям с правами нужен город).
Open questions:
- Порог решения (доля кликов от показов) задаёт владелец до запуска — `docs/demand/fake-door.md`.

## Commit Plan
- **Commit 1** (после задачи 1): "test(acct): сценарии предложения курса — один раз, без списания, только сайт"
- **Commit 2** (после задач 2–4): "feat(acct): предложение курса за 249 ₽ на входе в уровни 20–32"
- **Commit 3** (после задачи 5): "docs(demand): фальшивая дверь — события, порог решения, как читать"
- Задача 6 — слияние в main и выкатка, только после «да» владельца.

## Tasks

### Phase 1: Правило словами

- [x] **Task 1: сценарии предложения.** Новый файл `specs/features/acct/predlozhenie.feature` (`@ui`, язык владельца) и сценарии в `specs/features/an/sobytiya.feature`. Коды:
  - `@acct-offer-once` — первый вход в уровень из 20–32 показывает предложение «Площадка, город и экзамен — 249 ₽ навсегда»; второй вход в любой из них — уже нет.
  - `@acct-offer-free` — «Беру» показывает «оплату ещё не подключили, всё открыто бесплатно» и открывает уровень; запросов к оплате нет, `PAY_ON` и замки не меняются.
  - `@acct-offer-skip` — «Пока бесплатно» открывает уровень сразу.
  - `@acct-offer-paywall-first` — на закрытом уровне (`PAYWALL_FORCE`) показан пейволл, предложения нет.
  - `@acct-offer-site-only` — в `ya`, `vk`, `tg` и во фрейме предложения нет.
  - `@an-offer-events` — `offer_view`, `offer_click`, `offer_skip` с `li`, `kind`, `via`, `price: 249`.
  Затем `node tools/qa-checklist.mjs`. `gherkin-check` до задачи 4 будет красным — так и задумано: сначала правило, потом проверка.
  Логи: не нужны (спецификация).
  Files: `specs/features/acct/predlozhenie.feature`, `specs/features/an/sobytiya.feature`, `docs/qa-checklist.md` (генерат).

<!-- Commit checkpoint: task 1 -->

### Phase 2: Предложение в игре

- [x] **Task 2: состояние и решение «показать или нет»** (depends on 1). В `index.html`, секция пейволла рядом с `PAYWALL`/`levelLocked`:
  - `const OFFER={ on:true, price:249, from:19, to:31, key:'pz_offer' }` — индексы уровней 20–32;
  - `offerWhyNot(i)` (пустая строка — показать, иначе причина для лога): `OFFER.on`; `anPlatform()` ∈ {`web`, `pwa`}, не во фрейме, `location.protocol==='https:'` (все прочие гейты открывают игру с `file://` и не должны его видеть), уровень в диапазоне и не `custom`, не `levelLocked(i)`, ключ `pz_offer` не стоит (чтение в `try/catch`: в приватном окне хранилище бросает — тогда не показывать);
  - встроить в `openLevel` после проверки `levelLocked`: `offerWhyNot(i)` пуст → `offerShow(i, via)`.
  Логи: под `AN_DEBUG` — `console.info('[pay] предложение не показано: <причина>')` один раз на вызов `openLevel`; без `pz_debug` — тишина.
  Files: `index.html`.

- [x] **Task 3: карточка и ответы** (depends on 2). В `index.html`:
  - `offerHTML(i)` по образцу `paywallHTML` (класс `.paywall`, без новой вёрстки): заголовок «Площадка, город и экзамен — 249 ₽ навсегда», что открывает (уровни 20–32: эстакада, город с кольцом и трамваем, экзамен-маршрут с протоколом), «один платёж, без подписки», «на автомате»; кнопки `data-act="offer-take"` «Беру за 249 ₽» и `data-act="offer-skip"` «Пока бесплатно»;
  - `offerShow(i, via)`: запомнить `offerLi`/`offerVia`, поставить `pz_offer` **до** показа (уход по Escape тоже считается показом), `track('offer_view', Object.assign(anLevel(i), {via, price:OFFER.price}))`, `showOv`;
  - `doAct`: `offer-take` → `track('offer_click', …)`, карточка «Записали. Оплату ещё не подключили — пока всё открыто бесплатно» с кнопкой «Поехали» (`data-act="offer-go"`); `offer-skip` → `track('offer_skip', …)` и `offer-go` → `openLevel(offerLi, offerVia)` (ключ уже стоит, повторного показа не будет);
  - `METRIKA_GOAL`: `offer_view:'offer-view'`, `offer_click:'offer-click'`;
  - тексты — через `python3 ~/.claude/skills/ru-copy-deslop/scripts/deslop-scan.py index.html`, риторика 0 в новых строках.
  Логи: `console.info('[pay] предложение: показ, уровень N')`, `'[pay] предложение: беру'`, `'[pay] предложение: пока бесплатно'` — по одной строке на действие.
  Files: `index.html`.

- [x] **Task 4: проверки** (depends on 3). В `tools/account-check.mjs` (игра там уже отдаётся с `https://pozerkalam.space/play/` через подмену) — проверки с кодами из задачи 1 в имени:
  - первый `openLevel(19,'pick')` — карточка с «249 ₽» и «на автомате», событие `offer_view` с `li:20`, `price:249`; второй `openLevel(20,'pick')` — уровень загружен, карточки нет (`@acct-offer-once`);
  - «Беру» → событие `offer_click`, карточка «оплату ещё не подключили», «Поехали» → `level` = 20; ни одного запроса к `/api/` с оплатой; «Пока бесплатно» на чистом профиле → `offer_skip` и уровень (`@acct-offer-free`, `@an-offer-events`);
  - `PAYWALL_FORCE=[19]` → пейволл, `offer_view` нет (`@acct-offer-paywall-first`);
  - `BUILD='ya-…'`, `?vk_app_id=…`, `#tgWebApp…`, страница во фрейме → карточки нет (`@acct-offer-site-only`);
  - существующие проверки (`@acct-paywall-*`, `@an-level-start-once`) остаются зелёными: где они открывают уровни 20–32, профиль заранее несёт `pz_offer`.
  Проверка обязана краснеть: `FAULT=offer` (предложение выключено) красит `@acct-offer-once/-free/-skip` и `@an-offer-events`, `FAULT=offersite` — `@acct-offer-site-only`, `FAULT=offerbuyer` — `@acct-offer-not-buyer` (добавлен при реализации: после «Восстановить покупку» предложение мелькало у купившего).
  Затем: `PW_DIR=/tmp/pw node tools/account-check.mjs`, `node tools/gherkin-check.mjs`, `PW_DIR=/tmp/pw node tools/gherkin-run.mjs`, `node tools/qa-checklist.mjs`, `tools/mirror-script.sh --check`; для уверенности, что `file://`-гейты не задеты, — `PW_DIR=/tmp/pw node tools/crash-check.mjs` и `node tools/level-audit.mjs`.
  Логи: в гейте — по строке на проверку, как у остальных `check(...)`.
  Files: `tools/account-check.mjs`.

<!-- Commit checkpoint: tasks 2-4 -->

### Phase 3: Документация и чтение результата

- [x] **Task 5: документы** (depends on 4).
  - `docs/ANALYTICS.md`: строки `offer_view` / `offer_click` / `offer_skip` в таблице событий, цели Метрики `offer-view` / `offer-click`; запрос к ClickHouse Rybbit по образцу уже описанных — показы и клики по `platform`, `mob`, `kind`, уникальные сессии.
  - `docs/demand/fake-door.md`: что проверяем и почему 249 ₽ (решение владельца при рекомендации панели 499); **порог решения до запуска** — минимум 200 показов (при 5 % кликов погрешность ±3 п.п., 95 %), доля кликов, выше которой M7 идёт на 249 ₽, и ниже которой — пересмотр состава; срок — до 200 показов или 4 недели; как выключить (`OFFER.on=false`); помнить, что клик — это намерение, а не оплата.
  - `docs/ACCOUNT.md` (раздел пейволла) и `CLAUDE.md` (абзац «Аккаунт, аналитика, пейволл»): предложение отдельно от замка, только сайт, один раз на устройство, `pz_offer`, гейт `@acct-offer-*`.
  - `docs/demand/landing.md` / `price.md` — строка-ссылка на фазу 4.
  Логи: не нужны (документация).
  Files: `docs/ANALYTICS.md`, `docs/demand/fake-door.md`, `docs/ACCOUNT.md`, `CLAUDE.md`, `docs/demand/price.md`.

<!-- Commit checkpoint: task 5 -->

### Phase 4: Выкатка (только после «да» владельца)

- [ ] **Task 6: слияние и выкатка** (depends on 5).
  1. Слить `demand-check` в `main` (`--no-ff`, как фасады), проверить, что в сообщениях нет упоминаний ИИ, `git push`.
  2. `./deploy-pozerkalam.sh` из чистого дерева (сам синхронизирует зеркало и проверяет CSP: новых инлайн-скриптов нет, но хэши пересчитаются).
  3. Смоук на проде: Playwright с вырезанной аналитикой открывает `/play/`, уровень 20 из выбора — карточка с «249 ₽»; уровень 21 — без неё.
  4. Доска: комментарий в #280 с датой запуска; фаза 4 закрывается не выкаткой, а набором 200 показов и решением по порогу.
  Логи: вывод деплой-скрипта и смоука — в комментарий #280 одной строкой (build id).
  Files: —
