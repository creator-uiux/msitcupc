/* Node smoke test: stubs browser globals, loads store/ui/flow/live, exercises
   every flowchart branch. Run: node tools\smoke.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

var mem = {};
function makeEl() {
  var el = {
    style: {}, dataset: {}, attrs: {}, children: [], className: '', innerHTML: '', textContent: '',
    classList: { add: function () { }, remove: function () { }, toggle: function () { }, contains: function () { return false; } },
    appendChild: function (c) { this.children.push(c); c.parentNode = this; return c; },
    remove: function () {
      var p = this.parentNode;
      if (p && p.children) { var i = p.children.indexOf(this); if (i > -1) p.children.splice(i, 1); }
    },
    addEventListener: function () { },
    removeEventListener: function () { },
    setAttribute: function (k, v) { this.attrs[k] = v; },
    getAttribute: function (k) { return this.attrs[k] || null; },
    hasAttribute: function (k) { return k in this.attrs; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    focus: function () { }
  };
  Object.defineProperty(el, 'firstChild', { get: function () { return this.children[0] || null; } });
  return el;
}
var sandbox = {
  console: console, Math: Math, Date: Date, JSON: JSON, RegExp: RegExp,
  String: String, Number: Number, Array: Array, Object: Object, Error: Error,
  setTimeout: setTimeout, setInterval: function () { return 0; }, clearInterval: function () { },
  document: {
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    getElementById: function () { return null; },
    addEventListener: function () { },
    createElement: makeEl,
    body: makeEl(),
    hidden: false
  },
  location: { search: '', pathname: '/x.html' },
  localStorage: {
    getItem: function (k) { return mem[k] || null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  },
  addEventListener: function () { },
  removeEventListener: function () { },
  window: null
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(f) {
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(src, sandbox, { filename: f });
}
['store.js', 'ui.js', 'flow.js', 'live.js'].forEach(load);

var S = sandbox.Store, F = sandbox.Flow, M = sandbox.Maint, U = sandbox.UI;
var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log('FAIL  ' + label); }
}
function setRole(r) { S.update(function (db) { db.role = r; }); }

console.log('--- intake & review (Section 1) ---');
setRole('requester');
var r = F.createTicket({ office: 'Library', requester: 'M. Bataller', category: 'Hardware Repair', source: 'email', issue: 'Projector remote not responding', asset: 'PJ-LIB-01' });
ok(r.ok && /^IT-\d{4}-\d{6}$/.test(r.id || ''), 'submit request -> Status: Submitted (' + r.id + ')');
var id = r.id;
var t = S.getTicket(id);
ok(t.status === 'submitted', 'status submitted');

setRole('coordinator');
r = F.requestInfo(id, 'lamp hours + room number');
ok(r.ok && t.status === 'needs_info', 'Details complete? No -> Needs Information');
setRole('requester');
r = F.submitInfo(id, { issue: 'Projector remote not responding  --  lamp 2,140h', asset: 'PJ-LIB-01', note: 'lamp hours' });
ok(r.ok && S.getTicket(id).status === 'submitted', 'supply missing information -> return to review (same ticket, no duplicate)');
ok(S.db.tickets.filter(function (x) { return x.office === 'Library' && x.issue.indexOf('Projector') === 0; }).length === 1, 'no duplicate ticket created');

setRole('coordinator');
r = F.assign(id, 'J. Tan');
ok(!r.ok, 'assign blocked before assessment');
r = F.assess(id, { impact: 'Medium', urgency: 'High', priority: 'high', target: '2026-10-12' });
ok(r.ok, 'assess impact/urgency + priority + target');
r = F.assign(id, 'J. Tan');
ok(r.ok && S.getTicket(id).status === 'assigned', 'Status: Assigned + notify technician and requester');
ok(S.db.notifications.some(function (n) { return n.ticketId === id && n.role === 'technician'; }), 'technician notified');
ok(S.db.notifications.some(function (n) { return n.ticketId === id && n.role === 'requester'; }), 'requester notified');

console.log('--- technician lane (diagnose, hold, test) ---');
setRole('technician');
r = F.recordTest(id, 'pass', 'early');
ok(!r.ok, 'testing blocked before diagnosis (SOP 13 before 14)');
r = F.startWork(id);
ok(!r.ok, 'work cannot start before the visit is coordinated (SOP 10)');
r = F.coordinate(id, { date: '2026-10-11', slot: 'Morning', tech: 'J. Tan' });
ok(r.ok, 'service schedule coordinated');
r = F.startWork(id);
ok(r.ok && S.getTicket(id).status === 'in_progress', 'Status: In Progress');
r = F.diagnose(id, { findings: 'Lamp beyond service life', actions: 'Replaced lamp', cost: 3200, labor: 0.5 });
ok(r.ok, 'diagnosis recorded with parts/cost/labor/evidence');
r = F.placeHold(id, { reason: 'Replacement lamp awaiting approval', responsible: 'IT Coordinator', nextAction: 'Approve PO' });
ok(r.ok && S.getTicket(id).status === 'on_hold', 'Parts needed? Yes -> Status: On Hold + dependency');
r = F.recordTest(id, 'pass', 'no');
ok(!r.ok, 'testing blocked while on hold');

setRole('coordinator');
r = F.followUp(id, 'PO approved by director');
ok(r.ok, 'Dependency outcome? Still pending -> record follow-up update');
r = F.cancelFromDependency(id, 'lamp stock exhausted');
ok(r.ok && S.getTicket(id).status === 'cancelled', 'Dependency outcome? Cannot proceed -> cancellation reason recorded');
ok(S.getTicket(id).cancelReason === 'lamp stock exhausted', 'cancellation reason preserved on record');
r = F.resolveDependency(id);
ok(!r.ok, 'resolve blocked after cancellation (terminal state)');
// build second ticket for resolution branch
setRole('requester');
var r2 = F.createTicket({ office: 'HR', requester: 'L. Sarmiento', category: 'Software Support', issue: 'App crash', asset: '' });
var id2 = r2.id;
setRole('coordinator');
F.assess(id2, { impact: 'Low', urgency: 'Low', priority: 'low', target: '2026-10-20' });
F.assign(id2, 'J. Tan');
setRole('technician');
F.coordinate(id2, { date: '2026-10-19', slot: 'Morning', tech: 'J. Tan' });
F.startWork(id2);
F.diagnose(id2, { findings: 'Crash in export module' });
F.placeHold(id2, { reason: 'Vendor patch required', responsible: 'Vendor', nextAction: 'Await patch' });
setRole('coordinator');
r = F.resolveDependency(id2);
ok(!r.ok, 'dependency resolution needs the outcome note');
r = F.resolveDependency(id2, 'Vendor delivered the patch');
ok(r.ok && S.getTicket(id2).status === 'in_progress', 'Dependency outcome? Resolved -> back to In Progress');

console.log('--- test / confirmation / closure / recurrence ---');
setRole('technician');
r = F.recordTest(id2, 'fail', 'crash persists on export');
ok(r.ok && S.getTicket(id2).status === 'in_progress', 'failed test -> return to diagnosis (loop)');
F.diagnose(id2, { findings: 'Patch applied' });
r = F.recordTest(id2, 'pass', 'export clean');
ok(r.ok && S.getTicket(id2).status === 'resolved', 'test passed -> Status: Resolved + office notified');
var conf = S.getTicket(id2).confirmation.state;
ok(conf === 'pending', 'confirmation pending (Section 3)');

setRole('coordinator');
r = F.close(id2, 'confirmation');
ok(!r.ok, 'close blocked without confirmation');
setRole('requester');
r = F.officeDecision(id2, 'accepted', { person: 'L. Sarmiento', feedback: '' });
ok(r.ok && S.getTicket(id2).confirmation.state === 'accepted', 'Office accepts result? Yes -> confirmation recorded');
setRole('coordinator');
r = F.close(id2, 'confirmation');
ok(!r.ok, 'the IT Coordinator cannot close by confirmation');
setRole('requester');
r = F.close(id2, 'confirmation');
ok(r.ok && S.getTicket(id2).status === 'closed', 'Status: Closed after confirmation');
setRole('requester');
r = F.createLinkedTicket(id2, { issue: 'App crash recurs' });
ok(r.ok && S.getTicket(r.id).linkedTo === id2, 'Issue recurs after closure? Yes -> linked ticket follows Section 1');
ok(S.getTicket(id2).recurring === true, 'previous record flagged recurring');

console.log('--- reject branch ---');
setRole('requester');
var r3 = F.createTicket({ office: 'Registrar', requester: 'P. Ocampo', category: 'Printer and Peripheral', issue: 'Faint print', asset: 'PRN-REG-02' });
setRole('coordinator');
F.assess(r3.id, { impact: 'Low', urgency: 'Medium', priority: 'medium', target: '2026-10-15' });
F.assign(r3.id, 'J. Tan');
setRole('technician');
F.coordinate(r3.id, { date: '2026-10-14', slot: 'Morning', tech: 'J. Tan' });
F.startWork(r3.id);
F.diagnose(r3.id, { findings: 'Drum worn' });
F.recordTest(r3.id, 'pass', 'test page ok');
setRole('requester');
r = F.officeDecision(r3.id, 'rejected', { person: 'P. Ocampo', feedback: 'Still faint on legal size' });
ok(r.ok && S.getTicket(r3.id).status === 'in_progress', 'Office accepts result? No -> feedback recorded, back to diagnosis');

console.log('--- cancel / withdrawal ---');
setRole('coordinator');
var r4 = F.createTicket({ office: 'SDG', requester: 'C. Yap', category: 'Other', issue: 'Monitor request', asset: '' });
setRole('requester');
F.createTicket({ office: 'SDG', requester: 'C. Yap', category: 'Other', issue: 'x', asset: '' });
setRole('coordinator');
var r5 = F.cancel(S.db.tickets[0].id, 'Active request withdrawn  --  office bought it');
ok(r5.ok && S.db.tickets[0].status === 'cancelled', 'Active request withdrawn -> Cancelled + reason recorded');
ok(S.db.notifications.some(function (n) { return n.kind === 'cancel'; }), 'requester notified of cancellation');

console.log('--- maintenance (Section 2 + 3) ---');
setRole('coordinator');
r = M.createSchedule({ office: 'Records Office', assets: ['PC-OF-119'], category: 'Hardware Repair', checklist: ['Dust', 'PSU'], frequency: 'quarterly', dueDate: '2020-01-01', technician: 'J. Tan' });
ok(r.ok, 'create maintenance schedule: office, assets, category, checklist, frequency, due date, technician');
r = M.createSchedule({ office: 'X', category: 'Hardware Repair', checklist: [], frequency: 'monthly', dueDate: '2026-12-01', technician: 'J. Tan' });
ok(!r.ok, 'schedule blocked without checklist');
r = M.createSchedule({ office: 'Registrar', assets: [], category: 'Hardware Repair', checklist: ['Filter check'], frequency: 'monthly', dueDate: '2026-12-01', technician: 'J. Tan' });
ok(r.ok, 'create a schedule that is not due yet');

var ev = M.runScheduleCheck(false);
console.log('   schedule check events:', ev.map(function (e) { return e.kind + ':' + e.id; }).join(', ') || '(none)');
ok(ev.some(function (e) { return e.kind === 'gen'; }), 'Maintenance due? Yes + job does not exist -> generate linked maintenance job');
var gen = ev.filter(function (e) { return e.kind === 'gen'; })[0];
var ev2 = M.runScheduleCheck(false);
ok(ev2.some(function (e) { return e.kind === 'exists'; }), 'Job already exists? Yes -> use existing job, do not duplicate');
ok(!ev2.some(function (e) { return e.kind === 'gen'; }), 'no duplicate job generated on re-check');
ok(ev2.some(function (e) { return e.kind === 'wait'; }), 'Maintenance due? No -> keep schedule active and wait');

var jobId = gen.jobId, job = S.getJob(jobId);
ok(!!job && job.items.length > 0, 'generated job has checklist items');
r = M.recordOutcome(jobId, 'success', '');
ok(!r.ok, 'outcome success blocked while checklist incomplete / fault unanswered');
r = M.confirmAvailability(jobId, true);
ok(r.ok, 'Office available? Yes -> visit coordinated');
setRole('technician');
for (var i = 0; i < job.items.length; i++) {
  r = M.recordChecklistItem(jobId, i, { result: 'Passed', finding: '' });
}
ok(r.ok, 'checklist items recorded with result/finding/tech/date');
job = S.getJob(jobId);
job.additionalFault = 'no';
r = M.recordOutcome(jobId, 'success', 'all clear');
ok(r.ok && S.getJob(jobId).status === 'resolved', 'Record maintenance outcome: the visit is completed and handed to the office');
ok(S.getJob(jobId).outcome === null, 'an open visit is never marked successful');
ok(S.getJob(jobId).confirmation.state === 'pending', 'Section 3 confirmation requested');
setRole('coordinator');
r = M.jobConfirmation(jobId, 'accepted', 'A. Delos Reyes');
ok(!r.ok, 'the IT Coordinator cannot confirm on the office\'s behalf');
setRole('requester');
r = M.jobConfirmation(jobId, 'accepted', 'A. Delos Reyes');
ok(r.ok && S.getJob(jobId).status === 'closed', 'Section 3: maintenance confirmed and closed');
ok(S.getJob(jobId).outcome === 'success', 'the system records the outcome when the visit closes');
ok(!!S.getJob(jobId).nextDue, 'Calculate next due date from frequency');

// failure-guard: incomplete cannot be successful
setRole('coordinator');
var ev3 = M.runScheduleCheck(true);
var job2 = null;
S.db.jobs.forEach(function (j) { if (!job2 && j.status === 'submitted') job2 = j; });
if (job2) {
  job2.additionalFault = 'no';
  var rr = M.recordOutcome(job2.id, 'success', 'x');
  ok(!rr.ok, '26.1 guard: incomplete maintenance cannot be marked successful');
}

// additional fault -> linked corrective ticket
if (job2) {
  job2.additionalFault = 'yes';
  setRole('technician');
  var rf = M.createFaultTicket(job2.id);
  ok(rf.ok && S.getTicket(rf.id) && S.getTicket(rf.id).linkedTo === job2.id, 'Additional fault? Yes -> Create linked corrective ticket following Section 1');
}

console.log('--- reschedule branch ---');
setRole('coordinator');
var rsJob = null;
S.db.jobs.forEach(function (j) { if (!rsJob && (j.status === 'coord_visit' || j.status === 'generated')) rsJob = j; });
if (rsJob) {
  r = M.rescheduleJob(rsJob.id, '2026-11-05', 'Office unavailable');
  ok(r.ok && S.getJob(rsJob.id).status === 'rescheduled', 'Office available? No -> Record reschedule -> agree new date');
}

console.log('--- office availability & repair (Requester lane + Technician lane) ---');
setRole('requester');
var availJob = null;
S.db.jobs.forEach(function (j) { if (!availJob && j.status === 'generated') availJob = j; });
if (availJob) {
  r = M.confirmAvailability(availJob.id, true);
  ok(r.ok, 'requester can confirm office availability (Office Requester lane)');
}
var reschedTarget = null;
S.db.jobs.forEach(function (j) { if (!reschedTarget && j.status !== 'closed' && j.status !== 'on_hold') reschedTarget = j; });
if (reschedTarget) {
  r = M.rescheduleJob(reschedTarget.id, '2026-12-20', 'Office examination week');
  ok(r.ok && S.getJob(reschedTarget.id).status === 'on_hold', 'requester can agree a new maintenance date');
}
setRole('technician');
var activeTk = null;
S.db.tickets.forEach(function (x) { if (!activeTk && x.status === 'in_progress' && x.diagnosis.findings) activeTk = x; });
if (activeTk) {
  r = F.recordRepair(activeTk.id, { actions: 'Replaced fan, cleaned vents', parts: 'Fan kit', cost: 500, labor: 1 });
  ok(r.ok && S.getTicket(activeTk.id).diagnosis.actions.indexOf('Replaced fan') > -1, 'Perform repair -> Record repair actions (IT Technician lane)');
}

console.log('--- role-based access (28.2) ---');
setRole('requester');
r = F.assess(S.db.tickets[0].id, { impact: 'Low', urgency: 'Low', priority: 'low', target: '2026-11-01' });
ok(!r.ok, 'requester cannot perform coordinator actions');
setRole('technician');
r = F.assign(S.db.tickets[1].id, 'J. Tan');
ok(!r.ok, 'technician cannot assign tickets');

console.log('--- reminder loop (15.3) ---');
setRole('coordinator');
var res = null;
S.db.tickets.forEach(function (x) { if (!res && x.status === 'resolved') res = x; });
if (res) {
  res.resolvedAt = new Date(Date.now() - 10 * 60000).toISOString(); // long ago
  res.reminders = [];
  var before = S.db.notifications.length;
  sandbox.Live.start();
  // can't wait for interval; call runOnce
  sandbox.Live.runOnce();
  ok(S.db.notifications.length > before || res.reminders.length > 0, 'auto follow-up reminder sent for unanswered Resolved ticket');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
