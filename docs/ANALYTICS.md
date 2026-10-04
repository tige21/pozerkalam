# Аналитика игры: Rybbit spark и Метрика

Кто играет, с какого устройства, где бросает. Две системы под одной функцией `track()`:

- **Rybbit** — тот же self-hosted инстанс, что у spark (vdsina, `/opt/rybbit`), дашборд
  https://analytics.sparkcards.space, сайт **pozerkalam**. Продуктовые события, воронки,
  удержание, устройства, страны;
- **Яндекс Метрика** (счётчик из `.deploy.env`) — вебвизор и старые цели воронки.

## Как устроено

```
игра: <script defer src="/rb/script.js" data-site-id="N">   ← вставляет deploy-pozerkalam.sh
      track(name, props) ─┬─ ym(ID, 'reachGoal', <старое имя цели>, props)
                          └─ window.rybbit.event(name, props)
nginx pozerkalam.space:  /rb/ → 127.0.0.1:3001/api/  (Rybbit backend spark на этом же боксе)
зеркало 194:             /rb/ → https://83.217.215.66/rb/
```

Скрипт Rybbit шлёт события туда, откуда загружен (`src.split("/script.js")[0]`), поэтому тег
со своего домена даёт три вещи: запросы идут на `'self'` (CSP не меняется), игроки под VPN
доходят через зеркало (`analytics.*` резолвится только в РФ-бокс), блокировщики реже режут
first-party адрес. Страну Rybbit берёт из `X-Real-IP` — nginx прода доверяет этому заголовку
только от адреса зеркала.

**Где аналитики нет:** без `RYBBIT_SITE_ID` тега нет и `track()` в Rybbit молчит — локально
(`file://`), во всех гейтах `tools/`, в билде Яндекс Игр (площадка запрещает стороннюю аналитику,
`@dist-yandex-no-account`) и на старом зеркале по IP.

## Состояние

Включено 02.10.2026 (build `a96080e0a5ad6805`): сайт **№ 3** «По зеркалам», `RYBBIT_SITE_ID=3` в
`.deploy.env`. Номера сайтов в инстансе: 1 — spark staging, 2 — spark prod, 3 — игра.

Сайт заведён без панели — вставкой в таблицу `sites` (Postgres контейнера `postgres` на vdsina,
база `analytics`) той же записью, что делает панель: `siteConfigurationLifecycle.create` в backend
Rybbit — одна вставка, `id` = 6 случайных байт в hex, `created_by` и `organization_id` скопированы
у spark-prod. Других таблиц создание сайта не трогает; конфиг сайта backend кэширует на минуту.

Смоук деплоя проверяет `/rb/script.js` и `/rb/site/tracking-config/3` на проде и зеркале.

## Как проверить, что события доходят

**Headless-браузер и curl в отчёты не попадают.** У сайта включено `blockBots`: Rybbit кладёт такие
визиты в `bot_events`, а не в `events`. Headless Chromium отсеивается по `detected_client_signals`
(`navigator.webdriver`, SwiftShader, пустые плагины), curl — по `detected_header_heuristics`. Пустая
`events` после проверки из Playwright — не поломка; смотреть `bot_events`:

```bash
ssh vdsina
CH=$(docker inspect backend --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^CLICKHOUSE_(USER|PASSWORD)=')
U=$(echo "$CH" | grep USER= | cut -d= -f2-); P=$(echo "$CH" | grep PASSWORD= | cut -d= -f2-)
ch(){ docker exec clickhouse clickhouse-client ${U:+--user "$U"} ${P:+--password "$P"} -d analytics -q "$1"; }
ch "SELECT event_name, country, city, browser, device_type, timestamp FROM events WHERE site_id=3 ORDER BY timestamp DESC LIMIT 20"
ch "SELECT querystring, country, detected_client_signals, detected_header_heuristics, timestamp FROM bot_events WHERE site_id=3 ORDER BY timestamp DESC LIMIT 20"
```

Что подтвердила выкатка (по `bot_events`): страна определяется по настоящему IP на обоих путях —
напрямую RU, через VPN и зеркало — страна выхода VPN; браузерные заголовки прокси передаёт целиком
(`detected_header_heuristics = false` у браузерных визитов). Живой визит проверяется с телефона:
игра → дашборд, сайт «По зеркалам», визит в течение минуты. Тестовые записи помечай
`?utm_source=deploy-check` и удаляй: `ALTER TABLE bot_events DELETE WHERE site_id=3 AND querystring LIKE '%deploy-check%'`.

## События

Свойства плоские; `true/false` уходят как `1/0`, строки обрезаются до 128 знаков. `li` —
номер уровня с 1, как на карточке выбора; `kind` — `yard | drill | city | exam | custom`.

