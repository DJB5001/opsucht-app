// Service Worker für OPSUCHT.INFO PWA
// Cached die statischen Dateien, damit die App auch offline startet.
// Live-Daten (Auktionen, Markt, Verlauf) werden weiterhin frisch aus dem
// Netz geladen und NICHT gecached.

const CACHE_NAME = 'opsucht-static-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './css/user-profile.css',
  './css/auth.css',
  './js/chart.js',
  './js/script.js',
  './js/config.js',
  './js/supabase-config.js',
  './js/supabase-compat.js',
  './manifest.webmanifest'
];

// Installation: statische Dateien cachen
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Aktivierung: alte Caches aufräumen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch-Strategie:
// - API-/Verlaufs-Anfragen (opsucht.net, githubusercontent, supabase): immer Netz (nie cachen)
// - statische Dateien: erst Cache, dann Netz
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  const isLiveData =
    url.includes('api.opsucht.net') ||
    url.includes('raw.githubusercontent.com') ||
    url.includes('supabase.co') ||
    url.includes('supabase.com') ||
    url.includes('playerdb.co') ||
    url.includes('ashcon.app');

  if (isLiveData) {
    // Live-Daten immer frisch aus dem Netz holen
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Statische Dateien: Cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
