# Промпты для генерации логотипа «По зеркалам»

Палитра проекта (из лендинга): фон `#08111b`, акцент-жёлтый `#ffd63c`,
голубой `#9fd0ff`, зелёный «вперёд» `#4ade80`, оранжевый «назад» `#ff9636`.
Шрифт сайта — **Onest**.

**Главное правило:** генераторы (GPT-image, Copilot/DALL·E) коверкают кириллицу.
Просим **знак без текста**, надпись «По зеркалам» ставим сами шрифтом Onest.

---

## Концепт A (основной) — боковое зеркало + траектория

```
Flat vector logo mark, no text, no letters. A car side-view mirror seen
from behind at a slight three-quarter angle: a rounded rectangular mirror
housing with a soft chamfer. Inside the mirror glass — a tiny simplified
top-down car and a curved dashed trajectory line that sweeps out of the
glass and continues outside the mirror as a smooth arc with a small arrow
head. Geometric, minimal, 2 to 3 flat colors plus one accent, thick even
strokes, generous rounded corners, no gradients, no shading, no 3D, no
photorealism. Palette: deep navy #08111b background, warm yellow #ffd63c
for the mirror housing, light blue #9fd0ff for the glass, green #4ade80
for the trajectory arc. Centered composition on a square canvas, large
empty margin around the mark, readable when scaled down to 32x32 pixels.
Modern app icon / driving-school brand style, clean, friendly, confident.
```

## Концепт B — салонное зеркало (широкая версия, для шапки сайта)

```
Flat vector logo mark, no text, no letters. A rear-view mirror of a car:
a wide horizontal capsule shape with rounded ends, seen straight on.
Inside the mirror — a minimal scene: two parallel road markings converging,
and a small simplified car between them, seen from behind. A short stem at
the bottom of the mirror. Bold geometric shapes, flat colors, no gradients,
no shadows, no 3D. Palette: warm yellow #ffd63c mirror frame, light blue
#9fd0ff glass, white road lines, deep navy #08111b background. Wide
composition, strong silhouette, works as a small header logo.
```

## Концепт C — парковочное место + машина сверху

```
Flat vector logo mark, no text, no letters. Top-down view: a parking bay
drawn as two thick white L-shaped corner markings, and a small simplified
car shape parked neatly inside it, slightly angled as if just finishing a
maneuver. A dashed curved line shows the path the car took into the bay,
ending with a small arrow. Extremely minimal, geometric, flat colors, thick
rounded strokes, no gradients, no shading, no perspective. Palette: deep
navy #08111b background, yellow #ffd63c car, white markings, green #4ade80
dashed path. Square canvas, centered, big margins, legible at 32x32 px.
Playful but professional, like a mobile game icon.
```

## Концепт D — монограмма «ПЗ» из дорожной разметки

```
Flat vector monogram logo mark. Two Cyrillic letters "П" and "З" built out
of road-marking elements: thick painted white strokes with slightly rough
paint edges, as if stencilled on dark asphalt. The letters lock together
into one compact square badge. Deep navy asphalt background #08111b, white
markings, one yellow #ffd63c accent stroke. Flat, geometric, no gradients,
no 3D, no photorealism. Square canvas, centered, high contrast, legible at
small size. IMPORTANT: render exactly and only the two letters П and З,
Cyrillic, nothing else, no other text.
```

## Что дописать в любой промпт, если результат мусорный

```
Style reference: modern flat vector branding, Material Symbols / Lucide
icon energy, single-weight geometry, minimal detail count.
Negative: no text, no words, no letters, no watermark, no gradient mesh,
no drop shadows, no realistic reflections, no clutter, no busy background,
no photo texture, not isometric, not 3D render.
Output: square 1:1, flat background, centered subject.
```

## Варианты, которые стоит попросить сразу

1. Основной знак на тёмном фоне (`#08111b`).
2. Тот же знак на белом фоне — для документов и Яндекс.Игр.
3. Одноцветная версия (только `#ffd63c` на прозрачном) — для фавикона 32×32.

## После генерации

- Растр → вектор: https://vectorizer.ai или Illustrator Image Trace.
- Надпись «По зеркалам» — Onest SemiBold, трекинг −1 %, слева от знака.
- Иконки PWA/Яндекс.Игр: 192×192 и 512×512, знак занимает ~70 % кадра
  (см. `landing/public/icon-192.png`, `icon-512.png`).

---

# Разбор провала первой генерации (GPT, 2026-09-09)

Вышел дудл: дрожащий контур, чёрные жирные обводки, четыре объекта в кадре,
стрелка вылетает в угол. Причины и лечение:

| Что пошло не так | Что дописать в промпт |
|---|---|
| «rounded corners, friendly» → модель рисует от руки | `strict geometric construction, circles and straight lines only, no hand-drawn wobble` |
| Чёрные обводки вокруг каждой формы | `no black outlines, no contour strokes around shapes` |
| Корпус + стекло + машина + стрелка спорят | `the mark must read as ONE silhouette when squinted at` |
| Стрелка уходит за край | `perfectly centered, equal margins, nothing exits the frame` |

