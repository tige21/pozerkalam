# Бриф на генерацию: разные машины, трамвай, небо (20 картинок)

Зачем: сейчас у всех машин одни и те же фары, фонари, решётка и диски, трамвай собран из
коробок, а небо — градиент. Форму машин держит модель `tools/blender/exterior.py`, поэтому
разнообразие даём деталями: ещё четыре стиля по четыре картинки. Цвет кузова по-прежнему
задаёт код. Порядок работы и правила — как в `docs/prompts/car-cabin-assets.md`: один новый чат,
файлы в `assets/src/`, строка в `assets/src/SOURCES.md` на каждую картинку.

**Что не генерируем.** Дорожные знаки, светофоры и разметку рисует код по ГОСТ: GPT искажает
пиктограммы и надписи, а тренажёр учит правилам. Фасады, деревья, пешеходов, автобус —
позже: им сначала нужна геометрия в игре (список в конце).

## Один промпт на всю серию

Вставь в новый чат ChatGPT целиком. Дальше — «дальше» или «redo: <что исправить>».

```
You are generating a numbered series of 20 images for a driving-school simulator game.
Generate exactly ONE image per reply, in the order below. Start with image 1 right away.
After each image write one line in Russian: the file name and «готово — пиши «дальше» или что
исправить». Wait for my reply before the next image.

RULES FOR EVERY IMAGE
- Fictional, generic design. It must not resemble any real production car, tram, manufacturer
  or city transport livery: no recognisable grille shapes, lighting signatures or colour schemes.
- No text, letters, numbers, logos, badges, emblems, coats of arms or license plates anywhere,
  including tyre sidewalls and tram destination displays.
- Clean, realistic, brand-new vehicles, no dirt, no wear.
- If I write "redo: ...", regenerate the same image with only that change.

RULES FOR CAR DETAILS (images 1-16)
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image width. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on it, no green colour anywhere on the object. Metal and chrome reflect
only a neutral grey studio, never the green background. Soft even studio light, no strong
highlights. Lights switched off. Square image.
Orientation is fixed for every style:
- headlight: the end that sits next to the grille is on the LEFT, the outer end (towards the
  car's corner) is on the RIGHT; any amber turn-signal segment sits at the RIGHT end.
- tail light: the outer end (towards the car's corner) is on the LEFT, the inner end is on the
  RIGHT; a small clear reversing section and a small amber turn section are stacked at the
  RIGHT end, together taking the rightmost fifth of the lamp.
- grille: wide low opening, the centre looks exactly like the sides (no badge area).
- wheel: seen exactly side-on, the axle pointing at the camera; the whole tyre is visible and
  the tyre circle fills about 95% of the image; smooth sidewall.

RULES FOR THE TRAM (images 17-19)
A fictional modern low-floor city tram, one consistent livery for all three images: white body,
a broad dark-grey window band, a red stripe along the bottom skirt, black rubber door seals.
Strictly orthographic view (no perspective), the body fills the frame width, background flat
solid pure green #00FF00 with no shadow, no green on the tram. Daylight, windows dark-tinted so
no interior is visible. Destination display is a plain dark blank panel, with nothing on it.

THE SERIES
--- style B «старый седан»: 1990s-style plain family sedan ---
1. dec-headlight-b.png. Rectangular halogen headlight with a clear ribbed glass lens and a thin
   chrome bezel, a small amber corner segment at the right end. Proportions 4 : 1 (width : height).
2. dec-taillight-b.png. Horizontal rectangular tail light with three straight bands: wide red,
   then clear and amber at the right end. Proportions 4.5 : 1.
3. dec-grille-b.png. Wide grille of five thin horizontal chrome bars on black. Proportions 5 : 1.
4. dec-wheel-b.png. 14-inch steel wheel with a plain silver plastic hubcap with simple round
   vents, black tyre, smooth sidewall.
--- style C «спортивный»: modern sporty hatchback ---
5. dec-headlight-c.png. Very slim angular LED headlight, dark smoked inner housing, a sharp
   LED strip along the top edge, amber segment at the right end. Proportions 4.5 : 1.
6. dec-taillight-c.png. Thin full-width LED tail light with a smoked dark lens and a thin red
   light line along its contour; small clear and amber sections at the right end. 5 : 1.
7. dec-grille-c.png. Black honeycomb mesh grille with a thin gloss-black frame. 5 : 1.
8. dec-wheel-c.png. 17-inch dark graphite alloy wheel with five twin spokes, low-profile tyre.
--- style D «семейный кроссовер»: friendly family crossover ---
9. dec-headlight-d.png. Taller headlight with two small round projectors side by side and a
   curved LED "eyebrow" above them, amber segment at the right end. Proportions 3.5 : 1.
10. dec-taillight-d.png. Rounded rectangular red lens with a C-shaped light guide inside; clear
    and amber sections at the right end. Proportions 4 : 1.
11. dec-grille-d.png. Grille of slim vertical satin-silver bars inside a thick dark frame. 4.5 : 1.
12. dec-wheel-d.png. 16-inch silver alloy wheel with ten thin straight spokes, plain centre cap.
--- style E «бюджетный хэтчбек»: simple low-cost hatchback ---
13. dec-headlight-e.png. Simple single-reflector headlight under a clear lens, plain black inner
    housing, amber segment at the right end. Proportions 3.5 : 1.
14. dec-taillight-e.png. Simple two-section tail light: red on the left two thirds, clear and
    amber stacked at the right end. Proportions 4 : 1.
15. dec-grille-e.png. Plain textured black plastic grille with two thin horizontal slats. 5 : 1.
16. dec-wheel-e.png. 14-inch black-painted steel wheel without a hubcap, four lug nuts and
    simple oval holes, black tyre.
--- tram ---
17. tram-front.png, portrait 2:3. The cab end of the tram seen strictly head-on: large slightly
    curved windshield, the blank dark destination panel above it, two headlights and two small
    red tail lights low on the front, a smooth bumper cover, the livery as described.
18. tram-side-end.png, landscape 3:2. Side view of the 4.7 m end section of the tram body, cab on
    the LEFT: the driver's side window, one passenger window and one double sliding door. The
    body is about 2 : 1 (length : height) and fills the frame width; the RIGHT edge of the body is
    cut straight vertically, so that image 19 continues it seamlessly. No wheels or bogies drawn
    below the red skirt.
19. tram-side-mid.png, landscape 3:2. Side view of a 4.7 m middle section of the same tram: two
    large passenger windows and one double sliding door in the middle. The body is about 2 : 1
    and fills the frame width; BOTH left and right edges are cut straight vertically, and the
    window band and the red stripe are at exactly the same heights as in image 18, so the
    sections join seamlessly side by side. No wheels or bogies.
--- sky ---
20. sky-pano.png, landscape 3:2. A panoramic daytime sky over a flat horizon: light blue sky with
    soft scattered fair-weather clouds, brighter and hazier towards the horizon; along the
    bottom 12% a very distant low city skyline silhouette in pale bluish haze (generic blocks,
    no recognisable landmarks). Seamless left-right: the left and right edges must match so the
    image can wrap around 360 degrees. No sun disc, no birds, no aircraft.
```

