
/* ═══════════════════════════════════════════════════════════════════════
   PWA — تسجيل Service Worker + إشعار التحديثات
   ═══════════════════════════════════════════════════════════════════════ */
(function setupPWAUpdates() {
    if (!('serviceWorker' in navigator)) return;

    let _reloadAfterUpdate = false;

    navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then((reg) => {
            console.log('[PWA] Service Worker registered');
            setInterval(() => reg.update(), 5 * 60 * 1000);

            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                if (!newWorker) return;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateBanner(() => newWorker.postMessage({ type: 'SKIP_WAITING' }));
                    }
                });
            });

            if (reg.waiting && navigator.serviceWorker.controller) {
                showUpdateBanner(() => reg.waiting.postMessage({ type: 'SKIP_WAITING' }));
            }
        })
        .catch((err) => console.warn('[PWA] SW failed:', err));

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_reloadAfterUpdate) return;
        _reloadAfterUpdate = true;
        window.location.reload();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            navigator.serviceWorker.getRegistration().then(reg => reg && reg.update());
        }
    });

    function showUpdateBanner(onConfirm) {
        if (document.getElementById('pwaUpdateBanner')) return;
        const bar = document.createElement('div');
        bar.id = 'pwaUpdateBanner';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#d4af37,#ecc964);color:#0a0d13;padding:12px 16px;display:flex;align-items:center;gap:12px;font-weight:700;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.35);direction:rtl;font-family:inherit;';
        bar.innerHTML = `
            <svg viewBox="0 0 24 24" style="width:22px;height:22px;flex-shrink:0;fill:currentColor"><path d="M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6c0 1.36-.46 2.6-1.22 3.6l1.44 1.44A7.95 7.95 0 0 0 20 12a8 8 0 0 0-8-8zm0 14a6 6 0 0 1-6-6c0-1.36.46-2.6 1.22-3.6L5.78 6.96A7.95 7.95 0 0 0 4 12a8 8 0 0 0 8 8v3l4-4-4-4v3z"/></svg>
            <span style="flex:1">🎉 تحديث جديد متوفر — اضغط للتحديث الآن</span>
            <button id="pwaUpdateNow" style="background:#0a0d13;color:#ecc964;border:none;padding:8px 18px;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;">تحديث</button>
            <button id="pwaUpdateLater" style="background:transparent;color:#0a0d13;border:none;padding:8px;font-size:18px;cursor:pointer;font-family:inherit;" aria-label="لاحقًا">✕</button>
        `;
        document.body.appendChild(bar);
        document.getElementById('pwaUpdateNow').addEventListener('click', () => {
            bar.remove();
            onConfirm();
        });
        document.getElementById('pwaUpdateLater').addEventListener('click', () => {
            bar.style.transition = 'transform .3s, opacity .3s';
            bar.style.transform = 'translateY(-100%)';
            bar.style.opacity = '0';
            setTimeout(() => bar.remove(), 300);
        });
    }
})();
