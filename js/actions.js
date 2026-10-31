/* actions.js: shared guarded actions + modal forms for every screen.
   Actions.act(name, ticketId, cb): cb(newId) fires after a mutation. */
(function () {
  'use strict';
  var S = window.Store, F = window.Flow, M = window.Maint, U = window.UI;

  function after(r, cb) {
    U.toast(r.msg, r.ok ? 'ok' : 'err');
    if (r.ok) U.renderBell();
    if (r.ok && cb) cb(r.id);
  }
  function save(id, cb) {
    return function () { /* overridden per modal */ };
  }

  function act(a, id, cb) {
    var t = S.getTicket(id);
    switch (a) {

      /* ---- coordinator review ---- */
      case 'needsinfo':
        U.openModal('Request missing details (details complete: No)',
          U.field('List exactly what is missing', U.textarea('missing', 'e.g. Serial number of the unit, exact error message, room number.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Send request (→ Needs Information)</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.requestInfo(id, U.modalValue('missing')); U.closeModal(); after(r, cb);
        };
        break;

      case 'supplyinfo':
        U.openModal('Information supplied: return this ticket to review',
          U.field('What was supplied', U.textarea('note', 'e.g. Serial number and exact error text received by phone.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Return to Submitted</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.submitInfo(id, { note: U.modalValue('note') }); U.closeModal(); after(r, cb);
        };
        break;

      case 'reviewassign':
        U.openModal('Review complete: assess, assign and notify',
          '<div class="grid grid-form">' +
          U.field('Impact', U.select('impact', ['Low', 'Medium', 'High'], t.impact || 'Medium', true)) +
          U.field('Urgency', U.select('urgency', ['Low', 'Medium', 'High'], t.urgency || 'Medium', true)) +
          U.field('Priority', U.select('priority', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']], t.priority || 'medium', true)) +
          U.field('Target completion date', U.dateInput('target', (t.target || '').slice(0, 10), { required: true })) +
          U.field('Technician', U.select('tech', [['J. Tan', 'J. Tan (hardware / network)'], ['M. Uy', 'M. Uy (printers / UPS)'], ['K. Villanueva', 'K. Villanueva (systems)']], t.technician || 'J. Tan', true)) +
          '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save and assign</button>');
        document.getElementById('mGo').onclick = function () {
          var a = F.assess(id, {
            impact: U.modalValue('impact'), urgency: U.modalValue('urgency'),
            priority: U.modalValue('priority'), target: U.modalValue('target')
          });
          if (!a.ok) { U.closeModal(); after(a, cb); return; }
          var r = F.assign(id, U.modalValue('tech'));
          U.closeModal(); after(r, cb);
        };
        break;

      case 'assess':
        U.openModal('Assess impact and urgency: set priority and target date',
          '<div class="grid grid-form">' +
          U.field('Impact', U.select('impact', ['Low', 'Medium', 'High'], t.impact || 'Medium', true)) +
          U.field('Urgency', U.select('urgency', ['Low', 'Medium', 'High'], t.urgency || 'Medium', true)) +
          U.field('Priority', U.select('priority', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']], t.priority || 'medium', true)) +
          U.field('Target completion date', U.dateInput('target', (t.target || '').slice(0, 10), { required: true })) +
          '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save assessment</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.assess(id, { impact: U.modalValue('impact'), urgency: U.modalValue('urgency'), priority: U.modalValue('priority'), target: U.modalValue('target') });
          U.closeModal(); after(r, cb);
        };
        break;

      case 'assign':
        U.openModal('Assign technician: status Assigned',
          U.field('Technician', U.select('tech', [['J. Tan', 'J. Tan (hardware / network)'], ['M. Uy', 'M. Uy (printers / UPS)'], ['K. Villanueva', 'K. Villanueva (systems)']], t.technician || 'J. Tan', true)) +
          U.field('Coordination note (optional)', U.input('note', 'e.g. Visit after 2 PM, coordinate with the office head')),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Assign &amp; notify</button>');
        document.getElementById('mGo').onclick = function () {
          var tech = U.modalValue('tech'), note = U.modalValue('note');
          var r = F.assign(id, tech);
          if (r.ok && note) F.coordinate(id, { date: (t.target || S.NOW()).slice(0, 10), tech: tech, notes: note });
          U.closeModal(); after(r, cb);
        };
        break;

      case 'reassign':
        U.openModal('Reassign technician: ' + id,
          U.field('Technician', U.select('tech', [['J. Tan', 'J. Tan (hardware / network)'], ['M. Uy', 'M. Uy (printers / UPS)'], ['K. Villanueva', 'K. Villanueva (systems)']], t.technician || 'J. Tan', true)) +
          '<div class="note mt"><span>' + UI.icon('eye') + '</span><div>The status does not change. The previous and the new technician, and the office, are notified.</div></div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Reassign &amp; notify</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.reassign(id, U.modalValue('tech')); U.closeModal(); after(r, cb);
        };
        break;

      case 'coord':
        U.openModal('Coordinate service schedule (SOP 10)',
          '<div class="grid grid-form">' +
          U.field('Service date', U.dateInput('date', (t.target || '').slice(0, 10) || S.NOW().slice(0, 10), { required: true })) +
          U.field('Time slot', U.select('slot', ['Morning', 'Afternoon', 'Whole day'], 'Morning', true)) +
          U.field('Technician', U.select('tech', ['J. Tan', 'M. Uy', 'K. Villanueva'], t.technician || 'J. Tan', true)) +
          U.field('Notes', U.input('notes', 'e.g. Office head will be present')) + '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save &amp; notify</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.coordinate(id, { date: U.modalValue('date'), slot: U.modalValue('slot'), tech: U.modalValue('tech'), notes: U.modalValue('notes') });
          U.closeModal(); after(r, cb);
        };
        break;

      /* ---- technician lane ---- */
      case 'start': {
        var coordinated = (t.history || []).some(function (h) { return h.kind === 'sched'; });
        if (coordinated) { after(F.startWork(id), cb); break; }
        /* No schedule entry yet: coordinate the visit, then start (Section 4). */
        U.openModal('Coordinate the visit before starting work (SOP 10)',
          '<div class="grid grid-form">' +
          U.field('Service date', U.dateInput('date', (t.target || '').slice(0, 10) || S.NOW().slice(0, 10), { required: true })) +
          U.field('Time slot', U.select('slot', ['Morning', 'Afternoon', 'Whole day'], 'Morning', true)) +
          U.field('Coordination note', U.input('note', 'e.g. Visit agreed with the office head for the afternoon', '', { required: true })) + '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save &amp; start work</button>');
        document.getElementById('mGo').onclick = function () {
          var note = U.modalValue('note');
          var c = F.coordinate(id, { date: U.modalValue('date'), slot: U.modalValue('slot'), tech: t.technician, notes: note });
          if (!c.ok) { U.closeModal(); after(c, cb); return; }
          var r = F.startWork(id, note);
          U.closeModal(); after(r, cb);
        };
        break;
      }

      case 'diagnose':
        U.openModal((t.diagnosis.findings ? 'Edit' : 'Record') + ' diagnosis: findings, actions, parts, costs, labor, dates, evidence',
          U.field('Findings', U.textarea('findings', 'Root cause and what you observed', t.diagnosis.findings, 3, true)) +
          '<div class="grid grid-form mt">' +
          U.field('Actions performed', U.input('actions', 'e.g. Replaced PSU, cleaned chassis', t.diagnosis.actions)) +
          U.field('Parts used', U.input('parts', 'e.g. ATX 600W PSU', t.diagnosis.parts)) +
          U.field('Cost (₱)', U.numberInput('cost', t.diagnosis.cost)) +
          U.field('Labor (hours)', U.numberInput('labor', t.diagnosis.labor)) +
          U.field('Date', U.input('dates', 'e.g. Oct 8, 2026', t.diagnosis.dates)) +
          U.field('Evidence', U.input('evidence', 'e.g. photo-after.jpg', (t.diagnosis.evidence || []).join(', '))) + '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save diagnosis</button>');
        document.getElementById('mGo').onclick = function () {
          var ev = U.modalValue('evidence');
          var r = F.diagnose(id, {
            findings: U.modalValue('findings'), actions: U.modalValue('actions'), parts: U.modalValue('parts'),
            cost: U.modalValue('cost'), labor: U.modalValue('labor'), dates: U.modalValue('dates'),
            evidence: ev ? ev.split(',').map(function (s) { return s.trim(); }) : []
          });
          U.closeModal(); after(r, cb);
        };
        break;

      case 'repair':
        U.openModal((t.diagnosis.actions ? 'Edit' : 'Record') + ' repair: actions performed, parts, costs, labor, dates, evidence',
          U.field('Actions performed', U.textarea('actions', 'e.g. Replaced PSU, cleaned chassis, reconfigured network', t.diagnosis.actions, 3, true)) +
          '<div class="grid grid-form mt">' +
          U.field('Parts used', U.input('parts', 'e.g. ATX 600W PSU', t.diagnosis.parts)) +
          U.field('Cost (₱)', U.numberInput('cost', t.diagnosis.cost)) +
          U.field('Labor (hours)', U.numberInput('labor', t.diagnosis.labor)) +
          U.field('Date', U.input('dates', 'e.g. Oct 8, 2026', t.diagnosis.dates)) +
          U.field('Evidence', U.input('evidence', 'e.g. photo-after.jpg', (t.diagnosis.evidence || []).join(', '))) + '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save repair record</button>');
        document.getElementById('mGo').onclick = function () {
          var ev = U.modalValue('evidence');
          var r = F.recordRepair(id, {
            actions: U.modalValue('actions'), parts: U.modalValue('parts'),
            cost: U.modalValue('cost'), labor: U.modalValue('labor'), dates: U.modalValue('dates'),
            evidence: ev ? ev.split(',').map(function (s) { return s.trim(); }) : []
          });
          U.closeModal(); after(r, cb);
        };
        break;

      case 'hold':
        U.openModal('Parts, approval or external support needed? → On Hold',
          U.field('Dependency reason', U.input('reason', 'e.g. Replacement PSU awaiting supplier delivery', '', { required: true })) +
          '<div class="grid grid-form mt">' +
          U.field('Responsible person', U.input('responsible', 'e.g. Procurement, Mr. Uy', '', { required: true })) +
          U.field('Next action', U.input('nextAction', 'e.g. Follow up on PO status', '', { required: true })) +
          U.field('Follow-up due', U.dateInput('dueAt', S.NOW().slice(0, 10))) + '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Place On Hold</button>');
        document.getElementById('mGo').onclick = function () {
          var due = U.modalValue('dueAt');
          var r = F.placeHold(id, {
            reason: U.modalValue('reason'), responsible: U.modalValue('responsible'),
            nextAction: U.modalValue('nextAction'), dueAt: due ? new Date(due + 'T17:00:00').toISOString() : null
          });
          U.closeModal(); after(r, cb);
        };
        break;

      case 'pass':
        U.openModal('Record test: did the service pass?',
          U.field('Service summary (what was done and verified)', U.textarea('note', 'e.g. 30-minute burn-in, no errors, office user confirmed.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Yes → Status: Resolved</button>');
        document.getElementById('mGo').onclick = function () { var r = F.recordTest(id, 'pass', U.modalValue('note')); U.closeModal(); after(r, cb); };
        break;

      case 'fail':
        U.openModal('Record failed test: return to diagnosis (loop)',
          U.field('What failed / retest notes', U.textarea('note', 'e.g. #REF errors persist after template rebuild.')),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger-soft" id="mGo">Record failed test</button>');
        document.getElementById('mGo').onclick = function () { var r = F.recordTest(id, 'fail', U.modalValue('note')); U.closeModal(); after(r, cb); };
        break;

      /* ---- dependency follow-up (coordinator lane) ---- */
      case 'followup':
        U.openModal('Record follow-up update: ' + id,
          U.field('Follow-up outcome', U.textarea('text', 'e.g. Supplier confirmed delivery on Friday.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save</button>');
        document.getElementById('mGo').onclick = function () { var r = F.followUp(id, U.modalValue('text')); U.closeModal(); after(r, cb); };
        break;

      case 'resolve':
        U.openModal('Dependency resolved: record the outcome note',
          U.field('What resolved the dependency?', U.textarea('note', 'e.g. Supplier delivered the PSU; procured and checked by procurement.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Keep On Hold</button><button class="btn btn-primary" id="mGo">Resolve → back to work</button>');
        document.getElementById('mGo').onclick = function () { var r = F.resolveDependency(id, U.modalValue('note')); U.closeModal(); after(r, cb); };
        break;

      case 'cannot':
        U.openModal('Dependency outcome? Cannot proceed → cancellation reason',
          U.field('Cancellation reason', U.textarea('reason', 'e.g. No compatible part available; office agreed to replace the unit.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Keep On Hold</button><button class="btn btn-danger-soft" id="mGo">Cancel request</button>');
        document.getElementById('mGo').onclick = function () { var r = F.cancelFromDependency(id, U.modalValue('reason')); U.closeModal(); after(r, cb); };
        break;

      /* ---- Section 3 confirmation / closure ---- */
      case 'accept': after(F.officeDecision(id, 'accepted', { person: U.viewerName() || t.requester, feedback: '' }), cb); break;

      case 'reject':
        U.openModal('Office rejects the result: record feedback',
          U.field('Office feedback (what is still wrong?)', U.textarea('feedback', 'e.g. Still faint prints on legal size paper.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger-soft" id="mGo">Record feedback → diagnosis</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.officeDecision(id, 'rejected', { person: t.requester, feedback: U.modalValue('feedback') });
          U.closeModal(); after(r, cb);
        };
        break;

      case 'noresp': after(F.officeDecision(id, 'no_response', {}), cb); break;
      case 'remind': after(F.sendReminder(id), cb); break;

      case 'autoclose':
        U.openModal('Authorized closure: confirmation not on record',
          U.field('Reason for authorized closure', U.textarea('reason', 'e.g. Office head authorised closure by email; requester on leave.', '', 3, true)),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-danger-soft" id="mGo">Close ticket</button>');
        document.getElementById('mGo').onclick = function () { var r = F.close(id, 'authorized', U.modalValue('reason')); U.closeModal(); after(r, cb); };
        break;

      /* ---- cancellation / withdrawal ---- */
      case 'cancel': {
        /* The office may have asked for the withdrawal; their stated reason
           prefills the coordinator's cancellation reason. */
        var wReason = (t && t.withdrawal && t.withdrawal.reason) || '';
        U.openModal('Record cancellation reason: ' + id,
          (wReason ? '<div class="note warn"><span>↩</span><div><b>The office requested withdrawal.</b> ' + U.esc(wReason) + '</div></div>' : '') +
          U.field('Cancellation reason', U.textarea('reason', 'e.g. Active request withdrawn. Office procured a replacement in-house.', wReason, 3, true)),
          '<button class="btn btn-ghost" data-close>Keep ticket open</button><button class="btn btn-danger-soft" id="mGo">Set Cancelled</button>');
        document.getElementById('mGo').onclick = function () { var r = F.cancel(id, U.modalValue('reason')); U.closeModal(); after(r, cb); };
        break;
      }

      /* ---- recurrence after closure ---- */
      case 'recur':
        U.openModal('Issue recurs after closure? → create new linked ticket',
          U.field('Describe the recurrence', U.textarea('issue', 'e.g. Same thermal shutdown after two weeks of stable use.', '', 3, true, 10)),
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Create linked ticket (Section 1)</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.createLinkedTicket(id, { issue: U.modalValue('issue') });
          U.closeModal(); after(r, cb);
        };
        break;

      /* ---- requester corrections while Submitted / Needs Information ---- */
      /* The office's reply and the staff note are composed on the record
         screen itself, which posts through Flow.addComment with the visibility
         the writer is entitled to, so this layer carries no conversation case. */
      case 'edit-intake':
        U.openModal('Edit your request: ' + id,
          U.field('What is the problem?', U.textarea('issue', 'Describe the issue in your own words', t.issue, 3, true, 10)) +
          '<div class="grid grid-form mt">' +
          U.field('Category', U.select('category', (S.db.settings.categories || []), t.category, true)) +
          U.field('Source', U.select('source', (S.db.settings.sources || []).map(function (v) { return [v, U.sourceLabel(v)]; }), t.source, true)) +
          U.field('Asset tag', U.input('asset', 'e.g. PC-REC-014', t.asset || '')) +
          '</div>',
          '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="mGo">Save changes</button>');
        document.getElementById('mGo').onclick = function () {
          var r = F.updateTicket(id, {
            issue: U.modalValue('issue'), category: U.modalValue('category'),
            source: U.modalValue('source'), asset: U.modalValue('asset')
          });
          U.closeModal(); after(r, cb);
        };
        break;
    }
  }

  window.Actions = { act: act };
})();
