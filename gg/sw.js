const CACHE_NAME = 'yt-dashboard-v12'; // 캐시 버전 업데이트

// 어떤 경로(서브폴더)에 호스팅되더라도 상대경로로 안전하게 캐싱
const LOCAL_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './favicon.png'
];

// 1. 서비스 워커 설치 (무조건 대기열 무시하고 즉시 설치)
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[PWA] 안정화된 초기 캐싱 시작 (v12)...');
            return Promise.allSettled(
                LOCAL_ASSETS.map(asset => cache.add(asset).catch(err => console.warn('캐시 실패:', asset, err)))
            );
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

    // 무조건 유효한 Response 객체를 반환하도록 async 래퍼로 감쌈 (공룡화면 완벽 차단)
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        
        // [전략 A] 디자인 요소 (Tailwind, 폰트, 이미지): 캐시 우선 (Cache First)
        const isStatic = url.href.includes('tailwindcss.com') || url.href.includes('fonts.') || url.pathname.endsWith('.png');
        if (isStatic) {
            const cached = await cache.match(req, { ignoreSearch: true });
            if (cached) return cached;
            try {
                const netRes = await fetch(req);
                // 외부 CDN은 불투명 응답(opaque)일 수 있으므로 이를 허용하여 저장
                if (netRes && (netRes.status === 200 || netRes.type === 'opaque')) {
                    cache.put(req, netRes.clone());
                }
                return netRes;
            } catch (e) {
                // 디자인 파일 로드 실패 시 무의미한 에러 대신 404 리턴하여 서비스 워커 크래시 방어
                return new Response('', { status: 404 });
            }
        }

        // [전략 B] 메인 화면 및 기타 데이터: 네트워크 우선 (Network First)
        try {
            const netRes = await fetch(req);
            if (netRes && netRes.status === 200) {
                cache.put(req, netRes.clone());
            }
            return netRes;
        } catch (error) {
            // [오프라인 진입] 통신이 완전히 끊김
            
            // 1. 기존에 저장된 캐시 화면이 있는지 확인
            const cachedRes = await cache.match(req, { ignoreSearch: true });
            if (cachedRes) return cachedRes;

            // 2. HTML(화면 전환) 요청인지 안전하게 판별
            const acceptHeader = req.headers.get('accept');
            const isHtml = req.mode === 'navigate' || (acceptHeader && acceptHeader.includes('text/html'));
            
            if (isHtml) {
                // 루트 경로 또는 index.html을 강제로 꺼내기
                const fallbackHtml = await cache.match('./index.html', { ignoreSearch: true }) || await cache.match('./', { ignoreSearch: true });
                if (fallbackHtml) return fallbackHtml;

                // 캐시마저 완전히 비워져 있는 '최악의 오프라인 상태' 뼈대 화면
                return new Response(
                    '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>오프라인 상태</title><style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background-color:#0f172a;color:#f1f5f9;margin:0;text-align:center;}h2{margin-bottom:10px;font-size:1.5rem;color:#fff;}p{color:#94a3b8;font-size:0.9rem;margin-bottom:24px;}button{padding:12px 24px;border-radius:12px;border:none;background:#4f46e5;color:white;font-weight:bold;cursor:pointer;box-shadow:0 4px 6px rgba(0,0,0,0.3);}</style></head><body><h2>인터넷 연결이 끊겼습니다</h2><p>오프라인 데이터를 불러오지 못했습니다.</p><button onclick="location.reload()">네트워크 재연결 시도</button></body></html>',
                    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                );
            }

            // 그 외 알 수 없는 리소스 로드 실패 시
            return new Response('', { status: 404 });
        }
    })());
});