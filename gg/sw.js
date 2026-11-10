const CACHE_NAME = 'yt-dashboard-v14'; // 캐시 버전 강제 업데이트

// 캐싱할 에셋 (엄격한 상대경로 대신 안전한 파일명 직접 지정)
const ASSETS_TO_CACHE = [
    'index.html',
    'manifest.json',
    'favicon.png',
    'https://cdn.tailwindcss.com'
];

// 1. 서비스 워커 설치 (오류가 나도 멈추지 않는 불사신 캐싱)
self.addEventListener('install', (event) => {
    self.skipWaiting(); // 즉시 활성화
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('[PWA] 안정화된 초기 캐싱 시작 (v14)...');
            // cache.add() 대신 안전하게 하나씩 수동 fetch 후 저장
            for (let asset of ASSETS_TO_CACHE) {
                try {
                    // 리다이렉트나 CORS 제약을 무시하고 억지로라도 담기 위한 no-cors 모드
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

// 2. 구버전 찌꺼기 완벽히 제거 후 즉시 제어권 확보
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// 3. 에러 발생 확률 0%를 보장하는 강력한 Fetch 가로채기
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 구글 시트 API 요청은 캐시에 간섭하지 않고 브라우저에 그대로 위임
    if (url.href.includes('docs.google.com') || url.href.includes('script.google.com')) return;
    if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;

    // ★ 궁극의 방어막: Promise가 거절(Reject)되어 공룡화면이 나오는 것을 100% 차단
    event.respondWith((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            
            // [전략 1] 캐시 먼저 확인 (오프라인 속도 극대화 및 파일 보장)
            const cachedRes = await cache.match(req, { ignoreSearch: true });
            if (cachedRes) {
                // 백그라운드에서 네트워크로 최신화 (Stale-While-Revalidate)
                event.waitUntil(fetch(req).then(netRes => {
                    if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) cache.put(req, netRes.clone());
                }).catch(() => {}));
                return cachedRes;
            }

            // [전략 2] 캐시에 없으면 네트워크 시도
            const netRes = await fetch(req);
            if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                cache.put(req, netRes.clone());
            }
            return netRes;

        } catch (error) {
            // [오프라인 진입 & 캐시 없음 상황]
            const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
            
            if (isHtml) {
                // 저장해둔 메인 화면 HTML을 강제로 꺼내기 시도 (루트 접속시에도 index.html 반환)
                const cache = await caches.open(CACHE_NAME);
                const fallback = await cache.match('index.html', { ignoreSearch: true }) || 
                                 await cache.match('/index.html', { ignoreSearch: true });
                
                if (fallback) return fallback;

                // 캐시마저 완전히 비워져 있는 '최악의 오프라인 상태' 비상용 뼈대 화면
                const fallbackHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인 상태</title><style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background-color:#0f172a;color:#f1f5f9;margin:0;text-align:center;}h2{margin-bottom:10px;font-size:1.5rem;color:#fff;}p{color:#94a3b8;font-size:0.9rem;margin-bottom:24px;}button{padding:12px 24px;border-radius:12px;border:none;background:#4f46e5;color:white;font-weight:bold;cursor:pointer;box-shadow:0 4px 6px rgba(0,0,0,0.3);}</style></head><body><h2>인터넷 연결이 끊겼습니다</h2><p>오프라인 데이터를 불러오지 못했습니다.</p><button onclick="location.reload()">네트워크 재연결 시도</button></body></html>`;
                return new Response(fallbackHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
            
            return new Response('', { status: 404 });
        }
    })().catch(() => {
        // SW 내부 자바스크립트 엔진 자체 오류가 발생하더라도 공룡을 무조건 차단하는 최종 Fallback
        const ultimateHtml = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인</title><style>body{background-color:#0f172a;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}button{margin-top:20px;padding:10px 20px;border-radius:8px;background:#4f46e5;color:#fff;border:none;}</style></head><body><h2>앱 오프라인 모드</h2><p>네트워크 연결이 필요합니다.</p><button onclick="location.reload()">새로고침</button></body></html>`;
        return new Response(ultimateHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }));
});