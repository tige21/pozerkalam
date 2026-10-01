# Бриф на генерацию: машина и салон (20 картинок)

Зачем: салон и машину пересобираем в Blender под размеры игры, а GPT делает для них материалы и
детали. Дизайн — `docs/superpowers/specs/2026-09-28-car-cabin-assets-design.md`.

**Порядок:** сначала два референса (раздел 1). Они задают форму и стиль. Покажи их мне, я проверю
сходство с реальными марками, и только потом генерируй остальные 18.

## Как генерировать

1. Для каждой группы (референсы, материалы, детали салона, детали снаружи) — новый чат в ChatGPT.
2. Копируй промпт целиком, без правок. Формат кадра указан у каждой картинки.
3. Скачивай оригинал PNG кнопкой загрузки, а не скриншотом.
4. Называй файл ровно как в заголовке и клади в `assets/src/`.
5. Добавляй строку в `assets/src/SOURCES.md` (шаблон в конце файла).

Промпты на английском: слова «orthographic», «seamless» и «tileable» модель понимает точнее
по-английски.

## Один промпт на всю серию

Вместо 20 отдельных промптов можно вставить один в новый чат. ChatGPT рисует по одной картинке за
ответ, после второй останавливается до проверки референсов. Дальше — «дальше» или
«redo: <что исправить>». Одна серия в одном чате ещё и держит единый стиль.

```
You are generating a numbered series of 20 images for a driving-school simulator game.
Generate exactly ONE image per reply, in the order below. Start with image 1 right away.
After each image write one line in Russian: the file name and «готово — пиши «дальше» или что
исправить». Wait for my reply before the next image. After image 2, stop and wait for my
explicit approval of both references before continuing with image 3.

RULES FOR EVERY IMAGE
- Fictional, generic design. It must not resemble any real production car, interior or
  manufacturer: no recognisable grille shapes, lighting signatures, steering-wheel emblems or
  dashboard layouts.
- No text, letters, numbers, logos, badges, emblems or license plates anywhere, including
  dials, buttons and tyre sidewalls.
- Left-hand drive car.
- One consistent style across the whole series: clean, realistic, brand-new car, matte
  materials, no dirt, no wear.
- If I write "redo: ...", regenerate the same image with only that change.

RULES FOR MATERIALS (images 3-10, square)
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area.

RULES FOR DETAILS (images 11-20, square)
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on it, no green colour anywhere on the object. Metal and chrome reflect
only a neutral grey studio, never the green background. Soft even studio light, no strong
highlights.

THE SERIES
1. ref-car-sheet.png, landscape 3:2. Design reference sheet of a four-door compact sedan: four
   orthographic views on plain white in a 2x2 grid, same scale, aligned: side (car pointing
   left), front, rear, top (car pointing left). No perspective. Length 4.42 m, width 1.80 m,
   height 1.44 m, wheelbase 2.64 m, front overhang 0.86 m, rear overhang 0.92 m, 15-inch
   wheels. Three-box sedan with a short separate trunk, gently sloping windshield, six side
   windows, soft rounded surfaces, calm friendly character. Wide low grille with plain
   horizontal slats, simple rounded-trapezoid headlights, simple horizontal rounded-rectangle
   tail lights. Neutral light-grey matte clay model, no paint colour, no textures, no
   reflections, soft even studio light.
2. ref-cabin.png, landscape 3:2. Interior seen from the driver's eye position, steering wheel
   on the LEFT, looking straight ahead through the windshield, horizontal field of view about
   90 degrees. Three-spoke steering wheel with a blank centre pad; small instrument cluster
   with two round dials under a hood; calm horizontal dashboard with a soft top; two
   rectangular air vents in the centre and one at each end; small centre screen; climate panel
   with three round knobs below it; automatic gear selector on the centre console; thin
   A-pillars; interior rear-view mirror at the top centre; front edge of the hood through the
   lower windshield; both front door tops and side mirrors through the side windows. Dark
   charcoal-grey dashboard, door panels and seats, light grey headliner, one thin satin silver
   trim strip across the dashboard. Clean realistic 3D render, soft even interior light. All
   windows filled with flat pure white, no outside scenery.
3. mat-seat-fabric.png. Car seat upholstery fabric: dark charcoal grey (#3A3C40) tightly woven
   automotive textile with a subtle small twill pattern, matte.
4. mat-seat-leather.png. Car seat bolster synthetic leather: very dark grey (#2B2C2F), fine
   natural leather grain, matte, no stitching, no perforation.
5. mat-dash-soft.png. Soft-touch dashboard skin: dark grey (#34363A) plastic with a fine
   embossed leather-like grain, matte.
6. mat-plastic-hard.png. Hard interior car plastic: dark grey (#2F3134), fine sand-blasted
   matte texture, like lower door panels and centre console sides.
7. mat-headliner.png. Car roof headliner fabric: light warm grey (#B9B6B0) soft non-woven
   felt, matte.
8. mat-carpet.png. Car floor carpet: dark anthracite (#26272A) dense short-pile needle-punch
   fibres, matte.
9. mat-wheel-leather.png. Steering wheel leather: black (#1D1E20), fine pebble grain, satin
   finish, no stitching.
10. mat-trim-satin.png. Decorative dashboard trim: satin silver-grey (#8D9096) plastic with
    very fine brushed lines running strictly horizontally, subtle.
11. dec-vent.png. Rectangular dashboard air vent, about 18 x 7 cm: dark grey plastic frame
    with rounded corners, five thin horizontal slats, one small vertical adjustment tab in the
    centre, dark shadowed depth behind the slats.
12. dec-climate.png. Climate control panel, about 30 x 9 cm, matte dark grey plastic, three
    identical round rotary knobs in a row with thin satin silver rims. Left knob marked only
    with a small fan pictogram and dots of growing size; middle knob marked only with a colour
    arc from blue to red; right knob marked only with small simple arrow pictograms for air
    direction.
13. dec-screen-off.png. Centre display switched off: a 16:9 black glass panel, about 20 x 12
    cm, in a thin dark grey plastic bezel with rounded corners. Uniformly black screen: no
    reflections, no interface, no icons.
14. dec-hazard.png. Hazard warning light button: a small rectangular dark grey push button,
    about 4 x 2.5 cm, with the standard red triangle outline symbol in the centre.
15. dec-door-handle.png. Interior door release handle: a satin silver-grey lever set in a
    recessed dark grey plastic cup, about 16 x 5 cm.
16. dec-wheel-pad.png. Steering wheel centre airbag cover: rounded-rectangle shape, about
    22 x 15 cm, black soft-touch plastic with one subtle seam line, completely blank centre.
17. dec-headlight.png. One front headlight unit, seen strictly from the front of the car.
    Housing outline: simple rounded trapezoid, about 55 x 22 cm. Clear lens over a chrome and
    dark grey reflector with one round projector lens, and a thin straight LED daytime-running
    strip along the lower edge. Lights switched off.
18. dec-taillight.png. One tail light unit, seen strictly from behind the car. Simple
    horizontal rounded rectangle, about 45 x 16 cm: dark red lens with a small clear
    reversing-light section and a small amber turn-signal section, simple straight internal
    lines. Lights switched off.
19. dec-grille.png. Front grille, seen strictly from the front: a wide low rounded-rectangle
    opening, about 90 x 18 cm, with four plain horizontal satin-black slats and a thin chrome
    surround. No badge anywhere: the centre looks exactly like the sides.
20. dec-wheel.png. Car wheel seen exactly side-on, the axle pointing straight at the camera.
    15-inch silver alloy rim with five simple straight spokes and a plain flat centre cap.
    Black tyre with 185/65 R15 proportions and a completely smooth sidewall.
```

