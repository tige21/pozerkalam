# Аккаунт: вход через VK ID и Яндекс ID, гость, синк прогресса, покупки

Игрок едет гостем сколько угодно. Вход нужен для двух вещей: прогресс на всех устройствах и
покупка, привязанная к аккаунту. Порядок кнопок — VK ID, затем Яндекс ID (149-ФЗ ст. 10.6:
вход на российском сервисе — через российский сервис авторизации). Принципы взяты у spark
(`~/Documents/projects/spark/docs/AUTH-VK-YANDEX.md`), сервис свой.

**Состояние на 02.10.2026:** сервис развёрнут на vdsina и зеркале (build `a96080e0a5ad6805`),
`/etc/pozerkalam-account.env` создан деплоем с новым `JWT_SECRET`, ключей провайдеров нет —
`/api/v1/health` отвечает `vk:false, yandex:false`, кнопок входа в игре нет (`AUTH_PROVIDERS` пуст).
Ждёт: приложения VK ID и Яндекс ID (ниже) и `/privacy/` (доска #180).

## Схема

```
игра (pozerkalam.space/play/, iframe VK/Telegram, PWA)
   │  POST /api/v1/auth/start · /auth/claim · /auth/refresh · /auth/logout
   │  GET|DELETE /api/v1/me · GET|PUT /api/v1/progress
   ▼
nginx pozerkalam.space (vdsina) ── location /api/v1/ → 127.0.0.1:8788
   │                                (зеркало 194 проксирует /api/v1/ на vdsina по https)
   ▼
pozerkalam-account.service — server/account.py (Python 3.11 stdlib + SQLite)
   ├─ id.vk.ru            обмен кода (PKCE), профиль     ← напрямую, без прокси
   ├─ oauth.yandex.ru     обмен кода (client_secret)      ← напрямую
   └─ login.yandex.ru     профиль                         ← напрямую
база: /var/lib/pozerkalam-account/account.db (WAL), копия раз в сутки в /root/backups
```

## Флоу входа

Один серверный флоу на все поверхности, как Mini App-флоу spark:

1. Игра чеканит `nonce` (32 байта) и шлёт `POST /auth/start {provider, mode, nonce}`.
   Сервис создаёт `sid` и `state`, для VK — PKCE-пару; в базе только `sha256(nonce)`.
   Ответ — `{authUrl, sid}`.
2. `mode=redirect` (окно верхнего уровня): страница уходит на `authUrl`.
   `mode=poll` (iframe VK/Telegram, PWA): вкладка открывается синхронно в нажатии, игра
   опрашивает `POST /auth/claim` раз в 2 с до 5 мин и сразу при возврате на вкладку.
   Браузер не дал вкладку — на экране ссылка «Открыть вход».
3. Провайдер возвращает браузер на `https://pozerkalam.space/api/v1/auth/callback`
   (единственный redirect URI в обоих кабинетах). Сервис меняет код на профиль, заводит или
   находит аккаунт, помечает вход `authorized`. Токены в базу не пишутся.
   redirect → 302 на `/play/#auth=<sid>`; poll → страница «Вход выполнен. Закрой эту вкладку».
4. `POST /auth/claim {sid, nonce}` — строка удаляется, выдаются access + refresh.
   Чужой `nonce` → 403: `sid` виден в адресе возврата и без `nonce` бесполезен.

Данные провайдера — минимум: VK без `scope` (id, имя), Яндекс — `login:info`.
Хранятся id у провайдера и отображаемое имя («Егор Т.»). Email и аватар не запрашиваются.

## Сессии

- access — JWT HS256 на 1 ч, только в памяти вкладки;
- refresh — 32 случайных байта, в базе `sha256`, срок 90 суток **от входа**, ротация его не
  продлевает (как в spark);
- повтор уже обменянного refresh в течение минуты → 409 `rotated`: гонка двух вкладок,
  вкладка перечитывает свежий refresh из `localStorage` и повторяет; позже минуты → отзыв всей
  семьи сессий (кража);
- выход отзывает семью; удаление аккаунта стирает аккаунт, связки, сессии и прогресс, а
  оплаченные покупки (`source != 'manual'`) остаются обезличенными — для учёта и возвратов.

Ключ в браузере — `pz_auth` (refresh и карточка аккаунта). **Не `trainer_*`**: адаптер Яндекс
Игр зеркалит каждый `trainer_*` в облако площадки.

## Синк прогресса

Слияние делает только сервер. Игра отправляет `trainer_progress` целиком (`PUT /progress`) и
кладёт итог обратно:

| Поле | Правило |
|---|---|
| `best*` (время, касания, ошибка в см, баллы экзамена) | min |
| остальные числа (`n`, `clean`, `passed`) | max |
| массивы (`routes`) | поэлементно |
| объекты (`train`, `real`) | рекурсивно |
| `null` / нет поля | берётся значение другой стороны |

Правило идемпотентно: повторная отправка ничего не меняет, поэтому перенос гостевого прогресса
при входе — тот же PUT. Прохождения с двух устройств не суммируются (3 + 2 даёт 3) — готовности
к экзамену хватает `clean > 0` и `bestErr`.

Когда игра шлёт: после входа, на старте страницы, через 5 с после победы или конца экзамена,
при скрытии вкладки (`keepalive`). Если пока шёл ответ, игрок прошёл уровень, итог сервера поверх
не кладётся — игра отправит ещё раз.

## Покупки и пейволл

- `PAYWALL = {product:'course', levels:[]}` в `index.html` — список платных уровней пуст,
  его заполнит решение по M7 (`docs/monetization-m7.md`);
- `PAY_ON = false` — кнопки «Купить» нет, пока не подключён провайдер;
- замок в `openLevel` (входы игрока), не в `loadLevel` (на нём гейты); первый уровень и свои
  площадки не закрываются;
- покупки сервиса — таблица `entitlements`, `/me` отдаёт активные; клиентский замок защищает
  «от честных»: код уровней лежит в странице.

Шов провайдера: `payStart(product)` → платёжная форма → вебхук сервиса → `grant` → покупка
приходит игре через `/me`. У spark по той же схеме работает Robokassa с Робочеками СМЗ
(самозанятый, чек в «Мой налог» сам) — вероятный выбор и здесь.

## Регистрация приложений (один раз, руками)

**VK ID** — https://id.vk.com/about/business (тот же кабинет, что для spark):
1. Новое приложение, тип Web.
2. Доверенный redirect: `https://pozerkalam.space/api/v1/auth/callback`.
3. `scope` не нужен. Скопировать ID приложения — он не секрет.

**Яндекс ID** — https://oauth.yandex.ru/:
1. Новое приложение, платформа «Веб-сервисы».
2. Redirect URI: `https://pozerkalam.space/api/v1/auth/callback`.
3. Доступ: «Доступ к логину, имени и фамилии, полу» (`login:info`).
4. Скопировать ClientID и Client secret. Секрет — только на бокс.

## Настройки

| Переменная | Где | Секрет | Зачем |
|---|---|---|---|
| `AUTH_PROVIDERS` | `.deploy.env` | нет | `vk,yandex` — кнопки в игре; пусто — входа нет |
| `JWT_SECRET` | `/etc/pozerkalam-account.env` | **да** | подпись access; создаётся деплоем один раз (`openssl rand`) |
| `VK_CLIENT_ID` | там же | нет | VK ID |
| `YANDEX_CLIENT_ID` | там же | нет | Яндекс ID |
| `YANDEX_CLIENT_SECRET` | там же | **да** | обмен кода Яндекса |
| `OAUTH_CALLBACK_URL` | там же | нет | `https://pozerkalam.space/api/v1/auth/callback` |
| `LOG_LEVEL` | там же | нет | `debug` первые недели, потом `info` |

Шаблон — `server/account.env.example`. Деплой **не перезаписывает** env-файл: смена
`JWT_SECRET` разлогинила бы всех. Ключи провайдеров кладутся руками:

```bash
ssh vdsina
nano /etc/pozerkalam-account.env       # VK_CLIENT_ID, YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET
systemctl restart pozerkalam-account
journalctl -u pozerkalam-account -n 5 -o cat | grep CONFIG   # CONFIG: vk=True yandex=True …
```

## Включение на проде

1. Ключи на боксе (выше), `curl https://pozerkalam.space/api/v1/health` → `"vk": true, "yandex": true`.
2. Политика конфиденциальности на `/privacy/` (доска #180) — кнопки ссылаются на неё.
3. `AUTH_PROVIDERS="vk,yandex"` в `.deploy.env` → `./deploy-pozerkalam.sh`. Смоук падает,
   если в странице включён провайдер, а у сервиса нет его ключей.

## Обслуживание

```bash
ssh vdsina
pz-account stats                         # аккаунты по провайдерам, активные, сессии, покупки
pz-account list --name Егор              # найти id аккаунта
pz-account grant <id> course             # выдать курс навсегда (тестер, пилот автошколы)
pz-account grant <id> course --days 30 --ref pilot-school-1
pz-account revoke <id> course
```

Восстановление базы из копии:

```bash
systemctl stop pozerkalam-account
cp /root/backups/pz-account-2026-10-02.db /var/lib/pozerkalam-account/account.db
rm -f /var/lib/pozerkalam-account/account.db-wal /var/lib/pozerkalam-account/account.db-shm
chown www-data:www-data /var/lib/pozerkalam-account/account.db
systemctl start pozerkalam-account
```

## Проверки

```bash
python3 -m unittest server/test_account.py     # сервис: 21 тест на заглушке провайдеров
PW_DIR=/tmp/pw node tools/account-check.mjs    # игра: вход, гость, синк, пейволл (@acct-*, @an-*)
PW_DIR=/tmp/pw node tools/gherkin-run.mjs      # правила пейволла (acct/paywall.feature)
```

## Неисправности

- **«Ссылка входа устарела»** — между нажатием и возвратом прошло больше 10 минут, или вход
  начат в другой вкладке/браузере (у этой вкладки нет `nonce`). Начать заново.
- **VK: redirect_uri mismatch** — в кабинете VK ID не тот доверенный адрес; нужен ровно
  `https://pozerkalam.space/api/v1/auth/callback`.
- **Яндекс: invalid_client** — нет или неверен `YANDEX_CLIENT_SECRET`; при старте сервис
  пишет `CONFIG WARNING`.
- **«Вход не удался» на странице возврата** — провайдер отверг обмен кода; причина в журнале:
  `journalctl -u pozerkalam-account | grep 'провайдер'` (код ошибки провайдера, без секретов).
- **В iframe ничего не открывается** — площадка запретила всплывающие окна; игра показывает
  ссылку «Открыть вход». Для Telegram удобный путь — `Telegram.WebApp.openLink` (доска #233).
- **Игрока разлогинило** — refresh отвергнут: истёк срок (90 суток от входа) или старый refresh
  предъявили позже минуты после обмена (`refresh reuse` в журнале — семья отозвана). Выход на
  одном устройстве другие не трогает: у каждого входа своя семья. Прогресс на устройстве остаётся.
