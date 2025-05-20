const CACHE_NAME = 'mod3d-cache-v1';
const ASSETS_TO_CACHE = [
  './', // The root of the /mosaic3d/ subfolder
  './index.html',
  './manifest.json',
  './vite.svg',
  './icon-192.png',
  './icon-512.png',
  './assets/room_model.glb', // Add the 3D model to the cache
  // Add hashed JS/CSS bundles after build if not using automated precaching
  // e.g. './assets/index-abcd1234.js'
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
  // For URLs within our scope
  if (ASSETS_TO_CACHE.includes(url.pathname.replace(/^\/mosaic3d/, '.')) || 
      ASSETS_TO_CACHE.includes(url.pathname)) {
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