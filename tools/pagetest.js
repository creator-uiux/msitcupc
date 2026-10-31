/* Page-level integration test: serves mockups over HTTP, loads every page in
   jsdom with scripts running, and drives real interactions (forms, buttons,
   sign-in, schedule check, filters). Fails on any window/console error.
   Run: node tools\pagetest.js  (needs jsdom in TEMP\opencode) */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http');
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
   external service: the font request is answered locally with an empty
   stylesheet, so the page uses its own fallback stack and the suite stays
   deterministic and offline. */
function localOnlyInterceptor() {
  if (!requestInterceptor) return undefined;
  return requestInterceptor(async function (req) {
    if (String(req.url).indexOf('127.0.0.1') > -1 ||
        String(req.url).indexOf('localhost') > -1) return undefined;
    return new Response('', { status: 200, headers: { 'content-type': 'text/css' } });
  });
}

var ROOT = path.join(__dirname, '..');
/* A free port, so two test runs never fight over the same one.  A fixed port
   made the suite flaky whenever anything else was serving the directory. */
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

/* ---------- server ---------- */
function startServer() {
  return freePort().then(function (port) {
    PORT = port;
    BASE = 'http://127.0.0.1:' + PORT + '/';
    /* A threaded server: the single threaded http.server queues the parallel
       script requests and the browser gives up waiting for them. */
    var child = spawn('python', [path.join(ROOT, 'tools', 'serve.py'), String(PORT), ROOT], { cwd: ROOT, stdio: 'ignore' });
    return new Promise(function (resolve, reject) {
      var tries = 0;
      (function ping() {
        http.get(BASE + 'index.html', function (r) { r.resume(); resolve(child); })
          .on('error', function () {
            if (++tries > 120) reject(new Error('server never came up'));
            else setTimeout(ping, 250);
          });
      })();
    });
  });
}
function stopServer(child) {
  /* py launcher shim can exit right after spawning the real interpreter, so
     taskkill'ing child.pid alone orphans python.exe. Kill any process that
     actually LISTENs on our port as well (tree kill). Synchronous so an
     'exit' hook can reliably finish before node dies. */
  var targets = {};
  if (child && child.pid) targets[String(child.pid)] = true;
  try {
    execSync('netstat -ano', { encoding: 'utf8' }).split(/\r?\n/).forEach(function (ln) {
      var p = ln.trim().split(/\s+/);
      if (p.length >= 5 && p[1].indexOf(':' + PORT) !== -1 && p[3] === 'LISTENING') {
        targets[p[4]] = true;
      }
    });
  } catch (e) { }
  Object.keys(targets).forEach(function (pid) {
    try { execSync('taskkill /pid ' + pid + ' /f /t', { stdio: 'ignore' }); }
    catch (e) { /* already gone */ }
  });
}

/* clean up even if a test throws out of the run loop */
var ACTIVE_SRV = null;
process.on('exit', function () { if (ACTIVE_SRV) stopServer(ACTIVE_SRV); });

/* ---------- page harness ---------- */
/* A test may need to prove a registered feature still works when the owner
   turns it on. The page loads the generated mirror, so the harness installs a
   property whose setter merges the forced flags into whatever the mirror
   assigns. Every other page still reads the committed registry unchanged. */
function forceFeatures(win, forced) {
  function make(flags) {
    return {
      flags: flags,
      on: function (name) { return flags[name] === true; },
      off: function (name) { return flags[name] !== true; },
      all: function () {
        var out = {};
        for (var k in flags) {
          if (Object.prototype.hasOwnProperty.call(flags, k)) out[k] = flags[k];
        }
        return out;
      }
    };
  }
  var current = make(forced);
  Object.defineProperty(win, 'Features', {
    configurable: true,
    get: function () { return current; },
    set: function (value) {
      var flags = {};
      if (value && value.flags) {
        for (var k in value.flags) {
          if (Object.prototype.hasOwnProperty.call(value.flags, k)) flags[k] = value.flags[k];
        }
      }
      for (var f in forced) {
        if (Object.prototype.hasOwnProperty.call(forced, f)) flags[f] = true;
      }
      current = make(flags);
    }
  });
}

function setViewport(win, width) {
  function fixed(name, value) {
    try {
      Object.defineProperty(win, name, { configurable: true, get: function () { return value; } });
    } catch (e) { /* property is not configurable in this jsdom build */ }
  }
  fixed('innerWidth', width);
  fixed('innerHeight', width < 600 ? 844 : 900);
  fixed('outerWidth', width);
  fixed('outerHeight', width < 600 ? 844 : 900);
  fixed('devicePixelRatio', 1);
  try {
    win.matchMedia = function (query) {
      var max = /max-width:\s*(\d+)px/.exec(query);
      var min = /min-width:\s*(\d+)px/.exec(query);
      var matches = true;
      if (max) matches = matches && width <= parseInt(max[1], 10);
      if (min) matches = matches && width >= parseInt(min[1], 10);
      return {
        matches: matches, media: query, onchange: null,
        addListener: function () { }, removeListener: function () { },
        addEventListener: function () { }, removeEventListener: function () { },
        dispatchEvent: function () { return false; }
      };
    };
  } catch (e) { /* keep jsdom's default */ }
}

function openOnce(url, forced, width) {
  var vc = new VirtualConsole();
  var errors = [];
  vc.on('jsdomError', function (e) { errors.push('jsdomError: ' + (e.message || e)); });
  vc.on('error', function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); });
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    requestInterceptor: localOnlyInterceptor(),
    beforeParse: function (win) {
      if (width) setViewport(win, width);
      if (forced) forceFeatures(win, forced);
    }
  }).then(function (dom) {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return; done = true;
        try {
          var w = dom.window;
          if (w.Store) w.Store.update(function (db) { db.settings.simulate = false; });
        } catch (e) { errors.push('post-load: ' + e.message); }
        resolve({ dom: dom, w: dom.window, d: dom.window.document, errors: errors });
      }
      if (dom.window.document.readyState === 'complete') setTimeout(finish, 60);
      else dom.window.addEventListener('load', function () { setTimeout(finish, 60); });
      setTimeout(finish, 20000);
    });
  });
}
/* The static python http.server occasionally drops a script connection under
   load; that shows up as a transient "Could not load script" rather than an app
   bug, so re-fetch the page a couple of times before trusting the result. */
function open(url, tries, forced, width) {
  tries = tries || 0;
  return openOnce(url, forced, width).then(function (p) {
    var transient = p.errors.some(function (e) { return /Could not load script|ERR_|ECONNRESET|socket hang up|is not defined/i.test(e); });
    /* the app scripts are still loading when the harness evaluates the page:
       treat a missing global as transient and fetch the page again */
    if (!transient && !p.w.UI) transient = true;
    if (transient && tries < 3) {
      try { p.w.close(); } catch (e) { }
      return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return open(url, tries + 1, forced, width); });
    }
    CUR = p;
    return p;
  });
}
function close(p) { try { p.w.close(); } catch (e) { } }
var CUR = null;                       /* most recently opened page */
function $(sel) { return CUR.d.querySelector(sel); }
function $$(sel) { return Array.prototype.slice.call(CUR.d.querySelectorAll(sel)); }
function setVal(p, el, v) { el.value = v; el.dispatchEvent(new p.w.Event('change', { bubbles: true })); }
/* sign in as a role the way the app does (no impersonation UI any more) */
function asRole(p, role) { p.w.UI.signIn(role); p.w.UI.remount(); }
function fld(form, name) { return form.querySelector('[name="' + name + '"]'); }
function openFeatures(url, flags) { return open(url, 0, flags); }
function openWidth(url, width) { return open(url, 0, null, width); }

/* ---------- tests ---------- */
var tests = [];

