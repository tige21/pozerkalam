# Implementation Plan: Каналы дистрибуции — M4 Яндекс Игры + M5 VK/TG + M6 лендинг

Branch: none (fast, main)
Created: 2026-09-04

## Settings
- Testing: headless демо-регрессия (18 демо, 0 warn) после каждой правки index.html; билд ЯИ — с мок-SDK; лендинг — билд без ошибок + деплой-смоук
- Logging: minimal (console.warn только в guard-ветках)
- Docs: CLAUDE.md (ads-слой, билды, лендинг) + ROADMAP галочки в финале

## Границы: публикация на площадках (аккаунты, модерация) — руками пользователя;
## мои выходы — готовые артефакты (ZIP ЯИ, URL для VK/TG) и пошаговые инструкции.

## Задачи

- [x] 1. **Ads-абстракция в игре** (adsInterstitial c кулдауном 60с/180с + adsRewarded; хуки next/again; rewarded-пункт меню «траектория»; регрессия 0 warn) (index.html). Слой `ads` с методами
  `interstitial(reason)` и `rewarded(onReward)` — в веб-билде no-op (как track).
  Точки вызова: interstitial — смена уровня (loadLevel по действию игрока, не чаще
  1 раза в 3 мин, кулдаун-переменная) и «Повторить» после win/fail; rewarded —
  новая кнопка «Подсказка: показать траекторию» на задании/в меню: включает
  opt.guides до конца уровня. В веб-билде rewarded даёт награду сразу (без рекламы).
  Смоук: headless-регрессия, кнопка работает в вебе.
- [x] 2. **Билд Яндекс Игр** (build/yandex.zip 88КБ; мок-тест зелёный: SDK→ADS, облачный merge trainer_*, rewarded/interstitial через adv, LoadingAPI.ready; PWA/favicon вырезаны) — `build-yandex.sh`: артефакт из index.html БЕЗ Метрики,
  БЕЗ SW/manifest-регистрации (iframe площадки), с тегом `/sdk.js` ЯИ и адаптером:
  `YaGames.init()` → ysdk; ads.interstitial → `adv.showFullscreenAdv`, ads.rewarded →
  `adv.showRewardedVideo`; сейвы: зеркалирование ключей trainer_* в
  `player.setData/getData` поверх localStorage (getData при старте, merge);
  `LoadingAPI.ready()` после загрузки. ZIP `build/yandex.zip` с index.html в корне.
  Смоук: локальный прогон с мок-YaGames (init/adv/player заглушки) — игра стартует,
  регрессия чиста, interstitial-хук зовётся на смене уровня.
- [ ] 3. **Совместимость VK/Telegram** (M5-код). CSP frame-ancestors дополнить
  vk.com/*.vk.com/web.telegram.org; проверить игру в iframe (Playwright: страница-
  обёртка с iframe на prod) — работает, тач-режим жив. TG Mini App и VK — используют
  прод-URL как есть; выход задачи — проверенный факт «в iframe работает» +
  инструкция создания бота (BotFather → WebApp URL) и VK Mini App в финале.
- [ ] 4. **Лендинг (M6, Astro)** — каталог `landing/` в репо: Astro static, 3 страницы:
  главная (питч «подготовка к практическому экзамену», кнопка «Играть» → /play/,
  блок фич: 27 уровней/экзамен/МКПП), `/avtoshkolam` (B2B: white-label,
  «домашка» ученику, контакт-заглушка mailto), `/metodika` (SEO-статья: ориентиры
  парковки по зеркалам — из hacks игры). Дизайн: тёмная тема игры (#0d141d/#7dd8ff),
  без фреймворк-CSS. Билд `npm run build` без ошибок.
- [ ] 5. **Перестановка путей на проде**: лендинг → корень `/`, игра → `/play/`
  (SEO-правильно). nginx: `/` — лендинг-статик, `/play/` — игра,
  SW: перерегистрация на /play/, старый SW корня — самоликвидация (unregister при
  загрузке новой версии). deploy-pozerkalam.sh расширить: билд лендинга + игра в
  /play/ + смоук обоих. Пересчитать пути манифеста/иконок/SW под /play/.
- [ ] 6. **Финал**: полная регрессия (18 демо), Lighthouse лендинга и /play/,
  ROADMAP: M4 «код готов, ZIP собран — подача за пользователем», M5 «iframe
  проверен — регистрация за пользователем», M6 [x]; инструкции публикации
  (ЯИ-кабинет, BotFather, VK) в docs/PUBLISH.md; CLAUDE.md: ads-слой, билды,
  структура /play/; коммит; память.

## Риски
1. **SW-переезд на /play/** — старый SW на scope '/' перехватывал бы лендинг:
   новая версия обязана вычистить старый кэш и scope.
2. **Мок-SDK ≠ реальный SDK** — ЯИ-билд тестируется моком; финальная проверка —
   в песочнице кабинета ЯИ (за пользователем, до модерации).
3. **Interstitial-кулдаун** — ЯИ режет за частую рекламу: жёсткий минимум 180 с
   и никогда — в первые 60 с сессии.
