const CACHE_VERSION = 'v3.0.1';
const CACHE_NAME = `quran-cache-${CACHE_VERSION}`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './css/adhkar.css',
    './js/app.js',
    './js/pwa.js',
    './js/adhkar.js',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    './data/texts.js',
    './data/timings-1.js',
    './data/timings-2.js',
    './data/timings-3.js',
    './data/timings-4.js',
    './data/timings-5.js',
    './data/timings-6.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .catch(() => {})
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) =>
                Promise.all(
                    names
                        .filter((n) => n.startsWith('quran-cache-') && n !== CACHE_NAME)
                        .map((n) => caches.delete(n))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);

        if (url.pathname.includes('/data/')) {
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

    if (url.hostname.includes('mp3quran.net') ||
        url.hostname.includes('alquran.cloud') ||
        url.hostname.includes('archive.org')) {
        event.respondWith(
            fetch(event.request, { cache: 'no-store', credentials: 'omit' })
                .catch(() => new Response('', { status: 503 }))
        );
        return;
    }

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

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});