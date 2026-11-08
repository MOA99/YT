const CACHE_NAME = 'yt-dashboard-cache-v7'; // 캐시 버전업 (업데이트 강제)

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
    const url = new URL(request.url);

    // 구글 시트 등 외부 API 통신은 SW가 훔쳐보지 않고 브라우저가 직접 처리하도록 Pass
    if (
        url.hostname.includes('google') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com')
    ) {
        return;
    }

    // GET 요청이 아니거나 http/https 스킴이 아닌 경우 Pass
    if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
        return;
    }

    event.respondWith(
        (async () => {
            try {
                // 1단계: 무조건 네트워크(서버)에서 최신 데이터를 먼저 가져옵니다.
                const networkResponse = await fetch(request);
                
                // 네트워크 응답이 정상이면 캐시를 최신본으로 갱신합니다.
                if (networkResponse && networkResponse.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    cache.put(request, networkResponse.clone());
                }
                return networkResponse;
                
            } catch (error) {
                // 2단계: 인터넷이 끊겨서 fetch에 실패한 경우 (오프라인)
                
                // 쿼리 파라미터(?xxx=yyy)를 무시하고 동일한 파일이 캐시에 있는지 찾습니다. (PWA 홈화면 실행 방어)
                const cachedResponse = await caches.match(request, { ignoreSearch: true });
                if (cachedResponse) {
                    return cachedResponse;
                }

                // 3단계: 캐시에도 정확한 파일이 없고, 사용자가 페이지 이동(HTML 렌더링)을 시도한 경우
                if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
                    const cache = await caches.open(CACHE_NAME);
                    // 백업해둔 index.html을 강제로 띄워 공룡 게임/오프라인 에러 화면을 방지합니다.
                    const fallbackHTML = await cache.match('/index.html', { ignoreSearch: true }) || await cache.match('/', { ignoreSearch: true });
                    if (fallbackHTML) {
                        return fallbackHTML;
                    }
                }

                // 아무것도 매칭되지 않았을 때의 최후 수단
                return new Response('오프라인 상태이며 저장된 화면이 없습니다.', {
                    status: 503,
                    headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
                });
            }
        })()
    );
});