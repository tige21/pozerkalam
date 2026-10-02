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

## Включение

1. В дашборде https://analytics.sparkcards.space (логин владельца, регистрация закрыта):
   Add site → домен `pozerkalam.space` → номер сайта. Session replay не включать.
2. `RYBBIT_SITE_ID=<номер>` в `.deploy.env` → `./deploy-pozerkalam.sh`. Смоук проверяет
   `/rb/script.js` и `/rb/site/tracking-config/<номер>` на проде и зеркале.
3. Открыть игру с телефона без VPN и через VPN — в дашборде два визита с разными странами.

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

## Отладка

`localStorage.setItem('pz_debug','an')` — каждое событие пишется в консоль строкой
`[an] имя {свойства}`, плюс identify и сброс буфера, если скрипт не загрузился за 10 с.

## Проверки

```bash
PW_DIR=/tmp/pw node tools/account-check.mjs      # @an-*: app_open, level_start, level_win, без тега — тишина
node tools/sw-check.mjs                          # @dist-sw-api-bypass: /rb/ мимо кэша SW
PW_DIR=/tmp/pw REBUILD=1 node tools/yandex-check.mjs   # @dist-yandex-no-account
```
