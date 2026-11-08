const CACHE_NAME = 'yt-dashboard-cache-v1';

// 초기에 무조건 캐싱할 필수 정적 파일 목록
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.png'
];

// 1. 서비스 워커 설치 및 정적 파일 캐싱
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[PWA] 초기 자산 캐싱 완료');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // 즉시 활성화 (대기 상태 건너뛰기)
    self.skipWaiting();
});

// 2. 서비스 워커 활성화 및 구버전 캐시 정리
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    // 현재 캐시 버전과 다르면 구버전 캐시 삭제
                    if (cache !== CACHE_NAME) {
                        console.log('[PWA] 구버전 캐시 삭제:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. 네트워크 요청 가로채기 (Offline 지원 핵심 로직)
self.addEventListener('fetch', (event) => {
    const request = event.request;

    // 구글 시트 데이터(API) 요청일 경우 -> 네트워크 우선 (Network First)
    // 오프라인일 경우 빈 응답을 넘겨, 앱 자체의 localStorage 캐시 로직이 작동하도록 유도
    if (request.url.includes('docs.google.com') || request.url.includes('script.google.com')) {
        event.respondWith(
            fetch(request).catch(() => {
                return new Response(null, { status: 503, statusText: 'Offline' });
            })
        );
        return;
    }

    // 그 외 일반 정적 에셋(HTML, CSS, 폰트, 이미지 등) -> 캐시 우선 (Cache First)
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            // 캐시에 있으면 즉시 반환 (오프라인 지원)
            if (cachedResponse) {
                return cachedResponse;
            }

            // 캐시에 없으면 네트워크로 요청 후 동적으로 캐시에 저장
            return fetch(request).then((networkResponse) => {
                // 유효한 HTTP GET 요청만 캐시에 추가 (Tailwind CSS, 구글 폰트 등)
                if (request.url.startsWith('http') && request.method === 'GET') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // 오프라인인데 캐시에도 없는 페이지를 요청하면 기본 index.html 반환
                if (request.mode === 'navigate') {
                    return caches.match('/index.html');
                }
            });
        })
    );
});