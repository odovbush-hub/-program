/* =========================================================
   EduSpace — PWA: офлайн-робота та встановлення застосунку
   ========================================================= */

(function () {
  // Service Worker працює лише через http(s) — наприклад, Live Server або хостинг
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('Service Worker не зареєстровано:', err);
      });
    });
  }

  let deferredPrompt = null;
  const btn = document.getElementById('install-btn');

  // Браузер повідомляє, що застосунок можна встановити
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.hidden = false;
  });

  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.hidden = true;
    });
  }

  window.addEventListener('appinstalled', () => {
    if (btn) btn.hidden = true;
    toast('EduSpace встановлено! Шукайте іконку на робочому столі.', 'success');
  });
})();
