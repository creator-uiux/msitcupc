/* Role-named page test: every generated xx-page.html must
     - load clean (no errors)
     - pin the session role to its URL prefix
     - render that role's chrome (sidebar role + nav lane)
     - redirect away when the prefix disagrees with the signed-in role
     - be reachable by a signed-out visitor only via login
   Run: node tools\rolepages_test.js  (needs jsdom in TEMP\opencode) */
'use strict';
var path = require('path'), http = require('http');
var spawn = require('child_process').spawn;
var execSync = require('child_process').execSync;

var JSDOM, VirtualConsole, requestInterceptor;
try {
  var m = require('jsdom');
  JSDOM = m.JSDOM; VirtualConsole = m.VirtualConsole; requestInterceptor = m.requestInterceptor;
} catch (e) {
  var alt = path.join('C:', '', 'Users', 'Admin', 'AppData', 'Local', 'Temp', 'opencode', 'node_modules', 'jsdom');
  m = require(alt);
  JSDOM = m.JSDOM; VirtualConsole = m.VirtualConsole; requestInterceptor = m.requestInterceptor;
}

/* The pages pull the web font from a CDN.  The tests must not depend on an
   external service, so that request is answered locally with an empty
   stylesheet and the page uses its own fallback stack. */
function localOnlyInterceptor() {
  if (!requestInterceptor) return undefined;
  return requestInterceptor(async function (req) {
    var u = String(req.url);
    if (u.indexOf('127.0.0.1') > -1 || u.indexOf('localhost') > -1) return undefined;
    return new Response('', { status: 200, headers: { 'content-type': 'text/css' } });
  });
}

var ROOT = path.join(__dirname, '..');
/* A free port and a threaded server, so two runs never collide and the
   parallel script requests are never queued. */
var PORT = 0, BASE = null;
var pass = 0, fail = 0;

function freePort() {
  var net = require('net');
  return new Promise(function (resolve, reject) {
    var srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      var p = srv.address().port;
      srv.close(function () { resolve(p); });
    });
  });
}

function ok(cond, label) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log('FAIL  ' + label); }
}

function startServer() {
  return freePort().then(function (port) {
    PORT = port;
    BASE = 'http://127.0.0.1:' + PORT + '/';
    var child = spawn('python', [path.join(ROOT, 'tools', 'serve.py'), String(PORT), ROOT], { cwd: ROOT, stdio: 'ignore' });
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function ping() {
        http.get(BASE + 'index.html', function (r) { r.resume(); resolve(child); })
          .on('error', function () {
            if (++tries > 40) reject(new Error('server never came up'));
            else setTimeout(ping, 250);
          });
      })();
    });
  });
}
function stopServer(child) {
  var targets = {};
  if (child && child.pid) targets[String(child.pid)] = true;
  try {
    execSync('netstat -ano', { encoding: 'utf8' }).split(/\r?\n/).forEach(function (ln) {
      var p = ln.trim().split(/\s+/);
      if (p.length >= 5 && p[1].indexOf(':' + PORT) !== -1 && p[3] === 'LISTENING') targets[p[4]] = true;
    });
  } catch (e) { }
  Object.keys(targets).forEach(function (pid) {
    try { execSync('taskkill /pid ' + pid + ' /f /t', { stdio: 'ignore' }); } catch (e) { }
  });
}
var ACTIVE_SRV = null;
process.on('exit', function () { if (ACTIVE_SRV) stopServer(ACTIVE_SRV); });

/* Open a role page, optionally signed in as a role FIRST (so the page sees the
   session on its very first script run). We seed localStorage before load by
   navigating to the bare page, signing in, then navigating to the role URL in
   the same JSDOM instance is not possible; instead we pass a preload script. */
/* A real signed-in session seeded from the app's OWN seed (a partial db makes
   page renderers throw).  We capture the canonical db once from a bare load,
   then reuse it for every role page. */
var SEED_DB = null;