## Как это ляжет в игру

| Группа | Где в игре | Что учесть при приёмке |
|---|---|---|
| Стили B–E | каждой машине стиль по номеру (у соседних разные); ваш стиль A остаётся у своей машины | ориентация: у фары линза у решётки слева, у фонаря белое и жёлтое справа — по этим местам горят задний ход и поворотники |
| Колёса | квадрат с колесом, углы прозрачные | шина целиком в кадре, окна между спицами тёмные (тормоз), а не зелёные |
| Трамвай | перёд — оба торца (трамвай двухкабинный), борт: торец + середина + торец зеркально | у 18 и 19 пояс окон и красная полоса на одной высоте, правый край 18 стыкуется с 19 |
| Небо | полоса за горизонтом, поворачивается с камерой | левый и правый края совпадают; город на горизонте низкий и бледный |

## Если вышло не так

Таблица из `docs/prompts/car-cabin-assets.md` («Если вышло не так») действует целиком. Для этой
серии ещё:

| Что вышло | Что написать в тот же чат |
|---|---|
| Фара повёрнута не тем концом | `Mirror it horizontally: the grille end must be on the LEFT, the outer corner end on the RIGHT.` |
| У фонаря белая и жёлтая секции не справа | `Move the clear and amber sections to the RIGHT end, stacked one above the other.` |
| На табло трамвая цифры или слова | `The destination display must be a plain dark blank panel with nothing on it.` |
| Борт трамвая в перспективе | `Strictly orthographic side elevation, no perspective, the body edges perfectly horizontal.` |
| Края неба не сходятся | `Make the left and right edges of the panorama match exactly so it wraps seamlessly.` |

## Приёмка каждой картинки (30 секунд)

- [ ] Увеличь: нет ни одной буквы, цифры, эмблемы, герба (у трамвая — и на табло).
- [ ] `dec-*`: строго в лоб, фон ровный зелёный до краёв, тени нет; ориентация по правилам выше.
- [ ] `dec-*`: поиск по картинке не находит конкретную модель машины.
- [ ] `tram-*`: ливрея одна на трёх картинках, поиск не находит реальный трамвай или город.
- [ ] `sky-pano`: края совпадают, на горизонте нет узнаваемых зданий.

## Позже — после геометрии в игре

1. Фасады домов для кварталов города — сейчас в городе нет зданий, только дороги, бордюры и
   ограждения.
2. Деревья и кусты спрайтами — нужен новый тип объекта (картинка, повёрнутая к камере).
3. Пешеходы для уровня «пешеходный переход» — спрайты и их движение.
4. Асфальт, плитка тротуара, трава — плитки; сначала замерить fps на телефоне.
5. Автобус и фургон в потоке — нужна своя модель кузова.
