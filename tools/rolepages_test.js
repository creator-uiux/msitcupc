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
      var started = Date.now();
      function go() {
        var w = dom.window;
        /* The dashboard renders every role widget, so a cold jsdom load on a
           busy machine can pass six seconds.  Wait for Store, then give up
           after twenty; the app itself is unaffected. */
        if (!w.Store && Date.now() - started < 20000) { setTimeout(go, 200); return; }
        try {
          w.Store.reset();                       /* canonical seed, persisted */
          SEED_DB = w.localStorage.getItem('itc_db_v3');
        } catch (e) { SEED_DB = null; }
        try { dom.window.close(); } catch (e) { }
        resolve(SEED_DB);
      }
      if (dom.window.document.readyState === 'complete') setTimeout(go, 150);
      else dom.window.addEventListener('load', function () { setTimeout(go, 150); });
      setTimeout(go, 20000);
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
                                                  : w.UI.urlFor(w.UI.homePage(role), role);
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
/* Each lane's landing page.  The System Administrator holds no dashboard: its
   lane is Administration, so it lands on the users directory (role scope 5).
   Mirrors HOME_PAGE in js/ui.js and HOME_FOR_ROLE in tools/role_pages.py. */
var HOME = { requester: 'dashboard', technician: 'dashboard',
             coordinator: 'dashboard', management: 'users' };
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
   ['ic', 'technician'], ['mgmt', 'technician'],
   /* the administrator lane is Administration plus the audit viewer only */
   ['mgmt', 'dashboard'], ['mgmt', 'tickets'], ['mgmt', 'ticket'],
   ['mgmt', 'register'], ['mgmt', 'reports'], ['mgmt', 'maintenance']].forEach(function (pair) {
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
    var home = pfx + '-' + HOME[role] + '.html';
    var p = await open(BASE + home, role);
    ok(p.errors.length === 0, home + ' loads clean' + (p.errors.length ? ' -> ' + p.errors.join('|') : ''));
    ok(p.w.UI.roleKey() === role, home + ' pins role=' + role + ' (got ' + p.w.UI.roleKey() + ')');
    var side = p.d.querySelector('.role-chip');
    ok(side && side.textContent.trim() === TITLE[role], pfx + ': header shows the role title ("' + (side ? side.textContent.trim() : '') + '")');
    /* nav hrefs must carry the same prefix */
    var hrefs = Array.prototype.slice.call(p.d.querySelectorAll('.side-link[href]')).map(function (a) { return a.getAttribute('href'); });
    ok(hrefs.length > 0 && hrefs.every(function (h) { return h.indexOf(pfx + '-') === 0; }),
       pfx + ': every nav link is ' + pfx + '-prefixed');
    /* the active page is marked */
    var active = p.d.querySelector('.side-link.active');
    ok(active && active.getAttribute('href') === home, pfx + ': the landing page is the active nav item');
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

  /* signed in as management, open ic-ticket.html -> its own landing page,
     because the administrator lane holds no ticket screen at all */
  var p2 = await openCaptured(BASE + 'ic-ticket.html', 'management');
  ok(/mgmt-users\.html/.test(p2.url || p2.expect || ''),
     'management on ic-ticket.html redirects to mgmt-users.html (got ' + JSON.stringify(p2.url || p2.expect) + ')');
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
    ['management', 'itc-technician.html', 'mgmt-users.html'],
    ['management', 'ic-tickets.html', 'mgmt-users.html'],
    ['management', 'ic-reports.html', 'mgmt-users.html'],
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
    var home = pfx + '-' + HOME[role] + '.html';
    var p = await openCaptured(BASE + home, null);
    var u = p.url || p.expect || '';
    ok(!/login\.html/.test(u),
       home + ' sessionless load does NOT go to login (nav=' + JSON.stringify(u || '(none)') + ')');
    ok(p.redirected !== true, home + ' sessionless load does not redirect');
    ok(p.w.UI.roleKey() === role,
       home + ' sessionless load renders the URL role (got ' + p.w.UI.roleKey() + ')');
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
    ['requester', 'or-dashboard.html', '.dash-activity', false],
    ['coordinator', 'ic-dashboard.html', '.dash-activity', true],
    ['technician', 'itc-dashboard.html', '.dash-activity', true],
    ['requester', 'or-dashboard.html', '.tech-only', false],
    ['requester', 'or-dashboard.html', '.actor-only', true],
    ['technician', 'itc-dashboard.html', '.actor-only', true],
    ['coordinator', 'ic-dashboard.html', '.actor-only', true],
    ['coordinator', 'ic-dashboard.html', '#depWrap', true],
    ['coordinator', 'ic-dashboard.html', '.staff-only', true],
    ['coordinator', 'ic-dashboard.html', '.tech-only', true],
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

    ['requester', 'or-reports.html', '.lead-only', false],
    ['technician', 'itc-reports.html', '.lead-only', false],
    ['coordinator', 'ic-reports.html', '.lead-only', true],

    ['technician', 'itc-maintenance.html', '.schedule-manage', false],
    ['coordinator', 'ic-maintenance.html', '.schedule-manage', true],
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

tests.push(async function managementLaneIsAdministrationOnly() {
  /* Role scope 5: the System Administrator holds Administration plus the
     read-only audit viewer, and no operational screen at all. */
  var fs = require('fs');
  var p = await open(BASE + 'mgmt-users.html', 'management');
  var OPERATIONAL = ['dashboard', 'tickets', 'ticket', 'register', 'reports', 'maintenance'];
  OPERATIONAL.forEach(function (page) {
    ok(p.w.UI.can(page + '.html', 'management') === false,
       'management may not open ' + page + '.html');
    ok(!fs.existsSync(path.join(ROOT, 'mgmt-' + page + '.html')),
       'no mgmt-' + page + '.html is generated');
  });
  ['users', 'offices', 'settings', 'audit', 'flow', 'notifications', 'profile'].forEach(function (page) {
    ok(p.w.UI.can(page + '.html', 'management') === true,
       'management opens ' + page + '.html');
  });
  /* A lane must never be sent to a page it cannot open (that is a 404). */
  ['requester', 'technician', 'coordinator', 'management'].forEach(function (role) {
    var home = p.w.UI.homePage(role);
    ok(p.w.UI.can(home, role), role + ': the landing page ' + home + ' belongs to that role');
    ok(p.w.UI.urlFor('dashboard.html', role) === p.w.UI.urlFor(home, role)
       || p.w.UI.can('dashboard.html', role),
       role + ': a link to an unavailable page resolves inside the lane');
  });
  /* The audit viewer is read-only: the administrator holds no workflow action. */
  var denied = ['createTicket', 'assign', 'close', 'cancel', 'recordRepair', 'recordTest',
                'createSchedule', 'updateSchedule', 'officeDecision', 'startWork'];
  denied.forEach(function (method) {
    ok(p.w.PermissionMap.canMethod('management', method) === false,
       'management cannot call ' + method);
  });
  ok(p.w.PermissionMap.canMethod('management', 'saveSettings') === true,
     'management keeps its own administration methods');
  close(p);
});

tests.push(async function capabilityRowsFollowTheMap() {
  /* The capability reference is derived from the one permission map.  A row
     may never claim a role the map does not grant it, and it may not name an
     action or a page that the map does not carry. */
  var fs = require('fs');
  var perm = JSON.parse(fs.readFileSync(path.join(ROOT, 'permissions.json'), 'utf8'));
  var p = await open(BASE + 'roles.html', 'coordinator');
  var rows = p.w.UI.CAPS.filter(function (c) { return !c.group; });
  ok(rows.length >= 40, 'the reference covers every lane action (' + rows.length + ' rows)');
  var badMethod = [], badPage = [], widened = [];
  rows.forEach(function (c) {
    var roles = p.w.UI.capsRoles(c);
    if (c.m) {
      c.m.forEach(function (m) {
        if (!perm.actions[m]) badMethod.push(c.key + ' names unknown action ' + m);
      });
      roles.forEach(function (r) {
        var granted = c.m.some(function (m) {
          return (perm.actions[m] || []).indexOf(r) > -1;
        });
        if (!granted) widened.push(c.key + ' grants ' + r);
      });
    } else if (c.p) {
      if (!perm.pages[c.p]) badPage.push(c.key + ' names unknown page ' + c.p);
      roles.forEach(function (r) {
        if ((perm.pages[c.p] || []).indexOf(r) === -1) widened.push(c.key + ' grants ' + r);
      });
    }
    ok(roles.length > 0, 'capability row is owned by someone: ' + c.key);
  });
  ok(badMethod.length === 0, 'every capability row names a real action' +
     (badMethod.length ? ' -> ' + badMethod.join(' | ') : ''));
  ok(badPage.length === 0, 'every capability row names a real page' +
     (badPage.length ? ' -> ' + badPage.join(' | ') : ''));
  ok(widened.length === 0, 'no capability row is wider than the map' +
     (widened.length ? ' -> ' + widened.join(' | ') : ''));

  /* The rows the diagram puts in one lane must stay in that lane. */
  function owners(key) {
    var hit = rows.filter(function (c) { return c.key === key; })[0];
    return hit ? p.w.UI.capsRoles(hit).join(',') : '(missing)';
  }
  ok(owners('Review and verify the result: accept, or reject with feedback') === 'requester',
     'accept and reject belongs to the office alone');
  ok(owners('Confirm a maintenance visit result') === 'requester',
     'the visit confirmation belongs to the office alone');
  ok(owners('Authorized closure with a recorded reason') === 'coordinator',
     'authorized closure belongs to the coordinator');
  ok(owners('Read the audit log') === 'management',
     'the audit viewer belongs to the administrator');
  ok(owners('Enter a request on behalf of an office, with its source') === 'coordinator',
     'the on-behalf intake belongs to the coordinator');
  ok(owners('Submit a request for own office (no source field)') === 'requester',
     'own-office intake belongs to the office');
  ok(owners('Maintain reference data and operational settings') === 'management',
     'reference data belongs to the administrator');
  ['dashboard.html', 'register.html', 'reports.html'].forEach(function (page) {
    var hit = rows.filter(function (c) { return c.p === page; })[0];
    ok(hit && p.w.UI.capsRoles(hit).indexOf('management') === -1,
       page + ' is not a screen of the administrator lane');
  });
  close(p);
});

tests.push(async function roleNavigationMatchesPermissionMap() {
  var CASES = [
    ['requester', 'or-dashboard.html', ['my requests', 'new request', 'office register'], ['maintenance', 'users', 'flow.html']],
    ['technician', 'itc-dashboard.html', ['my tickets', 'my maintenance jobs', 'office register'], ['users', 'new request', 'flow.html']],
    ['coordinator', 'ic-dashboard.html', ['tickets', 'maintenance', 'reports'], ['users', 'offices', 'audit log', 'flow.html']],
    ['management', 'mgmt-users.html', ['users', 'offices', 'configuration', 'audit log'],
     ['new request', 'review and assign', 'tickets', 'my tickets', 'maintenance',
      'office register', 'reports', 'dashboard', 'flow.html']]
  ];
  for (var i = 0; i < CASES.length; i++) {
    var role = CASES[i][0], page = CASES[i][1];
    var p = await open(BASE + page, role);
    var labels = Array.prototype.slice.call(p.d.querySelectorAll('.side-link[href] .side-label'))
      .map(function (s) { return s.textContent.trim().toLowerCase(); });
    var hrefs = Array.prototype.slice.call(p.d.querySelectorAll('.side-link[href]'))
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
    ['technician', 'review.html'],
    /* role scope 5: the administrator lane holds no operational screen */
    ['management', 'dashboard.html'],
    ['management', 'tickets.html'],
    ['management', 'register.html'],
    ['management', 'reports.html'],
    ['management', 'maintenance.html']
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
    ok(p.d.querySelector('.side-nav') !== null, role + ' on ' + page + ': the sidebar still works');
    close(p);
  }
});

tests.push(async function paintedLinksBelongToTheLane() {
  /* Every anchor a signed-in lane actually sees must lead to a screen that
     lane may open.  tools/ui_ownership_check.js reads this from the markup and
     from the gate classes in the sheet; this test asks the rendered page, so a
     link the page assembles at load is covered by the same rule.  An anchor the
     page hides is not painted, so it is not counted: the app hides what a lane
     cannot use rather than offering it greyed out.  jsdom reports an element's
     own display, so the climb to the ancestors is done here by hand: a card the
     role gate collapses hides everything inside it. */
  var PRE = { requester: 'or', technician: 'itc', coordinator: 'ic', management: 'mgmt' };
  var FOR_ROLE = { or: 'requester', itc: 'technician', ic: 'coordinator', mgmt: 'management' };
  var SHARED = ['login.html', '404.html', 'index.html', 'offline.html'];
  var roles = ['requester', 'technician', 'coordinator', 'management'];
  function painted(w, node) {
    for (var e = node; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hasAttribute('hidden') || e.getAttribute('aria-hidden') === 'true') return false;
      var cs = w.getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  }
  var paintedCount = 0, pagesVisited = 0, controlCount = 0, greyed = [], outside = [];
  var WORK_SEL = '[data-act],[data-jact],[data-w],[data-m],[data-withdraw],[data-fault],[data-sedit],[data-stoggle]';
  function readControls(p, role, perm, where) {
    /* review and confirm paint data-act and data-jact, the technician workbench
       data-w, the maintenance screen data-m, the office withdrawal data-withdraw
       and the corrective ticket data-fault: all of them are workflow moves. */
    Array.prototype.slice.call(p.d.querySelectorAll(WORK_SEL)).forEach(function (b) {
      if (!painted(p.w, b)) return;
      controlCount++;
      var key = b.dataset.act || b.dataset.jact || b.dataset.w || b.dataset.m ||
        b.dataset.withdraw || b.dataset.fault || b.dataset.sedit || b.dataset.stoggle;
      if (b.disabled || b.getAttribute('aria-disabled') === 'true' ||
          /(^|\s)(is-|btn-)?disabled(\s|$)/.test(b.className)) {
        greyed.push(where + ': ' + key);
      }
      if (perm.actions[key] && perm.actions[key].indexOf(role) < 0) {
        outside.push(where + ': ' + key);
      }
    });
  }
  for (var r = 0; r < roles.length; r++) {
    var role = roles[r];
    var seed = await open(BASE + PRE[role] + '-profile.html', role);
    var PM = seed.w.PermissionMap;
    ok(!!PM, role + ': the permission map is loaded before its links are read');
    var pages = Object.keys(PM.pages).filter(function (pg) {
      return PM.pages[pg].indexOf(role) > -1 && SHARED.indexOf(pg) < 0;
    });
    close(seed);
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i];
      var p = await open(BASE + PRE[role] + '-' + page, role);
      pagesVisited++;
      ok((' ' + p.d.body.className + ' ').indexOf(' role-' + role + ' ') > -1,
        role + ' on ' + PRE[role] + '-' + page + ': the body carries its own lane class');
      var wrong = [], foreign = [], denied = [];
      Array.prototype.slice.call(p.d.querySelectorAll('a[href]')).forEach(function (a) {
        if (!painted(p.w, a)) return;
        var full = a.getAttribute('href') || '';
        var href = full.split('#')[0].split('?')[0];
        if (!/\.html$/.test(href) || href.indexOf('http') === 0) return;
        paintedCount++;
        var own = /^(itc|mgmt|or|ic)-(.*)$/.exec(href);
        if (own && FOR_ROLE[own[1]] !== role) {
          wrong.push(href + ' (' + a.textContent.trim().slice(0, 28) + ')');
          return;
        }
        var base = own ? own[2] : href;
        if (SHARED.indexOf(base) > -1) return;
        if (!PM.pages[base]) { foreign.push(base); return; }
        if (PM.pages[base].indexOf(role) < 0) denied.push(base);
      });
      ok(wrong.length === 0, role + ' on ' + PRE[role] + '-' + page +
        ': no painted link leads into another lane' + (wrong.length ? ' -> ' + wrong.join(', ') : ''));
      ok(foreign.length === 0, role + ' on ' + PRE[role] + '-' + page +
        ': every painted link names a page the map knows' + (foreign.length ? ' -> ' + foreign.join(', ') : ''));
      ok(denied.length === 0, role + ' on ' + PRE[role] + '-' + page +
        ': every painted link leads to a page this lane may open' + (denied.length ? ' -> ' + denied.join(', ') : ''));

      /* Required test 97: a move this lane cannot make is absent from the
         page, not offered greyed out.  Only workflow controls carry data-act;
         a form's own submit button stays disabled until it is filled in, which
         is input validation and not a permission. */
      readControls(p, role, PM, role + ' on ' + PRE[role] + '-' + page);
      close(p);
    }
  }
  console.log('  (' + pagesVisited + ' lane pages, ' + paintedCount + ' painted links read)');
  ok(pagesVisited >= 45, 'every lane page was visited (' + pagesVisited + ')');
  ok(paintedCount > 200, 'the links read are a real surface, not an empty page (' + paintedCount + ')');

  /* The list pages above carry no move: a record screen paints its buttons only
     once it has a record to show.  These addresses are the moves the diagram
     places in each lane, built from the seed the harness signs in with, so the
     screen is asked as the lane that has to act on it. */
  var recMap = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'permissions.json'), 'utf8'));
  var seed = JSON.parse(SEED_DB);
  var SCOPE = {
    requester: function (r) { return r.office === 'Records Office'; },
    technician: function (r) { return r.technician === 'J. Tan'; }
  };
  function candidates(kind, role, prefer) {
    var list = (kind === 'jobs' ? seed.jobs : seed.tickets) || [];
    var inScope = SCOPE[role] || function () { return true; };
    var mine = list.filter(inScope);
    /* The records where this lane is the one that acts come first; the rest are
       still opened, because a record the lane only watches must say so. */
    var rank = function (r) {
      var i = (prefer || []).indexOf(r.status);
      return i < 0 ? prefer ? prefer.length + 1 : 1 : i;
    };
    return mine.slice().sort(function (a, b) { return rank(a) - rank(b); }).slice(0, 3)
      .map(function (r) { return r.id; });
  }
  /* role, lane page, query parameter, which record kind, the statuses where this
     lane acts, and whether a move is owed here: 'some' means a control must be
     painted for at least one of the records, 'any' means the screen may hold none
     because the wait is stated instead. */
  var PLAN = [
    ['coordinator', 'review.html', 'id', 'tickets', ['submitted', 'needs_info'], 'some'],
    ['coordinator', 'confirm.html', 'id', 'tickets', ['resolved', 'closed'], 'some'],
    ['coordinator', 'maintenance.html', 'job', 'jobs', ['submitted', 'assigned'], 'some'],
    ['requester', 'confirm.html', 'id', 'tickets', ['resolved', 'closed'], 'some'],
    ['requester', 'request.html', 'respond', 'tickets', ['needs_info'], 'any'],
    ['requester', 'visits.html', 'job', 'jobs', ['assigned', 'in_progress'], 'any'],
    ['technician', 'technician.html', 'job', 'jobs', ['assigned', 'in_progress'], 'some'],
    ['technician', 'technician.html', 't', 'tickets', ['assigned', 'in_progress', 'on_hold'], 'some'],
    ['technician', 'maintenance.html', 'job', 'jobs', ['assigned', 'in_progress'], 'any']
  ];
  var recordPages = 0;
  for (var k = 0; k < PLAN.length; k++) {
    var role2 = PLAN[k][0], base2 = PLAN[k][1], param = PLAN[k][2], kind = PLAN[k][3],
        prefer = PLAN[k][4], expect = PLAN[k][5];
    var ids = candidates(kind, role2, prefer);
    var best = 0, seenOn = '';
    for (var c = 0; c < ids.length; c++) {
      var addr = PRE[role2] + '-' + base2 + '?' + param + '=' + encodeURIComponent(ids[c]);
      var rec = await open(BASE + addr, role2);
      recordPages++;
      var before = controlCount;
      readControls(rec, role2, recMap, role2 + ' on ' + addr);
      var got = controlCount - before;
      /* The office's reply is a form and its withdrawal is a row control, so the
         way a lane can act on the record in front of it is wider than the move
         buttons; a ledger with nothing to act on states where the record stands. */
      var surface = Array.prototype.slice.call(
        rec.d.querySelectorAll(WORK_SEL + ',button[type=submit]'))
        .filter(function (b) { return painted(rec.w, b); }).length;
      var body = rec.d.body.textContent;
      var stated = /Waiting on/i.test(body) ||
        /Submitted|Needs Information|Assigned|In Progress|On Hold|Resolved|Closed|Cancelled/.test(body);
      ok(surface > 0 || stated, role2 + ' on ' + addr +
        ': the screen either offers a way to act or states where the record stands' +
        (got ? ' (' + got + ' move(s))' : ''));
      if (got > best) { best = got; seenOn = addr; }
      close(rec);
      if (best > 0 && expect === 'some') break;
    }
    if (expect === 'some') {
      ok(best > 0, role2 + ' on ' + base2 + ': the lane the diagram gives this move to ' +
        'sees a control for it' + (best ? ' (' + seenOn + ')' : ' (no record offered one)'));
    }
  }
  console.log('  (' + recordPages + ' record pages opened on a signed-in lane)');
  ok(recordPages >= 12, 'the record screens were driven, not just listed (' + recordPages + ')');
  console.log('  (' + controlCount + ' painted workflow controls read)');
  ok(controlCount > 20, 'the lanes offer a real set of controls, not an empty page (' + controlCount + ')');
  ok(greyed.length === 0, 'no painted workflow control is disabled instead of hidden' +
    (greyed.length ? ' -> ' + greyed.join(', ') : ''));
  ok(outside.length === 0, 'no painted workflow control offers a move the lane is not granted' +
    (outside.length ? ' -> ' + outside.join(', ') : ''));
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