tests.push(async function dashboard() {
  var p = await open(BASE + 'dashboard.html');
  ok(p.errors.length === 0, 'dashboard loads with no script errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($$('#kpiGrid .kpi').length === 4, 'role dashboard renders four focused KPI tiles (' + $$('#kpiGrid .kpi').length + ')');
  ok($$('#queueBody tr').length >= 5, 'active queue lists seeded tickets (' + $$('#queueBody tr').length + ')');
  ok($$('#maintDue li').length >= 3, 'maintenance due list populated');
  ok($$('#activity li').length >= 5, 'live audit feed populated');
  ok($('#depMount a[href="review.html"]') !== null, 'on-hold summary links to Review & Assign');

  /* the signed-in account defines the role  --  no impersonation control */
  ok($('.roleSel') === null, 'no view-as-role switcher in the top bar');
  asRole(p, 'requester');
  ok(p.w.Store.db.role === 'requester', 'signed-in role persists to store');
  ok($('.acctName').textContent === 'A. Delos Reyes', 'account tray reflects the signed-in account');
  ok($('.side-avatar').textContent === 'AD', 'sidebar avatar initials update');

  /* live tick */
  var n0 = p.w.Store.db.tickets.length;
  p.w.Live.runOnce();
  ok(p.w.Store.db.tickets.length >= n0, 'real-time tick runs without error');
  ok(p.errors.length === 0, 'no errors after interactions');
  close(p);
});

tests.push(async function review() {
  var p = await open(BASE + 'review.html');
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'review page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($$('#rKpi .kpi').length === 4, 'review KPIs render');
  ok($$('#rvBody tr').length >= 3, 'coordinator worklist populated (' + $$('#rvBody tr').length + ')');

  /* dependency follow-up on an On Hold ticket (coordinator lane) */
  var holdRow = $$('#rvBody tr[data-id="IT-2026-000139"]')[0];
  ok(holdRow !== null, 'on-hold ticket appears in the worklist');
  if (holdRow) {
    holdRow.click();
    var before = p.w.Store.getTicket('IT-2026-000139').dependency.updates.length;
    $$('#rvPanel [data-act="followup"]')[0].click();
    var modal = $('.modal-host');
    ok(modal !== null, 'follow-up modal opens');
    modal.querySelector('[name="text"]').value = 'Procurement released PO-118.';
    $('#mGo').click();
    ok(p.w.Store.getTicket('IT-2026-000139').dependency.updates.length === before + 1, 'follow-up update persisted to ticket');
    ok($('.modal-host') === null, 'modal closes after save');
  }

  /* request missing details on a Submitted ticket */
  var subRow = $$('#rvBody tr[data-id="IT-2026-000143"]')[0];
  ok(subRow !== null, 'submitted ticket appears in the worklist');
  if (subRow) {
    subRow.click();
    $$('#rvPanel [data-act="needsinfo"]')[0].click();
    $('.modal-host [name="missing"]').value = 'AP location and controller IP.';
    $('#mGo').click();
    ok(p.w.Store.getTicket('IT-2026-000143').status === 'needs_info', 'Details complete? No -> Needs Information');
    ok(p.w.Store.getTicket('IT-2026-000143').reviewed === false, 'no assessment recorded on an incomplete request');
  }
  ok(p.errors.length === 0, 'no errors after review interactions');
  close(p);
});

tests.push(async function request() {
  var p = await open(BASE + 'request.html');
  asRole(p, 'requester');
  ok(p.errors.length === 0, 'request loads with no script errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok(p.w.Store.db.role === 'requester', 'requester can open the request screen');

  /* validation: empty issue rejected */
  var n0 = p.w.Store.db.tickets.length;
  $('#reqForm').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  ok(p.w.Store.db.tickets.length === n0, 'empty submission rejected (required fields)');

  /* priority is an IT assessment field: the office form hides it */
  ok($('#fPriority') !== null, 'the request form keeps the priority field for IT staff');
  ok($('#fPriorityField').hidden === true, 'the office requester never sees the priority field');
  ok($('#fDateReported').value === p.w.Time.todayPlus(0), 'date reported defaults to today');

  /* the office list comes from the register, not a hardcoded subset */
  ok($$('#fOffice option').length === 9, 'every active office plus the prompt is offered (' +
    $$('#fOffice option').length + ')');
  ok($$('#fOffice option').some(function (o) { return o.value === 'Office of the Director'; }),
    'the office dropdown includes the Office of the Director');

  /* the office requester files under their own name but may pick another office */
  ok($('#fReq').disabled === true, 'requester files under their own account');
  ok($('#fReq').value === 'A. Delos Reyes', 'locked requester field shows the signed-in name');
  ok($('#fOffice').disabled === false && $('#fOffice').value === 'Records Office',
    'requester office starts on their own office and stays selectable');
  ok(/Choose another active office/.test($('#fOfficeHelp').textContent),
    'office field explains that another active office can be chosen');
  $('#btnReset').click();
  ok($('#fReq').disabled === true, 'Clear does not unlock the requester field');
  ok($('#fReq').value === 'A. Delos Reyes', 'Clear restores the signed-in name');
  ok($('#fOffice').disabled === false && $('#fOffice').value === 'Records Office',
    'Clear returns the office choice to the requester default');

  /* real submission, for an office other than the requester's own */
  var f = $('#reqForm');
  fld(f, 'office').value = 'Library';
  fld(f, 'category').value = 'Printer and Peripheral';
  fld(f, 'issue').value = 'Toner smears on the right margin.';
  fld(f, 'asset').value = 'PRN-REG-02';
  fld(f, 'priority').value = 'high';
  fld(f, 'dateReported').value = '2026-09-30';
  fld(f, 'idempotencyKey').value = 'qa-request-dup-1';
  $('#btnSubmit').disabled = false;
  f.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  ok(p.w.Store.db.tickets.length === n0 + 1, 'valid submission creates a ticket');
  var nt = p.w.Store.db.tickets[0];
  ok(nt.status === 'submitted' && nt.office === 'Library' && nt.asset === 'PRN-REG-02', 'intake captured the chosen office/asset/status');
  ok(nt.priority === 'medium', 'requester intake starts at Medium (priority is set at assessment)');
  ok(nt.dateReported === '2026-09-30', 'the date reported field reaches the ticket');
  ok(nt.idempotencyKey === 'qa-request-dup-1', 'the duplicate protection key reaches the ticket');
  ok(nt.requester === 'A. Delos Reyes', 'the disabled requester field still files under the signed-in account');
  ok($('#successBox').hidden === false, 'success panel shown with new id');
  ok($('#sucId').textContent === nt.id, 'success panel shows the real ticket id');
  ok(/IT Coordinator will review/.test($('#sucNext').textContent), 'success panel explains the review step');
  ok($('#myList').children.length > 0, 'office ticket list refreshed');

  /* a repeated submit with the same key is harmless */
  var n1 = p.w.Store.db.tickets.length;
  $('#btnSubmit').disabled = false;
  f.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  ok(p.w.Store.db.tickets.length === n1, 'the duplicate protection key prevents a second ticket');
  ok(p.errors.length === 0, 'no errors after submission');
  close(p);
});

tests.push(async function requestCoordinatorIntake() {
  var p = await open(BASE + 'request.html');
  asRole(p, 'coordinator');
  ok($('#fReq').disabled === false, 'coordinator types the name of the person reporting the issue');
  ok(/Name of the person/.test($('#fReqHelp').textContent), 'coordinator field explains what to enter');
  ok($('#fOffice').disabled === false, 'coordinator can choose any office');
  ok($('#fPriorityField').hidden === false, 'coordinator sees the priority field at intake');
  ok(/Any active office/.test($('#fOfficeHelp').textContent), 'coordinator office field explains its scope');
  ok(p.errors.length === 0, 'no errors on the coordinator intake');
  close(p);
});

tests.push(async function requestRespond() {
  var p = await open(BASE + 'request.html?respond=IT-2026-000137');
  ok(p.errors.length === 0, 'respond mode loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($('#respondNote').hidden === false, 'needs-information banner shown');
  ok(/Supply missing information/.test($('#formTitle').textContent), 'form retitled to reply mode');
  ok($('#fReq').disabled === true && $('#fReq').value === 'R. Villanueva', 'reply keeps the requester carried from the original ticket');
  ok($('#fPriority').disabled === true && $('#fPriority').value === 'high', 'reply carries the original priority and cannot change it');
  p.w.applyRequesterLock();
  ok($('#fReq').disabled === true && $('#fReq').value === 'R. Villanueva', 'the lock never reopens the reply fields');
  var f = $('#reqForm');
  fld(f, 'issue').value = 'Payroll module fails with error 0x80070057 on machine ACC-3.';
  $('#btnSubmit').disabled = false;
  f.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  var t = p.w.Store.getTicket('IT-2026-000137');
  ok(t.status === 'submitted', 'reply returns the SAME ticket to review (no new ticket)');
  ok(p.w.Store.db.tickets.filter(function (x) { return x.id === 'IT-2026-000137'; }).length === 1, 'still exactly one record for that request');
  close(p);
});

tests.push(async function ticketDetail() {
  var p = await open(BASE + 'ticket.html?id=IT-2026-000130');
  ok(p.errors.length === 0, 'ticket page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($('#tPickerBar') === null, 'the ticket chooser is absent by default');
  ok(/IT-2026-000130/.test($('#tHead').textContent), 'ticket header shows the id');
  ok($('#tHistory').textContent.includes('Assigned to J. Tan'), 'audit history rendered');

  /* the record is read-only now  --  transitions live on the section screens */
  ok($$('[data-tact]').length === 0, 'no inline transitions on the record');
  ok($('#tActions a[href^="ic-review.html"]') !== null,
    'record links into the coordinator lane for coordinator work');
  /* Appendix E.2: the tabbed record sections */
  ok($$('#tTabs .tab').length === 5, 'the record carries the five documented tabs');
  ok($$('#tTabs .tab').map(function (b) { return b.textContent; }).join(',') ===
     'Conversation,Service record,Dependencies,History,Related', 'the tabs are named as documented');
  ok($('#panel-conv').hidden === false && $('#panel-work').hidden === true, 'only the first tab panel is open');
  $('#tab-hist').click();
  ok($('#panel-hist').hidden === false && $('#panel-conv').hidden === true, 'the history tab opens its own panel');
  ok($('#tHistory').textContent.length > 0, 'the history panel holds the status changes');
  /* the status selector lists only the moves the role may make */
  var opts = $$('#tMove option').map(function (o) { return o.textContent; });
  ok(opts.length >= 2, 'the status selector lists the valid moves (' + opts.join(' | ') + ')');
  ok(opts[0] === 'Choose the next step…', 'the selector starts on a placeholder');
  ok(!opts.join(' ').match(/Accept the result/), 'the coordinator is not offered the office acceptance');
  ok(p.errors.length === 0, 'no errors on the record page');
  close(p);
});

tests.push(async function ticketDetailRequester() {
  var p = await open(BASE + 'ticket.html?id=IT-2026-000142');
  asRole(p, 'requester');
  var head = $('#tHead').textContent;
  ok(!/Priority/.test(head), 'the office requester sees no priority on the record');
  ok(!/Impact \/ urgency/.test(head), 'the office requester sees no impact or urgency');
  ok(!/Technician/.test(head), 'the office requester sees no technician field');
  ok(head.indexOf('J. Tan') === -1, 'the assigned technician name is hidden from the office');
  ok(p.errors.length === 0, 'no errors on the requester record view');
  close(p);
});

tests.push(async function reviewReassign() {
  var p = await open(BASE + 'review.html');
  p.w.UI.signIn('coordinator');
  p.w.UI.remount();
  var row = $$('#rvBody tr[data-id="IT-2026-000130"]')[0];
  if (row) row.click();
  var button = $$('#rvPanel [data-act="reassign"]')[0];
  ok(button !== undefined, 'the coordinator is offered a reassign control on an assigned ticket');
  if (button) {
    button.click();
    ok($('.modal-host') !== null, 'the reassign modal opens');
    $('.modal-host [name="tech"]').value = 'M. Uy';
    $('#mGo').click();
    ok(p.w.Store.getTicket('IT-2026-000130').technician === 'M. Uy', 'reassignment reaches the ticket');
  }
  ok(p.errors.length === 0, 'no errors after reassignment');
  close(p);
});

tests.push(async function confirmClose() {
  var p = await open(BASE + 'confirm.html');
  ok(p.errors.length === 0, 'confirmation page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($$('#cKpi .kpi').length === 4, 'confirmation KPIs render');

  var row = $$('#cfBody tr[data-id="IT-2026-000141"]')[0];
  ok(row !== null, 'resolved ticket listed for confirmation');
  if (row) row.click();
  ok($$('#cfPanel [data-act="close"]').length === 0, 'close is NOT offered before acceptance (guard)');

  asRole(p, 'requester');
  $$('#cfPanel [data-act="accept"]')[0].click();
  var cf = p.w.Store.getTicket('IT-2026-000141');
  ok(cf.confirmation.state === 'accepted', 'office acceptance recorded');
  ok(cf.status === 'closed', 'acceptance closes the ticket in one step');
  ok(cf.confirmation.person === 'A. Delos Reyes' && !!cf.confirmation.date,
    'acceptance records the confirming person and date');

  asRole(p, 'coordinator');
  var cb = $$('#cfPanel [data-act="close"]')[0];
  ok(cb === undefined, 'the coordinator is not offered a confirmation closure');
  ok($$('#cfPanel [data-act="accept"]').length === 0, 'the coordinator is not offered the office decision');

  /* recurrence */
  var n0 = p.w.Store.db.tickets.length;
  $$('#cfPanel [data-act="recur"]')[0].click();
  $('.modal-host [name="issue"]').value = 'Flicker returned after two weeks.';
  $('#mGo').click();
  ok(p.w.Store.db.tickets.length === n0 + 1, 'recurrence creates a NEW linked ticket');
  var nt = p.w.Store.db.tickets[0];
  ok(nt.linkedTo === 'IT-2026-000141', 'new ticket linked to previous record');
  ok(p.w.Store.getTicket('IT-2026-000141').recurring === true, 'closed record flagged as recurring');
  ok(p.errors.length === 0, 'no errors after confirmation flow');
  close(p);
});

tests.push(async function maintenanceAvailability() {
  var p = await open(BASE + 'confirm.html');
  asRole(p, 'requester');
  ok(p.errors.length === 0, 'confirmation page loads for the requester');

  /* requester owns "Agree on new maintenance date" (Office Requester lane) */
  var no = $$('#cfJobs [data-jact="availNo"]')[0];
  ok(no !== null, 'requester sees their office maintenance awaiting availability');
  var jid = no ? no.dataset.job : '';
  if (no) {
    no.click();
    $('.modal-host [name="date"]').value = '2026-12-20';
    $('.modal-host [name="reason"]').value = 'Office examination week.';
    $('#mGo').click();
    ok(p.w.Store.getJob(jid).status === 'on_hold', 'requester proposes a new date → rescheduled');
    ok(p.w.Store.getJob(jid).reschedules.length >= 1, 'reschedule written to the job record');
  }

  /* and can confirm availability once a date suits the office */
  var yes = $$('#cfJobs [data-jact="availYes"]')[0];
  ok(yes !== null, 'requester can confirm office availability');
  if (yes) {
    yes.click();
    ok(p.w.Store.getJob(yes.dataset.job).availability === 'yes', 'office available → visit coordinated');
  }

  /* the coordinator oversees every office, not just one */
  asRole(p, 'coordinator');
  var rows = $$('#cfJobs [data-jact="availYes"]').length + $$('#cfJobs [data-jact="availNo"]').length;
  ok(rows >= 2, 'coordinator oversees all offices (more open visits than a single office)');
  ok(p.errors.length === 0, 'no errors after availability interactions');
  close(p);
});

tests.push(async function requestWithdraw() {
  var p = await open(BASE + 'request.html');
  asRole(p, 'requester');
  var btn = $$('#myList [data-withdraw]')[0];
  ok(btn !== null, 'requester is offered a withdraw control on an active request');
  if (btn) {
    var id = btn.dataset.withdraw;
    btn.click();
    var modal = $('.modal-host');
    ok(modal !== null, 'withdraw modal opens');
    modal.querySelector('[name="reason"]').value = 'No longer needed.';
    $('#mGo').click();
    /* The office may only REQUEST withdrawal; the IT Coordinator records the
       cancellation reason (the PDF places that step in the coordinator lane). */
    var t = p.w.Store.getTicket(id);
    ok(t.status !== 'cancelled', 'requester cannot cancel directly  --  status unchanged (' + t.status + ')');
    ok(!!t.withdrawal, 'withdrawal request recorded on the ticket');
    ok(t.withdrawal.reason === 'No longer needed.', 'office withdrawal reason recorded');
    ok(p.w.Store.db.notifications.some(function (n) {
      return n.role === 'coordinator' && n.ticketId === id && /withdrawal/i.test(n.text);
    }), 'coordinator notified of the withdrawal request');
  }
  ok(p.errors.length === 0, 'no errors after withdraw');
  close(p);
});

tests.push(async function technicianPage() {
  var p = await open(BASE + 'technician.html?t=IT-2026-000130');
  asRole(p, 'technician');
  ok(p.errors.length === 0, 'technician page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok(p.w.Store.db.role === 'technician', 'technician can open the workbench');
  ok($$('#wKpi .kpi').length === 4, 'workbench KPIs render');
  ok($$('#wBody tr').length >= 3, 'my ticket queue populated');
  /* every button is a valid next step for the ticket's status (no dead buttons) */
  ok($('#wPanel [data-w="coord"]') !== null, 'coordinate-service-schedule action offered on an assigned ticket (IT Technician lane)');
  ok($('#wPanel [data-w="start"]') !== null, 'start-work action offered on an assigned ticket');
  ok($('#wPanel [data-w="diagnose"]') === null, 'diagnosis is hidden until the work starts');
  ok($('#wPanel [data-w="pass"]') === null, 'testing is hidden before a diagnosis is recorded');

  /* start work then record diagnosis (IT Technician lane) */
  var startBtn = $$('#wPanel [data-w="start"]')[0];
  if (startBtn) startBtn.click();
  /* Work starts only after the visit is coordinated: the start action opens the
     coordination modal (SOP 10) and records the coordination note. */
  var cmodal = $('.modal-host');
  ok(cmodal !== null, 'start work requires the visit to be coordinated first');
  if (cmodal) {
    var cnote = cmodal.querySelector('[name="note"]');
    if (cnote) cnote.value = 'Visit agreed with the office head for the afternoon.';
    $('#mGo').click();
  }
  ok(p.w.Store.getTicket('IT-2026-000130').status === 'in_progress', 'Start work -> Status: In Progress');
  ok(p.w.Store.getTicket('IT-2026-000130').history.some(function (h) {
    return h.kind === 'sched';
  }), 'schedule coordination recorded before the status moved');
  var dg = $$('#wPanel [data-w="diagnose"]')[0];
  ok(dg !== null, 'diagnosis action appears once work is In Progress');
  if (dg) {
    dg.click();
    var dmodal = $('.modal-host');
    ok(dmodal !== null, 'diagnosis modal opens');
    dmodal.querySelector('[name="findings"]').value = 'Worn pickup roller on tray 2.';
    dmodal.querySelector('[name="cost"]').value = '450';
    $('#mGo').click();
    ok(p.w.Store.getTicket('IT-2026-000130').diagnosis.findings.indexOf('pickup roller') > -1, 'diagnosis saved');
    ok(p.w.Store.getTicket('IT-2026-000130').diagnosis.cost === 450, 'cost recorded');
  }

  /* distinct repair step: record the actions performed separately from diagnosis */
  var rep = $$('#wPanel [data-w="repair"]')[0];
  ok(rep !== null, 'repair action appears once the diagnosis is recorded');
  if (rep) {
    rep.click();
    var rmodal = $('.modal-host');
    ok(rmodal !== null, 'repair modal opens');
    rmodal.querySelector('[name="actions"]').value = 'Replaced pickup roller, cleaned tray 2.';
    rmodal.querySelector('[name="parts"]').value = 'Pickup roller kit';
    $('#mGo').click();
    var d2 = p.w.Store.getTicket('IT-2026-000130').diagnosis;
    ok(d2.actions.indexOf('pickup roller') > -1, 'repair/actions recorded distinctly from findings');
    ok(d2.parts === 'Pickup roller kit', 'repair parts recorded');
  }

  /* checklist recording in place, with the dialog as a fallback */
  var row = null;
  $$('#wJobs .chk-card').some(function (r) {
    if (r.querySelector('[data-res]:not([disabled])')) { row = r; return true; }
    return false;
  });
  ok(row !== null, 'maintenance checklist cards offer a result segment');
  if (row) {
    var card = row.closest('[data-jobcard]');
    var jobId = card.dataset.jobcard, idx = parseInt(row.dataset.chk, 10);
    row.querySelector('[data-res="Passed"]').click();
    row.querySelector('[data-finding]').value = 'Dust cleared.';
    card.querySelector('[data-save-job]').click();
    var it = p.w.Store.getJob(jobId).items[idx];
    ok(it.done === true && it.result === 'Passed', 'checklist item recorded with result/finding');
    ok(it.finding === 'Dust cleared.', 'the finding is saved from the card');
    ok(card.querySelector('.chk-foot') !== null, 'the checklist keeps a sticky save footer');
    ok(card.querySelector('[data-detail]') !== null, 'the dialog stays available as a fallback');
  }

  /* a job the technician cannot work hides its editor, it is not grayed out */
  var heldJob = p.w.Store.db.jobs.filter(function (j) {
    return j.technician === p.w.ROLES.technician.name && j.items.length > 0;
  })[0];
  if (heldJob) {
    var heldStatusBefore = heldJob.status;
    heldJob.status = 'submitted';
    p.w.render();
    var held = $('#wJobs [data-jobcard="' + heldJob.id + '"]');
    ok(held !== null, 'the job card renders for the held job');
    if (held) {
      ok(held.querySelector('.chk-seg') === null, 'an uncoordinated visit hides the result segments');
      ok(held.querySelector('.chk-finding input') === null, 'an uncoordinated visit hides the finding field');
      ok(held.querySelector('.file-btn') === null, 'an uncoordinated visit hides the photo picker');
      ok(held.querySelector('[data-detail]') === null, 'an uncoordinated visit hides the record dialog');
      ok(held.querySelector('[data-save-job],[data-flag-fault],[data-outcome]') === null,
        'an uncoordinated visit hides save, fault flag and completion');
      ok(/Waiting on: IT Coordinator/.test(held.querySelector('.chk-foot').textContent),
        'the job card says who must act next in plain text');
      heldJob.status = heldStatusBefore;
      p.w.render();
    }
  }
  ok($$('#wJobs [disabled]').length === 0, 'no grayed-out control is left in the technician checklist');

  /* outcome guard: success on incomplete job must fail */
  var job = null;
  p.w.Store.db.jobs.forEach(function (j) {
    if (!job && j.status === 'in_progress' && j.items.some(function (i) { return !i.done; })) job = j;
  });
  if (job) {
    var statusBefore = job.status;
    var outBtn = $('#wJobs [data-jobcard="' + job.id + '"] [data-outcome="success"]');
    if (outBtn) {
      outBtn.click();
      $('#mGo').click();
      ok(p.w.Store.getJob(job.id).status === statusBefore && p.w.Store.getJob(job.id).outcome !== 'success',
        'incomplete maintenance cannot be marked successful (SOP 26.1)');
    }
  }
  ok(p.errors.length === 0, 'no errors after technician interactions');
  close(p);
});

tests.push(async function maintenancePage() {
  var p = await open(BASE + 'maintenance.html');
  ok(p.errors.length === 0, 'maintenance page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($$('#sBody tr').length >= 5, 'schedule table populated (' + $$('#sBody tr').length + ')');
  ok($$('#jBody tr').length >= 2, 'job table populated');
  ok($('#jobPanel .info') !== null, 'job detail panel rendered');

  /* manual schedule check  --  the due schedule generates its linked job */
  var n0 = p.w.Store.db.jobs.length;
  $('#btnCheck').click();
  ok($('#checkCard').hidden === false, 'schedule check log appears');
  var log = $('#checkLog').textContent;
  ok(/already exists|SCH-2026-035/.test(log), 'existing-job branch surfaced by the check');
  ok(/SCH-2026-018/.test(log), 'due schedule processed by the check');
  ok(p.w.Store.db.jobs.length === n0 + 1, 'schedule check generated exactly one linked job');
  ok(p.w.Store.db.jobs[0].scheduleId === 'SCH-2026-018', 'job linked to its schedule');

  /* second check must NOT duplicate the job */
  p.w.Live.runOnce();
  ok(p.w.Store.db.jobs.length === n0 + 1, 're-check does not duplicate the job (Job already exists?)');

  /* new schedule modal */
  var ns0 = p.w.Store.db.schedules.length;
  $('#btnNewSched').click();
  ok($('.modal-host') !== null, 'new schedule modal opens');
  $('.modal-host [name="office"]').value = 'Library';
  $('.modal-host [name="dueDate"]').value = '2026-12-15';
  $('#mGo').click();
  ok(p.w.Store.db.schedules.length === ns0 + 1, 'schedule saved with office/checklist/due date');

  /* reschedule branch on an open job */
  var job = null;
  p.w.Store.db.jobs.forEach(function (j) { if (!job && ['generated', 'coord_visit'].indexOf(j.status) > -1) job = j; });
  if (job) {
    /* the panel reschedules the *selected* job  --  select it first */
    var row = $$('#jBody tr[data-job="' + job.id + '"]')[0] || $$('#jBody tr[data-job]')[0];
    if (row) {
      row.click();
      job = p.w.Store.getJob(row.dataset.job);
      var rsBtn = $$('[data-m="resched"]')[0];
      if (rsBtn) {
        rsBtn.click();
        $('.modal-host [name="date"]').value = '2026-11-20';
        $('.modal-host [name="reason"]').value = 'Office unavailable  --  examination week.';
        $('#mGo').click();
        ok(p.w.Store.getJob(job.id).status === 'on_hold', 'Office available? No -> reschedule recorded');
      }
    }
  }
  ok(p.errors.length === 0, 'no errors after maintenance interactions');
  close(p);
});

tests.push(async function maintenancePlanner() {
  var p = await openFeatures(BASE + 'maintenance.html', { maintenancePlanner: true });
  asRole(p, 'coordinator');
  ok($('#plannerCard') !== null, 'the maintenance page carries a planner');
  var days = $$('#plannerBody .pl-day');
  ok(days.length === 42, 'the month view renders six weeks of days (' + days.length + ')');
  ok($$('#plannerBody .pl-head').length === 7, 'the month view names seven weekdays');
  ok($$('#plannerBody .pl-evt').length > 0, 'schedules and visits become dated chips');
  ok($('#plannerBody .is-today') !== null, 'today is marked in the month grid');
  ok($('#techToday').hidden === true, 'the technician route panel stays hidden for a coordinator');

  var range0 = $('#plannerRange').textContent;
  $('#pNext').click();
  ok($('#plannerRange').textContent !== range0, 'next moves the planner one month forward');
  $('#pToday').click();
  ok($('#plannerRange').textContent === range0, 'Today returns to the current month');

  $$('[data-pview="week"]')[0].click();
  ok($$('#plannerBody .pl-grid.is-week .pl-day').length === 7, 'the week view renders seven days');
  ok(/#|to/.test($('#plannerRange').textContent), 'the week range names both ends');
  $$('[data-pview="agenda"]')[0].click();
  ok($$('#plannerBody .pl-agenda-row').length > 0, 'the agenda lists the dated items');
  ok($$('#plannerBody .pl-agenda-day').length > 0, 'the agenda groups rows by day');
  ok(p.w.localStorage.getItem('itc_planner_view') === 'agenda', 'the planner view is remembered');

  asRole(p, 'technician');
  ok($('#techToday').hidden === false, 'the technician sees Today on your route');
  ok($('#techToday').textContent.indexOf('Today on your route') > -1, 'the route panel is titled for the technician');
  ok(p.errors.length === 0, 'no errors from the planner' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  close(p);
});

tests.push(async function reportsPage() {
  var p = await open(BASE + 'reports.html');
  ok(p.errors.length === 0, 'reports page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  var total = p.w.Store.db.tickets.length;
  ok($$('#rBody tr').length === total, 'report lists every ticket initially (' + total + ')');
  ok($$('#rKpi .kpi').length === 4, 'report KPIs render');
  ok($$('#rStatus .hbar, #rStatus .bar').length === 8, 'status distribution has 8 statuses');
  ok($$('#rWork .hbar, #rWork .bar').length >= 2, 'workload chart has technicians');

  /* office filter */
  setVal(p, $('#fOffice'), 'Registrar');
  var rows = $$('#rBody tr');
  ok(rows.length > 0 && rows.length < total, 'office filter narrows results (' + rows.length + '/' + total + ')');
  ok($('#rBody').textContent.indexOf('Registrar') > -1 && $('#rBody').textContent.indexOf('Library') === -1,
    'filtered rows only contain the selected office');

  /* status filter */
  setVal(p, $('#fStatus'), 'closed');
  ok($$('#rBody tr').length <= rows.length, 'status filter stacks with office filter');

  /* cancelled not counted as completed */
  setVal(p, $('#fOffice'), ''); setVal(p, $('#fStatus'), 'cancelled');
  ok($('#rKpi').textContent.indexOf('Cancelled') > -1, 'cancelled totals reported separately');
  ok(p.errors.length === 0, 'no errors after filtering');

  /* the printed copy carries every filtered row, not the page on screen */
  setVal(p, $('#fStatus'), '');
  p.w.Store.update(function (db) {
    for (var k = 0; k < 8; k++) db.tickets.push(JSON.parse(JSON.stringify(db.tickets[0])));
  });
  var onScreen = $$('#rBody tr').length;
  var allRows = p.w.Store.db.tickets.length;
  var captured = -1;
  p.w.print = function () { captured = $$('#rBody tr').length; };
  $('#fPrint').click();
  ok(onScreen < allRows, 'the screen shows one page of a longer register (' + onScreen + ' of ' + allRows + ')');
  ok(captured === allRows, 'the printed copy lists every row (' + captured + ')');
  ok($$('#rBody tr').length === onScreen, 'the screen goes back to its page after printing');
  ok($('#rPrintDoc').textContent.indexOf('University of the Philippines Cebu') > -1,
    'the printed copy carries the UP Cebu letterhead');
  ok(p.errors.length === 0, 'no errors after the print pass');
  close(p);
});

tests.push(async function flowPage() {
  var p = await open(BASE + 'flow.html');
  ok(p.errors.length === 0, 'flowchart page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($$('#lanes .lane').length === 4, 'all 4 swimlanes rendered');
  ok($$('#lanes .node').length >= 70, 'every flowchart node rendered (' + $$('#lanes .node').length + ')');
  ok($$('#lanes .active-node').length >= 5, 'live state highlighting active on seeded data');
  ok($$('#edgeBody tr').length >= 70, 'connector table complete (' + $$('#edgeBody tr').length + ' edges)');

  /* edge filter */
  var q = $('#edgeQ');
  q.value = 'cannot proceed';
  q.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  var filtered = $$('#edgeBody tr').length;
  ok(filtered > 0 && filtered < 90, 'edge filter works (' + filtered + ' rows)');
  q.value = ''; q.dispatchEvent(new p.w.Event('input', { bubbles: true }));

  /* coverage proof: every flowchart node maps to a real implementation */
  var covRows = $$('#covBody tr');
  var done = covRows.filter(function (tr) {
    var m = tr.querySelector('.ok-mark');
    if (!m) return false;
    /* the mark is the shared check icon (an inline svg), not an emoji */
    return m.querySelector('svg') !== null || m.textContent.indexOf('\u2713') > -1;
  }).length;
  ok(covRows.length >= 70, 'coverage proof lists every non start/end node (' + covRows.length + ')');
  ok(done === covRows.length, 'coverage proof: every node implemented (' + done + '/' + covRows.length + ')');
  var counter = ($('#covCount').textContent.match(/(\d+)\s*\/\s*(\d+)/) || []);
  ok(counter[1] && counter[1] === counter[2], 'coverage counter reads N / N: ' + $('#covCount').textContent);

  /* the lane filter belongs to a swimlane: no lane means no button, not a grayed one */
  var mineBtn = $('#laneMine');
  ok(mineBtn !== null && mineBtn.hidden === false && mineBtn.disabled === false,
    'a lane role gets a working lane filter');
  asRole(p, 'management');
  p.w.render();
  ok($('#laneMine').hidden === true && $('#laneMine').disabled === false,
    'the administrator gets no lane filter button (scope 5: no swimlane)');
  close(p);
});

tests.push(async function pwaShell() {
  /* the installable PWA: the manifest, the service worker and the offline page */
  var man = null;
  try {
    var res = await fetch(BASE + 'manifest.webmanifest');
    man = JSON.parse(await res.text());
  } catch (e) { }
  ok(man !== null, 'the manifest is valid JSON');
  if (man) {
    ok(man.name && man.short_name, 'the manifest names the app');
    ok(man.start_url === '/login.html', 'the installed app opens at the sign-in page (start_url)');
    ok(man.display === 'standalone', 'the app installs in its own window');
    ok(Array.isArray(man.icons) && man.icons.length > 0, 'the manifest carries the icons');
    /* An installer needs a real bitmap: an SVG alone is not accepted by every
       platform, so the PNG pair and a maskable variant have to be listed. */
    var pngs = (man.icons || []).filter(function (i) { return i.type === 'image/png'; });
    ok(pngs.some(function (i) { return i.sizes === '192x192' && i.purpose === 'any'; }),
       'the manifest lists a 192 px PNG');
    ok(pngs.some(function (i) { return i.sizes === '512x512' && i.purpose === 'any'; }),
       'the manifest lists a 512 px PNG');
    ok(pngs.some(function (i) { return (i.purpose || '').indexOf('maskable') > -1; }),
       'the manifest lists a maskable PNG');
    var missing = [];
    for (var n = 0; n < (man.icons || []).length; n++) {
      var src = String(man.icons[n].src).replace(/^\//, '');
      var okFetch = false;
      try { okFetch = (await fetch(BASE + src)).status === 200; } catch (e) { }
      if (!okFetch) missing.push(man.icons[n].src);
    }
    ok(missing.length === 0, 'every icon the manifest lists is served' +
       (missing.length ? ' (missing ' + missing.join(', ') + ')' : ''));
  }

  var swText = '';
  try { swText = await (await fetch(BASE + 'sw.js')).text(); } catch (e) { }
  ok(swText.length > 0, 'the service worker loads');
  ok(swText.indexOf('login.html') > -1, 'the service worker precaches the sign-in page');
  ok(swText.indexOf('offline.html') > -1, 'the service worker carries the offline fallback');

  var p = await open(BASE + 'offline.html');
  ok(p.errors.length === 0, 'the offline page loads with no errors');
  close(p);
});

tests.push(async function gallery() {
  /* The development gallery is out of scope by default. Its address answers
     with the neutral screen and offers the sign-in page instead. */
  var off = await open(BASE + 'index.html');
  ok(off.errors.length === 0, 'the gallery route loads with no errors' + (off.errors.length ? ' -> ' + off.errors.join(' | ') : ''));
  ok(off.d.body.classList.contains('access-denied'), 'the gallery is closed by default');
  var panel = off.d.getElementById('galleryClosed');
  ok(panel !== null && panel.hidden === false, 'the gallery route shows the neutral screen');
  ok(panel.textContent.indexOf('This page is not available') > -1, 'the neutral screen is titled');
  close(off);

  /* The owner can restore it by turning its flag on. */
  var on = await openFeatures(BASE + 'index.html', { designGallery: true });
  ok(on.errors.length === 0, 'the gallery route loads with its flag on');
  ok(!on.d.body.classList.contains('access-denied'), 'the gallery is open when its flag is on');
  ok($$('a.g-card').length >= 20, 'the gallery lists every screen when its flag is on');
  close(on);
});

tests.push(async function scopeDefaults() {
  /* Every optional extra is off in the committed registry, so the register,
     the schedule page and the dashboard carry no trace of it. */
  var t = await open(BASE + 'tickets.html');
  asRole(t, 'coordinator');
  ok(t.errors.length === 0, 'tickets loads with the registry defaults');
  ok(t.d.querySelector('#tkView [data-view="board"]') === null, 'the board layout is absent by default');
  ok(t.d.getElementById('tkBoard') === null, 'the board container is absent by default');
  ok(t.d.getElementById('tbSearch') === null, 'the desktop palette trigger is absent by default');
  ok(t.d.getElementById('tbSearchMobile') === null, 'the phone palette trigger is absent by default');
  t.d.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  ok(t.d.getElementById('cmdk') === null, 'Ctrl plus K does not open a palette by default');
  t.w.UI.openPalette('Library');
  ok(t.d.getElementById('cmdk') === null, 'the palette API stays closed by default');
  close(t);

  var b = await open(BASE + 'tickets.html?view=board');
  asRole(b, 'coordinator');
  ok(b.d.getElementById('tkTable').hidden === false, 'a board deep link falls back to the list by default');
  ok(b.d.getElementById('tkBoard') === null, 'a board deep link creates no board container');
  close(b);

  var m = await open(BASE + 'maintenance.html');
  asRole(m, 'coordinator');
  ok(m.errors.length === 0, 'maintenance loads with the registry defaults');
  ok(m.d.getElementById('plannerCard') === null, 'the maintenance planner is absent by default');
  close(m);

  var d = await open(BASE + 'dashboard.html');
  asRole(d, 'coordinator');
  ok(d.errors.length === 0, 'dashboard loads with the registry defaults');
  ok(d.d.querySelectorAll('#kpiGrid .spark').length === 0, 'the KPI sparklines are absent by default');
  ok(d.d.querySelector('[data-popups]') === null, 'the notification pop-up toggle is absent by default');
  close(d);
});

tests.push(async function scopeConveniences() {
  /* Conveniences that neither the PDF nor the screenshots carry stay off
     until the owner asks for them. Each one is restorable from its flag. */
  var tk = await open(BASE + 'ticket.html?id=IT-2026-000142');
  asRole(tk, 'coordinator');
  ok(tk.errors.length === 0, 'ticket detail loads with the registry defaults');
  ok(tk.d.getElementById('tPickerBar') === null, 'the ticket chooser is absent by default');
  ok(tk.d.getElementById('tPick') === null && tk.d.getElementById('tSearch') === null,
    'the ticket chooser leaves no controls behind');
  close(tk);

  var rq = await open(BASE + 'request.html');
  asRole(rq, 'requester');
  ok(rq.errors.length === 0, 'intake loads with the registry defaults');
  ok(rq.d.getElementById('fIdempotencyField').hidden === true,
    'the duplicate protection key is hidden by default');
  ok(rq.d.body.textContent.indexOf('chat notes') === -1,
    'the intake form no longer mentions chat notes');
  close(rq);

  var st = await open(BASE + 'settings.html');
  asRole(st, 'management');
  ok(st.errors.length === 0, 'settings loads with the registry defaults');
  ok(st.d.querySelector('[name="simulate"]').tagName === 'INPUT' &&
     st.d.querySelector('[name="simulate"]').type === 'hidden',
    'the demo simulation switch is a hidden value by default');
  ok(st.d.getElementById('opSettings').textContent.indexOf('Simulation (demo intake)') === -1,
    'Configuration shows no simulation switch by default');
  close(st);

  var pf = await open(BASE + 'profile.html');
  asRole(pf, 'coordinator');
  ok(pf.errors.length === 0, 'profile loads with the registry defaults');
  ok(pf.d.getElementById('passwordCard') === null, 'the password card is absent by default');
  ok(pf.d.body.textContent.indexOf('Change password') === -1,
    'the profile page does not advertise a password change by default');
  close(pf);

  /* Turning a flag on restores the same surface. */
  var tkOn = await openFeatures(BASE + 'ticket.html?id=IT-2026-000142', { ticketJumpPicker: true });
  ok(tkOn.d.getElementById('tPickerBar') !== null, 'the ticket chooser returns when its flag is on');
  close(tkOn);

  var rqOn = await openFeatures(BASE + 'request.html', { requestIdempotencyField: true });
  ok(rqOn.d.getElementById('fIdempotencyField').hidden === false,
    'the duplicate protection field returns when its flag is on');
  close(rqOn);

  var stOn = await openFeatures(BASE + 'settings.html', { demoIntakeSimulation: true });
  asRole(stOn, 'management');
  ok(stOn.d.querySelector('[name="simulate"]').tagName === 'SELECT',
    'the simulation switch returns when its flag is on');
  close(stOn);

  /* The registry gates the behaviour, not only the control: with the flag off,
     turning the stored switch on must not invent an intake record. */
  var simOff = await open(BASE + 'dashboard.html');
  simOff.w.Math.random = function () { return 0; };
  simOff.w.Store.update(function (db) { db.settings.simulate = true; db.lastSim = 0; });
  var simN0 = simOff.w.Store.db.tickets.length;
  for (var simI = 0; simI < 5; simI++) {
    simOff.w.Store.db.lastSim = 0;
    simOff.w.Live.runOnce();
  }
  ok(simOff.w.Store.db.tickets.length === simN0,
    'no simulated intake arrives while the registry flag is off');
  close(simOff);

  var simOn = await openFeatures(BASE + 'dashboard.html', { demoIntakeSimulation: true });
  simOn.w.Math.random = function () { return 0; };
  simOn.w.Store.update(function (db) { db.settings.simulate = true; db.lastSim = 0; });
  var beforeSim = simOn.w.Store.db.tickets.length;
  simOn.w.Store.db.lastSim = 0;
  simOn.w.Live.runOnce();
  ok(simOn.w.Store.db.tickets.length === beforeSim + 1,
    'the simulated intake works again when its flag is on');
  close(simOn);

  var pfOn = await openFeatures(BASE + 'profile.html', { profilePasswordChange: true });
  ok(pfOn.d.getElementById('passwordCard') !== null, 'the password card returns when its flag is on');
  close(pfOn);

  var dOn = await openFeatures(BASE + 'dashboard.html', { notificationPopupsToggle: true });
  asRole(dOn, 'coordinator');
  ok(dOn.d.querySelector('[data-popups]') !== null, 'the pop-up toggle returns when its flag is on');
  close(dOn);
});

tests.push(async function login() {
  var p = await open(BASE + 'login.html');
  ok(p.errors.length === 0, 'login loads with no script errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($('#googleBtn') !== null, 'Login with UPMail button present');
  ok($('input[type="password"]') === null, 'no password field  --  UPMail-only sign-in');
  ok($('input[type="email"]') === null, 'no email field  --  UPMail-only sign-in');
  /* the split card: glass hero on the left, off-white panel on the right */
  ok($$('.lp-card').length === 1, 'one split sign-in card');
  ok($('.lp-hero') !== null && $('.lp-panel') !== null, 'the card has a glass hero and a sign-in panel');
  ok(/University of the Philippines Cebu/i.test($('.lp-pill').textContent),
     'the hero carries the UP Cebu badge');
  ok(/Maintenance Management/i.test($('#lpHeadline').textContent) &&
     /from request to closure/i.test($('#lpHeadline').textContent),
     'the hero states the headline');
  ok($$('.lp-tiles li').length === 3 &&
     $('.lp-tiles').textContent.indexOf('Live') > -1 &&
     $('.lp-tiles').textContent.indexOf('Secure') > -1 &&
     $('.lp-tiles').textContent.indexOf('Fast') > -1,
     'the hero lists the Live, Secure and Fast tiles');
  ok($$('.lp-seals img').length === 2, 'both university seals are on the panel');
  ok(/Welcome back/i.test($('.lp-panel h2').textContent), 'the panel welcomes the person back');
  ok(/IT Service and Maintenance Management System/i.test($('.lp-system').textContent),
     'the panel carries the system subtitle');
  ok(/UPMail/.test($('.lp-hint').textContent), 'the helper line names UPMail');
  ok(/@upcebu\.edu\.ph/.test($('.lp-domain').textContent),
     'the domain restriction is stated on the page');
  /* the demo list is part of the page on every host, with no flag injected */
  ok($('#demoBlock').hidden === false, 'the demo list is on the sign-in page by default');
  var accts = $$('#demoAccounts [data-acct]');
  ok(accts.length === 4, 'one demo account per role is listed (' + accts.length + ')');
  var btn = $('#googleBtn');
  btn.click();
  ok($('#loginError').hidden === false, 'sign-in without configured OIDC explains the problem');
  ok($('#demoBlock').hidden === false, 'the demo list stays visible after the UPMail click');
  /* theme switch works on the sign-in screen */
  var themes = $$('#themeSwitch [data-theme-choice]');
  ok(themes.length === 3, 'the sign-in page offers light, system and dark themes');
  themes[2].click();
  ok(p.w.document.documentElement.getAttribute('data-theme') === 'dark',
     'the dark choice applies immediately');
  accts[2].click();  /* the IT Coordinator account */
  ok(p.w.Store.db.auth !== null && typeof p.w.Store.db.auth === 'object', 'demo sign-in stores the account');
  ok(p.w.Store.db.auth.role === 'coordinator', 'the demo account maps to its role');
  ok(p.w.Store.db.role === 'coordinator', 'demo sign-in scopes the active role');
  close(p);
});

/* The attachment viewer: a chip opens the file in place, and the viewer
   says plainly when the bytes are not there. */
tests.push(async function attachmentViewer() {
  var p = await open(BASE + 'ticket.html?id=IT-2026-000142');
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'ticket loads for the attachment viewer test');
  var chips = $$('#tAttachmentList .chip-file');
  ok(chips.length > 0, 'the attachment list draws a chip (' + chips.length + ')');
  ok(chips.length > 0 && chips[0].tagName === 'BUTTON', 'the chip is a button, not a dead link');
  /* the kinds the viewer knows */
  ok(p.w.UI.attachmentKind('image/jpeg', 'a.jpg') === 'image', 'a jpeg is an image');
  ok(p.w.UI.attachmentKind('video/mp4', 'a.mp4') === 'video', 'an mp4 is a video');
  ok(p.w.UI.attachmentKind('video/quicktime', 'a.mov') === 'video', 'a quicktime movie is a video');
  ok(p.w.UI.attachmentKind('application/pdf', 'a.pdf') === 'pdf', 'a pdf is a pdf');
  ok(p.w.UI.attachmentKind('text/csv', 'a.csv') === 'text', 'a csv is a text file');
  ok(p.w.UI.humanSize(2048) === '2 KB', 'a size reads in KB');
  /* open it */
  if (chips.length) {
    var chipName = chips[0].textContent.replace(/\s+/g, ' ').trim();
    chips[0].click();
    var host = $('.viewer-host');
    ok(host !== null, 'the chip opens the attachment viewer');
    ok(host && host.querySelector('.viewer-card') !== null, 'the viewer draws a card');
    ok(host && host.textContent.indexOf(chipName) > -1, 'the viewer names the file (' + chipName + ')');
    /* no bytes here (the browser keeps only the name), so it says so */
    ok(host && (host.textContent.indexOf('not kept in this browser') > -1 ||
                host.querySelector('.viewer-media') !== null),
       'the viewer either shows the file or says the bytes are not here');
    if (host) {
      var x = host.querySelector('.viewer-close');
      if (x) x.click();
      ok($('.viewer-host') === null, 'the viewer closes');
    }
  }
  ok(p.errors.length === 0, 'no errors from the attachment viewer');
  close(p);
});

tests.push(async function rolesPage() {
  /* The standalone matrix is not reachable from navigation, so its address
     answers with the neutral screen. The permission map itself is unchanged. */
  var off = await open(BASE + 'roles.html');
  ok(off.errors.length === 0, 'roles route loads with no errors' + (off.errors.length ? ' -> ' + off.errors.join(' | ') : ''));
  ok(off.d.body.classList.contains('access-denied'), 'the roles reference is closed by default');
  ok(off.d.getElementById('accessPanel') !== null, 'the roles route shows the neutral screen');
  ok(off.d.getElementById('accessPanel').textContent.indexOf('This page is not available') > -1,
    'the neutral screen is titled');
  close(off);

  var on = await openFeatures(BASE + 'roles.html', { rolesReferencePage: true });
  ok(on.errors.length === 0, 'roles route loads with its flag on');
  ok($$('.role-card').length === 4, 'four role cards rendered when the flag is on');
  ok($$('#capBody tr').length >= 20, 'feature matrix rendered when the flag is on (' + $$('#capBody tr').length + ' rows)');
  ok($('#myRoleCard').textContent.indexOf('features unlocked') > -1, 'your-role summary shown');
  ok($('#adminCard').textContent.indexOf('Review role assignments') > -1, 'roles and access reference visible when the flag is on');
  close(on);
});

tests.push(async function roleNav() {
  var p = await open(BASE + 'dashboard.html');
  var nav = function () {
    return $$('.side-link[href]').map(function (a) { return a.textContent.replace(/\s+/g, ' ').trim(); });
  };
  /* The Workflow Guide is shared by every signed-in lane, so it is listed for
     all four roles.  The roles and access reference stays behind its registry
     flag and out of the navigation. */
  ['requester', 'technician', 'coordinator', 'management'].forEach(function (r) {
    asRole(p, r);
    var refs = nav().join('|');
    ok(refs.indexOf('Workflow Guide') > -1, r + ' lists the workflow guide');
    ok(refs.indexOf('Roles and Access') === -1, r + ' does not list the roles and access reference');
  });
  asRole(p, 'coordinator');
  var n0 = nav().length;
  ok(n0 >= 7, 'coordinator sees the full navigation (' + n0 + ')');
  var c0 = nav().join('|');
  ok(c0.indexOf('My Tickets') === -1, 'My Tickets is the technician lane  --  hidden from the coordinator');
  asRole(p, 'requester');
  var labels = nav().join('|');
  ok(nav().length < n0, 'requester sees fewer nav items than the coordinator');
  ok(labels.indexOf('My Maintenance Jobs') === -1, 'requester cannot see the technician workspace');
  var reqHrefs = $$('.side-link[href]').map(function (a) { return a.getAttribute('href'); });
  ok(reqHrefs.every(function (h) { return String(h).indexOf('maintenance.html') === -1; }),
    'requester cannot see the maintenance workspace');
  ok(labels.indexOf('Maintenance Visits') > -1, 'requester sees the read-only maintenance visits');
  asRole(p, 'management');
  var m = nav().join('|');
  ok(m.indexOf('New Request') === -1, 'management cannot submit requests');
  ok(m.indexOf('Roles and Access') === -1, 'the reference pages stay out of the sidebar');
  ok(m.indexOf('Workflow Guide') > -1, 'the administrator also sees the workflow guide');
  /* Role scope 5: Administration plus the read-only audit viewer, nothing else. */
  ok(m.indexOf('Maintenance') === -1, 'the administrator lane holds no maintenance screen');
  ok(m.indexOf('Service Records') === -1 && m.indexOf('Tickets') === -1,
     'the administrator lane holds no ticket screen');
  ok(m.indexOf('Office Register') === -1, 'the administrator lane holds no register');
  ok(m.indexOf('Reports') === -1, 'the administrator lane holds no reports');
  ok(m.indexOf('Dashboard') === -1, 'the administrator lane has no dashboard');
  ok(m.indexOf('Users') > -1 && m.indexOf('Offices') > -1 &&
     m.indexOf('Configuration') > -1 && m.indexOf('Audit Log') > -1,
     'the administrator keeps Administration and the audit viewer (' + m + ')');
  ok(p.errors.length === 0, 'no errors switching roles');
  close(p);
});

tests.push(async function navGroupsNeverEmpty() {
  var p = await open(BASE + 'dashboard.html');
  ['requester', 'technician', 'coordinator', 'management'].forEach(function (role) {
    asRole(p, role);
    var groups = $$('#chromeSide .side-group-wrap');
    ok(groups.length > 0, role + ': the sidebar renders groups (' + groups.length + ')');
    ok(groups.every(function (g) { return g.querySelectorAll('.side-link[href]').length > 0; }),
      role + ': no sidebar group renders empty');
    ok($$('#chromeSide .side-link[href]').length >= 5,
      role + ': the sidebar renders destinations (' + $$('#chromeSide .side-link[href]').length + ')');
    ok($('#chromeSide .ctx') === null, role + ': the old contextual column is gone');
  });
  ok(p.errors.length === 0, 'no errors across role navigation');
  close(p);
});

tests.push(async function strictLanes() {
  /* technician must not reach the intake screen (Office Requester/Coordinator lane) */
  var p = await open(BASE + 'request.html');
  asRole(p, 'technician');
  ok($('#accessPanel') !== null, 'technician is blocked from New Request');
  var r = p.w.Flow.createTicket({ office: 'HR', requester: 'X', category: 'Hardware Repair', issue: 'x' });
  ok(r.ok === false, 'flow guard also blocks a technician ticket (defence in depth)');
  close(p);

  /* coordinator must not reach the technician workbench */
  var p2 = await open(BASE + 'technician.html');
  asRole(p2, 'coordinator');
  ok($('#accessPanel') !== null, 'coordinator is blocked from My Work');
  close(p2);
});

tests.push(async function maintenanceRoles() {
  var p = await open(BASE + 'maintenance.html');
  asRole(p, 'technician');
  ok($('#schedControls').hidden === true, 'technician sees no schedule-creation controls');
  ok($$('[data-m="avail"]').length === 0, 'the technician does not own the office availability answer');
  ok($$('[data-m="success"]').length > 0, 'the technician can complete the visit and request confirmation');
  asRole(p, 'management');
  ok($('#schedControls').hidden === true, 'management sees no schedule-creation controls');
  ok($$('[data-m]').length === 0, 'management sees no workflow action buttons (read-only)');
  ok($('#jobPanel .info') !== null, 'management still reads the job detail');
  asRole(p, 'coordinator');
  ok($('#schedControls').hidden === false, 'coordinator sees the schedule controls');
  ok(p.errors.length === 0, 'no errors switching maintenance roles');
  close(p);
});

tests.push(async function dashboardActivity() {
  /* Appendix E.3: the activity chart, the timeframe selector and the
     breakdown tables. */
  var p = await open(BASE + 'dashboard.html');
  ok($('#actRange') !== null, 'the dashboard carries a timeframe selector');
  var ranges = $$('#actRange option').map(function (o) { return o.textContent; });
  ok(ranges.join(',') === 'Last 7 days,Last 30 days,Last 90 days,This month,Custom range',
     'the timeframe selector offers the documented periods');
  ok($('#actRefresh') !== null, 'the activity panel has a refresh control');
  ok($('#actExport') !== null, 'the activity panel has an export control');
  ok($('#actChart .cols') !== null, 'the activity chart is drawn');
  ok($$('#actChart .col-day').length > 0, 'the chart has a column per day');
  ok($$('#actChart .legend-line span').length === 4, 'the chart legend names the four series');
  ok($('#actTableWrap') !== null && $('#actTableWrap').hidden === true, 'the data table starts hidden');
  $('#actTable').click();
  ok($('#actTableWrap').hidden === false, 'the data table alternative can be shown');
  ok($('#actTableWrap table tbody tr') !== null, 'the data table carries the daily rows');

  /* the summary tiles: four role tiles, then the eight statuses plus Overdue */
  var tiles = $$('#kpiGrid .kpi .label').map(function (e) { return e.textContent; });
  ok(tiles.length === 4, 'the dashboard shows four role-focused tiles (' + tiles.length + ')');
  var strip = $$('#statusStrip .status-bit');
  ok(strip.length === 9, 'the status strip shows the eight statuses plus Overdue (' + strip.length + ')');
  ok(strip.some(function (e) { return /Overdue/.test(e.textContent); }), 'the Overdue link is present');
  ok(strip.every(function (e) { return e.getAttribute('href'); }),
     'every status in the strip links to its filtered queue');

  /* the breakdown tabs */
  ok($$('#bdTabs .tab').length === 3, 'the breakdown has three tabs');
  ok($$('#panel-office table thead th').length === 10, 'the office table carries the documented columns');
  var cols = $$('#panel-office table thead th').map(function (e) { return e.textContent; });
  ok(cols.join(',') === 'Office,Submitted,Assigned,Overdue,Resolved,Closed,Cancelled,Recurring,Avg turnaround,Avg time to assignment',
     'the breakdown columns match the specification (' + cols.join(',') + ')');
  $('#tab-technician').click();
  ok($('#panel-technician').hidden === false && $('#panel-office').hidden === true, 'the breakdown tabs switch the panel');
  ok(p.errors.length === 0, 'no errors on the dashboard');
  close(p);
});

tests.push(async function dashboardWidgets() {
  /* Section 25.5A: the seven day sparkline on every highlight, the office
     health strip, the technician load bars and the compliance ring. */
  var p = await openFeatures(BASE + 'dashboard.html', { dashboardKpiSparklines: true });
  asRole(p, 'coordinator');
  p.w.render();

  var sparks = $$('#kpiGrid .kpi .spark');
  ok(sparks.length === 4, 'every highlight carries a sparkline (' + sparks.length + ')');
  ok(sparks.every(function (s) { return s.querySelector('.spark-line') && s.querySelector('.spark-area'); }),
     'each sparkline draws a line and a filled area');
  ok($$('#kpiGrid .spark-wrap[title]').length === 4, 'each sparkline names the series it counts');

  var hcards = $$('#healthStrip .health-card');
  ok(hcards.length === 6, 'the health strip lists one card per office (' + hcards.length + ')');
  ok(hcards.every(function (c) { return /tickets\.html\?office=/.test(c.getAttribute('href')); }),
     'each office card opens the register filtered to that office');
  var overdue = hcards.map(function (c) {
    return parseInt(/(\d+) overdue/.exec(c.querySelector('.health-nums').textContent)[1], 10);
  });
  ok(overdue.join(',') === overdue.slice().sort(function (a, b) { return b - a; }).join(','),
     'the offices with the most overdue work come first (' + overdue.join(',') + ')');
  ok(hcards.every(function (c) { return /^(ok|warn|danger)$/.test(c.getAttribute('data-tone')); }),
     'each office states a risk tone');
  ok(hcards.every(function (c) {
    return /width:\s*[\d.]+%/.test(c.querySelector('.health-meter i').getAttribute('style'));
  }), 'each office draws a completion meter');

  var load = $$('#workloadBars .hbar');
  ok(load.length === 2, 'the load card lists each technician holding open work (' + load.length + ')');
  ok(load.some(function (r) { return /Unassigned/.test(r.textContent); }),
     'unassigned work is named, not hidden');
  ok(load.every(function (r) { return r.querySelectorAll('.wl-seg').length > 0; }),
     'each load bar is split by stage');
  var total = parseInt(load[0].querySelector('.hbar-num').textContent, 10);
  var segs = Array.prototype.map.call(load[0].querySelectorAll('.wl-seg'), function (s) {
    return parseInt(s.getAttribute('title'), 10);
  });
  ok(segs.reduce(function (a, b) { return a + b; }, 0) === total,
     'the stage segments add up to the printed total');

  var gauge = $('#complianceGauge .gauge');
  ok(gauge !== null, 'preventive compliance is drawn as a ring');
  var num = $('#complianceGauge .g-num').textContent;
  ok(/^\d+%$/.test(num), 'the ring prints its value (' + num + ')');
  ok(gauge.getAttribute('aria-label').indexOf(parseInt(num, 10) + ' percent') > -1,
     'the ring carries the same value to assistive technology');
  ok($('#healthStrip').classList.contains('staff-only'),
     'the health strip is limited to IT staff');
  ok($('#complianceGauge').closest('section').classList.contains('staff-only'),
     'preventive compliance follows the same staff scope');
  ok($('#workloadBars').closest('section').classList.contains('lead-only'),
     'technician load is limited to the roles that dispatch work');

  /* an office user is one office by design, so the cross office strip goes */
  asRole(p, 'requester');
  p.w.render();
  ok($('#healthStrip').hidden === true,
     'an office user does not see the cross office health strip');
  ok(p.errors.length === 0, 'no errors from the dashboard widgets' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  close(p);
});

tests.push(async function nextActionOwner() {
  /* Section 4A.3: a "Needs my action" queue per role and a "Waiting on"
     label on every ticket, matching the owner table. */
  var p = await open(BASE + 'dashboard.html');
  ok($('#mineList') !== null, 'the dashboard carries a Needs my action queue');
  ok($('#mineCount') !== null, 'the queue is counted');

  var OWNER = {
    submitted: 'IT Coordinator', needs_info: 'Office Requester', assigned: 'IT Technician',
    in_progress: 'IT Technician', on_hold: 'IT Coordinator', resolved: 'Office Requester',
    closed: 'Nobody', cancelled: 'Nobody'
  };

  asRole(p, 'coordinator');
  var mine = $('#mineList').textContent;
  ok(/Submitted|Needs Information/i.test(mine) || mine.length > 0, 'the coordinator queue lists the records waiting on it');
  var labels = $$('#queueBody .chip-waiting').map(function (el) { return el.textContent; });
  ok(labels.length > 0, 'every queued ticket carries a Waiting on label');
  ok(labels.every(function (l) { return /^Waiting on: (IT Coordinator|Office Requester|IT Technician|Nobody)$/.test(l.trim()); }),
     'the Waiting on label names a role: ' + JSON.stringify(labels.slice(0, 3)));

  /* the label must match the owner table for every status */
  var st = p.w.Store.db.tickets;
  var bad = st.filter(function (t) {
    var want = 'Waiting on: ' + OWNER[t.status];
    return p.w.UI.nextOwner(t.status).label !== OWNER[t.status] ||
           p.w.UI.waitingOn(t.status).indexOf(want) === -1;
  });
  ok(bad.length === 0, 'the next action owner matches the table for every status' + (bad.length ? ' -> ' + bad.map(function (t) { return t.id + ':' + t.status; }).join(',') : ''));

  /* the technician queue is theirs alone */
  asRole(p, 'technician');
  var tq = $('#mineList').textContent;
  ok(tq.length > 0, 'the technician queue lists the assigned work');
  close(p);
});

tests.push(async function roleScoping() {
  /* the audit viewer is an administration screen (specification 4A.2) */
  var pa = await open(BASE + 'audit.html');
  asRole(pa, 'coordinator');
  ok($('#accessPanel') !== null, 'the coordinator is blocked from the audit viewer');
  close(pa);

  /* Role scope 5: the administrator lane is Administration plus the audit
     viewer, so every operational screen refuses it with the neutral panel. */
  var ADMIN_DENIED = ['dashboard.html', 'tickets.html', 'register.html',
                      'reports.html', 'maintenance.html'];
  for (var adi = 0; adi < ADMIN_DENIED.length; adi++) {
    var pd = await open(BASE + ADMIN_DENIED[adi]);
    asRole(pd, 'management');
    ok($('#accessPanel') !== null,
       'the administrator is blocked from ' + ADMIN_DENIED[adi]);
    ok($('#accessPanel').textContent.indexOf('This page is not available') > -1,
       ADMIN_DENIED[adi] + ' gives the administrator a neutral explanation');
    close(pd);
  }
  var pun = await open(BASE + 'users.html');
  asRole(pun, 'management');
  ok($('#accessPanel') === null, 'the administrator still opens the users directory');
  ok($('#uBody') !== null, 'the users directory renders for the administrator');
  close(pun);

  /* the policy controls live on the administration settings screen */
  var ps = await open(BASE + 'settings.html');
  asRole(ps, 'management');
  ok($('#policySettings') !== null, 'the settings screen carries the policy card');
  ok($$('#policySettings [data-approval]').length > 0, 'the approval categories are configurable');
  ok($$('#policySettings [name^="pm_"]').length === 9, 'the impact and urgency matrix is configurable');
  ok($$('#policySettings [data-closure]').length > 0, 'the authorized closure roles are configurable');

  /* the reminder clock is configured in the open, not in a config file */
  ok($$('#opSettings [data-workday]').length === 7, 'every weekday is offered as a working day');
  ok($('#opSettings [name="holidays"]') !== null, 'the closed dates are editable');
  ok($('#opSettings [name="reminderRepeatDays"]') !== null, 'the repeat interval is configurable');
  ok($('#opSettings [name="reminderMode"]') !== null, 'the reminder clock is selectable');
  $('[data-workday="6"]').checked = true;
  $('[name="holidays"]').value = '2026-12-25, 2027-01-01';
  $('#saveOp').click();
  ok(ps.w.Store.db.settings.workdays.indexOf(6) > -1, 'the workweek keeps the day just ticked');
  ok(ps.w.Store.db.settings.holidays.join(',') === '2026-12-25,2027-01-01',
     'both closed dates are stored');
  ok($('#opSettings').textContent.indexOf('2 date(s) on the calendar') > -1,
     'the screen reports the calendar it saved');
  $('[name="holidays"]').value = '25/12/2026';
  $('#saveOp').click();
  ok(ps.w.Store.db.settings.holidays.length === 2,
     'a date that does not read YYYY-MM-DD is refused');
  $('[name="holidays"]').value = '2026-12-25, 2027-01-01';

  /* the service level window that drives the overdue column is set here too */
  ok($('#opSettings [name="slaDays"]') !== null, 'the service level window is configurable');
  ok($('#opSettings').textContent.indexOf('overdue once it is older than that many days') > -1,
     'the screen says the window counts calendar days');
  $('[name="slaDays"]').value = '9';
  $('#saveOp').click();
  ok(ps.w.Store.db.settings.slaDays === 9, 'the saved window is stored');
  ok(ps.w.Store.db.settings.holidays.length === 2, 'the rest of the card saved with it');
  $('[name="slaDays"]').value = '400';
  $('#saveOp').click();
  ok(ps.w.Store.db.settings.slaDays === 9,
     'a window past a year is refused without half-saving');
  $('[name="slaDays"]').value = '5';
  $('#saveOp').click();
  ok(ps.w.Store.db.settings.slaDays === 5, 'the window is restored for the screens that follow');
  asRole(ps, 'coordinator');
  ok($('#accessPanel') !== null, 'the coordinator is blocked from the system settings');
  close(ps);

  /* the technician records the checklist, the coordinator chases the dependency */
  var pt = await open(BASE + 'technician.html');
  asRole(pt, 'technician');
  ok($$('[data-act="followup"]').length === 0, 'the technician is not offered the dependency follow-up');
  close(pt);
});

tests.push(async function ticketRoleLinks() {
  var p = await open(BASE + 'ticket.html?id=IT-2026-000141');
  asRole(p, 'management');
  ok($('#accessPanel') !== null, 'the administrator is blocked from the ticket record (scope 5)');
  asRole(p, 'coordinator');
  p.w.render();
  ok($('#tActions a[href^="ic-confirm.html"]') !== null,
    'coordinator gets the confirmation link in their own lane');
  asRole(p, 'requester');
  p.w.render();
  ok($('#tActions a[href^="or-confirm.html"]') !== null,
    'requester gets the confirmation link in their own lane');
  /* The next-step selector sends the reader to the screen that records the
     move, and it stays inside the lane the reader opened. */
  var moves = $$('#tMove option').map(function (o) { return o.value; })
    .filter(function (v) { return v !== ''; });
  ok(moves.length > 0 && moves.every(function (v) { return /^or-[a-z-]+\.html$/.test(v); }),
    'every move this lane is offered opens in the office lane (' + moves.join(', ') + ')');
  close(p);
});

tests.push(async function accessGuard() {
  var p = await open(BASE + 'maintenance.html');
  ok(p.errors.length === 0, 'maintenance loads with no errors');
  ok($('#accessPanel') === null, 'coordinator can open maintenance (no block)');
  asRole(p, 'requester');
  ok($('#accessPanel') !== null, 'requester is blocked with a friendly panel');
  ok(p.w.document.body.classList.contains('access-denied'), 'denied state applied to the page');
  ok($('#accessPanel').textContent.indexOf('This page is not available') > -1, 'panel gives a neutral explanation');
  close(p);
});

/* Every Phase-C screen must load in each role it belongs to with no script
   error and render its real content (never a silent blank / blocked panel).
   The sentinel is the page's primary container id; a wrong-role load would
   leave it empty or swap in #accessPanel instead. */
var NEW_SCREENS = [
  ['notifications.html', 'coordinator', '#nBody'],
  ['notifications.html', 'requester', '#nBody'],
  ['notifications.html', 'technician', '#nBody'],
  ['notifications.html', 'management', '#nBody'],
  ['audit.html', 'management', '#aBody'],
  ['offices.html', 'management', '#oBody'],
  ['assets.html', 'management', '#aBody'],
  ['users.html', 'management', '#uBody'],
  ['settings.html', 'management', '#refGroups'],
  ['profile.html', 'coordinator', '#pCard'],
  ['profile.html', 'technician', '#pCard'],
  ['register.html', 'requester', '#gBody'],
  ['tickets.html', 'coordinator', '#tkBody'],
  ['tickets.html', 'requester', '#tkBody'],
  ['maintenance.html', 'coordinator', '#sBody'],
  ['reports.html', 'coordinator', '#rBody']
];

tests.push(async function newScreens() {
  for (var i = 0; i < NEW_SCREENS.length; i++) {
    var c = NEW_SCREENS[i], url = c[0], role = c[1], sel = c[2];
    var p = await open(BASE + url);
    asRole(p, role);
    var name = url + ' [' + role + ']';
    ok(p.errors.length === 0, name + ' loads with no script errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
    ok($('#accessPanel') === null, name + ' is not blocked for its own role');
    ok($(sel) !== null, name + ' renders its primary container (' + sel + ')');
    close(p);
  }
});

/* Mobile navigation: the bottom tab bar carries the role's four most used
   destinations and the rest live in the More sheet. */
tests.push(async function mobileNav() {
  var p = await open(BASE + 'dashboard.html');
  asRole(p, 'coordinator');
  var tabs = $$('#chromeBottom a');
  ok(tabs.length === 4, 'bottom tab bar carries four destinations (' + tabs.length + ')');
  var more = $('#bottomMore');
  ok(more !== null, 'bottom bar offers a More entry');
  if (more) {
    more.click();
    var sheet = $('.more-sheet');
    ok(sheet !== null, 'More sheet opens');
    if (sheet) {
      var items = sheet.querySelectorAll('.more-item');
      ok(items.length > 0, 'More sheet lists the remaining destinations (' + items.length + ')');
      var hrefs = [];
      items.forEach(function (a) { hrefs.push(a.getAttribute('href')); });
      ok(hrefs.some(function (h) { return /(^|\/)(or-|itc-|ic-|mgmt-)?register\.html$/.test(h); }),
        'More sheet reaches the service register');
      ok(hrefs.some(function (h) { return /notifications\.html$/.test(h); }),
        'More sheet reaches the notification centre');
      ok(hrefs.some(function (h) { return /profile\.html$/.test(h); }),
        'More sheet reaches the profile');
      /* the workflow guide is shared by every signed-in lane; the roles
         reference stays behind its registry flag */
      ok(hrefs.some(function (h) { return /flow\.html$/.test(h); }),
        'More sheet reaches the workflow guide');
      ok(!hrefs.some(function (h) { return /roles\.html$/.test(h); }),
        'More sheet does not list the roles and access reference');
      /* a destination must never be listed twice */
      var uniq = {};
      var dupes = [];
      hrefs.forEach(function (h) { if (uniq[h]) dupes.push(h); uniq[h] = 1; });
      ok(dupes.length === 0, 'More sheet lists every destination once' +
         (dupes.length ? ' -> ' + dupes.join(', ') : ''));
      /* the sheet must not offer a screen the role may not open */
      ok(hrefs.every(function (h) { return !/users\.html$|offices\.html$|settings\.html$/.test(h); }),
        'More sheet hides the administration screens for the coordinator');
      /* a notice that arrives while the sheet is open would cover it, so it
         waits for the sheet to close */
      var box = $$('.toast-box')[0];
      if (box) box.innerHTML = '';
      p.w.UI.toast('a live notice', 'live');
      ok($$('.toast').length === 0, 'no notice pops up over the More sheet');
      sheet.querySelector('.more-sheet-close').click();
      ok($('.more-sheet') === null, 'More sheet closes');
      ok($$('.toast').length === 1, 'the held notice appears once the sheet closes');
      /* and a notice raised afterwards is not held */
      p.w.UI.toast('another notice', 'ok');
      ok($$('.toast').length === 2, 'a notice after the sheet closes pops up at once');
    }
  }
  ok(p.errors.length === 0, 'no errors on the mobile navigation');
  close(p);
});

/* Regression guard for the reply composer: the public/internal switch must
   render as a real .seg button row with BOTH options for a role that may see
   internal notes (a string-concat precedence bug once swallowed the wrapper
   and the office-facing option). */
tests.push(async function composerSeg() {
  var p = await open(BASE + 'ticket.html?id=IT-2026-000141');
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'ticket loads for the coordinator');
  var seg = $('#tReplySeg');
  ok(seg !== null, 'composer renders the .seg visibility switch');
  ok(seg && seg.querySelectorAll('button').length === 2, 'switch offers both Reply to office and Internal note');
  ok($('#tReplySeg [data-vis="public"]') !== null, 'office-facing reply option present');
  ok($('#tReplySeg [data-vis="internal"]') !== null, 'internal-note option present');
  /* switching re-renders without losing the wrapper */
  var note = $('#tReplySeg [data-vis="internal"]');
  if (note) {
    note.click();
    ok($('#tReplySeg') !== null && $('#tReplySeg [data-vis="public"]') !== null, 'switching visibility keeps the switch intact');
    ok($('#tReplyMode').textContent === 'internal note', 'mode chip reflects the internal selection');
  }
  close(p);
});

/* The register offers the same page as rows or as work-order cards.  The
   card carries the ticket number, subject, status, priority edge, assignee
   and the due chip, and it never leaks an internal reply count to an office
   requester. */
tests.push(async function workOrderCards() {
  var p = await openFeatures(BASE + 'tickets.html', { ticketsBoardView: true });
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'tickets loads for the card view test');
  ok($('#tkView') !== null, 'the register offers a list and card layout switch');
  ok($('#tkCards') !== null && $('#tkCards').hidden === true, 'the card grid starts hidden in list view');
  ok($('#tkTable') !== null && $('#tkTable').hidden === false, 'the table is the default layout');

  var btn = $$('#tkView [data-view="cards"]')[0];
  ok(btn !== undefined, 'the card layout can be chosen');
  if (btn) {
    btn.click();
    ok($('#tkCards').hidden === false, 'the card grid appears in card view');
    ok($('#tkTable').hidden === true, 'the table is hidden in card view');
    var cards = $$('#tkCards .wo-card');
    ok(cards.length > 0, 'cards render for the current page (' + cards.length + ')');
    var c = cards[0];
    ok(c.querySelector('.wo-id') !== null, 'a work card shows the ticket number');
    ok(c.querySelector('.wo-title').textContent.length > 0, 'a work card shows the subject');
    ok(c.querySelector('.wo-office') !== null, 'a work card shows the office');
    ok(c.querySelector('.badge') !== null, 'a work card shows the status chip');
    ok(/wo-p-(low|medium|high|critical)/.test(c.className), 'a work card carries the priority edge');
    ok(c.querySelector('.wo-tech') !== null, 'a work card shows the assignee');
    ok($('#tkBulk').hidden === true, 'bulk selection stays out of the card view');
    $$('#tkView [data-view="list"]')[0].click();
    ok($('#tkTable').hidden === false && $('#tkCards').hidden === true, 'the list layout returns');
  }

  var boardBtn = $$('#tkView [data-view="board"]')[0];
  ok(boardBtn !== undefined, 'the board layout can be chosen');
  if (boardBtn) {
    boardBtn.click();
    ok($('#tkBoard').hidden === false && $('#tkCards').hidden === true && $('#tkTable').hidden === true,
      'the board replaces the table and the cards');
    var cols = $$('#tkBoard .wo-col');
    ok(cols.length === 7, 'the board has six workflow columns plus one archive lane (' + cols.length + ')');
    var names = cols.map(function (c) { return c.querySelector('.wo-col-name').textContent; });
    ok(names[0] === 'Submitted' && names[5] === 'Resolved', 'the open columns run in workflow order');
    ok(/Archive/.test(names[6]) && /Closed/.test(names[6]) && /Cancelled/.test(names[6]),
      'the last lane archives Closed and Cancelled');
    ok(cols[6].tagName === 'DETAILS' && cols[6].hasAttribute('open') === false,
      'the archive lane starts collapsed');
    ok(cols.every(function (c) { return /^\d+$/.test(c.querySelector('.wo-col-count').textContent); }),
      'each column header carries its count');
    var placed = $$('#tkBoard .wo-card');
    ok(placed.length > 0, 'cards are grouped into the columns (' + placed.length + ')');
    var counts = p.w.Query.queryTickets(p.w.Store.db.tickets, { status: 'open', size: 100 }, null);
    /* The register links inside the reader's own lane, so the card is keyed by
       the record it names rather than by the lane file it sits in. */
    var shown = {};
    placed.forEach(function (c) { shown[String(c.getAttribute('href')).split('?')[1]] = 1; });
    ok(counts.items.every(function (t) { return shown['id=' + encodeURIComponent(t.id)]; }),
      'every filtered ticket reaches its column');
    var moves = $$('#tkBoard [data-move]');
    ok(moves.length > 0, 'open cards expose the coordinator moves (' + moves.length + ')');
    ok(moves.every(function (b) { return b.getAttribute('data-move') && b.getAttribute('data-id'); }),
      'each move names its target status and ticket');
    ok($$('#tkBoard .wo-archive [data-move]').length === 0,
      'the archive never offers a move out of a terminal state');
    var submitted = p.w.Store.db.tickets.filter(function (t) { return t.status === 'submitted'; })
      .map(function (t) { return t.id; });
    ok(moves.some(function (b) {
      return b.getAttribute('data-move') === 'assigned' && submitted.indexOf(b.getAttribute('data-id')) > -1;
    }), 'a Submitted card offers Assigned through the guarded action');
    ok($('#tkPagination').innerHTML === '', 'the board does not show a pager');
    ok($('#tkBulk').hidden === true, 'bulk selection stays out of the board');
    $$('#tkView [data-view="list"]')[0].click();
    ok($('#tkBoard').hidden === true && $('#tkTable').hidden === false, 'the list layout returns from the board');
  }

  /* an office requester counts only the replies they may read */
  var t = p.w.Store.getTicket('IT-2026-000142');
  if (t) {
    var staffCard = p.w.UI.workCard(t, { role: 'coordinator' });
    var officeCard = p.w.UI.workCard(t, { role: 'requester' });
    var internal = (t.comments || []).filter(function (x) { return x.visibility === 'internal'; }).length;
    var staffText = staffCard.replace(/<[^>]+>/g, ' ');
    var officeText = officeCard.replace(/<[^>]+>/g, ' ');
    ok(internal > 0, 'the seeded ticket has an internal note to test with');
    ok(/\b1\b/.test(officeText) || officeText.indexOf(String((t.comments || []).length - internal)) > -1,
      'the office card counts only the public replies');
    ok(staffText.indexOf(String((t.comments || []).length)) > -1,
      'the staff card counts every reply');
  }
  ok(p.errors.length === 0, 'no errors from the card view');
  close(p);
});

/* Audit U5 (test 99): the board is a second door to the same guarded workflow.
   Every move it offers must be on the whitelist, and a move button that the
   page never rendered - a crafted one - must be refused with the card left in
   the column it came from.  Rejecting the same call when it is sent straight
   to the API is covered by the server-side transition matrix. */
tests.push(async function boardMoveGuard() {
  var p = await openFeatures(BASE + 'tickets.html', { ticketsBoardView: true });
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'the board loads for the move guard test');
  var boardBtn = $$('#tkView [data-view="board"]')[0];
  ok(boardBtn !== undefined, 'the board layout is chosen');
  boardBtn.click();

  function columnOf(id) {
    /* The register links inside the reader's own lane, so the card is found by
       the record it names rather than by the lane file it sits in. */
    var card = $('#tkBoard .wo-card[href$="' + encodeURIComponent(id) + '"]');
    if (!card) return null;
    var col = card.closest('[data-board-status]');
    return col && col.getAttribute('data-board-status');
  }

  /* 1. The offered targets are exactly the whitelisted ones for each card. */
  var cells = $$('#tkBoard .wo-cell');
  ok(cells.length > 0, 'the board renders move menus (' + cells.length + ')');
  var wrong = [], missing = [];
  cells.forEach(function (cell) {
    var card = cell.querySelector('.wo-card');
    if (!card) return;
    var id = decodeURIComponent((card.getAttribute('href') || '').split('id=')[1] || '');
    var t = p.w.Store.getTicket(id);
    if (!t || p.w.Query.TERMINAL_STATES.indexOf(t.status) > -1) return;
    var allowed = p.w.Query.ALL_STATES.filter(function (s) { return p.w.Flow.canTransition(t.status, s); });
    var offered = Array.prototype.slice.call(cell.querySelectorAll('[data-move]'))
      .map(function (b) { return b.getAttribute('data-move'); });
    offered.forEach(function (s) { if (allowed.indexOf(s) === -1) wrong.push(id + ' offers ' + s); });
    allowed.forEach(function (s) { if (offered.indexOf(s) === -1) missing.push(id + ' hides ' + s); });
  });
  ok(!wrong.length, 'no card offers a move outside the whitelist' + (wrong.length ? ' -> ' + wrong.slice(0, 3).join(', ') : ''));
  ok(!missing.length, 'no card hides a move the whitelist allows' + (missing.length ? ' -> ' + missing.slice(0, 3).join(', ') : ''));

  var submittedMoves = $$('#tkBoard [data-board-status="submitted"] [data-move]')
    .map(function (b) { return b.getAttribute('data-move'); });
  ok(submittedMoves.length > 0, 'a Submitted card offers its moves (' + submittedMoves.length + ')');
  ok(submittedMoves.indexOf('resolved') === -1 && submittedMoves.indexOf('closed') === -1,
    'a Submitted card never offers a closure');

  /* 2. A crafted closure on a Submitted card is refused and the card snaps
         back: the click handler hands the request to the guarded action, the
         guard says no, and the board is not re-rendered. */
  var first = $$('#tkBoard [data-board-status="submitted"] .wo-card')[0];
  ok(first !== undefined, 'a Submitted card is on the board to probe');
  if (first) {
    var sid = decodeURIComponent(first.getAttribute('href').split('id=')[1]);
    var btn = p.d.createElement('button');
    btn.setAttribute('data-move', 'closed');
    btn.setAttribute('data-id', sid);
    first.parentNode.appendChild(btn);
    btn.click();
    var reason = $('.modal-host [name="reason"]');
    ok(reason !== null, 'the crafted move opens the guarded closure form');
    if (reason) {
      reason.value = 'probe: closure attempted from Submitted';
      $('#mGo').click();
    }
    var errs = $$('.toast.err');
    ok(errs.length > 0, 'the refused move reports the refusal');
    ok(errs.length > 0 && /not allowed|cannot|Closed/i.test(errs[errs.length - 1].textContent),
      'the refusal names the illegal status change', errs.length ? errs[errs.length - 1].textContent : '');
    ok(p.w.Store.getTicket(sid).status === 'submitted', 'the refused move leaves the status alone',
      p.w.Store.getTicket(sid).status);
    ok(columnOf(sid) === 'submitted', 'the refused card stays in the Submitted column', columnOf(sid));
    ok($('.modal-host') === null, 'the refused form closes itself');
  }

  /* 3. A move the whitelist grants still lands through the same crafted
         button, and the board repaints the card into its new column. */
  var ready = p.w.Store.db.tickets.filter(function (t) {
    return t.status === 'submitted' && columnOf(t.id) === 'submitted';
  })[0];
  if (ready) {
    var host = $('#tkBoard [data-board-status="submitted"] .wo-card[href$="' + encodeURIComponent(ready.id) + '"]').parentNode;
    var nbtn = p.d.createElement('button');
    nbtn.setAttribute('data-move', 'needs_info');
    nbtn.setAttribute('data-id', ready.id);
    host.appendChild(nbtn);
    nbtn.click();
    var missing = $('.modal-host [name="missing"]');
    ok(missing !== null, 'the allowed move opens its form');
    if (missing) {
      missing.value = 'probe: serial number and room number';
      $('#mGo').click();
    }
    var moved = p.w.Store.getTicket(ready.id);
    ok(moved.status === 'needs_info', 'the allowed move is recorded', moved.status);
    ok(columnOf(ready.id) === 'needs_info', 'the accepted card moves to its column', columnOf(ready.id));
    ok($$('.toast.ok').length > 0, 'the accepted move reports its result');
  } else {
    ok(false, 'a Submitted ticket is available for the allowed move probe');
  }
  ok(p.errors.length === 0, 'no errors from the move guard test', p.errors.join(' | '));
  close(p);
});

/* Ctrl or Cmd plus K opens one search over the records the signed-in role
   may open.  It stays inside the role's tenancy and can be closed with Esc. */
tests.push(async function commandPalette() {
  var p = await openFeatures(BASE + 'tickets.html', { workspaceCommandPalette: true });
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'tickets loads for the palette test');
  ok($('#tbSearch') !== null && $('#tbSearch').tagName === 'BUTTON',
    'the top bar search is a palette trigger');

  p.d.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  ok($('#cmdk') !== null && $('#cmdk').hidden === false, 'Ctrl plus K opens the command palette');
  ok($('#cmdkInput') !== null, 'the palette has a search field');

  var input = $('#cmdkInput');
  input.value = 'Library';
  input.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  var items = $$('#cmdkList [data-cmdk-item]');
  ok(items.length > 0, 'the palette returns matches (' + items.length + ')');
  var hrefs = items.map(function (a) { return a.dataset.href; });
  ok(hrefs.some(function (h) { return /ticket\.html\?id=/.test(h); }), 'ticket results are listed');
  ok(hrefs.some(function (h) { return /register\.html\?office=Library|offices\.html\?q=Library/.test(h); }),
    'office results are listed');

  input.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  ok($('#cmdkList .cmdk-item.on') !== null, 'arrow keys move the selection');
  p.d.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok($('#cmdk').hidden === true, 'Esc closes the palette');
  ok(p.d.body.className.indexOf('cmdk-open') === -1, 'closing restores page scrolling');

  /* asset search */
  p.w.UI.openPalette('PC-OF-118');
  var assetHrefs = $$('#cmdkList [data-cmdk-item]').map(function (a) { return a.dataset.href; });
  ok(assetHrefs.some(function (h) { return /register\.html\?q=PC-OF-118/.test(h); }),
    'asset results open the register');
  p.w.UI.closePalette();

  /* the technician sees only the tickets assigned to them */
  asRole(p, 'technician');
  p.w.UI.openPalette('IT-2026');
  var techIds = $$('#cmdkList [data-cmdk-item]').map(function (a) { return a.dataset.href; })
    .filter(function (h) { return /ticket\.html\?id=/.test(h); })
    .map(function (h) { return decodeURIComponent(h.split('id=')[1]); });
  ok(techIds.length > 0, 'the technician palette lists their own tickets');
  ok(techIds.every(function (id) {
    var tk = p.w.Store.getTicket(id);
    return tk && tk.technician === 'J. Tan';
  }), 'the technician palette never lists another technician\'s ticket');
  p.w.UI.closePalette();

  /* the requester stays inside their office */
  asRole(p, 'requester');
  p.w.UI.openPalette('Accounting');
  var officeHrefs = $$('#cmdkList [data-cmdk-item]').map(function (a) { return a.dataset.href; })
    .filter(function (h) { return /office=|q=Accounting/.test(h); });
  ok(officeHrefs.length === 0, 'the requester palette never offers another office');
  var ownIds = $$('#cmdkList [data-cmdk-item]').map(function (a) { return a.dataset.href; })
    .filter(function (h) { return /ticket\.html\?id=/.test(h); })
    .map(function (h) { return decodeURIComponent(h.split('id=')[1]); });
  ok(ownIds.every(function (id) {
    var tk = p.w.Store.getTicket(id);
    return tk && tk.office === 'Records Office';
  }), 'the requester palette stays inside office tenancy');
  p.w.UI.closePalette();

  ok(p.errors.length === 0, 'no errors from the command palette');
  close(p);
});

/* The palette is a way in, never a way round the map.  A role the map keeps off
   the record is not offered a record to open, and a target the reader may open
   is resolved into their own lane when they pick it. */
tests.push(async function paletteLane() {
  var p = await openFeatures(BASE + 'mgmt-users.html', { workspaceCommandPalette: true });
  asRole(p, 'management');
  ok(p.errors.length === 0, 'the administrator directory loads for the palette probe');
  p.w.UI.openPalette('IT-2026');
  var mgmtHits = $$('#cmdkList [data-cmdk-item]').map(function (a) { return a.dataset.href; })
    .filter(function (h) { return /(^|-)ticket\.html\?id=/.test(h); });
  ok(mgmtHits.length === 0,
    'the administrator palette never offers a record this role cannot open');
  p.w.UI.closePalette();
  var lane = p.w.UI.laneHref('ticket.html?id=IT-2026-000130');
  ok(lane === 'ticket.html?id=IT-2026-000130',
    'a page outside this role keeps its plain name, so its own guard answers (' + lane + ')');
  close(p);

  var c = await openFeatures(BASE + 'mgmt-users.html', { workspaceCommandPalette: true });
  asRole(c, 'coordinator');
  var target = c.w.UI.laneHref('ticket.html?id=IT-2026-000130');
  ok(target === 'ic-ticket.html?id=IT-2026-000130',
    'a coordinator pick opens the record in the coordinator lane (' + target + ')');
  var office = c.w.UI.laneHref('register.html?office=Records%20Office');
  ok(office === 'ic-register.html?office=Records%20Office',
    'an office pick stays in the lane too (' + office + ')');
  close(c);
});

/* Links from the palette open the register and the directory already
   filtered, with the controls reflecting the filter in force. */
tests.push(async function urlFilters() {
  var p = await open(BASE + 'register.html?office=Accounting&q=printer');
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'the filtered register loads with no errors' +
    (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($('#gQ').value === 'printer', 'the register search reflects the link');
  ok($('#gOffice').value === 'Accounting', 'the register office select reflects the link');
  var rows = $$('#gBody tr');
  ok(rows.length > 0, 'the filtered register shows matching records');
  ok(rows.every(function (tr) { return tr.textContent.indexOf('Accounting') > -1; }),
    'every row belongs to the linked office');
  close(p);

  var o = await open(BASE + 'offices.html?q=Records');
  asRole(o, 'management');
  ok(o.errors.length === 0, 'the filtered directory loads with no errors');
  ok($('#oQ').value === 'Records', 'the directory search reflects the link');
  var orows = $$('#oBody tr');
  ok(orows.length > 0, 'the filtered directory shows a match');
  ok(orows.every(function (tr) { return tr.textContent.indexOf('Records') > -1; }),
    'the directory lists only the matching office');
  close(o);
});

/* The asset register (decision D43 resolved): Administration keeps the units,
   the other lanes only ever see the number offered at intake. */
tests.push(async function assetRegister() {
  var p = await open(BASE + 'assets.html');
  asRole(p, 'management');
  ok(p.errors.length === 0, 'the register loads with no script errors' +
    (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($('#accessPanel') === null, 'the register is not blocked for its own lane');

  var seeded = p.w.Store.db.assets || [];
  ok(seeded.length >= 14, 'the register starts with the demo units (' + seeded.length + ')');
  var rows = $$('#aBody tr');
  ok(rows.length > 0, 'the register lists rows');
  ok(rows.every(function (tr) { return /[A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}/.test(tr.textContent); }),
    'every row carries an asset number');
  ok($('#aPagination') !== null && $('#aPagination').innerHTML.indexOf('page') > -1,
    'a growing list is paginated rather than endless');

  /* filters */
  var office = $('#aOffice');
  office.value = 'Records Office';
  office.dispatchEvent(new p.w.Event('change'));
  var filtered = $$('#aBody tr');
  ok(filtered.length > 0, 'the office filter matches rows');
  ok(filtered.every(function (tr) { return tr.textContent.indexOf('Records Office') > -1; }),
    'the office filter lists only that office');
  office.value = '';
  office.dispatchEvent(new p.w.Event('change'));
  close(p);

  /* a debounced input handler needs the timer to elapse before it repaints */
  var p2 = await open(BASE + 'assets.html');
  asRole(p2, 'management');
  await new Promise(function (r) { setTimeout(r, 320); });
  var q2 = $('#aQ');
  q2.value = 'PRN';
  q2.dispatchEvent(new p2.w.Event('input'));
  await new Promise(function (r) { setTimeout(r, 320); });
  var printerRows = $$('#aBody tr');
  ok(printerRows.length > 0 && printerRows.every(function (tr) {
    return tr.textContent.indexOf('PRN') > -1;
  }), 'the search narrows the register to the matching numbers');

  /* create */
  var before = p2.w.Store.db.assets.length;
  $('#btnNewAsset').click();
  ok($('.modal-host') !== null, 'the register opens an editor');
  var set = function (name, value) {
    var el = $('.modal-host [name="' + name + '"]');
    ok(el !== null, 'the editor offers a ' + name + ' field');
    if (el) el.value = value;
  };
  set('tag', 'pc-tec-77');
  set('name', 'Test workstation');
  set('category', 'Hardware Repair');
  set('office', 'IT Office');
  set('location', 'Room 101');
  $('#mGo').click();
  ok(p2.w.Store.db.assets.length === before + 1, 'a new unit enters the register');
  var made = p2.w.Store.db.assets[p2.w.Store.db.assets.length - 1];
  ok(made.tag === 'PC-TEC-77', 'the number is normalised to upper case (' + made.tag + ')');
  ok(/^AST-\d{4}$/.test(made.id), 'the register mints its own id (' + made.id + ')');

  /* the register is paginated, so the newest unit is found by search  --  the
     debounced input handler needs its timer to elapse before it repaints */
  var q3 = $('#aQ');
  q3.value = 'TEC-77';
  q3.dispatchEvent(new p2.w.Event('input'));
  await new Promise(function (r) { setTimeout(r, 320); });
  ok($$('#aBody tr').some(function (tr) { return tr.textContent.indexOf('PC-TEC-77') > -1; }),
    'the new unit appears in the list');

  /* a malformed number is refused and nothing is stored */
  var refused = p2.w.Store.db.assets.length;
  $('#btnNewAsset').click();
  set('tag', 'not a number');
  set('name', 'Bad');
  set('category', 'Hardware Repair');
  set('office', 'IT Office');
  $('#mGo').click();
  ok(p2.w.Store.db.assets.length === refused, 'a malformed number stores nothing');
  ok($('.modal-host') !== null, 'the editor stays open so the number can be fixed');

  /* an unknown office is refused */
  set('tag', 'PC-TEC-78');
  set('name', 'Bad office');
  set('category', 'Hardware Repair');
  set('office', 'Atlantis');
  $('#mGo').click();
  ok(p2.w.Store.db.assets.length === refused, 'an office that does not exist stores nothing');
  p2.w.UI.closeModal();

  /* retire keeps the record */
  var target = p2.w.Store.db.assets.filter(function (a) { return a.tag === 'PC-TEC-77'; })[0];
  var btn = $('[data-atoggle="' + target.id + '"]');
  ok(btn !== null, 'a listed unit offers a retire control');
  if (btn) {
    ok(btn.textContent.indexOf('Retire') > -1, 'a live unit offers retirement');
    btn.click();
    ok(target.active === false, 'retiring clears the flag but keeps the record');
    var again = $('[data-atoggle="' + target.id + '"]');
    ok(again && again.textContent.indexOf('Restore') > -1, 'a retired unit offers restoration');
    again.click();
    ok(target.active === true, 'restoring returns the unit to service');
  }
  close(p2);

  /* the lane never reaches another lane's screen */
  ok(p.w.UI.can('assets.html', 'management') === true, 'the register is open to Administration');
  ['requester', 'technician', 'coordinator'].forEach(function (role) {
    ok(p.w.UI.can('assets.html', role) === false, 'the register is closed to ' + role);
  });
});

/* Intake offers the registered number instead of leaving it to be retyped. */
tests.push(async function intakeOffersRegisteredAssets() {
  var p = await open(BASE + 'request.html');
  asRole(p, 'requester');
  ok(p.errors.length === 0, 'intake loads with the register wired' +
    (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  var box = $('#assetTags');
  ok(box !== null, 'the asset field is bound to a suggestion list');
  ok($('#fAsset').getAttribute('list') === 'assetTags', 'the asset field points at that list');

  /* the office is settled by the lane before the list is built, so a
     suggestion is always a unit the office actually holds */
  var office = $('#fOffice');
  var scoped = Array.prototype.map.call(box.querySelectorAll('option'), function (o) { return o.value; });
  var heldBy = function (name) {
    return p.w.Store.db.assets.filter(function (a) { return a.active !== false && a.office === name; });
  };
  ok(scoped.length > 0, 'the office in hand offers its units (' + scoped.length + ' for ' + office.value + ')');
  ok(scoped.length === heldBy(office.value).length,
    'the suggestions are exactly the in-service units of that office');
  ok(scoped.every(function (v) {
    var a = p.w.Store.db.assets.filter(function (x) { return x.tag === v; })[0];
    return a && a.office === office.value;
  }), 'the suggestions name only units held by the chosen office');

  office.value = 'Records Office';
  office.dispatchEvent(new p.w.Event('change'));
  var again = Array.prototype.map.call(box.querySelectorAll('option'), function (o) { return o.value; });
  ok(again.length === heldBy('Records Office').length, 'choosing another office narrows the suggestions');
  ok(again.every(function (v) {
    return /^[A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}$/.test(v);
  }), 'a suggestion always fits the documented number shape');

  /* a suggestion is a help, never a constraint */
  var free = $('#fAsset');
  free.value = 'PC-XX-999';
  ok(free.value === 'PC-XX-999', 'an unregistered unit is still writable at intake');
  close(p);
});

/* Section 25.5A: the register opens with an office health strip and a
   readable service timeline built from the append-only audit trail. */
tests.push(async function registerHealthAndTimeline() {
  var p = await open(BASE + 'register.html?office=Accounting');
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'the register loads for the health strip' +
    (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  var cards = $$('#gHealth .health-card');
  ok(cards.length === 5, 'the health strip carries five measures (' + cards.length + ')');
  ok($('#gHealthScope').textContent.indexOf('Accounting') > -1,
    'the health strip names the office in scope');
  var labels = cards.map(function (c) { return c.textContent; }).join(' ');
  ['Open tickets', 'Overdue', 'Last service', 'Next maintenance', 'Recurring issues'].forEach(function (l) {
    ok(labels.indexOf(l) > -1, 'the health strip shows ' + l);
  });
  var openCount = p.w.Store.db.tickets.filter(function (t) {
    return t.office === 'Accounting' && p.w.Query.OPEN_STATES.indexOf(t.status) > -1;
  }).length;
  ok(cards[0].textContent.indexOf(String(openCount)) > -1,
    'open tickets count only the office in scope (' + openCount + ')');

  var tab = $('#tab-timeline');
  ok(tab !== null, 'the register offers a service timeline tab');
  ok($('#panel-timeline') !== null && $('#panel-timeline').hidden === true,
    'the timeline starts hidden behind its tab');
  if (tab) {
    tab.click();
    ok($('#panel-timeline').hidden === false, 'opening the tab shows the timeline');
    var events = $$('#panel-timeline .timeline li');
    ok(events.length > 0, 'the timeline lists service events (' + events.length + ')');
    ok(events.every(function (li) { return li.querySelector('.mono') !== null; }),
      'every timeline event names the record it belongs to');
    var accounting = {};
    p.w.Store.db.tickets.forEach(function (t) { if (t.office === 'Accounting') accounting[t.id] = 1; });
    p.w.Store.db.jobs.forEach(function (j) { if (j.office === 'Accounting') accounting[j.id] = 1; });
    ok(events.every(function (li) { return accounting[li.querySelector('.mono').textContent] === 1; }),
      'the timeline follows the office filter');
  }
  ok(p.errors.length === 0, 'no errors from the health strip or timeline');
  close(p);
});

/* Section 25.5B: row density belongs to the person and never hides data. */
tests.push(async function tableDensity() {
  var p = await open(BASE + 'register.html');
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'the register loads for the density test');
  var compact = p.d.querySelector('[data-density-set="compact"]');
  ok(compact !== null, 'the account tray offers a compact row density');
  if (compact) {
    compact.click();
    ok(p.d.documentElement.getAttribute('data-density') === 'compact',
      'choosing compact sets the density on the page');
    ok(p.w.localStorage.getItem('itc_density') === 'compact', 'the density choice is remembered');
    var roomy = p.d.querySelector('[data-density-set="comfortable"]');
    ok(roomy !== null, 'the comfortable density is offered as well');
    if (roomy) {
      roomy.click();
      ok(p.d.documentElement.getAttribute('data-density') === 'comfortable',
        'choosing comfortable restores the roomy rows');
    }
  }
  var pd = await open(BASE + 'profile.html');
  asRole(pd, 'coordinator');
  ok(pd.d.querySelector('#densitySeg') !== null, 'the profile page repeats the density preference');
  ok(pd.d.querySelectorAll('#densitySeg [data-dn]').length === 2, 'the profile density offers both choices');
  close(pd);
  ok(p.errors.length === 0, 'no errors from the density switch');
  close(p);
});

/* Section 25.5B: a phone number dials and an address opens mail. */
tests.push(async function oneTapContact() {
  var p = await open(BASE + 'ticket.html?id=IT-2026-000125');
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'the ticket record loads for the contact test');
  var mail = $$('#tHead a[href^="mailto:"]');
  var tel = $$('#tHead a[href^="tel:"]');
  ok(mail.length > 0, 'the record offers one-tap email for the people involved');
  ok(tel.length > 0, 'the record offers one-tap calling for the people involved');
  ok(tel.every(function (a) { return /^tel:\+?[\d]+$/.test(a.getAttribute('href')); }),
    'the call link carries a dialable number');
  var users = await open(BASE + 'users.html');
  asRole(users, 'management');
  ok(users.errors.length === 0, 'the directory loads for the contact test');
  ok($$('#uBody a[href^="mailto:"]').length > 0, 'the directory makes an email one tap away');
  close(users);
  close(p);
});

/* A request in progress survives a reload, and discarding removes it. */
tests.push(async function requestDraft() {
  var p = await open(BASE + 'request.html');
  asRole(p, 'requester');
  ok(p.errors.length === 0, 'the request form loads for the draft test');
  var issue = $('#fIssue');
  ok(issue !== null, 'the issue field is present');
  if (issue) {
    issue.value = 'Printer on the second floor keeps jamming on legal size paper.';
    p.w.saveDraft();
    ok(p.w.localStorage.getItem('itc_draft_request') !== null, 'typing keeps a draft on this device');
    ok($('#draftNote').hidden === false, 'the draft notice appears');
    issue.value = '';
    p.w.restoreDraft();
    ok(issue.value.indexOf('second floor') > -1, 'the draft returns when the form is restored');
    p.w.clearDraft();
    ok(p.w.localStorage.getItem('itc_draft_request') === null, 'discarding removes the saved draft');
    ok($('#draftNote').hidden === true, 'the draft notice disappears when discarded');
  }
  ok(p.errors.length === 0, 'no errors from the draft keeper');
  close(p);
});

/* The requester sees the preventive visits for their own office, read-only. */
tests.push(async function maintenanceVisits() {
  var p = await open(BASE + 'visits.html');
  asRole(p, 'requester');
  ok(p.errors.length === 0, 'the visits page loads for an office requester' +
    (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  var office = p.w.UI.auth().office;
  ok($('#vScope').textContent.indexOf(office) > -1, 'the page names the office in scope');
  var rows = $$('#vBody tr');
  ok(rows.length > 0, 'the office sees its visits (' + rows.length + ')');
  var ids = {};
  p.w.Store.db.jobs.forEach(function (j) { if (j.office === office) ids[j.id] = 1; });
  ok(rows.every(function (tr) {
    var id = tr.querySelector('.t-id');
    return id !== null && ids[id.textContent] === 1;
  }), 'the visits stay inside the requester office');
  ok($$('#vBody button').length === 0, 'the visit record is read-only');
  ok($('#vtab-plans') === null, 'the office sees no preventive plans (schedules are staff work)');
  ok(p.errors.length === 0, 'no errors from the read-only visits page');
  close(p);
});

/* The technician opens on today's visits and the due queue. */
tests.push(async function technicianToday() {
  var p = await open(BASE + 'technician.html');
  asRole(p, 'technician');
  ok(p.errors.length === 0, 'the workbench loads for the today view');
  var cards = $$('#wToday .card');
  ok(cards.length === 2, 'the workbench opens with two today cards (' + cards.length + ')');
  var text = cards.map(function (c) { return c.textContent; }).join(' ');
  ok(text.indexOf('Visits today') > -1, 'the first card is today\'s visits');
  ok(text.indexOf('Due or overdue') > -1, 'the second card is the due queue');
  ok($$('#wBody tr').length >= 3, 'the full queue stays below the today cards');
  ok(p.errors.length === 0, 'no errors from the today view');
  close(p);
});

/* The pop-up switch: the live notices can be paused, but the feedback that
   follows an action, and the notifications themselves, are never lost. */
tests.push(async function popupsSwitch() {
  var p = await openFeatures(BASE + 'dashboard.html', { notificationPopupsToggle: true });
  asRole(p, 'coordinator');
  ok(p.errors.length === 0, 'dashboard loads for the pop-up switch test');
  var sw = $('[data-popups]');
  ok(sw !== null, 'the notification panel offers the pop-up switch');
  ok(sw && sw.getAttribute('aria-pressed') === 'true', 'the pop-up switch starts on');
  ok($$('[data-popups]').length >= 1, 'the switch is rendered (' + $$('[data-popups]').length + ')');
  /* the notifications themselves are untouched by the switch */
  var notifCount = $$('.notifList .notif-item').length;
  ok(notifCount > 0, 'the notification panel still lists the notifications (' + notifCount + ')');

  if (sw) {
    sw.click();
    ok(p.w.UI.popupsOn() === false, 'clicking the switch pauses the pop-ups');
    ok(p.d.body.className.indexOf('popups-off') > -1, 'the paused state is on the body');
    /* the live notices are held back ... */
    p.w.UI.toast('a live notice', 'live');
    ok($$('.toast').length === 0, 'a live notice does not pop up while paused');
    /* ... but the result of what the person just did is still shown */
    p.w.UI.toast('an action result', 'ok');
    ok($$('.toast').length === 1, 'the result of an action still pops up while paused');
    p.w.UI.toast('a problem', 'err');
    ok($$('.toast').length === 2, 'an error still pops up while paused');
    /* the notifications are still there */
    ok($$('.notifList .notif-item').length === notifCount, 'the notifications are not lost while paused');
    /* and the switch turns them back on */
    sw.click();
    ok(p.w.UI.popupsOn() === true, 'clicking again brings the pop-ups back');
    ok(p.d.body.className.indexOf('popups-off') === -1, 'the paused state is cleared');
    p.w.UI.toast('a live notice', 'live');
    ok($$('.toast').length === 3, 'a live notice pops up again once the switch is on');
  }
  ok(p.errors.length === 0, 'no errors from the pop-up switch');
  close(p);
});

/* Screen sizes must not add or remove a feature. The navigation set is the
   same at 390, 768 and 1440 px, and every optional extra is absent at each
   width. The hidden extras also have no backend endpoint to call. */
function navDestinations(p) {
  var out = {};
  function add(el) {
    var h = el.getAttribute('href');
    if (!h) return;
    h = String(h).replace(/^(or|itc|ic|mgmt)-/, '');
    out[h] = 1;
  }
  p.d.querySelectorAll('#chromeSide .side-link[href], #chromeBottom a[href]').forEach(add);
  var more = p.d.getElementById('bottomMore');
  if (more) {
    more.click();
    var sheet = p.d.querySelector('.more-sheet');
    if (sheet) sheet.querySelectorAll('.more-item[href]').forEach(add);
  }
  return Object.keys(out).sort();
}

tests.push(async function scopeAcrossWidths() {
  var widths = [390, 768, 1440];
  var roles = [
    ['or', 'requester'],
    ['itc', 'technician'],
    ['ic', 'coordinator'],
    ['mgmt', 'management']
  ];
  var expected = {
    requester: ['confirm.html', 'dashboard.html', 'flow.html', 'notifications.html',
      'profile.html', 'register.html', 'reports.html', 'request.html',
      'tickets.html?queue=mine', 'visits.html'],
    technician: ['dashboard.html', 'flow.html', 'maintenance.html', 'notifications.html',
      'profile.html', 'register.html', 'reports.html', 'technician.html'],
    coordinator: ['confirm.html', 'dashboard.html', 'flow.html', 'maintenance.html',
      'notifications.html', 'profile.html', 'register.html', 'reports.html',
      'request.html', 'review.html', 'tickets.html'],
    management: ['assets.html', 'audit.html', 'flow.html', 'notifications.html',
      'offices.html', 'profile.html', 'settings.html', 'users.html']
  };
  /* Each lane is opened at its own landing page: the administrator has no
     dashboard, so its lane opens at the users directory (role scope 5). */
  var landing = { requester: 'dashboard.html', technician: 'dashboard.html',
                  coordinator: 'dashboard.html', management: 'users.html' };
  var seen = {};

  for (var i = 0; i < roles.length; i++) {
    var prefix = roles[i][0], role = roles[i][1];
    seen[role] = {};
    for (var j = 0; j < widths.length; j++) {
      var w = widths[j];
      var p = await openWidth(BASE + prefix + '-' + landing[role], w);
      ok(p.errors.length === 0, role + ' at ' + w + 'px loads with no errors' +
        (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
      var got = navDestinations(p);
      seen[role][w] = got.join('|');
      ok(got.join('|') === expected[role].slice().sort().join('|'),
        role + ' at ' + w + 'px lists exactly the baseline destinations');
      ok(p.d.getElementById('tbSearch') === null && p.d.getElementById('tbSearchMobile') === null,
        role + ' at ' + w + 'px has no command palette trigger');
      ok(p.d.querySelectorAll('#kpiGrid .spark').length === 0,
        role + ' at ' + w + 'px has no KPI sparkline');
      close(p);
    }
    ok(seen[role][390] === seen[role][768] && seen[role][768] === seen[role][1440],
      role + ' navigation is identical at 390, 768 and 1440 px');
  }

  for (var k = 0; k < widths.length; k++) {
    var width = widths[k];
    var t = await openWidth(BASE + 'ic-tickets.html', width);
    ok(t.errors.length === 0, 'register at ' + width + 'px loads with no errors');
    ok(t.d.querySelector('#tkView [data-view="board"]') === null,
      'register at ' + width + 'px has no board layout');
    ok(t.d.getElementById('tkBoard') === null, 'register at ' + width + 'px has no board container');
    t.d.dispatchEvent(new t.w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    ok(t.d.getElementById('cmdk') === null, 'register at ' + width + 'px has no palette shortcut');
    close(t);

    var m = await openWidth(BASE + 'itc-maintenance.html', width);
    ok(m.errors.length === 0, 'maintenance at ' + width + 'px loads with no errors');
    ok(m.d.getElementById('plannerCard') === null,
      'maintenance at ' + width + 'px has no calendar planner');
    close(m);

    var g = await openWidth(BASE + 'index.html', width);
    ok(g.d.body.classList.contains('access-denied'),
      'the gallery route is neutral at ' + width + 'px');
    close(g);

    var r = await openWidth(BASE + 'roles.html', width);
    ok(r.d.body.classList.contains('access-denied'),
      'the roles reference route is neutral at ' + width + 'px');
    close(r);

    var tk = await openWidth(BASE + 'ic-ticket.html?id=IT-2026-000142', width);
    ok(tk.d.getElementById('tPickerBar') === null,
      'ticket detail at ' + width + 'px has no ticket chooser');
    close(tk);

    var pf = await openWidth(BASE + 'or-profile.html', width);
    ok(pf.d.getElementById('passwordCard') === null,
      'profile at ' + width + 'px has no password card');
    close(pf);

    var st = await openWidth(BASE + 'mgmt-settings.html', width);
    ok(st.d.querySelector('[name="simulate"]').type === 'hidden',
      'settings at ' + width + 'px shows no simulation switch');
    close(st);

    var rq = await openWidth(BASE + 'or-request.html', width);
    ok(rq.d.getElementById('fIdempotencyField').hidden === true,
      'intake at ' + width + 'px hides the duplicate protection key');
    close(rq);
  }

  var backend = fs.readFileSync(path.join(ROOT, 'server', 'app.py'), 'utf8') +
    fs.readFileSync(path.join(ROOT, 'server', 'engine.py'), 'utf8');
  ['board', 'palette', 'planner', 'sparkline', 'gallery'].forEach(function (term) {
    var api = new RegExp('["\']/api/[^"\']*' + term, 'i');
    var word = new RegExp('\\b' + term + '\\b', 'i');
    ok(!api.test(backend), 'the backend exposes no ' + term + ' API route');
    ok(!word.test(backend), 'the backend source carries no hidden ' + term + ' feature');
  });
});

tests.push(async function readStates() {
  /* Required test 61 and audit U14: each state the read path can answer with
     is named on the screen.  A static run carries no backend bridge at all, so
     the outage panel is held back; the panel belongs to a deployed page whose
     server stops answering, which is the state reached below. */
  var p = await open(BASE + 'ic-tickets.html');
  ok(p.w.ApiMode === undefined, 'the static prototype runs with no backend bridge');
  ok(p.d.getElementById('outageNotice') === null,
     'a page with no backend bridge shows no outage panel');

  p.w.ApiMode = false;
  p.w.UI.renderOutageNotice();
  var panel = p.d.getElementById('outageNotice');
  ok(panel !== null, 'a deployed screen whose server does not answer shows the outage panel');
  ok(/Cannot reach the service desk server/.test(panel.querySelector('h2').textContent),
     'the outage panel names the server in its heading');
  ok(/copy stored on this device/.test(panel.querySelector('p').textContent),
     'the outage panel says which copy the list is holding');
  ok(panel.getAttribute('role') === 'status', 'the outage panel reaches a screen reader');
  var retry = panel.querySelector('#ogRetry');
  ok(retry !== null && retry.textContent.trim() === 'Try again', 'the outage panel offers a retry');

  /* and it goes away the moment a server does answer */
  p.w.ApiMode = true;
  p.w.UI.renderOutageNotice();
  ok(p.d.getElementById('outageNotice') === null, 'a screen backed by the server hides the panel');
  p.w.ApiMode = false;
  p.w.UI.renderOutageNotice();
  ok(p.d.getElementById('outageNotice') !== null, 'the panel returns when the server stops answering');
  ok(p.d.querySelectorAll('#outageNotice').length === 1, 'the panel is not stacked on re-render');

  /* loading: the one place the app really waits renders an announced skeleton */
  var sk = p.d.createElement('div');
  sk.innerHTML = p.w.UI.skeleton(3);
  var block = sk.querySelector('.skeleton-block');
  ok(block !== null && block.getAttribute('role') === 'status' &&
     block.getAttribute('aria-label') === 'Loading', 'the loading state is an announced status');
  ok(block.querySelectorAll('.skeleton-line').length === 3, 'the loading state shows the asked-for lines');
  close(p);

  var lanes = ['or-dashboard.html', 'itc-technician.html', 'mgmt-users.html'];
  for (var li = 0; li < lanes.length; li++) {
    var q = await open(BASE + lanes[li]);
    q.w.ApiMode = false;
    q.w.UI.renderOutageNotice();
    ok(q.d.getElementById('outageNotice') !== null,
      lanes[li] + ' carries the same outage notice when its server is silent');
    close(q);
  }

  /* empty: a filter that matches nothing says so instead of showing a blank table */
  var t = await open(BASE + 'ic-tickets.html?q=zzz-no-such-ticket');
  var empty = t.d.getElementById('tkEmpty');
  ok(empty !== null && empty.hidden === false, 'a filter with no rows reveals the empty state');
  ok(/No tickets match these filters\./.test(empty.textContent),
     'the empty state names why the list is blank: ' + empty.textContent.trim());
  ok(t.d.getElementById('tkBody').querySelectorAll('tr').length === 0,
     'the empty state leaves no rows under the table head');
  close(t);
});

tests.push(async function badgeIdentity() {
  /* Required tests 63 and 77: every status badge carries its text and its own
     glyph, and Resolved is told apart from Closed by colour as well as words.
     The colour pair is read from the theme sheets rather than from a computed
     style: the headless DOM here does not run the CSS cascade, so a rendered
     reading would be a reading of nothing. */
  var CLASSES = {
    submitted: 'b-submitted', needs_info: 'b-needs-info', assigned: 'b-assigned',
    in_progress: 'b-progress', on_hold: 'b-hold', resolved: 'b-resolved',
    closed: 'b-closed', cancelled: 'b-cancelled'
  };
  var LABELS = Object.keys(CLASSES);
  function escapeRe(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function chipColours(sheet, selector) {
    var src = fs.readFileSync(path.join(ROOT, sheet), 'utf8');
    var out = {};
    LABELS.forEach(function (st) {
      var head = selector ? selector + ' .' : '.';
      var rule = new RegExp(escapeRe(head + CLASSES[st]) +
        '\\{([^}]*)\\}').exec(src);
      if (!rule) return;
      var bg = /(?:^|;)\s*background:\s*([^;]+)/.exec(rule[1]);
      var fg = /(?:^|;)\s*color:\s*([^;]+)/.exec(rule[1]);
      if (bg && fg) out[st] = bg[1].trim() + '/' + fg[1].trim();
    });
    return out;
  }
  /* The light and green palettes keep every status on its own colour pair.
     The dark sheet reuses one navy chip for Submitted and In Progress, which
     the frozen theme holds; those two are still told apart by their words and
     glyphs, so the pair is recorded rather than asserted away. */
  var PALETTES = [
    { name: 'light', sheet: 'css/app.css', selector: '', distinct: true },
    { name: 'dark', sheet: 'css/app.css', selector: 'html[data-theme="dark"]', distinct: false },
    { name: 'green', sheet: 'css/green.css', selector: '', distinct: true }
  ];
  var p = await open(BASE + 'ic-tickets.html');
  var host = p.d.createElement('div');
  p.d.body.appendChild(host);
  var wrong = LABELS.filter(function (st) {
    host.innerHTML = p.w.UI.badge(st);
    var b = host.querySelector('.badge');
    return !b || !b.querySelector('svg') || !b.textContent.trim();
  });
  ok(wrong.length === 0, 'every status badge renders an icon and its text' +
    (wrong.length ? ' -> missing on ' + wrong.join(',') : ''));
  var seen = {};
  LABELS.forEach(function (st) {
    host.innerHTML = p.w.UI.badge(st);
    var b = host.querySelector('.badge');
    seen[st] = { text: b.textContent.trim(), cls: b.className };
  });
  var dupes = LABELS.filter(function (st) {
    return LABELS.some(function (other) {
      return other !== st && seen[other].text === seen[st].text;
    });
  });
  ok(dupes.length === 0, 'no two statuses share a badge label' + (dupes.length ? ' -> ' + dupes.join(',') : ''));
  ok(seen.resolved.cls !== seen.closed.cls, 'the two badges use different chip classes');
  PALETTES.forEach(function (pal) {
    var colours = chipColours(pal.sheet, pal.selector);
    var unstyled = LABELS.filter(function (st) { return !colours[st]; });
    ok(unstyled.length === 0, pal.name + ' gives every status its own colour pair' +
       (unstyled.length ? ' -> missing on ' + unstyled.join(',') : ''));
    ok(colours.resolved !== undefined && colours.resolved !== colours.closed,
       pal.name + ' tells Resolved apart from Closed by colour: ' + colours.resolved +
       ' against ' + colours.closed);
    var shared = LABELS.filter(function (st) {
      return LABELS.some(function (other) {
        return other !== st && colours[other] && colours[other] === colours[st];
      });
    });
    if (pal.distinct) {
      ok(shared.length === 0, pal.name + ' gives no two statuses the same colour pair' +
         (shared.length ? ' -> shared by ' + shared.join(',') : ''));
    } else {
      ok(shared.slice().sort().join(',') === 'in_progress,submitted',
         pal.name + ' reuses one chip only for Submitted and In Progress, whose labels and glyphs differ: ' +
         shared.join(','));
    }
  });
  var pr = ['low', 'medium', 'high', 'critical'].map(function (k) {
    host.innerHTML = p.w.UI.prio(k);
    var e = host.querySelector('.prio');
    return e.querySelector('svg') !== null && e.textContent.trim().length > 0;
  });
  ok(pr.every(function (x) { return x; }), 'every priority carries an icon and its word');
  host.remove();
  close(p);
});

tests.push(async function captureAndRecordControls() {
  /* Required tests 80 and 100: every file input in the app asks the phone for
     its camera, and the technician workbench opens on today, shows the
     recording progress and keeps the save bar with the list. */
  var files = fs.readdirSync(ROOT).filter(function (f) {
    return f.endsWith('.html') && !f.startsWith('__');
  });
  var inputs = 0;
  var bare = [];
  files.forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    var re = /<input[^>]*type="file"[^>]*>/g;
    var m;
    while ((m = re.exec(src)) !== null) {
      inputs++;
      if (!/capture="environment"/.test(m[0])) bare.push(f);
    }
  });
  ok(inputs >= 9 && bare.length === 0,
     'every file input in ' + files.length + ' pages asks for the environment camera (' +
     inputs + ' inputs, ' + bare.join(',') + ' without)');

  var p = await open(BASE + 'itc-technician.html');
  asRole(p, 'technician');
  var evInputs = Array.prototype.slice.call(p.d.querySelectorAll('.chk-ev input[type="file"]'));
  ok(evInputs.length > 0 && evInputs.every(function (f) {
    return f.getAttribute('capture') === 'environment';
  }), 'a checklist item takes its evidence straight from the phone camera (' +
     evInputs.length + ' controls)');

  var today = $('#wToday');
  var queue = $('#wBody');
  ok(today !== null && queue !== null,
     'the workbench holds both the today block and the full queue');
  ok((today.compareDocumentPosition(queue) & p.w.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
     'the today block is read before the full queue');
  var bar = $('.chk-progress');
  var barText = $('.chk-progress-text');
  if (bar) {
    var fill = bar.querySelector('span');
    var pct = parseFloat(fill.style.width) || 0;
    ok(pct >= 0 && pct <= 100, 'the checklist progress bar is a share of the whole (' + pct + '%)');
    ok(barText !== null && /of \d+|All items recorded/.test(barText.textContent),
       'the progress read-out counts the items: ' + (barText ? barText.textContent.trim() : 'none'));
    var foot = $('.chk-foot');
    ok(foot !== null && /of \d+ saved/.test(foot.textContent),
       'the sticky footer states how much of the visit is saved');
  } else {
    ok(false, 'the technician lane renders a job card with a checklist');
  }
  close(p);
});

tests.push(async function coordinatorComingUp() {
  /* Required test 102: the coordinator dashboard earns its place by listing
     the work that follows the current queue. */
  var p = await open(BASE + 'ic-dashboard.html');
  asRole(p, 'coordinator');
  var heads = $$('.card-head h3').map(function (h) { return h.textContent.trim(); });
  ok(heads.indexOf('Coming up') > -1, 'the coordinator dashboard lists the coming-up card');
  ok($('#maintDue') !== null && $$('#maintDue li').length > 0,
     'the coming-up card carries the scheduled visits');
  var link = $('#maintLink');
  ok(link !== null && /maintenance\.html/.test(link.getAttribute('href')),
     'the coming-up card opens the maintenance schedule');
  close(p);
});

tests.push(async function pwaCachePolicy() {
  /* Required test 78: the worker caches the shell and nothing that carries a
     record, and a sign-out tells it to drop what it held. */
  var swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  var block = /var NEVER_CACHE = \[([\s\S]*?)\];/.exec(swSrc);
  ok(block !== null, 'the worker declares the routes it must never cache');
  var listed = block ? block[1].split('\n').map(function (l) {
    var m = /'([^']+)'/.exec(l);
    return m ? m[1] : '';
  }).filter(Boolean) : [];
  ok(listed.indexOf('/api/') === 0, 'the never-cache list starts at the API root');

  var jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(function (f) { return f.endsWith('.js'); });
  var called = {};
  jsFiles.forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    var re = /['"`](\/api\/[a-z-]+)/g;
    var m;
    while ((m = re.exec(src)) !== null) called[m[1]] = 1;
  });
  var names = Object.keys(called).sort();
  var uncovered = names.filter(function (pathName) {
    return !listed.some(function (p) { return pathName.indexOf(p) === 0; });
  });
  ok(names.length > 0 && uncovered.length === 0,
     'every API route the client calls is on the never-cache list (' + names.length +
     ' routes' + (uncovered.length ? ', missing ' + uncovered.join(',') : '') + ')');

  var shell = /var SHELL = \[([\s\S]*?)\];/.exec(swSrc);
  var shellItems = shell ? shell[1].split('\n').map(function (l) {
    var m = /'([^']+)'/.exec(l);
    return m ? m[1] : '';
  }).filter(Boolean) : [];
  ok(shellItems.every(function (s) { return s.indexOf('/api/') !== 0; }),
     'the precached shell lists no API route');

  ok(/ITC_CLEAR_PRIVATE_DATA/.test(swSrc), 'the worker answers the sign-out clear message');
  var apiSrc = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
  var posts = (apiSrc.match(/ITC_CLEAR_PRIVATE_DATA/g) || []).length;
  ok(posts >= 2, 'a sign-out posts the clear message to the live worker and the registration (' +
     posts + ' call sites)');
  /* the manifest itself, and every icon it lists, is covered by pwaShell */
});

/* Audit row 83: the ticket register against Appendix E.1.  The columns, the
   sort, the column picker, the row marks, the pager, the toolbar, the printed
   copy and the export are read per lane, so a change to the register cannot
   quietly drop a column an office relies on or hand a lane a control the map
   keeps from it. */
tests.push(async function ticketListContract() {
  var CONSOLE = fs.readFileSync(path.join(ROOT, 'css', 'console.css'), 'utf8');
  var PRINT = CONSOLE.slice(CONSOLE.indexOf('@media print'));
  var HEAD_ALL = ['Ticket', 'Office / requester', 'Status', 'Priority', 'Target',
    'Technician', 'Last update'];
  var LANES = [
    { role: 'requester', page: 'or-tickets.html', rec: 'or-ticket.html',
      cols: ['Office / requester', 'Status', 'Target', 'Last update'],
      pick: ['office', 'status', 'target', 'updated'] },
    { role: 'technician', page: 'itc-tickets.html', rec: 'itc-ticket.html',
      cols: ['Office / requester', 'Status', 'Target', 'Technician', 'Last update'],
      pick: ['office', 'status', 'target', 'tech', 'updated'] },
    { role: 'coordinator', page: 'ic-tickets.html', rec: 'ic-ticket.html',
      cols: HEAD_ALL.slice(1),
      pick: ['office', 'status', 'priority', 'target', 'tech', 'updated'] }
  ];
  /* What the sheets take from a lane, read from the class hooks the register
     uses: a column is hidden by rule, never by a saved picker state. */
  function laneHidden(role, th) {
    var cls = th.className.split(/\s+/);
    if (cls.indexOf('lead-only') > -1 && (role === 'requester' || role === 'technician')) return true;
    if (cls.indexOf('staff-only') > -1 && role === 'requester') return true;
    return false;
  }

  for (var li = 0; li < LANES.length; li++) {
    var lane = LANES[li];
    var p = await open(BASE + lane.page);
    ok(p.errors.length === 0, lane.role + ': the register opens with no script error' +
      (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));

    /* --- 1. the columns, in order, with nothing private among them --- */
    var ths = $$('#tkTable thead th');
    var label = function (th) {
      var b = th.querySelector('.th-sort');
      /* The direction mark is part of the header but not part of its name. */
      return (b ? b.childNodes[0].textContent : th.textContent).trim();
    };
    var allHeads = ths.map(label);
    ok(ths.length === 8 && $('#tkTable thead #tkAll') !== null && allHeads[0] === '',
      lane.role + ': the first column is the selection box, not a data field');
    ok(allHeads.slice(1).join(',') === HEAD_ALL.join(','),
      lane.role + ': the register carries the Appendix E.1 columns in order (' +
      allHeads.slice(1).join(', ') + ')');
    var shownHeads = ths.slice(1).filter(function (th) { return !laneHidden(lane.role, th); })
      .map(label);
    ok(shownHeads.join(',') === ('Ticket,' + lane.cols),
      lane.role + ': the ' + lane.role + ' lane is left with ' + lane.cols.join(', ') + ' (' +
      shownHeads.join(', ') + ')');
    ok(!/cost/i.test(allHeads.join(' ')) && !/delete/i.test(allHeads.join(' ')),
      lane.role + ': no column prints an internal cost and none offers a delete');
    var deleteControls = $$('.card-head button, .card-head a, .bulk-bar button, #tkBody button')
      .filter(function (b) { return /delete|remove/i.test(b.textContent); });
    ok(deleteControls.length === 0,
      lane.role + ': no painted control on the register offers a delete');

    /* --- 2. the sort: one live column, its direction, and its mark --- */
    var sortable = $$('#tkTable th[data-sort-key]');
    ok(sortable.length === 5,
      lane.role + ': the headers name a sort key where the query answers one (' + sortable.length + ')');
    var markless = sortable.filter(function (th) {
      var s = th.getAttribute('aria-sort');
      return th.querySelector('.th-sort') === null ||
        (s !== 'ascending' && s !== 'descending' && s !== 'none');
    });
    ok(markless.length === 0,
      lane.role + ': every sortable header carries a control and a real aria-sort state');
    var live = $$('#tkTable th[aria-sort]').filter(function (th) {
      return th.getAttribute('aria-sort') !== 'none';
    });
    ok(live.length === 1, lane.role + ': exactly one header shows the live sort (' + live.length + ')');
    ok(live.length === 1 && /Last update/.test(live[0].textContent) &&
      live[0].getAttribute('aria-sort') === 'descending',
      lane.role + ': the register opens sorted by last update, descending');
    ok(live.length === 1 && live[0].querySelector('.th-mark').textContent.trim() !== '',
      lane.role + ': the live header carries its direction mark');
    ok($('#fSort').value === 'updated' && $('#fOrder').value === 'desc',
      lane.role + ': the filter selects agree with the header');
    ok($('#tkAdv').hidden === true, lane.role + ': the advanced fields start folded away');
    $('#tkMore').click();
    ok($('#tkAdv').hidden === false, lane.role + ': one click opens the advanced fields');

    var idTh = $('#tkTable th[data-sort-key="id"]');
    idTh.click();
    ok(idTh.getAttribute('aria-sort') === 'descending',
      lane.role + ': a header click sorts by that column');
    idTh.click();
    ok(idTh.getAttribute('aria-sort') === 'ascending' &&
      $$('#tkTable th[aria-sort="descending"]').length === 0,
      lane.role + ': a second click turns the same column around');
    var ids = $$('#tkBody .t-id').map(function (c) { return c.textContent.trim(); });
    ok(ids.length >= 1, lane.role + ': the register lists rows for this lane to read (' + ids.length + ')');
    if (ids.length > 1) {
      ok(ids.join(',') === ids.slice().sort().join(','),
        lane.role + ': the rows really come back in ticket number order (' + ids.slice(0, 3).join(' ') + ')');
    }
    ok($('#fSort').value === 'id' && $('#fOrder').value === 'asc',
      lane.role + ': the filter selects follow the header, not the other way round');

    var prioTh = $('#tkTable th[data-sort-key="priority"]');
    prioTh.click();
    if (lane.role === 'requester' || lane.role === 'technician') {
      ok($('#fSort').value === 'id' && prioTh.getAttribute('aria-sort') === 'none',
        lane.role + ': the priority header offers no sort to a lane that is not shown priority');
    } else {
      ok($('#fSort').value === 'priority' && prioTh.getAttribute('aria-sort') === 'descending',
        lane.role + ': the coordinator can sort the register by priority');
    }

    /* --- 3. the rows: a real link, the marks, and the pager total --- */
    var rows = $$('#tkBody tr');
    var total = /^(\d+) of (\d+)$/.exec($('#tkTotal').textContent.trim());
    ok(total !== null, lane.role + ': the results head counts the rows and the register ("' +
      $('#tkTotal').textContent.trim() + '")');
    ok(rows.length > 0 && rows.length <= 20,
      lane.role + ': one page holds at most twenty rows (' + rows.length + ')');
    if (total && rows.length) {
      ok(rows.length === Math.min(20, parseInt(total[1], 10)),
        lane.role + ': the rows on the page match the count in the head');
    }
    var links = $$('#tkBody .t-link');
    ok(links.length === rows.length && links.length > 0,
      lane.role + ': every row numbers its ticket with a link (' + links.length + ' of ' + rows.length + ')');
    ok(links.every(function (a) { return a.getAttribute('href').indexOf(lane.rec + '?id=IT-') === 0; }),
      lane.role + ': the ticket link stays inside the ' + lane.role + ' lane');
    var marks = $$('#tkBody .t-mark');
    ok(marks.length > 0, lane.role + ': a row carries the attachment and reply marks (' + marks.length + ')');
    ok($$('#tkBody .t-mark svg').length > 0, lane.role + ': the marks carry their glyph');
    ok(marks.every(function (m) { return /\d/.test(m.textContent); }),
      lane.role + ': no mark rests on the glyph alone; each names its count');
    var unread = $$('#tkBody .t-title.is-unread');
    var unreadNotifs = p.w.Store.db.notifications.filter(function (n) {
      return n.ticketId && (n.role === lane.role || n.role === 'any') &&
        !p.w.UI.notifRead(n);
    }).length;
    ok(unread.length === 0 || unreadNotifs > 0,
      lane.role + ': a bold subject only appears while this lane has unread news (' +
      unread.length + ' rows, ' + unreadNotifs + ' notices)');
    var pager = $('#tkPagination');
    ok(pager !== null && (pager.querySelector('.pagination') === null ||
      /of \d+/.test(pager.textContent)),
      lane.role + ': the pager either steps the pages or leaves the count to the head (' +
      $$('#tkPagination [data-p]').length + ' page buttons)');

    /* --- 4. the column picker only removes what this lane may see --- */
    var pickBoxes = $$('#tkColsList [data-col]');
    var pickKeys = pickBoxes.map(function (b) { return b.getAttribute('data-col'); });
    ok(pickKeys.join(',') === lane.pick.join(','),
      lane.role + ': the picker offers exactly the columns this lane sees (' + pickKeys.join(', ') + ')');
    ok(pickBoxes.every(function (b) { return b.checked === true; }),
      lane.role + ': the picker starts with every offered column shown');
    var updBox = pickBoxes.filter(function (b) { return b.getAttribute('data-col') === 'updated'; })[0];
    if (updBox) {
      updBox.checked = false;
      updBox.dispatchEvent(new p.w.Event('change', { bubbles: true }));
      ok($('#tkTable').className.indexOf('hide-updated') > -1,
        lane.role + ': turning a column off takes it out of the table');
      ok(p.w.localStorage.getItem('itc_ticket_cols_' + lane.role) === '["updated"]',
        lane.role + ': the choice is remembered per lane, so no other lane inherits it');
      updBox.checked = true;
      updBox.dispatchEvent(new p.w.Event('change', { bubbles: true }));
      ok($('#tkTable').className.indexOf('hide-updated') === -1,
        lane.role + ': turning it back on returns the column');
    }
    if (lane.role !== 'coordinator') {
      ok(lane.pick.indexOf('priority') === -1,
        lane.role + ': the picker never offers the priority column');
    }
    if (lane.role === 'requester') {
      ok(lane.pick.indexOf('tech') === -1,
        lane.role + ': the picker never offers the technician column');
    }

    /* --- 5. the printed copy --- */
    var printBtn = $('#tkPrint');
    ok(printBtn !== null && /Print/.test(printBtn.textContent),
      lane.role + ': the register offers a printed list');
    var printHead = $('#tkPrintHead');
    ok(printHead !== null && printHead.querySelector('.print-brand') !== null &&
      /University of the Philippines Cebu/.test(printHead.querySelector('.print-brand').textContent),
      lane.role + ': the printed copy carries the letterhead');
    ok(printHead.querySelector('h1') !== null && /Service tickets/.test(printHead.querySelector('h1').textContent),
      lane.role + ': the printed copy names what it holds');
    var meta = printHead.querySelector('.print-meta').textContent.replace(/\s+/g, ' ');
    ok(/Queue: /.test(meta) && /Sorted by/.test(meta),
      lane.role + ': the printed copy states the queue and the order');
    ok(/\d+ of \d+ ticket|All \d+ ticket/.test(meta),
      lane.role + ': the printed copy counts the records on the page');
    ok(PRINT.indexOf('.col-pick') > -1 && /button\{display:none !important\}/.test(PRINT),
      lane.role + ': the picker, the buttons and the layout chips leave the paper');

    /* --- 6. the export the lane can press --- */
    var head = p.w.exportHead(lane.role);
    ok(head[0] === 'Ticket' && head.indexOf('Status') > -1,
      lane.role + ': the export starts at the ticket and carries the status');
    if (lane.role === 'requester') {
      ok(['Priority', 'Technician', 'Cost'].every(function (c) { return head.indexOf(c) === -1; }),
        lane.role + ': the office export holds no priority, technician or cost');
    } else if (lane.role === 'technician') {
      ok(head.indexOf('Priority') === -1 && head.indexOf('Technician') > -1,
        lane.role + ': the technician export holds no priority but keeps the assignee');
    } else {
      ok(['Priority', 'Technician', 'Cost'].every(function (c) { return head.indexOf(c) > -1; }),
        lane.role + ': the coordinator export holds the fields the coordinator is shown');
    }
    ok($('#tkExport') !== null && /Export CSV/.test($('#tkExport').textContent),
      lane.role + ': the register offers the CSV export');
    close(p);
  }

  /* --- 7. the overdue register: tinted and worded, never colour alone --- */
  var od = await open(BASE + 'ic-tickets.html?queue=overdue');
  var odRows = $$('#tkBody tr');
  ok(od.errors.length === 0, 'the overdue queue opens with no script error');
  ok(odRows.length > 0, 'the register has overdue work to show (' + odRows.length + ' rows)');
  ok(odRows.every(function (tr) { return tr.className.indexOf('row-overdue') > -1; }),
    'every row in the overdue queue carries the overdue row class');
  ok(odRows.every(function (tr) { return /Overdue/.test(tr.querySelector('.col-status').textContent); }),
    'and every one of them says the word Overdue, not only the tint');
  ok(/\.table tbody tr\.row-overdue td\{background:var\(--danger-bg\)\}/.test(CONSOLE),
    'the tint comes from a theme token, so the dark palette keeps it too');
  close(od);

  /* --- 8. the selection toolbar belongs to the lane that may assign --- */
  var co = await open(BASE + 'ic-tickets.html');
  var firstBox = $('#tkBody [data-sel]');
  ok(firstBox !== null, 'the coordinator register offers a box per row');
  firstBox.checked = true;
  firstBox.dispatchEvent(new co.w.Event('change', { bubbles: true }));
  ok($('#tkBulk').hidden === false, 'a selection reveals the bulk toolbar');
  ok($('#tkBulkAssign').hidden === false && /assign/i.test($('#tkBulkAssign').textContent),
    'the toolbar offers the coordinator the assign move');
  ok(!/status|transition/i.test($('#tkBulk').textContent),
    'the toolbar offers no bulk status move that could skip a required field');
  close(co);
  var req = await open(BASE + 'or-tickets.html');
  ok($('#tkBulkAssign').hidden === true, 'the office lane is not offered bulk assign at all');
  close(req);

  /* --- 9. the whole register: one page of twenty, and the pager steps --- */
  var all = await open(BASE + 'ic-tickets.html?queue=all');
  var tot = /^(\d+) of (\d+)$/.exec($('#tkTotal').textContent.trim());
  ok(all.errors.length === 0, 'the whole register opens with no script error');
  ok(tot !== null && parseInt(tot[1], 10) > 3,
    'the register holds more than one small page ("' + $('#tkTotal').textContent.trim() + '")');
  /* The page size is the register's own. The harness lowers it so the pager is
     driven on the seeded dataset instead of sitting unexercised on one page. */
  all.w.PER_PAGE = 3;
  all.w.render();
  ok($$('#tkBody tr').length === 3, 'a page holds the rows its own size allows (' + $$('#tkBody tr').length + ')');
  /* The default order is the one the head states: newest change first. */
  var stamps = $$('#tkBody tr').map(function (tr) {
    var id = decodeURIComponent(tr.querySelector('.t-link').getAttribute('href').split('id=')[1]);
    var t = all.w.Store.getTicket(id);
    return (t && (t.updatedAt || t.createdAt)) || '';
  });
  ok(stamps.every(function (s, i) { return i === 0 || stamps[i - 1] >= s; }),
    'the rows really come back newest change first');
  var info = $('#tkPagination .pagination-info');
  ok(info !== null && /1 to 3 of \d+/.test(info.textContent.replace(/\s+/g, ' ')),
    'the pager states the range and the whole ("' +
    (info ? info.textContent.replace(/\s+/g, ' ').trim() : '') + '")');
  var before = $$('#tkBody .t-id').map(function (c) { return c.textContent.trim(); });
  var page2 = $('#tkPagination [data-p="2"]');
  ok(page2 !== null, 'the pager offers the next page');
  if (page2) {
    page2.click();
    var after = $$('#tkBody .t-id').map(function (c) { return c.textContent.trim(); });
    ok(after.length > 0 && after.join(',') !== before.join(','),
      'page two lists different records (' + after.length + ' rows)');
    ok($('#tkPagination [aria-current="page"]') !== null &&
      $('#tkPagination [aria-current="page"]').textContent.trim() === '2',
      'the pager marks the page the reader is on');
    ok($$('#tkBody tr').length === Math.min(3, parseInt(tot[1], 10) - 3),
      'the next page holds what is left (' + $$('#tkBody tr').length + ' rows)');
  }
  close(all);
});

/* ---------- run ---------- */
startServer().then(async function (srv) {
  ACTIVE_SRV = srv;
  console.log('serving ' + ROOT + ' at ' + BASE + '\n');
  for (var i = 0; i < tests.length; i++) {
    try { await tests[i](); }
    catch (e) { fail++; console.log('FAIL  ' + tests[i].name + ' threw: ' + (e && e.stack || e)); }
  }
  stopServer(srv);
  console.log('\nPAGE TESTS: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) {
  console.error('harness error:', e);
  process.exit(2);
});
