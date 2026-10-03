# Бриф на генерацию: фасады домов общего города (9 картинок)

Зачем: дома общей карты (уровни 27–32, `cityBuildings`) сейчас покрыты рисованной кодом плиткой — сетка
окон на ровном цвете. Картинки фасадов дают кирпич, швы панелей, лоджии и витрины. Порядок работы —
как в `docs/prompts/car-cabin-assets.md` и `docs/prompts/world-assets.md`: один новый чат ChatGPT, файлы
в `assets/src/` (webp q95, PNG вне git), строка в `assets/src/SOURCES.md` на каждую картинку.

**Как картинка ложится в игру.** Каждая картинка — **плитка**: кусок фасада ровно в два окна по ширине
и один этаж по высоте. Игра повторяет её по длине дома и по этажам, поэтому левый край обязан стыковаться
с правым, верхний — с нижним (у витрины — только левый с правым: этаж один). Плитка панельного дома —
6,0 × 2,8 м (пропорция 15 : 7), кирпичного и оштукатуренного — 6,0 × 3,2 м (15 : 8). Цвет берётся из
картинки, поэтому один и тот же тип дома нужен в двух цветах. Видна плитка только ближе 45 м, дальше дом —
ровный цвет в дымке, так что мелкие детали не нужны.

**Что не генерируем.** Надписи и вывески с текстом, номера домов, рекламу, логотипы — их нельзя, и они
повторялись бы каждые 6 м. Людей, машины, деревья перед фасадом. Крыши — их с улицы не видно.

## Один промпт на всю серию

Вставь в новый чат ChatGPT целиком. Дальше — «дальше» или «redo: <что исправить>».

```
You are generating a numbered series of 9 seamless facade texture tiles for a driving-school city
simulator. Generate exactly ONE image per reply, in the order below. Start with image 1 right away.
After each image write one line in Russian: the file name and «готово — пиши «дальше» или что
исправить». Wait for my reply before the next image.

RULES FOR EVERY IMAGE
- A flat texture tile of a building facade, strictly frontal orthographic view: the camera looks
  straight at the wall, no perspective, no vanishing lines, no tilt, no ground, no sky, no roof.
  The facade fills the whole image edge to edge.
- Exactly TWO window bays wide and exactly ONE storey high (except where stated). Each bay is 3 m
  wide, the two bays are identical in size and position, windows centred in their bay.
- SEAMLESS: the left edge continues exactly into the right edge, and the top edge continues exactly
  into the bottom edge, so copies placed side by side and stacked on top of each other form one
  continuous wall with no visible seam. Panel joints, brick courses and floor slabs must line up
  across the edges. Put the floor line exactly at the bottom edge.
- Soft, even overcast daylight, no cast shadows except a thin shadow under window sills and inside
  loggias. No strong highlights.
- Windows: dark glass with a faint, even sky reflection; no interior visible; no curtains, no
  people, no plants, no air conditioners, no satellite dishes, nothing that would look repeated.
- Generic Russian / Eastern European city architecture of the 1960s-1990s, clean and maintained,
  not dirty, no graffiti, no damage.
- No text, letters, numbers, logos, signs, house numbers or advertisements anywhere.
- If I write "redo: ...", regenerate the same image with only that change.

THE SERIES
1. fac-panel-a.png. Prefabricated concrete panel apartment block: light grey-white panels with
   thin darker vertical and horizontal joints between panels; each bay has one plain rectangular
   window with a white frame and a narrow concrete sill. Aspect 15 : 7 (wide), e.g. 1500 × 700.
2. fac-panel-b.png. Same panel building type, warm beige-cream panels; the left bay has a glazed
   loggia (balcony enclosed with white-framed glass, a solid concrete parapet below the glass),
   the right bay a plain window. Aspect 15 : 7.
3. fac-panel-end.png. Blank end wall of the panel building from image 1: the same light grey panels
   and joints, NO windows. Aspect 15 : 7.
4. fac-brick-red.png. Red clay brick apartment house: running bond brickwork with light mortar;
   each bay has a tall window with a white wooden frame divided into three panes, a white plastered
   lintel above and a white sill. Aspect 15 : 8, e.g. 1500 × 800.
5. fac-brick-yellow.png. Same as image 4 but pale yellow-cream sand-lime brick and darker brown
   window frames. Aspect 15 : 8.
6. fac-brick-end.png. Blank red brick wall matching image 4, NO windows, a thin horizontal band of
   protruding brick at mid height. Aspect 15 : 8.
7. fac-plaster.png. 1950s plastered apartment house: pale ochre smooth plaster, each bay has a tall
   window with a white moulded surround, a small white cornice line at the top edge that continues
   into the bottom edge of the next copy. Aspect 15 : 8.
8. fac-shop-a.png. Ground-floor shop front, ONE row only (it does not repeat vertically, only side
   by side): a low dark granite base, two large display windows with slim dark aluminium frames,
   a glass door at the right edge of the right bay, above them a plain blank dark signboard band
   with nothing written on it. Aspect 15 : 8. Left and right edges still seamless.
9. fac-shop-b.png. Another ground-floor shop front in the same rules: light stone base, two arched
   display windows with white frames, a plain blank light-green awning strip above the windows,
   nothing written on it. Aspect 15 : 8.
```

