/* pwa.js: installable web app behaviour.
 *
 * Registers the service worker that caches the static app shell (never record
 * data) and exposes an install prompt for the browser.
 */
(function () {
  'use strict';

  var deferred = null;

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;   /* no SW on file:// */
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function (err) {
        if (window.console) console.warn('[pwa] service worker registration failed:', err);
      });
    });
  }

  /* Beforeinstallprompt is not in every browser, so it is optional. */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    document.documentElement.classList.add('pwa-installable');
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    document.documentElement.classList.remove('pwa-installable');
  });

  window.PWA = {
    canInstall: function () { return !!deferred; },
    promptInstall: function () {
      if (!deferred) return Promise.resolve(false);
      var p = deferred.prompt();
      deferred = null;
      return p.then(function (r) {
        window.PWA.outcome = r && r.outcome;
        return r && r.outcome === 'accepted';
      });
    },
    outcome: null
  };

  registerSW();
})();
