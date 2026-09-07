// Generational service worker: network-first for same-origin requests,
// cache fallback for offline. Bump CACHE and update ASSETS when files change.
const CACHE = 'generational-v3';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'vendor/supabase.js',
  'vendor/inter.woff2',
  'vendor/three/three.module.js',
  'vendor/three/addons/loaders/GLTFLoader.js',
  'vendor/three/addons/utils/BufferGeometryUtils.js',
  'icons/icon.svg',
  'assets/models/table.glb',
  'icons/icon-180.png',
  'js/app.js',
  'js/config.js',
  'js/cloud.js',
  'js/state.js',
  'js/util.js',
  'js/views/shared.js',
  'js/table3d.js',
  'js/views/home.js',
  'js/views/ideas.js',
  'js/views/sessions.js',
  'js/views/feed.js',
  'js/views/talk.js',
  'js/views/me.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // cache: 'no-cache' revalidates instead of trusting the HTTP cache's
    // 10-minute GitHub Pages max-age, so deploys reach devices immediately
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(hit => hit || caches.match('index.html')))
  );
});
