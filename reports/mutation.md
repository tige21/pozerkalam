# Мутационное тестирование расчётного ядра
Прогон: 2026-09-23 17:38 UTC
Область: `tools/mutation-zone.json`. Убивают `tools/units.js` и `@domain`-сценарии.
**Убито 419 из 1175 — 35.7 %** (порог 33.9 %)
Эквивалентных, не в счёт: 3
| Функция | Выжило |
|---|---|
| `violationsTick` | 184 |
| `stepCar` | 90 |
| `trafBlock` | 62 |
| `clearances` | 46 |
| `cityRoute` | 36 |
| `trafConflict` | 33 |
| `trafficGap` | 23 |
| `polyMTV` | 22 |
| `trafLight` | 21 |
| `trafPath` | 19 |
| `edgeRun` | 18 |
| `satMTV` | 18 |
| `goalPoseOk` | 18 |
| `trafPose` | 12 |
| `blindZone` | 12 |
| `hull2` | 12 |
| `groundH` | 11 |
| `citySnap` | 11 |
| `ringArc` | 10 |
| `TRAF` | 9 |
| `ackermann` | 8 |
| `carExtent` | 8 |
| `rayOBB` | 8 |
| `trafKey` | 7 |
| `obsShape` | 7 |
| `castMin` | 6 |
| `carLift` | 5 |
| `cityPathNodes` | 5 |
| `cornerArc` | 4 |
| `lightPhase` | 3 |
| `GAP_AHEAD` | 3 |
| `TRAF_SPACING` | 3 |
| `trafSpeed` | 3 |
| `YIELD_TCA` | 3 |
| `steerRateNow` | 2 |
| `roadHW` | 2 |
| `laneOffset` | 2 |
| `LIGHT_CYCLE` | 2 |
| `carHullPts` | 2 |
| `ROUTE_STEP` | 1 |
| `LANE_SHIFT` | 1 |
| `lanePt` | 1 |
| `STOP_V` | 1 |
| `examPenalty` | 1 |
| `shadowPoly` | 1 |
## Выжившие
- **groundH** · index.html:580 · число 0 → 1 · `groundH|число 0 → 1|f29e4733`
- **groundH** · index.html:582 · * → / · `groundH|* → /|43c5f42b#2`
- **groundH** · index.html:583 · < → <= · `groundH|< → <=|71ff08f5`
- **groundH** · index.html:583 · число 0 → 1 · `groundH|число 0 → 1|71ff08f5`
- **groundH** · index.html:583 · > → >= · `groundH|> → >=|71ff08f5`
- **groundH** · index.html:583 · убран Math.abs · `groundH|убран Math.abs|71ff08f5`
- **groundH** · index.html:583 · * → / · `groundH|* → /|71ff08f5`
- **groundH** · index.html:583 · * → / · `groundH|* → /|71ff08f5#2`
- **groundH** · index.html:583 · > → >= · `groundH|> → >=|71ff08f5#2`
- **groundH** · index.html:584 · === → !== · `groundH|=== → !==|f120c374`
- **groundH** · index.html:584 · * → / · `groundH|* → /|f120c374`
- **carLift** · index.html:614 · число 0 → 1 · `carLift|число 0 → 1|4d23a056`
- **carLift** · index.html:615 · + → - · `carLift|+ → -|e6b045c0`
- **carLift** · index.html:615 · * → / · `carLift|* → /|e6b045c0`
- **carLift** · index.html:615 · * → / · `carLift|* → /|e6b045c0#2`
- **carLift** · index.html:615 · * → / · `carLift|* → /|e6b045c0#3`
- **steerRateNow** · index.html:1037 · убран Math.abs · `steerRateNow|убран Math.abs|fdfb8f00`
- **steerRateNow** · index.html:1037 · / → * · `steerRateNow|/ → *|fdfb8f00`
- **ackermann** · index.html:1055 · убран Math.abs · `ackermann|убран Math.abs|cf58aadf`
- **ackermann** · index.html:1055 · < → <= · `ackermann|< → <=|cf58aadf`
- **ackermann** · index.html:1055 · число 4 → 5 · `ackermann|число 4 → 5|cf58aadf`
- **ackermann** · index.html:1055 · число 0 → 1 · `ackermann|число 0 → 1|cf58aadf`
- **ackermann** · index.html:1055 · число 0 → 1 · `ackermann|число 0 → 1|cf58aadf#2`
- **ackermann** · index.html:1056 · / → * · `ackermann|/ → *|ac2f0db2#2`
- **ackermann** · index.html:1056 · число 2 → 3 · `ackermann|число 2 → 3|ac2f0db2`
- **ackermann** · index.html:1057 · / → * · `ackermann|/ → *|f40f84b8#2`
- **roadHW** · index.html:1969 · число 0 → 1 · `roadHW|число 0 → 1|d430bd8f`
- **roadHW** · index.html:1969 · число 1 → 0 · `roadHW|число 1 → 0|d430bd8f`
- **ROUTE_STEP** · index.html:2164 · число 2.0 → 3 · `ROUTE_STEP|число 2.0 → 3|18bf5964`
- **LANE_SHIFT** · index.html:2165 · число 26 → 27 · `LANE_SHIFT|число 26 → 27|cff03092`
- **citySnap** · index.html:2174 · > → >= · `citySnap|> → >=|72c71778`
- **citySnap** · index.html:2174 · число 1 → 0 · `citySnap|число 1 → 0|72c71778`
- **citySnap** · index.html:2177 · число 5.5 → 6.5 · `citySnap|число 5.5 → 6.5|812f1bd6`
- **citySnap** · index.html:2177 · число 0.8 → 1.8 · `citySnap|число 0.8 → 1.8|812f1bd6`
- **citySnap** · index.html:2178 · * → / · `citySnap|* → /|9ae08c16`
- **citySnap** · index.html:2178 · * → / · `citySnap|* → /|9ae08c16#2`
- **citySnap** · index.html:2178 · число 0 → 1 · `citySnap|число 0 → 1|9ae08c16`
- **citySnap** · index.html:2182 · < → <= · `citySnap|< → <=|c2c82177`
- **citySnap** · index.html:2182 · число 6 → 7 · `citySnap|число 6 → 7|c2c82177`
- **citySnap** · index.html:2184 · * → / · `citySnap|* → /|1fcda6c7`
- **citySnap** · index.html:2185 · < → <= · `citySnap|< → <=|4849c5e7`
- **laneOffset** · index.html:2196 · * → / · `laneOffset|* → /|b86a905e`
- **laneOffset** · index.html:2196 · число 0.5 → 1.5 · `laneOffset|число 0.5 → 1.5|b86a905e`
- **cityPathNodes** · index.html:2207 · < → <= · `cityPathNodes|< → <=|8f88c82f`
- **cityPathNodes** · index.html:2212 · || → && · `cityPathNodes||| → &&|6f1156fd`
- **cityPathNodes** · index.html:2212 · >= → > · `cityPathNodes|>= → >|6f1156fd`
- **cityPathNodes** · index.html:2217 · < → <= · `cityPathNodes|< → <=|510e1fed`
- **cityPathNodes** · index.html:2218 · || → && · `cityPathNodes||| → &&|deaf0f5c`
- **ringArc** · index.html:2227 · число 2 → 3 · `ringArc|число 2 → 3|4b24cec7`
- **ringArc** · index.html:2227 · число 3.5 → 4.5 · `ringArc|число 3.5 → 4.5|4b24cec7`
- **ringArc** · index.html:2229 · <= → < · `ringArc|<= → <|013e951b`
- **ringArc** · index.html:2229 · число 0.05 → 1.05 · `ringArc|число 0.05 → 1.05|013e951b`
- **ringArc** · index.html:2229 · > → >= · `ringArc|> → >=|013e951b`
- **ringArc** · index.html:2230 · число 2 → 3 · `ringArc|число 2 → 3|8485dd47`
- **ringArc** · index.html:2230 · число 12 → 13 · `ringArc|число 12 → 13|8485dd47`
- **ringArc** · index.html:2231 · число 0 → 1 · `ringArc|число 0 → 1|4a07665c`
- **ringArc** · index.html:2231 · <= → < · `ringArc|<= → <|4a07665c`
- **ringArc** · index.html:2231 · / → * · `ringArc|/ → *|4a07665c`
- **cornerArc** · index.html:2237 · число 1 → 0 · `cornerArc|число 1 → 0|18267ba4`
- **cornerArc** · index.html:2237 · <= → < · `cornerArc|<= → <|18267ba4`
- **cornerArc** · index.html:2237 · число 6 → 7 · `cornerArc|число 6 → 7|18267ba4`
- **cornerArc** · index.html:2237 · число 7 → 8 · `cornerArc|число 7 → 8|18267ba4`
- **lanePt** · index.html:2243 · * → / · `lanePt|* → /|b68425e2#4`
- **edgeRun** · index.html:2247 · >= → > · `edgeRun|>= → >|28c8c22a`
- **edgeRun** · index.html:2247 · * → / · `edgeRun|* → /|28c8c22a`
- **edgeRun** · index.html:2247 · * → / · `edgeRun|* → /|28c8c22a#2`
- **edgeRun** · index.html:2248 · убран Math.abs · `edgeRun|убран Math.abs|e1c7ee1c`
- **edgeRun** · index.html:2248 · число 1 → 0 · `edgeRun|число 1 → 0|e1c7ee1c`
- **edgeRun** · index.html:2248 · / → * · `edgeRun|/ → *|e1c7ee1c`
- **edgeRun** · index.html:2251 · min → max · `edgeRun|min → max|3a3e8d61`
- **edgeRun** · index.html:2251 · || → && · `edgeRun||| → &&|3a3e8d61`
- **edgeRun** · index.html:2251 · число 1 → 0 · `edgeRun|число 1 → 0|3a3e8d61`
- **edgeRun** · index.html:2252 · число 0 → 1 · `edgeRun|число 0 → 1|2ac8f4bf`
- **edgeRun** · index.html:2252 · <= → < · `edgeRun|<= → <|2ac8f4bf`
- **edgeRun** · index.html:2254 · число 0 → 1 · `edgeRun|число 0 → 1|c9de28b2`
- **edgeRun** · index.html:2254 · убран Math.abs · `edgeRun|убран Math.abs|c9de28b2`
- **edgeRun** · index.html:2254 · / → * · `edgeRun|/ → *|c9de28b2`
- **edgeRun** · index.html:2254 · число 0 → 1 · `edgeRun|число 0 → 1|c9de28b2#2`
- **edgeRun** · index.html:2255 · * → / · `edgeRun|* → /|daddddc3#3`
- **edgeRun** · index.html:2255 · число 3 → 4 · `edgeRun|число 3 → 4|daddddc3`
- **edgeRun** · index.html:2255 · число 2 → 3 · `edgeRun|число 2 → 3|daddddc3`
- **cityRoute** · index.html:2264 · || → && · `cityRoute||| → &&|bc326bc6`
- **cityRoute** · index.html:2266 · && → || · `cityRoute|&& → |||f89ca84e`
- **cityRoute** · index.html:2266 · === → !== · `cityRoute|=== → !==|f89ca84e`
- **cityRoute** · index.html:2269 · число 0 → 1 · `cityRoute|число 0 → 1|18002626`
- **cityRoute** · index.html:2269 · число 1 → 0 · `cityRoute|число 1 → 0|18002626`
- **cityRoute** · index.html:2269 · < → <= · `cityRoute|< → <=|18002626`
- **cityRoute** · index.html:2269 · число 1 → 0 · `cityRoute|число 1 → 0|18002626#2`
- **cityRoute** · index.html:2269 · число 1 → 0 · `cityRoute|число 1 → 0|18002626#3`
- **cityRoute** · index.html:2270 · > → >= · `cityRoute|> → >=|3d3fdda0`
- **cityRoute** · index.html:2270 · число 1 → 0 · `cityRoute|число 1 → 0|3d3fdda0`
- **cityRoute** · index.html:2276 · число 0 → 1 · `cityRoute|число 0 → 1|27af231e`
- **cityRoute** · index.html:2277 · max → min · `cityRoute|max → min|99f36c1e`
- **cityRoute** · index.html:2277 · число 0 → 1 · `cityRoute|число 0 → 1|99f36c1e`
- **cityRoute** · index.html:2281 · число 0 → 1 · `cityRoute|число 0 → 1|908411c8`
- **cityRoute** · index.html:2283 · && → || · `cityRoute|&& → |||73bffb6d`
- **cityRoute** · index.html:2283 · === → !== · `cityRoute|=== → !==|73bffb6d`
- **cityRoute** · index.html:2283 · || → && · `cityRoute||| → &&|73bffb6d`
- **cityRoute** · index.html:2283 · && → || · `cityRoute|&& → |||73bffb6d#2`
- **cityRoute** · index.html:2283 · === → !== · `cityRoute|=== → !==|73bffb6d#2`
- **cityRoute** · index.html:2284 · число 0 → 1 · `cityRoute|число 0 → 1|8c366eda`
- **cityRoute** · index.html:2284 · число 0 → 1 · `cityRoute|число 0 → 1|8c366eda#2`
- **cityRoute** · index.html:2287 · число 0 → 1 · `cityRoute|число 0 → 1|57f941b7`
- **cityRoute** · index.html:2292 · > → >= · `cityRoute|> → >=|434881be`
- **cityRoute** · index.html:2292 · число 0.05 → 1.05 · `cityRoute|число 0.05 → 1.05|434881be`
- **cityRoute** · index.html:2299 · >= → > · `cityRoute|>= → >|d761dce6`
- **cityRoute** · index.html:2303 · число 0.6 → 1.6 · `cityRoute|число 0.6 → 1.6|a73da5d0`
- **cityRoute** · index.html:2304 · число 0.6 → 1.6 · `cityRoute|число 0.6 → 1.6|0f2197e2`
- **cityRoute** · index.html:2307 · * → / · `cityRoute|* → /|e73bb0de`
- **cityRoute** · index.html:2307 · <= → < · `cityRoute|<= → <|e73bb0de`
- **cityRoute** · index.html:2307 · число 0.2 → 1.2 · `cityRoute|число 0.2 → 1.2|e73bb0de`
- **cityRoute** · index.html:2308 · * → / · `cityRoute|* → /|c05d72f9`
- **cityRoute** · index.html:2310 · убран Math.abs · `cityRoute|убран Math.abs|aed68bf8`
- **cityRoute** · index.html:2315 · < → <= · `cityRoute|< → <=|7c896d89`
- **cityRoute** · index.html:2315 · число 2 → 3 · `cityRoute|число 2 → 3|7c896d89`
- **cityRoute** · index.html:2316 · число 0 → 1 · `cityRoute|число 0 → 1|4d588bbf`
- **cityRoute** · index.html:2317 · число 1 → 0 · `cityRoute|число 1 → 0|a50f59d8#2`
- **LIGHT_CYCLE** · index.html:2361 · число 10 → 11 · `LIGHT_CYCLE|число 10 → 11|6f7ff269`
- **LIGHT_CYCLE** · index.html:2361 · число 2 → 3 · `LIGHT_CYCLE|число 2 → 3|6f7ff269`
- **lightPhase** · index.html:2368 · число 2 → 3 · `lightPhase|число 2 → 3|75b9b3e7`
- **lightPhase** · index.html:2370 · < → <= · `lightPhase|< → <=|d8eb39ca`
- **lightPhase** · index.html:2370 · < → <= · `lightPhase|< → <=|d8eb39ca#2`
- **GAP_AHEAD** · index.html:2440 · число 6.0 → 7 · `GAP_AHEAD|число 6.0 → 7|47975865`
- **GAP_AHEAD** · index.html:2440 · число 6.5 → 7.5 · `GAP_AHEAD|число 6.5 → 7.5|47975865`
- **GAP_AHEAD** · index.html:2440 · число 9 → 10 · `GAP_AHEAD|число 9 → 10|47975865`
- **trafficGap** · index.html:2442 · || → && · `trafficGap||| → &&|694f49f5`
- **trafficGap** · index.html:2442 · * → / · `trafficGap|* → /|694f49f5`
- **trafficGap** · index.html:2443 · число 99 → 100 · `trafficGap|число 99 → 100|bdbc8812`
- **trafficGap** · index.html:2446 · || → && · `trafficGap||| → &&|bd3c3b40`
- **trafficGap** · index.html:2446 · убран Math.abs · `trafficGap|убран Math.abs|bd3c3b40`
- **trafficGap** · index.html:2446 · < → <= · `trafficGap|< → <=|bd3c3b40`
- **trafficGap** · index.html:2446 · число 0.3 → 1.3 · `trafficGap|число 0.3 → 1.3|bd3c3b40`
- **trafficGap** · index.html:2448 · * → / · `trafficGap|* → /|6360fe7f#2`
- **trafficGap** · index.html:2448 · < → <= · `trafficGap|< → <=|6360fe7f`
- **trafficGap** · index.html:2448 · число 0 → 1 · `trafficGap|число 0 → 1|6360fe7f`
- **trafficGap** · index.html:2448 · && → || · `trafficGap|&& → |||6360fe7f`
- **trafficGap** · index.html:2448 · убран Math.abs · `trafficGap|убран Math.abs|6360fe7f`
- **trafficGap** · index.html:2448 · < → <= · `trafficGap|< → <=|6360fe7f#2`
- **trafficGap** · index.html:2448 · число 60 → 61 · `trafficGap|число 60 → 61|6360fe7f`
- **trafficGap** · index.html:2449 · число 0.5 → 1.5 · `trafficGap|число 0.5 → 1.5|6dccb7d1`
- **trafficGap** · index.html:2449 · убран Math.abs · `trafficGap|убран Math.abs|6dccb7d1`
- **trafficGap** · index.html:2450 · число 0.5 → 1.5 · `trafficGap|число 0.5 → 1.5|05ff361b`
- **trafficGap** · index.html:2450 · <= → < · `trafficGap|<= → <|05ff361b`
- **trafficGap** · index.html:2452 · * → / · `trafficGap|* → /|0cef4ba1`
- **trafficGap** · index.html:2453 · * → / · `trafficGap|* → /|dcd1e70e#3`
- **trafficGap** · index.html:2453 · * → / · `trafficGap|* → /|dcd1e70e#4`
- **trafficGap** · index.html:2454 · <= → < · `trafficGap|<= → <|f9a4bc4c`
- **trafficGap** · index.html:2454 · < → <= · `trafficGap|< → <=|f9a4bc4c`
- **TRAF** · index.html:2509 · число 6.2 → 7.2 · `TRAF|число 6.2 → 7.2|0e767420`
- **TRAF** · index.html:2509 · число 1.3 → 2.3 · `TRAF|число 1.3 → 2.3|0e767420`

…и ещё 606. Разбирают по функциям: `--only <имя>`.