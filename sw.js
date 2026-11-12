const CACHE_NAME = 'yt-dashboard-v21'; // 성능 및 폰트 캐싱 최적화 버전 업

// 초기 캐싱할 핵심 에셋 (구글 폰트 스타일시트 추가)
const ASSETS_TO_CACHE = [
    'index.html',
    'manifest.json',
    'favicon.png',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap'
];

// 1. 서비스 워커 설치 (오류가 나도 멈추지 않는 안정화 캐싱)
self.addEventListener('install', (event) => {
    self.skipWaiting(); // 즉시 활성화
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('[PWA] 안정화된 초기 캐싱 시작 (v15)...');
            for (let asset of ASSETS_TO_CACHE) {
                try {
                    const req = new Request(asset, { mode: 'no-cors' });
                    const res = await fetch(req);
                    if (res) {
                        await cache.put(req, res);
                    }
                } catch (e) {
                    console.warn('[PWA] 에셋 캐시 실패 (무시됨):', asset, e);
                }
            }
        })
    );
});

// 2. 구버전 캐시 완벽 제거 후 즉시 제어권 확보
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// 3. 강력한 Fetch 가로채기 (폰트 파일 및 정적 에셋 Stale-While-Revalidate 적용)
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 구글 시트 API 요청은 캐시에 간섭하지 않고 브라우저에 그대로 위임
    if (url.href.includes('docs.google.com') || url.href.includes('script.google.com') || url.href.includes('googletagmanager.com') || url.href.includes('google-analytics.com')) return;
    if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;

    event.respondWith((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            
            // 구글 폰트 파일(fonts.gstatic.com)은 한 번 받으면 변하지 않으므로 ignoreSearch 없이 정확히 매칭
            const isFontAsset = url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com');
            const cachedRes = await cache.match(req, { ignoreSearch: !isFontAsset });
            
            if (cachedRes) {
                // 폰트 파일이 아닌 경우에만 백그라운드 최신화 수행 (불필요한 네트워크 트래픽 절감)
                if (!url.hostname.includes('fonts.gstatic.com')) {
                    event.waitUntil(fetch(req).then(netRes => {
                        if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) cache.put(req, netRes.clone());
                    }).catch(() => {}));
                }
                return cachedRes;
            }

            // 캐시에 없으면 네트워크 시도 후 캐시에 저장
            const netRes = await fetch(req);
            if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                cache.put(req, netRes.clone());
            }
            return netRes;

        } catch (error) {
            // 오프라인 진입 & 캐시 없음 상황
            const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
            
            if (isHtml) {
                const cache = await caches.open(CACHE_NAME);
                const fallback = await cache.match('index.html', { ignoreSearch: true }) || 
                                 await cache.match('/index.html', { ignoreSearch: true });
                
                if (fallback) return fallback;

                const fallbackHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인 상태</title><style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background-color:#0f172a;color:#f1f5f9;margin:0;text-align:center;}h2{margin-bottom:10px;font-size:1.5rem;color:#fff;}p{color:#94a3b8;font-size:0.9rem;margin-bottom:24px;}button{padding:12px 24px;border-radius:12px;border:none;background:#4f46e5;color:white;font-weight:bold;cursor:pointer;box-shadow:0 4px 6px rgba(0,0,0,0.3);}</style></head><body><h2>인터넷 연결이 끊겼습니다</h2><p>오프라인 데이터를 불러오지 못했습니다.</p><button onclick="location.reload()">네트워크 재연결 시도</button></body></html>`;
                return new Response(fallbackHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
            
            return new Response('', { status: 404 });
        }
    })().catch(() => {
        const ultimateHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인</title><style>body{background-color:#0f172a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}button{margin-top:20px;padding:10px 20px;border-radius:8px;background:#4f46e5;color:#fff;border:none;}</style></head><body><h2>앱 오프라인 모드</h2><p>네트워크 연결이 필요합니다.</p><button onclick="location.reload()">새로고침</button></body></html>`;
        return new Response(ultimateHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }));
});
