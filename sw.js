const CACHE_NAME = 'yt-dashboard-cache-v2';

// 오프라인 작동을 위해 사전 캐싱할 핵심 정적 리소스
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap'
];

// 1. 설치(Install) 이벤트: 개별 캐싱으로 404 발생 시에도 전체 설치 중단 방지
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] 개별 리소스 프리캐싱 건너뜀:', asset, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. 활성화(Activate) 이벤트: 구버전 캐시 자동 정리
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

// 3. 페치(Fetch) 이벤트: 네트워크 우선 + 오프라인 캐시 폴백 전략 (TypeError 방지)
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // POST 요청이나 크롬 익스텐션 스킴 등 캐싱 불가 대상 제외
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        // 성공적인 응답일 경우 캐시에 복사본 보관 (동적 캐싱)
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        // 네트워크 단절/오프라인 시 캐시된 응답 반환
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        // HTML 페이지 요청인데 캐시도 없는 경우 메인 루트 반환
        if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
          const rootFallback = await caches.match('/');
          if (rootFallback) return rootFallback;
        }

        // 캐시에도 없는 자원 요청 시 undefined 대신 안전한 503 Response 반환
        return new Response('네트워크 연결이 오프라인 상태이며 캐시된 데이터가 없습니다.', {
          status: 503,
          statusText: 'Service Unavailable (Offline)',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      })
  );
});