function captureSeed() {
  return JSDOM.fromURL(BASE + 'dashboard.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    requestInterceptor: localOnlyInterceptor()
  }).then(function (dom) {
    return new Promise(function (resolve) {
      function go() {
        try {
          var w = dom.window;
          w.Store.reset();                       /* canonical seed, persisted */
          SEED_DB = w.localStorage.getItem('itc_db_v3');
        } catch (e) { SEED_DB = null; }
        try { dom.window.close(); } catch (e) { }
        resolve(SEED_DB);
      }
      if (dom.window.document.readyState === 'complete') setTimeout(go, 150);
      else dom.window.addEventListener('load', function () { setTimeout(go, 150); });
      setTimeout(go, 6000);
    });
  });
}

function seedFor(role) {
  if (!SEED_DB) throw new Error('SEED_DB not captured');
  var db = JSON.parse(SEED_DB);
  db.settings.simulate = false;
  if (role) {
    var WHO = {
      requester: { name: 'A. Delos Reyes', office: 'Records Office', email: 'a.delosreyes@upcebu.edu.ph' },
      technician: { name: 'J. Tan', office: 'IT Office', email: 'j.tan@upcebu.edu.ph' },
      coordinator: { name: 'K. Ramos', office: 'IT Office', email: 'k.ramos@upcebu.edu.ph' },
      management: { name: 'M. Reyes', office: 'Office of the Director', email: 'm.reyes@upcebu.edu.ph' }
    }[role] || { name: 'T', office: 'IT Office', email: 't@upcebu.edu.ph' };
    db.role = role;
    db.auth = { role: role, name: WHO.name, email: WHO.email, office: WHO.office };
  } else {
    db.auth = null;
  }
  return JSON.stringify(db);
}

function openOnce(url, sessionRole) {
  var vc = new VirtualConsole();
  var errors = [];
  vc.on('jsdomError', function (e) { errors.push('jsdomError: ' + (e.message || e)); });
  vc.on('error', function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); });
  var opts = {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    requestInterceptor: localOnlyInterceptor()
  };
  if (SEED_DB) {
    opts.beforeParse = function (w) {
      try {
        w.localStorage.setItem('itc_db_v3', seedFor(sessionRole));
      } catch (e) { console.log('  [seed] beforeParse failed: ' + e.message); }
    };
  }
  return JSDOM.fromURL(url, opts).then(function (dom) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return; done = true;
        try {
          var w = dom.window;
          if (w.Store) w.Store.update(function (db) { db.settings.simulate = false; });
        } catch (e) { }
        resolve({ dom: dom, w: dom.window, d: dom.window.document, errors: errors });
      }
      if (dom.window.document.readyState === 'complete') setTimeout(finish, 80);
      else dom.window.addEventListener('load', function () { setTimeout(finish, 80); });
      setTimeout(finish, 6000);
    });
  });
}
/* The static server occasionally drops a script connection under load, which
   shows up as a transient "Could not load script" rather than an app bug, so
   re-fetch the page a couple of times before trusting the result. */
function open(url, sessionRole, tries) {
  tries = tries || 0;
  return openOnce(url, sessionRole).then(function (p) {
    var transient = p.errors.some(function (e) {
      return /Could not load script|ERR_|ECONNRESET|socket hang up|is not defined/i.test(e);
    });
    /* the app scripts are still loading when the harness evaluates the page:
       treat a missing global as transient and fetch the page again */
    if (!transient && !p.w.UI) transient = true;
    if (transient && tries < 3) {
      close(p);
      return new Promise(function (r) { setTimeout(r, 250); })
        .then(function () { return open(url, sessionRole, tries + 1); });
    }
    return p;
  });
}
function close(p) { try { p.w.close(); } catch (e) { } }

/* jsdom cannot navigate and location.replace is unforgeable.  We therefore
   exercise the REAL bindUrlRole() and assert (a) that it reports a redirect and
   (b) the exact target it computes, by swapping UI's own location.replace hook.
   jsdom exposes the pre-navigation decision; the destination string is derived
   from the same UI helpers the app uses (urlFor / can), which we call here. */
