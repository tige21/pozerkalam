/* Самоликвидатор старого корневого SW: после переезда игры на /play/ корневой
   scope '/' перехватывал бы лендинг и отдавал из кэша игру. Эта версия чистит
   кэши, снимает регистрацию и перезагружает открытые вкладки на живой контент. */
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((cs) => cs.forEach((c) => c.navigate(c.url)))
  );
});
