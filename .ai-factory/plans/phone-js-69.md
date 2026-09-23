# Implementation Plan: #69 — телефон: JS кадра, а не только уровни качества

Branch: main (create_branches: false)
Created: 2026-09-23
Доска: #69 (P1) · Ralph-цикл `.ai-factory/RALPH-110-69.md`

## Settings
- Testing: yes — `perf-bench` (MOBILE=1 CPU=4, A/B `OLD=HEAD` в одном сеансе), CPU-профиль через CDP,
  сверка показаний датчиков старый/новый код, мутации `rayOBB/castMin/clearances` (до/после, полный прогон),
  `cockpit-shots --sweep`, регрессия, gherkin/unit/mt/traffic/light/hull/mirror
- Logging: minimal — горячий путь кадра, логов в нём быть не должно
- Docs: yes — CLAUDE.md, раздел Adaptive performance

## Roadmap Linkage
Milestone: "none"
Rationale: производительность на телефоне.

## Research Context
- 1c1a6de (06.09): лестница QUALITY режет материалы/детали/дальность/руль. С тех пор — плотный поток в городе.
- `perf-bench` мерил только уровень 1 из салона. Добавлены `LEVEL`, `CAM`, `TRAFFIC`.
- База (эмуляция телефона 844×390@3, CPU×4, плотный поток): p95 18–22 мс, JS 11–15 мс/кадр, на уровне 30 из
  салона регулятор уходил на q5 (DPR 1). Порог «p95 ≤ 33 мс» выполнялся, но JS съедал 70–90 % бюджета 16,7 мс.
- CPU-профиль (Chrome с GPU, CPU×4, CDP Profiler): главный поток занят ~87 %. Самостоятельное время:
  `flushFaces` 15–17 %, `pathCam` 9–15 %, `pushFace` 5–6 %, `rayOBB` 3,8 % (город), GC 3–4 %, `shadeCol` 3 %.
  - `clearances()` — 36 лучей × ВСЕ `level.obs` (в городе — сотни бордюров, знаков, машин); `rayOBB`
    выделял орты и массив массивов на каждый вызов.
  - `pathCam` — объект на каждую вершину (`toScreen`) и `Math.hypot` (в V8 в разы медленнее `sqrt`).
  - `pushFace`/`pushQuad`/`pushPoly`/`shadeCol` — `Math.hypot` в горячем пути.
  - Объект грани получал поля позже (`col2`, `grain`, `img`, `ga*`, `gk`) — десяток скрытых классов,
    полиморфное чтение в цикле `flushFaces`.
  - Повтор цвета подряд у ~10 % граней — дедупликация `fillStyle` не окупается (проверено, не делаем).

## Tasks
- [x] Task 1: `perf-bench`: `LEVEL`, `CAM`, `TRAFFIC` — замер города и экзамена, а не только площадки.
- [x] Task 2: `clearances`: отбор ближних препятствий один раз за вызов (`clearNear`, радиус «диагональ
  кузова + SENS_MAX + диагональ препятствия» — точное надмножество); `rayOBB` без выделения памяти
  (`raySlab`); `castMin(..., list)`. Сверка: 600 случайных поз на 10 уровнях — показания совпали до 1e-6.
- [x] Task 3: `pathCam` без объекта на вершину и без `Math.hypot`.
- [x] Task 4: `Math.sqrt` вместо `Math.hypot` в `pushFace`/`pushQuad`/`pushPoly`/`shadeCol`.
- [x] Task 5: объект грани с полным набором полей сразу (одна форма для V8).
- [x] Task 6: мутации — новые выжившие `0 → 1` в `minH` (датчики не видели бы бордюр): утверждения с
  бордюром 16 см со всех сторон и кубиком по диагонали в `tools/units.js`. `clearances` 27,5 → 45,9 %,
  `rayOBB` 43,5 → 60 %, `castMin` 25 → 33 %.
- [ ] Task 7: полный мутационный прогон (порог-храповик), итоговая A/B-матрица MOBILE=1 CPU=4 + десктоп GPU,
  цифры в CLAUDE.md.
