/* Service Worker «По зеркалам». Версию (__BUILD__) вписывает деплой-скрипт из
   sha256 артефакта — без неё пользователи навсегда залипли бы в первом кэше.
   Игра — один самодостаточный файл: network-first для страницы (свежая версия,
   когда сеть есть), кэш — офлайн-фолбэк; иконки/манифест — cache-first.
   PAGE и CORE деплой переписывает на /play/ точными строками (deploy-pozerkalam.sh) —
   tools/sw-check.mjs гоняет обе формы и падает, если якоря разъехались. */
const V = '__BUILD__';
const CACHE = 'pz-' + V;
const PAGE = '/';
const CORE = [PAGE, PAGE + 'manifest.webmanifest', PAGE + 'icon-192.png', PAGE + 'icon-512.png'];

/* Кэшировать можно только ответ с ok: 502 от nginx на перезагрузке иначе становился
   офлайн-версией игры до следующей удачной загрузки. Одна битая иконка не должна валить
   install целиком (addAll) — тогда новая версия SW никогда не активируется. */
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(CORE.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isPage = e.request.mode === 'navigate' || url.pathname === PAGE || url.pathname === PAGE + 'index.html';
  if (isPage) {
    e.respondWith(fetch(e.request)
      .then((r) => {
        if (!r.ok) return caches.match(PAGE).then((hit) => hit || r);
        const cp = r.clone(); caches.open(CACHE).then((c) => c.put(PAGE, cp)); return r;
      })
      .catch(() => caches.match(PAGE)));
  } else {
    e.respondWith(caches.match(e.request)
      .then((hit) => hit || fetch(e.request)
        .then((r) => {
          if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
          return r;
        })));
  }
});
