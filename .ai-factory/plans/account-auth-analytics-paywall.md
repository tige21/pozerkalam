# Implementation Plan: вход через VK ID и Яндекс ID, гость, аналитика Rybbit, задел под платёжку

Branch: main (git.create_branches=false — ветка не создаётся)
Created: 2026-10-02

## Settings
- Testing: yes — unittest сервиса (stdlib), гейт `tools/account-check.mjs` с замоканным API, `@domain`-сценарии пейволла, расширение `sw-check`/`yandex-check`, юниты и зона мутаций
- Logging: verbose — сервис пишет DEBUG при `LOG_LEVEL=debug`, игра — `[auth]`/`[sync]`/`[an]` в консоль (см. правила логов ниже)
- Docs: yes — обязательный docs-чекпоинт в конце `/aif-implement` (T14)

## Roadmap Linkage
Milestone: "M7 · B2C-freemium"
Rationale: аккаунт — носитель покупки (оплата без аккаунта не переживает смену устройства), пейволл — шов, в который M7 вставит провайдера; аналитика — продолжение M2 (воронка «зашёл → доиграл → вернулся» для решения, что закрывать оплатой).

## Ответ: переносить ли игру на React — нет

Решение уже зафиксировано в ROADMAP (M2b, 2026-09-04) и эта фича его не меняет:

1. **Кадр — это canvas, а не DOM.** Софтверный рендер на Canvas 2D и HUD, который пишет в DOM каждый кадр через `setText` с кэшем. Реконсиляция React в этом цикле — чистая потеря INP/TBT, выигрыша нет.
2. **Инструменты держатся на одном файле.** Зеркало codegraph с паритетом строк, мутатор инлайнового `<script>`, гейты `tools/*.mjs` через `file://`, `learner.js`. Переписать 10 800 строк — это месяцы и потеря всех гейтов разом.
3. **Объём фичи мал.** Вход, синк и пейволл — один раздел скрипта (~400–600 строк) и три оверлея. Они ложатся в существующие `showOv`/`doAct`.

**Где React оправдан:** будущий кабинет автошколы из M8 (ученики, прогресс, домашка). Это отдельное приложение на том же API, рядом с игрой, как лендинг на Astro. Его заводят своим планом, когда дойдёт до M8.

## Что берём из spark и что меняем

| spark (проверено в коде и на серверах) | У нас | Почему так |
|---|---|---|
| Rybbit self-hosted на vdsina (`/opt/rybbit`, backend `127.0.0.1:3001`, дашборд `analytics.sparkcards.space`), сайты spark-staging/spark-prod | **тот же инстанс, новый сайт `pozerkalam`**, дашборд там же | этого и хочет владелец: одна панель, одни принципы |
| тег `<script src=…/api/script.js data-site-id>` прямо с `analytics.sparkcards.space` | тег с **своего домена** `/rb/script.js`, nginx проксирует в Rybbit | скрипт Rybbit берёт хост отправки из своего `src` (`src.split("/script.js")[0]`, проверено в `script.js`): с `/rb/script.js` события идут на `pozerkalam.space/rb/track`. Это `'self'` в CSP и путь через зеркало для VPN-игроков: `analytics.*` резолвится только в РФ-бокс, а именно ради VPN-игроков у нас гео-DNS |
| адаптер `rybbit.ts`: буфер до 20 событий, сброс до 10 с, плоские свойства, `identify`/`clearIdentity` | тот же контракт в `track()` | проверенное поведение |
| VK ID: OAuth 2.1 + PKCE, обмен на сервере `POST id.vk.ru/oauth2/auth`, профиль `POST id.vk.ru/oauth2/user_info` | то же | — |
| Яндекс ID: code flow, `POST oauth.yandex.ru/token` с секретом, профиль `GET login.yandex.ru/info?format=json` (`Authorization: OAuth …`) | то же | — |
| два флоу: клиентский редирект (веб) и серверный `start → callback → status` с поллингом (Mini App) | **один серверный флоу** с двумя возвратами: редирект на `/play/#auth=<sid>` или поллинг | веб, PWA, iframe VK/TG — одна реализация; `code_verifier` и секрет только на сервере; sessionId чеканит сервер |
| поллинг без привязки к инициатору | `claim` требует `nonce`, который знает только вкладка, начавшая вход (на сервере — sha256) | sid светится в адресе возврата; без nonce он бесполезен |
| JWT access 24 ч + refresh 7 сут, ротация, хэш refresh в БД | access 1 ч, refresh **90 сут абсолютно** от входа, ротация с отзывом семейства при повторе | вход — это уход со страницы посреди уровня; заново раз в неделю отпугнёт |
| гость — полноценный режим, auth-choice один раз | гость = «Поехали» на стартовом экране, вход там же (решение владельца 2026-10-02) | #182: до первой поездки и так 3 слоя |
| Go API + Postgres, CI в ghcr | **Python stdlib + SQLite** на vdsina, systemd, как `server/feedback.py` | решение владельца: свой сервис; на сервере нет node, Python 3.11 есть; ноль зависимостей |
| оплата спит за `enablePayments:false`, Robokassa (самозанятый, Робочеки СМЗ) + Stars | пейволл и энтитлменты спят за `PAY_ON=false`, список закрытых уровней пуст | владелец решит позже; провайдер — вероятно Robokassa, как в spark (`docs/monetization-m7.md`) |
| порядок кнопок VK ID → Яндекс ID (149-ФЗ ст. 10.6) | тот же | закон, не вкус |

## Архитектура