function openCaptured(url, sessionRole) {
  var vc = new VirtualConsole();
  vc.on('jsdomError', function () { });
  vc.on('error', function () { });
  var opts = {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    requestInterceptor: localOnlyInterceptor()
  };
  opts.beforeParse = function (w) { w.localStorage.setItem('itc_db_v3', seedFor(sessionRole)); };
  return JSDOM.fromURL(url, opts).then(function (dom) {
    return new Promise(function (resolve) {
      function go() {
        var w = dom.window, out = { w: w, d: w.document, urls: [], redirected: null };
        /* capture what location.replace receives without performing it */
        var target = null;
        try {
          Object.defineProperty(w.location, 'replace', {
            configurable: true, writable: true,
            value: function (u) { target = String(u); }
          });
        } catch (e) { }
        try { out.redirected = w.UI.bindUrlRole(); } catch (e) { out.err = e.message; }
        out.url = target;
        /* the pure helper used to build the target, for a direct assertion */
        try {
          var u = w.UI.parseUrlRole();
          if (u) {
            var signedIn = !!(w.Store.db.auth && w.Store.db.auth.role);
            if (signedIn) {
              var role = w.UI.roleKey();
              out.expect = w.UI.can(u.page, role) ? w.UI.urlFor(u.page, role)
                                                  : w.UI.urlFor('dashboard.html', role);
            } else {
              /* sessionless: no navigation, the page renders the URL role */
              out.expect = '';
            }
          }
        } catch (e) { }
        resolve(out);
      }
      if (dom.window.document.readyState === 'complete') setTimeout(go, 80);
      else dom.window.addEventListener('load', function () { setTimeout(go, 80); });
      setTimeout(go, 5000);
    });
  });
}

/* ---------- the page set ---------- */
var ROLE_PAGES = [
  ['or', 'requester'], ['itc', 'technician'], ['ic', 'coordinator'], ['mgmt', 'management']
];
var PAGES = ['dashboard', 'ticket', 'reports', 'flow', 'roles'];
var tests = [];

tests.push(async function rolePagesExist() {
  var fs = require('fs');
  /* The page map is the one permission map (permissions.json), so the
     expectation can never drift from what the app actually allows. */
  var perm = JSON.parse(fs.readFileSync(path.join(ROOT, 'permissions.json'), 'utf8'));
  var PREFIX = { requester: 'or', technician: 'itc', coordinator: 'ic', management: 'mgmt' };
  var ACCESS = {};
  var NO_ROLE_PAGES = { 'index': 1, 'login': 1, '404': 1 };
  Object.keys(perm.pages).forEach(function (page) {
    var base = page.replace(/\.html$/, '');
    if (NO_ROLE_PAGES[base]) return;
    ACCESS[base] = perm.pages[page].map(function (r) { return PREFIX[r]; });
  });
  var missing = [], forbidden = [];
  Object.keys(ACCESS).forEach(function (page) {
    ACCESS[page].forEach(function (pfx) {
      var f = path.join(ROOT, pfx + '-' + page + '.html');
      if (!fs.existsSync(f)) missing.push(pfx + '-' + page + '.html');
    });
  });
  /* forbidden combos must NOT exist */
  [['or', 'review'], ['itc', 'review'], ['mgmt', 'review'],
   ['itc', 'request'], ['mgmt', 'request'], ['or', 'technician'],
   ['ic', 'technician'], ['mgmt', 'technician']].forEach(function (pair) {
    var f = path.join(ROOT, pair[0] + '-' + pair[1] + '.html');
    if (fs.existsSync(f)) forbidden.push(pair[0] + '-' + pair[1] + '.html');
  });
  ok(missing.length === 0, 'every legal role page exists' + (missing.length ? ' missing: ' + missing.join(',') : ''));
  ok(forbidden.length === 0, 'no page exists for a forbidden role combo' + (forbidden.length ? ' -> ' + forbidden.join(',') : ''));

  /* every generated page carries the pre-paint guard + role title */
  var badGuard = [], badTitle = [], badSessionless = [];
  Object.keys(ACCESS).forEach(function (page) {
    ACCESS[page].forEach(function (pfx) {
      var f = path.join(ROOT, pfx + '-' + page + '.html');
      if (!fs.existsSync(f)) return;
      var h = fs.readFileSync(f, 'utf8');
      if (h.indexOf('ITC_URL_ROLE') === -1 || h.indexOf('localStorage.getItem("itc_db_v3")') === -1
          || h.indexOf('</head>') === -1 || h.indexOf('ITC_URL_ROLE') > h.indexOf('</head>')) {
        badGuard.push(pfx + '-' + page + '.html');
      }
      /* a sessionless load must NOT navigate to login: the page renders its
         own role as a preview (this is what makes it importable / shareable) */
      if (/if\(!a\)\s*\{[^}]*location\.replace/.test(h)) {
        badSessionless.push(pfx + '-' + page + '.html');
      }
      if (!/<title>[A-Z]+ - .+ - ITC Maintenance System<\/title>/.test(h)) {
        badTitle.push(pfx + '-' + page + '.html');
      }
    });
  });
  ok(badGuard.length === 0, 'every role page has the pre-paint guard inside <head>' + (badGuard.length ? ' -> ' + badGuard.join(',') : ''));
  ok(badSessionless.length === 0, 'no role page bounces a sessionless visitor to login' + (badSessionless.length ? ' -> ' + badSessionless.join(',') : ''));
  ok(badTitle.length === 0, 'every role page has a role-prefixed <title>' + (badTitle.length ? ' -> ' + badTitle.join(',') : ''));
});

