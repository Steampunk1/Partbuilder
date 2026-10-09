// Part Builder service worker — offline cache for the shop laptop.
// Same strategy as PipePro's sw.js: precache every local file, then
// stale-while-revalidate so loads are instant and updates arrive on the
// next visit. BUMP the CACHE version on every deploy.
const CACHE = 'partbuilder-v5';

const LOCAL = [
  './',
  './index.html',
  './manifest.json',
  './pb-runtime.js',
  './app.js',
  './profile-db.js',
  './three-d-stage.js',
  './vendor/react.production.min.js',
  './vendor/react-dom.production.min.js',
  './vendor/qrcode.js',
  './vendor/three/three.module.js',
  './vendor/three/three.core.js',
  './vendor/three/OrbitControls.js',
  './vendor/three/OBJExporter.js',
  './vendor/three/GLTFExporter.js',
  './assets/colors_and_type.css',
  './assets/logo-chrome.jpg',
  './fonts/fonts.css',
  './fonts/saira-condensed-700.woff2',
  './fonts/saira-condensed-800.woff2',
  './fonts/saira-500.woff2',
  './fonts/saira-700.woff2',
  './fonts/barlow-400.woff2',
  './fonts/barlow-500.woff2',
  './fonts/barlow-700.woff2',
  './fonts/jetbrains-mono-400.woff2',
  './fonts/jetbrains-mono-500.woff2',
  './fonts/jetbrains-mono-600.woff2',
  './fonts/jetbrains-mono-700.woff2',
  './icon-192.png',
  './icon-512.png',
  './icon-apple.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:'reload' bypasses the HTTP cache so the precache is really fresh.
      // No .catch here on purpose: Cache.addAll is atomic, so letting a failed
      // precache REJECT the install keeps the old SW + its complete cache
      // serving until a good install succeeds. (A swallowed failure would
      // activate an empty cache and delete the working one.)
      .then((c) => c.addAll(LOCAL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // no cross-origin deps at runtime
  // Stale-while-revalidate: serve from cache instantly, refresh in the
  // background. cache:'no-cache' forces revalidation with the server —
  // without it the refresh can read the browser's HTTP cache and re-store
  // the same stale copy forever.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request, { cache: 'no-cache' }).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => hit || new Response('Offline', { status: 503 }));
      return hit || net;
    })
  );
});
