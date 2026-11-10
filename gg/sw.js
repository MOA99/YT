// 캐시 버전을 관리하여 업데이트 시 기존 캐시를 무효화 (버전 강제 업데이트용)
const CACHE_NAME = 'yt-dashboard-v14'; 

// 캐싱할 핵심 에셋 목록 (오프라인 구동을 위한 필수 파일)
const ASSETS_TO_CACHE = [
    'index.html',
    'manifest.json',
    'favicon.png',
    'https://cdn.tailwindcss.com'
];

// [1단계] 서비스 워커 설치 (Install)
self.addEventListener('install', (event) => {
    self.skipWaiting(); // 대기 상태를 건너뛰고 즉시 활성화
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('[PWA] 안정화된 초기 캐싱 시작 (v14)...');
            // cache.add() 대신 안전하게 하나씩 수동 fetch 후 저장 (실패 시 앱 중단 방지)
            for (let asset of ASSETS_TO_CACHE) {
                try {
                    // 리다이렉트나 CORS 제약을 무시하기 위해 no-cors 모드 사용
                    const req = new Request(asset, { mode: 'no-cors' });
                    const res = await fetch(req);
                    if (res) await cache.put(req, res);
                } catch (e) {
                    console.warn('[PWA] 에셋 캐시 실패 (무시됨):', asset, e);
                }
            }
        })
    );
});

// [2단계] 서비스 워커 활성화 (Activate) - 구버전 캐시 정리
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            // 현재 버전(CACHE_NAME)이 아닌 이전 캐시 데이터는 모두 삭제
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim()) // 활성화 즉시 모든 클라이언트(페이지) 제어권 확보
    );
});

// [3단계] 네트워크 요청 가로채기 (Fetch) - 오프라인 지원 및 캐시 전략
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Google Sheets API 데이터 요청은 캐싱하지 않고 항상 네트워크를 통해 최신 데이터 확보
    if (url.href.includes('docs.google.com') || url.href.includes('script.google.com')) return;
    
    // GET 요청이 아니거나 HTTP/HTTPS 프로토콜이 아닌 경우 처리 안 함
    if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;

    event.respondWith((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            
            // [전략 1] Stale-While-Revalidate: 캐시 먼저 반환 후 백그라운드에서 네트워크로 업데이트
            const cachedRes = await cache.match(req, { ignoreSearch: true });
            if (cachedRes) {
                event.waitUntil(fetch(req).then(netRes => {
                    // 네트워크 응답이 정상(200)이거나 opaque 타입일 경우 캐시 갱신
                    if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                        cache.put(req, netRes.clone());
                    }
                }).catch(() => {})); // 오프라인 시 에러 무시
                return cachedRes;
            }

            // [전략 2] 캐시에 없으면 네트워크 시도 후 캐시에 저장
            const netRes = await fetch(req);
            if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                cache.put(req, netRes.clone());
            }
            return netRes;

        } catch (error) {
            // [오프라인 상태 처리] 네트워크 연결이 없고 캐시에도 데이터가 없을 때
            const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
            
            if (isHtml) {
                const cache = await caches.open(CACHE_NAME);
                // 미리 저장해둔 index.html을 강제 반환하여 오프라인 앱 구동 유지
                const fallback = await cache.match('index.html', { ignoreSearch: true }) || 
                                 await cache.match('/index.html', { ignoreSearch: true });
                
                if (fallback) return fallback;

                // 캐시마저 완전히 비워진 최악의 경우, 최소한의 뼈대 UI 제공
                const fallbackHtml = `<!DOCTYPE html><html lang="ko"><body><h2>인터넷 연결이 끊겼습니다</h2><button onclick="location.reload()">재연결 시도</button></body></html>`;
                return new Response(fallbackHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
            return new Response('', { status: 404 });
        }
    })().catch(() => {
        // SW 엔진 자체 치명적 에러 발생 시 최후의 방어막 (크롬 공룡 화면 방지)
        return new Response(`<!DOCTYPE html><html lang="ko"><body><h2>앱 오프라인 모드</h2><button onclick="location.reload()">새로고침</button></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }));
});