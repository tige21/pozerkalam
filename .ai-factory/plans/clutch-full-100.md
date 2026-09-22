# Implementation Plan: Сцепление — выжатое не держит 100 %

Branch: main (create_branches: false)
Created: 2026-09-23
Доска: Vikunja «По зеркалам» #153 (P1) · Ralph-цикл `.ai-factory/RALPH-CUSTOMER-2026-09-23.md`

## Settings
- Testing: yes — регрессионная проверка в `tools/mt-check.mjs` настоящими клавишами + `@ui`-сценарий
  в `specs/features/mt/sceplenie.feature` (гейт связи), пересборка `docs/qa-checklist.md`; все гейты
- Logging: minimal — `window.mtDebug()` уже отдаёт `clu`, per-frame лог в игре запрещён (CLAUDE.md)
- Docs: yes — CLAUDE.md, раздел МКПП

## Roadmap Linkage
Milestone: "none"
Rationale: баг заказчика.

## Research Context (codegraph)
- Показ: `updateHUD` → `#rpmVal` = «обороты · round(car.clu·100)%» (`index.html`, ветка `mtOn()`); другого места
  с процентом сцепления нет (`#tclutch` — только кнопка, ячейка `.opt` скрыта на телефоне).
- Физика: `mtDrive()` — `index.html:5472`, вызывается из `stepCar` на каждом подшаге 1/120 с:
  ```js
  const tgt = input.clutch?1:0;
  if(tgt>car.clu) car.clu=Math.min(1, car.clu+5.0*dt);
  else { … car.clu=Math.max(0, car.clu-(inGrip?0.5:2.8)*dt); }
  ```
- **Корень:** при зажатом Shift и `clu===1` условие `tgt>car.clu` ложно — срабатывает ветка ОТПУСКАНИЯ
  и снимает 2,8·dt = 0,023. Значение пилит 100 % ↔ 97,7 %, на щитке застывает «98 %» и до 100 % не доходит.
  Воспроизведено настоящими клавишами: Shift зажат 0,9 с → `clu=0.977`, «900 · 98%».
- Побочный эффект того же дефекта: `grip = 1−clu` = 0,023 при выжатом сцеплении — 2,3 % тяги доходило до
  колёс, машина с выжатым сцеплением и газом чуть разгонялась.
- `mtDrive` не в мутационной зоне; `specs/features/mt/sceplenie.feature` — `@ui`-сценарии, связанные с
  проверками `mt-check` кодом требования.

## Tasks
- [x] Task 1: `mtDrive`: отпускание — только когда `tgt<car.clu` (при равенстве значение стоит).
- [x] Task 2: `mt-check`: после «со сцеплением включается 1-я» — проверка «выжатое сцепление держит 100 %
  (@mt-clutch-full)»: `car.clu===1` и `#rpmVal` кончается на «100%»; сценарий `@ui @mt @mt-clutch-full`
  в `sceplenie.feature`; `node tools/qa-checklist.mjs`.
- [x] Task 3: Гейты: регрессия DEMOS (демо на АКПП — не задето), gherkin-check/run, unit-check, mt-check целиком
  (38 правил механики + новая), запись клавишами до/после.
