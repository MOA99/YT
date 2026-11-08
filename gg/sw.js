const CACHE_NAME = 'yt-dashboard-cache-v6';

// 초기에 무조건 캐싱할 필수 정적 파일 및 외부 디자인(CDN) 목록
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.png',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap'
];

// 1. 서비스 워커 설치 (에러가 나도 중단되지 않는 유연한 설치 방식)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[PWA] 초기 자산 캐싱 시작...');
            // Promise.allSettled를 사용하여 파일 1개가 실패해도 SW 설치가 취소되지 않도록 방어
            return Promise.allSettled(
                PRECACHE_ASSETS.map((asset) =>
                    cache.add(asset).catch((err) => {
                        console.warn('[PWA] 프리캐시 건너뜀 (문제없음):', asset, err);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// 2. 서비스 워커 활성화 및 구버전 찌꺼기 캐시 정리
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[PWA] 구버전 캐시 삭제 완료:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. 네트워크 요청 가로채기 (Network First 전략 -> 실패시 Cache 사용)
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = request.url;

    // 구글 시트 등 외부 API 통신은 SW가 훔쳐보지 않고 브라우저가 직접 처리하도록 Pass
    if (
        url.includes('docs.google.com') ||
        url.includes('script.google.com') ||
        url.includes('googleusercontent.com')
    ) {
        return;
    }

    // GET 요청이 아니거나 http/https 스킴이 아닌 경우 Pass
    if (request.method !== 'GET' || !url.startsWith('http')) {
        return;
    }

    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                // 네트워크 성공 시: 응답을 복제하여 캐시에 최신본으로 업데이트 후 화면에 표시
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(async () => {
                // 인터넷 끊김(오프라인) 상태 시: 캐시 창고에서 동일한 파일이 있는지 확인
                const cachedResponse = await caches.match(request);
                if (cachedResponse) {
                    return cachedResponse;
                }

                // 캐시에도 없고, 사용자가 페이지 이동(HTML)을 요청한 경우 index.html 반환
                if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
                    const rootFallback = await caches.match('/index.html') || await caches.match('/');
                    if (rootFallback) return rootFallback;
                }

                // 아무것도 없을 때의 예외 처리
                return new Response('오프라인 상태이며 저장된 데이터가 없습니다.', {
                    status: 503,
                    headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
                });
            })
    );
});