```
браузер (pozerkalam.space/play/, iframe VK/TG, PWA)
  ├─ /rb/script.js, /rb/track, /rb/identify ──▶ nginx ──▶ Rybbit backend 127.0.0.1:3001/api/  (vdsina)
  └─ /api/v1/* ─────────────────────────────▶ nginx ──▶ account.py 127.0.0.1:8788  (vdsina, SQLite)
                                                           ├─ id.vk.ru (обмен кода, профиль)      ← напрямую, без прокси
                                                           └─ oauth.yandex.ru / login.yandex.ru    ← напрямую, без прокси
зеркало 194 (гео-DNS для зарубежных и VPN): /rb/ и /api/v1/ ──https──▶ vdsina, X-Real-IP сохраняется
```

**Флоу входа (один для всех поверхностей):**

```
1. POST /api/v1/auth/start {provider:'vk'|'yandex', mode:'redirect'|'poll', nonce}
     сервис: sid (32 Б CSPRNG), state (32 Б), для VK — PKCE verifier/challenge S256;
     строка oauth_pending {sid, state, provider, mode, verifier, sha256(nonce), created}
     ← {authUrl, sid}
2. redirect: location.assign(authUrl)    poll: window.open(authUrl) → нет окна → ссылка «открыть вход»
3. провайдер → GET /api/v1/auth/callback?code&state[&device_id]   (единственный redirect_uri в кабинетах)
     сервис: строка по state → обмен кода → профиль → upsert account+identity
             → строка status='authorized', account_id (токенов в БД нет; повторный callback — no-op)
     redirect: 302 /play/#auth=<sid>      poll: страница «Готово, вернись в игру»
4. POST /api/v1/auth/claim {sid, nonce}  (poll: каждые 2 с, до 5 мин, и сразу на visibilitychange)
     pending → {status:'pending'};  authorized + nonce сошёлся → строка удаляется,
     выдаются access JWT + refresh → {account, access, refresh, entitlements}
```

Режим выбирается так: `redirect` — только окно верхнего уровня не в standalone PWA; иначе `poll`. В iframe переход на `id.vk.ru` запрещён площадкой. В iOS-PWA внешний адрес открывается в отдельном листе Safari со своим `sessionStorage`, и `nonce` после возврата не нашёлся бы.

## Решения, которые легко сломать при реализации

1. **Адрес API абсолютный — `https://pozerkalam.space/api/v1`**, как `FB_URL`. Гейты открывают игру через `file://`, и `page.route` мокает ровно этот адрес. CORS не нужен и не включается: вход работает только на своём домене. В билде ЯИ и на старом зеркале `194.5.65.182` (без домена) интерфейса входа нет.
2. **Интерфейс входа появляется только по `window.AUTH_PROVIDERS`**, который вставляет `deploy-pozerkalam.sh` из `.deploy.env`. Нет переменной — нет кнопок: локально, в гейтах, в билде ЯИ, на старом зеркале. Это принцип spark: «не задано — кнопка скрыта». Так же устроен `RYBBIT_SITE_ID`: нет ID — нет тега.
3. **Ключи хранилища — с префиксом `pz_`, никогда `trainer_`.** Адаптер ЯИ (`build-yandex.sh:44–47`) зеркалит в облако каждый ключ `trainer_*`, и токен уехал бы в облако площадки.
4. **SW обязан пропускать `/api/` и `/rb/`.** Сейчас `sw.js` отдаёт любой same-origin GET, кроме страницы, по схеме cache-first. `GET /api/v1/me` закэшировался бы навсегда вместе с покупками. Правило — первой строкой обработчика `fetch`; гейт `sw-check`.
5. **`loadLevel` остаётся сырым.** Его зовут 13 мест, включая гейты (`units.js`, `cabin-check`, `look-check`, `perf-bench`), загрузку на старте, редактор и смену режима экзамена. Замок ставится в `openLevel(i, via)` на пяти пользовательских входах: карточка выбора (`index.html:9000`), `train:N` (9015), `next` (9041), цифры (9269), `KeyN` (9308). Замок внутри `loadLevel` уронил бы все гейты в день, когда владелец закроет первый уровень.
6. **`level_start` уходит из `loadLevel`** (`index.html:6138`). Там он срабатывает на загрузке страницы, при смене потока (`cycleTraffic`) и режима экзамена (`setExamMode`) — это и есть дефект из #181. Событие шлют `openLevel`, `doAct('start')` и `again`, с номером уровня и источником.
7. **Слияние прогресса делает только сервер.** Клиент шлёт локальный `trainer_progress` целиком (PUT), сервер сливает с сохранённым и отдаёт итог, клиент кладёт итог в localStorage. Перенос гостевого прогресса при входе — это тот же PUT. Правило идемпотентно: числа с именем `best*` берутся по min, остальные числа по max, массивы (`routes`) поэлементно по max, объекты рекурсивно, `null` значит «нет значения». Цена: прохождения с двух устройств не суммируются (3 на телефоне и 2 на ПК дают 3). Готовность считает только `clean>0` и `bestErr`, поэтому на неё это не влияет. Сумма потребовала бы счётчиков по устройствам — это не нужно.
8. **Минимум данных.** VK — без `scope` (базовый профиль: id, имя), Яндекс — только `login:info`. Хранятся `provider_user_id` и отображаемое имя. Email и аватар не нужны: меньше согласий и меньше обязательств по 152-ФЗ.
9. **Выход оставляет локальный прогресс на устройстве.** Он становится гостевым. Удаление аккаунта (`DELETE /api/v1/me`) стирает аккаунт, связки, сессии и прогресс на сервере. Это право по 152-ФЗ, и кнопка нужна.
10. **Один аккаунт на одну связку.** Вход через VK, а потом через Яндекс даёт два аккаунта. Связывание провайдеров в этот план не входит, на доске это бэклог.
11. **Защита пейволла — «от честных».** Код всех уровней лежит в странице. Сервер честно хранит покупку, а клиентский замок обходится через DevTools. Для B2C это приемлемо, как в `docs/monetization-m7.md`.

## Правила логов (verbose)