| Событие | Когда | Свойства | Цель Метрики |
|---|---|---|---|
| `app_open` | загрузка страницы, раз | `platform` (web, pwa, vk, tg, ya), `framed`, `mob`, `lang`, `runs`, `build`, `account`, `provider`, `utm_*`, `source` | — |
| `level_start` | «Поехали», выбор уровня, «Следующий», цифра, «Заново», «отработать» из протокола | `li`, `kind`, `via` (start, pick, next, digit, again, train), `exam_mode` | `level-start` |
| `level_win` | зачёт | `li`, `kind`, `t`, `hits`, `clean`, `err_cm` (дриллы), `demo` | `win` |
| `level_fail` | провал попытки на строгих уровнях | `li`, `kind`, `code` | `level-fail` |
| `exam_pass` / `exam_fail` | конец экзамена | `route`, `mode`, `score` | `exam-pass` / `exam-fail` |
| `demo_start` | демонстрация | `li`, `kind` | `demo-start` |
| `feedback_open` / `feedback_sent` | форма отзыва | `src` / `kind` | `feedback-open:<src>` / `feedback-sent` |
| `perf` | раз за сессию после 20 с езды | `q`, `fps`, `js`, `dpr`, `cores`, `mem`, `gfx`, `cam`, `mob` | — |
| `auth_start` / `auth_ok` / `auth_fail` | вход | `provider`, `mode` / `is_new` / `reason` | — |
| `logout`, `account_delete`, `sync_fail` | аккаунт | `provider` / — / `reason` | — |
| `paywall_view` | закрытый уровень | `li`, `kind`, `via`, `account` | — |
| `purchase_start`, `purchase_restore` | пейволл | `product` | — |
| `offer_view` | предложение курса на первом входе в уровни 20–32, раз на устройство, только сайт (выключено с 05.10.2026, `OFFER.on`) | `li`, `kind`, `via`, `price` | `offer-view` |
| `offer_click` / `offer_skip` | ответ на предложение: «Беру за 249 ₽» / «Пока бесплатно» | `li`, `kind`, `via`, `price` | `offer-click` / — |

`level_start` шлёт только действие игрока. Загрузка страницы, смена плотности потока и режима
экзамена тоже зовут `loadLevel`, и раньше воронка считала их попытками (#181).

Устройство, ОС, браузер, экран, язык, страна и источник перехода Rybbit собирает сам; `perf`
добавляет то, чего он не знает: ступень качества регулятора, кадры и время JS на этой машине.

**Метки кампаний:** `utm_*` из адреса и `source` — метка запуска Mini App
(`tgWebAppStartParam`, `startapp`, `vk_ref`; от неё остаётся ведущий `[A-Za-z0-9_-]+`, как у spark).

**Аккаунт:** после входа `rybbit.identify(<id аккаунта>)` и `ym(…,'setUserID')`, после выхода —
`clearIdentity()`. Визиты одного человека с телефона и компьютера склеиваются.

## Воронка

Основная: `app_open → level_start → level_win`. Rybbit требует, чтобы каждый шаг воронки был
строго позже предыдущего с точностью до секунды (spark, `getFunnel.ts`) — события одного
нажатия цепочку рвут; у этой воронки шаги разделены ездой.

Еженедельно:
1. `app_open` по `platform` и `source` — откуда приходят.
2. Воронка с фильтром по `platform` — где бросают до первой поездки.
3. `level_win` по `li` — какой уровень проходят, на каком застревают; вместе с `level_fail`
   по `code` — что валит.
4. `perf` с `fps < 30` по устройствам — кому нужна оптимизация.

**Предложение курса** (фальшивая дверь, #280, `docs/demand/fake-door.md`): `offer_view → offer_click`.
Оплаты нет — клик означает намерение, а не покупку. Считать по уникальным сессиям: показ стоит
раз на устройство, а повторный визит с очищенным хранилищем дал бы второй показ.

```bash
ch "SELECT event_name, uniqExact(session_id) AS sessions, count() AS n FROM events
    WHERE site_id=3 AND event_name IN ('offer_view','offer_click','offer_skip') GROUP BY event_name"
ch "DESCRIBE events"   # где лежат свойства событий (li, via, price) — для разреза по уровню и источнику
```

## Отладка

`localStorage.setItem('pz_debug','an')` — каждое событие пишется в консоль строкой
`[an] имя {свойства}`, плюс identify и сброс буфера, если скрипт не загрузился за 10 с.

## Проверки

```bash
PW_DIR=/tmp/pw node tools/account-check.mjs      # @an-*: app_open, level_start, level_win, offer_*, без тега — тишина
node tools/sw-check.mjs                          # @dist-sw-api-bypass: /rb/ мимо кэша SW
PW_DIR=/tmp/pw REBUILD=1 node tools/yandex-check.mjs   # @dist-yandex-no-account
```
