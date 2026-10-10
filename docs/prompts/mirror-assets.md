# Бриф на генерацию: зеркала заднего вида (2 картинки, серия 4)

Зачем: из салона оба зеркала — грани из кода. Боковое — серая коробка с плоским серым стеклом,
салонное — светлая плита, которая при взгляде вправо читается как табличка на крыше соседней
машины. Картинка ложится на стекло, а контур корпуса берётся с её края: форма зеркала и
картинка совпадают по построению.

Правое боковое — зеркальная копия левого, отдельно его не генерируем. Корпус бокового зеркала
красится цветом машины в коде, поэтому на картинке только стекло в чёрной рамке.

## Как генерировать

1. Новый чат в ChatGPT, вставь промпт ниже целиком.
2. Скачай оригинал PNG кнопкой загрузки, не скриншотом.
3. Назови файл ровно как в промпте и положи в `assets/src/`. Журнал `SOURCES.md` заполню сам.

```
You are generating 2 images for a driving-school simulator game: the glass of a car's rear-view
mirrors, to be cut out and placed on 3D mirror models. Generate exactly ONE image per reply.
Start with image 1 right away. After each image write one line in Russian: the file name and
«готово — пиши «дальше» или что исправить». If I write "redo: ...", regenerate the same image
with only that change.

RULES FOR BOTH IMAGES
- Fictional, generic design, not resembling any real car or manufacturer.
- No text, letters, numbers, logos, emblems or warning labels anywhere, also not on the glass.
- Single isolated object, strictly frontal orthographic view straight at the mirror glass: no
  perspective, no tilt, no side faces of a housing visible. Object centred, filling about 85%
  of the image width. Square image.
- Background: flat solid pure green #00FF00 over the whole background, no shadow, no gradient.
  No green anywhere on the object: the glass never reflects the green background.
- Clean brand-new parts, soft even studio light.
- The glass is a mirror, not a window: it shows a soft, out-of-focus reflection as described
  below, plus one faint diagonal sheen. Nothing sharp in the reflection: no cars, people,
  buildings, trees or road markings.

1. dec-mirror-side.png. The glass of a car's LEFT exterior side mirror, seen from behind (from
   the driver's seat direction). Only the mirror glass and its thin black plastic frame (about
   5 mm wide) are shown; the painted housing is not shown. Shape: a rounded trapezoid, about
   21 x 14 cm (proportions 3 : 2, width : height). The LEFT end (outer, away from the car) is
   the tallest and most rounded; the RIGHT end (next to the car body) is straight and about
   15% lower; the top edge slopes down gently towards the right; the bottom edge is almost
   straight. Corner radius about 2.5 cm. Reflection: pale blue-grey daylight sky in the upper
   half, a hazy light horizon just below the middle, mid-grey asphalt in the lower part.

2. dec-mirror-center.png. A frameless interior rear-view mirror of a car, seen strictly from
   the driver's side (the glass face). Wide rounded rectangle about 24 x 6 cm (proportions
   4 : 1), corner radius about 1.5 cm, a very thin black edge (2 mm) around the glass. No
   mounting stem, no buttons, no lights. Reflection: the rear of a car interior, softly
   blurred: dark grey roof lining along the top, a wide bright band of the rear window in the
   middle with pale sky, the dark tops of two rear headrests below it.
```

## Если вышло не так

| Что вышло | Что написать в тот же чат |
|---|---|
| Надпись или знаки на стекле | `redo: remove all text and symbols from the glass, keep everything else.` |
| Стекло позеленело | `redo: the glass reflects only grey sky and grey road, no green at all.` |
| Видна боковая стенка или ракурс | `redo: strictly frontal orthographic, camera straight at the glass, no side faces.` |
| В отражении машины, дома, деревья | `redo: make the reflection a soft blur of sky and road only, no objects.` |
| Фон «шахматкой» | Сгенерируй заново тем же промптом: «шахматка» нарисована, а не прозрачна. |

## Приёмка (30 секунд)

- [ ] Увеличь: ни одной буквы и цифры, на стекле тоже.
- [ ] Фон ровный зелёный до краёв, тени нет.
- [ ] `dec-mirror-side`: высокий скруглённый край слева, прямой низкий — справа.
- [ ] `dec-mirror-center`: вытянутый прямоугольник примерно 4 : 1, без ножки.

## Что дальше в игре

Картинки идут обычным конвейером (`clean.py` → `embed.mjs`). Отражение на картинке
неподвижное, как и сейчас: живое отражение остаётся в зеркалах HUD. Снимки «было/стало» из
салона владелец смотрит до выкатки.
