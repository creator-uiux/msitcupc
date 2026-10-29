/* api.js  --  live-backend adapter for the ITC Maintenance System front end.
 *
 * When a page is served by server/app.py the backend injects window.ITC_API,
 * so the site is live against the backend at http://127.0.0.1:8787/.  When the
 * flag is absent (a plain web server) the adapter stays dormant and the bundled
 * seed dataset drives the screens.
 *
 * When enabled it turns the no-build front end into a real client of the
 * Python/SQLite backend without changing a single page:
 *   • on load it authenticates the current role and pulls the server dataset;
 *   • Flow.* and Maint.* actions are dispatched to POST /api/call, so every
 *     workflow guard and RBAC rule is enforced *server-side*;
 *   • direct Store.update(...) edits (sign-in, bell read, etc.) are pushed
 *     as a snapshot to POST /api/state;
 *   • Server-Sent Events keep open tabs in sync.
 *
 * Without api mode nothing here runs: the page stays a pure local demo.
 */
(function () {
  'use strict';

  var ON = window.ITC_API === true;  /* the backend injects this bootstrap flag */
  if (!ON) return;

  var BASE = window.ITC_API_BASE || '';   /* same origin as the served page */
  var token = null;
  var role = null;
  var scoped = null;      /* office name when the server scopes the dataset (requester tenancy) */
  var live = null;
  var SESSION_KEY = 'itc_session';

  window.ApiMode = true;

  /* ------------------------------------------------------------------ http */
  function xhr(method, path, body) {
    var x = new XMLHttpRequest();
    try {
      x.open(method, BASE + path, false); /* sync: the UI is synchronous by design */
    } catch (e) {
      return { status: 0, data: null };
    }
    if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    if (body !== undefined && body !== null) x.setRequestHeader('Content-Type', 'application/json');
    try {
      x.send(body !== undefined && body !== null ? JSON.stringify(body) : null);
    } catch (e) {
      return { status: 0, data: null };
    }
    var data = null;
    try { data = JSON.parse(x.responseText); } catch (e) { data = null; }
    return { status: x.status, data: data };
  }

  /* ------------------------------------------------------- session storage */
  function storedSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function saveSession(res) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: res.token, user: res.user })); }
    catch (e) { /* private mode: fall back to a per-page login */ }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    /* Sign out must leave no private data behind: drop the cached app shell
       and ask the service worker to empty every cache it holds. */
    try { localStorage.removeItem('itc_db_v3'); } catch (e) { /* ignore */ }
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'ITC_CLEAR_PRIVATE_DATA' });
      } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          if (reg.active) reg.active.postMessage({ type: 'ITC_CLEAR_PRIVATE_DATA' });
        }).catch(function () { });
      }
    } catch (e) { /* ignore */ }
  }

  function applyAuth(res, fallbackRole) {
    token = res.token;
    role = (res.user && res.user.role) || fallbackRole || 'requester';
    if (res.state) scoped = res.state.scope || null;
    saveSession(res);
  }

  /* Role shorthand used by the no-build prototype. */
  function login(nextRole) {
    var r = xhr('POST', '/api/login', { role: nextRole });
    if (r.status === 200 && r.data && r.data.token) {
      applyAuth(r.data, nextRole);
      return true;
    }
    return false;
  }

  /* Real Google Workspace sign-in: Google Identity Services hands us an id_token. */
  function loginWithCredential(credential) {
    var r = xhr('POST', '/api/login', { credential: credential });
    if (r.status === 200 && r.data && r.data.token) {
      applyAuth(r.data, 'requester');
      if (r.data.state) window.Store.adopt(r.data.state);
      startLive();
      return true;
    }
    return (r.data && r.data.msg) || ('Google sign-in failed (HTTP ' + r.status + ').');
  }

  function useStoredSession() {
    var s = storedSession();
    if (!s || !s.token) return false;
    token = s.token;
    role = (s.user && s.user.role) || null;
    return !!role;
  }

  function pull() {
    var r = xhr('GET', '/api/state');
    if (r.status === 200 && r.data) {
      scoped = r.data.scope || null;
      window.Store.adopt(r.data);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ sync */
  function push(db) {
    if (db.role && db.role !== role) {
      /* the role changed: re-authenticate and let the server stay authoritative */
      clearSession();
      if (login(db.role)) pull();
      return;
    }
    if (role === 'requester') return;  /* a scoped dataset must never overwrite the server */
    xhr('POST', '/api/state', { state: sanitize(db) });
  }

  /* Never send client-only keys the server shouldn't store verbatim. */
  function sanitize(db) {
    var copy = {};
    for (var k in db) {
      if (k === 'user') continue;
      copy[k] = db[k];
    }
    return copy;
  }

  window.__itcPersistHook = push;

  /* ------------------------------------------------------ authoritative calls */
  function call(method, args) {
    var r = xhr('POST', '/api/call', { method: method, args: args });
    if (r.status === 401 && login(role || 'coordinator')) {
      r = xhr('POST', '/api/call', { method: method, args: args });
    }
    if (r.status !== 200 || !r.data) return { ok: false, msg: 'Backend unavailable.' };
    if (r.data.state) window.Store.adopt(r.data.state);
    /* Return the whole payload so callers can use comment/office/person/count. */
    return r.data;
  }

  /* ----------------------------- data & attachment helpers ----------------------------- */
  function qs(params) {
    var parts = [];
    for (var k in (params || {})) {
      if (params[k] === undefined || params[k] === null || params[k] === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    return parts.length ? ('?' + parts.join('&')) : '';
  }

  /* Server-side ticket search / filter / sort / pagination (GET /api/tickets). */
  function tickets(params) {
    var r = xhr('GET', '/api/tickets' + qs(params));
    if (r.status === 401 && login(role || 'coordinator')) r = xhr('GET', '/api/tickets' + qs(params));
    if (r.status !== 200 || !r.data || !r.data.ok) return null;
    return r.data;   /* { ok, rows, total, page, size, pages, counts, office } */
  }

  /* Own profile and password (POST /api/profile). */
  function profile(body) {
    var r = xhr('POST', '/api/profile', body || {});
    if (r.status === 401 && login(role || 'requester')) r = xhr('POST', '/api/profile', body || {});
    return { status: r.status, data: r.data };
  }

  /* Accounts listing (GET /api/users; the server keeps it management-only). */
  function users(params) {
    var r = xhr('GET', '/api/users' + qs(params));
    if (r.status === 401 && login(role || 'management')) r = xhr('GET', '/api/users' + qs(params));
    return { status: r.status, data: r.data };
  }

  /* Upload one file as base64 JSON -> { ok, file:{id,name,mime,size} }. */
  function upload(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read the file.')); };
      fr.onload = function () {
        var b64 = String(fr.result).split(',')[1] || '';
        var body = { name: file.name, mime: file.type || 'application/octet-stream', data: b64 };
        if (opts.ticketId) body.ticketId = opts.ticketId;
        if (opts.jobId) body.jobId = opts.jobId;
        var r = xhr('POST', '/api/upload', body);
        if (r.status === 200 && r.data && r.data.ok) resolve(r.data.file);
        else reject(new Error((r.data && r.data.msg) || ('Upload failed (HTTP ' + r.status + ').')));
      };
      fr.readAsDataURL(file);
    });
  }

  /* Authenticated download URL for an attachment (never a public path).
     The server also takes the token in the query string, and that is what
     lets an <img> or a <video> read the bytes: a media element cannot
     carry an Authorization header. */
  function attachmentURL(id, download) {
    var url = BASE + '/api/attachment?id=' + encodeURIComponent(id) + (download ? '&download=1' : '');
    if (token) url += '&token=' + encodeURIComponent(token);
    return url;
  }

  /* Predicates read Store.db and answer immediately; they must stay local.
     Proxying one turns every render-time call into a blocking round trip. */
  var LOCAL_ONLY = { Flow: ['canTransition'] };

  function installProxies() {
    ['Flow', 'Maint', 'Admin'].forEach(function (ns) {
      var real = window[ns];
      if (!real) return;
      var keep = LOCAL_ONLY[ns] || [];
      var proxy = {};
      Object.keys(real).forEach(function (name) {
        if (keep.indexOf(name) !== -1) { proxy[name] = real[name]; return; }
        proxy[name] = function () {
          return call(name, Array.prototype.slice.call(arguments));
        };
      });
      window[ns] = proxy;
    });
  }

  /* --------------------------------------------------------------- realtime */
  function startLive() {
    if (live || !window.EventSource || !token) return;
    try {
      live = new EventSource(BASE + '/api/events?token=' + encodeURIComponent(token));
      live.onmessage = function () { pull(); };
      live.onerror = function () { /* EventSource retries automatically */ };
    } catch (e) { /* no SSE: polling still works via explicit actions */ }
  }

  /* -------------------------------------------------------------- bootstrap */
  var initialRole = (window.Store && window.Store.db && window.Store.db.role) || 'coordinator';
  var m = /[?&]role=(requester|coordinator|technician|management)/.exec(location.search);
  if (m) initialRole = m[1];

  var ready = useStoredSession() && pull();
  if (!ready) {
    clearSession();
    ready = login(initialRole) && pull();
  }
  if (!ready) {
    /* Server unreachable  --  degrade gracefully to the pure local prototype. */
    window.ApiMode = false;
    window.__itcPersistHook = null;
    if (window.console) console.warn('[api] backend unavailable; running in local demo mode.');
    return;
  }

  installProxies();
  window.Api = {
    call: call,
    pull: pull,
    push: push,
    startLive: startLive,
    login: login,
    loginWithCredential: loginWithCredential,
    logout: clearSession,
    tickets: tickets,
    profile: profile,
    users: users,
    upload: upload,
    attachmentURL: attachmentURL,
    get role() { return role; },
    get scope() { return scoped; }
  };

  /* If a role is pinned by the URL, reflect it before the page renders. */
  if (m && window.Store.db.role !== initialRole) {
    window.Store.update(function (db) { db.role = initialRole; });
  }
})();