## Если вышло не так

| Что вышло | Что написать в тот же чат |
|---|---|
| Буквы, цифры, эмблема | `Remove all text, letters, numbers and emblems. Keep everything else identical.` Не помогло за 2 раза — сгенерируй заново. |
| Фон «шахматкой» вместо зелёного | Сгенерируй заново тем же промптом: «шахматка» нарисована, а не прозрачна. |
| Деталь под углом, видны боковые стенки | `Make it strictly frontal orthographic: camera straight at the face, no side faces visible, no perspective.` |
| Хром или металл позеленел | `Metal and chrome must reflect only a neutral grey studio, never the green background.` |
| На плитке пятно, складка или светлый угол | `Make the texture completely uniform: remove the bright area and any distinct features.` |
| Поиск по картинке находит реальную модель | Сгенерируй заново, добавив в начало промпта `Simpler, softer, more generic shapes.` |

Точный цвет из промпта GPT выдерживает приблизительно. Это нормально: цвет я выравниваю скриптом.

## Приёмка каждой картинки (30 секунд)

- [ ] Увеличь картинку: нет ни одной буквы, цифры, эмблемы.
- [ ] `ref-*`, `dec-headlight`, `dec-taillight`, `dec-grille`, `dec-wheel`: поиск по картинке
      (Яндекс Картинки, Google Lens) не находит конкретную модель машины.
- [ ] `dec-*`: деталь строго в лоб, фон ровный зелёный до краёв, тени на фоне нет.
- [ ] `mat-*`: фактура ровная по всему кадру, без пятен и перепада яркости.
- [ ] `ref-cabin`: руль слева.

---

## 1. Референсы (2 шт.) — формат кадра 3:2, горизонтальный

В игру не идут. `ref-car-sheet` — эталон формы кузова в сером макете. `ref-cabin` — эталон
компоновки и стиля салона, поэтому он в цвете.

