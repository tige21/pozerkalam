# Звуки: откуда каждая запись

Все записи — Creative Commons 0 (общественное достояние): лицензия сверена 11.10.2026 по странице
каждого звука (ссылка `creativecommons.org/publicdomain/zero/1.0`). С Freesound взяты публичные
превью HQ (MP3 ≈ 180 кбит/с): для звука в игре, который потом сжимается до 64–80 кбит/с моно, этого
хватает. Выбор — владелец на прослушке 11.10.2026 (план `.ai-factory/plans/sound-samples.md`, доска #316):
по каждой группе 2–3 кандидата на одной громкости рядом с прежним синтезом.

Три длинные записи обрезаны без перекодирования (`ffmpeg -c copy`) до куска вокруг выбранного места,
чтобы не держать в git минуты ненужного звука; время в таблице `tools/audio/sfx.mjs` — от начала
обрезанного файла.

| Файл | Что это | Автор | Источник | Обрезка | Что берёт игра |
|---|---|---|---|---|---|
| engine-idle.mp3 | BMW 120d (дизель), холостой ход снаружи, ≈840 об/мин | GiocoSound | https://freesound.org/people/GiocoSound/sounds/401552/ | — | петля мотора на холостых |
| engine-load.mp3 | тот же BMW 120d снаружи, ровные ≈1480 об/мин | GiocoSound | https://freesound.org/people/GiocoSound/sounds/401556/ | — | петля мотора под нагрузкой |
| tyres.mp3 | Suzuki Alto медленно по асфальту, из салона | orlandorizo | https://freesound.org/people/orlandorizo/sounds/591079/ | 76–88 с | петля шин |
| kerb.mp3 | шина юзом по бетону | loganzsound | https://freesound.org/people/loganzsound/sounds/774265/ | — | трение о бордюр |
| hit.mp3 | лязг столкновения машины | qubodup | https://freesound.org/people/qubodup/sounds/151624/ | — | удар |
| blinker.mp3 | реле поворотника из салона, включение и выключение подрулевого рычага | NHumphrey | https://freesound.org/people/NHumphrey/sounds/200976/ | — | «тик», «так», щелчок рычага |
| selector.mp3 | рычаг АКПП Mazda 6 | microman502 | https://freesound.org/people/microman502/sounds/818294/ | — | щелчок позиции селектора |
| handbrake.mp3 | ручник: поднять и опустить медленно, затем быстро | launemax | https://freesound.org/people/launemax/sounds/250008/ | — | подъём (быстрый) и опускание (медленное) |
| horn.mp3 | сигнал Mini Countryman | Julien_Matthey | https://freesound.org/people/Julien_Matthey/sounds/436589/ | — | гудок потока |
| city-bed.mp3 | улица с машинами и прохожими, Москва, ул. Просторная | AlexanderChe | https://freesound.org/people/AlexanderChe/sounds/362949/ | 14–30 с | фон города |
| car-pass.mp3 | Renault Mégane II проезжает мимо | Framefive | https://freesound.org/people/Framefive/sounds/128124/ | — | проезд мимо и петля голоса потока |
| tram-run.mp3 | трамвай проезжает рядом, Хельсинки | Villehardt | https://freesound.org/people/Villehardt/sounds/614003/ | 26–40 с | петля трамвая |
| tram-bell.mp3 | звонок трамвая, Чехия | 16HPanskaWillheimova_Sara | https://freesound.org/people/16HPanskaWillheimova_Sara/sounds/497561/ | — | звонок |
| rail-clack.mp3 | трамвай на рельсах: стыки и мотор, Хельсинки | claravinleb | https://freesound.org/people/claravinleb/sounds/839496/ | — | стук на стыке |

Отвергнутые кандидаты и страница прослушки — в истории доски #316; сами файлы в git не попали.
