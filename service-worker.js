// JS/CSS use stale-while-revalidate, so a forgotten cache-name bump cannot pin old code forever.
const STATIC_CACHE = 'libretv-static-player-stability-v1';
const STATIC_CACHE_LIMIT = 160;
const PRECACHE_URLS = [
  '/css/styles.css',
  '/css/player.css',
  '/css/index.css',
  '/css/modals.css',
  '/css/watch.css',
  '/js/config.js',
  '/js/utils/media.js',
  '/js/utils/storage.js',
  '/js/utils/playback-state.js',
  '/js/watch-room/player-adapter.js',
  '/js/watch-room/sync-clock.js',
  '/js/watch-room/controller.js',
  '/js/watch-room/ui.js',
  '/js/danmu/match-core.js',
  '/js/player/network-telemetry.js',
  '/js/player.js',
  '/libs/hls.min.js',
  '/libs/artplayer.min.js',
  '/libs/artplayer-plugin-danmuku.js',
];

const STATIC_DESTINATIONS = new Set(['script', 'style', 'font', 'image']);
const MEDIA_EXTENSIONS = /\.(?:m3u8|ts|m4s|mp4|mkv|webm|mov|avi|flv|mp3|aac)(?:$|\?)/i;
const STATIC_EXTENSIONS = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)(?:$|\?)/i;
const SENSITIVE_QUERY_KEYS = /^(?:token|access_token|auth|authorization|signature|sig|expires|expiry|key)$/i;

function hasSensitiveQuery(url) {
  return [...url.searchParams.keys()].some(key => SENSITIVE_QUERY_KEYS.test(key));
}

function isCacheableStaticRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === '/service-worker.js') return false;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/proxy/')) return false;
  if (MEDIA_EXTENSIONS.test(url.pathname) || hasSensitiveQuery(url)) return false;
  return STATIC_DESTINATIONS.has(request.destination) && STATIC_EXTENSIONS.test(url.pathname);
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - STATIC_CACHE_LIMIT;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map(request => cache.delete(request)));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.allSettled(PRECACHE_URLS.map(async url => {
      const response = await fetch(url, { cache: 'reload' });
      if (response.ok && response.type === 'basic') await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('libretv-static-') && name !== STATIC_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!isCacheableStaticRequest(request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    const update = fetch(request, { cache: 'no-cache' }).then(async response => {
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
        await trimCache(cache);
      }
      return response;
    });

    if (cached) {
      event.waitUntil(update.catch(() => {}));
      return cached;
    }
    return update;
  })());
});