### ref-car-sheet.png

```
Design reference sheet of a fictional, generic four-door compact sedan. Four orthographic views
on a plain white background in a 2x2 grid, all at exactly the same scale and aligned to each
other: side view (car pointing left), front view, rear view, top view (car pointing left). No
perspective in any view.
Proportions: length 4.42 m, width 1.80 m, height 1.44 m, wheelbase 2.64 m, front overhang
0.86 m, rear overhang 0.92 m, 15-inch wheels. Three-box sedan silhouette with a short separate
trunk, gently sloping windshield, six side windows, soft rounded surfaces, calm friendly
character.
Front: wide low grille with plain horizontal slats, simple headlights shaped like rounded
trapezoids. Rear: simple horizontal rounded-rectangle tail lights. No signature lighting shapes.
Render style: neutral light-grey matte clay model, no paint colour, no textures, no reflections,
soft even studio light.
The car must not resemble any real production car or manufacturer. No logos, no badges, no
emblems, no text, no letters, no numbers, no license plates.
```

### ref-cabin.png

```
Interior of a fictional, generic compact sedan seen from the driver's eye position.
LEFT-HAND DRIVE: the steering wheel is on the LEFT side of the car. The view looks straight
ahead through the windshield from the left seat, horizontal field of view about 90 degrees.
Visible: a three-spoke steering wheel with a plain blank centre pad; behind it a small
instrument cluster with two round dials under a hood; a calm horizontal dashboard with a soft
top; two rectangular air vents in the centre and one at each end; a small centre screen; below
it a climate panel with three round knobs; an automatic gear selector on the centre console;
thin A-pillars; an interior rear-view mirror at the top centre; the front edge of the hood
through the lower windshield; both front door tops and the side mirrors through the side
windows.
Colour scheme: dark charcoal-grey dashboard, door panels and seats, light grey headliner, one
thin satin silver trim strip across the dashboard.
Render style: clean realistic 3D render of a brand-new car, soft even interior light, matte
materials, no dirt, no wear.
All windows are filled with flat pure white, no outside scenery.
The interior must not resemble any real production car or manufacturer. No logos, no emblems,
no text, no letters, no numbers on any surface, including the dials and buttons.
```

---

## 2. Материалы салона (8 шт.) — формат кадра квадрат

Плитки, которыми в Blender обтягиваются детали. Одна картинка — участок 30 × 30 см.

### mat-seat-fabric.png

