/* sw.js -- offline app shell for the installable PWA.
 *
 * Rules from the specification:
 *   - cache ONLY the static app shell and assets
 *   - never cache protected data in a shared cache
 *   - serve an offline fallback page when the network is unavailable
 *
 * So: the shell (HTML, CSS, JS, icons) is precached and served cache first.
 * Anything that carries record data (the API, the state endpoint, the event
 * stream, uploads) is never cached and always goes to the network.
 */
'use strict';

var VERSION = 'itc-shell-v9';
var SHELL_CACHE = VERSION + '-shell';

/* The app shell.  Role-prefixed pages are generated from these, so they are
   reachable through the navigation rather than precached one by one. */
var SHELL = [
  './',
  'index.html',
  'login.html',
  '404.html',
  'offline.html',
  'dashboard.html',
  'tickets.html',
  'ticket.html',
  'request.html',
  'review.html',
  'confirm.html',
  'maintenance.html',
  'register.html',
  'reports.html',
  'flow.html',
  'roles.html',
  'notifications.html',
  'profile.html',
  'users.html',
  'offices.html',
  'settings.html',
  'audit.html',
  'css/app.css',
  'css/green.css',
  'css/kit.css',
  'js/store.js',
  'js/features.js',
  'js/permissions.js',
  'js/flow.js',
  'js/actions.js',
  'js/api.js',
  'js/ui.js',
  'js/live.js',
  'js/query.js',
  'js/flowdata.js',
  'permissions.json',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

/* Paths that must never be cached: they carry record data. */
var NEVER_CACHE = [
  '/api/',
  '/api/state',
  '/api/tickets',
  '/api/call',
  '/api/events',
  '/api/upload',
  '/api/export',
  '/api/reports',
  '/api/notifications',
  '/api/attachment',
  '/api/users',
  '/api/profile',
  '/api/health',
  '/api/login',
  '/api/logout',
  '/api/tick',
  '/api/import',
  '/api/reset'
];

function isProtected(url) {
  var path = url.pathname;
  for (var i = 0; i < NEVER_CACHE.length; i++) {
    if (path.indexOf(NEVER_CACHE[i]) === 0) return true;
  }
  return false;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll fails the whole install if one file is missing, so each file
      // is added on its own and a miss is not fatal.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (isProtected(url)) return;             /* record data: never cached */

  /* Navigations: serve the shell from cache, fall back to the offline page. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('offline.html').then(function (off) {
            return off || new Response(
              '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
              '<p style="font:16px system-ui;padding:24px">You are offline. ' +
              'Reconnect to continue.</p>', { headers: { 'Content-Type': 'text/html' } });
          });
        });
      })
    );
    return;
  }

  /* Static assets: cache first, then network, then keep what we have. */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});

/* Sign out: drop every cached artefact so no private data survives. */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'ITC_CLEAR_PRIVATE_DATA') {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
    );
  }
});
