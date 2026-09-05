# Implementation Plan: Флоу как у Spark — доска Vikunja «По зеркалам» + codegraph-покрытие index.html

Branch: none (main; `.ai-factory/config.yaml` → `create_branches: false`, проект всегда жил на main)
Created: 2026-09-05

## Settings
- Testing: yes — смоук-проверки в каждой задаче (API-перечитывание после записи; паритет строк зеркала; `codegraph query`; сухой прогон хука)
- Logging: minimal — shell-скрипты молчат при успехе, `echo` в stderr только в guard-ветках (нет кредов, нет jq, дрейф зеркала); хуки всегда `exit 0`
- Docs: yes — секции в CLAUDE.md («Task Board — Vikunja», «Code Search — codegraph»), память агента, `docs/PUBLISH.md` не трогать

## Roadmap Linkage
Milestone: "none"
Rationale: процессная инфраструктура (трекер + индекс кода), не продуктовый майлстоун; доска после засева сама становится носителем M3/M7/M8.

## Что уже выяснено (разведка, не переделывать)

**Эталон — проект spark.** Канбан = **Vikunja v2.6** на `http://194.5.65.182:3456` (тот же FRA-бокс, что старое зеркало игры; контейнер `vikunja`, compose `/opt/vikunja/`). Сейчас там проекты `Inbox (id=1)` и `Spark (id=2)`. Лейблы **общие для пользователя** и переиспользуются как есть: `P0=1, P1=2, P2=3, Backlog=4`; приоритеты `P0=4, P1=3, P2=2, Backlog=1`. Kanban-вью у Spark: `bucket_configuration_mode: manual`, бакеты `To-Do` (default) / `Doing` / `Done` (done_bucket). Носители правил у spark: `~/.claude/hooks/spark-vikunja-board.sh` (SessionStart инжектит верх доски), нетрекаемый `.claude/settings.local.json` (SessionStart + UserPromptSubmit-напоминание), память `kanban-rules` / `vikunja-tracker` / `vikunja-partial-update-wipes-fields`, справочная секция в CLAUDE.md. Креды — `~/.config/spark-vikunja.env` (VIKUNJA_URL/USER/PASS/PROJECT_ID, chmod 600).

**Ловушка Vikunja:** `POST /tasks/{id}` — REPLACE, не PATCH: поле, отсутствующее в payload, обнуляется (description/priority). Любой апдейт — полным payload, после массового — перечитать 1–2 задачи.

**codegraph 0.9.9 и index.html** (проверено в scratchpad): `.html` не индексируется вовсе (0 символов), а файлы под `.gitignore`/`.git/info/exclude` пропускаются (внутри — `git check-ignore`/`ls-files`), конфига-исключения нет. Работает **трекаемое зеркало** `<script>`-блока с построчным паддингом: строка N зеркала == строка N index.html → `codegraph query stepCar` → `…/index.js:3079`, и `sed -n 3079p index.html` — та же функция. Результат на текущем index.html: 414 нод, 1879 рёбер; `codegraph sync` подхватывает правку зеркала. Цена — ~230 КБ трекаемого генерата; шум в диффах гасится `.gitattributes` (`-diff`).

Глобальный Stop-хук уже гоняет `codegraph sync` в любом проекте с `.codegraph/` — но не регенерирует зеркало; регенерация — локальные хуки (Stop + git pre-commit).

## Commit Plan
- **Commit 1** (после задач 6–7): `chore(codegraph): зеркало inline-скрипта index.html для индекса + .gitattributes/.gitignore`
- **Commit 2** (после задач 8–10): `docs: флоу задач — доска Vikunja «По зеркалам», git-хуки зеркала, правила поиска по коду`
(задачи 1–5 живут вне репозитория: Vikunja, `~/.config`, `~/.claude`, память — коммитить нечего)

## Задачи

### Фаза 1: Доска Vikunja «По зеркалам»

- [x] 1. **Создать проект и kanban-бакеты на Vikunja.** `source ~/.config/spark-vikunja.env`, логин → token. `PUT /api/v1/projects {"title":"По зеркалам"}` → `project_id`. `GET /projects/{id}/views` → id kanban-вью (Vikunja создаёт List/Gantt/Table/Kanban сама). Бакеты: убедиться, что есть `To-Do` (default), добавить `PUT /projects/{id}/views/{v}/buckets {"title":"Doing"}` и `{"title":"Done"}`; вью обновить `POST /projects/{id}/views/{v}` **полным payload** (`title, view_kind:"kanban", bucket_configuration_mode:"manual", default_bucket_id:<todo>, done_bucket_id:<done>`). Проверка: `GET …/views/{v}` показывает оба id; `GET …/buckets` — три бакета. Зафиксировать `project_id`, `view_id`, три `bucket_id` — их берут задачи 2, 3, 5, 9. Логирование: только вывод id в ответе, без скриптов.