- **Сервис:** `logging` с `LOG_LEVEL` из env (по умолчанию `info`; `debug` при выкатке первые недели). INFO — вход начат/завершён (провайдер, режим, новый ли аккаунт, мс обмена), refresh, logout, удаление, grant/revoke, синк (размер, число уровней до/после). WARN — несошедшийся state/nonce, повтор refresh (отзыв семейства), ответ провайдера не 2xx (код и `error`, без тела), лимит частоты. DEBUG — тайминги шагов, размеры ответов. **Никогда не логировать** code, verifier, nonce, access/refresh, client_secret. Есть хелпер `mask()`, sid и id аккаунта — только первые 6 символов. При старте одна строка: `CONFIG: vk=<bool> yandex=<bool> db=<path> callback=<url>` и WARN, если Яндекс настроен наполовину (как в spark).
- **Игра:** `console.info('[auth] …')` на переходах (старт, claim ok, refresh, выход, удаление), `console.warn('[auth] …')` на отказах с причиной. `[sync]` — PUT/GET с числом уровней. `[an] …` — каждое событие аналитики, только при `localStorage.pz_debug` содержащем `an`, иначе тишина. `console.error` не используется: `crash-check` считает ошибки консоли.

## Предусловия владельца (не задачи плана, руками в кабинетах)

