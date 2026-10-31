/* live.js: real-time engine: schedule checks, reminder loops, dependency
   follow-ups, simulated incoming traffic, cross-tab sync, event toasts.
   In DEMO mode (?demo=1) the world clock runs once and stops, so captured
   screenshots are reproducible. */
(function () {
  'use strict';
  var S = window.Store, F = window.Flow, M = window.Maint, U = window.UI;

  var started = false, knownNotif = 0, onEvent = [];

  function toastNew() {
    var list = S.db.notifications.filter(function (n) {
      return n.role === S.db.role || n.role === 'any';
    });
    var fresh = list.filter(function (n) { return n.id > knownNotif; });
    fresh.slice(0, 3).forEach(function (n) { U.toast(n.text, 'live'); });
    if (list.length) knownNotif = Math.max(knownNotif, list[0].id);
    else knownNotif = Math.max.apply(null, [knownNotif].concat(S.db.notifications.map(function (n) { return n.id; })));
  }

  function emit() { onEvent.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }

  /* Assumption A4 counts the reminder interval in business days and A5 defines
     them as Monday to Friday.  Ports server/engine.py `working_due_ms()`, so the
     browser engine and the trusted backend put a reminder on the same day.
     Manila keeps UTC+8 all year, so a calendar date is a fixed shift. */
  var DAY_MS = 864e5, MANILA_OFFSET_MS = 8 * 3600000;

  function manilaParts(ms) {
    var d = new Date(ms + MANILA_OFFSET_MS);
    return {
      key: d.toISOString().slice(0, 10),
      weekday: (d.getUTCDay() + 6) % 7 // Monday 0, same numbering as the backend
    };
  }

  function workingDue(base, days, workdays, holidays) {
    var count = Math.max(0, parseInt(days, 10) || 0);
    var off = (workdays && workdays.length ? workdays : [0, 1, 2, 3, 4]).map(Number);
    var closed = {};
    (holidays || []).forEach(function (h) { if (String(h).trim()) closed[String(h).trim()] = true; });

    function nextWorking(ms) {
      // 400 hops cover a calendar that closes every date for over a year; past
      // that the interval falls back to calendar days rather than never arriving.
      for (var i = 0; i < 400; i++) {
        var p = manilaParts(ms);
        if (off.indexOf(p.weekday) !== -1 && !closed[p.key]) return ms;
        ms += DAY_MS;
      }
      return null;
    }

    var ms = nextWorking(base);
    if (ms === null) return base + count * DAY_MS;
    for (var n = 0; n < count; n++) {
      ms = nextWorking(ms + DAY_MS);
      if (ms === null) return base + count * DAY_MS;
    }
    return ms;
  }

  /* When the next reminder for a Resolved record is due, on the same terms the
     backend uses: business days when the mode says so, plain minutes otherwise. */
  function reminderDueMs(st, base, sentCount) {
    var minutes = (st.reminderMinutes === undefined || st.reminderMinutes === null)
      ? 2 : parseInt(st.reminderMinutes, 10);
    if (st.reminderMode === 'business' && minutes >= 1) {
      var everyDays = sentCount === 0
        ? parseInt(st.reminderBusinessDays === undefined ? 3 : st.reminderBusinessDays, 10)
        : parseInt(st.reminderRepeatDays === undefined ? 7 : st.reminderRepeatDays, 10);
      return workingDue(base, everyDays, st.workdays, st.holidays);
    }
    return base + Math.max((minutes || 0) * 60000, 1) * (sentCount + 1);
  }

  /* One tick of the world clock. */
  function tick() {
    var events = [];

    // System: Check maintenance schedule (auto, real-time)
    if (window.Maint) {
      var raw = M.runScheduleCheck(true);
      var ev = Array.isArray(raw) ? raw : ((raw && raw.events) || []);
      if (ev.length) events = events.concat(ev.map(function (e) { return e.msg; }));
    }

    S.update(function (db) {
      var now = Date.now();

      // 15.3 / 16: Resolved awaiting confirmation -> send follow-up reminder (loop)
      db.tickets.forEach(function (t) {
        if (t.status !== 'resolved' || (t.confirmation.state !== 'pending' && t.confirmation.state !== 'no_response')) return;
        var base = new Date(t.resolvedAt || t.updatedAt).getTime();
        var due = reminderDueMs(db.settings, base, (t.reminders || []).length);
        if (now >= due) {
          t.reminders.push(new Date(Date.now()).toISOString());
          t.history.push({
            at: new Date(Date.now()).toISOString(), by: 'System', role: 'system', status: 'resolved', kind: 'remind',
            text: 'No response. Status kept Resolved; follow-up reminder ' + t.reminders.length + ' sent to the office.'
          });
          db.seq.notif++;
          db.notifications.unshift({
            id: db.seq.notif, at: new Date(Date.now()).toISOString(), role: 'requester', kind: 'remind',
            ticketId: t.id, office: t.office, read: false,
            text: 'Follow-up reminder: please confirm the result of ' + t.id + ' (' + t.office + ').'
          });
          events.push('Reminder loop: ' + t.id + ' still Resolved. Follow-up reminder sent.');
        }
      });

      // 8.x Dependency follow-up due -> Continue follow-up (system nudge)
      db.tickets.forEach(function (t) {
        if (t.status !== 'on_hold' || !t.dependency || t.dependency.state !== 'pending') return;
        if (new Date(t.dependency.dueAt).getTime() <= now) {
          t.dependency.dueAt = new Date(now + 864e5).toISOString(); // no spam
          db.seq.notif++;
          db.notifications.unshift({
            id: db.seq.notif, at: new Date(Date.now()).toISOString(), role: 'coordinator', kind: 'dep',
            ticketId: t.id, read: false,
            text: 'Dependency follow-up due: ' + t.id + '. ' + t.dependency.nextAction + ' (' + t.dependency.responsible + ').'
          });
          events.push('Follow up dependency due: ' + t.id + '.');
        }
      });

      // 16: Resolved maintenance awaiting confirmation -> follow-up reminder
      db.jobs.forEach(function (j) {
        if (j.status !== 'resolved' || !j.confirmation) return;
        if (j.confirmation.state !== 'pending' && j.confirmation.state !== 'no_response') return;
        var base = new Date(j.resolvedAt || j.updatedAt || j.createdAt).getTime();
        var reminders = j.reminders || (j.reminders = []);
        if (now < reminderDueMs(db.settings, base, reminders.length)) return;
        reminders.push(new Date(Date.now()).toISOString());
        db.seq.notif++;
        db.notifications.unshift({
          id: db.seq.notif, at: new Date(Date.now()).toISOString(), role: 'requester', kind: 'remind',
          jobId: j.id, office: j.office, read: false,
          text: 'Follow-up reminder: please confirm the result of maintenance ' + j.id + ' (' + j.office + ').'
        });
        events.push('Reminder loop: maintenance ' + j.id + ' still Resolved. Follow-up sent.');
      });

      // Rescheduled job whose agreed date arrived -> availability is asked again
      db.jobs.forEach(function (j) {
        if (j.status === 'on_hold' && j.visitDate && new Date(j.visitDate).getTime() <= now) {
          if (j.availability === 'yes') {
            j.status = 'assigned';
            db.seq.notif++;
            db.notifications.unshift({
              id: db.seq.notif, at: new Date(Date.now()).toISOString(), role: 'technician', kind: 'sched', to: j.technician,
              jobId: j.id, office: j.office, read: false, text: 'Agreed date reached for ' + j.id + '. Continue the maintenance visit.'
            });
            events.push('On agreed date: ' + j.id + ' visit can proceed.');
          } else if (j.availability !== 'asked') {
            j.availability = 'asked';
            db.seq.notif++;
            db.notifications.unshift({
              id: db.seq.notif, at: new Date(Date.now()).toISOString(), role: 'requester', kind: 'sched',
              jobId: j.id, office: j.office, read: false,
              text: 'Confirm availability for the rescheduled maintenance visit ' + j.id + ' on ' + j.visitDate.slice(0, 10) + '.'
            });
            db.seq.notif++;
            db.notifications.unshift({
              id: db.seq.notif, at: new Date(Date.now()).toISOString(), role: 'coordinator', kind: 'sched',
              jobId: j.id, office: j.office, read: false,
              text: j.id + ': agreed reschedule date reached, waiting for the office availability answer.'
            });
            events.push('Availability confirmation requested: ' + j.id + '.');
          }
        }
      });

      // Simulation: other offices keep working, with occasional live intake.
      // The PDF has no simulated intake, so the registry flag decides whether
      // this runs at all; the settings switch alone is not enough.
      var gap = now - (db.lastSim || 0);
      var simOn = window.Features && window.Features.on('demoIntakeSimulation');
      if (simOn && db.settings.simulate && gap > 45000 && Math.random() < 0.5) {
        db.lastSim = now;
        var pool = [
          { office: 'Library', requester: 'M. Bataller', category: 'Hardware Repair', issue: 'Public-use PC in the reference area will not boot past the logo.', asset: 'PC-LIB-07' },
          { office: 'Accounting', requester: 'R. Villanueva', category: 'Network and Connectivity', issue: 'Cannot reach the shared drive from the teller PCs.', asset: '' },
          { office: 'HR', requester: 'L. Sarmiento', category: 'Software Support', issue: 'Payslip generator returns a blank page when printing.', asset: '' },
          { office: 'Registrar', requester: 'P. Ocampo', category: 'Printer and Peripheral', issue: 'Toner smears on the right margin of long documents.', asset: 'PRN-REG-02' },
          { office: 'Records Office', requester: 'A. Delos Reyes', category: 'Software Support', issue: 'Scanning app crashes when handling batches over 50 pages.', asset: '' }
        ];
        var pick = pool[Math.floor(Math.random() * pool.length)];
        var sources = (db.settings.sources && db.settings.sources.length)
          ? db.settings.sources : ['telephone', 'email', 'walk-in', 'on-site', 'online portal'];
        var id = 'IT-' + new Date(Date.now()).getFullYear() + '-' + String(++db.seq.ticket).padStart(6, '0');
        db.tickets.unshift({
          v: 3, id: id, office: pick.office, requester: pick.requester, category: pick.category,
          source: sources[Math.floor(Math.random() * sources.length)],
          issue: pick.issue, asset: pick.asset, attachments: [],
          status: 'submitted', impact: null, urgency: null, priority: 'medium', target: null,
          technician: null, createdAt: new Date(Date.now()).toISOString(), updatedAt: new Date(Date.now()).toISOString(),
          reviewed: false, recurring: false, linkedTo: null, cancelReason: null, closure: null, authorizedReason: '',
          diagnosis: { findings: '', actions: '', parts: '', cost: 0, labor: 0, dates: '', evidence: [] },
          confirmation: { state: 'none', person: '', date: null, feedback: '' },
          dependency: null, tests: [], reminders: [],
          history: [{ at: new Date(Date.now()).toISOString(), by: pick.requester, role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' }]
        });
        db.notifications.unshift({
          id: ++db.seq.notif, at: new Date(Date.now()).toISOString(), role: 'coordinator', kind: 'intake',
          ticketId: id, office: pick.office, read: false, text: id + ' recorded live from ' + pick.office + '. Status: Submitted.'
        });
        events.push('Live intake: ' + id + ' from ' + pick.office + '.');
      }
    });

    /* A tick can generate a job or change a queue, so the sidebar counts and
       the bell are read again on every tick rather than on navigation only. */
    U.renderBell();
    U.renderPills();

    if (events.length) {
      events.forEach(function (e) { U.toast(e, 'live'); });
      emit();
    }
    toastNew();
  }

  window.Live = {
    start: function (opts) {
      opts = opts || {};
      if (started) return; started = true;
      // seed known ids so history doesn't spam toasts
      knownNotif = S.db.notifications.reduce(function (m, n) { return Math.max(m, n.id); }, 0);
      if (opts.onEvent) onEvent.push(opts.onEvent);
      // API mode: the server worker owns schedule checks, reminders and
      // dependency follow-ups; just keep open tabs in sync over SSE.
      if (window.ApiMode && window.Api) { window.Api.startLive(); return; }
      if (window.DEMO) {
        // deterministic capture mode: run the world clock exactly once and do
        // not schedule a repeating tick (keeps screenshots reproducible)
        try { tick(); } catch (e) { console.error(e); }
        return;
      }
      setInterval(tick, S.db.settings.tickMs);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    },
    onEvent: function (f) { onEvent.push(f); },
    runOnce: function () { tick(); }
  };
})();
