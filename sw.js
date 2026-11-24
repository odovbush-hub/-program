/* =========================================================
   EduSpace — Service Worker
   Стратегія «спочатку мережа»: якщо інтернет є — береться
   свіжа версія (зручно під час розробки), якщо немає —
   файли віддаються з кешу, і застосунок працює офлайн.
   ========================================================= */

const CACHE = 'eduspace-v2';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/data.js',
  './js/storage.js',
  './js/utils.js',
  './js/auth.js',
  './js/badges.js',
  './js/app.js',
  './js/pwa.js',
  './js/vendor/lucide.min.js',
  './js/vendor/qrcode.js',
  './js/vendor/confetti.browser.js',
  './fonts/manrope-cyrillic-400.woff2',
  './fonts/manrope-cyrillic-500.woff2',
  './fonts/manrope-cyrillic-600.woff2',
  './fonts/manrope-cyrillic-700.woff2',
  './fonts/manrope-cyrillic-800.woff2',
  './fonts/manrope-latin-400.woff2',
  './fonts/manrope-latin-500.woff2',
  './fonts/manrope-latin-600.woff2',
  './fonts/manrope-latin-700.woff2',
  './fonts/manrope-latin-800.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
