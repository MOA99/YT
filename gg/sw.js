const CACHE_NAME = 'yt-dashboard-v19'; // ★ index.html 수정 후 배포 시 이 숫자를 v17, v18로 올려주세요!

// 초기 캐싱할 핵심 에셋
const ASSETS_TO_CACHE = [
    'index.html',
    'manifest.json',
    'favicon.png',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700;800&display=swap'
];

// 1. 서비스 워커 설치 (브라우저 HTTP 캐시를 무시하고 서버에서 최신 파일 강제 확보)
self.addEventListener('install', (event) => {
    self.skipWaiting(); // 대기 없이 즉시 활성화
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log(`[PWA] 최신 캐싱 시작 (${CACHE_NAME})...`);
            for (let asset of ASSETS_TO_CACHE) {
                try {
                    const isExternal = asset.startsWith('http');
                    // 내부 파일(index.html 등)은 브라우저 캐시를 무시(no-store)하고 서버에서 진짜 최신본을 가져옴
                    const req = new Request(asset, isExternal ? { mode: 'no-cors' } : { cache: 'no-store' });
                    const res = await fetch(req);
                    if (res) {
                        await cache.put(asset, res);
                    }
                } catch (e) {
                    console.warn('[PWA] 에셋 캐시 실패 (무시됨):', asset, e);
                }
            }
        })
    );
});

// 2. 구버전 캐시(v14, v15 등) 완벽히 제거 후 즉시 제어권 확보
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => {
                    console.log('[PWA] 구버전 캐시 삭제됨:', key);
                    return caches.delete(key);
                })
            );
        }).then(() => self.clients.claim()) // 열린 모든 탭/앱의 제어권을 즉시 가져옴
    );
});

// 3. Fetch 가로채기 (HTML은 무조건 네트워크 최신본 우선, 정적 파일만 캐시 우선)
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 구글 시트 API 요청은 캐시에 간섭하지 않고 브라우저에 그대로 위임
    if (url.href.includes('docs.google.com') || url.href.includes('script.google.com')) return;
    if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;

    const isHtml = req.mode === 'navigate' || 
                   (req.headers.get('accept') || '').includes('text/html') || 
                   url.pathname.endsWith('/') || 
                   url.pathname.endsWith('index.html');

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);

        // ★ [핵심 해결책] HTML 페이지 요청은 무조건 네트워크(서버 최신본)를 최우선으로 시도! (Network-First)
        if (isHtml) {
            try {
                // 브라우저 자체 캐시도 무시(no-store)하고 서버의 최신 index.html을 직접 가져옴
                const netRes = await fetch(req, { cache: 'no-store' });
                if (netRes && netRes.status === 200) {
                    cache.put(req, netRes.clone()); // 오프라인 대비용으로 최신본을 캐시에 덮어쓰기
                    return netRes;
                }
            } catch (error) {
                // 인터넷이 끊긴 오프라인 상태일 때만 캐시에서 꺼내서 보여줌
                const cachedHtml = await cache.match(req, { ignoreSearch: true }) || 
                                   await cache.match('index.html', { ignoreSearch: true }) || 
                                   await cache.match('/index.html', { ignoreSearch: true });
                if (cachedHtml) return cachedHtml;

                // 캐시마저 없는 최악의 오프라인 상태
                const fallbackHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인 상태</title><style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background-color:#0f172a;color:#f1f5f9;margin:0;text-align:center;}h2{margin-bottom:10px;font-size:1.5rem;color:#fff;}p{color:#94a3b8;font-size:0.9rem;margin-bottom:24px;}button{padding:12px 24px;border-radius:12px;border:none;background:#4f46e5;color:white;font-weight:bold;cursor:pointer;box-shadow:0 4px 6px rgba(0,0,0,0.3);}</style></head><body><h2>인터넷 연결이 끊겼습니다</h2><p>오프라인 데이터를 불러오지 못했습니다.</p><button onclick="location.reload()">네트워크 재연결 시도</button></body></html>`;
                return new Response(fallbackHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
        }

        // [정적 에셋] 아이콘, 폰트, Tailwind 스크립트 등은 속도 향상을 위해 캐시 우선(Cache-First) 유지
        try {
            const isFontAsset = url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com');
            const cachedRes = await cache.match(req, { ignoreSearch: !isFontAsset });
            
            if (cachedRes) {
                if (!url.hostname.includes('fonts.gstatic.com')) {
                    event.waitUntil(fetch(req).then(netRes => {
                        if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) cache.put(req, netRes.clone());
                    }).catch(() => {}));
                }
                return cachedRes;
            }

            const netRes = await fetch(req);
            if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                cache.put(req, netRes.clone());
            }
            return netRes;
        } catch (error) {
            return new Response('', { status: 404 });
        }
    })().catch(() => {
        const ultimateHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인</title><style>body{background-color:#0f172a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}button{margin-top:20px;padding:10px 20px;border-radius:8px;background:#4f46e5;color:#fff;border:none;}</style></head><body><h2>앱 오프라인 모드</h2><p>네트워크 연결이 필요합니다.</p><button onclick="location.reload()">새로고침</button></body></html>`;
        return new Response(ultimateHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }));
});