# Implementation Plan: Больше машин в городском потоке (#188)

Branch: main (create_branches: false)
Created: 2026-09-25
Доска: Vikunja «По зеркалам» #188 (P1) — владелец: «нужно чтобы можно было добавить большее число машин на уровнях с городом»

## Settings
- Testing: yes — `tools/traffic-check.mjs` учится гоняться на заданной плотности (`TRAFFIC=heavy`) и получает две проверки с кодами; сценарии в `specs/features/traffic/`
- Logging: standard — существующий `console.warn('[FIX:traffic] … машин N, плотность key')` в `trafficInit` остаётся единственным логом
- Docs: yes — абзац «Traffic flow → Density» в CLAUDE.md

## Roadmap Linkage
Milestone: "none"
Rationale: запрос владельца по игровому содержанию, вне майлстоунов роадмапа.

## Контекст
- Плотность — `TRAF_SPACING` (`index.html:2933`, метров дороги на машину: calm 115 / normal 74 / dense 48), потолок `TRAF.cap` 16 (`2931`), цикл ступеней `TRAF_ORDER` (`2939`) крутят кнопка `#trafBtn` и ≡-меню через `cycleTraffic` (`3094`), имена в `TRAF_NAMES`. Всё на ступени завязано на эти три таблицы — новая ступень не требует правок UI.
- Машины ставятся в `trafficInit` (`3111`): на петлю `k = round(len/spacing)`, суммарно не больше `cap`. Городских петель две (`trafCityLoops` `3066`): западный прямоугольник N1-N7-N6-N2 и восточная через кольцо. Третьей замкнутой петли по правым поворотам в графе нет — Ленина-север, Парковая, Южная, Косой съезд и Восточная-север оканчиваются тупиками, а разворот в петле потока запрещён (ломал Ленина через трамвайное полотно). Значит больше машин = меньше spacing и выше cap на тех же двух петлях: при 30 м/машину ≈ 10 + 12 = 22.
- Телефон: `trafKey` (`2944`) опускает ступень на одну — кадр там упирается в JS, каждая машина ≈ 40 граней. Экзамен всегда `dense` и в цикл не попадает.
- `tools/traffic-check.mjs` сейчас гоняет поток на плотности по умолчанию (`normal`) — новая ступень без гейта была бы слепой: пробки, наложения, застревание > 20 с проверяются только там.
- Показы (`demo-vio`, `computeIdealPath`) от ступени не зависят: поток создаётся после `computeIdealPath`, а `demo-vio` идёт на `normal`.

## Tasks

### Phase 1: Ступень и множитель
- [x] Task 1: `index.html` — ступень «час пик» и авторский множитель.
  - `TRAF_SPACING.heavy = 30`, `TRAF_NAMES.heavy = 'час пик'`, `TRAF_ORDER` → `['off','calm','normal','dense','heavy']`; `TRAF.cap` 16 → 30 (две петли ≈ 650 м, при 30 м/машину нужно ~22; запас под `trafMul`).
  - `trafficInit`: `const mul = clamp(+def.trafMul || 1, 0.25, 4)`; `k = clamp(Math.round(rt.len/spacing*mul), 1, TRAF.cap-made)`. Комментарий-WHY у `trafMul`: авторская ручка уровня, ступень игрока остаётся общей.
  - `trafKey`: ступень вниз на телефоне уже работает через индекс — проверить, что `heavy` на `MOB` даёт `dense`, ничего не менять, если так.
  - `cycleTraffic`: без правок (имена и счётчик из таблиц). Проверить глазами, что тост «Трафик: час пик · машин в городе: N» влезает на 667 px (`mt-check` меряет тач-полосу, не тост — посмотреть скриншот).
  Файлы: `index.html` (2931–2951, 3111–3135). Логи: существующий `[FIX:traffic]`.

### Phase 2: Гейт
- [x] Task 2: `tools/traffic-check.mjs` — плотность из окружения и две проверки (depends on 1).
  - `TRAFFIC=<key>` (по умолчанию как сейчас) → перед `loadLevel` в обоих `page.evaluate` ставить `opt.traffic = key` (без записи в localStorage). Все существующие проверки (`@traffic-flow-*`) идут на выбранной ступени.
  - Новые проверки в том же прогоне, для каждого городского уровня кроме экзамена:
    - `@traffic-density-heavy` — `trafCount()` на `heavy` ≥ 1.4 × `trafCount()` на `dense` (перезагрузка уровня с другой `opt.traffic`) и ≤ `TRAF.cap`;
    - `@traffic-density-mul` — `LEVELS[i].trafMul = 2` + перезагрузка → счёт ≥ 1.8 × базового или упёрся в `cap`; после проверки `trafMul` снять и уровень перезагрузить.
  - Прогнать `TRAFFIC=heavy node tools/traffic-check.mjs` на всех 7 уровнях: дистанция, красный, наложения, застревание — зелёные. Если на `heavy` появляется пробка (`stuck > 20 с`) — поднять `spacing.heavy` до 34–36, не трогать детекторы.
  - `specs/features/traffic/plotnost.feature` — два `@ui @traffic @traffic-density-*` сценария (`Ссылка:` → доска #188), `node tools/qa-checklist.mjs`, `node tools/gherkin-check.mjs` → 0 разрывов.
  Файлы: `tools/traffic-check.mjs`, `specs/features/traffic/plotnost.feature` (новый), `docs/qa-checklist.md` (генерат). Логи: `ok/ПРОВАЛ` как сейчас.

### Phase 3: Доки и доска
- [x] Task 3: CLAUDE.md — в абзаце «Traffic flow → Density» добавить ступень «час пик» (spacing 30, cap 30), `def.trafMul`, `TRAFFIC=heavy` у `traffic-check`, и почему третьей петли нет (тупики, запрет разворота). Доска: #188 → `done:true` полным payload с числами машин по уровням (depends on 2).
  Файлы: `CLAUDE.md`. Логи: нет.

## Проверка перед коммитом
- `TRAFFIC=heavy PW_DIR=/tmp/pw node tools/traffic-check.mjs` и без `TRAFFIC` — оба зелёные
- `PW_DIR=/tmp/pw node tools/gherkin-run.mjs` → 24/0 (traffic-сценарии читают `TRAF`); `node tools/gherkin-check.mjs` → 0 разрывов
- `PW_DIR=/tmp/pw node tools/level-audit.mjs` — 0 исключений; `bash tools/mirror-script.sh --check`
- Один коммит: `feat(traffic): ступень «час пик», потолок 30 машин, множитель потока на уровне`