- [x] 2. **Файл кредов `~/.config/pozerkalam-vikunja.env` (chmod 600).** Те же `VIKUNJA_URL/USER/PASS`, что у spark, плюс `VIKUNJA_PROJECT_ID=<из 1>`, `VIKUNJA_PROJECT_NAME="По зеркалам"`, `VIKUNJA_VIEW_KANBAN=<v>`, `VIKUNJA_BUCKET_TODO/DOING/DONE`. Никогда не в git (`~/.config` вне репо, а `.claude/` уже в `.gitignore`). Проверка: `source` + логин возвращает token; `GET /projects/$VIKUNJA_PROJECT_ID` → title совпадает. Зависит от 1.

- [x] 3. **Хук доски + локальные настройки сессии.** (a) `~/.claude/hooks/vikunja-board.sh` — обобщённая копия `spark-vikunja-board.sh`: путь env-файла аргументом `$1` (дефолт — spark'овский, чтобы spark можно было позже переключить без правок), заголовок берёт `VIKUNJA_PROJECT_NAME`; тот же jq-фильтр (открытые, сорт по приоритету, `[ждёт: #N]` по `related_tasks.blocked`), таймауты `-m 4`, при недоступности — одна строка-предупреждение, всегда `exit 0`. **`spark-vikunja-board.sh` не трогать.** (b) `.claude/settings.local.json` в проекте (не трекается: `.claude/` в `.gitignore`): `SessionStart` → `"$HOME"/.claude/hooks/vikunja-board.sh "$HOME"/.config/pozerkalam-vikunja.env`, `UserPromptSubmit` → echo KANBAN-правила (текст как у spark, с именем проекта). Проверка: прямой запуск скрипта печатает шапку и список; `jq . .claude/settings.local.json` валиден. Зависит от 2.

- [x] 4. **Засеять доску открытой работой** (`PUT /projects/{id}/tasks`, затем `PUT /tasks/{id}/labels {"label_id":N}`; описание — HTML `<p>` c «Источник:» и путём к файлу, как у spark). Состав (только то, что уже зафиксировано в репо/памяти, ничего не выдумывать):
  - **P0** (4/label 1): «Подать игру в кабинет Яндекс Игр» — `docs/PUBLISH.md` §ЯИ, артефакт `build/yandex.zip`, за владельцем; шаг №1 стратегии (трафик и соцдоказательство).
  - **P1** (3/label 2): «Telegram Mini App: BotFather → /newapp на /play/» (PUBLISH §TG); «VK Mini Apps: приложение на /play/» (PUBLISH §VK); «M7 · B2C-freemium: ИП, приём платежей, экзаменационный курс 199–349 ₽/мес» (ROADMAP).
  - **P2** (2/label 3): «M8 · B2B-пилоты: онлайн-школы ПДД + white-label автошколам» (ROADMAP; козырь — экзамен-режим); «learner.js: зеркальные улицы L8/L10 и рулёжка в городских поворотах» (CLAUDE.md, known debt).
  - **Backlog** (1/label 4): «M3 · CDN — включать по метрикам M2» (ROADMAP, условный); «Товарный знак «По зеркалам»: проверка на linkmark.ru перед подачей» (память exam-layer).
  - **Этот план — одна задача на фазу** (P1): «Инфра: доска Vikunja» (сразу в Doing: `POST /projects/{id}/views/{v}/buckets/{doing}/tasks {"task_id":N}`), «Инфра: codegraph-зеркало index.html», «Инфра: правила флоу в CLAUDE.md и памяти» — последняя `PUT /tasks/{id}/relations {"other_task_id":<фаза1|фаза2>,"relation_kind":"blocked"}`.
  Проверка: перечитать 2 задачи — `priority`, `description`, `labels` на месте; хук из задачи 3 показывает список с `[ждёт: …]` у третьей инфра-задачи. Зависит от 3.

- [x] 5. **Память агента проекта** (`~/.claude/projects/-Users-user-Documents-projects-car-maneuver-trainer/memory/`): `kanban-rules.md` (feedback; правила 1–4 как у spark с id проекта/вью/бакетов из задачи 1, «действуют на любой ветке»), `vikunja-tracker.md` (reference; URL, проект, env-файл, рецепты curl), `vikunja-partial-update-wipes-fields.md` (feedback; копия ловушки REPLACE), и три строки-указателя в `MEMORY.md`. Frontmatter по формату памяти, ссылки `[[…]]` между файлами. Зависит от 1.

### Фаза 2: codegraph-покрытие index.html

- [x] 6. **Скрипт зеркала `tools/mirror-script.sh`** (bash + awk, zero deps). Читает `index.html`, для каждой строки: внутри `<script>…</script>` — строка как есть, снаружи — пустая; строки с самими тегами тоже пустые. Вывод — `codegraph-src/index.js`. Так паритет строк держится при любом числе `<script>`-блоков (сейчас один: 405–6015). Режимы: без аргументов — перезаписать (только если содержимое изменилось, чтобы не дёргать watcher codegraph); `--check` — сравнить с текущим файлом, при дрейфе `echo "codegraph-src/index.js устарел — запусти tools/mirror-script.sh" >&2; exit 1`. Проверка: `wc -l` совпадает (±1 за финальный перевод строки); `diff <(sed -n 3079p index.html) <(sed -n 3079p codegraph-src/index.js)` пуст; `--check` после регенерации → exit 0. Логирование: молчит при успехе, stderr только в `--check`-дрейфе.

- [x] 7. **Инициализация индекса и git-гигиена.** `.gitignore` += `.codegraph/`; `.gitattributes` = `codegraph-src/index.js -diff linguist-generated=true` (диффы/blame не показывают 230 КБ дубликата, `--stat` остаётся); `codegraph init .` в корне проекта. Проверка: `codegraph status` — 2 файла javascript, ≥400 нод; `codegraph query stepCar` → `codegraph-src/index.js:3079`; `git status` показывает только `codegraph-src/`, `.gitattributes`, `.gitignore`, `tools/`, `.ai-factory/`; `git diff --cached` после `git add` не печатает тело зеркала. Зависит от 6.
  <!-- Commit checkpoint: задачи 6–7 -->

- [ ] 8. **Автосинк зеркала.** (a) `.githooks/pre-commit` (как `.githooks/` у spark): `tools/mirror-script.sh && git add codegraph-src/index.js`; включение — `git config core.hooksPath .githooks` (локальная настройка, одноразово; шаг записать в CLAUDE.md). (b) В `.claude/settings.local.json` добавить `Stop`-хук: `[ -d .codegraph ] && tools/mirror-script.sh && "$HOME/.local/bin/codegraph" sync >/dev/null 2>&1; exit 0` (глобальный Stop-хук синкает, но зеркало не пересобирает — гонка безвредна: второй sync говорит «up to date»). Проверка: добавить в `index.html` пробную `function zzProbe(){}`, `git commit` во временный коммит → в коммите оба файла и зеркало содержит пробу на той же строке; `codegraph query zzProbe` находит; затем `git reset --soft HEAD~1` и убрать пробу, пересобрать зеркало. Зависит от 7.

### Фаза 3: Правила флоу в репозитории

- [ ] 9. **CLAUDE.md — три секции по образцу spark, по-русски.** (a) «Task Board — Vikunja (MANDATORY)»: URL, проект «По зеркалам» (id), env-файл, хук, kanban view/бакеты, приоритеты↔лейблы, правила «сверься перед нетривиальной работой / заводи новую работу в том же ходе / план = задача на фазу / REPLACE-ловушка», curl-рецепты (список/создать/лейбл/в Doing/закрыть полным payload). (b) «Code Search — codegraph»: `.codegraph/` живёт локально, индекс читает `codegraph-src/index.js` — трекаемое зеркало `<script>` из `index.html` с паритетом строк (`index.js:N` == `index.html:N`), регенерация pre-commit/Stop, **править только `index.html`**; роутинг: `codegraph_explore` для «как работает X», `codegraph_impact/callers` перед правкой, `Grep` для точечного паттерна; Serena к inline-HTML неприменима; субагентам без MCP — `codegraph query|callers|impact <symbol>`; одноразовый `git config core.hooksPath .githooks`. (c) Одна строка в «What this is»/Commands про `.ai-factory/config.yaml` и цикл `/aif-plan → /aif-implement → /aif-verify → /aif-commit` с зеркалированием фаз на доску. Проверка: секции читаются как самодостаточная инструкция для новой сессии без этой истории. Зависит от 1, 8.

- [ ] 10. **Сквозная проверка флоу и закрытие.** Новая сессия (или ручной запуск хука) показывает верх доски; `codegraph_explore` (MCP) отвечает на «как stepCar интегрирует физику» текстом из `codegraph-src/index.js`; `tools/mirror-script.sh --check` → 0; `git status` чист после коммита 2; инфра-задачи фаз на доске → `done:true` (полным payload) + перенос в `Done`; в ROADMAP «Completed» — строка «2026-09-05 | Флоу: доска Vikunja «По зеркалам» + codegraph-зеркало index.html». Зависит от 4, 8, 9.
  <!-- Commit checkpoint: задачи 8–10 -->
