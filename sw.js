/* Minimal PWA worker: required for installability. Does not intercept page loads. */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', () => {
  // Network only. Intercepting HTML/JS here previously hung Docker browser tabs.
});
