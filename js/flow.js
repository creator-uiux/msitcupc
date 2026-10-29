/* flow.js  --  workflow engine. Implements every node, decision, loop and guard
   of the "IT Service and Maintenance Management System" swimlane flowchart. */
(function () {
  'use strict';
  var S = window.Store;
  var NOW = S.NOW;

  function hist(t, status, kind, text, by, role) {
    t.history.push({ at: NOW(), by: by, role: role, status: status, kind: kind, text: text });
    t.updatedAt = NOW();
  }
  function who() {
    var r = S.db.role;
    return {
      requester: { by: 'A. Delos Reyes', role: 'requester' },
      coordinator: { by: 'K. Ramos', role: 'coordinator' },
      technician: { by: 'J. Tan', role: 'technician' },
      management: { by: 'M. Reyes', role: 'management' }
    }[r] || { by: 'K. Ramos', role: 'coordinator' };
  }
  function guardRole(roles) {
    if (roles.indexOf(S.db.role) === -1) return { ok: false, msg: 'Blocked by role-based access (28.2).' };
    return { ok: true };
  }
  /* Tenancy (SOP 28.2): a requester may touch their own office's records and
     the requests they raised for another office. */
  function officeBlock(office, requester) {
    if (S.db.role !== 'requester') return null;
    var u = S.db.user;
    var scope = u && u.office;
    if (scope && office && office !== scope) {
      if (requester && requester === who().by) return null;
      return { ok: false, msg: 'Blocked by office-based access (28.2).' };
    }
    return null;
  }
  /* Append-only audit event (actor, timestamp, status, reason)  --  mirrors engine._audit. */
  function audit(subjectType, subjectId, kind, text, status) {
    var w = who();
    if (!S.db.audit) S.db.audit = [];
    var maxId = 0;
    for (var i = 0; i < S.db.audit.length; i++) if (S.db.audit[i].id > maxId) maxId = S.db.audit[i].id;
    S.db.audit.push({
      id: maxId + 1, at: NOW(), by: w.by, role: w.role,
      subjectType: subjectType, subjectId: subjectId,
      status: status || null, kind: kind, text: text
    });
    if (S.db.audit.length > 4000) S.db.audit.splice(0, S.db.audit.length - 2000);
  }
  var LABELS = {
    submitted: 'Submitted', needs_info: 'Needs Information', assigned: 'Assigned',
    in_progress: 'In Progress', on_hold: 'On Hold', resolved: 'Resolved',
    closed: 'Closed', cancelled: 'Cancelled'
  };
  function label(status) { return LABELS[status] || status || ' -- '; }
  /* Status-change whitelist  --  mirrors server/engine.py TRANSITIONS (Appendix B).
     The server re-checks every move; this keeps the offline prototype honest. */
  var TRANSITIONS = (window.PermissionMap && window.PermissionMap.transitions) ? window.PermissionMap.transitions : {
    submitted: { needs_info: ['coordinator'], assigned: ['coordinator'], cancelled: ['coordinator'] },
    needs_info: { submitted: ['requester', 'coordinator'], cancelled: ['coordinator'] },
    assigned: { in_progress: ['technician'], on_hold: ['technician'], cancelled: ['coordinator'] },
    in_progress: { on_hold: ['technician'], resolved: ['technician'], cancelled: ['coordinator'] },
    on_hold: { in_progress: ['coordinator'], cancelled: ['coordinator'] },
    resolved: { closed: ['requester', 'coordinator'], in_progress: ['requester'], cancelled: ['coordinator'] },
    closed: {},
    cancelled: {}
  };
  function canTransition(cur, next) {
    var row = TRANSITIONS[cur] || {};
    return (row[next] || []).indexOf(S.db.role) !== -1;
  }
  function checkTransition(t, next) {
    if (!canTransition(t.status, next)) {
      return { ok: false, msg: 'That status change is not allowed (' + label(t.status) + ' to ' + label(next) + ' as ' + S.db.role + ').' };
    }
    return null;
  }
  /* Status-change audit: records the previous and the new status together. */
  function auditStatus(id, prev, next, kind, text) {
    audit('ticket', id, kind, label(prev) + ' -> ' + label(next) + ': ' + text, label(next));
  }
  /* Configured maintenance frequency -> days until the next occurrence. */
  function frequencyDays(key) {
    var rows = (S.db.settings && S.db.settings.frequencies) || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row && row.length >= 3 && row[0] === key) { var n = parseInt(row[2], 10); return isNaN(n) ? 91 : n; }
    }
    return { weekly: 7, monthly: 30, quarterly: 91, semiannual: 182, annual: 365 }[key] || 91;
  }

  /* Impact x urgency -> priority from settings.priorityMatrix (decision D6).
     The impact domain is Low, Medium and High; the urgency domain is Low,
     Medium and High; the priority domain is Low, Medium, High and Critical.
     Mirrors engine.priority_for. */
  function priorityFor(impact, urgency) {
    var m = (S.db.settings && S.db.settings.priorityMatrix) || {};
    var row = m[String(impact || '').trim().toLowerCase()];
    if (!row || typeof row !== 'object') return null;
    return row[String(urgency || '').trim().toLowerCase()] || null;
  }

  /* Calculate the next due date from the configured schedule (Section 10 step 12).
     The cadence anchor is the schedule's own due date, so a late or incomplete
     visit never drifts the plan.  Mirrors engine._advance_next_due. */
  function advanceNextDue(j) {
    var sc = S.getSchedule(j.scheduleId);
    if (!sc) return;
    var mult = frequencyDays(sc.frequency);
    var nd = new Date(new Date(sc.dueDate).getTime() + mult * 864e5);
    j.nextDue = nd.toISOString().slice(0, 10);
    sc.dueDate = nd.toISOString(); sc.nextCheck = sc.dueDate; sc.lastCheck = NOW(); sc.active = true;
  }

  var Flow = {

    /* ---------- Office Requester lane ---------- */

    // Submit service request -> Record service request -> Status: Submitted (system intake)
    createTicket: function (d) {
      /* intake (Office Requester / Coordinator lane); a linked corrective ticket
         raised from maintenance follows Section 1 from the technician lane too. */
      var roles = d && d.linkedTo ? ['requester', 'coordinator', 'technician'] : ['requester', 'coordinator'];
      var g = guardRole(roles); if (!g.ok) return g;
      if (!d.office || !d.issue || !d.category || !d.requester) return { ok: false, msg: 'Office, requester, category and issue are required.' };
      var priority = String(d.priority || 'medium').trim().toLowerCase();
      if (['low', 'medium', 'high'].indexOf(priority) === -1) priority = 'medium';
      /* The office never sets priority; the coordinator assesses it. */
      if (S.db.role === 'requester') priority = 'medium';
      /* The intake source is one of the configured reference values. */
      var sources = (S.db.settings && S.db.settings.sources) || ['telephone', 'email', 'walk-in', 'on-site', 'online portal'];
      var rawSource = String(d.source || 'email').trim().toLowerCase();
      var source = sources.filter(function (s) { return String(s).toLowerCase() === rawSource; })[0];
      if (!source) return { ok: false, msg: 'Unknown intake source (' + (d.source || '') + '). Choose one of: ' + sources.join(', ') + '.' };
      /* A previous record must be a real ticket in the same office. */
      var prev = String(d.previousRecord || '').trim();
      if (prev) {
        var pt = S.getTicket(prev);
        if (!pt) return { ok: false, msg: 'Previous record ' + prev + ' was not found. Choose an existing ticket.' };
        if (S.db.role === 'requester') {
          if (pt.office !== d.office) {
            return { ok: false, msg: 'Previous record ' + prev + ' belongs to ' + pt.office + ', not ' + d.office + '.' };
          }
          if (pt.requester !== who().by && pt.requester !== d.requester) {
            return { ok: false, msg: 'Previous record ' + prev + ' belongs to another requester.' };
          }
        }
      }
      var key = String(d.idempotencyKey || '').trim();
      if (key) {
        var dup = S.db.tickets.filter(function (x) { return x.idempotencyKey === key; })[0];
        if (dup) return { ok: true, msg: dup.id + ' already recorded  --  Status: Submitted.', id: dup.id, duplicate: true };
      }
      var id = S.nextId('ticket'), t;
      S.update(function (db) {
        t = {
          id: id, office: d.office, requester: d.requester, category: d.category, source: source,
          previousRecord: prev || d.linkedTo || null,
          issue: d.issue, asset: d.asset || '', attachments: (d.attachments || []).slice(),
          dateReported: d.dateReported || NOW(), idempotencyKey: key,
          status: 'submitted', impact: null, urgency: null, priority: priority, target: null,
          technician: null, createdAt: NOW(), updatedAt: NOW(), reviewed: false,
          history: [{ at: NOW(), by: d.requester, role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded  --  Status: Submitted. Captured ticket, office, requester, category, priority, issue, date, asset, attachments, source.' }],
          tests: [], reminders: [], dependency: null, linkedTo: d.linkedTo || null,
          cancelReason: null, closure: null, authorizedReason: '', recurring: !!d.linkedTo, withdrawal: null,
          diagnosis: { findings: '', actions: '', parts: '', cost: 0, labor: 0, dates: '', evidence: [] },
          confirmation: { state: 'none', person: '', date: null, feedback: '' }
        };
        db.tickets.unshift(t);
        audit('ticket', id, 'create', 'Ticket recorded for ' + d.requester + ' (' + d.office + ')  --  Status: Submitted.', 'Submitted');
        S.notify('coordinator', id + ' recorded  --  Status: Submitted (' + d.office + ').', 'intake', { ticketId: id, office: d.office });
      });
      return { ok: true, msg: id + ' recorded  --  Status: Submitted.', id: id };
    },

    // Supply missing information -> Update existing ticket -> Return to review (no new ticket)
    submitInfo: function (id, d) {
      var g = guardRole(['requester', 'coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      var ob = officeBlock(t.office, t.requester); if (ob) return ob;
      if (t.status !== 'needs_info') return { ok: false, msg: 'Ticket is not in Needs Information.' };
      if (!d.issue && !d.asset && !d.note) return { ok: false, msg: 'Provide the missing information.' };
      S.update(function () {
        if (d.issue) t.issue = d.issue;
        if (d.asset) t.asset = d.asset;
        if (d.attachments) t.attachments = t.attachments.concat(d.attachments);
        t.status = 'submitted';
        hist(t, 'submitted', 'status', 'Missing information supplied (' + (d.note || 'details updated') + ')  --  returned to review; no new ticket created.', t.requester, 'requester');
        auditStatus(t.id, 'needs_info', 'submitted', 'status', 'Missing information supplied  --  ticket returned to Submitted for review.');
        S.notify('coordinator', t.id + ' returned to review  --  missing information supplied.', 'intake', { ticketId: t.id });
      });
      return { ok: true, msg: 'Information submitted for ' + id + '  --  back to review.' };
    },

    // Review and verify service result -> Office accepts result? (Yes/No/No response)
    // The office decides.  The IT Coordinator may never answer on the office's
    // behalf; the coordinator closes through the audited authorized closure.
    officeDecision: function (id, decision, data) {
      var g = guardRole(['requester']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      var ob = officeBlock(t.office, t.requester); if (ob) return ob;
      if (t.status !== 'resolved') return { ok: false, msg: 'Office confirmation applies to Resolved tickets (' + id + ' is ' + label(t.status) + ').' };
      if (t.confirmation.state !== 'pending' && decision !== 'no_response') return { ok: false, msg: 'No confirmation is pending on ' + id + '.' };
      if (decision === 'accepted') {
        if (!data.person) return { ok: false, msg: 'Confirmation requires the confirming person.' };
        var ac = checkTransition(t, 'closed'); if (ac) return ac;
        S.update(function () {
          t.confirmation = { state: 'accepted', person: data.person, date: NOW(), feedback: data.feedback || '' };
          t.status = 'closed'; t.closedAt = NOW(); t.closure = 'confirmation'; t.authorizedReason = '';
          hist(t, 'closed', 'confirm', 'Office accepts result  --  confirmation recorded for ' + data.person + '. Status: Closed.', data.person, 'requester');
          auditStatus(t.id, 'resolved', 'closed', 'confirm', 'Office accepted the result  --  confirmation recorded for ' + data.person + '; closed after confirmation.');
          S.notify('coordinator', t.id + ' confirmed and closed by the office.', 'confirm', { ticketId: t.id });
          S.notify('requester', t.id + ' is now Closed. Thank you.', 'confirm', { ticketId: t.id, office: t.office });
        });
        return { ok: true, msg: 'Confirmation recorded for ' + id + '  --  Status: Closed.' };
      }
      if (decision === 'rejected') {
        if (!data.feedback) return { ok: false, msg: 'Record office feedback before rejecting.' };
        var ct = checkTransition(t, 'in_progress'); if (ct) return ct;
        S.update(function () {
          t.confirmation = { state: 'rejected', person: data.person || t.requester, date: NOW(), feedback: data.feedback };
          t.status = 'in_progress';
          hist(t, 'in_progress', 'confirm', 'Office rejected the result  --  feedback recorded and returned to diagnosis: "' + data.feedback + '"', t.requester, 'requester');
          auditStatus(t.id, 'resolved', 'in_progress', 'confirm', 'Office rejected the result  --  feedback: "' + data.feedback + '"');
          S.notify('technician', t.id + ' rejected by office  --  return to diagnosis with feedback.', 'confirm', { ticketId: t.id });
          S.notify('coordinator', t.id + ' returned to diagnosis after office feedback.', 'confirm', { ticketId: t.id });
        });
        return { ok: true, msg: 'Feedback recorded  --  ' + id + ' returned to diagnosis.' };
      }
      S.update(function () {
        t.confirmation.state = 'no_response';
        t.reminders.push(NOW());
        hist(t, t.status, 'confirm', 'No response from office  --  Status kept Resolved; follow-up reminder 1 sent to the office.', 'System', 'system');
        audit('ticket', id, 'confirm', 'No response from office  --  Status kept ' + label(t.status) + '; follow-up reminder sent.', label(t.status));
        S.notify('requester', 'Follow-up reminder: please confirm the result of ' + t.id + ' (' + t.office + ').', 'remind', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'No response recorded  --  ' + id + ' stays Resolved, reminder sent.' };
    },

    // Create new ticket linked to previous service record (issue recurs after closure)
    createLinkedTicket: function (id, d) {
      var g = guardRole(['requester', 'coordinator']); if (!g.ok) return g;
      var old = S.getTicket(id);
      if (!old) return { ok: false, msg: 'Ticket not found.' };
      if (old.status !== 'closed') return { ok: false, msg: 'Recurrence can only follow a Closed ticket.' };
      var res;
      S.update(function () {
        old.recurring = true;
        hist(old, old.status, 'link', 'Issue recurs after closure  --  new ticket linked to previous service record; flows back to Section 1.', old.requester, 'requester');
        audit('ticket', old.id, 'link', 'Issue recurs after closure  --  linked recurrence ticket created (Section 1).', label(old.status));
        res = Flow.createTicket({
          office: old.office, requester: old.requester, category: old.category, source: old.source,
          issue: d.issue || old.issue, asset: old.asset, linkedTo: old.id
        });
      });
      if (!res.ok) return res;
      S.update(function () {
        var nt = S.getTicket(res.id);
        hist(nt, 'submitted', 'link', 'Linked corrective ticket following Section 1  --  previous record: ' + old.id + '.', nt.requester, 'requester');
      });
      return { ok: true, msg: 'Linked ticket ' + res.id + ' created (Section 1).', id: res.id };
    },

    /* ---------- IT Coordinator lane ---------- */

    // Review request -> Details complete? (No -> Request missing details -> Status: Needs Information)
    requestInfo: function (id, missing) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'submitted') return { ok: false, msg: 'Only Submitted tickets can go back for details.' };
      if (!missing) return { ok: false, msg: 'List the missing details.' };
      S.update(function () {
        t.status = 'needs_info';
        hist(t, 'needs_info', 'status', 'Details complete? No  --  requested missing details: ' + missing, 'K. Ramos', 'coordinator');
        auditStatus(t.id, 'submitted', 'needs_info', 'status', 'Details incomplete - requested: ' + missing);
        S.notify('requester', t.id + ' needs information: ' + missing, 'intake', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Status: Needs Information  --  requester notified.' };
    },

    // Details complete? Yes -> Assess impact and urgency -> Set priority and target date
    assess: function (id, d) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'submitted') return { ok: false, msg: 'Only Submitted tickets can be assessed.' };
      if (!d.impact || !d.urgency || !d.priority || !d.target) return { ok: false, msg: 'Impact, urgency, priority and target date are all required.' };
      var derived = priorityFor(d.impact, d.urgency);
      var note = '';
      if (derived && derived !== String(d.priority).toLowerCase()) {
        note = ' (matrix set ' + derived + ' from ' + d.impact + ' impact / ' + d.urgency + ' urgency; entered ' + d.priority + ' overridden)';
        d = { impact: d.impact, urgency: d.urgency, priority: derived, target: d.target };
      }
      S.update(function () {
        t.impact = d.impact; t.urgency = d.urgency; t.priority = d.priority; t.target = d.target;
        t.reviewed = true;
        hist(t, 'submitted', 'note', 'Details complete? Yes  --  assessed impact ' + d.impact + ', urgency ' + d.urgency + '; priority ' + d.priority + ', target ' + d.target + '.', 'K. Ramos', 'coordinator');
        audit('ticket', id, 'assess', 'Assessed impact ' + d.impact + ', urgency ' + d.urgency + '; priority ' + d.priority + ', target ' + d.target + '.' + note, label(t.status));
      });
      return { ok: true, msg: 'Assessment recorded for ' + id + '.' };
    },

    // Assign technician -> Status: Assigned -> Notify technician and requester
    assign: function (id, tech) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'submitted') return { ok: false, msg: 'Ticket must be Submitted before assignment.' };
      if (!t.reviewed) return { ok: false, msg: 'Complete review and assessment first (Details complete?).' };
      if (!tech) return { ok: false, msg: 'Choose a technician.' };
      S.update(function () {
        t.technician = tech; t.status = 'assigned';
        hist(t, 'assigned', 'status', 'Assigned to ' + tech + '  --  Status: Assigned. Notify technician and requester.', 'K. Ramos', 'coordinator');
        auditStatus(t.id, 'submitted', 'assigned', 'status', 'Assigned to ' + tech + '.');
        S.notify('technician', t.id + ' assigned to you (' + t.office + '  --  ' + t.category + ').', 'assign', { ticketId: t.id });
        S.notify('requester', t.id + ' has been assigned to a technician  --  Status: Assigned.', 'assign', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Status: Assigned  --  technician and requester notified.' };
    },

    // Move an active ticket to a different technician.  The status is
    // preserved; only ownership moves.  Mirrors engine.reassign.
    reassign: function (id, tech) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (['assigned', 'in_progress', 'on_hold'].indexOf(t.status) === -1) return { ok: false, msg: 'Only Assigned, In Progress or On Hold tickets can be reassigned.' };
      if (!tech) return { ok: false, msg: 'Choose a technician.' };
      if (tech === t.technician) return { ok: false, msg: 'Already assigned to ' + tech + '.' };
      var old = t.technician;
      S.update(function () {
        t.technician = tech;
        hist(t, t.status, 'assign', 'Reassigned from ' + (old || 'unassigned') + ' to ' + tech + '.', 'K. Ramos', 'coordinator');
        audit('ticket', id, 'reassign', 'Reassigned from ' + (old || 'unassigned') + ' to ' + tech + '.', label(t.status));
        S.notify('technician', t.id + ' reassigned to you (' + t.office + ').', 'assign', { ticketId: t.id });
        S.notify('requester', t.id + ' is now handled by a different technician.', 'assign', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Reassigned to ' + tech + '.' };
    },

    // Coordinate service schedule (IT Technician lane; the coordinator also
    // coordinates the visit when assigning  --  see actions.js case 'assign')
    coordinate: function (id, d) {
      var g = guardRole(['coordinator', 'technician']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (!d.date) return { ok: false, msg: 'Pick a service date.' };
      var ctext = 'Service schedule coordinated: ' + d.date + (d.slot ? ' (' + d.slot + ')' : '') + ', technician ' + (d.tech || t.technician || ' -- ') + (d.notes ? '  --  ' + d.notes : '');
      S.update(function () {
        hist(t, t.status, 'sched', ctext, who().by, who().role);
        audit('ticket', id, 'sched', ctext, label(t.status));
        S.notify('technician', 'Schedule for ' + t.id + ': ' + d.date + (d.slot ? ' ' + d.slot : ''), 'sched', { ticketId: t.id });
        S.notify('requester', 'Visit scheduled for ' + t.id + ' on ' + d.date + '.', 'sched', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Schedule coordinated for ' + id + '.' };
    },

    // Office Requester asks for an active request to be withdrawn.  The PDF
    // places the withdrawal itself in the IT Coordinator lane, so the office
    // only requests it and the status stays unchanged until the coordinator
    // records the cancellation reason.
    requestWithdrawal: function (id, reason) {
      var g = guardRole(['requester']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      var ob = officeBlock(t.office, t.requester); if (ob) return ob;
      if (t.status === 'closed' || t.status === 'cancelled') return { ok: false, msg: 'This request is already closed or cancelled.' };
      if (t.withdrawal) return { ok: false, msg: 'Withdrawal already requested  --  the IT Coordinator will action it.' };
      if (!reason) return { ok: false, msg: 'Record why the request is no longer needed.' };
      S.update(function () {
        t.withdrawal = { reason: reason, at: NOW(), by: who().by };
        hist(t, t.status, 'withdraw', 'Office requested withdrawal of the active request: ' + reason + '  --  sent to the IT Coordinator, who records the cancellation reason.', who().by, who().role);
        audit('ticket', id, 'withdraw', 'Withdrawal requested by the office: ' + reason + '  --  status unchanged, IT Coordinator to record the cancellation reason.', label(t.status));
        S.notify('coordinator', t.id + ' withdrawal requested by the office  --  record the cancellation reason.', 'cancel', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Withdrawal requested  --  the IT Coordinator will record the cancellation reason.' };
    },

    // Active request withdrawn -> record cancellation reason -> Status: Cancelled
    cancel: function (id, reason) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      var ob = officeBlock(t.office, t.requester); if (ob) return ob;
      if (t.status === 'closed' || t.status === 'cancelled') return { ok: false, msg: 'Terminal tickets cannot be cancelled.' };
      if (!reason) return { ok: false, msg: 'Record the cancellation reason.' };
      var ct = checkTransition(t, 'cancelled'); if (ct) return ct;
      S.update(function () {
        var prev = t.status;
        t.status = 'cancelled'; t.cancelReason = reason;
        if (t.withdrawal) t.withdrawal = Object.assign({}, t.withdrawal, { actionedAt: NOW(), actionedBy: who().by });
        hist(t, 'cancelled', 'cancel', 'Cancellation reason recorded  --  Status: Cancelled. Requester notified; records and activity history preserved.', 'K. Ramos', 'coordinator');
        auditStatus(t.id, prev, 'cancelled', 'cancel', 'Cancellation reason: ' + reason);
        S.notify('requester', t.id + ' cancelled  --  reason: ' + reason, 'cancel', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Status: Cancelled  --  records preserved.' };
    },

    // Dependency follow-up (8.x): record follow-up updates, continue follow-up
    // The IT Coordinator owns the dependency follow-up.
    followUp: function (id, text) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t || !t.dependency) return { ok: false, msg: 'No dependency recorded.' };
      if (!text) return { ok: false, msg: 'Record the follow-up update.' };
      S.update(function () {
        t.dependency.updates.push({ at: NOW(), text: text });
        t.dependency.dueAt = new Date(Date.now() + 864e5).toISOString();
        hist(t, t.status, 'dep', 'Dependency outcome? Still pending  --  follow-up recorded: ' + text, who().by, who().role);
        audit('ticket', id, 'dep', 'Dependency follow-up recorded: ' + text, label(t.status));
      });
      return { ok: true, msg: 'Follow-up recorded for ' + id + '.' };
    },

    // Dependency outcome? Resolved -> coordinator records the outcome note, return to work
    resolveDependency: function (id, note) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t || !t.dependency || t.dependency.state !== 'pending') return { ok: false, msg: 'No pending dependency.' };
      if (t.status !== 'on_hold') return { ok: false, msg: 'Only On Hold tickets return through a resolved dependency.' };
      if (!note) return { ok: false, msg: 'Record the dependency outcome note (what resolved it).' };
      var ct = checkTransition(t, t.holdReturn || 'in_progress'); if (ct) return ct;
      S.update(function () {
        var prev = t.status;
        t.dependency.state = 'resolved';
        t.status = t.holdReturn || 'in_progress';
        hist(t, t.status, 'dep', 'Dependency outcome? Resolved (' + note + ')  --  returned to ' + t.status.toUpperCase().replace('_', ' ') + '.', 'K. Ramos', 'coordinator');
        auditStatus(t.id, prev, t.status, 'dep', 'Dependency resolved: ' + note + '  --  work resumes.');
        S.notify('technician', 'Dependency for ' + t.id + ' resolved  --  work can continue.', 'dep', { ticketId: t.id });
      });
      return { ok: true, msg: 'Dependency resolved  --  back in progress.' };
    },

    // Dependency outcome? Cannot proceed -> record cancellation reason -> Status: Cancelled
    cancelFromDependency: function (id, reason) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t || !t.dependency) return { ok: false, msg: 'No dependency recorded.' };
      if (t.status === 'closed' || t.status === 'cancelled') return { ok: false, msg: 'Terminal tickets cannot be cancelled.' };
      if (!reason) return { ok: false, msg: 'Record why the dependency cannot proceed.' };
      var ct = checkTransition(t, 'cancelled'); if (ct) return ct;
      S.update(function () {
        var prev = t.status;
        t.dependency.state = 'blocked';
        t.status = 'cancelled'; t.cancelReason = reason;
        hist(t, 'cancelled', 'cancel', 'Dependency outcome? Cannot proceed  --  cancellation reason recorded. Status: Cancelled; records preserved.', 'K. Ramos', 'coordinator');
        auditStatus(t.id, prev, 'cancelled', 'cancel', 'Dependency cannot proceed  --  reason: ' + reason);
        S.notify('requester', t.id + ' cancelled  --  dependency cannot proceed: ' + reason, 'cancel', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Cancelled with reason  --  records preserved.' };
    },

    /* ---------- IT Technician lane ---------- */

    // Assigned -> Status: In Progress (visit coordinated first)
    startWork: function (id, note) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'assigned') return { ok: false, msg: 'Only Assigned tickets can start.' };
      var ct = checkTransition(t, 'in_progress'); if (ct) return ct;
      /* Approval is a per-category flag and is off by default (decision D8).
         A gated category cannot start work until the coordinator signs it off. */
      var gated = (S.db.settings && S.db.settings.approvalCategories) || [];
      if (gated.indexOf(t.category) > -1 && !(t.approval && t.approval.state === 'approved')) {
        return { ok: false, msg: 'This category needs coordinator approval before work starts (' + t.category + ').' };
      }
      var coordinated = (t.history || []).some(function (h) { return h.kind === 'sched'; });
      if (!coordinated && !note) return { ok: false, msg: 'Coordinate the visit with the office first (schedule entry or coordination note).' };
      S.update(function () {
        t.status = 'in_progress';
        hist(t, 'in_progress', 'status', 'Work started  --  Status: In Progress. Reviewed ticket and previous office/asset history.' +
          (note ? ' Coordination note: ' + note : ''), 'J. Tan', 'technician');
        auditStatus(t.id, 'assigned', 'in_progress', 'status', 'Work started.');
        S.notify('coordinator', t.id + ' is now In Progress (J. Tan).', 'assign', { ticketId: t.id });
      });
      return { ok: true, msg: 'Status: In Progress.' };
    },

    // Diagnose issue and record findings + Record diagnosis, actions, parts, costs, labor, dates, evidence
    diagnose: function (id, d) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'in_progress' && t.status !== 'on_hold') return { ok: false, msg: 'Diagnosis requires an active ticket.' };
      if (!d.findings) return { ok: false, msg: 'Diagnosis findings are required.' };
      S.update(function () {
        t.diagnosis = {
          findings: d.findings, actions: d.actions || '', parts: d.parts || '',
          cost: Number(d.cost) || 0, labor: Number(d.labor) || 0, dates: d.dates || NOW().slice(0, 10),
          evidence: (d.evidence || []).length ? d.evidence : t.diagnosis.evidence
        };
        hist(t, t.status, 'note', 'Diagnosis recorded: ' + d.findings + (d.actions ? ' | Actions: ' + d.actions : ''), 'J. Tan', 'technician');
        audit('ticket', id, 'diagnosis', 'Diagnosis recorded: ' + d.findings, label(t.status));
      });
      return { ok: true, msg: 'Diagnosis recorded for ' + id + '.' };
    },

    // Perform repair, installation, configuration, troubleshooting, or other IT service
    // -> Record the actions performed, parts, costs, labor, dates and evidence.
    // A distinct step from the diagnosis findings so the flowchart's `repair`
    // and `record` nodes each have their own guarded control.
    recordRepair: function (id, d) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'in_progress' && t.status !== 'on_hold') return { ok: false, msg: 'Repair recording requires an active ticket.' };
      if (!t.diagnosis.findings) return { ok: false, msg: 'Record the diagnosis findings first (SOP 13 before repair).' };
      if (!d.actions) return { ok: false, msg: 'Record the repair / actions performed.' };
      S.update(function () {
        t.diagnosis.actions = d.actions;
        if (d.parts !== undefined && d.parts !== '') t.diagnosis.parts = d.parts;
        if (d.cost !== undefined && d.cost !== '') t.diagnosis.cost = Number(d.cost) || t.diagnosis.cost;
        if (d.labor !== undefined && d.labor !== '') t.diagnosis.labor = Number(d.labor) || t.diagnosis.labor;
        if (d.dates) t.diagnosis.dates = d.dates;
        if ((d.evidence || []).length) t.diagnosis.evidence = d.evidence;
        t.repairedAt = NOW();
        hist(t, t.status, 'note', 'Perform repair/installation/configuration/troubleshooting  --  actions: ' + d.actions +
          (t.diagnosis.parts ? ' | parts: ' + t.diagnosis.parts : '') + ' | ₱' + (t.diagnosis.cost || 0).toFixed(2) + ' · ' + (t.diagnosis.labor || 0) + 'h.', 'J. Tan', 'technician');
        audit('ticket', id, 'repair', 'Repair recorded: ' + d.actions + ' (₱' + (t.diagnosis.cost || 0).toFixed(2) + ' · ' + (t.diagnosis.labor || 0) + 'h).', label(t.status));
      });
      return { ok: true, msg: 'Repair actions recorded for ' + id + '.' };
    },

    // Parts/approval needed? Yes -> Record dependency -> Status: On Hold
    placeHold: function (id, dep) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'in_progress') return { ok: false, msg: 'Only In Progress tickets can be put on hold.' };
      if (!dep.reason || !dep.responsible || !dep.nextAction) return { ok: false, msg: 'Dependency reason, responsible person and next action are required.' };
      S.update(function () {
        t.holdReturn = 'in_progress';
        t.dependency = { reason: dep.reason, responsible: dep.responsible, nextAction: dep.nextAction, state: 'pending', dueAt: dep.dueAt || new Date(Date.now() + 864e5).toISOString(), updates: [] };
        t.status = 'on_hold';
        hist(t, 'on_hold', 'dep', 'Parts, approval or external support needed? Yes  --  Status: On Hold. Dependency: ' + dep.reason + ' (responsible: ' + dep.responsible + ').', 'J. Tan', 'technician');
        auditStatus(t.id, 'in_progress', 'on_hold', 'dep', 'Dependency recorded: ' + dep.reason + ' (responsible: ' + dep.responsible + ', next: ' + dep.nextAction + ').');
        S.notify('coordinator', t.id + ' On Hold  --  dependency: ' + dep.reason, 'dep', { ticketId: t.id });
      });
      return { ok: true, msg: 'Status: On Hold  --  dependency recorded.' };
    },

    // Record failed test -> Return to diagnosis (loop)
    recordTest: function (id, result, note) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'in_progress') return { ok: false, msg: 'Testing happens while In Progress.' };
      if (!t.diagnosis.findings) return { ok: false, msg: 'Record diagnosis first (SOP 13 before testing).' };
      if (result === 'pass') {
        if (!note) return { ok: false, msg: 'Record the service summary note before resolving (what was done and verified).' };
        var ct = checkTransition(t, 'resolved'); if (ct) return ct;
        S.update(function () {
          t.tests.push({ at: NOW(), by: 'J. Tan', result: 'pass', note: note });
          t.status = 'resolved';
          t.resolvedAt = NOW();
          t.confirmation = { state: 'pending', person: '', date: null, feedback: '' };
          hist(t, 'resolved', 'test', 'Service passed testing  --  Status: Resolved (resolved means technician testing passed). Office notified, ready for confirmation. Summary: ' + note, 'J. Tan', 'technician');
          auditStatus(t.id, 'in_progress', 'resolved', 'test', 'Service passed testing  --  office confirmation requested. Summary: ' + note);
          S.notify('requester', t.id + ' is Resolved  --  please review and confirm the service result.', 'confirm', { ticketId: t.id, office: t.office });
          S.notify('coordinator', t.id + ' resolved by J. Tan  --  awaiting office confirmation.', 'confirm', { ticketId: t.id });
        });
        return { ok: true, msg: 'Test passed  --  Status: Resolved, office notified.' };
      }
      S.update(function () {
        t.tests.push({ at: NOW(), by: 'J. Tan', result: 'fail', note: note || '' });
        hist(t, 'in_progress', 'test', 'Record failed test  --  service did not pass testing; returned to diagnosis.' + (note ? ' Notes: ' + note : ''), 'J. Tan', 'technician');
        audit('ticket', id, 'test', 'Failed test recorded  --  returned to diagnosis.' + (note ? ' Notes: ' + note : ''), label(t.status));
        S.notify('coordinator', t.id + ' failed testing  --  technician returned to diagnosis.', 'test', { ticketId: t.id });
      });
      return { ok: true, msg: 'Failed test recorded  --  back to diagnosis.' };
    },

    /* ---------- System lane: close / reminders ---------- */

    // Status: Closed after confirmation (office decision), or authorized closure
    close: function (id, mode, reason) {
      var g = guardRole(['coordinator', 'requester']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      var ob = officeBlock(t.office, t.requester); if (ob) return ob;
      if (t.status !== 'resolved') return { ok: false, msg: 'Only Resolved tickets can be closed.' };
      if (mode === 'confirmation') {
        if (S.db.role !== 'requester') return { ok: false, msg: 'Confirmation closure is limited to the owning office requester.' };
        if (t.confirmation.state !== 'accepted') return { ok: false, msg: 'Confirmation not yet accepted  --  use authorized closure only when allowed.' };
      } else {
        if (!reason) return { ok: false, msg: 'Authorized closure requires a reason.' };
        var allowed = ((S.db.settings && S.db.settings.authorizedClosureRoles) || ['coordinator']).filter(function (r) { return r !== 'management'; });
        if (!allowed.length) allowed = ['coordinator'];
        if (allowed.indexOf(S.db.role) === -1) return { ok: false, msg: 'Authorized closure is limited to: ' + allowed.join(', ') + '.' };
      }
      var ct = checkTransition(t, 'closed'); if (ct) return ct;
      S.update(function () {
        t.status = 'closed'; t.closedAt = NOW(); t.closure = mode; t.authorizedReason = reason || '';
        hist(t, 'closed', 'status', mode === 'confirmation'
          ? 'Status: Closed after confirmation. Office service history and reporting updated; record retained.'
          : 'Authorized closure  --  reason: ' + reason + '. Status: Closed; office service history and reporting updated.', 'K. Ramos', 'coordinator');
        auditStatus(t.id, 'resolved', 'closed', 'status', mode === 'confirmation' ? 'Closed after office confirmation.' : 'Authorized closure  --  reason: ' + reason);
        S.notify('requester', t.id + ' is now Closed. Thank you.', 'confirm', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Status: Closed  --  service record retained.' };
    },

    // Reply composer: public message or internal staff note (Flow.addComment)
    addComment: function (id, d) {
      var g = guardRole(['coordinator', 'technician', 'requester']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      var ob = officeBlock(t.office, t.requester); if (ob) return ob;
      d = d || {};
      var text = (d.text || '').trim();
      if (!text) return { ok: false, msg: 'Write a message before sending.' };
      var role = S.db.role;
      if (role === 'requester' && t.requester !== who().by) return { ok: false, msg: 'You can only reply to your own tickets.' };
      var internal = role !== 'requester' && d.visibility === 'internal';
      var c = {
        id: id + '-C' + String((t.comments || []).length + 1).padStart(2, '0'),
        at: NOW(), by: who().by, role: role, text: text,
        visibility: internal ? 'internal' : 'public'
      };
      S.update(function () {
        if (!t.comments) t.comments = [];
        t.comments.push(c);
        if (internal) {
          S.notify('technician', 'Internal note on ' + id + ' by ' + c.by + '.', 'comment', { ticketId: id });
          S.notify('coordinator', 'Internal note on ' + id + ' by ' + c.by + '.', 'comment', { ticketId: id });
          audit('ticket', id, 'comment', 'Internal note: ' + text.slice(0, 120));
        } else if (role === 'requester') {
          S.notify('coordinator', 'Reply from ' + c.by + ' on ' + id + '.', 'comment', { ticketId: id });
          S.notify('technician', 'Reply from ' + c.by + ' on ' + id + '.', 'comment', { ticketId: id });
          audit('ticket', id, 'comment', 'Message posted: ' + text.slice(0, 120));
        } else {
          S.notify('requester', 'Update from ' + c.by + ' on ' + id + '.', 'comment', { ticketId: id });
          audit('ticket', id, 'comment', 'Message posted: ' + text.slice(0, 120));
        }
      });
      return { ok: true, msg: internal ? 'Internal note recorded.' : 'Message sent.', comment: c, visibility: internal ? 'internal note' : 'message' };
    },

    // Requester corrects their own intake while Submitted / Needs Information
    updateTicket: function (id, d) {
      var g = guardRole(['requester']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.requester !== who().by) return { ok: false, msg: 'You can only edit your own tickets.' };
      if (t.status !== 'submitted' && t.status !== 'needs_info') return { ok: false, msg: 'Only Submitted or Needs Information tickets can be edited.' };
      d = d || {};
      var changed = [];
      if ((d.issue || '').trim() && d.issue.trim() !== t.issue) { t.issue = d.issue.trim(); changed.push('issue'); }
      if (d.asset !== undefined && d.asset !== null && String(d.asset).trim() !== String(t.asset || '')) { t.asset = String(d.asset).trim(); changed.push('asset'); }
      ['category', 'source', 'priority'].forEach(function (key) {
        if (d[key] && d[key] !== t[key]) { t[key] = d[key]; changed.push(key); }
      });
      if (!changed.length) return { ok: false, msg: 'Nothing to update.' };
      S.update(function () {
        hist(t, t.status, 'edit', 'Intake details updated (' + changed.join(', ') + ').', who().by, S.db.role);
        audit('ticket', id, 'edit', 'Intake details updated (' + changed.join(', ') + ').');
      });
      return { ok: true, msg: 'Ticket details saved.' };
    },

    // Send follow-up reminder while Status kept Resolved (15.3)
    sendReminder: function (id) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var t = S.getTicket(id);
      if (!t) return { ok: false, msg: 'Ticket not found.' };
      if (t.status !== 'resolved') return { ok: false, msg: 'Reminders apply to Resolved tickets awaiting confirmation.' };
      S.update(function () {
        t.reminders.push(NOW());
        t.confirmation.state = t.confirmation.state === 'pending' ? 'pending' : t.confirmation.state;
        hist(t, 'resolved', 'remind', 'No response  --  Status kept Resolved; follow-up reminder sent to the office (' + t.reminders.length + ').', 'System', 'system');
        audit('ticket', id, 'remind', 'Follow-up reminder ' + t.reminders.length + ' sent to the office.', label(t.status));
        S.notify('requester', 'Follow-up reminder: please confirm the result of ' + t.id + '.', 'remind', { ticketId: t.id, office: t.office });
      });
      return { ok: true, msg: 'Follow-up reminder sent for ' + id + '.' };
    }
  };

  /* ================= Maintenance (Sections 2 + 3) ================= */

  var Maint = {

    // Create maintenance schedule -> Record maintenance schedule (system)
    createSchedule: function (d) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      if (!d.office || !d.category || !d.dueDate || !d.frequency || !d.technician) return { ok: false, msg: 'Office, category, frequency, due date and technician are required.' };
      if (!d.checklist || !d.checklist.length) return { ok: false, msg: 'Provide at least one checklist item.' };
      var id = S.nextId('sched');
      S.update(function (db) {
        db.schedules.push({
          id: id, office: d.office, assets: d.assets || [], category: d.category,
          checklist: d.checklist, frequency: d.frequency, dueDate: d.dueDate,
          technician: d.technician, active: true, lastCheck: null, nextCheck: d.dueDate
        });
        S.notify('coordinator', id + ' created for ' + d.office + '  --  due ' + d.dueDate.slice(0, 10) + '.', 'sched', { office: d.office });
        audit('schedule', id, 'sched', 'Schedule created  --  ' + d.office + ' ' + d.category + ' every ' + d.frequency + ', first due ' + d.dueDate.slice(0, 10) + '.');
      });
      return { ok: true, msg: 'Schedule ' + id + ' recorded.', id: id };
    },

    /* Check maintenance schedule -> Maintenance due? -> Check job for schedule occurrence
       -> Job already exists? -> Generate linked maintenance job / Use existing job; do not duplicate */
    runScheduleCheck: function (silent) {
      /* The manual, idempotent schedule check.  The IT Coordinator owns it
         (specification 12); the system worker runs the same check. */
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var events = [];
      S.update(function (db) {
        var now = Date.now();
        for (var i = 0; i < db.schedules.length; i++) {
          var sc = db.schedules[i];
          if (!sc.active) continue;
          sc.lastCheck = NOW();
          if (new Date(sc.dueDate).getTime() > now) {
            // Keep schedule active and wait -> Next scheduled check
            if (!silent) events.push({ kind: 'wait', id: sc.id, msg: sc.id + ': not due yet  --  keep schedule active, next check ' + sc.dueDate.slice(0, 10) });
            continue;
          }
          // Job already exists?
          var existing = null;
          for (var j = 0; j < db.jobs.length; j++) {
            if (db.jobs[j].scheduleId === sc.id && db.jobs[j].occurrence === sc.dueDate.slice(0, 10)) existing = db.jobs[j];
          }
          if (existing) {
            if (!silent) events.push({ kind: 'exists', id: sc.id, jobId: existing.id, msg: sc.id + ': job ' + existing.id + ' already exists  --  used existing job, not duplicated.' });
            continue;
          }
          // Generate linked maintenance job
          var jid = S.nextId('job'), jobId = jid;
          db.jobs.unshift({
            id: jid, scheduleId: sc.id, occurrence: sc.dueDate.slice(0, 10), office: sc.office,
            assets: sc.assets.slice(), technician: sc.technician, category: sc.category,
            checklist: sc.checklist.slice(),
            items: sc.checklist.map(function (task) { return { task: task, done: false, result: '', finding: '', tech: '', date: '', evidence: [] }; }),
            status: 'submitted', availability: null, visitDate: null, reschedules: [],
            additionalFault: 'unknown', linkedTicketId: null, outcome: null,
            confirmation: { state: 'none', person: '', date: null }, nextDue: null, reminders: [], createdAt: NOW()
          });
          S.notify('technician', jid + ' generated from ' + sc.id + ' (' + sc.office + ')  --  coordinate the visit.', 'job', { jobId: jid, office: sc.office, to: sc.technician });
          S.notify('coordinator', jid + ' generated from ' + sc.id + '  --  maintenance due.', 'job', { jobId: jid });
          events.push({ kind: 'gen', id: sc.id, jobId: jid, msg: sc.id + ' due  --  generated linked maintenance job ' + jid + '.' });
        }
      });
      return events;
    },

    // Office available? No -> Record reschedule -> Agree on new maintenance date
    // The office requester owns this step (Requester lane) and the coordinator /
    // technician can also record it on the office's behalf.
    rescheduleJob: function (jobId, newDate, reason) {
      var g = guardRole(['coordinator', 'requester']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (j.status === 'closed') return { ok: false, msg: 'Job already closed.' };
      if (!newDate) return { ok: false, msg: 'Agree on a new maintenance date.' };
      S.update(function () {
        j.reschedules.push({ from: j.visitDate || S.getSchedule(j.scheduleId).dueDate, to: newDate, reason: reason || 'Office unavailable', at: NOW(), by: who().by, role: who().role });
        j.visitDate = newDate;
        j.status = 'on_hold';
        j.availability = 'pending';
        var sc = S.getSchedule(j.scheduleId);
        if (sc) { sc.dueDate = newDate; sc.nextCheck = newDate; }
        S.notify('technician', 'Job ' + j.id + ' rescheduled to ' + newDate.slice(0, 10) + ' (record reschedule).', 'sched', { jobId: j.id, office: j.office, to: j.technician });
        S.notify('requester', 'Maintenance for ' + j.office + ' rescheduled to ' + newDate.slice(0, 10) + '.', 'sched', { jobId: j.id, office: j.office });
        audit('job', j.id, 'sched', 'Rescheduled to ' + newDate.slice(0, 10) + '  --  reason: ' + (reason || 'Office unavailable') + '.', 'Rescheduled');
      });
      return { ok: true, msg: 'Reschedule recorded  --  ' + newDate.slice(0, 10) + '.' };
    },

    // Office available? Yes -> Status Assigned -> technician runs the checklist
    // A rescheduled (On Hold) visit only returns to Assigned once its agreed
    // date has arrived.
    confirmAvailability: function (jobId, yes) {
      var g = guardRole(['coordinator', 'requester']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (j.status !== 'submitted' && j.status !== 'on_hold') return { ok: false, msg: 'Availability is recorded while the visit is being coordinated (' + j.id + ' is ' + label(j.status) + ').' };
      if (yes) {
        var res;
        S.update(function () {
          var prev = j.status;
          j.availability = 'yes';
          j.visitDate = j.visitDate || NOW();
          if (prev === 'submitted') j.status = 'assigned';
          else if (prev === 'on_hold' && new Date(j.visitDate).getTime() <= Date.now()) j.status = 'assigned';
          var visit = (j.visitDate || '').slice(0, 10);
          if (j.status === 'assigned') {
            S.notify('technician', 'Office available for ' + j.id + '  --  visit confirmed for ' + visit + '; the job is Assigned.', 'sched', { jobId: j.id, office: j.office, to: j.technician });
            S.notify('coordinator', j.id + ': office available for ' + visit + '  --  job Assigned to ' + j.technician + '.', 'sched', { jobId: j.id, office: j.office });
          } else {
            S.notify('technician', 'Office available for ' + j.id + '  --  visit remains On Hold until ' + visit + '.', 'sched', { jobId: j.id, office: j.office, to: j.technician });
          }
          audit('job', j.id, 'sched', 'Office available  --  visit confirmed for ' + visit + '.', label(j.status));
          res = { ok: true, msg: 'Office available  --  visit coordinated (' + label(j.status) + ').' };
        });
        return res;
      }
      return { ok: false, msg: 'Record the reschedule instead (Office available? No).' };
    },

    // Section 10 step 7: the coordinator assigns the maintenance technician
    reassignJob: function (jobId, tech) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (['submitted', 'assigned', 'in_progress', 'on_hold'].indexOf(j.status) === -1) return { ok: false, msg: 'Only an open visit can be reassigned (' + j.id + ' is ' + label(j.status) + ').' };
      if (!tech) return { ok: false, msg: 'Choose a technician.' };
      if (tech === j.technician) return { ok: false, msg: 'Already assigned to ' + tech + '.' };
      var old = j.technician;
      S.update(function () {
        j.technician = tech;
        audit('job', j.id, 'assign', 'Reassigned from ' + (old || 'unassigned') + ' to ' + tech + '.', label(j.status));
        if (old) S.notify('technician', j.id + ' was reassigned to ' + tech + '; it is no longer yours.', 'assign', { jobId: j.id, office: j.office, to: old });
        S.notify('technician', j.id + ' reassigned to you (' + j.office + ', visit ' + (j.visitDate || '-').slice(0, 10) + ').', 'assign', { jobId: j.id, office: j.office, to: tech });
        S.notify('coordinator', j.id + ' reassigned from ' + (old || 'unassigned') + ' to ' + tech + ' by ' + who().by + '.', 'assign', { jobId: j.id, office: j.office });
      });
      return { ok: true, msg: 'Reassigned to ' + tech + '.' };
    },

    // Perform maintenance checklist using Section 2 -> Record task, result, findings, technician, date, evidence
    recordChecklistItem: function (jobId, idx, data) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (j.status !== 'assigned' && j.status !== 'in_progress') return { ok: false, msg: 'The checklist opens once the visit is Assigned (' + j.id + ' is ' + label(j.status) + ').' };
      if (!data.result) return { ok: false, msg: 'Record the result for this checklist item.' };
      S.update(function () {
        var it = j.items[idx];
        it.done = true; it.result = data.result; it.finding = data.finding || '';
        it.tech = who().by; it.date = NOW(); it.evidence = (data.evidence || []).length ? data.evidence : it.evidence;
        j.status = 'in_progress';
        audit('job', j.id, 'checklist', 'Checklist item ' + (idx + 1) + '/' + j.items.length + ' done  --  ' + it.result + ': ' + it.task + '.', 'In Progress');
      });
      return { ok: true, msg: 'Checklist item recorded (' + (idx + 1) + '/' + j.items.length + ').' };
    },

    // Additional fault discovered? -> record the technician's answer (yes/no)
    flagAdditionalFault: function (jobId, value) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (value !== 'yes' && value !== 'no' && value !== 'unknown') return { ok: false, msg: 'Additional fault must be yes, no or unknown.' };
      S.update(function () { j.additionalFault = value; audit('job', j.id, 'fault', 'Additional fault discovered? ' + value.charAt(0).toUpperCase() + value.slice(1) + '.'); });
      return { ok: true, msg: 'Additional fault recorded: ' + value + '.' };
    },

    // Additional fault discovered? -> Yes -> Create linked corrective ticket following Section 1
    createFaultTicket: function (jobId) {
      var g = guardRole(['technician']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (j.additionalFault !== 'yes') return { ok: false, msg: 'Set "Additional fault discovered? Yes" first.' };
      if (j.linkedTicketId) return { ok: false, msg: 'Corrective ticket ' + j.linkedTicketId + ' already exists.' };
      var res;
      S.update(function () {
        res = Flow.createTicket({
          office: j.office, requester: 'Maintenance visit ' + j.id, category: j.category,
          source: 'on-site', issue: 'Corrective fault found during preventive maintenance ' + j.id + ' (' + j.assets.join(', ') + ').',
          asset: j.assets[0] || '', linkedTo: j.id
        });
        if (res.ok) j.linkedTicketId = res.id;
      });
      if (!res.ok) return res;
      S.update(function () {
        var t = S.getTicket(res.linkedTo === undefined ? res.id : res.id);
        if (t) hist(t, t.status, 'link', 'Create linked corrective ticket following Section 1  --  maintenance job ' + j.id + '.', 'J. Tan', 'technician');
        audit('job', j.id, 'link', 'Linked corrective ticket ' + res.id + ' created (Section 1).', j.status.replace('_', ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }));
        S.notify('coordinator', 'Additional fault in ' + j.id + '  --  linked corrective ticket ' + res.id + ' follows Section 1.', 'job', { ticketId: res.id, jobId: j.id });
      });
      return { ok: true, msg: 'Linked corrective ticket ' + res.id + ' created (Section 1).', id: res.id };
    },

    // Continue maintenance verification -> documentation -> Record maintenance outcome
    // The outcome vocabulary is Successful, Incomplete and Cancelled (D10).
    // The technician hands the finished checklist over; the system decides the
    // outcome when the job is closed, so an open job is never Successful.
    recordOutcome: function (jobId, outcome, notes) {
      var g = guardRole(['technician', 'coordinator']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (['success', 'incomplete', 'cancelled'].indexOf(outcome) === -1) return { ok: false, msg: 'The outcome must be Successful, Incomplete or Cancelled.' };
      if (outcome !== 'success' && S.db.role === 'technician') return { ok: false, msg: 'Only the IT Coordinator or the System Administrator can record an incomplete or cancelled maintenance.' };
      if (j.status === 'closed') return { ok: false, msg: 'Job already closed.' };
      var allDone = j.items.every(function (i) { return i.done; });
      if (outcome === 'success') {
        if (j.status !== 'assigned' && j.status !== 'in_progress') return { ok: false, msg: 'The visit must be Assigned before it can be completed (' + j.id + ' is ' + label(j.status) + ').' };
        if (!allDone) return { ok: false, msg: 'Cannot complete the visit  --  incomplete checklist (' + j.items.filter(function (i) { return !i.done; }).length + ' pending).' };
        if (j.additionalFault === 'unknown') return { ok: false, msg: 'Answer "Additional fault discovered?" first.' };
      }
      S.update(function () {
        j.outcomeNotes = notes || '';
        if (outcome === 'success') {
          j.status = 'resolved'; j.workComplete = true; j.outcome = null;
          j.resolvedAt = NOW(); j.reminders = [];
          j.confirmation = { state: 'pending', person: '', date: null, feedback: '' };
          audit('job', j.id, 'outcome', 'Maintenance work completed  --  checklist complete, handed to the office for Section 3 confirmation' + (notes ? '  --  ' + notes : '') + '.', 'Resolved');
          S.notify('requester', 'Maintenance ' + j.id + ' completed  --  Section 3 confirmation requested.', 'confirm', { jobId: j.id, office: j.office });
          S.notify('coordinator', 'Maintenance ' + j.id + ' is ready for the office to confirm.', 'confirm', { jobId: j.id });
        } else {
          j.outcome = outcome;
          j.status = 'cancelled';
          j.confirmation.state = 'none';
          advanceNextDue(j);
          audit('job', j.id, 'outcome', 'Maintenance outcome ' + outcome + (notes ? '  --  ' + notes : '') + '  --  not marked successful; records preserved.', 'Cancelled');
          S.notify('coordinator', 'Maintenance outcome "' + outcome + '" for ' + j.id + '  --  not marked successful; next due advanced, records preserved.', 'job', { jobId: j.id });
          S.notify('requester', 'Maintenance ' + j.id + ' was not completed (' + outcome + '). The record is retained.', 'job', { jobId: j.id, office: j.office });
        }
      });
      return outcome === 'success'
        ? { ok: true, msg: 'Maintenance work completed  --  awaiting office confirmation.' }
        : { ok: true, msg: 'Maintenance outcome recorded: ' + outcome + '.' };
    },

    // Authorized closure of a maintenance job (Section 3, D4)
    closeJob: function (jobId, reason) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (j.status === 'closed') return { ok: false, msg: 'Job already closed.' };
      if (j.status !== 'resolved') return { ok: false, msg: 'Only a Resolved job can be closed by authorized closure.' };
      if (!reason) return { ok: false, msg: 'Authorized closure requires a reason.' };
      S.update(function () {
        j.status = 'closed';
        j.confirmation = { state: 'authorized', person: who().by, date: NOW() };
        j.outcome = j.items.every(function (i) { return i.done; }) ? 'success' : 'incomplete';
        advanceNextDue(j);
        audit('job', j.id, 'outcome', 'Record maintenance outcome: ' + (j.outcome === 'success' ? 'Successful' : 'Incomplete') + '. Do not mark incomplete or cancelled maintenance successful.', 'Closed');
        audit('job', j.id, 'closure', 'Authorized closure  --  reason: ' + reason + '.', 'Closed');
        S.notify('requester', 'Maintenance ' + j.id + ' was closed by authorized closure. Reason: ' + reason, 'job', { jobId: j.id, office: j.office });
        S.notify('coordinator', 'Maintenance ' + j.id + ' closed by authorized closure (' + who().by + ').', 'job', { jobId: j.id });
      });
      return { ok: true, msg: 'Maintenance job closed by authorized closure.' };
    },

    // Section 3: maintenance confirmation, feedback and closure
    jobConfirmation: function (jobId, decision, person, feedback) {
      var g = guardRole(['requester']); if (!g.ok) return g;
      var j = S.getJob(jobId);
      if (!j) return { ok: false, msg: 'Job not found.' };
      if (j.status !== 'resolved') return { ok: false, msg: 'The maintenance work must be complete before the office can confirm it.' };
      if (decision === 'accepted') {
        if (!person) return { ok: false, msg: 'Record the confirming person.' };
        S.update(function () {
          j.confirmation = { state: 'accepted', person: person, date: NOW(), feedback: feedback || '' };
          j.status = 'closed';
          j.outcome = j.items.every(function (i) { return i.done; }) ? 'success' : 'incomplete';
          advanceNextDue(j);
          S.notify('coordinator', 'Maintenance ' + j.id + ' confirmed by ' + person + '  --  Section 3 closure recorded.', 'confirm', { jobId: j.id });
          S.notify('technician', 'Maintenance ' + j.id + ' confirmed by the office and closed.', 'confirm', { jobId: j.id, office: j.office, to: j.technician });
          audit('job', j.id, 'confirm', 'Office confirmed maintenance  --  confirming person: ' + person + '. Section 3 closure recorded.', 'Closed');
          audit('job', j.id, 'outcome', 'Record maintenance outcome: ' + (j.outcome === 'success' ? 'Successful' : 'Incomplete') + '. Do not mark incomplete or cancelled maintenance successful.', 'Closed');
        });
        return { ok: true, msg: 'Maintenance confirmed and closed (Section 3).' };
      }
      if (decision === 'rejected') {
        if (!feedback) return { ok: false, msg: 'Record the office feedback before rejecting the maintenance.' };
        S.update(function () {
          j.confirmation = { state: 'rejected', person: person || j.office, date: NOW(), feedback: feedback };
          j.status = 'in_progress'; j.outcome = null; j.workComplete = false;
          j.resolvedAt = null; j.reminders = [];
          S.notify('technician', 'Maintenance ' + j.id + ' rejected by office  --  return to verification. Feedback: "' + feedback + '"', 'confirm', { jobId: j.id, office: j.office, to: j.technician });
          S.notify('coordinator', j.id + ' returned to verification on office feedback: "' + feedback + '"', 'confirm', { jobId: j.id, office: j.office });
          audit('job', j.id, 'confirm', 'Office rejected the maintenance result  --  feedback: "' + feedback + '". Returned to verification.', 'In Progress');
        });
        return { ok: true, msg: 'Feedback recorded  --  job returned to verification.' };
      }
      S.update(function () {
        j.confirmation.state = 'no_response';
        if (!j.reminders) j.reminders = [];
        j.reminders.push(NOW());
        S.notify('requester', 'Follow-up reminder: please confirm the result of maintenance ' + j.id + ' (' + j.office + ').', 'remind', { jobId: j.id, office: j.office });
        audit('job', j.id, 'confirm', 'No response from office  --  job kept Resolved; follow-up reminder ' + j.reminders.length + ' sent to the office.', label(j.status));
      });
      return { ok: true, msg: 'No response recorded  --  job stays Resolved, reminder sent.' };
    },

    // Coordinator / administrator edits a preventive maintenance schedule
    updateSchedule: function (id, d) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var sc = S.getSchedule(id);
      if (!sc) return { ok: false, msg: 'Schedule not found.' };
      var ob = officeBlock(sc.office); if (ob) return ob;
      d = d || {};
      var changed = [];
      [['office', 'office'], ['category', 'category'], ['frequency', 'frequency'], ['dueDate', 'due date'], ['technician', 'technician']].forEach(function (pair) {
        if (d[pair[0]] && d[pair[0]] !== sc[pair[0]]) { sc[pair[0]] = d[pair[0]]; changed.push(pair[1]); }
      });
      if (d.assets !== undefined && d.assets !== null && d.assets.join('|') !== (sc.assets || []).join('|')) { sc.assets = d.assets.slice(); changed.push('assets'); }
      if (d.checklist && d.checklist.length) { sc.checklist = d.checklist.slice(); changed.push('checklist'); }
      if (d.dueDate) sc.nextCheck = d.dueDate;
      if (!changed.length) return { ok: false, msg: 'Nothing to update.' };
      S.update(function () { audit('schedule', id, 'sched', 'Schedule updated (' + changed.join(', ') + ').'); });
      return { ok: true, msg: 'Schedule ' + id + ' updated (' + changed.join(', ') + ').' };
    },

    // Pause or resume a preventive maintenance schedule
    setScheduleActive: function (id, active) {
      var g = guardRole(['coordinator']); if (!g.ok) return g;
      var sc = S.getSchedule(id);
      if (!sc) return { ok: false, msg: 'Schedule not found.' };
      var ob = officeBlock(sc.office); if (ob) return ob;
      sc.active = !!active;
      var word = active ? 'activated' : 'paused';
      S.update(function () { audit('schedule', id, 'sched', 'Schedule ' + word + '.'); });
      return { ok: true, msg: 'Schedule ' + id + ' ' + word + '.' };
    }
  };

  /* ================= System administration (users, offices, reference data) ================= */

  function renameOffice(oldName, newName) {
    ['tickets', 'schedules', 'jobs', 'notifications', 'people'].forEach(function (coll) {
      (S.db[coll] || []).forEach(function (r) { if (r.office === oldName) r.office = newName; });
    });
  }
  function slugUsername(name, taken) {
    var base = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ +/g, '.').slice(0, 24) || 'user';
    var u = base, i = 2;
    while (taken.indexOf(u) !== -1) { u = base + i; i++; }
    return u;
  }
  function renamePerson(oldName, newName, prole) {
    if (prole === 'requester') (S.db.tickets || []).forEach(function (t) { if (t.requester === oldName) t.requester = newName; });
    (S.db.tickets || []).forEach(function (t) { if (t.technician === oldName) t.technician = newName; });
    (S.db.schedules || []).forEach(function (s) { if (s.technician === oldName) s.technician = newName; });
    (S.db.jobs || []).forEach(function (j) { if (j.technician === oldName) j.technician = newName; });
  }

  var REF_GROUPS = ['categories', 'sources', 'priorities', 'frequencies'];

  var Admin = {
    // Per-user notification read state (readBy[])
    markNotificationsRead: function (ids) {
      var wanted = null;
      if (ids && ids.length) {
        wanted = {};
        for (var i = 0; i < ids.length; i++) wanted[String(ids[i])] = true;
      }
      var whoName = who().by, nRead = 0;
      S.update(function () {
        (S.db.notifications || []).forEach(function (n) {
          if (wanted && !wanted[String(n.id)]) return;
          if (!n.readBy) n.readBy = [];
          if (n.readBy.indexOf(whoName) === -1) { n.readBy.push(whoName); nRead++; }
        });
      });
      return { ok: true, msg: 'Marked ' + nRead + ' notification(s) as read.', count: nRead };
    },

    // Create or update an office (keyed by name; rename cascades)
    saveOffice: function (d) {
      var g = guardRole(['management']); if (!g.ok) return g;
      d = d || {};
      var name = (d.name || '').trim();
      if (!name) return { ok: false, msg: 'Office name is required.' };
      if (!S.db.offices) S.db.offices = [];
      var offices = S.db.offices;
      var current = String(d.id || '').trim();
      var office = null;
      offices.forEach(function (o) { if ((o.name || '').toLowerCase() === (current || name).toLowerCase()) office = o; });
      if (!office) {
        if (current) return { ok: false, msg: 'Office not found.' };
        var dupe = false;
        offices.forEach(function (o) { if ((o.name || '').toLowerCase() === name.toLowerCase()) dupe = true; });
        if (dupe) return { ok: false, msg: 'An office with that name already exists.' };
        office = { name: name, code: (d.code || '').trim(), location: (d.location || '').trim(), contactPerson: '', contactEmail: '', contactPhone: '', active: true, createdAt: NOW(), updatedAt: NOW() };
        offices.push(office);
        S.update(function () { audit('office', name, 'office', "Office '" + name + "' created."); });
        return { ok: true, msg: "Office '" + name + "' created.", office: office };
      }
      var changed = [];
      if (name !== office.name) {
        var clash = false;
        offices.forEach(function (o) { if (o !== office && (o.name || '').toLowerCase() === name.toLowerCase()) clash = true; });
        if (clash) return { ok: false, msg: 'An office with that name already exists.' };
        var old = office.name;
        office.name = name;
        renameOffice(old, name);
        changed.push('name -> ' + name);
      }
      ['code', 'location', 'contactPerson', 'contactEmail', 'contactPhone'].forEach(function (key) {
        if (d[key] !== undefined && d[key] !== null && String(d[key]).trim() !== String(office[key] || '')) { office[key] = String(d[key]).trim(); changed.push(key); }
      });
      if (d.active !== undefined && !!d.active !== !!office.active) { office.active = !!d.active; changed.push(d.active ? 'active' : 'inactive'); }
      if (!changed.length) return { ok: false, msg: 'Nothing to update.' };
      office.updatedAt = NOW();
      S.update(function () { audit('office', office.name, 'office', "Office '" + office.name + "' updated (" + changed.join(', ') + ")."); });
      return { ok: true, msg: "Office '" + office.name + "' updated (" + changed.join(', ') + ").", office: office };
    },

    setOfficeActive: function (name, active) {
      var g = guardRole(['management']); if (!g.ok) return g;
      var office = null;
      (S.db.offices || []).forEach(function (o) { if ((o.name || '').toLowerCase() === String(name).toLowerCase()) office = o; });
      if (!office) return { ok: false, msg: 'Office not found.' };
      office.active = !!active; office.updatedAt = NOW();
      var word = active ? 'activated' : 'deactivated';
      S.update(function () { audit('office', office.name, 'office', "Office '" + office.name + "' " + word + "."); });
      return { ok: true, msg: "Office '" + office.name + "' " + word + "." };
    },

    // Create or update a user account
    savePerson: function (d) {
      var g = guardRole(['management']); if (!g.ok) return g;
      d = d || {};
      var name = (d.name || '').trim(), prole = d.role;
      if (!name) return { ok: false, msg: 'Name is required.' };
      if (['requester', 'technician', 'coordinator', 'management'].indexOf(prole) === -1) return { ok: false, msg: 'Choose a valid role.' };
      if (!S.db.people) S.db.people = [];
      var people = S.db.people, office = (d.office || '').trim();
      var person = null;
      if (d.id !== undefined && d.id !== null && d.id !== '') {
        people.forEach(function (p) { if (String(p.id) === String(d.id) || String(p.username) === String(d.id)) person = p; });
        if (!person) return { ok: false, msg: 'User not found.' };
        var dup = false;
        people.forEach(function (p) { if (p !== person && (p.name || '').toLowerCase() === name.toLowerCase()) dup = true; });
        if (person.name !== name && dup) return { ok: false, msg: 'A user with that name already exists.' };
        if (person.name !== name) renamePerson(person.name, name, person.role);
        person.name = name; person.role = prole; person.office = office;
        if (d.email !== undefined) person.email = (d.email || '').trim();
        if (d.phone !== undefined) person.phone = (d.phone || '').trim();
        S.update(function () { audit('user', person.username || person.id, 'user', "User '" + name + "' updated (role: " + prole + ")."); });
        return { ok: true, msg: "User '" + name + "' updated.", person: person };
      }
      var exists = false;
      people.forEach(function (p) { if ((p.name || '').toLowerCase() === name.toLowerCase()) exists = true; });
      if (exists) return { ok: false, msg: 'A user with that name already exists.' };
      var taken = people.map(function (p) { return p.username; }).filter(Boolean);
      person = { name: name, role: prole, office: office, username: slugUsername(name, taken), email: (d.email || '').trim(), phone: (d.phone || '').trim(), active: true, prefs: {} };
      people.push(person);
      S.update(function () { audit('user', person.username, 'user', "User '" + name + "' created (role: " + prole + ", username: " + person.username + ")."); });
      return { ok: true, msg: "User '" + name + "' created  --  username " + person.username + ", initial password itc.", person: person };
    },

    setPersonActive: function (pid, active) {
      var g = guardRole(['management']); if (!g.ok) return g;
      var person = null;
      (S.db.people || []).forEach(function (p) { if (String(p.id) === String(pid) || String(p.username) === String(pid)) person = p; });
      if (!person) return { ok: false, msg: 'User not found.' };
      if (!active && person.name === who().by) return { ok: false, msg: 'You cannot deactivate your own account.' };
      person.active = !!active;
      var word = active ? 'activated' : 'deactivated';
      S.update(function () { audit('user', person.username || pid, 'user', "User '" + person.name + "' " + word + "."); });
      return { ok: true, msg: "User '" + person.name + "' " + word + "." };
    },

    // Add or remove a reference-data option (categories, sources, priorities, frequencies)
    saveRef: function (d) {
      var g = guardRole(['management']); if (!g.ok) return g;
      d = d || {};
      var group = d.group;
      if (REF_GROUPS.indexOf(group) === -1) return { ok: false, msg: 'Unknown reference group.' };
      var value = (d.value || '').trim();
      if (!value) return { ok: false, msg: 'Enter a value.' };
      if (!S.db.settings) S.db.settings = {};
      if (!S.db.settings[group]) S.db.settings[group] = [];
      var items = S.db.settings[group];
      function rowLabel(row) { return (row && row.length >= 2) ? row[1] : row; }
      var msg;
      if (group === 'frequencies') {
        var hit = -1;
        items.forEach(function (row, i) { if (String(rowLabel(row)).toLowerCase() === value.toLowerCase()) hit = i; });
        if (d.remove) {
          if (hit === -1) return { ok: false, msg: value + ' is not in the list.' };
          var removed = items.splice(hit, 1)[0];
          S.update(function () { audit('ref', group, 'ref', "Frequency '" + value + "' removed."); });
          msg = "'" + rowLabel(removed) + "' removed from frequencies.";
        } else {
          if (hit !== -1) return { ok: false, msg: "'" + value + "' already exists." };
          var days = parseInt(d.days || 30, 10);
          if (isNaN(days)) return { ok: false, msg: 'Frequency interval must be a number of days.' };
          if (days < 1 || days > 730) return { ok: false, msg: 'Frequency interval must be between 1 and 730 days.' };
          var key = value.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ +/g, '-');
          items.push([key, value, days]);
          S.update(function () { audit('ref', group, 'ref', "Frequency '" + value + "' (" + days + " days) added."); });
          msg = "'" + value + "' every " + days + " days added to frequencies.";
        }
      } else if (d.remove) {
        var found = items.some(function (v) { return String(v).toLowerCase() === value.toLowerCase(); });
        if (!found) return { ok: false, msg: value + ' is not in the list.' };
        S.db.settings[group] = items.filter(function (v) { return String(v).toLowerCase() !== value.toLowerCase(); });
        S.update(function () { audit('ref', group, 'ref', group.charAt(0).toUpperCase() + group.slice(1) + " option '" + value + "' removed."); });
        msg = "'" + value + "' removed from " + group + ".";
      } else {
        var exists2 = items.some(function (v) { return String(v).toLowerCase() === value.toLowerCase(); });
        if (exists2) return { ok: false, msg: "'" + value + "' already exists." };
        items.push(value);
        S.update(function () { audit('ref', group, 'ref', group.charAt(0).toUpperCase() + group.slice(1) + " option '" + value + "' added."); });
        msg = "'" + value + "' added to " + group + ".";
      }
      return { ok: true, msg: msg };
    },

    // Operational settings (reminder interval, simulation, approval policy,
    // priority matrix, authorized closure roles)
    saveSettings: function (d) {
      var g = guardRole(['management']); if (!g.ok) return g;
      d = d || {};
      if (!S.db.settings) S.db.settings = {};
      var settings = S.db.settings, changed = [];
      if (d.reminderMinutes !== undefined) {
        var minutes = parseInt(d.reminderMinutes, 10);
        if (isNaN(minutes)) return { ok: false, msg: 'Reminder interval must be whole minutes.' };
        if (minutes < 1 || minutes > 1440) return { ok: false, msg: 'Reminder interval must be 1-1440 minutes.' };
        if (settings.reminderMinutes !== minutes) { settings.reminderMinutes = minutes; changed.push('reminder interval = ' + minutes + ' min'); }
      }
      if (d.reminderBusinessDays !== undefined) {
        var bd = parseInt(d.reminderBusinessDays, 10);
        if (isNaN(bd) || bd < 1 || bd > 60) return { ok: false, msg: 'The reminder interval must be 1-60 business days.' };
        if (settings.reminderBusinessDays !== bd) { settings.reminderBusinessDays = bd; changed.push('first reminder = ' + bd + ' business days'); }
      }
      if (d.approvalCategories !== undefined) {
        var cats = (d.approvalCategories || []).map(String);
        var known = (settings.categories || []).map(String);
        var unknown = cats.filter(function (c) { return known.indexOf(c) === -1; });
        if (unknown.length) return { ok: false, msg: 'Unknown category: ' + unknown.join(', ') + '.' };
        if ((settings.approvalCategories || []).join('|') !== cats.join('|')) {
          settings.approvalCategories = cats;
          changed.push('approval needed for ' + (cats.length ? cats.join(', ') : 'nothing'));
        }
      }
      if (d.priorityMatrix !== undefined) {
        var pm = d.priorityMatrix || {};
        var clean = {};
        Object.keys(pm).forEach(function (impact) {
          var i = String(impact).toLowerCase();
          if (['high', 'medium', 'low'].indexOf(i) === -1) return;
          clean[i] = {};
          Object.keys(pm[impact]).forEach(function (urg) {
            var u = String(urg).toLowerCase();
            if (['high', 'medium', 'low'].indexOf(u) === -1) return;
            clean[i][u] = String(pm[impact][urg]).toLowerCase();
          });
        });
        if (JSON.stringify(settings.priorityMatrix || {}) !== JSON.stringify(clean)) {
          settings.priorityMatrix = clean; changed.push('priority matrix');
        }
      }
      if (d.authorizedClosureRoles !== undefined) {
        var roles = (d.authorizedClosureRoles || []).map(String);
        var knownRoles = ['requester', 'technician', 'coordinator', 'management'];
        var bad = roles.filter(function (r) { return knownRoles.indexOf(r) === -1; });
        if (bad.length) return { ok: false, msg: 'Unknown role: ' + bad.join(', ') + '.' };
        if (!roles.length) return { ok: false, msg: 'Authorized closure needs at least one role.' };
        if ((settings.authorizedClosureRoles || []).join('|') !== roles.join('|')) {
          settings.authorizedClosureRoles = roles; changed.push('authorized closure roles = ' + roles.join(', '));
        }
      }
      if (d.simulate !== undefined) {
        var flag = !!d.simulate;
        if (!!settings.simulate !== flag) { settings.simulate = flag; changed.push('simulation ' + (flag ? 'on' : 'off')); }
      }
      if (!changed.length) return { ok: false, msg: 'Nothing to update.' };
      S.update(function () { audit('settings', 'settings', 'settings', 'Settings updated (' + changed.join(', ') + ').'); });
      return { ok: true, msg: 'Settings updated (' + changed.join(', ') + ').' };
    }
  };

  /* The status board offers only moves this role may make from the current
     state; the backend still re-checks every call. */
  Flow.canTransition = function (cur, next) { return canTransition(cur, next); };

  window.Flow = Flow;
  window.Maint = Maint;
  window.Admin = Admin;
  /* window.ROLES + role-based access live in js/ui.js (single source of truth). */
})();