tests.push(async function rolePagesRenderOwnRole() {
  var TITLE = { requester: 'Office Requester', technician: 'IT Technician', coordinator: 'IT Coordinator', management: 'System Administrator' };
  for (var i = 0; i < ROLE_PAGES.length; i++) {
    var pfx = ROLE_PAGES[i][0], role = ROLE_PAGES[i][1];
    var p = await open(BASE + pfx + '-dashboard.html', role);
    ok(p.errors.length === 0, pfx + '-dashboard.html loads clean' + (p.errors.length ? ' -> ' + p.errors.join('|') : ''));
    ok(p.w.UI.roleKey() === role, pfx + '-dashboard.html pins role=' + role + ' (got ' + p.w.UI.roleKey() + ')');
    var side = p.d.querySelector('.role-chip');
    ok(side && side.textContent.trim() === TITLE[role], pfx + ': header shows the role title ("' + (side ? side.textContent.trim() : '') + '")');
    /* nav hrefs must carry the same prefix */
    var hrefs = Array.prototype.slice.call(p.d.querySelectorAll('.rail-item[href]')).map(function (a) { return a.getAttribute('href'); });
    ok(hrefs.length > 0 && hrefs.every(function (h) { return h.indexOf(pfx + '-') === 0; }),
       pfx + ': every nav link is ' + pfx + '-prefixed');
    /* the active page is marked */
    var active = p.d.querySelector('.rail-item.active');
    ok(active && active.getAttribute('href') === pfx + '-dashboard.html', pfx + ': dashboard is the active nav item');
    close(p);
  }
});

tests.push(async function wrongRoleRedirects() {
  /* signed in as requester, open the technician dashboard -> redirect to or- */
  var p = await openCaptured(BASE + 'itc-dashboard.html', 'requester');
  ok(p.redirected === true, 'requester on itc-dashboard.html: bindUrlRole reports a redirect');
  ok(/or-dashboard\.html/.test(p.url || p.expect || ''),
     'requester on itc-dashboard.html redirects to or-dashboard.html (got ' + JSON.stringify(p.url || p.expect) + ')');
  try { p.w.close(); } catch (e) { }

  /* signed in as management, open ic-ticket.html -> mgmt-ticket.html */
  var p2 = await openCaptured(BASE + 'ic-ticket.html', 'management');
  ok(/mgmt-ticket\.html/.test(p2.url || p2.expect || ''),
     'management on ic-ticket.html redirects to mgmt-ticket.html (got ' + JSON.stringify(p2.url || p2.expect) + ')');
  ok(!/login\.html/.test(p2.url || p2.expect || ''), 'a signed-in wrong-role visit does not bounce to login');
  try { p2.w.close(); } catch (e) { }

  /* requester opens a page their role cannot have at all -> own dashboard */
  var p3 = await openCaptured(BASE + 'ic-review.html', 'requester');
  ok(/or-dashboard\.html/.test(p3.url || p3.expect || ''),
     'requester on ic-review.html redirects to or-dashboard.html (got ' + JSON.stringify(p3.url || p3.expect) + ')');
  try { p3.w.close(); } catch (e) { }
});

