
(function setupPWAUpdates() {
  if (!('serviceWorker' in navigator)) return;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let _reloadAfterUpdate = false;
  let _initialController = navigator.serviceWorker.controller;

  navigator.serviceWorker.register('./sw.js', {
    scope: './',
    updateViaCache: 'none'
  })
  .then((reg) => {
    const showBannerIfWaiting = () => {
      if (!navigator.onLine) return;
      if (!reg.waiting) return;

      if (isStandalone) {
        // ⭐ مثبّت: اعرض بانر التحديث (لأنه مش بياخد التحديث لوحده)
        showUpdateBanner(() => {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        });
      } else {
        // ⭐ مستخدم متصفح: حدّث تلقائي بدون بانر
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    };

    const trackInstalling = (worker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') setTimeout(showBannerIfWaiting, 100);
      });
    };

    reg.update().catch(() => {});
    showBannerIfWaiting();

    reg.addEventListener('updatefound', () => {
      if (reg.installing) trackInstalling(reg.installing);
    });

    // ⭐ لو رجع النت، نتحقق تاني
    window.addEventListener('online', () => setTimeout(showBannerIfWaiting, 1000));
  })
  .catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // ⭐ أول SW — مفيش reload
    if (!_initialController) {
      _initialController = navigator.serviceWorker.controller;
      return;
    }
    if (_reloadAfterUpdate) return;
    _reloadAfterUpdate = true;
    window.location.reload();
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
    document.getElementById('pwaUpdateNow').addEventListener('click', () => { bar.remove(); onConfirm(); });
    document.getElementById('pwaUpdateLater').addEventListener('click', () => {
      // ⭐ مفيش تسجيل "dismissed" — البانر يرجع تاني عند أول زيارة جاية
      bar.style.transition = 'transform .3s, opacity .3s';
      bar.style.transform = 'translateY(-100%)';
      bar.style.opacity = '0';
      setTimeout(() => bar.remove(), 300);
    });
  }
})();

/* ═══ بانر التثبيت ═══ */
(function setupInstallPrompt() {
  let deferredPrompt = null;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // ⭐ مثبّت → مفيش بانر خالص
  if (isStandalone) return;

  // ⭐ مفيش فحص "dismissed" ولا "visits" — البانر يظهر كل زيارة

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (navigator.onLine) setTimeout(showInstallBanner, 3000);
  });

  // ⭐ iOS: عرض التعليمات كل زيارة (لو أونلاين)
  if (isIOS) {
    if (navigator.onLine) setTimeout(showInstallBanner, 4000);
  }

  window.addEventListener('online', () => {
    if (isStandalone) return;
    if (document.getElementById('pwaInstallBanner')) return;
    if (deferredPrompt || isIOS) setTimeout(showInstallBanner, 2000);
  });

  // ⭐ قطع النت أثناء العرض → اخفي البانر فورًا
  window.addEventListener('offline', () => {
    const b = document.getElementById('pwaInstallBanner');
    if (b) b.remove();
  });

  function showInstallBanner() {
    if (document.getElementById('pwaInstallBanner')) return;
    if (!navigator.onLine) return;
    if (isStandalone) return;

    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.style.cssText = `position:fixed;bottom:0;left:0;right:0;z-index:99998;background:linear-gradient(135deg,#141a24,#1a212c);border-top:1px solid rgba(212,175,55,0.4);padding:16px;display:flex;align-items:center;gap:12px;font-family:inherit;color:#ece8e0;box-shadow:0 -8px 30px rgba(0,0,0,0.6);animation:pwaSlideUp 0.4s cubic-bezier(0.4,0,0.2,1);direction:rtl;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));`;

    const iconHTML = `<svg viewBox="0 0 24 24" style="width:36px;height:36px;flex-shrink:0;color:#d4af37;fill:currentColor"><path d="M12 2l1.9 5.8H20l-4.9 3.6 1.9 5.9L12 13.7l-5 3.6 1.9-5.9L4 7.8h6.1L12 2z"/></svg>`;
    const messageHTML = isIOS
      ? `<div style="flex:1;font-size:13px;line-height:1.5"><div style="font-weight:800;color:#ecc964;margin-bottom:4px">📱 ثبّت التطبيق على هاتفك</div><div style="opacity:.85">اضغط <b style="color:#d4af37">المشاركة ⬆️</b> ثم <b style="color:#d4af37">"إضافة إلى الشاشة الرئيسية"</b></div></div>`
      : `<div style="flex:1;font-size:13px;line-height:1.5"><div style="font-weight:800;color:#ecc964;margin-bottom:4px">📱 ثبّت التطبيق على هاتفك</div><div style="opacity:.85">يعمل بدون إنترنت • أسرع • بأيقونة على الشاشة الرئيسية</div></div>`;
    const buttonHTML = isIOS ? '' : `<button id="pwaInstallNow" style="background:linear-gradient(135deg,#d4af37,#ecc964);color:#0a0d13;border:none;padding:10px 20px;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(212,175,55,0.4);white-space:nowrap;">تثبيت</button>`;

    banner.innerHTML = `${iconHTML}${messageHTML}${buttonHTML}<button id="pwaInstallClose" style="background:transparent;color:#a49e93;border:none;padding:6px;font-size:22px;cursor:pointer;font-family:inherit;line-height:1;" aria-label="إغلاق">✕</button>`;

    if (!document.getElementById('pwaSlideUpStyle')) {
      const style = document.createElement('style');
      style.id = 'pwaSlideUpStyle';
      style.textContent = `@keyframes pwaSlideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
      document.head.appendChild(style);
    }
    document.body.appendChild(banner);

    const installBtn = document.getElementById('pwaInstallNow');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        banner.remove();
        try {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
        } catch(_) {}
        deferredPrompt = null;
      });
    }

    document.getElementById('pwaInstallClose').addEventListener('click', () => {
      // ⭐ مفيش تسجيل "dismissed" — البانر يرجع تاني عند أول زيارة جاية
      banner.style.transition = 'transform .3s, opacity .3s';
      banner.style.transform = 'translateY(100%)';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 300);
    });
  }

  window.addEventListener('appinstalled', () => {
    const banner = document.getElementById('pwaInstallBanner');
    if (banner) banner.remove();
  });
})();