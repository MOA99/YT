const CACHE_NAME = 'yt-dashboard-cache-v10';

// 1. 내부 정적 파일 (정상 200 응답으로 안전하게 캐싱되어야 하는 필수 파일)
const LOCAL_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.png'
];

// 2. 외부 CDN 파일 (Opaque 상태로 강제 캐싱해야 하는 리소스)
const EXTERNAL_ASSETS = [
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap'
];

// 서비스 워커 설치
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('[PWA] 초기 자산 캐싱 시작 (v10)...');
            
            // [핵심 패치 1] 내부 HTML 파일은 정상(Status 200) 요청으로 담습니다. 
            // Opaque로 담기면 모바일 브라우저가 메인 화면 렌더링을 보안상 거부(공룡화면 노출)합니다.
            await cache.addAll(LOCAL_ASSETS).catch(err => console.warn('내부 캐시 에러:', err));
            
            // [핵심 패치 2] 외부 디자인 CDN 등은 no-cors 옵션을 통해 따로 저장합니다.
            for (const asset of EXTERNAL_ASSETS) {
                try {
                    const response = await fetch(asset, { mode: 'no-cors' });
                    await cache.put(asset, response);
                } catch (err) {
                    console.warn('[PWA] 외부 자산 프리캐시 실패:', asset, err);
                }
            }
        }).then(() => self.skipWaiting())
    );
});

// 구버전 캐시 삭제 및 활성화
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

// 네트워크 요청 가로채기 (캐시 전략)
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // 구글 API 요청은 무조건 네트워크를 타게 둡니다.
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
                const cache = await caches.open(CACHE_NAME);
                
                // 파라미터(?homescreen=1 등)를 무시하고 HTML을 찾습니다.
                const exactMatch = await cache.match(request, { ignoreSearch: true });
                if (exactMatch) return exactMatch;
                
                const fallbackIndex = await cache.match('/index.html', { ignoreSearch: true });
                if (fallbackIndex) return fallbackIndex;

                const fallbackRoot = await cache.match('/', { ignoreSearch: true });
                if (fallbackRoot) return fallbackRoot;

                // 캐시가 비워진 최악의 오프라인 상태 대비용 비상용 HTML 뼈대
                return new Response(
                    '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인 상태</title><style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background-color:#0f172a;color:#f1f5f9;margin:0;}h2{margin-bottom:10px;}button{padding:12px 24px;border-radius:8px;border:none;background:#4f46e5;color:white;font-weight:bold;cursor:pointer;margin-top:20px;}</style></head><body><h2>인터넷 연결이 끊겼습니다.</h2><p>오프라인 데이터를 불러올 수 없습니다.</p><button onclick="location.reload()">네트워크 재연결 시도</button></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                );
            })
        );
        return;
    }

    // [전략 B] 기타 디자인 자원 등 -> Cache First (오프라인 속도 보장)
    event.respondWith(
        caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            
            return fetch(request).then((response) => {
                if (response && (response.ok || response.type === 'opaque')) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                }
                return response;
            }).catch(() => {});
        })
    );
});