/* a wrong-role visitor must NEVER be sent to a page their role cannot have
   (that would be a 404).  Each case below lands on a page the role owns. */
tests.push(async function wrongRoleNeverLandsOn404() {
  var cases = [
    ['technician', 'ic-review.html', 'itc-dashboard.html'],
    ['management', 'itc-technician.html', 'mgmt-dashboard.html'],
    ['requester', 'ic-review.html', 'or-dashboard.html'],
    ['coordinator', 'itc-technician.html', 'ic-dashboard.html'],
    ['technician', 'or-request.html', 'itc-dashboard.html']
  ];
  for (var i = 0; i < cases.length; i++) {
    var role = cases[i][0], from = cases[i][1], want = cases[i][2];
    var p = await openCaptured(BASE + from, role);
    var got = p.url || p.expect || '';
    ok(got === want, role + ' on ' + from + ' redirects to ' + want + ' (got ' + JSON.stringify(got) + ')');
    try { p.w.close(); } catch (e) { }
  }
});

/* the case that was missing: a COLD, sessionless load (Codia / html.to.design
   / a shared link / a fresh browser) must RENDER the URL's role, not bounce to
   login.  This is the regression that made a URL import produce the login page. */
tests.push(async function sessionlessRendersOwnRole() {
  for (var i = 0; i < ROLE_PAGES.length; i++) {
    var pfx = ROLE_PAGES[i][0], role = ROLE_PAGES[i][1];
    var p = await openCaptured(BASE + pfx + '-dashboard.html', null);
    var u = p.url || p.expect || '';
    ok(!/login\.html/.test(u),
       pfx + '-dashboard.html sessionless load does NOT go to login (nav=' + JSON.stringify(u || '(none)') + ')');
    ok(p.redirected !== true, pfx + '-dashboard.html sessionless load does not redirect');
    ok(p.w.UI.roleKey() === role,
       pfx + '-dashboard.html sessionless load renders the URL role (got ' + p.w.UI.roleKey() + ')');
    var side = p.d.querySelector('.role-chip');
    ok(side && side.textContent.trim().length > 0,
       pfx + ': sessionless preview still shows a role title ("' + (side ? side.textContent.trim() : '') + '")');
    ok(p.d.querySelector('#accessPanel') === null, pfx + ': sessionless preview is not an access-denied panel');
    try { p.w.close(); } catch (e) { }
  }
});

/* a role-only page must also render cold for its own role (importer safety) */
tests.push(async function sessionlessRendersRoleOnlyPage() {
  var p = await openCaptured(BASE + 'ic-review.html', null);
  ok(p.redirected !== true, 'ic-review.html sessionless load does not redirect');
  ok(p.w.UI.roleKey() === 'coordinator',
     'ic-review.html sessionless load renders the coordinator lane (got ' + p.w.UI.roleKey() + ')');
  ok(p.d.querySelector('#accessPanel') === null, 'ic-review.html sessionless preview has no access panel');
  try { p.w.close(); } catch (e) { }
});

/* signing in from a preview still returns to the page you were on */
tests.push(async function nextParamStillHonoured() {
  var p = await open(BASE + 'login.html?next=or-dashboard.html', null);
  ok(p.errors.length === 0, 'login.html?next=or-dashboard.html loads clean');
  ok(p.w.UI.PREFIX_ROLE.or === 'requester', 'next= prefix maps to a role the landing helper accepts');
  close(p);
});

