# Мутационное тестирование расчётного ядра
Прогон: 2026-10-11 19:49 UTC
Область: `tools/mutation-zone.json`. Убивают `tools/units.js` и `@domain`-сценарии.
**Убито 567 из 1415 — 40.1 %** (порог 39.1 %)
Эквивалентных, не в счёт: 4
| Функция | Выжило |
|---|---|
| `violationsTick` | 194 |
| `stepCar` | 83 |
| `cornerArc` | 74 |
| `trafBlock` | 66 |
| `cityRoute` | 48 |
| `clearances` | 46 |
| `ringArc` | 42 |
| `trafConflict` | 34 |
| `trafficGap` | 24 |
| `trafLight` | 21 |
| `trafPath` | 19 |
| `polyMTV` | 18 |
| `goalPoseOk` | 18 |
| `groundH` | 17 |
| `edgeRun` | 17 |
| `satMTV` | 15 |
| `blindZone` | 12 |
| `citySnap` | 10 |
| `trafPose` | 10 |
| `ackermann` | 8 |
| `TRAF` | 8 |
| `carExtent` | 8 |
| `trafKey` | 7 |
| `obsShape` | 6 |
| `castMin` | 6 |
| `carLift` | 5 |
| `rayOBB` | 5 |
| `cityPathNodes` | 4 |
| `lightPhase` | 4 |
| `TRAF_SPACING` | 4 |
| `trafSpeed` | 3 |
| `YIELD_TCA` | 3 |
| `laneOffset` | 2 |
| `GAP_AHEAD` | 2 |
| `roadHW` | 1 |
| `ROUTE_STEP` | 1 |
| `LANE_SHIFT` | 1 |
| `STOP_V` | 1 |
| `examPenalty` | 1 |
## Выжившие
- **groundH** · index.html:884 · число 0 → 1 · `groundH|число 0 → 1|f29e4733`
- **groundH** · index.html:886 · * → / · `groundH|* → /|43c5f42b#2`
- **groundH** · index.html:889 · < → <= · `groundH|< → <=|b4be828d`
- **groundH** · index.html:889 · число 6 → 7 · `groundH|число 6 → 7|b4be828d`
- **groundH** · index.html:889 · || → && · `groundH||| → &&|b4be828d`
- **groundH** · index.html:889 · > → >= · `groundH|> → >=|b4be828d`
- **groundH** · index.html:889 · число 6 → 7 · `groundH|число 6 → 7|b4be828d#2`
- **groundH** · index.html:889 · убран Math.abs · `groundH|убран Math.abs|b4be828d`
- **groundH** · index.html:889 · * → / · `groundH|* → /|b4be828d`
- **groundH** · index.html:889 · * → / · `groundH|* → /|b4be828d#2`
- **groundH** · index.html:889 · > → >= · `groundH|> → >=|b4be828d#2`
- **groundH** · index.html:889 · число 6 → 7 · `groundH|число 6 → 7|b4be828d#3`
- **groundH** · index.html:890 · === → !== · `groundH|=== → !==|11cb2541`
- **groundH** · index.html:890 · * → / · `groundH|* → /|11cb2541`
- **groundH** · index.html:890 · min → max · `groundH|min → max|11cb2541`
- **groundH** · index.html:890 · max → min · `groundH|max → min|11cb2541`
- **groundH** · index.html:890 · число 0 → 1 · `groundH|число 0 → 1|11cb2541`
- **carLift** · index.html:920 · число 0 → 1 · `carLift|число 0 → 1|4d23a056`
- **carLift** · index.html:921 · + → - · `carLift|+ → -|e6b045c0`
- **carLift** · index.html:921 · * → / · `carLift|* → /|e6b045c0`
- **carLift** · index.html:921 · * → / · `carLift|* → /|e6b045c0#2`
- **carLift** · index.html:921 · * → / · `carLift|* → /|e6b045c0#3`
- **ackermann** · index.html:1953 · убран Math.abs · `ackermann|убран Math.abs|cf58aadf`
- **ackermann** · index.html:1953 · < → <= · `ackermann|< → <=|cf58aadf`
- **ackermann** · index.html:1953 · число 4 → 5 · `ackermann|число 4 → 5|cf58aadf`
- **ackermann** · index.html:1953 · число 0 → 1 · `ackermann|число 0 → 1|cf58aadf`
- **ackermann** · index.html:1953 · число 0 → 1 · `ackermann|число 0 → 1|cf58aadf#2`
- **ackermann** · index.html:1954 · / → * · `ackermann|/ → *|ac2f0db2#2`
- **ackermann** · index.html:1954 · число 2 → 3 · `ackermann|число 2 → 3|ac2f0db2`
- **ackermann** · index.html:1955 · / → * · `ackermann|/ → *|f40f84b8#2`
- **roadHW** · index.html:3561 · число 1 → 0 · `roadHW|число 1 → 0|d430bd8f`
- **ROUTE_STEP** · index.html:4755 · число 2.0 → 3 · `ROUTE_STEP|число 2.0 → 3|18bf5964`
- **LANE_SHIFT** · index.html:4756 · число 26 → 27 · `LANE_SHIFT|число 26 → 27|cff03092`
- **citySnap** · index.html:4768 · > → >= · `citySnap|> → >=|72c71778`
- **citySnap** · index.html:4768 · число 1 → 0 · `citySnap|число 1 → 0|72c71778`
- **citySnap** · index.html:4771 · число 5.5 → 6.5 · `citySnap|число 5.5 → 6.5|812f1bd6`
- **citySnap** · index.html:4771 · число 0.8 → 1.8 · `citySnap|число 0.8 → 1.8|812f1bd6`
- **citySnap** · index.html:4772 · * → / · `citySnap|* → /|9ae08c16`
- **citySnap** · index.html:4772 · * → / · `citySnap|* → /|9ae08c16#2`
- **citySnap** · index.html:4772 · число 0 → 1 · `citySnap|число 0 → 1|9ae08c16`
- **citySnap** · index.html:4776 · < → <= · `citySnap|< → <=|c2c82177`
- **citySnap** · index.html:4776 · число 6 → 7 · `citySnap|число 6 → 7|c2c82177`
- **citySnap** · index.html:4779 · < → <= · `citySnap|< → <=|4849c5e7`
- **laneOffset** · index.html:4791 · * → / · `laneOffset|* → /|b86a905e`
- **laneOffset** · index.html:4791 · число 0.5 → 1.5 · `laneOffset|число 0.5 → 1.5|b86a905e`
- **cityPathNodes** · index.html:4802 · < → <= · `cityPathNodes|< → <=|8f88c82f`
- **cityPathNodes** · index.html:4807 · >= → > · `cityPathNodes|>= → >|6f1156fd`
- **cityPathNodes** · index.html:4812 · < → <= · `cityPathNodes|< → <=|510e1fed`
- **cityPathNodes** · index.html:4813 · || → && · `cityPathNodes||| → &&|deaf0f5c`
- **ringArc** · index.html:4827 · число 2 → 3 · `ringArc|число 2 → 3|4b24cec7`
- **ringArc** · index.html:4827 · число 3.5 → 4.5 · `ringArc|число 3.5 → 4.5|4b24cec7`
- **ringArc** · index.html:4830 · убран Math.abs · `ringArc|убран Math.abs|c5692fba`
- **ringArc** · index.html:4830 · > → >= · `ringArc|> → >=|c5692fba`
- **ringArc** · index.html:4830 · число 0.5 → 1.5 · `ringArc|число 0.5 → 1.5|c5692fba`
- **ringArc** · index.html:4830 · убран Math.abs · `ringArc|убран Math.abs|c5692fba#2`
- **ringArc** · index.html:4830 · > → >= · `ringArc|> → >=|c5692fba#2`
- **ringArc** · index.html:4830 · число 0.5 → 1.5 · `ringArc|число 0.5 → 1.5|c5692fba#2`
- **ringArc** · index.html:4831 · <= → < · `ringArc|<= → <|013e951b`
- **ringArc** · index.html:4831 · число 0.05 → 1.05 · `ringArc|число 0.05 → 1.05|013e951b`
- **ringArc** · index.html:4831 · > → >= · `ringArc|> → >=|013e951b`
- **ringArc** · index.html:4832 · min → max · `ringArc|min → max|3e097f3c`
- **ringArc** · index.html:4832 · число 6 → 7 · `ringArc|число 6 → 7|3e097f3c`
- **ringArc** · index.html:4832 · / → * · `ringArc|/ → *|3e097f3c`
- **ringArc** · index.html:4832 · * → / · `ringArc|* → /|3e097f3c`
- **ringArc** · index.html:4832 · число 0.4 → 1.4 · `ringArc|число 0.4 → 1.4|3e097f3c`
- **ringArc** · index.html:4835 · число 1 → 0 · `ringArc|число 1 → 0|ead38b0f`
- **ringArc** · index.html:4835 · <= → < · `ringArc|<= → <|ead38b0f`
- **ringArc** · index.html:4835 · число 8 → 9 · `ringArc|число 8 → 9|ead38b0f`
- **ringArc** · index.html:4835 · число 9 → 10 · `ringArc|число 9 → 10|ead38b0f`
- **ringArc** · index.html:4837 · число 3 → 4 · `ringArc|число 3 → 4|77bfbadc`
- **ringArc** · index.html:4839 · число 0.45 → 1.45 · `ringArc|число 0.45 → 1.45|fbabed17`
- **ringArc** · index.html:4840 · !== → === · `ringArc|!== → ===|7650c3ad`
- **ringArc** · index.html:4840 · / → * · `ringArc|/ → *|7650c3ad`
- **ringArc** · index.html:4840 · / → * · `ringArc|/ → *|7650c3ad#2`
- **ringArc** · index.html:4841 · * → / · `ringArc|* → /|faf41145`
- **ringArc** · index.html:4841 · * → / · `ringArc|* → /|faf41145#2`
- **ringArc** · index.html:4841 · * → / · `ringArc|* → /|faf41145#3`
- **ringArc** · index.html:4841 · * → / · `ringArc|* → /|faf41145#4`
- **ringArc** · index.html:4847 · число 2 → 3 · `ringArc|число 2 → 3|c85645ff`
- **ringArc** · index.html:4847 · число 5 → 6 · `ringArc|число 5 → 6|c85645ff`
- **ringArc** · index.html:4848 · число 1 → 0 · `ringArc|число 1 → 0|ccfe5ca0`
- **ringArc** · index.html:4848 · число 0 → 1 · `ringArc|число 0 → 1|ccfe5ca0`
- **ringArc** · index.html:4848 · <= → < · `ringArc|<= → <|ccfe5ca0`
- **ringArc** · index.html:4850 · число 0.45 → 1.45 · `ringArc|число 0.45 → 1.45|ef3480e9`
- **ringArc** · index.html:4851 · !== → === · `ringArc|!== → ===|485fe56d`
- **ringArc** · index.html:4851 · / → * · `ringArc|/ → *|485fe56d`
- **ringArc** · index.html:4851 · / → * · `ringArc|/ → *|485fe56d#2`
- **ringArc** · index.html:4852 · * → / · `ringArc|* → /|ce788650`
- **ringArc** · index.html:4852 · * → / · `ringArc|* → /|ce788650#2`
- **ringArc** · index.html:4852 · * → / · `ringArc|* → /|ce788650#3`
- **ringArc** · index.html:4852 · * → / · `ringArc|* → /|ce788650#4`
- **cornerArc** · index.html:4864 · !== → === · `cornerArc|!== → ===|22b6d176`
- **cornerArc** · index.html:4864 · && → || · `cornerArc|&& → |||22b6d176`
- **cornerArc** · index.html:4864 · !== → === · `cornerArc|!== → ===|22b6d176#2`
- **cornerArc** · index.html:4866 · убран Math.abs · `cornerArc|убран Math.abs|f40add72`
- **cornerArc** · index.html:4866 · > → >= · `cornerArc|> → >=|f40add72`
- **cornerArc** · index.html:4866 · число 120 → 121 · `cornerArc|число 120 → 121|f40add72`
- **cornerArc** · index.html:4867 · число 0.9 → 1.9 · `cornerArc|число 0.9 → 1.9|9398c8dc`
- **cornerArc** · index.html:4867 · * → / · `cornerArc|* → /|9398c8dc`
- **cornerArc** · index.html:4867 · число 4 → 5 · `cornerArc|число 4 → 5|9398c8dc`
- **cornerArc** · index.html:4867 · число 7 → 8 · `cornerArc|число 7 → 8|9398c8dc`
- **cornerArc** · index.html:4868 · * → / · `cornerArc|* → /|3c539284`
- **cornerArc** · index.html:4868 · * → / · `cornerArc|* → /|3c539284#2`
- **cornerArc** · index.html:4868 · * → / · `cornerArc|* → /|3c539284#3`
- **cornerArc** · index.html:4868 · * → / · `cornerArc|* → /|3c539284#4`
- **cornerArc** · index.html:4869 · число 1 → 0 · `cornerArc|число 1 → 0|57c01c14`
- **cornerArc** · index.html:4869 · <= → < · `cornerArc|<= → <|57c01c14`
- **cornerArc** · index.html:4869 · число 14 → 15 · `cornerArc|число 14 → 15|57c01c14`
- **cornerArc** · index.html:4869 · / → * · `cornerArc|/ → *|57c01c14`
- **cornerArc** · index.html:4869 · число 15 → 16 · `cornerArc|число 15 → 16|57c01c14`
- **cornerArc** · index.html:4869 · число 1 → 0 · `cornerArc|число 1 → 0|57c01c14#2`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#2`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#3`
- **cornerArc** · index.html:4870 · число 3 → 4 · `cornerArc|число 3 → 4|989eb35e`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#4`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#5`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#6`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#7`
- **cornerArc** · index.html:4870 · число 3 → 4 · `cornerArc|число 3 → 4|989eb35e#2`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#8`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#9`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#10`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#11`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#12`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#13`
- **cornerArc** · index.html:4870 · * → / · `cornerArc|* → /|989eb35e#14`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#2`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#3`
- **cornerArc** · index.html:4871 · число 3 → 4 · `cornerArc|число 3 → 4|a54ac033`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#4`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#5`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#6`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#7`
- **cornerArc** · index.html:4871 · число 3 → 4 · `cornerArc|число 3 → 4|a54ac033#2`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#8`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#9`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#10`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#11`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#12`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#13`
- **cornerArc** · index.html:4871 · * → / · `cornerArc|* → /|a54ac033#14`
- **cornerArc** · index.html:4874 · * → / · `cornerArc|* → /|a212b698`
- **cornerArc** · index.html:4874 · * → / · `cornerArc|* → /|a212b698#2`
- **cornerArc** · index.html:4875 · убран Math.abs · `cornerArc|убран Math.abs|af4afb62`
- **cornerArc** · index.html:4875 · < → <= · `cornerArc|< → <=|af4afb62`
- **cornerArc** · index.html:4877 · / → * · `cornerArc|/ → *|87605975`
- **cornerArc** · index.html:4878 · * → / · `cornerArc|* → /|7d97173a`
- **cornerArc** · index.html:4878 · * → / · `cornerArc|* → /|7d97173a#2`

…и ещё 698. Разбирают по функциям: `--only <имя>`.