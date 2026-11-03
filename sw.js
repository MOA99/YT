const CACHE_NAME = 'yt-dashboard-cache-v3';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] 프리캐시 건너뜀:', asset, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 구글 시트 및 앱스크립트 요청은 캐시를 절대 타지 않고 항상 실시간 네트워크에서 최신 데이터를 가져오도록 설정
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = request.url;

  if (url.includes('docs.google.com/spreadsheets') || url.includes('script.google.com')) {
    event.respondWith(
      fetch(request, { cache: 'reload', headers: { 'Cache-Control': 'no-cache, no-store' } }).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  if (request.method !== 'GET' || !url.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;

        if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
          const rootFallback = await caches.match('/');
          if (rootFallback) return rootFallback;
        }

        return new Response('오프라인 상태입니다.', {
          status: 503,
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});