const CACHE_NAME = 'mod3d-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/vite.svg',
  '/icon-192.png',
  '/icon-512.png',
  // Add main.js and style.css after build if needed
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (ASSETS_TO_CACHE.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
  } else {
    // Pass through for other requests
    event.respondWith(fetch(event.request));
  }
}); 