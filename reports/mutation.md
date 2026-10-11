# Мутационное тестирование расчётного ядра
Прогон: 2026-10-11 00:22 UTC
Область: `tools/mutation-zone.json`. Убивают `tools/units.js` и `@domain`-сценарии.
**Убито 531 из 1368 — 38.8 %** (порог 35.6 %)
Эквивалентных, не в счёт: 3
| Функция | Выжило |
|---|---|
| `violationsTick` | 193 |
| `stepCar` | 81 |
| `cornerArc` | 66 |
| `trafBlock` | 66 |
| `clearances` | 46 |
| `ringArc` | 39 |
| `trafConflict` | 34 |
| `cityRoute` | 32 |
| `trafficGap` | 28 |
| `trafLight` | 21 |
| `trafPath` | 19 |
| `edgeRun` | 18 |
| `polyMTV` | 18 |
| `goalPoseOk` | 18 |
| `groundH` | 17 |
| `trafPose` | 16 |
| `satMTV` | 15 |
| `blindZone` | 12 |
| `TRAF` | 9 |
| `ackermann` | 8 |
| `citySnap` | 8 |
| `carExtent` | 8 |
| `rayOBB` | 8 |
| `trafKey` | 7 |
| `castMin` | 7 |
| `obsShape` | 6 |
| `carLift` | 5 |
| `cityPathNodes` | 4 |
| `lightPhase` | 4 |
| `TRAF_SPACING` | 4 |
| `GAP_AHEAD` | 3 |
| `trafSpeed` | 3 |
| `YIELD_TCA` | 3 |
| `steerRateNow` | 2 |
| `roadHW` | 2 |
| `laneOffset` | 2 |
| `ROUTE_STEP` | 1 |
| `LANE_SHIFT` | 1 |
| `STOP_V` | 1 |
| `examPenalty` | 1 |
| `shadowPoly` | 1 |
## Выжившие
- **groundH** · index.html:863 · число 0 → 1 · `groundH|число 0 → 1|f29e4733`
- **groundH** · index.html:865 · * → / · `groundH|* → /|43c5f42b#2`
- **groundH** · index.html:868 · < → <= · `groundH|< → <=|b4be828d`
- **groundH** · index.html:868 · число 6 → 7 · `groundH|число 6 → 7|b4be828d`
- **groundH** · index.html:868 · || → && · `groundH||| → &&|b4be828d`
- **groundH** · index.html:868 · > → >= · `groundH|> → >=|b4be828d`
- **groundH** · index.html:868 · число 6 → 7 · `groundH|число 6 → 7|b4be828d#2`
- **groundH** · index.html:868 · убран Math.abs · `groundH|убран Math.abs|b4be828d`
- **groundH** · index.html:868 · * → / · `groundH|* → /|b4be828d`
- **groundH** · index.html:868 · * → / · `groundH|* → /|b4be828d#2`
- **groundH** · index.html:868 · > → >= · `groundH|> → >=|b4be828d#2`
- **groundH** · index.html:868 · число 6 → 7 · `groundH|число 6 → 7|b4be828d#3`
- **groundH** · index.html:869 · === → !== · `groundH|=== → !==|11cb2541`
- **groundH** · index.html:869 · * → / · `groundH|* → /|11cb2541`
- **groundH** · index.html:869 · min → max · `groundH|min → max|11cb2541`
- **groundH** · index.html:869 · max → min · `groundH|max → min|11cb2541`
- **groundH** · index.html:869 · число 0 → 1 · `groundH|число 0 → 1|11cb2541`
- **carLift** · index.html:899 · число 0 → 1 · `carLift|число 0 → 1|4d23a056`
- **carLift** · index.html:900 · + → - · `carLift|+ → -|e6b045c0`
- **carLift** · index.html:900 · * → / · `carLift|* → /|e6b045c0`
- **carLift** · index.html:900 · * → / · `carLift|* → /|e6b045c0#2`
- **carLift** · index.html:900 · * → / · `carLift|* → /|e6b045c0#3`
- **steerRateNow** · index.html:1817 · убран Math.abs · `steerRateNow|убран Math.abs|fdfb8f00`
- **steerRateNow** · index.html:1817 · / → * · `steerRateNow|/ → *|fdfb8f00`
- **ackermann** · index.html:1835 · убран Math.abs · `ackermann|убран Math.abs|cf58aadf`
- **ackermann** · index.html:1835 · < → <= · `ackermann|< → <=|cf58aadf`
- **ackermann** · index.html:1835 · число 4 → 5 · `ackermann|число 4 → 5|cf58aadf`
- **ackermann** · index.html:1835 · число 0 → 1 · `ackermann|число 0 → 1|cf58aadf`
- **ackermann** · index.html:1835 · число 0 → 1 · `ackermann|число 0 → 1|cf58aadf#2`
- **ackermann** · index.html:1836 · / → * · `ackermann|/ → *|ac2f0db2#2`
- **ackermann** · index.html:1836 · число 2 → 3 · `ackermann|число 2 → 3|ac2f0db2`
- **ackermann** · index.html:1837 · / → * · `ackermann|/ → *|f40f84b8#2`
- **roadHW** · index.html:3404 · число 0 → 1 · `roadHW|число 0 → 1|d430bd8f`
- **roadHW** · index.html:3404 · число 1 → 0 · `roadHW|число 1 → 0|d430bd8f`
- **ROUTE_STEP** · index.html:4547 · число 2.0 → 3 · `ROUTE_STEP|число 2.0 → 3|18bf5964`
- **LANE_SHIFT** · index.html:4548 · число 26 → 27 · `LANE_SHIFT|число 26 → 27|cff03092`
- **citySnap** · index.html:4560 · > → >= · `citySnap|> → >=|72c71778`
- **citySnap** · index.html:4560 · число 1 → 0 · `citySnap|число 1 → 0|72c71778`
- **citySnap** · index.html:4563 · число 0.8 → 1.8 · `citySnap|число 0.8 → 1.8|812f1bd6`
- **citySnap** · index.html:4564 · * → / · `citySnap|* → /|9ae08c16`
- **citySnap** · index.html:4564 · число 0 → 1 · `citySnap|число 0 → 1|9ae08c16`
- **citySnap** · index.html:4568 · < → <= · `citySnap|< → <=|c2c82177`
- **citySnap** · index.html:4568 · число 6 → 7 · `citySnap|число 6 → 7|c2c82177`
- **citySnap** · index.html:4571 · < → <= · `citySnap|< → <=|4849c5e7`
- **laneOffset** · index.html:4582 · * → / · `laneOffset|* → /|b86a905e`
- **laneOffset** · index.html:4582 · число 0.5 → 1.5 · `laneOffset|число 0.5 → 1.5|b86a905e`
- **cityPathNodes** · index.html:4593 · < → <= · `cityPathNodes|< → <=|8f88c82f`
- **cityPathNodes** · index.html:4598 · >= → > · `cityPathNodes|>= → >|6f1156fd`
- **cityPathNodes** · index.html:4603 · < → <= · `cityPathNodes|< → <=|510e1fed`
- **cityPathNodes** · index.html:4604 · || → && · `cityPathNodes||| → &&|deaf0f5c`
- **ringArc** · index.html:4618 · число 2 → 3 · `ringArc|число 2 → 3|4b24cec7`
- **ringArc** · index.html:4618 · число 3.5 → 4.5 · `ringArc|число 3.5 → 4.5|4b24cec7`
- **ringArc** · index.html:4621 · убран Math.abs · `ringArc|убран Math.abs|c5692fba`
- **ringArc** · index.html:4621 · > → >= · `ringArc|> → >=|c5692fba`
- **ringArc** · index.html:4621 · число 0.5 → 1.5 · `ringArc|число 0.5 → 1.5|c5692fba`
- **ringArc** · index.html:4621 · убран Math.abs · `ringArc|убран Math.abs|c5692fba#2`
- **ringArc** · index.html:4621 · > → >= · `ringArc|> → >=|c5692fba#2`
- **ringArc** · index.html:4621 · число 0.5 → 1.5 · `ringArc|число 0.5 → 1.5|c5692fba#2`
- **ringArc** · index.html:4622 · <= → < · `ringArc|<= → <|013e951b`
- **ringArc** · index.html:4622 · число 0.05 → 1.05 · `ringArc|число 0.05 → 1.05|013e951b`
- **ringArc** · index.html:4622 · > → >= · `ringArc|> → >=|013e951b`
- **ringArc** · index.html:4623 · min → max · `ringArc|min → max|3e097f3c`
- **ringArc** · index.html:4623 · число 6 → 7 · `ringArc|число 6 → 7|3e097f3c`
- **ringArc** · index.html:4623 · * → / · `ringArc|* → /|3e097f3c`
- **ringArc** · index.html:4623 · число 0.4 → 1.4 · `ringArc|число 0.4 → 1.4|3e097f3c`
- **ringArc** · index.html:4626 · число 1 → 0 · `ringArc|число 1 → 0|ead38b0f`
- **ringArc** · index.html:4626 · <= → < · `ringArc|<= → <|ead38b0f`
- **ringArc** · index.html:4626 · число 8 → 9 · `ringArc|число 8 → 9|ead38b0f`
- **ringArc** · index.html:4626 · число 9 → 10 · `ringArc|число 9 → 10|ead38b0f`
- **ringArc** · index.html:4628 · число 3 → 4 · `ringArc|число 3 → 4|77bfbadc`
- **ringArc** · index.html:4631 · !== → === · `ringArc|!== → ===|7650c3ad`
- **ringArc** · index.html:4631 · / → * · `ringArc|/ → *|7650c3ad`
- **ringArc** · index.html:4632 · * → / · `ringArc|* → /|faf41145`
- **ringArc** · index.html:4632 · * → / · `ringArc|* → /|faf41145#2`
- **ringArc** · index.html:4632 · * → / · `ringArc|* → /|faf41145#3`
- **ringArc** · index.html:4632 · * → / · `ringArc|* → /|faf41145#4`
- **ringArc** · index.html:4638 · число 2 → 3 · `ringArc|число 2 → 3|c85645ff`
- **ringArc** · index.html:4638 · число 5 → 6 · `ringArc|число 5 → 6|c85645ff`
- **ringArc** · index.html:4639 · число 1 → 0 · `ringArc|число 1 → 0|ccfe5ca0`
- **ringArc** · index.html:4639 · число 0 → 1 · `ringArc|число 0 → 1|ccfe5ca0`
- **ringArc** · index.html:4639 · <= → < · `ringArc|<= → <|ccfe5ca0`
- **ringArc** · index.html:4641 · число 0.45 → 1.45 · `ringArc|число 0.45 → 1.45|ef3480e9`
- **ringArc** · index.html:4642 · !== → === · `ringArc|!== → ===|485fe56d`
- **ringArc** · index.html:4642 · / → * · `ringArc|/ → *|485fe56d`
- **ringArc** · index.html:4642 · / → * · `ringArc|/ → *|485fe56d#2`
- **ringArc** · index.html:4643 · * → / · `ringArc|* → /|ce788650`
- **ringArc** · index.html:4643 · * → / · `ringArc|* → /|ce788650#2`
- **ringArc** · index.html:4643 · * → / · `ringArc|* → /|ce788650#3`
- **ringArc** · index.html:4643 · * → / · `ringArc|* → /|ce788650#4`
- **cornerArc** · index.html:4655 · && → || · `cornerArc|&& → |||22b6d176`
- **cornerArc** · index.html:4655 · !== → === · `cornerArc|!== → ===|22b6d176#2`
- **cornerArc** · index.html:4657 · убран Math.abs · `cornerArc|убран Math.abs|f40add72`
- **cornerArc** · index.html:4657 · > → >= · `cornerArc|> → >=|f40add72`
- **cornerArc** · index.html:4657 · число 120 → 121 · `cornerArc|число 120 → 121|f40add72`
- **cornerArc** · index.html:4658 · число 0.9 → 1.9 · `cornerArc|число 0.9 → 1.9|9398c8dc`
- **cornerArc** · index.html:4658 · * → / · `cornerArc|* → /|9398c8dc`
- **cornerArc** · index.html:4658 · число 4 → 5 · `cornerArc|число 4 → 5|9398c8dc`
- **cornerArc** · index.html:4658 · число 7 → 8 · `cornerArc|число 7 → 8|9398c8dc`
- **cornerArc** · index.html:4659 · * → / · `cornerArc|* → /|3c539284`
- **cornerArc** · index.html:4659 · * → / · `cornerArc|* → /|3c539284#2`
- **cornerArc** · index.html:4659 · * → / · `cornerArc|* → /|3c539284#3`
- **cornerArc** · index.html:4659 · * → / · `cornerArc|* → /|3c539284#4`
- **cornerArc** · index.html:4660 · число 1 → 0 · `cornerArc|число 1 → 0|57c01c14`
- **cornerArc** · index.html:4660 · <= → < · `cornerArc|<= → <|57c01c14`
- **cornerArc** · index.html:4660 · число 14 → 15 · `cornerArc|число 14 → 15|57c01c14`
- **cornerArc** · index.html:4660 · / → * · `cornerArc|/ → *|57c01c14`
- **cornerArc** · index.html:4660 · число 15 → 16 · `cornerArc|число 15 → 16|57c01c14`
- **cornerArc** · index.html:4660 · число 1 → 0 · `cornerArc|число 1 → 0|57c01c14#2`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#2`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#3`
- **cornerArc** · index.html:4661 · число 3 → 4 · `cornerArc|число 3 → 4|989eb35e`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#4`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#5`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#6`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#7`
- **cornerArc** · index.html:4661 · число 3 → 4 · `cornerArc|число 3 → 4|989eb35e#2`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#8`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#9`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#10`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#11`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#12`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#13`
- **cornerArc** · index.html:4661 · * → / · `cornerArc|* → /|989eb35e#14`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#2`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#3`
- **cornerArc** · index.html:4662 · число 3 → 4 · `cornerArc|число 3 → 4|a54ac033`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#4`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#5`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#6`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#7`
- **cornerArc** · index.html:4662 · число 3 → 4 · `cornerArc|число 3 → 4|a54ac033#2`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#8`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#9`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#10`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#11`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#12`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#13`
- **cornerArc** · index.html:4662 · * → / · `cornerArc|* → /|a54ac033#14`
- **cornerArc** · index.html:4665 · * → / · `cornerArc|* → /|a212b698#2`
- **cornerArc** · index.html:4666 · убран Math.abs · `cornerArc|убран Math.abs|af4afb62`
- **cornerArc** · index.html:4666 · < → <= · `cornerArc|< → <=|af4afb62`
- **cornerArc** · index.html:4668 · / → * · `cornerArc|/ → *|87605975`
- **cornerArc** · index.html:4669 · * → / · `cornerArc|* → /|7d97173a#2`
- **cornerArc** · index.html:4669 · / → * · `cornerArc|/ → *|7d97173a`
- **cornerArc** · index.html:4670 · > → >= · `cornerArc|> → >=|880cafc0`
- **cornerArc** · index.html:4670 · число 0.3 → 1.3 · `cornerArc|число 0.3 → 1.3|880cafc0`
- **cornerArc** · index.html:4670 · && → || · `cornerArc|&& → |||880cafc0`
- **cornerArc** · index.html:4670 · > → >= · `cornerArc|> → >=|880cafc0#2`

…и ещё 687. Разбирают по функциям: `--only <имя>`.