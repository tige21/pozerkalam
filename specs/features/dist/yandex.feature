# language: ru
Функция: Сборка для Яндекс Игр

  Чем билд площадки обязан отличаться от веб-билда и что в нём обязано работать.
  Проверяется инструментом tools/yandex-check.mjs: он собирает build/yandex/index.html,
  раздаёт его со статического сервера вместе с мок-/sdk.js и открывает в браузере.

  Ссылка: доска #176 — build-yandex.sh падал на вырезании регистрации SW с 9.09.2026,
  16 дней без гейта; аудит production-ready 25.09.2026; требования Яндекс Игр п. 4.7
  (пауза игры и звука под полноэкранной рекламой)

  @ui @dist @dist-yandex-no-sw
  Сценарий: В билде площадки нет service worker и манифеста
    Дано собран build/yandex/index.html
    Когда страница открыта из билда площадки
    Тогда в html нет строки "serviceWorker" и нет ссылки на manifest.webmanifest
    И у страницы 0 регистраций service worker

  @ui @dist @dist-yandex-build-tag
  Сценарий: Билд площадки несёт свой тег сборки
    Дано собран build/yandex/index.html
    Когда страница открыта из билда площадки
    Тогда window.BUILD имеет вид "ya-" и 16 шестнадцатеричных знаков

  @ui @dist @dist-yandex-sdk-ready
  Сценарий: SDK площадки инициализирован и адаптер рекламы на месте
    Дано собран build/yandex/index.html
    Когда YaGames.init отдал ysdk
    Тогда window.ysdk задан и LoadingAPI.ready вызван
    И window.ADS.interstitial и window.ADS.rewarded — функции

  @ui @dist @dist-yandex-ads-pause
  Сценарий: Полноэкранная реклама ставит игру на паузу и снимает её
    Дано собран build/yandex/index.html
    Когда вызвана window.ADS.interstitial и затем window.ADS.rewarded
    Тогда adsPause получает true на onOpen и false на onClose для каждой
    И колбэк награды вызван на onRewarded

  @ui @dist @dist-yandex-cloud-merge
  Сценарий: Облачные сейвы сливаются без затирания локальных
    Дано в облаке лежат trainer_gearbox "MT" и trainer_marks "0"
    И локально trainer_gearbox пуст, а trainer_marks равен "1"
    Когда YaGames.init отдал ysdk и игрок загружен
    Тогда локальный trainer_gearbox равен "MT", а trainer_marks остаётся "1"
    И __ysave отправляет в setData все ключи trainer_* и только их

  @ui @dist @dist-yandex-console-clean
  Сценарий: Уровень стартует из билда площадки без ошибок
    Дано собран build/yandex/index.html
    Когда нажато «Поехали» и загружен уровень 1
    И проходит 3 секунды
    Тогда игра не на паузе и кадр рисует грани
    И в консоли нет ошибок, а все запросы страницы успешны
