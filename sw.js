/* ═══════════════════════════════════════════════════════════════════════
   SERVICE WORKER — القرآن الكريم
   ⚠️ مهم: كل مرة تعمل تحديث، غيّر رقم CACHE_VERSION هنا
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v1.0.2';
const CACHE_NAME = `quran-cache-${CACHE_VERSION}`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/app.js',
    './js/pwa.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png'
];

/* ─── Install ─── */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .catch((err) => console.warn('[SW] pre-cache failed:', err))
            .then(() => self.skipWaiting())  // ⭐ الجديد: يتفعّل فورًا
    );
});

/* ─── Activate ─── */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(
                names
                    .filter((n) => n.startsWith('quran-cache-') && n !== CACHE_NAME)
                    .map((n) => caches.delete(n))
            )
        ).then(() => self.clients.claim())
    );
});

/* ─── Fetch ─── */
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

    // 1) لا تخزين لملفات الصوت و API
    if (
        url.hostname.includes('mp3quran.net') ||
        url.hostname.includes('alquran.cloud') ||
        url.hostname.includes('archive.org')
    ) {
        event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
        return;
    }

    // 2) Google Fonts → cache-first
    if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                return fetch(event.request).then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
                    return res;
                });
            })
        );
        return;
    }

    // 3) HTML / navigation → network-first
    if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
        event.respondWith(
            fetch(event.request)
                .then((res) => {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
                    return res;
                })
                .catch(() => caches.match(event.request).then((r) => r || caches.match('./index.html')))
        );
        return;
    }

    // 4) باقي الملفات → cache-first
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request)
                .then((res) => {
                    if (res && res.status === 200 && res.type === 'basic') {
                        const clone = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
                    }
                    return res;
                })
                .catch(() => new Response('', { status: 503 }));
        })
    );
});

/* ─── Messages ─── */
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});