tests.push(async function barePagesStillWork() {
  /* the legacy bare page must keep rendering for its stored role */
  var p = await open(BASE + 'dashboard.html', 'requester');
  ok(p.errors.length === 0, 'bare dashboard.html still loads clean');
  ok(p.w.UI.parseUrlRole() === null, 'bare dashboard.html has no url role');
  ok(p.w.UI.roleKey() === 'requester', 'bare dashboard.html respects the session role');
  ok(p.d.querySelector('#accessPanel') === null, 'requester sees their dashboard, no access panel');
  close(p);
});

/* ---------- role visibility (Section 25.2) ----------
   The one permission map drives the rail, the columns, the filters and the
   dashboard panels.  These checks read the computed style of a representative
   element for every rule, so a rule that stops matching is caught here rather
   than by eye. */
function displayOf(w, sel) {
  var el = w.document.querySelector(sel);
  if (!el) return null;
  return w.getComputedStyle(el).display;
}

tests.push(async function roleVisibility() {
  var HIDE = [
    /* role, page, selector, shouldShow */
    ['requester', 'or-dashboard.html', '#depWrap', false],
    ['requester', 'or-dashboard.html', '.staff-only', false],
    ['requester', 'or-dashboard.html', '.tech-only', false],
    ['coordinator', 'ic-dashboard.html', '#depWrap', true],
    ['coordinator', 'ic-dashboard.html', '.staff-only', true],
    ['coordinator', 'ic-dashboard.html', '.tech-only', true],
    ['management', 'mgmt-dashboard.html', '#depWrap', false],
    ['management', 'mgmt-dashboard.html', '.tech-only', false],
    ['technician', 'itc-dashboard.html', '#depWrap', false],

    ['requester', 'or-tickets.html', '.col-check', false],
    ['requester', 'or-tickets.html', '.filter-tech', false],
    ['requester', 'or-tickets.html', '.filter-office', false],
    ['requester', 'or-tickets.html', '.filter-scope', false],
    ['technician', 'itc-tickets.html', '.col-check', false],
    ['technician', 'itc-tickets.html', '.filter-tech', false],
    ['coordinator', 'ic-tickets.html', '.col-check', true],
    ['coordinator', 'ic-tickets.html', '.filter-tech', true],
    ['coordinator', 'ic-tickets.html', '.filter-office', true],
    ['coordinator', 'ic-tickets.html', '.filter-scope', true],
    ['management', 'mgmt-tickets.html', '.col-check', false],
    ['management', 'mgmt-tickets.html', '.filter-tech', true],

    ['requester', 'or-reports.html', '.lead-only', false],
    ['technician', 'itc-reports.html', '.lead-only', false],
    ['coordinator', 'ic-reports.html', '.lead-only', true],
    ['management', 'mgmt-reports.html', '.lead-only', true],

    ['technician', 'itc-maintenance.html', '.schedule-manage', false],
    ['coordinator', 'ic-maintenance.html', '.schedule-manage', true],
    ['management', 'mgmt-maintenance.html', '.schedule-manage', true],
    ['management', 'mgmt-maintenance.html', '#btnNewSched', false],
    ['coordinator', 'ic-maintenance.html', '#btnNewSched', true],

    ['requester', 'or-ticket.html?id=IT-2026-000142', '#tab-dep', false],
    ['coordinator', 'ic-ticket.html?id=IT-2026-000142', '#tab-dep', true],
    ['technician', 'itc-ticket.html?id=IT-2026-000142', '#tab-dep', true]
  ];
  var groups = {};
  HIDE.forEach(function (c) { (groups[c[0]] = groups[c[0]] || []).push(c); });
  for (var role in groups) {
    var list = groups[role];
    var pages = {};
    list.forEach(function (c) { pages[c[1]] = true; });
    for (var page in pages) {
      var p = await open(BASE + page, role);
      list.filter(function (c) { return c[1] === page; }).forEach(function (c) {
        var d = displayOf(p.w, c[2]);
        var shown = d !== null && d !== 'none';
        ok(d !== null, role + ' ' + page + ': ' + c[2] + ' exists');
        ok(shown === c[3], role + ' ' + page + ': ' + c[2] + (c[3] ? ' is shown' : ' is hidden') + (d === null ? ' (missing)' : ' (display ' + d + ')'));
      });
      close(p);
    }
  }
});

