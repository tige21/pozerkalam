/* Service Worker «По зеркалам». Версию (__BUILD__) вписывает деплой-скрипт из
   sha256 артефакта — без неё пользователи навсегда залипли бы в первом кэше.
   Игра — один самодостаточный файл: network-first для страницы (свежая версия,
   когда сеть есть), кэш — офлайн-фолбэк; иконки/манифест — cache-first. */
const V = '__BUILD__';
const CACHE = 'pz-' + V;
const CORE = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isPage = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isPage) {
    e.respondWith(fetch(e.request)
      .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('/', cp)); return r; })
      .catch(() => caches.match('/')));
  } else {
    e.respondWith(caches.match(e.request)
      .then((hit) => hit || fetch(e.request)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })));
  }
});