```
Car seat upholstery fabric: dark charcoal grey (#3A3C40) tightly woven automotive textile with
a subtle small twill pattern, matte.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

### mat-seat-leather.png

```
Car seat bolster synthetic leather: very dark grey (#2B2C2F), fine natural leather grain,
matte, no stitching, no perforation.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

### mat-dash-soft.png

```
Soft-touch dashboard skin of a modern car: dark grey (#34363A) plastic with a fine embossed
leather-like grain, matte.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

### mat-plastic-hard.png

```
Hard interior car plastic: dark grey (#2F3134) with a fine sand-blasted matte texture, like
the lower door panels and the sides of the centre console.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

### mat-headliner.png

```
Car roof headliner fabric: light warm grey (#B9B6B0) soft non-woven felt, matte.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

### mat-carpet.png

```
Car floor carpet: dark anthracite (#26272A) dense short-pile needle-punch fibres, matte.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

### mat-wheel-leather.png

```
Steering wheel leather: black (#1D1E20) with a fine pebble grain, satin finish, no stitching.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

### mat-trim-satin.png

```
Decorative dashboard trim: satin silver-grey (#8D9096) plastic with very fine brushed lines
running strictly horizontally, subtle.
Seamless tileable texture. Top-down orthographic view of a perfectly flat sample filling the
whole frame edge to edge. Uniform soft diffuse light: no shadows, no highlights, no
reflections, no vignette, no brightness gradient across the image. Fine uniform detail only:
no large spots, folds, seams or distinct features that would repeat visibly. The image covers
a 30 x 30 cm area. No text, no logos. Square image.
```

---

## 3. Детали салона (6 шт.) — формат кадра квадрат

Плоские детали, которые кладутся на панели в Blender. Зелёный фон я вырезаю.

### dec-vent.png

```
Rectangular car dashboard air vent, about 18 x 7 cm: dark grey plastic frame with rounded
corners, five thin horizontal slats, one small vertical adjustment tab in the centre, dark
shadowed depth behind the slats.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Metal and
chrome reflect only a neutral grey studio, never the green background. Soft even studio light,
matte materials, no strong highlights. Generic design that does not resemble any real car
manufacturer. No text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-climate.png

```
Car climate control panel, about 30 x 9 cm, matte dark grey plastic, three identical round
rotary knobs in a row with thin satin silver rims. Left knob marked only with a small fan
pictogram and dots of growing size; middle knob marked only with a colour arc from blue to
red; right knob marked only with small simple arrow pictograms for air direction.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Metal and
chrome reflect only a neutral grey studio, never the green background. Soft even studio light,
matte materials, no strong highlights. Generic design that does not resemble any real car
manufacturer. No text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-screen-off.png

```
Car centre display, switched off: a 16:9 black glass panel, about 20 x 12 cm, in a thin dark
grey plastic bezel with rounded corners. The screen is uniformly black: no reflections, no
interface, no icons.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Soft even
studio light, matte materials, no strong highlights. Generic design that does not resemble any
real car manufacturer. No text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-hazard.png

```
Car hazard warning light button: a small rectangular dark grey push button, about 4 x 2.5 cm,
with the standard red triangle outline symbol in the centre.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Soft even
studio light, matte materials, no strong highlights. Generic design that does not resemble any
real car manufacturer. No text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-door-handle.png

```
Interior car door release handle: a satin silver-grey lever set in a recessed dark grey
plastic cup, about 16 x 5 cm.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Metal and
chrome reflect only a neutral grey studio, never the green background. Soft even studio light,
matte materials, no strong highlights. Generic design that does not resemble any real car
manufacturer. No text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-wheel-pad.png

```
Steering wheel centre airbag cover: rounded-rectangle shape, about 22 x 15 cm, black
soft-touch plastic with one subtle seam line, completely blank centre.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Soft even
studio light, matte materials, no strong highlights. Generic design that does not resemble any
real car manufacturer. No text, no letters, no numbers, no logos, no emblems. Square image.
```

---

## 4. Детали снаружи (4 шт.) — формат кадра квадрат

Одна фара и один фонарь: вторую сторону я получаю зеркалом. Свет выключен: включённые фары,
стоп-сигналы и поворотники рисует код, потому что они мигают и зажигаются по ходу игры.

### dec-headlight.png

```
One front headlight unit of a generic compact sedan, seen strictly from the front of the car.
Housing outline: simple rounded trapezoid, about 55 x 22 cm. Clear lens over a chrome and dark
grey reflector with one round projector lens, and a thin straight LED daytime-running strip
along the lower edge. Lights switched off.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Metal and
chrome reflect only a neutral grey studio, never the green background. Soft even studio light,
no strong highlights. Generic design that does not resemble any real car manufacturer. No
text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-taillight.png

```
One tail light unit of a generic compact sedan, seen strictly from behind the car. Simple
horizontal rounded rectangle, about 45 x 16 cm: dark red lens with a small clear
reversing-light section and a small amber turn-signal section, simple straight internal lines.
Lights switched off.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Metal and
chrome reflect only a neutral grey studio, never the green background. Soft even studio light,
no strong highlights. Generic design that does not resemble any real car manufacturer. No
text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-grille.png

```
Front grille of a generic compact sedan, seen strictly from the front: a wide low
rounded-rectangle opening, about 90 x 18 cm, with four plain horizontal satin-black slats and
a thin chrome surround. No badge and no emblem anywhere: the centre of the grille looks
exactly like its sides.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Metal and
chrome reflect only a neutral grey studio, never the green background. Soft even studio light,
no strong highlights. Generic design that does not resemble any real car manufacturer. No
text, no letters, no numbers, no logos, no emblems. Square image.
```

### dec-wheel.png

```
Car wheel seen exactly side-on, the axle pointing straight at the camera. 15-inch silver
alloy rim with five simple straight spokes and a plain flat centre cap. Black tyre with
185/65 R15 proportions and a completely smooth sidewall: no lettering, no markings, no text of
any kind.
Single isolated object, strictly frontal orthographic view: the camera looks straight at the
object's face, no perspective, no tilt, no side faces visible. Object centred, filling about
80% of the image. Background: flat solid pure green #00FF00 over the whole background, no
shadow and no gradient on the background, no green colour anywhere on the object. Metal and
chrome reflect only a neutral grey studio, never the green background. Soft even studio light,
no strong highlights. Generic design that does not resemble any real car manufacturer. No
text, no letters, no numbers, no logos, no emblems. Square image.
```

---

## Шаблон `assets/src/SOURCES.md`

Журнал происхождения. Если придёт претензия по сходству, он показывает, что картинка сделана по
нейтральному промпту без марок. Он же позволяет перегенерировать файл тем же путём.

```markdown
# Происхождение ассетов

| Файл | Дата | Где сделан | Промпт | Правки в чате | Поиск по картинке |
|---|---|---|---|---|---|
| ref-car-sheet.png | 2026-09-28 | ChatGPT (версия модели из интерфейса) | docs/prompts/car-cabin-assets.md#ref-car-sheetpng | «Remove all text…» ×1 | чисто |
```