---

# Промпты для GPT (GPT-image / DALL·E)

GPT хуже держит длинную арт-дирекцию — промпт короткий, запреты в начале.
Кириллицу **не просить**: надпись ставим сами шрифтом Onest.

## Основной

```
Minimalist flat vector logo icon. Strict geometric construction: circles,
straight lines, one arc. Uniform stroke weight. NO black outlines, NO
hand-drawn wobble, NO sketchy edges, NO gradients, NO shadows, NO 3D,
NO text.

A car side mirror reduced to its purest form: a rounded-square glass panel
tilted 12 degrees, light blue #9fd0ff. Inside it, one bold green #4ade80
arc curving from lower left to upper right, ending in a small solid
triangle. Below the arc, one tiny car shape — a rounded rectangle with two
wheel notches — in warm yellow #ffd63c. Nothing else in the frame.

Deep navy #08111b square background. Mark perfectly centered, equal margins
on all sides, nothing crops or exits the frame. Precise engineering style,
like a Material Symbols icon. Must stay legible at 24x24 pixels.
```

## Правка уже сгенерённого (режим «Редактировать» в GPT)

```
Redraw this icon with strict geometric precision. Remove all black
outlines. Remove the mirror housing and the stem — keep only the glass
panel as a clean rounded square. Make every line perfectly smooth with a
single uniform weight, no hand-drawn wobble. Bring the arrow fully inside
the frame and center the whole mark with equal margins. Keep the colors.
```

## Если GPT снова дудлит

Добавить в конец: `Vector art, SVG style, crisp mathematical curves, zero
texture, zero brush feel, flat corporate icon.`

---

# Промпты для Gemini 3 Pro (Nano Banana Pro)

Gemini держит кириллицу — ему можно заказывать лок-ап с надписью и лист
вариантов.

## Знак

```
Design a professional logo mark for a driving-school parking simulator.
Output: single centered mark on a deep navy #08111b square, no text.

Construction rules (follow strictly):
— The mark is built on a geometric grid from circles, straight lines and
  a single arc. No hand-drawn wobble, no sketchy edges, no uneven strokes.
— One uniform stroke weight throughout. No black outlines around shapes.
— The whole mark must read as ONE silhouette when squinted at.
— Perfectly centered, equal margins on all four sides, nothing crops or
  exits the frame.

Subject: a car side mirror reduced to its purest geometric form — a
rounded-square glass panel tilted 12 degrees, in light blue #9fd0ff.
Inside the glass, a single bold arc in green #4ade80 curves from the lower
left to the upper right, ending in a small solid triangle. Below the arc,
one tiny simplified car reduced to a rounded rectangle with two wheel
notches, in warm yellow #ffd63c. Nothing else. No housing, no stem, no
extra detail.

Style: flat vector, Material Symbols / Vercel / Linear brand geometry,
two flat colors plus one accent, no gradients, no shadows, no 3D, no
texture, no perspective. Confident, calm, engineering-precise — not
playful, not cartoonish, not sticker-like.

It must stay legible at 24x24 pixels.
```

## Лок-ап с надписью

```
Create a horizontal logo lockup on a deep navy #08111b background.
Left: the geometric mark described below. Right: the Cyrillic wordmark
"По зеркалам" set in a modern geometric grotesque, semibold, tight
letter-spacing, pure white, optically aligned to the mark's height.
Render the Cyrillic letters exactly: П о   з е р к а л а м.

Mark: a rounded-square mirror glass in light blue #9fd0ff, tilted 12
degrees, containing one bold green #4ade80 arc ending in a solid triangle,
and one tiny yellow #ffd63c car shape. Flat vector, uniform stroke weight,
strict geometry, no outlines, no gradients, no shadows.

Composition: mark and text on one baseline, gap equal to half the mark's
width, generous empty space around the whole lockup. Nothing else in frame.
```

## Лист из 6 вариантов

```
Generate a logo exploration sheet: 6 distinct logo marks for a car
parking-maneuver trainer, arranged in a clean 3x2 grid on a deep navy
#08111b canvas, equal spacing, no labels, no text anywhere.

All six share: flat vector, strict geometric construction, uniform stroke
weight, no outlines, no gradients, no shadows, palette limited to
#ffd63c yellow, #9fd0ff light blue, #4ade80 green and white.

The six concepts:
1. Side mirror glass as a rounded square with a curved trajectory arc inside.
2. Rear-view mirror as a wide capsule with two converging road lines inside.
3. Two thick white L-shaped parking-bay corner markings with a car between them.
4. A car reduced to a circle-and-rectangle, framed by two mirror shapes left and right.
5. A single continuous S-curve line forming both a road and a mirror outline.
6. Cyrillic monogram "ПЗ" built from painted road-marking strokes.

Each mark centered in its cell, legible at 24x24 pixels.
```