## Промпты по одной картинке (№ 3–9)

ChatGPT принял «дальше» с уточнением за redo предыдущей картинки, нумерация съехала. Каждый промпт ниже
самодостаточен: правила повторены, номер не нужен. Швы панелей всё равно ложатся мимо краёв —
clean.py режет от шва до шва, переделывать ради этого не надо. У кирпича, штукатурки и витрин
швов нет, резать не по чему, поэтому окно стоит «по центру своей половины».

```
Generate ONE image only: fac-panel-end.png. Flat seamless facade texture tile, strictly frontal orthographic view, the wall fills the whole image edge to edge; no perspective, no sky, no ground, no roof. Soft even overcast light, no cast shadows. Clean, maintained Russian city building of the 1960s–1990s. No text, letters, numbers, logos, signs, people, cars, trees.
Blank end wall of the panel building from image 1: the same light grey-white concrete panels with the same thin darker vertical and horizontal joints, NO windows, NO balconies, nothing mounted on the wall. Two panels wide, one panel high. Aspect 15 : 7, e.g. 1834 × 858.
```

```
Generate ONE image only: fac-brick-red.png. Flat seamless facade texture tile, strictly frontal orthographic view, the wall fills the whole image edge to edge; no perspective, no sky, no ground, no roof. Soft even overcast light, no cast shadows except a thin shadow under the sills. Clean, maintained Russian city building of the 1960s–1990s. No text, letters, numbers, logos, signs, people, cars, trees, air conditioners.
Red clay brick apartment house, running bond, light grey mortar, courses perfectly horizontal. The image is two identical halves side by side; each half has exactly ONE tall window centred in it: white wooden frame divided into three vertical panes, a white plastered lintel above, a white sill below. Dark glass with a faint even sky reflection, nothing visible inside, no curtains. Exactly one storey high: plain brickwork along all four edges, the brick pattern continues from the right edge into the left edge and from the top edge into the bottom edge. Aspect 15 : 8, e.g. 1834 × 978.
```

```
Generate ONE image only: fac-brick-yellow.png. Flat seamless facade texture tile, strictly frontal orthographic view, the wall fills the whole image edge to edge; no perspective, no sky, no ground, no roof. Soft even overcast light, no cast shadows except a thin shadow under the sills. Clean, maintained Russian city building of the 1960s–1990s. No text, letters, numbers, logos, signs, people, cars, trees, air conditioners.
Pale yellow-cream sand-lime (silicate) brick apartment house, running bond, light mortar, courses perfectly horizontal. The image is two identical halves side by side; each half has exactly ONE tall window centred in it: dark brown wooden frame divided into three vertical panes, a white plastered lintel above, a white sill below. Dark glass with a faint even sky reflection, nothing visible inside, no curtains. Exactly one storey high: plain brickwork along all four edges, the brick pattern continues from the right edge into the left edge and from the top edge into the bottom edge. Aspect 15 : 8, e.g. 1834 × 978.
```