| # | Что | Где | Результат |
|---|---|---|---|
| P1 | Сайт `pozerkalam` в Rybbit (домен `pozerkalam.space`), replay выключен | https://analytics.sparkcards.space — тот же логин, что для spark | `RYBBIT_SITE_ID` → `.deploy.env` |
| P2 | Приложение VK ID, тип Web, доверенный redirect `https://pozerkalam.space/api/v1/auth/callback` | https://id.vk.com/about/business (тот же кабинет, что для spark) | `VK_CLIENT_ID` → env сервиса |
| P3 | OAuth-приложение Яндекса, «Веб-сервисы», тот же redirect URI, доступ `login:info` | https://oauth.yandex.ru/ | `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` → env сервиса |
| P4 | Политика конфиденциальности на `/privacy/`: аккаунт, связка с VK/Яндексом, прогресс, Rybbit (localStorage-идентификатор), Метрика | доска #180 | без неё вход на проде не включается (T15) |
| P5 | Цена и список платных уровней | решение по `docs/monetization-m7.md` | задача M7 (#31), не этот план |

P1 не ждёт P2–P4: аналитика выкатывается первой (T15, шаг 1).

## Tasks

### Фаза 1 · Аналитика через Rybbit spark

- [x] **T1. Прокси `/rb/` на проде и зеркале, обход SW для `/api/` и `/rb/`**
  Файлы: `server/nginx-rybbit.conf` (новый, сниппет `pozerkalam-rybbit.conf`), `server/nginx-rybbit-mirror.conf` (новый), `deploy-pozerkalam.sh`, `sw.js`, `tools/sw-check.mjs`.
  - Прод: `location /rb/ { include snippets/pozerkalam-headers.conf; set_real_ip_from 194.5.65.182; real_ip_header X-Real-IP; proxy_pass http://127.0.0.1:3001/api/; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header Host analytics.sparkcards.space; client_max_body_size 64k; }`. Тело ограничено: replay выключен, а трек весит сотни байт. Строку `include` обязательно повторить, это ловушка nginx из CLAUDE.md.
  - Зеркало: `proxy_pass https://83.217.215.66/rb/; proxy_set_header Host pozerkalam.space; proxy_ssl_server_name on; proxy_set_header X-Real-IP $remote_addr;`. Шаблон — `nginx-feedback-mirror.conf`.
  - Деплой раскладывает сниппеты на оба бокса и вставляет `include` в vhost идемпотентно, тем же `grep -q || sed`, что для отзывов.
  - `sw.js`: первой строкой `fetch` — `if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rb/')) return;`. `sw-check.mjs`: новая проверка `@dist-sw-api-bypass` для обеих форм путей: GET `/api/v1/me` и `/rb/script.js` не попадают в кэш.
  - Логи: смоук печатает `    /rb/script.js -> 200 (N байт)` для прода и зеркала.
  - Проверка руками один раз: тестовое событие с телефона без VPN и с VPN (через зеркало) появляется в дашборде с правильной страной. Если страна у всех одна, Rybbit не читает `X-Real-IP` за прокси: смотреть, какой заголовок он берёт (`X-Forwarded-For`), и выставить его.

- [x] **T2. Слой аналитики в игре: `track(name, props)` → Метрика + Rybbit, каталог событий** (зависит от T1 только при выкатке)
  Файл: `index.html`, раздел рядом с `track` (сейчас `index.html:5901`).
  - `track(name, props)`: плоские свойства, `null`/`undefined` выбрасываются, вложенные значения — `JSON.stringify` и обрезка до 128 символов. Rybbit — `window.rybbit.event(name, props)`. До загрузки скрипта события копятся в буфере до 20 и сбрасываются при появлении `window.rybbit`, не дольше 10 с. Это контракт `rybbit.ts` из spark. Метрика — `ym(ID,'reachGoal', METRIKA_GOAL[name]||name, props)`: таблица `METRIKA_GOAL` сохраняет старые имена целей (`level-start`, `win`, `level-fail`, `exam-pass`, `exam-fail`, `demo-start`, `feedback-open:*`, `feedback-sent`), иначе настроенные в Метрике цели обнулятся.
  - Каталог (snake_case, как в spark): `app_open {platform: web|pwa|vk|tg|ya, framed, mob, lang, runs, account: 0|1, provider, source, utm_source…utm_term}`; `level_start {li, kind: yard|drill|city|exam, via: start|pick|next|digit|train|again, exam_mode}`; `level_win {li, t, hits, clean, err_cm}`; `level_fail {li, code}`; `exam_pass`/`exam_fail {route, mode, score}` (две цели — у Метрики они уже настроены раздельно); `demo_start {li}`; `feedback_open {src}`/`feedback_sent {kind}`; `perf {q, fps, js, dpr, cores, mem}` — один раз за сессию через 20 с езды; `auth_*`, `paywall_*` — в фазах 3–4. `li` — номер уровня с 1, как на карточке.
  - Платформа: `vk` — по `vk_*` в `location.search` (как детект VKWebAppInit, `index.html:5928`); `tg` — по `tgWebAppData` в hash; `pwa` — `matchMedia('(display-mode: standalone)')`; `ya` — флаг, который ставит `build-yandex.sh` (там Rybbit нет, но Метрика тоже не стоит, поэтому это задел на будущее).
  - **Фикс #181:** убрать `track('level-start')` из `loadLevel` (`index.html:6138`) и слать `level_start` из `doAct('start')`, `again` и `openLevel` (T12 подменит прямые вызовы `loadLevel` на пяти входах; до T12 вызов ставится прямо в эти пять мест).
  - `anIdentify(id)` / `anClear()` — обёртки над `rybbit.identify` / `clearIdentity` и `ym(ID,'setUserID',id)`, их зовёт фаза 3.
  - Логи: `[an] name {props}` под `pz_debug=an`.
  - Сделано попутно: `openLevel` введён здесь (без замка — его добавит T12), а бриф экзамена при выборе с карточки больше не закрывается сразу (`@exam-brief-on-pick`). Гейт `tools/account-check.mjs` заведён в T2 и растёт до T13; области сценариев — `an/` и `acct/` (не `account/`).

- [x] **T3. Деплой: тег Rybbit по `RYBBIT_SITE_ID`, смоук, гарантия «не в билде ЯИ»** (зависит от T1, T2)
  Файлы: `deploy-pozerkalam.sh`, `tools/yandex-check.mjs`, `specs/features/dist/yandex.feature`.
  - В python-блок вставки Метрики (`deploy-pozerkalam.sh:92–112`): при непустом `RYBBIT_SITE_ID` добавить `<script defer src="/rb/script.js" data-site-id="%s"></script>` перед `</head>`. Пусто — тега нет, и в лог деплоя пишется строка `Rybbit: выключен (RYBBIT_SITE_ID пуст)`.
  - CSP не меняется: скрипт и запросы идут на `'self'`. Проверить, что `csp_check` по-прежнему зелёный (внешний скрипт с `src` хэш не требует).
  - Смоук прода и зеркала: `/rb/script.js` отвечает 200 и `Content-Type: application/javascript`; `GET /rb/site/tracking-config/<id>` отвечает 200.
  - `yandex-check.mjs`: новая проверка `@dist-yandex-no-account` — в `build/yandex/index.html` нет `/rb/script.js`, `AUTH_PROVIDERS` и `METRIKA_ID`.
  - Логи: строка деплоя `==> аналитика: Rybbit site <id>` или `выключен`.

### Фаза 2 · Сервис аккаунтов

- [x] **T4. `server/account.py`: каркас, схема SQLite, JWT, сессии, `/me`, CLI**
  Файлы: `server/account.py` (новый), `server/account.env.example` (новый, без секретов).
  - `ThreadingHTTPServer` на `127.0.0.1:${ACCT_PORT:-8788}`, роутинг по `path` и `method`, JSON in/out, тело не больше 128 КБ. Шаблон — `server/feedback.py`.
  - SQLite в `$STATE_DIRECTORY/account.db` (systemd `StateDirectory`; при `ProtectSystem=strict` писать больше некуда), `PRAGMA journal_mode=WAL; foreign_keys=ON`, одно соединение на поток.
    ```
    accounts(id TEXT PK, name TEXT, created_at INT, last_seen_at INT)
    identities(provider TEXT, provider_user_id TEXT, account_id TEXT REFERENCES accounts ON DELETE CASCADE, created_at INT, PRIMARY KEY(provider, provider_user_id))
    sessions(id TEXT PK, account_id TEXT REFERENCES accounts ON DELETE CASCADE, family TEXT, refresh_hash TEXT UNIQUE, created_at INT, expires_at INT, rotated_at INT, revoked_at INT)
    oauth_pending(sid TEXT PK, state TEXT UNIQUE, provider TEXT, mode TEXT, verifier TEXT, nonce_hash TEXT, created_at INT, status TEXT, account_id TEXT, is_new INT, error TEXT)
    progress(account_id TEXT PK REFERENCES accounts ON DELETE CASCADE, data TEXT, rev INT, updated_at INT)
    entitlements(account_id TEXT REFERENCES accounts ON DELETE CASCADE, product TEXT, source TEXT, ref TEXT, granted_at INT, expires_at INT, revoked_at INT, PRIMARY KEY(account_id, product, ref))
    schema_version(v INT)
    ```
    Миграции — список функций по `schema_version`. Удаление аккаунта каскадом стирает всё, кроме `entitlements` с `source != 'manual'`: их строка переписывается на `account_id='deleted:<hash>'`, потому что запись о платеже нужна для учёта.
  - JWT HS256 на `hmac` + `base64url`, без PyJWT: `{sub, iat, exp: +3600, v:1}`, секрет `JWT_SECRET` не короче 32 байт, иначе сервис не стартует. Refresh — 32 байта CSPRNG, в БД `sha256`. `expires_at` фиксируется при входе (90 сут) и при ротации не сдвигается. Ротация: старая строка получает `rotated_at`, новая наследует `family`. Предъявление уже ротированного refresh отзывает всю семью (WARN `refresh reuse family=…`).
  - Эндпоинты: `POST /auth/refresh {refresh}`, `POST /auth/logout {refresh}`, `GET /me` (Bearer) → `{account:{id,name,providers[]}, entitlements:[{product, expires_at}]}`, `DELETE /me` (Bearer), `GET /health` → `{ok, vk, yandex}`.
  - Лимиты в процессе (по `X-Real-IP`): скользящее окно, `auth/start` — 10 за 10 мин, `claim` — 200 за 10 мин (поллинг), остальное — 120 в минуту. Превышение → 429 `{error:'rate'}`.
  - CLI в том же файле: `python3 account.py grant <account_id> <product> [--days N] [--ref X]`, `revoke <account_id> <product>`, `stats` (аккаунты по провайдерам, активные за 7/30 дней, сессии, гранты). Владельцу это нужно сразу: тестеры, пилоты автошкол, ручные возвраты.
  - Логи — по «Правилам логов»; строка `CONFIG:` при старте.

- [x] **T5. Флоу входа VK ID и Яндекс ID: `start` / `callback` / `claim`** (зависит от T4)
  Файл: `server/account.py`.
  - Клиенты провайдеров с базовыми адресами из env (`VK_BASE=https://id.vk.ru`, `YA_OAUTH_BASE=https://oauth.yandex.ru`, `YA_LOGIN_BASE=https://login.yandex.ru`) — так тест подставит заглушку. Таймаут 10 с. `urllib.request` **без прокси** (`ProxyHandler({})`): сервис не должен унаследовать `HTTPS_PROXY` соседа-приёмника отзывов.
    - VK: authorize `{VK_BASE}/authorize?response_type=code&client_id&redirect_uri&state&code_challenge&code_challenge_method=S256`. Обмен — `POST {VK_BASE}/oauth2/auth` (`grant_type=authorization_code, code, code_verifier, device_id, client_id, redirect_uri, state`), профиль — `POST {VK_BASE}/oauth2/user_info` (`access_token, client_id`) → `user.user_id` (число или строка — как `FlexID` в spark), `first_name`, `last_name`.
    - Яндекс: authorize `{YA_OAUTH_BASE}/authorize?response_type=code&client_id&redirect_uri&state&scope=login:info&force_confirm=no`. Обмен — `POST {YA_OAUTH_BASE}/token` (`grant_type, code, client_id, client_secret, redirect_uri`), профиль — `GET {YA_LOGIN_BASE}/info?format=json` с `Authorization: OAuth <token>` → `id`, `display_name` или `real_name` или `login`.
  - `POST /auth/start {provider, mode, nonce}`: провайдер не настроен → 400 `{error:'provider'}`; `nonce` — base64url длиной 32–128 символов. Возвращает `{authUrl, sid}`. `redirect_uri` = `OAUTH_CALLBACK_URL`, один на оба провайдера.
  - `GET /auth/callback`: строка по `state`; не найдена или старше 10 мин → HTML «Ссылка входа устарела, начни вход заново в игре» с кодом 400. `error=access_denied` → `status='failed', error='denied'`. Иначе обмен, профиль, upsert (`identities` → `accounts`, имя обновляется при каждом входе), `status='authorized'`. Повторный callback с тем же state — no-op. Ответ: `mode=redirect` → 302 на `/play/#auth=<sid>`; `mode=poll` → короткая HTML-страница без скриптов: «Вход выполнен. Закрой эту вкладку и вернись в игру». Инлайн-скрипт там зарезал бы CSP.
  - `POST /auth/claim {sid, nonce}`: нет строки → 404; `sha256(nonce)` не сошёлся → 403 и WARN; `pending` → `{status:'pending'}`; `failed` → строка удаляется, `{status:'failed', reason}`; `authorized` → в одной транзакции строка удаляется и выдаются токены → `{status:'ok', account, access, refresh, entitlements, is_new}`. Повторный claim даёт 404 — токены выдаются ровно один раз.
  - Уборка: строки `oauth_pending` старше 10 мин удаляет фоновый тред раз в 5 мин, сессии с истёкшим `expires_at` — раз в сутки.

- [x] **T6. Синк прогресса `GET/PUT /progress` со слиянием на сервере** (зависит от T4)
  Файл: `server/account.py`.
  - `GET /progress` (Bearer) → `{data, rev}`. `PUT /progress {data}`: проверка — объект, не больше 64 КБ, не больше 200 уровней. Ответ — `merge(stored, incoming)` с правилом из «Решений» п. 7, `rev+1`, тело `{data, rev}`.
  - `merge` — чистая функция без I/O, рядом с ней докстринг с правилом и причиной, почему max, а не сумма.
  - Логи: INFO `sync acct=ab12cd levels 12→14 bytes 3.1k rev 7`.

- [x] **T7. unittest сервиса** (зависит от T4–T6)
  Файл: `server/test_account.py` (новый). Запуск: `python3 -m unittest server/test_account.py` из корня, без сети и без зависимостей.
  - Заглушка провайдеров — локальный `ThreadingHTTPServer` на свободном порту, который отвечает как VK и Яндекс и проверяет `code_verifier` против `code_challenge`. Сервис поднимается в треде на временной БД.
  - Случаи: полный путь VK и Яндекс (start → callback → claim → `/me`); неверный nonce → 403; повторный claim → 404; повторный callback — no-op; просроченная строка; `access_denied` → `failed`; провайдер вернул 400 → `failed` и сервис жив; refresh-ротация; повтор старого refresh отзывает семью; logout; `DELETE /me` стирает связки, прогресс и сессии, а платный грант сохраняется обезличенным; `merge` (min для `best*`, max для счётчиков, поэлементно для `routes`, идемпотентность `merge(a, merge(a, b)) == merge(a, b)`, мусор на входе); лимит 429; Bearer с чужой подписью и с истёкшим `exp` → 401; `grant`/`revoke` из CLI видны в `/me`.

- [x] **T8. Инфраструктура: systemd, nginx прода и зеркала, env, бэкап, деплой и смоук** (зависит от T4–T7)
  Файлы: `server/pozerkalam-account.service`, `server/nginx-account.conf`, `server/nginx-account-mirror.conf` (новые), `deploy-pozerkalam.sh`.
  - Unit — копия `pozerkalam-feedback.service` с `StateDirectory=pozerkalam-account`, `EnvironmentFile=/etc/pozerkalam-account.env` и `ExecStart=/usr/bin/python3 /opt/pozerkalam-account/account.py`.
  - nginx прода: `location /api/v1/ { include snippets/pozerkalam-headers.conf; set_real_ip_from 194.5.65.182; real_ip_header X-Real-IP; limit_req zone=acct burst=20 nodelay; client_max_body_size 128k; proxy_pass http://127.0.0.1:8788/; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 25s; }`. Зона `acct` (30r/s на IP — поллинг идёт раз в 2 с, грубый барьер от флуда) — в `conf.d/pozerkalam-limits.conf`, рядом с `fb`. CORS нет. Зеркало — `proxy_pass https://83.217.215.66/api/v1/` по шаблону отзывов.
  - Env на боксе: `JWT_SECRET`, `VK_CLIENT_ID`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, `OAUTH_CALLBACK_URL=https://pozerkalam.space/api/v1/auth/callback`, `LOG_LEVEL`. Деплой **не перезаписывает** существующий `/etc/pozerkalam-account.env`. Если файла нет, создаёт его с новым `JWT_SECRET` (`openssl rand`) и пустыми ключами провайдеров, `chmod 600`. В отличие от отзывов, ключи кладутся на бокс руками один раз — секрет Яндекса не живёт в `.deploy.env` на ноутбуке.
  - Бэкап: `/etc/cron.daily/pozerkalam-account-backup` — `sqlite3 account.db ".backup /root/backups/pz-account-$(date +%F).db"`, хранить 14 дней. Если `sqlite3` CLI нет — через `python3 -c "import sqlite3; …backup()"`.
  - Смоук прода и зеркала: `GET /api/v1/health` → `{"ok":true,…}`; `POST /api/v1/auth/start {provider:'none'}` → 400; `GET /play/` по-прежнему проходит `csp_wait`. После рестарта в лог деплоя печатается строка `CONFIG:` из journal.
  - Деплой не сломан, если ключи провайдеров пусты: сервис стартует, `/health` честно отвечает `vk:false, yandex:false`.

### Фаза 3 · Вход и гость в игре

- [x] **T9. Модуль «аккаунт» в игре: токены, `apiFetch`, запуск входа, возврат, выход** (зависит от T5)
  Файл: `index.html`, новый раздел `/* ---------- аккаунт ---------- */` после раздела обратной связи (тот же стиль: абсолютный адрес и причина в комментарии).
  - `const API='https://pozerkalam.space/api/v1'`; `AUTH_ON = Array.isArray(window.AUTH_PROVIDERS) && window.AUTH_PROVIDERS.length>0`.
  - Состояние `acct = {id, name, provider, ent:[]}` или `null`. Хранилище `pz_auth = {refresh, acct}`, access — только в памяти. Все чтения и записи `localStorage` — в `try/catch`, как везде в файле.
  - `apiFetch(path, opts)`: Bearer из памяти; нет access или ответ 401 → один `refresh` и повтор. Refresh отвергнут → выход с тостом «Сессия истекла — войди снова». Сеть недоступна → тихий отказ: игра работает дальше гостем с кэшем `acct`.
  - `authStart(provider)`: `nonce` = 32 байта `crypto.getRandomValues` в base64url → `sessionStorage.pz_nonce`; в `sessionStorage.pz_ret` кладётся `{li: game.li}`. Режим — по правилу из «Архитектуры». `redirect` → `location.assign(authUrl)`. `poll` → `window.open(authUrl,'_blank')`; если вернулся `null`, оверлей со ссылкой «Открыть вход» (`<a target="_blank" rel="noopener">`), затем поллинг `claim` раз в 2 с, до 5 мин и сразу на `visibilitychange→visible`. Кнопка «Отмена» останавливает поллинг.
  - Возврат: в самом начале скрипта, до `loadLevel(0)`, читается `location.hash` вида `#auth=<sid>`. Hash сразу убирается через `history.replaceState`, затем `claim` с nonce из `sessionStorage`. Успех → `acct`, тост «Ты вошёл как {имя}», уровень из `pz_ret` (через `openLevel` после T12). Отказ → тост с причиной: `denied` → «Вход отменён», устаревшая ссылка → «Ссылка входа устарела — попробуй ещё раз».
  - `authLogout()` → `POST /auth/logout`, очистка `pz_auth`, `anClear()`; прогресс на устройстве остаётся. `authDelete()` → подтверждение «Удалить аккаунт и прогресс на сервере? На этом устройстве прогресс останется» → `DELETE /me` → как выход.
  - На старте при `pz_auth`: фоново `GET /me` — обновить имя и покупки; не ждать ответа перед первым кадром.
  - События: `auth_start {provider, mode}`, `auth_ok {provider, is_new}`, `auth_fail {provider, reason}`, `logout`, `account_delete`.
  - Логи — по «Правилам логов».

- [x] **T10. Интерфейс: стартовый экран, выбор уровня, ≡-меню, предложение после первой победы** (зависит от T9)
  Файл: `index.html` (`startHTML`, `levelPickHTML`, `buildMenu`, `winHTML`, CSS).
  - Перед правкой текстов — скилл `ru-copy-deslop` и `.ai-factory/references/pozerkalam-voice.md`. Короткий императив, второе лицо, без противопоставления «не X, а Y».
  - Стартовый экран (обе раскладки, `MOB` и десктоп), только при `AUTH_ON`: под «Поехали» строка «Сохрани прогресс на всех устройствах» и две кнопки в порядке **VK ID → Яндекс ID** (149-ФЗ). Под ними мелко: «Входя, ты принимаешь <a>политику конфиденциальности</a>» (`/privacy/`, подчёркнутая ссылка — правило лендинга). Гость — это просто «Поехали», отдельной кнопки «как гость» нет. Вошедшему — строка «Аккаунт: {имя} (VK ID) · Выйти · Удалить аккаунт»: глагол «вошёл» требует рода, а пол игрока неизвестен.
  - Выбор уровня: в шапке над `readinessHTML()` та же строка (имя и «Выйти»), у гостя — «Войти, чтобы прогресс не потерялся».
  - ≡-меню (тач): раздел «Аккаунт» — «Войти через VK ID», «Войти через Яндекс ID» или «Выйти», «Удалить аккаунт». Пункт называет действие, не состояние — правило меню.
  - Предложение после победы: один раз, на экране первой победы гостя (`pz_nudge='1'` после показа), одна строка и две кнопки под результатами. Повторно не показывается.
  - Имена из провайдера идут в разметку только через `textContent` или `esc()` — это ввод третьей стороны, как имена площадок.
  - Компактная раскладка (`max-width:600px`, `max-height:420px`) не ломается: кнопки входа в один ряд, «Поехали» остаётся над сгибом. Проверка `touch-check.mjs`.

- [x] **T11. Синк прогресса и `identify` в аналитике** (зависит от T6, T9)
  Файл: `index.html`.
  - После успешного `claim` → `PUT /progress` с локальным `trainer_progress` → итог в localStorage (`progMigrated` не сбрасывать) → `anIdentify(acct.id)`. Это и есть перенос гостевого прогресса.
  - На старте при `pz_auth` → `PUT /progress` с локальным (одна операция вместо GET+PUT, слияние на сервере).
  - После `progAdd`/`progExam` (`win()`, `examPass`/`examFail`) → отложенный PUT через 5 с, перезапуск таймера при новом событии. На `visibilitychange→hidden` с несохранёнными изменениями — `fetch(..., {keepalive:true})` с Bearer. `sendBeacon` не годится: он не умеет `Authorization`.
  - Неудача синка не трогает локальный прогресс; повтор — при следующем событии. WARN `[sync] …`, событие `sync_fail {reason}` не чаще раза за сессию.
  - После слияния перерисовать то, что зависит от прогресса, если оно на экране: `readinessHTML`, карточки выбора уровня.

### Фаза 4 · Задел под платёжку

- [x] **T12. Замки уровней и энтитлменты: `PAYWALL`, `entitled`, `levelLocked`, `openLevel`, пейволл** (зависит от T9)
  Файл: `index.html`.
  - `const PAYWALL = {product:'course', levels:[]}` — пусто: сегодня ничего не закрыто, список заполнит M7. `const PAY_ON = false` — кнопки «Купить» нет, пока не подключён провайдер. `window.PAYWALL_FORCE` (массив индексов) — только для гейтов.
  - `entitled(product)` — `acct && acct.ent.some(e => e.product===product && (!e.expires_at || e.expires_at*1000 > Date.now()))`. Кэш `acct.ent` живёт в `pz_auth` и обновляется по `/me`.
  - `levelLocked(i)` — `(PAYWALL_FORCE || PAYWALL.levels).includes(i) && !entitled(PAYWALL.product)`. Свои площадки (`custom`) и первый уровень не закрываются никогда: на старте грузится `loadLevel(0)`.
  - `openLevel(i, via)`: закрыт → `showOv(paywallHTML(i))` и `paywall_view {li, via}`; открыт → `loadLevel(i)`, `hideOv()`, `level_start` (T2). Заменить прямые вызовы на пяти входах (см. «Решения» п. 5). `loadLevel` не трогать.
  - Карточка выбора уровня: замок 🔒 и класс `.locked` (цвет из той же палитры), подпись «в курсе». Код в `levelPickHTML` рядом с `weakSet`.
  - `paywallHTML(i)`: название уровня, одна строка «что в курсе» (заполнит M7), цена из `PAY.price` (нет цены — «Курс скоро откроется»). Гость видит «Войти, чтобы купить» (VK ID → Яндекс ID), вошедший при `PAY_ON` — «Купить» (`purchase_start`). Всем — «Восстановить покупку» (`GET /me`, затем повтор `openLevel`) и «Назад» (`doAct('pick')`).
  - Шов провайдера — комментарий-контракт над `paywallHTML`: `payStart(product)` → провайдер → вебхук на сервере → `grant` → клиент получает покупку через `/me`. Провайдер не пишется (P5, #31).

### Фаза 5 · Проверки, документация, выкатка

- [ ] **T13. Гейты: `account-check.mjs`, сценарии, юниты, мутации, чек-лист** (зависит от T9–T12)
  Файлы: `tools/account-check.mjs` (новый), `specs/features/account/account.feature`, `specs/features/account/paywall.feature` (новые), `tools/steps/domain.js`, `tools/units.js`, `tools/mutation-zone.json`, `docs/qa-checklist.md` (генерат).
  - `account-check.mjs` (playwright-core из `PW_DIR`, каркас `crash-check.mjs`; API мокает `page.route('https://pozerkalam.space/api/v1/**')`, Rybbit — `window.rybbit` с журналом вызовов). Проверки с кодами в имени:
    - `@acct-off-by-default` — без `AUTH_PROVIDERS` кнопок входа нет и ни одного запроса к API;
    - `@acct-buttons-order` — с провайдерами кнопки есть, порядок VK ID → Яндекс ID, ссылка на `/privacy/`;
    - `@acct-redirect-return` — `#auth=<sid>` с nonce в `sessionStorage`: claim, hash убран, строка «Ты вошёл как…»;
    - `@acct-poll-flow` — в iframe: `window.open`, поллинг, `pending` → `ok`;
    - `@acct-refresh-on-401` — один 401 → refresh → повтор;
    - `@acct-logout-keeps-progress` — выход чистит `pz_auth`, прогресс на месте;
    - `@acct-sync-after-win` — победа даёт ровно один PUT через 5 с, итог сервера лёг в localStorage;
    - `@acct-guest-merge` — гостевой прогресс уходит в первый PUT после входа;
    - `@acct-no-trainer-keys` — после входа нет ключей `trainer_*` с токеном;
    - `@acct-identify` — `rybbit.identify` после входа, `clearIdentity` после выхода;
    - `@an-level-start-once` — загрузка страницы, смена потока и режима экзамена не шлют `level_start`, «Поехали» шлёт ровно один с `li` и `via`.
  - `paywall.feature` (`@domain`, исполняется `gherkin-run.mjs`): закрытый уровень без покупки открывает пейволл; с покупкой — уровень; первый уровень и свои площадки не закрываются; истёкшая покупка не открывает. Шаги — в `tools/steps/domain.js` через `PAYWALL_FORCE` и подложенный `acct`.
  - `units.js`: утверждения на `levelLocked`/`entitled` с числами. `mutation-zone.json`: добавить `levelLocked`, `entitled`, `openLevel`, `track` — прогнать `mutation.mjs --only` на каждую; храповик не опускается.
  - `gherkin-check.mjs` зелёный (каждый код ↔ проверка); `qa-checklist.mjs` пересобран.
  - Регрессия: `crash-check`, `touch-check`, `sw-check`, `yandex-check`, `gherkin-run`, `unit-check`, демо-регрессия (ноль таймаутов по `DEMOS`) — зелёные.

- [ ] **T14. Документация** (зависит от T1–T13)
  Файлы: `docs/ACCOUNT.md`, `docs/ANALYTICS.md` (новые), `CLAUDE.md`, `docs/monetization-m7.md`, `.ai-factory/ROADMAP.md`.
  - `ACCOUNT.md`: схема флоу, таблица env (где живёт, секрет или нет), регистрация в кабинетах VK и Яндекса (P2–P3), CLI `grant/revoke/stats`, бэкап и восстановление, разбор неисправностей по образцу spark (`redirect_uri mismatch`, `invalid_client`, «вход не завершается в iframe», устаревшая ссылка).
  - `ANALYTICS.md`: сайт Rybbit, прокси `/rb/`, каталог событий со свойствами, таблица `METRIKA_GOAL`, воронка `app_open → level_start → level_win` (шаги разнесены во времени — правило funnel SQL Rybbit из spark), еженедельное чтение, как смотреть устройства.
  - `CLAUDE.md`: секция «Аккаунт, аналитика, пейволл» — правила из «Решений» (ключи `pz_`, абсолютный API, SW-обход, `openLevel` против `loadLevel`, слияние на сервере), новые команды гейтов, новые `localStorage`-ключи в общий список.
  - `monetization-m7.md`: шов готов, что осталось M7 (провайдер — вероятно Robokassa с Робочеками СМЗ, как в spark; вебхук → `grant`).

- [ ] **T15. Выкатка: аналитика сразу, вход — после предусловий** (зависит от T13, T14, P1–P4)
  - Шаг 1 (после P1): `RYBBIT_SITE_ID` в `.deploy.env` → `./deploy-pozerkalam.sh`. Проверка: событие `app_open` с телефона (РФ) и через VPN (зеркало) видно в дашборде, страна верная.
  - Шаг 2 (сразу, вход выключен): сервис уезжает с пустым `AUTH_PROVIDERS`. Ключи провайдеров кладутся на бокс руками, рестарт, `/health` → `vk:true, yandex:true`.
  - Шаг 3 (после P2–P4): `AUTH_PROVIDERS="vk,yandex"` в `.deploy.env` → деплой. Живой вход владельцем через VK ID и Яндекс ID на телефоне и десктопе, с VPN и без. `stats` показывает аккаунты. Прогресс телефона виден на ПК.
  - Перед пушем — проверка коммитов на упоминания AI (глобальное правило): `git log --format='%B' origin/main..HEAD | grep -in 'claude\|anthropic\|generated with'` должен быть пуст.

## Commit Plan

| После | Коммит |
|---|---|
| T1–T3 | `feat(analytics): Rybbit через свой домен, события с номером уровня` |
| T4–T8 | `feat(account): сервис входа VK ID и Яндекс ID, синк прогресса` |
| T9–T11 | `feat(account): вход на стартовом экране, гость, синк прогресса` |
| T12 | `feat(paywall): замки уровней и покупки аккаунта` |
| T13–T14 | `test(account): гейт входа и пейволла, сценарии; docs: аккаунт и аналитика` |

Без трейлеров `Co-Authored-By`/`Generated with` — правило владельца главнее харнесса.

## Доска Vikunja

Одна задача на фазу. Фазы 2→3→4 связаны `blocked`. Выкатка входа (T15, шаг 3) ждёт #180. M7 (#31) получает связь `blocked` на фазу 4. Аналитика (фаза 1) связана с #181 — закрывает его игровую часть; Метрика на лендинге и `userParams` остаются в #181.

## Риски и открытые вопросы

- **Rybbit за прокси может не увидеть IP игрока** → у всех одна страна. Проверка в T1, лечится заголовком.
- **Rybbit сверяет hostname события с доменом сайта?** Если да, домен сайта — `pozerkalam.space`. Проверка тестовым событием в T1.
- **VK ID для веб-приложения** может потребовать подтверждённую организацию в кабинете. В spark кабинет уже есть — второе приложение заводится там же (P2).
- **Telegram Mini App:** `window.open` в WebView Telegram без `telegram-web-app.js` может не открыть браузер. Тогда сработает ссылка «Открыть вход», но удобный путь — `Telegram.WebApp.openLink`. Mini App ещё не зарегистрирован (#29), поэтому в бэклог.
- **Вход внутри VK Mini App через подписанные `vk_*`-параметры** (без OAuth, как `initData` в spark) — следующий шаг после регистрации приложения (#30), в бэклог.