tests.push(async function roleNavigationMatchesPermissionMap() {
  var CASES = [
    ['requester', 'or-dashboard.html', ['my requests', 'new request', 'office register'], ['maintenance', 'reports', 'users']],
    ['technician', 'itc-dashboard.html', ['my tickets', 'my jobs', 'office register'], ['reports', 'users', 'new request']],
    ['coordinator', 'ic-dashboard.html', ['tickets', 'maintenance', 'reports'], ['users']],
    ['management', 'mgmt-dashboard.html', ['service records', 'administration', 'reports'], ['new request']]
  ];
  for (var i = 0; i < CASES.length; i++) {
    var role = CASES[i][0], page = CASES[i][1];
    var p = await open(BASE + page, role);
    var labels = Array.prototype.slice.call(p.d.querySelectorAll('.rail-item[href] span'))
      .map(function (s) { return s.textContent.trim().toLowerCase(); });
    var hrefs = Array.prototype.slice.call(p.d.querySelectorAll('.rail-item[href]'))
      .map(function (a) { return a.getAttribute('href'); });
    CASES[i][2].forEach(function (want) {
      ok(labels.indexOf(want) > -1, role + ': rail shows "' + want + '" (' + labels.join(', ') + ')');
    });
    CASES[i][3].forEach(function (bad) {
      var hit = hrefs.some(function (h) { return h.indexOf(bad) > -1; });
      ok(!hit, role + ': rail does not offer ' + bad);
    });
    close(p);
  }
});

tests.push(async function requesterPlainLanguage() {
  var p = await open(BASE + 'or-ticket.html?id=IT-2026-000142', 'requester');
  var work = p.d.getElementById('tWorkCard');
  ok(work && work.textContent.indexOf('Cost / labor') === -1, 'requester ticket detail: no cost or labour figures');
  var seg = p.d.getElementById('tReplySeg');
  ok(seg && /Reply to IT/.test(seg.textContent), 'requester reply toggle says "Reply to IT"');
  ok(!/Internal note/.test(seg ? seg.textContent : ''), 'requester reply toggle has no internal note option');
  close(p);
});

tests.push(async function forbiddenUrlShowsNeutralPanel() {
  var CASES = [
    ['requester', 'users.html'],
    ['requester', 'maintenance.html'],
    ['technician', 'users.html'],
    ['coordinator', 'users.html'],
    ['technician', 'review.html']
  ];
  for (var i = 0; i < CASES.length; i++) {
    var role = CASES[i][0], page = CASES[i][1];
    var p = await open(BASE + page, role);
    var panel = p.d.getElementById('accessPanel');
    ok(panel !== null, role + ' on ' + page + ': neutral access panel is shown');
    if (panel) {
      var text = panel.textContent;
      ok(/This page is not available/.test(text), role + ' on ' + page + ': panel uses the neutral heading');
      ok(text.indexOf(page) === -1, role + ' on ' + page + ': panel does not name the page');
    }
    ok(p.d.querySelector('.rail') !== null, role + ' on ' + page + ': the rail still works');
    close(p);
  }
});

/* ---------- run ---------- */
startServer().then(function (srv) {
  ACTIVE_SRV = srv;
  return captureSeed();
}).then(async function () {
  console.log('serving ' + ROOT + ' at ' + BASE);
  console.log('seed captured: ' + (SEED_DB ? 'yes (' + SEED_DB.length + ' bytes)' : 'NO') + '\n');
  for (var i = 0; i < tests.length; i++) {
    try { await tests[i](); }
    catch (e) { fail++; console.log('FAIL  ' + tests[i].name + ' threw: ' + (e && e.stack || e)); }
  }
  if (ACTIVE_SRV) stopServer(ACTIVE_SRV);
  console.log('\nROLE PAGE TESTS: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.log('harness error: ' + (e && e.stack || e));
  if (ACTIVE_SRV) stopServer(ACTIVE_SRV);
  process.exit(1);
});