```
Generate ONE image only: fac-brick-end.png. Flat seamless facade texture tile, strictly frontal orthographic view, the wall fills the whole image edge to edge; no perspective, no sky, no ground, no roof. Soft even overcast light. Clean, maintained Russian city building of the 1960s–1990s. No text, letters, numbers, logos, signs, people, cars, trees.
Blank red clay brick wall, running bond, light grey mortar, the same brick as a red brick apartment house, courses perfectly horizontal. NO windows, NO doors, nothing mounted on the wall. One thin horizontal band of slightly protruding brick runs across the whole width at mid height. The brick pattern continues from the right edge into the left edge and from the top edge into the bottom edge. Aspect 15 : 8, e.g. 1834 × 978.
```

```
Generate ONE image only: fac-plaster.png. Flat seamless facade texture tile, strictly frontal orthographic view, the wall fills the whole image edge to edge; no perspective, no sky, no ground, no roof. Soft even overcast light, no cast shadows except a thin shadow under the sills. Clean, maintained Russian city building. No text, letters, numbers, logos, signs, people, cars, trees, air conditioners.
1950s plastered apartment house, pale ochre smooth plaster. The image is two identical halves side by side; each half has exactly ONE tall window centred in it with a white moulded surround and a white sill. Dark glass with a faint even sky reflection, nothing visible inside, no curtains. A thin white horizontal moulded band runs along the very bottom edge of the image (the floor line); the top edge is plain plaster. Left and right edges are plain plaster and continue into each other. Aspect 15 : 8, e.g. 1834 × 978.
```

```
Generate ONE image only: fac-shop-a.png. Flat facade texture tile, strictly frontal orthographic view, the facade fills the whole image edge to edge; no perspective, no sky, no pavement, no people. Soft even overcast light. Clean, maintained Russian city building. No text, letters, numbers, logos, posters, stickers or advertisements anywhere.
Ground-floor shop front, one storey; it repeats only side by side, never stacked. The bottom edge is the ground line. A low dark granite base along the bottom. The image is two halves side by side; each half has ONE large display window with slim dark aluminium frames centred in it; the right half also has a narrow glass door between its window and the right edge, not touching the edge. Dark glass with a faint even reflection, nothing behind the glass: no goods, no mannequins, no shelves. Above the windows a plain blank dark signboard band runs across the whole width with nothing on it; plain wall above it up to the top edge. Left and right edges are plain wall and continue into each other. Aspect 15 : 8, e.g. 1834 × 978.
```

```
Generate ONE image only: fac-shop-b.png. Flat facade texture tile, strictly frontal orthographic view, the facade fills the whole image edge to edge; no perspective, no sky, no pavement, no people. Soft even overcast light. Clean, maintained Russian city building. No text, letters, numbers, logos, posters, stickers or advertisements anywhere.
Ground-floor shop front, one storey; it repeats only side by side, never stacked. The bottom edge is the ground line. A light stone base along the bottom. The image is two identical halves side by side; each half has ONE large arched display window with white frames centred in it. Dark glass with a faint even reflection, nothing behind the glass: no goods, no mannequins, no shelves. A plain blank light-green awning strip runs across the whole width above the windows with nothing on it; plain light wall above it up to the top edge. Left and right edges are plain wall and continue into each other. Aspect 15 : 8, e.g. 1834 × 978.
```

## После генерации

Сделано 03.10.2026 (план `.ai-factory/plans/building-facades-images.md`, доска #260):

- `assets/src/fac-*.webp` + строки в `SOURCES.md` — все девять, с замерами швов и обрезки.
- `clean.py --only fac`: обрезка по таблице `FAC` (швы панелей, ряды кладки, ритм окон), сверка по
  отпечатку исходника, наплыв на шве — не `make_seamless`: тот сдвигает плитку на полпериода и ставит
  окно из середины на край. Переделал картинку — обрезку мерить заново.
- `embed.mjs`: 512 px, q 80, 4–22 КБ на плитку, все девять — 109 КБ; размер в метрах и средний цвет —
  в `data-m`, `data-mean`.
- Игра: плитка по типу дома и стороне (лицо — окна, торец — глухая стена, первый этаж на Ленина —
  витрина), без картинки — прежняя рисованная плитка и одно предупреждение `[assets]` на картинку.
  Гейт — `tools/facade-check.mjs`.
