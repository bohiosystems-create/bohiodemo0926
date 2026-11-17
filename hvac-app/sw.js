/* Offline shell: cache-first for app files, so the app opens without signal on site. Bump VERSION on release. */
const VERSION = 'bohio-hvac-v20';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'pricing.js', 'tracker.js', 'manifest.webmanifest', 'icons/icon.svg', 'fonts/NimbusSans-Regular.woff2', 'fonts/NimbusSans-Bold.woff2', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'sample/baseline.csv', 'sample/genhvac.csv'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSION).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match('index.html'))));
});
