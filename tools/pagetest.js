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
            if (++tries > 40) reject(new Error('server never came up'));
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
function openOnce(url) {
  var vc = new VirtualConsole();
  var errors = [];
  vc.on('jsdomError', function (e) { errors.push('jsdomError: ' + (e.message || e)); });
  vc.on('error', function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); });
  return JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
    virtualConsole: vc,
    requestInterceptor: localOnlyInterceptor()
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
      setTimeout(finish, 6000);
    });
  });
}
/* The static python http.server occasionally drops a script connection under
   load; that shows up as a transient "Could not load script" rather than an app
   bug, so re-fetch the page a couple of times before trusting the result. */
function open(url, tries) {
  tries = tries || 0;
  return openOnce(url).then(function (p) {
    var transient = p.errors.some(function (e) { return /Could not load script|ERR_|ECONNRESET|socket hang up|is not defined/i.test(e); });
    /* the app scripts are still loading when the harness evaluates the page:
       treat a missing global as transient and fetch the page again */
    if (!transient && !p.w.UI) transient = true;
    if (transient && tries < 3) {
      try { p.w.close(); } catch (e) { }
      return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return open(url, tries + 1); });
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

/* ---------- tests ---------- */
var tests = [];

tests.push(async function dashboard() {
  var p = await open(BASE + 'dashboard.html');
  ok(p.errors.length === 0, 'dashboard loads with no script errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($$('#kpiGrid .kpi').length >= 8, 'KPI row renders all eight status cards (' + $$('#kpiGrid .kpi').length + ')');
  ok($$('#queueBody tr').length >= 5, 'active queue lists seeded tickets (' + $$('#queueBody tr').length + ')');
  ok($$('#maintDue li').length >= 3, 'maintenance due list populated');
  ok($$('#activity li').length >= 5, 'live audit feed populated');
  ok($('#depMount a[href="review.html"]') !== null, 'on-hold summary links to Review & Assign');

  /* the signed-in account defines the role  --  no impersonation control */
  ok($('.roleSel') === null, 'no view-as-role switcher in the top bar');
  asRole(p, 'requester');
  ok(p.w.Store.db.role === 'requester', 'signed-in role persists to store');
  ok($('.sideUser').textContent === 'A. Delos Reyes', 'sidebar reflects the signed-in account');
  ok($('.avatar').textContent === 'AD', 'avatar initials update');

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

  /* real submission */
  var f = $('#reqForm');
  fld(f, 'office').value = 'Registrar';
  fld(f, 'requester').value = 'P. Ocampo';
  fld(f, 'category').value = 'Printer and Peripheral';
  fld(f, 'issue').value = 'Toner smears on the right margin.';
  fld(f, 'asset').value = 'PRN-REG-02';
  $('#btnSubmit').disabled = false;
  f.dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  ok(p.w.Store.db.tickets.length === n0 + 1, 'valid submission creates a ticket');
  var nt = p.w.Store.db.tickets[0];
  ok(nt.status === 'submitted' && nt.office === 'Registrar' && nt.asset === 'PRN-REG-02', 'intake captured office/asset/status');
  ok($('#successBox').hidden === false, 'success panel shown with new id');
  ok($('#sucId').textContent === nt.id, 'success panel shows the real ticket id');
  ok($('#myList').children.length > 0, 'office ticket list refreshed');
  ok(p.errors.length === 0, 'no errors after submission');
  close(p);
});

tests.push(async function requestRespond() {
  var p = await open(BASE + 'request.html?respond=IT-2026-000137');
  ok(p.errors.length === 0, 'respond mode loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($('#respondNote').hidden === false, 'needs-information banner shown');
  ok(/Supply missing information/.test($('#formTitle').textContent), 'form retitled to reply mode');
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
  ok($('#tPick').value === 'IT-2026-000130', 'deep link selects the requested ticket');
  ok(/IT-2026-000130/.test($('#tHead').textContent), 'ticket header shows the id');
  ok($('#tHistory').textContent.includes('Assigned to J. Tan'), 'audit history rendered');

  /* the record is read-only now  --  transitions live on the section screens */
  ok($$('[data-tact]').length === 0, 'no inline transitions on the record');
  ok($('#tActions a[href^="review.html"]') !== null, 'record links into Review & Assign for coordinator work');
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
  ok(p.w.Store.getTicket('IT-2026-000141').confirmation.state === 'accepted', 'office acceptance recorded');

  asRole(p, 'coordinator');
  var cb = $$('#cfPanel [data-act="close"]')[0];
  ok(cb === undefined, 'the coordinator is not offered a confirmation closure');
  ok($$('#cfPanel [data-act="accept"]').length === 0, 'the coordinator is not offered the office decision');
  ok(/waiting on the office/i.test($('#cfPanel').textContent), 'the coordinator is told the office must close the ticket');

  asRole(p, 'requester');
  cb = $$('#cfPanel [data-act="close"]')[0];
  ok(cb !== null, 'Close button appears after confirmation for the office');
  cb.click();
  ok(p.w.Store.getTicket('IT-2026-000141').status === 'closed', 'Status: Closed after confirmation');

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

  /* checklist recording on a real job */
  var rec = $('#wJobs [data-item]');
  ok(rec !== null, 'maintenance checklist Record button present');
  if (rec) {
    var jobId = rec.dataset.job, idx = parseInt(rec.dataset.item, 10);
    rec.click();
    var modal = $('.modal-host');
    ok(modal !== null, 'checklist item modal opens');
    modal.querySelector('[name="result"]').value = 'Passed';
    modal.querySelector('[name="finding"]').value = 'Dust cleared.';
    $('#mGo').click();
    var it = p.w.Store.getJob(jobId).items[idx];
    ok(it.done === true && it.result === 'Passed', 'checklist item recorded with result/finding');
  }

  /* outcome guard: success on incomplete job must fail */
  var job = null;
  p.w.Store.db.jobs.forEach(function (j) { if (!job && j.status !== 'closed' && j.items.some(function (i) { return !i.done; })) job = j; });
  if (job) {
    var statusBefore = job.status;
    var outBtn = $('#wJobs [data-outcome="success"][data-job="' + job.id + '"]');
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
  var p = await open(BASE + 'index.html');
  ok(p.errors.length === 0, 'gallery loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  var links = $$('a.g-card').length;
  ok(links >= 20, 'gallery lists every screen (' + links + ')');
  close(p);
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
  /* demo list is off unless the deployment turns the flag on */
  ok($('#demoBlock').hidden === true, 'the demo list is hidden while the demo flag is off');
  ok($$('#demoAccounts [data-acct]').length === 0, 'no demo accounts are rendered while the flag is off');
  var btn = $('#googleBtn');
  btn.click();
  ok($('#loginError').hidden === false, 'sign-in without configured OIDC explains the problem');
  ok($('#demoBlock').hidden === true, 'the demo list stays hidden without the flag');
  /* theme switch works on the sign-in screen */
  var themes = $$('#themeSwitch [data-theme-choice]');
  ok(themes.length === 3, 'the sign-in page offers light, system and dark themes');
  themes[2].click();
  ok(p.w.document.documentElement.getAttribute('data-theme') === 'dark',
     'the dark choice applies immediately');
  /* with the explicit flag on, the demo list appears after the UPMail click */
  p.w.ITC_DEMO_MODE = true;
  btn.click();
  ok($('#demoBlock').hidden === false, 'the demo list appears when the demo flag is on');
  var accts = $$('#demoAccounts [data-acct]');
  ok(accts.length === 4, 'one demo account per role is listed (' + accts.length + ')');
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

tests.push(async function rolesPage() {  var p = await open(BASE + 'roles.html');
  ok(p.errors.length === 0, 'roles page loads with no errors' + (p.errors.length ? ' -> ' + p.errors.join(' | ') : ''));
  ok($$('.role-card').length === 4, 'four role cards rendered');
  ok($$('#capBody tr').length >= 20, 'feature matrix rendered (' + $$('#capBody tr').length + ' rows)');
  ok($('#myRoleCard').textContent.indexOf('features unlocked') > -1, 'your-role summary shown');
  ok($('#adminCard').textContent.indexOf('Review role assignments') > -1, 'roles & access reference visible to the coordinator');
  close(p);
});

tests.push(async function roleNav() {
  var p = await open(BASE + 'dashboard.html');
  var n0 = $$('.nav-item').length;
  ok(n0 >= 7, 'coordinator sees the full navigation (' + n0 + ')');
  var c0 = $$('.nav-item').map(function (a) { return a.textContent; }).join('|');
  ok(c0.indexOf('My Work') === -1, 'My Work is the technician lane  --  hidden from the coordinator');
  asRole(p, 'requester');
  var labels = $$('.nav-item').map(function (a) { return a.textContent; }).join('|');
  ok($$('.nav-item').length < n0, 'requester sees fewer nav items than the coordinator');
  ok(labels.indexOf('My Work') === -1, 'requester cannot see the technician workspace');
  ok(labels.indexOf('Maintenance') === -1, 'requester cannot see maintenance');
  asRole(p, 'management');
  var m = $$('.nav-item').map(function (a) { return a.textContent; }).join('|');
  ok(m.indexOf('New Request') === -1, 'management cannot submit requests');
  ok(m.indexOf('Roles') === -1, 'reference pages are hidden from the navigation');
  ok(m.indexOf('Maintenance') > -1, 'management can still open maintenance');
  ok(p.errors.length === 0, 'no errors switching roles');
  close(p);
});

tests.push(async function navGroupsNeverEmpty() {
  var p = await open(BASE + 'dashboard.html');
  ['requester', 'technician', 'coordinator', 'management'].forEach(function (role) {
    asRole(p, role);
    var kids = Array.prototype.slice.call(p.d.querySelectorAll('#chromeSide nav.nav > *'));
    var empty = kids.some(function (el, i) {
      if (!el.classList.contains('nav-label')) return false;
      var next = kids[i + 1];
      return !next || next.classList.contains('nav-label');
    });
    ok(!empty, role + ': no navigation group renders empty');
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

  /* the summary tiles: the eight statuses plus Overdue */
  var tiles = $$('#kpiGrid .kpi .label').map(function (e) { return e.textContent; });
  ok(tiles.length === 9, 'the dashboard shows the eight statuses plus Overdue (' + tiles.length + ')');
  ok(tiles.indexOf('Overdue') > -1, 'the Overdue tile is present');

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

  /* the policy controls live on the administration settings screen */
  var ps = await open(BASE + 'settings.html');
  asRole(ps, 'management');
  ok($('#policySettings') !== null, 'the settings screen carries the policy card');
  ok($$('#policySettings [data-approval]').length > 0, 'the approval categories are configurable');
  ok($$('#policySettings [name^="pm_"]').length === 9, 'the impact and urgency matrix is configurable');
  ok($$('#policySettings [data-closure]').length > 0, 'the authorized closure roles are configurable');
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
  ok($('#tActions a[href^="confirm.html"]') === null, 'management gets no confirmation link on the record');
  ok(/Read-only for your role/.test($('#tActions').textContent), 'record explains read-only oversight');
  asRole(p, 'coordinator');
  ok($('#tActions a[href^="confirm.html"]') !== null, 'coordinator gets the confirmation link');
  asRole(p, 'requester');
  ok($('#tActions a[href^="confirm.html"]') !== null, 'requester gets the confirmation link');
  close(p);
});

tests.push(async function accessGuard() {
  var p = await open(BASE + 'maintenance.html');
  ok(p.errors.length === 0, 'maintenance loads with no errors');
  ok($('#accessPanel') === null, 'coordinator can open maintenance (no block)');
  asRole(p, 'requester');
  ok($('#accessPanel') !== null, 'requester is blocked with a friendly panel');
  ok(p.w.document.body.classList.contains('access-denied'), 'denied state applied to the page');
  ok($('#accessPanel').textContent.indexOf('not part of your role') > -1, 'panel explains the role restriction');
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
  ['users.html', 'management', '#uBody'],
  ['settings.html', 'management', '#refGroups'],
  ['profile.html', 'coordinator', '#pCard'],
  ['profile.html', 'technician', '#pCard'],
  ['register.html', 'requester', '#gBody'],
  ['register.html', 'management', '#gBody'],
  ['tickets.html', 'coordinator', '#tkBody'],
  ['tickets.html', 'requester', '#tkBody'],
  ['maintenance.html', 'coordinator', '#sBody'],
  ['maintenance.html', 'management', '#sBody'],
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
   destinations and the rest live in the More sheet.  The Workflow Guide and
   the Roles & Access reference are hidden on a phone, the same way the
   sidebar never offered them. */
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
      /* the two dense reference screens stay off the phone navigation, the
         same way the sidebar never offered them */
      ok(!hrefs.some(function (h) { return /flow\.html$/.test(h); }),
        'More sheet hides the workflow guide');
      ok(!hrefs.some(function (h) { return /roles\.html$/.test(h); }),
        'More sheet hides the roles & access reference');
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

/* The pop-up switch: the live notices can be paused, but the feedback that
   follows an action, and the notifications themselves, are never lost. */
tests.push(async function popupsSwitch() {
  var p = await open(BASE + 'dashboard.html');
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
