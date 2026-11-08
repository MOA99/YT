const CACHE_NAME = 'yt-dashboard-cache-v8';

// 초기에 무조건 캐싱할 필수 정적 파일 및 외부 디자인(CDN) 목록
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.png',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap'
];

// 1. 서비스 워커 설치
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[PWA] 초기 자산 캐싱 시작...');
            return Promise.allSettled(
                PRECACHE_ASSETS.map((asset) =>
                    cache.add(asset).catch((err) => {
                        console.warn('[PWA] 프리캐시 건너뜀:', asset, err);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// 2. 서비스 워커 활성화 및 구버전 캐시 정리
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

// 3. 자원 성격에 따른 스마트 캐싱 처리
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // [중요] 구글 시트(API) 요청만 캐시에서 완전히 제외하고 직접 통과시킵니다.
    // (구글 폰트나 외부 라이브러리는 제외하면 안 됨)
    if (url.href.includes('docs.google.com/spreadsheets') || url.href.includes('script.google.com/macros')) {
        return;
    }

    if (request.method !== 'GET' || !url.protocol.startsWith('http')) return;

    // [전략 A] 화면 전환(HTML) 요청 -> Network First (실패 시 무조건 저장된 화면 띄움)
    if (request.mode === 'navigate' || (request.headers.get('accept') && request.headers.get('accept').includes('text/html'))) {
        event.respondWith(
            fetch(request).then((response) => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                return response;
            }).catch(async () => {
                // 비행기 모드(오프라인)일 때 캐시된 HTML 파일을 강제로 꺼내어 화면을 그립니다.
                const exactMatch = await caches.match(request, { ignoreSearch: true });
                if (exactMatch) return exactMatch;
                
                const cache = await caches.open(CACHE_NAME);
                const fallback = await cache.match('/index.html', { ignoreSearch: true }) || await cache.match('/', { ignoreSearch: true });
                if (fallback) return fallback;
            })
        );
        return;
    }

    // [전략 B] 정적 파일(JS, CSS, 폰트, 아이콘 등) -> Cache First (속도 극대화)
    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
            // 캐시에 파일이 있으면 네트워크 연결을 기다리지 않고 즉시 반환! (오프라인 해결 핵심)
            if (cachedResponse) {
                return cachedResponse;
            }
            
            // 캐시에 없다면 네트워크에서 받아온 뒤 캐시에 저장
            return fetch(request).then((response) => {
                if (response && response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                }
                return response;
            }).catch(() => {
                // 오프라인 상태에서 찾을 수 없는 기타 파일(이미지 등)은 무시
            });
        })
    );
});