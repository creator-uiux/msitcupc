/* ui.js  --  shared helpers: chrome (nav, role, account, bell, clock), role model &
   access control, toasts, modals, badges */
(function () {
  'use strict';
  var S = window.Store;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function attr(s) { return esc(s); }

  var STATUS = {
    submitted: ['Submitted', 'b-submitted'], needs_info: ['Needs Information', 'b-needs-info'],
    assigned: ['Assigned', 'b-assigned'], in_progress: ['In Progress', 'b-progress'],
    on_hold: ['On Hold', 'b-hold'], resolved: ['Resolved', 'b-resolved'],
    closed: ['Closed', 'b-closed'], cancelled: ['Cancelled', 'b-cancelled']
  };
  function badge(st) {
    var s = STATUS[st] || [st, 'b-submitted'];
    return '<span class="badge ' + s[1] + '">' + icon(STATUS_ICON[st] || 'inbox') + s[0] + '</span>';
  }
  function prio(p) {
    var map = { low: ['Low', 'p-low'], medium: ['Medium', 'p-medium'], high: ['High', 'p-high'], critical: ['Critical', 'p-critical'] };
    var m = map[p] || [' -- ', 'p-low'];
    return '<span class="prio ' + m[1] + '">' + icon(PRIO_ICON[p] || 'chevronRight') + m[0] + '</span>';
  }
  /* Every displayed timestamp is rendered in Asia/Manila (js/time.js), never
     in the browser's own timezone. */
  function timeAgo(iso) { return (window.Time && window.Time.ago) ? window.Time.ago(iso) : ' -- '; }
  function clock(iso) { return (window.Time && window.Time.fmt) ? window.Time.fmt(iso) : ' -- '; }
  /* A date for display: "Oct 8, 2026", always in Asia/Manila.  The raw
     ISO day is available as Time.day() for a date input value. */
  function dateOnly(iso) { return (window.Time && window.Time.date) ? window.Time.date(iso) : ' -- '; }

  /* ---------- the work-order card ----------
     One record at a glance: ticket number, subject, office, category icon,
     status chip, priority as a coloured left edge plus a text chip, assignee
     avatar, the due or overdue chip, and small attachment and reply counts.
     Used by the register card view, the dashboards and the phone layouts.
     The counts never expose an internal note to an office requester. */
  var CATEGORY_ICON = {
    'Hardware Repair': 'wrench',
    'Software Support': 'monitor',
    'Network and Connectivity': 'activity',
    'Account Assistance': 'key',
    'Printer and Peripheral': 'printer',
    'Installation and Configuration': 'package',
    'Other': 'folder'
  };
  function categoryIcon(category) {
    return CATEGORY_ICON[category] || 'ticket';
  }
  /* A small trend line for a KPI tile. Values are plain counts; the caller
     supplies the title that says what the line measures. */
  function sparkline(values, opts) {
    opts = opts || {};
    var w = 96, h = 28, pad = 3;
    var max = 1;
    values.forEach(function (v) { if (v > max) max = v; });
    var n = values.length;
    var pts = values.map(function (v, i) {
      var x = pad + (w - 2 * pad) * (n > 1 ? i / (n - 1) : 0);
      var y = h - pad - (h - 2 * pad) * (v / max);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var area = pad + ',' + (h - pad) + ' ' + pts.join(' ') + ' ' + (w - pad) + ',' + (h - pad);
    return '<svg class="spark' + (opts.cls ? ' ' + opts.cls : '') +
      '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon points="' + area + '" class="spark-area"/>' +
      '<polyline points="' + pts.join(' ') + '" class="spark-line"/></svg>';
  }

  /* A radial completion gauge. The number is printed in the middle so the
     ring is never the only carrier of the value. */
  function gauge(pct, caption) {
    pct = Math.max(0, Math.min(100, Number(pct) || 0));
    var r = 34, c = 2 * Math.PI * r;
    var off = c - c * pct / 100;
    var tone = pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'danger';
    return '<div class="gauge g-' + tone + '" role="img" aria-label="' +
      attr(caption + ' ' + Math.round(pct) + ' percent') + '">' +
      '<svg viewBox="0 0 84 84" aria-hidden="true">' +
      '<circle class="g-track" cx="42" cy="42" r="' + r + '"/>' +
      '<circle class="g-fill" cx="42" cy="42" r="' + r + '" stroke-dasharray="' + c.toFixed(1) +
      '" stroke-dashoffset="' + off.toFixed(1) + '"/></svg>' +
      '<b class="g-num">' + Math.round(pct) + '%</b></div>';
  }

  function workCard(t, opts) {
    opts = opts || {};
    var role = opts.role || roleKey();
    var href = opts.href || ('ticket.html?id=' + encodeURIComponent(t.id));
    var overdue = t.overdue === undefined
      ? !!(window.Query && Query.isOverdue && Query.isOverdue(t))
      : !!t.overdue;
    var pKey = ['low', 'medium', 'high', 'critical'].indexOf(t.priority) > -1 ? t.priority : 'low';
    var pLabel = pKey.charAt(0).toUpperCase() + pKey.slice(1);
    var comments = Array.isArray(t.comments) ? t.comments : [];
    var replies = comments.filter(function (c) {
      return canSeeInternal(role) || c.visibility !== 'internal';
    }).length;
    var files = Array.isArray(t.attachments) ? t.attachments.length : 0;
    var due = t.target ? dateOnly(t.target) : '';
    var tech = t.technician || '';
    var subject = String(t.issue == null ? '' : t.issue);
    return '<a class="wo-card wo-p-' + attr(pKey) + '" href="' + attr(href) + '"' +
      (t.status === 'cancelled' ? ' data-cancelled="1"' : '') + '>' +
      '<span class="wo-top"><span class="wo-id">' + esc(t.id) + '</span>' +
      '<span class="wo-cat">' + icon(categoryIcon(t.category)) +
      '<span class="wo-cat-name">' + esc(t.category || '') + '</span></span></span>' +
      '<span class="wo-title">' + esc(subject.slice(0, 96)) + (subject.length > 96 ? '…' : '') + '</span>' +
      '<span class="wo-office">' + icon('building') + esc(t.office || '') +
      (t.requester ? ' · ' + esc(t.requester) : '') + '</span>' +
      '<span class="wo-foot">' + badge(t.status) +
      '<span class="wo-prio prio p-' + attr(pKey) + '">' + esc(pLabel) + '</span>' +
      (due || overdue ? '<span class="wo-due' + (overdue ? ' is-overdue' : '') + '">' +
        icon(overdue ? 'alert' : 'cal') + (overdue ? 'Overdue' : esc(due)) +
        (overdue && due ? ' · ' + esc(due) : '') + '</span>' : '') +
      '</span>' +
      '<span class="wo-bar"><span class="wo-tech">' +
      (tech
        ? '<span class="wo-avatar" aria-hidden="true">' + esc(initials(tech)) + '</span>' +
          '<span class="wo-tech-name">' + esc(tech) + '</span>'
        : '<span class="wo-avatar is-empty" aria-hidden="true">' + icon('user') + '</span>' +
          '<span class="wo-tech-name">Unassigned</span>') +
      '</span><span class="wo-counts">' +
      (files ? '<span title="' + files + ' attachment(s)">' + icon('paperclip') + files + '</span>' : '') +
      (replies ? '<span title="' + replies + ' reply(ies)">' + icon('message') + replies + '</span>' : '') +
      '</span></span></a>';
  }

  /* ============================================================
     ROLE MODEL  --  single source of truth for roles, screens & features
     (mirrors the guards in js/flow.js)
     ============================================================ */
  var ROLES = {
    requester: {
      name: 'A. Delos Reyes', title: 'Office Requester', short: 'Requester',
      office: 'Records Office', email: 'a.delosreyes@upcebu.edu.ph', accent: '#0f8f50', tint: '#e6f5ec',
      blurb: 'Raises and follows up service requests for their office, and confirms results.'
    },
    technician: {
      name: 'J. Tan', title: 'IT Technician', short: 'Technician',
      office: 'IT Office', email: 'j.tan@upcebu.edu.ph', accent: '#0e7490', tint: '#e0f7fa',
      blurb: 'Diagnoses, tests and repairs assigned tickets and executes maintenance checklists.'
    },
    coordinator: {
      name: 'K. Ramos', title: 'IT Coordinator', short: 'Coordinator',
      office: 'IT Office', email: 'k.ramos@upcebu.edu.ph', accent: '#014421', tint: '#e2efe7',
      blurb: 'Reviews, assesses, assigns, schedules, monitors and closes every request.'
    },
    management: {
      name: 'M. Reyes', title: 'System Administrator', short: 'Administrator',
      office: 'Office of the Director', email: 'm.reyes@upcebu.edu.ph', accent: '#6d28d9', tint: '#f3eefe',
      blurb: 'Manages users, offices, reference data and the audit log; read-only oversight of the workflow.'
    }
  };
  var ROLE_ORDER = ['requester', 'technician', 'coordinator', 'management'];
  var ALL = ROLE_ORDER.slice();
  window.ROLES = ROLES; /* legacy global kept for page scripts */

  /* ------------------------------------------------------------
     NEXT ACTION OWNER  --  who must act next, per status.

     One table, used by the "Needs my action" queue on the dashboard,
     the "Waiting on" label on every ticket and maintenance job, and the
     record screen when the signed-in role has nothing to do.  The role
     names are the same ones the sidebar and the badges use, so the
     screen and the Workflow Guide always tell the same story
     (specification 4A.3).
     ------------------------------------------------------------ */
  var NEXT_OWNER = {
    submitted: { role: 'coordinator', label: 'IT Coordinator' },
    needs_info: { role: 'requester', label: 'Office Requester' },
    assigned: { role: 'technician', label: 'IT Technician' },
    in_progress: { role: 'technician', label: 'IT Technician' },
    on_hold: { role: 'coordinator', label: 'IT Coordinator' },
    resolved: { role: 'requester', label: 'Office Requester' },
    closed: { role: 'none', label: 'Nobody' },
    cancelled: { role: 'none', label: 'Nobody' }
  };
  /* The maintenance job steps use the same three owners. */
  var NEXT_OWNER_JOB = {
    submitted: { role: 'coordinator', label: 'IT Coordinator' },
    assigned: { role: 'coordinator', label: 'IT Coordinator' },
    in_progress: { role: 'technician', label: 'IT Technician' },
    on_hold: { role: 'requester', label: 'Office Requester' },
    resolved: { role: 'requester', label: 'Office Requester' },
    closed: { role: 'none', label: 'Nobody' },
    cancelled: { role: 'none', label: 'Nobody' }
  };
  function nextOwner(status, isJob) {
    var table = isJob ? NEXT_OWNER_JOB : NEXT_OWNER;
    return table[status] || { role: 'none', label: 'Nobody' };
  }
  /* Is this record waiting on the signed-in role? */
  function waitsOnMe(status, isJob, role) {
    role = role || roleKey();
    return nextOwner(status, isJob).role === role;
  }
  /* The "Waiting on" label, ready for the markup. */
  function waitingOn(status, isJob) {
    var o = nextOwner(status, isJob);
    return '<span class="chip chip-waiting">Waiting on: ' + esc(o.label) + '</span>';
  }

  /* ------------------------------------------------------------
     URL ROLE  --  the role can also be carried by the URL itself.
     Role-named pages (or-dashboard.html, itc-ticket.html ...) are
     generated by tools/role_pages.py from the ACCESS map below.
     The prefix NAMES the role; it can never GRANT access.  A prefix
     that disagrees with the signed-in role redirects to the visitor's
     own equivalent page, so the lanes stay unbypassable.
     ------------------------------------------------------------ */
  var URL_PREFIX = { requester: 'or', technician: 'itc',
                     coordinator: 'ic', management: 'mgmt' };
  var PREFIX_ROLE = { or: 'requester', itc: 'technician',
                      ic: 'coordinator', mgmt: 'management' };

  /* 'or-dashboard.html' -> { prefix: 'or', role: 'requester', page: 'dashboard.html' } */
  function parseUrlRole() {
    var file = String(location.pathname).split('/').pop() || '';
    var m = /^(or|itc|ic|mgmt)-(.+\.html)$/.exec(file);
    if (!m) return null;
    return { prefix: m[1], role: PREFIX_ROLE[m[1]], page: m[2] };
  }

  /* 'dashboard.html' = 'or-dashboard.html' for the given role */
  function urlFor(page, role) {
    var p = URL_PREFIX[role];
    return p ? p + '-' + page : page;
  }

  /* Screen permissions come from the single permission map (permissions.json),
     mirrored into js/permissions.js.  The backend reads the same file, so the
     frontend and the backend can never disagree about who may open what. */
  var ACCESS = (window.PermissionMap && window.PermissionMap.pages) ? window.PermissionMap.pages : {
    'index.html': ALL,
    'dashboard.html': ALL,
    'tickets.html': ALL,
    'ticket.html': ALL,
    'register.html': ALL,
    'reports.html': ALL,
    'flow.html': ALL,
    'roles.html': ALL,
    'notifications.html': ALL,
    'profile.html': ALL,
    'request.html': ['requester', 'coordinator'],
    'review.html': ['coordinator'],
    'technician.html': ['technician'],
    'maintenance.html': ['technician', 'coordinator', 'management'],
    'confirm.html': ['requester', 'coordinator'],
    /* System Administrator screens (key `management`, prefix `mgmt`) */
    'users.html': ['management'],
    'offices.html': ['management'],
    'settings.html': ['management'],
    'audit.html': ['management']
  };

  /* feature matrix (rows without `key` are group headers) */
  var CAPS = [
    { group: 'Service requests' },
    { key: 'Submit a service request (telephone · email · walk-in · on-site)', requester: 1, coordinator: 1 },
    { key: 'Reply to “Needs information” on a ticket', requester: 1, coordinator: 1 },
    { key: 'Request withdrawal · record the cancellation and reason', requester: 1, coordinator: 1 },
    { key: 'Raise a linked recurrence ticket', requester: 1, coordinator: 1 },
    { group: 'Coordinator control' },
    { key: 'Review a request · ask for missing details', coordinator: 1 },
    { key: 'Assess impact &amp; urgency → priority and target date', coordinator: 1 },
    { key: 'Assign and coordinate the technician', coordinator: 1 },
    { key: 'Cancel from a dependency decision', coordinator: 1 },
    { key: 'Close a ticket (after confirmation or authorised closure)', coordinator: 1 },
    { key: 'Create and schedule preventive maintenance plans', coordinator: 1 },
    { group: 'Technician service delivery' },
    { key: 'Start work · record diagnosis, parts, cost, labour, evidence', technician: 1 },
    { key: 'Place a dependency hold', technician: 1 },
    { key: 'Record dependency follow-ups · resolve the hold', coordinator: 1 },
    { key: 'Record tests (pass → Resolved · fail → back to diagnosis)', technician: 1 },
    { key: 'Execute maintenance checklist items', technician: 1 },
    { key: 'Record a maintenance outcome', technician: 1, coordinator: 1 },
    { key: 'Raise a corrective ticket from maintenance', technician: 1 },
    { key: 'Record repair actions (parts, costs, labour, evidence)', technician: 1 },
    { key: 'Coordinate the service schedule', technician: 1, coordinator: 1 },
    { group: 'Office confirmation' },
    { key: 'Confirm office availability · agree a new maintenance date', requester: 1, coordinator: 1 },
    { key: 'Accept or reject a service result', requester: 1, coordinator: 1 },
    { key: 'Confirm a maintenance visit result', requester: 1, coordinator: 1 },
    { group: 'Reporting &amp; oversight' },
    { key: 'View dashboards and the ticket register', requester: 1, technician: 1, coordinator: 1, management: 1 },
    { key: 'View office IT service reports', requester: 1, technician: 1, coordinator: 1, management: 1 },
    { key: 'View maintenance schedules', technician: 1, coordinator: 1, management: 1 },
    { key: 'View the SOP flowchart &amp; reference', requester: 1, technician: 1, coordinator: 1, management: 1 },
    { key: 'View the roles &amp; access reference', requester: 1, technician: 1, coordinator: 1, management: 1 },
    { group: 'System administration' },
    { key: 'Create and edit user accounts · assign roles', management: 1 },
    { key: 'Maintain the office directory', management: 1 },
    { key: 'Maintain reference data (categories, priorities, sources, frequencies)', management: 1 },
    { key: 'Review the audit log', management: 1, coordinator: 1 },
    { key: 'Edit the office IT service register', coordinator: 1, management: 1 }
  ];

  function roleKey() { return ROLES[S.db.role] ? S.db.role : 'coordinator'; }
  function currentRole() { return ROLES[roleKey()]; }
  function can(page, role) {
    role = role || roleKey();
    /* Links may carry a queue or a section anchor, so compare the page only. */
    var key = String(page || '').split('?')[0].split('#')[0].replace(/^(or|itc|ic|mgmt)-/, '');
    var allow = ACCESS[key];
    return !allow || allow.indexOf(role) > -1;
  }

  /* ------------------------------------------------------------
     bindUrlRole()  --  reconcile the URL prefix with the session role.
       * no prefix            -> nothing to do (bare page keeps working)
       * no session           -> render the URL's role as a signed-out
                                preview (so role pages import/share cold)
       * prefix == session    -> pin the role and carry on
       * prefix != session    -> redirect to the visitor's own page for the
                                same screen (never shows another role's lane)
     Returns true when a redirect was started (the caller should stop).
     ------------------------------------------------------------ */
  function bindUrlRole() {
    var u = parseUrlRole();
    if (!u) return false;

    var signedIn = !!(S.db.auth && S.db.auth.role);
    if (!signedIn) {
      /* no session: show this URL's role rather than bouncing to sign-in */
      if (S.db.role !== u.role) {
        S.update(function (db) { db.role = u.role; });
      }
      return false;
    }
    /* the URL asked for a role the visitor does not hold */
    if (u.role !== roleKey()) {
      var own = can(u.page, roleKey()) ? urlFor(u.page, roleKey()) : urlFor('dashboard.html', roleKey());
      location.replace(own);
      return true;
    }
    /* URL role == session role: make sure storage agrees, then continue */
    if (S.db.role !== u.role) {
      S.update(function (db) { db.role = u.role; });
    }
    return false;
  }

  function initials(name) {
    return String(name || '').split(/[\s.]+/).filter(Boolean)
      .map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
  }
  function auth() {
    if (S.db.auth) return S.db.auth;
    var r = currentRole();
    return { name: r.name, email: r.email, role: roleKey(), office: r.office, demo: true };
  }
  function signIn(role, account) {
    if (!ROLES[role]) return;
    var r = ROLES[role];
    S.update(function (db) {
      db.role = role;
      db.auth = {
        name: (account && account.name) || r.name,
        email: (account && account.email) || r.email,
        role: role, office: r.office,
        signedInAt: S.NOW()
      };
    });
  }
  function signOut() { S.update(function (db) { db.auth = null; }); }
  function capabilities(role) {
    role = role || roleKey();
    return CAPS.map(function (c) {
      return c.group ? { group: c.group } : { key: c.key, can: !!c[role] };
    });
  }
  function capsForRole(role) {
    role = role || roleKey();
    return CAPS.filter(function (c) { return !c.group && c[role]; })
      .map(function (c) { return c.key; });
  }

  /* ---------- toasts ---------- */
  var toastBox = null;

  /* The pop-up notices can be paused.  Only the spontaneous ones are held
     back -- the live engine's events and the new notifications it produces.
     The result of what a person just did is always shown, and the bell and
     the notification centre keep working either way.  The choice is
     remembered per browser, so it survives a reload and needs no admin. */
  var POPUPS_KEY = 'itc_popups';

  function popupsOn() {
    try { return localStorage.getItem(POPUPS_KEY) !== 'off'; } catch (e) { return true; }
  }
  function setPopups(on) {
    try { localStorage.setItem(POPUPS_KEY, on ? 'on' : 'off'); } catch (e) { /* private mode */ }
    document.body.classList.toggle('popups-off', !on);
    syncPopupSwitch();
  }
  function syncPopupSwitch() {
    var on = popupsOn();
    document.querySelectorAll('[data-popups]').forEach(function (b) {
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('on', on);
      var state = b.querySelector('.popups-state');
      if (state) state.textContent = on ? 'On' : 'Off';
      b.setAttribute('title', on ? 'Pop-up notices are on' : 'Pop-up notices are off');
    });
  }

  /* A notice that arrives while a full-screen panel is open would cover it,
     so it waits and is shown once the panel closes.  Nothing is lost. */
  var toastHeld = [];

  function toast(msg, kind) {
    /* The live engine's own notices are the ones that interrupt; the result
       of what the person just did is always shown. */
    if (kind === 'live' && !popupsOn()) return;
    if (document.body.classList.contains('sheet-open')) {
      toastHeld.push([msg, kind]);
      return;
    }
    showToast(msg, kind);
  }

  function showToast(msg, kind) {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'toast-box';
      document.body.appendChild(toastBox);
    }
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = msg;
    toastBox.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 400); }, 4600);
    /* On a phone the stack would cover the screen, so it holds fewer. */
    var max = window.matchMedia && window.matchMedia('(max-width: 599px)').matches ? 2 : 4;
    while (toastBox.children.length > max) toastBox.firstChild.remove();
  }

  /* The notices that waited for the panel to close.  The newest are the ones
     that matter, so the oldest wait for the next one. */
  function releaseHeldToasts() {
    if (!toastHeld.length) return;
    var held = toastHeld;
    toastHeld = [];
    var max = window.matchMedia && window.matchMedia('(max-width: 599px)').matches ? 2 : 4;
    held.slice(-max).forEach(function (t) { showToast(t[0], t[1]); });
  }

  /* ---------- modal (JS-driven, reuses .modal-* kit styles) ---------- */
  var modalHost = null;
  function openModal(title, bodyHTML, footerButtons) {
    closeModal();
    modalHost = document.createElement('div');
    modalHost.className = 'modal-host';
    modalHost.innerHTML =
      '<div class="modal-card" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h3>' + esc(title) + '</h3>' +
      '<span class="modal-close" role="button" aria-label="Close">&#10005;</span></div>' +
      '<div class="modal-body">' + bodyHTML + '</div>' +
      '<div class="modal-foot">' + (footerButtons || '<button class="btn btn-ghost" type="button" data-close>Close</button>') + '</div>' +
      '</div>';
    document.body.appendChild(modalHost);
    modalHost.addEventListener('click', function (e) {
      var t = e.target;
      if (t === modalHost || (t.classList && t.classList.contains('modal-close')) || (t.hasAttribute && t.hasAttribute('data-close'))) closeModal();
    });
    /* validation gate: run before the page's own #mGo handler (registered
       after this listener) so an invalid modal never reaches the flow engine */
    bindFormValidation(modalHost);
    var go = modalHost.querySelector('#mGo');
    if (go) {
      go.addEventListener('click', function (e) {
        if (!validateForm(modalHost)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var bad = modalHost.querySelector('.field-error');
          if (bad) bad.focus();
          return false;
        }
      });
    }
    var first = modalHost.querySelector('input,select,textarea');
    if (first) first.focus();
    return modalHost;
  }
  function closeModal() { if (modalHost) { modalHost.remove(); modalHost = null; } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  /* ---------- attachment viewer (the lightbox) ----------
     The evidence behind a record: a photo of the jammed printer, a short
     clip of the fault.  It opens over the page, so the person never loses
     the record they are reading. */
  var viewerHost = null, viewerReturn = null;

  /* What kind of file is this?  The stored mime is the record; the name is
     the fallback for a file that arrived without one. */
  function attachmentKind(mime, name) {
    var m = String(mime || '').toLowerCase();
    var n = String(name || '').toLowerCase();
    if (m.indexOf('image/') === 0) return 'image';
    if (m.indexOf('video/') === 0) return 'video';
    if (m === 'application/pdf' || n.slice(-4) === '.pdf') return 'pdf';
    if (m.indexOf('text/') === 0 || /\.(txt|csv)$/.test(n)) return 'text';
    return 'file';
  }

  function humanSize(bytes) {
    var b = Number(bytes) || 0;
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    return (Math.round(b / 1048576 * 10) / 10) + ' MB';
  }

  function openAttachment(meta, url) {
    meta = meta || {};
    closeAttachment();
    viewerReturn = document.activeElement;
    var kind = attachmentKind(meta.mime, meta.name);
    var name = meta.name || 'Attachment';
    var media;
    if (!url) {
      media = '<div class="viewer-missing">' + icon('info') +
        '<b>The file is not kept in this browser</b>' +
        '<span class="muted">Only the name and the details are on record. ' +
        'Open the record on a signed-in session to see the file itself.</span></div>';
    } else if (kind === 'image') {
      media = '<img class="viewer-media" src="' + attr(url) + '" alt="' + esc(name) + '">';
    } else if (kind === 'video') {
      media = '<video class="viewer-media" src="' + attr(url) + '" controls playsinline preload="metadata"></video>';
    } else if (kind === 'pdf') {
      media = '<iframe class="viewer-media" src="' + attr(url) + '#toolbar=1" title="' + esc(name) + '"></iframe>';
    } else if (kind === 'text') {
      media = '<div class="viewer-missing">' + icon('fileText') +
        '<b>A text file</b><span class="muted">Open it in a new tab to read the contents.</span></div>';
    } else {
      media = '<div class="viewer-missing">' + icon('file') +
        '<b>A ' + esc(String(meta.mime || 'file').split('/').pop()) + ' file</b>' +
        '<span class="muted">There is no inline preview for this type.</span></div>';
    }
    var facts = [];
    if (meta.size) facts.push(humanSize(meta.size));
    if (meta.by) facts.push(meta.by);
    if (meta.at) facts.push(clock(meta.at));
    viewerHost = document.createElement('div');
    viewerHost.className = 'viewer-host';
    viewerHost.innerHTML =
      '<div class="viewer-card" role="dialog" aria-modal="true" aria-label="Attachment">' +
      '<div class="viewer-head">' +
      '<span class="viewer-ic">' + icon(kind === 'video' ? 'film' : kind === 'image' ? 'image' : 'paperclip') + '</span>' +
      '<div class="viewer-title"><b>' + esc(name) + '</b>' +
      '<span class="muted">' + esc(facts.join('  ·  ')) + '</span></div>' +
      '<button type="button" class="ico-btn viewer-close" aria-label="Close">&#10005;</button>' +
      '</div>' +
      '<div class="viewer-body">' + media + '</div>' +
      '<div class="viewer-foot">' +
      (url ? '<a class="btn btn-soft" href="' + attr(url) + '" download target="_blank" rel="noopener">' +
        icon('download') + ' Download</a>' : '') +
      '<button type="button" class="btn btn-ghost" data-close>Close</button>' +
      '</div></div>';
    document.body.appendChild(viewerHost);
    viewerHost.addEventListener('click', function (e) {
      var t = e.target;
      if (t === viewerHost || (t.classList && t.classList.contains('viewer-close')) ||
          (t.hasAttribute && t.hasAttribute('data-close'))) closeAttachment();
    });
    var close = viewerHost.querySelector('.viewer-close');
    if (close) close.focus();
    return viewerHost;
  }
  function closeAttachment() {
    if (!viewerHost) return;
    viewerHost.remove();
    viewerHost = null;
    if (viewerReturn && viewerReturn.focus) { try { viewerReturn.focus(); } catch (e) { } }
    viewerReturn = null;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAttachment(); });

  /* A labelled form field.  The label is bound to the control with for/id so
     assistive technology announces the field name.  The control id is taken
     from `fieldName` when given, otherwise it is read from the inner markup
     (the field builders all emit id="f<name>"). */
  function field(label, inner, fieldName) {
    var fieldId = fieldName ? 'f' + fieldName : '';
    if (!fieldId) {
      var m = /id="([^"]+)"/.exec(inner || '');
      fieldId = m ? m[1] : '';
    }
    var forAttr = fieldId ? ' for="' + esc(fieldId) + '"' : '';
    return '<div class="field"><label' + forAttr + '>' + esc(label) + '</label>' + (inner || '') + '</div>';
  }
  /* field builders (input/dateInput/numberInput/select/textarea) are declared
     below with required/minlength support  --  see "form helpers". */
  function modalValue(name) {
    if (!modalHost) return '';
    var el = modalHost.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }

  /* ============================================================
     VALIDATION UTILITIES  --  client-side form validation
     ============================================================ */
  var VALIDATORS = {
    required: function (val) { return val !== undefined && val !== null && String(val).trim() !== ''; },
    email: function (val) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val).trim()); },
    minLength: function (val, min) { return String(val).trim().length >= min; },
    maxLength: function (val, max) { return String(val).trim().length <= max; },
    pattern: function (val, regex) { return regex.test(String(val).trim()); },
    min: function (val, min) { return parseFloat(val) >= min; },
    max: function (val, max) { return parseFloat(val) <= max; },
    number: function (val) { return !isNaN(parseFloat(val)) && isFinite(val); },
    positiveNumber: function (val) { return parseFloat(val) > 0; },
    assetTag: function (val) { return /^[A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}$/i.test(String(val).trim()); },
    dateNotPast: function (val) { var d = new Date(val); var today = new Date(); today.setHours(0,0,0,0); return d >= today; },
    dateNotFuture: function (val) { var d = new Date(val); var today = new Date(); today.setHours(23,59,59,999); return d <= today; }
  };

  var ERROR_MESSAGES = {
    required: 'This field is required',
    email: 'Please enter a valid email address',
    minLength: function (min) { return 'Must be at least ' + min + ' characters'; },
    maxLength: function (max) { return 'Must be no more than ' + max + ' characters'; },
    pattern: 'Invalid format',
    min: function (min) { return 'Must be at least ' + min; },
    max: function (max) { return 'Must be no more than ' + max; },
    number: 'Must be a valid number',
    positiveNumber: 'Must be a positive number',
    assetTag: 'Asset tag format: XX-XX-XXXX (e.g. PC-OF-118)',
    dateNotPast: 'Date cannot be in the past',
    dateNotFuture: 'Date cannot be in the future'
  };

  function getFieldValue(el) {
    // Handle selects specially - check selectedIndex for default selected options
    if (el.tagName === 'SELECT') {
      return el.options[el.selectedIndex]?.value || el.value;
    }
    return el.value;
  }

  function validateField(el) {
    var val = getFieldValue(el);
    var type = el.type;
    var name = el.name;

    // Check required
    if (el.hasAttribute('required') && !VALIDATORS.required(val)) {
      return 'required';
    }
    // If empty and not required, skip other validations
    if (!VALIDATORS.required(val)) {
      return null;
    }

    // Type-specific validations
    if (type === 'email' && !VALIDATORS.email(val)) return 'email';
    if (type === 'number' && !VALIDATORS.number(val)) return 'number';
    if (type === 'date' && el.hasAttribute('min') && !VALIDATORS.dateNotPast(val)) return 'dateNotPast';
    if (type === 'date' && el.hasAttribute('max') && !VALIDATORS.dateNotFuture(val)) return 'dateNotFuture';

    // Attribute-based validations
    var minLen = el.getAttribute('minlength');
    if (minLen && !VALIDATORS.minLength(val, parseInt(minLen, 10))) return 'minLength:' + minLen;
    var maxLen = el.getAttribute('maxlength');
    if (maxLen && !VALIDATORS.maxLength(val, parseInt(maxLen, 10))) return 'maxLength:' + maxLen;
    var pattern = el.getAttribute('pattern');
    if (pattern && !VALIDATORS.pattern(val, new RegExp(pattern))) return 'pattern';
    var min = el.getAttribute('min');
    if (min !== null && !VALIDATORS.min(val, parseFloat(min))) return 'min:' + min;
    var max = el.getAttribute('max');
    if (max !== null && !VALIDATORS.max(val, parseFloat(max))) return 'max:' + max;

    // Custom validators by name
    if (name === 'asset' && val && !VALIDATORS.assetTag(val)) return 'assetTag';
    if (name === 'cost' && val && !VALIDATORS.positiveNumber(val)) return 'positiveNumber';
    if (name === 'labor' && val && !VALIDATORS.min(val, 0)) return 'min:0';

    return null;
  }

  function showFieldError(el, errorKey) {
    var msg = typeof ERROR_MESSAGES[errorKey] === 'function'
      ? ERROR_MESSAGES[errorKey](errorKey.split(':')[1])
      : ERROR_MESSAGES[errorKey] || 'Invalid value';
    clearFieldError(el);
    el.classList.add('field-error');
    el.setAttribute('aria-invalid', 'true');
    var msgEl = document.createElement('div');
    msgEl.className = 'field-error-msg';
    msgEl.textContent = msg;
    el.parentNode.appendChild(msgEl);
  }

  function clearFieldError(el) {
    el.classList.remove('field-error');
    el.removeAttribute('aria-invalid');
    var msgEl = el.parentNode.querySelector('.field-error-msg');
    if (msgEl) msgEl.remove();
  }

  function validateForm(form) {
    var inputs = form.querySelectorAll('input, select, textarea');
    var hasErrors = false;
    inputs.forEach(function (el) {
      var error = validateField(el);
      if (error) {
        showFieldError(el, error);
        hasErrors = true;
      } else {
        clearFieldError(el);
      }
    });
    return !hasErrors;
  }

  function bindFormValidation(form) {
    if (!form || form._validationBound) return;
    form._validationBound = true;

    // Real-time validation on blur
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.addEventListener('blur', function () { validateField(el) ? showFieldError(el, validateField(el)) : clearFieldError(el); });
      el.addEventListener('input', function () { if (el.classList.contains('field-error')) { var err = validateField(el); err ? showFieldError(el, err) : clearFieldError(el); } });
    });

    // Submit interception
    form.addEventListener('submit', function (e) {
      if (!validateForm(form)) {
        e.preventDefault();
        var firstError = form.querySelector('.field-error');
        if (firstError) firstError.focus();
      }
    });
  }

  /* ---------- form helpers with required attribute support ---------- */
  function input(name, ph, val, opts) {
    opts = opts || {};
    var required = opts.required ? ' required' : '';
    var min = opts.min ? ' min="' + attr(opts.min) + '"' : '';
    var max = opts.max ? ' max="' + attr(opts.max) + '"' : '';
    var minLen = opts.minlength ? ' minlength="' + attr(opts.minlength) + '"' : '';
    var maxLen = opts.maxlength ? ' maxlength="' + attr(opts.maxlength) + '"' : '';
    var pattern = opts.pattern ? ' pattern="' + attr(opts.pattern) + '"' : '';
    var type = opts.type || 'text';
    var id = 'f' + name;
    return '<input type="' + type + '" id="' + id + '" name="' + name + '" placeholder="' + attr(ph) + '" value="' + attr(val || '') + '"' + required + min + max + minLen + maxLen + pattern + '>';
  }

  function dateInput(name, val, opts) {
    opts = opts || {};
    var required = opts.required ? ' required' : '';
    var min = opts.min ? ' min="' + attr(opts.min) + '"' : '';
    var max = opts.max ? ' max="' + attr(opts.max) + '"' : '';
    var id = 'f' + name;
    return '<input type="date" id="' + id + '" name="' + name + '" value="' + attr(val || '') + '"' + required + min + max + '>';
  }

  function numberInput(name, val, opts) {
    opts = opts || {};
    var required = opts.required ? ' required' : '';
    var min = opts.min ? ' min="' + attr(opts.min) + '"' : '';
    var max = opts.max ? ' max="' + attr(opts.max) + '"' : '';
    var step = opts.step ? ' step="' + attr(opts.step) + '"' : ' step="0.5"';
    var id = 'f' + name;
    return '<input type="number" id="' + id + '" name="' + name + '" value="' + attr(val == null ? '' : val) + '"' + required + min + max + step + '>';
  }

  function select(name, opts, val, required) {
    var id = 'f' + name;
    var h = '<select id="' + id + '" name="' + name + '"' + (required ? ' required' : '') + '>';
    var hasEmpty = !required;
    if (hasEmpty) h += '<option value=""> --  Select  -- </option>';
    (opts || []).forEach(function (o) {
      var v = typeof o === 'string' ? o : o[0], l = typeof o === 'string' ? o : o[1];
      h += '<option value="' + attr(v) + '"' + (String(val) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    });
    return h + '</select>';
  }

  function textarea(name, ph, val, rows, required) {
    var req = required ? ' required' : '';
    var minLen = (required && arguments[5]) ? ' minlength="' + attr(arguments[5]) + '"' : '';
    var id = 'f' + name;
    return '<textarea id="' + id + '" name="' + name + '" rows="' + (rows || 3) + '" placeholder="' + attr(ph) + '"' + req + minLen + '>' + esc(val || '') + '</textarea>';
  }

  /* ---------- icons ----------
     One outline icon set, 24x24, 2px stroke, drawn to sit together on a page.
     No emoji anywhere in the interface: every pictogram is one of these. */
  var ICONS = {
    /* navigation */
    grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    ticket: '<path d="M4 7h16v4a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7z"/><path d="M13 7v11"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    plusLine: '<path d="M12 5v14M5 12h14"/>',
    case: '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1-2-2h2"/><path d="M9 14l2 2 4-4"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    flow: '<rect x="2" y="3" width="7" height="5" rx="1.5"/><rect x="15" y="16" width="7" height="5" rx="1.5"/><path d="M5.5 8v6a4 4 0 0 0 4 4H15"/><path d="M18.5 16v-6a4 4 0 0 0-4-4H9"/>',
    bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    shield: '<path d="M12 3l7 3v5c0 4.4-3 8.2-7 10-4-1.8-7-5.6-7-10V6z"/><path d="M9.3 12l1.9 1.9 3.6-3.7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    brand: '<rect x="3" y="4" width="18" height="13" rx="2.5"/><path d="M9 21h6M12 17v4"/><path d="m8.5 10.5 2.5 2.5 4.5-5"/>',

    /* work + service */
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
    pen: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"/>',
    toolbox: '<path d="M2 8h20v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M2 13h20"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>',
    pause: '<path d="M10 4H6v16h4V4z"/><path d="M18 4h-4v16h4V4z"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6.5L4.6 18A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-3L14 9.5V3"/><path d="M7.5 15h9"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M9 13l2 2 4-4"/>',
    clipboardList: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/><path d="M9 11h6M9 15h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22"/><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/>',
    filter: '<path d="M3 5h18"/><path d="M7 12h10"/><path d="M10 19h4"/>',
    sliders: '<path d="M4 6h10M18 6h2"/><circle cx="16" cy="6" r="2"/><path d="M4 12h4M12 12h8"/><circle cx="10" cy="12" r="2"/><path d="M4 18h12M20 18h0"/><circle cx="18" cy="18" r="2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    paperclip: '<path d="M21.4 11 12.2 20.2a6 6 0 0 1-8.5-8.5l8.6-8.6A4 4 0 1 1 18 8.8l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    paperclipAlt: '<path d="M21.4 11 12.2 20.2a6 6 0 0 1-8.5-8.5l8.6-8.6A4 4 0 1 1 18 8.8l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2"/><path d="m17 6 2 2"/><path d="m14.5 8.5 2 2"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    eyeOff: '<path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-2.2 2.9"/><path d="M6.6 6.7A16.6 16.6 0 0 0 2 12s3.6 6 10 6a9.7 9.7 0 0 0 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    alert: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7"/><path d="M12 17.5h.01"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 7 8.1 5.2a1.7 1.7 0 0 0 1.8 0L21 7"/>',
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16"/><path d="M15 9h3a2 2 0 0 1 2 2v10"/><path d="M2 21h20"/><path d="M8 7h3M8 11h3M8 15h3"/>',
    mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/>',
    monitor: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9"/><path d="M2 16h20"/><path d="m5 16 1.3 2.5a1 1 0 0 0 .9.5h9.6a1 1 0 0 0 .9-.5L19 16"/>',
    phone: '<path d="M21 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 4.2 2 2 0 0 1 3.1 2h3a2 2 0 0 1 2 1.7 12.8 12.8 0 0 0 .7 2.8 2 2 0 0 1-.5 2.1L7.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5 12.8 12.8 0 0 0 2.8.7 2 2 0 0 1 1.7 2.1Z"/>',
    smartphone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/>',
    printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3h12v6"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
    package: '<path d="m7.5 4.3 9 5.1"/><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    bookOpen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16.2 7.8-1.8 5.4a2 2 0 0 1-1.3 1.3l-5.4 1.8 1.8-5.4a2 2 0 0 1 1.3-1.3Z"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
    scale: '<path d="m16 16 3-8 3 8a3 3 0 0 1-6 0Z"/><path d="m2 16 3-8 3 8a3 3 0 0 1-6 0Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    ruler: '<path d="m15 5 4 4"/><path d="M13 7 3 17a2.1 2.1 0 0 0 3 3l10-10"/><path d="m9 11 2 2"/><path d="m11 9 2 2"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 13h6M9 17h6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m4 17 4.5-4.5 3.5 3.5L15 12l5 5"/>',
    film: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M2.5 12h19M2.5 8h4.5M2.5 16h4.5M17 8h4.5M17 16h4.5"/>',
    folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-1-1.3a2 2 0 0 0-1.7-.8H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    id: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="11" r="2.2"/><path d="M14.5 10h4M14.5 14h4M6 16h4"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22v-7"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
    star: '<path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9Z"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    archive: '<rect x="2.5" y="4" width="19" height="4.5" rx="1.5"/><path d="M4.5 8.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5"/><path d="M10 12.5h4"/>',
    server: '<rect x="2.5" y="3" width="19" height="7" rx="2"/><rect x="2.5" y="14" width="19" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/>',
    wifiOff: '<path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 13a10 10 0 0 1 3.5-2.3"/><path d="M2 9a15 15 0 0 1 5-3.2"/><path d="M12.5 6.5A15 15 0 0 1 22 9"/><path d="M10.5 20.5a2 2 0 0 1 3 0"/><path d="M12 20h.01"/>',
    prioLow: '<path d="M5 19v-3"/><path d="M12 19v-3"/><path d="M19 19v-3"/>',
    prioMed: '<path d="M5 19v-3"/><path d="M12 19v-6"/><path d="M19 19v-3"/>',
    prioHigh: '<path d="M5 19v-3"/><path d="M12 19v-6"/><path d="M19 19v-9"/>'
  };
  function icon(name, cls) {
    var body = ICONS[name];
    if (!body) return '';
    return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  /* Icon per ticket status and priority, so a badge never relies on colour. */
  var STATUS_ICON = {
    submitted: 'inbox', needs_info: 'help', assigned: 'user', in_progress: 'activity',
    on_hold: 'pause', resolved: 'checkCircle', closed: 'archive', cancelled: 'ban'
  };
  var PRIO_ICON = { low: 'prioLow', medium: 'prioMed', high: 'prioHigh', critical: 'alert' };

  /* ---------- screen metadata (breadcrumbs, titles, contextual menus) ----
     Every page a role may open has one section and one label here, so the
     rail, the contextual menu, the breadcrumb, the browser title and the
     Workflow Guide use the same names (specification 4A.4). */
  var PAGE_META = {
    'dashboard.html': { section: 'Dashboard', label: 'Dashboard' },
    'tickets.html': { section: 'Tickets', label: 'Tickets' },
    'ticket.html': { section: 'Tickets', label: 'Ticket detail' },
    'request.html': { section: 'Service requests', label: 'New request' },
    'review.html': { section: 'Service requests', label: 'Review and assign' },
    'technician.html': { section: 'Service delivery', label: 'My work' },
    'maintenance.html': { section: 'Maintenance', label: 'Maintenance' },
    'register.html': { section: 'Records', label: 'Office register' },
    'reports.html': { section: 'Records', label: 'Reports' },
    'confirm.html': { section: 'Office confirmation', label: 'Confirmation' },
    'notifications.html': { section: 'Account', label: 'Notifications' },
    'profile.html': { section: 'Account', label: 'Profile' },
    'audit.html': { section: 'Administration', label: 'Audit log' },
    'users.html': { section: 'Administration', label: 'Users' },
    'offices.html': { section: 'Administration', label: 'Offices' },
    'settings.html': { section: 'Administration', label: 'Settings' },
    'flow.html': { section: 'Reference', label: 'Workflow guide' },
    'roles.html': { section: 'Reference', label: 'Roles and access' }
  };

  /* ---------- the sidebar: one labeled, grouped list --------------------
     Firebase-style navigation: every screen a role may open appears exactly
     once, grouped by what the person is trying to do.  Entries are still
     filtered through the permission map, which the backend enforces. */
  function navModel(role) {
    var groups = [];
    function add(label, items) {
      var keep = (items || []).filter(function (n) { return can(n.href, role); });
      if (keep.length) groups.push({ label: label, items: keep });
    }
    add('Workspace', [
      { href: 'dashboard.html', label: 'Dashboard', ic: 'grid' }
    ]);
    if (role === 'requester') {
      add('Requests', [
        { href: 'tickets.html?queue=mine', label: 'My Requests', ic: 'ticket', pill: 'pillTickets' },
        { href: 'request.html', label: 'New Request', ic: 'plus' },
        { href: 'confirm.html', label: 'Confirmation', ic: 'checkCircle' }
      ]);
      add('Records', [
        { href: 'register.html', label: 'Office Register', ic: 'case' },
        { href: 'reports.html', label: 'Reports', ic: 'chart' }
      ]);
    } else if (role === 'technician') {
      add('Service', [
        { href: 'technician.html', label: 'My Tickets', ic: 'ticket', pill: 'pillTickets' },
        { href: 'maintenance.html', label: 'My Maintenance Jobs', ic: 'cal', pill: 'pillMaint' }
      ]);
      add('Records', [
        { href: 'register.html', label: 'Office Register', ic: 'case' },
        { href: 'reports.html', label: 'Reports', ic: 'chart' }
      ]);
    } else if (role === 'management') {
      add('Service', [
        { href: 'tickets.html', label: 'Service Records', ic: 'ticket', pill: 'pillTickets' },
        { href: 'maintenance.html', label: 'Maintenance', ic: 'cal', pill: 'pillMaint' }
      ]);
      add('Records', [
        { href: 'register.html', label: 'Office Register', ic: 'case' },
        { href: 'reports.html', label: 'Reports', ic: 'chart' }
      ]);
      add('Administration', [
        { href: 'users.html', label: 'Users', ic: 'users' },
        { href: 'offices.html', label: 'Offices', ic: 'building' },
        { href: 'settings.html', label: 'Configuration', ic: 'sliders' },
        { href: 'audit.html', label: 'Audit Log', ic: 'shield' }
      ]);
    } else {
      add('Service Requests', [
        { href: 'tickets.html', label: 'Tickets', ic: 'ticket', pill: 'pillTickets' },
        { href: 'request.html', label: 'New Request', ic: 'plus' },
        { href: 'review.html', label: 'Review and Assign', ic: 'shield' },
        { href: 'confirm.html', label: 'Confirmation', ic: 'checkCircle' }
      ]);
      add('Maintenance', [
        { href: 'maintenance.html', label: 'Maintenance', ic: 'cal', pill: 'pillMaint' }
      ]);
      add('Records', [
        { href: 'register.html', label: 'Office Register', ic: 'case' },
        { href: 'reports.html', label: 'Reports', ic: 'chart' }
      ]);
    }
    return groups;
  }

  function accountItems(role) {
    return [
      { href: 'notifications.html', label: 'Notifications', ic: 'bell', pill: 'pillNotif' },
      { href: 'profile.html', label: 'Profile and Account', ic: 'user' }
    ].filter(function (n) { return can(n.href, role); });
  }

  function bellHTML(id) {
    return '<div class="notif-wrap bellWrap">' +
      '<input type="checkbox" id="' + id + '" class="notif-toggle">' +
      '<label class="tray-backdrop" for="' + id + '" aria-hidden="true"></label>' +
      '<label class="bell" for="' + id + '" title="Notifications">' + icon('bell') +
      '<span class="count bellCount">0</span></label>' +
      '<div class="notif">' +
      '<div class="notif-head"><span>Notifications</span><span class="markAll">Mark all read</span></div>' +
      '<ul class="notifList"></ul>' +
      '<div class="notif-foot">' +
      '<a href="' + urlFor('notifications.html', roleKey()) + '">Open notification centre</a>' +
      '<button type="button" class="popups-toggle" data-popups aria-pressed="true">' +
      '<span>Pop-ups</span><span class="popups-state">On</span></button>' +
      '</div>' +
      '</div></div>';
  }

  function accountHTML(id) {
    var a = auth(), r = ROLES[a.role] || currentRole(), demo = !!a.demo;
    return '<div class="notif-wrap acctWrap">' +
      '<input type="checkbox" id="' + id + '" class="notif-toggle">' +
      '<label class="tray-backdrop" for="' + id + '" aria-hidden="true"></label>' +
      '<label class="avatar" for="' + id + '" title="Account and role">' + esc(initials(a.name)) + '</label>' +
      '<div class="acct" role="dialog" aria-label="Account">' +
      '<div class="acct-head"><span class="acct-seals">' +
      '<img src="img/up-seal.png" alt="University of the Philippines seal" width="30" height="30" loading="lazy">' +
      '<img src="img/upc-seal.png" alt="University of the Philippines Cebu seal" width="30" height="30" loading="lazy">' +
      '</span><div><b class="acctName">' + esc(a.name) + '</b>' +
      '<i class="acctEmail">' + esc(a.email) + '</i></div></div>' +
      '<div class="acct-role"><span class="chip">' + esc(r.title) + '</span>' +
      '<span class="chip">' + esc(a.office || r.office) + '</span></div>' +
      (demo ? '<div class="acct-note">Demo session  --  you are not signed in.</div>' : '') +
      themePickerHTML() +
      '<a class="btn btn-ghost btn-block" href="' + urlFor('profile.html', roleKey()) + '">Profile and account settings</a>' +
      (demo
        ? '<a class="btn btn-primary btn-block" href="login.html">Sign in with UPMail</a>'
        : '<a class="btn btn-ghost btn-block" href="login.html">Switch UPMail account</a>') +
      '</div></div>';
  }

  /* Light / Dark / System.  The saved choice is applied before the first
     paint, so there is never a flash of the wrong theme. */
  function themePickerHTML() {
    var cur = themeChoice();
    var opts = [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'monitor']];
    return '<div class="theme-picker" role="group" aria-label="Colour theme">' +
      '<span class="theme-picker-label">Theme</span>' +
      '<div class="seg theme-seg">' + opts.map(function (o) {
        return '<button type="button" data-theme-set="' + o[0] + '"' +
          (cur === o[0] ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
          icon(o[2]) + '<span>' + o[1] + '</span></button>';
      }).join('') + '</div></div>';
  }

  function bindThemePicker(root) {
    (root || document).querySelectorAll('[data-theme-set]').forEach(function (b) {
      if (b.dataset.bound) return; b.dataset.bound = '1';
      b.addEventListener('click', function () {
        applyTheme(b.dataset.themeSet);
        document.querySelectorAll('[data-theme-set]').forEach(function (o) {
          var on = o.dataset.themeSet === themeChoice();
          o.classList.toggle('on', on);
          o.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });
  }

  /* ---------- chrome rendering ---------- */
  var lastOpts = null;

  function pageId() {
    var u = parseUrlRole();
    if (u) return u.page;  /* or-dashboard.html -> dashboard.html for ACCESS */
    var p = location.pathname.split('/').pop() || 'index.html';
    return p || 'index.html';
  }

  function hrefPage(href) {
    return String(href || '').split('?')[0].split('#')[0].replace(/^(or|itc|ic|mgmt)-/, '');
  }
  /* A link is active on its own page.  Queue links share tickets.html, so the
     contextual menu compares the query too; the rail only needs the page. */
  function isActiveHref(href, page, strictQuery) {
    var p = hrefPage(href);
    if (!(p === page || (page === 'ticket.html' && p === 'tickets.html'))) return false;
    if (!strictQuery) return true;
    var qi = String(href).indexOf('?');
    if (qi < 0) return String(href).indexOf('#') < 0;
    var want = String(href).slice(qi + 1).split('#')[0];
    var have = location.search.replace(/^\?/, '');
    if (!have) return want === 'queue=open';
    return have === want || have.indexOf(want + '&') === 0;
  }

  function sealLockup(cls) {
    return '<div class="' + (cls || 'tb-lockup') + '">' +
      '<img src="img/up-seal.png" alt="University of the Philippines seal" width="28" height="28" loading="lazy">' +
      '<img src="img/upc-seal.png" alt="University of the Philippines Cebu seal" width="28" height="28" loading="lazy">' +
      '<div class="tb-names"><strong>University of the Philippines Cebu</strong>' +
      '<small>IT Service and Maintenance Management System</small></div></div>';
  }

  function renderSide() {
    var side = document.getElementById('chromeSide');
    if (!side) return;
    var role = roleKey(), page = pageId(), a = auth();

    function link(n) {
      var active = isActiveHref(n.href, page, true);
      return '<a class="side-link' + (active ? ' active' : '') + '" href="' + urlFor(n.href, role) + '"' +
        (active ? ' aria-current="page"' : '') + '>' + icon(n.ic) +
        '<span class="side-label">' + esc(n.label) + '</span>' +
        (n.pill ? '<span class="pill" id="' + n.pill + '">0</span>' : '') + '</a>';
    }

    var groups = navModel(role).map(function (g) {
      return '<div class="side-group-wrap">' +
        '<span class="side-group">' + esc(g.label) + '</span>' +
        g.items.map(link).join('') + '</div>';
    }).join('');

    side.innerHTML =
      '<div class="side-head">' +
      '<a class="side-brand" href="' + urlFor('dashboard.html', role) + '">' +
      '<img src="img/up-seal.png" alt="University of the Philippines seal" width="24" height="24" loading="lazy">' +
      '<img src="img/upc-seal.png" alt="University of the Philippines Cebu seal" width="24" height="24" loading="lazy">' +
      '<span class="side-brand-text"><strong>UP Cebu</strong>' +
      '<small>IT Service and Maintenance</small></span></a>' +
      '<button type="button" class="side-close" id="sideClose" aria-label="Close navigation">' + icon('x') + '</button>' +
      '</div>' +
      '<button type="button" class="side-user" id="sideAccount" aria-label="Account and role">' +
      '<span class="side-avatar">' + esc(initials(a.name)) + '</span>' +
      '<span class="side-user-text"><b>' + esc(a.name) + '</b>' +
      '<i>' + esc(currentRole().title) + '</i></span>' + icon('sliders') + '</button>' +
      '<nav class="side-nav" aria-label="Primary">' + groups + '</nav>' +
      '<div class="side-foot"><span class="side-group">Your account</span>' +
      accountItems(role).map(link).join('') + '</div>';

    var close = document.getElementById('sideClose');
    if (close) close.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
    var acct = document.getElementById('sideAccount');
    if (acct) acct.addEventListener('click', openAccount);
  }

  function openAccount() {
    var id = window.matchMedia && window.matchMedia('(max-width:1023px)').matches ? 'acctM' : 'acctD';
    var cb = document.getElementById(id);
    if (!cb) cb = document.getElementById('acctD') || document.getElementById('acctM');
    if (cb) { cb.checked = true; renderBell(); }
  }

  function renderAppbar() {
    var appbar = document.getElementById('chromeAppbar');
    if (!appbar) return;
    var a = auth();
    appbar.innerHTML =
      '<button type="button" class="ico-btn" id="navToggle" aria-label="Open navigation" aria-expanded="false">' + icon('menu') + '</button>' +
      sealLockup('tb-lockup') +
      '<span class="spacer"></span>' +
      '<button type="button" class="ico-btn" id="tbSearchMobile" aria-label="Search the workspace" aria-haspopup="dialog" aria-expanded="false">' + icon('search') + '</button>' +
      bellHTML('notifM') +
      accountHTML('acctM');
    var toggle = document.getElementById('navToggle');
    if (toggle) toggle.addEventListener('click', function () {
      var open = !document.body.classList.contains('nav-open');
      document.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    bindThemePicker(appbar);
    renderAccountTriggers(appbar);
    var search = document.getElementById('tbSearchMobile');
    if (search) search.addEventListener('click', function () { openPalette(); });
  }

  function renderAccountTriggers(root) {
    (root || document).querySelectorAll('.acctWrap .avatar').forEach(function (el) {
      el.setAttribute('aria-label', 'Account and role');
    });
  }

  /* Workspace / Section / Page, without repeating a name when the section and
     the page are the same (the dashboard and the register pages). */
  function crumbInner(withLinks) {
    var page = pageId(), meta = PAGE_META[page] || { section: 'Workspace', label: '' };
    var section = meta.section || 'Workspace', label = meta.label || '';
    var sep = withLinks
      ? '<span class="sep" aria-hidden="true">/</span>'
      : '<span class="sep">/</span>';
    var out = '<a href="' + urlFor('dashboard.html', roleKey()) + '">Workspace</a>';
    if (section && section !== 'Workspace' && section !== label) out += sep + esc(section);
    if (label) out += sep + '<strong>' + esc(label) + '</strong>';
    return out;
  }

  /* ---------- command palette (Ctrl or Cmd plus K) ----------
     One search over the records the signed-in role may open: tickets,
     offices, assets and maintenance schedules, plus the recent items the
     person opened from here.  Scope follows the same tenancy the screens
     use, so the palette never reveals another office, another technician's
     work, or a maintenance screen the role cannot open. */
  var CM_KEY = 'itc_cmdk_recent_v1';
  var cmActive = 0;

  function cmRawRecent() {
    try {
      var rows = JSON.parse(localStorage.getItem(CM_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (e) { return []; }
  }
  function cmRecent() {
    var role = roleKey();
    return cmRawRecent().filter(function (r) {
      return r && r.href && r.role === role;
    }).slice(0, 5);
  }
  function cmRemember(item) {
    try {
      var role = roleKey();
      var rows = cmRawRecent().filter(function (r) { return !(r.href === item.href && r.role === role); });
      rows.unshift({ href: item.href, label: item.label, meta: item.meta, kind: item.kind, role: role });
      localStorage.setItem(CM_KEY, JSON.stringify(rows.slice(0, 20)));
    } catch (e) { /* private mode */ }
  }
  function cmScoped() {
    var db = S.db || {}, role = roleKey(), a = auth();
    function mine(rec) {
      if (role === 'requester') return rec.office === a.office;
      if (role === 'technician') return rec.technician === a.name;
      return true;
    }
    return {
      role: role, me: a,
      tickets: (db.tickets || []).filter(mine),
      jobs: (db.jobs || []).filter(mine),
      schedules: (db.schedules || []).filter(mine)
    };
  }
  function cmCommandResults(query) {
    var q = String(query || '').trim().toLowerCase();
    var sc = cmScoped(), offices = {};
    function hash(v) { return String(v == null ? '' : v).toLowerCase(); }
    function hit(vals) { return !q || vals.some(function (v) { return hash(v).indexOf(q) > -1; }); }
    function when(rec) { return new Date(rec.updatedAt || rec.createdAt || 0).getTime() || 0; }

    sc.tickets.forEach(function (t) { if (t.office) offices[t.office] = 1; });
    sc.jobs.forEach(function (j) { if (j.office) offices[j.office] = 1; });
    sc.schedules.forEach(function (s) { if (s.office) offices[s.office] = 1; });
    if (sc.role === 'requester' && sc.me.office) offices[sc.me.office] = 1;
    if (sc.role === 'coordinator' || sc.role === 'management') {
      (S.db.offices || []).forEach(function (o) { if (o.name) offices[o.name] = 1; });
    }

    var ticketHits = sc.tickets.filter(function (t) {
      return hit([t.id, t.issue, t.office, t.asset, t.category, t.requester, t.technician]);
    }).sort(function (a, b) { return when(b) - when(a); }).slice(0, q ? 6 : 5).map(function (t) {
      return {
        kind: 'Ticket', label: t.id + ' · ' + String(t.issue || ''),
        meta: t.office + ' · ' + (STATUS[t.status] ? STATUS[t.status][0] : t.status),
        href: 'ticket.html?id=' + encodeURIComponent(t.id)
      };
    });

    var officeHits = Object.keys(offices).sort().filter(function (name) {
      return hit([name]);
    }).slice(0, q ? 4 : 3).map(function (name) {
      return {
        kind: 'Office', label: name, meta: 'Office register and service history',
        href: (sc.role === 'management' ? 'offices.html?q=' : 'register.html?office=') + encodeURIComponent(name)
      };
    });

    var assetSet = {};
    sc.tickets.forEach(function (t) { if (t.asset) assetSet[t.asset] = 1; });
    sc.jobs.forEach(function (j) { (j.assets || []).forEach(function (a) { if (a) assetSet[a] = 1; }); });
    sc.schedules.forEach(function (s) { (s.assets || []).forEach(function (a) { if (a) assetSet[a] = 1; }); });
    var assetHits = q ? Object.keys(assetSet).sort().filter(function (a) {
      return hit([a]);
    }).slice(0, 4).map(function (a) {
      return { kind: 'Asset', label: a, meta: 'Office IT service register', href: 'register.html?q=' + encodeURIComponent(a) };
    }) : [];

    var scheduleHits = [];
    if (can('maintenance.html') && q) {
      scheduleHits = sc.schedules.filter(function (s) {
        return hit([s.id, s.office, s.category, s.technician, (s.assets || []).join(' ')]);
      }).sort(function (a, b) {
        return new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime();
      }).slice(0, 4).map(function (s) {
        var job = sc.jobs.filter(function (j) { return j.scheduleId === s.id && j.status !== 'closed'; })[0];
        return {
          kind: 'Schedule', label: s.id + ' · ' + s.category,
          meta: s.office + ' · due ' + dateOnly(s.dueDate),
          href: job ? 'maintenance.html?job=' + encodeURIComponent(job.id) : 'maintenance.html'
        };
      });
    }

    var groups = [];
    if (!q) {
      var recent = cmRecent().map(function (r) {
        return { kind: r.kind || 'Recent', label: r.label, meta: r.meta || '', href: r.href };
      });
      if (recent.length) groups.push({ label: 'Recent', items: recent });
    }
    groups.push({ label: q ? 'Tickets' : 'Recent tickets', items: ticketHits });
    groups.push({ label: 'Offices', items: officeHits });
    groups.push({ label: 'Assets', items: assetHits });
    groups.push({ label: 'Maintenance schedules', items: scheduleHits });
    return groups.filter(function (g) { return g.items.length; });
  }

  function cmIcon(kind) {
    return { Ticket: 'ticket', Office: 'building', Asset: 'server', Schedule: 'cal', Recent: 'history' }[kind] || 'search';
  }

  function ensurePalette() {
    var host = document.getElementById('cmdk');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'cmdk';
    host.className = 'cmdk';
    host.hidden = true;
    host.innerHTML =
      '<div class="cmdk-backdrop" data-cmdk-close></div>' +
      '<div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Search the workspace">' +
      '<div class="cmdk-field">' + icon('search') +
      '<input id="cmdkInput" type="search" role="combobox" aria-expanded="true" aria-controls="cmdkList" aria-autocomplete="list" autocomplete="off" placeholder="Search tickets, offices, assets, schedules">' +
      '<kbd>Esc</kbd></div>' +
      '<div class="cmdk-list" id="cmdkList" role="listbox" aria-label="Results"></div>' +
      '<div class="cmdk-foot"><span><kbd>Up</kbd><kbd>Down</kbd> move</span>' +
      '<span><kbd>Enter</kbd> open</span><span>' + esc(currentRole().title) + ' scope</span></div></div>';
    document.body.appendChild(host);
    var input = document.getElementById('cmdkInput');
    input.addEventListener('input', function () { renderPalette(input.value); });
    host.querySelector('[data-cmdk-close]').addEventListener('click', closePalette);
    document.getElementById('cmdkList').addEventListener('click', function (e) {
      var item = e.target.closest('[data-cmdk-item]');
      if (item) pickPaletteItem(item);
    });
    return host;
  }

  function renderPalette(query) {
    var list = document.getElementById('cmdkList');
    if (!list) return;
    var groups = cmCommandResults(query);
    var n = 0, html = '';
    groups.forEach(function (g) {
      html += '<div class="cmdk-group" role="presentation">' + esc(g.label) + '</div>';
      g.items.forEach(function (it) {
        html += '<button type="button" class="cmdk-item' + (n === 0 ? ' on' : '') + '" id="cmdk-opt-' + n + '"' +
          ' role="option" aria-selected="' + (n === 0) + '" data-cmdk-item data-href="' + attr(it.href) + '"' +
          ' data-kind="' + attr(it.kind) + '" data-label="' + attr(it.label) + '" data-meta="' + attr(it.meta || '') + '">' +
          '<span class="cmdk-ic">' + icon(cmIcon(it.kind)) + '</span>' +
          '<span class="cmdk-text"><b>' + esc(it.label) + '</b><small>' + esc(it.meta || '') + '</small></span>' +
          '<span class="cmdk-kind">' + esc(it.kind) + '</span></button>';
        n++;
      });
    });
    list.innerHTML = html || '<div class="cmdk-empty">No ticket, office, asset or schedule matches this search.</div>';
    var input = document.getElementById('cmdkInput');
    if (input) input.setAttribute('aria-activedescendant', n ? 'cmdk-opt-0' : '');
    cmActive = 0;
  }

  function openPalette(query) {
    var host = ensurePalette();
    host.hidden = false;
    document.body.classList.add('cmdk-open');
    var input = document.getElementById('cmdkInput');
    input.value = query || '';
    renderPalette(input.value);
    ['tbSearch', 'tbSearchMobile'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.setAttribute('aria-expanded', 'true');
    });
    input.focus();
  }
  function closePalette() {
    var host = document.getElementById('cmdk');
    if (!host) return;
    host.hidden = true;
    document.body.classList.remove('cmdk-open');
    ['tbSearch', 'tbSearchMobile'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.setAttribute('aria-expanded', 'false');
    });
    var t = document.getElementById('tbSearch') || document.getElementById('tbSearchMobile');
    if (t) t.focus();
  }
  function movePalette(delta) {
    var items = document.querySelectorAll('#cmdkList [data-cmdk-item]');
    if (!items.length) return;
    cmActive = (cmActive + delta + items.length) % items.length;
    items.forEach(function (el, i) {
      el.classList.toggle('on', i === cmActive);
      el.setAttribute('aria-selected', i === cmActive ? 'true' : 'false');
    });
    var input = document.getElementById('cmdkInput');
    if (input) input.setAttribute('aria-activedescendant', items[cmActive].id);
    if (items[cmActive].scrollIntoView) items[cmActive].scrollIntoView({ block: 'nearest' });
  }
  function pickPaletteItem(el) {
    if (!el) return;
    cmRemember({ href: el.dataset.href, label: el.dataset.label, meta: el.dataset.meta, kind: el.dataset.kind });
    location.href = el.dataset.href;
  }
  function bindPaletteKeys() {
    if (bindPaletteKeys.bound) return;
    bindPaletteKeys.bound = true;
    document.addEventListener('keydown', function (e) {
      var host = document.getElementById('cmdk');
      var open = host && !host.hidden;
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (open) closePalette(); else openPalette();
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
      else if (e.key === 'Enter') {
        var items = document.querySelectorAll('#cmdkList [data-cmdk-item]');
        if (items.length) { e.preventDefault(); pickPaletteItem(items[Math.max(0, cmActive)]); }
      }
    });
  }

  function renderTop() {
    var topbar = document.getElementById('chromeTopbar');
    if (!topbar) return;
    topbar.innerHTML =
      '<nav class="tb-crumbs" aria-label="Breadcrumb">' + crumbInner(true) + '</nav>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="tb-search" id="tbSearch" aria-label="Search the workspace" aria-haspopup="dialog" aria-expanded="false">' +
      icon('search') + '<span class="tb-search-text">Search tickets, offices, assets…</span><kbd>Ctrl K</kbd></button>' +
      '<span class="role-chip"><i aria-hidden="true"></i>' + esc(currentRole().title) + '</span>' +
      bellHTML('notifD') +
      accountHTML('acctD');
    bindThemePicker(topbar);
    renderAccountTriggers(topbar);
    var trigger = document.getElementById('tbSearch');
    if (trigger) trigger.addEventListener('click', function () { openPalette(); });
  }

  /* Breadcrumbs and the formal footer are inserted for every authenticated
     page, so the shell reads the same on every screen without editing the
     page files. */
  function renderPageFrame() {
    var content = document.querySelector('.content');
    if (!content) return;
    var main = content.parentNode;
    if (main && !main.querySelector('.app-foot')) {
      var foot = document.createElement('footer');
      foot.className = 'app-foot';
      foot.innerHTML = '<span>&copy; ' + new Date().getFullYear() +
        ' University of the Philippines Cebu. All rights reserved.</span>';
      main.insertBefore(foot, document.getElementById('chromeBottom') || null);
    }
    if (!document.getElementById('navScrim')) {
      var scrim = document.createElement('button');
      scrim.type = 'button';
      scrim.id = 'navScrim';
      scrim.className = 'nav-scrim';
      scrim.setAttribute('aria-label', 'Close navigation');
      scrim.addEventListener('click', function () { document.body.classList.remove('nav-open'); });
      document.body.appendChild(scrim);
    }
  }

  /* The four main destinations for the bottom tab bar, per role, plus More.
     Every item is still filtered through the shared permission map. */
  function bottomItems(role) {
    var map = {
      requester: [
        { href: 'dashboard.html', label: 'Dashboard', ic: 'grid' },
        { href: 'tickets.html?queue=mine', label: 'My Requests', ic: 'ticket' },
        { href: 'request.html', label: 'New Request', ic: 'plus' },
        { href: 'register.html', label: 'Register', ic: 'case' }
      ],
      coordinator: [
        { href: 'dashboard.html', label: 'Dashboard', ic: 'grid' },
        { href: 'tickets.html', label: 'Tickets', ic: 'ticket' },
        { href: 'maintenance.html', label: 'Maintenance', ic: 'cal' },
        { href: 'reports.html', label: 'Reports', ic: 'chart' }
      ],
      technician: [
        { href: 'dashboard.html', label: 'Dashboard', ic: 'grid' },
        { href: 'technician.html', label: 'My Tickets', ic: 'ticket' },
        { href: 'maintenance.html', label: 'My Jobs', ic: 'cal' },
        { href: 'register.html', label: 'Register', ic: 'case' }
      ],
      management: [
        { href: 'dashboard.html', label: 'Dashboard', ic: 'grid' },
        { href: 'users.html', label: 'Admin', ic: 'shield' },
        { href: 'offices.html', label: 'Offices', ic: 'building' },
        { href: 'reports.html', label: 'Reports', ic: 'chart' }
      ]
    };
    return (map[role] || map.coordinator).filter(function (n) { return can(n.href, role); });
  }

  function renderBottom() {
    var bottom = document.getElementById('chromeBottom');
    if (!bottom) return;
    var role = roleKey();
    bottom.innerHTML = bottomItems(role).map(function (i) {
      return '<a href="' + urlFor(i.href, role) + '">' + icon(i.ic) + i.label + '</a>';
    }).join('') +
      '<button type="button" class="bottom-more" id="bottomMore" aria-label="More destinations">' +
      icon('menu') + '<span>More</span></button>';
    var more = document.getElementById('bottomMore');
    if (more) more.addEventListener('click', openMoreSheet);
  }

  /* The destinations that do not fit the four bottom tabs.  They live in the
     More sheet on a phone.  The list is derived from the same sidebar model the
     desktop uses, so a destination the role cannot open is never offered. */
  function moreDestinations(role) {
    var inBar = bottomItems(role).map(function (i) { return hrefPage(i.href); });
    var out = [];
    var seen = {};
    function add(href, label, ic) {
      var page = hrefPage(href);
      if (!page || seen[page] || inBar.indexOf(page) > -1) return;
      if (!can(page, role)) return;
      seen[page] = 1;
      out.push({ href: href, label: label, ic: ic });
    }
    navModel(role).forEach(function (g) {
      g.items.forEach(function (n) { add(n.href, n.label, n.ic); });
    });
    accountItems(role).forEach(function (n) { add(n.href, n.label, n.ic); });
    return out;
  }

  function openMoreSheet() {
    var role = roleKey();
    var items = moreDestinations(role);
    var sheet = document.createElement('div');
    sheet.className = 'more-sheet';
    sheet.innerHTML =
      '<div class="more-sheet-head"><b>More</b>' +
      '<button type="button" class="ico-btn more-sheet-close" aria-label="Close menu">' + icon('x') + '</button></div>' +
      '<div class="more-sheet-body">' + items.map(function (n) {
        return '<a class="more-item" href="' + urlFor(n.href, role) + '">' +
          icon(n.ic) + '<span>' + esc(n.label) + '</span></a>';
      }).join('') + '</div>';
    document.body.appendChild(sheet);
    function close() {
      sheet.remove();
      document.body.classList.remove('sheet-open');
      /* The notices that waited for the sheet to close now have the screen. */
      releaseHeldToasts();
    }
    sheet.querySelector('.more-sheet-close').addEventListener('click', close);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });
    document.body.classList.add('sheet-open');
  }

  function markBodyRole() {
    var role = roleKey();
    ['requester', 'technician', 'coordinator', 'management'].forEach(function (r) {
      document.body.classList.toggle('role-' + r, r === role);
    });
  }

  function mountChrome(opts) {
    lastOpts = opts || {};
    applyTheme();
    if (bindUrlRole()) return;  /* wrong-role or signed-out URL is redirecting */
    markBodyRole();
    renderSide(); renderAppbar(); renderTop(); renderBottom();
    renderPageFrame();
    bindChrome();
    bindPaletteKeys();
    activeNav();
    renderBell();
    renderPills();
    guardPage();
  }
  function remount() {
    if (!lastOpts) return;
    markBodyRole();
    renderSide(); renderTop(); renderBottom();
    renderPageFrame();
    bindChrome();
    bindPaletteKeys();
    activeNav();
    renderPills();
    guardPage();
  }

  /* ---------- page-level access control ----------
     A forbidden address gets a neutral screen.  It never names the role list
     or confirms that a hidden feature exists (specification 25.2). */
  function guardPage() {
    var page = pageId();
    var content = document.querySelector('.content');
    if (!can(page)) {
      document.body.classList.add('access-denied');
      if (content && !document.getElementById('accessPanel')) {
        var panel = document.createElement('div');
        panel.className = 'access-panel';
        panel.id = 'accessPanel';
        panel.innerHTML =
          '<span class="ap-ic">' + UI.icon('lock') + '</span>' +
          '<h2>This page is not available</h2>' +
          '<p class="ap-lead">The address may be mistyped, or the page may not be part of this workspace. ' +
          'Your navigation lists every screen you can open.</p>' +
          '<div class="row ap-actions">' +
          '<a class="btn btn-primary" href="' + urlFor('dashboard.html', roleKey()) + '">Back to dashboard</a>' +
          '</div>';
        content.insertBefore(panel, content.firstChild);
        /* The panel belongs under the page head, so the screen still reads
           as a page of the product and not as a broken screen. */
        var head = content.querySelector('.sec-title');
        if (head && head.nextSibling) content.insertBefore(panel, head.nextSibling);
        else if (head) content.appendChild(panel);
      }
    } else {
      document.body.classList.remove('access-denied');
      var old = document.getElementById('accessPanel');
      if (old) old.remove();
    }
  }

  /* ---------- chrome state ---------- */
  function viewerName() { var a = auth(); return a && a.name ? a.name : ''; }
  /* A notification is addressed to a role (and sometimes an office).  Read
     state is per-user via `readBy` (the engine appends the acting identity),
     falling back to the legacy boolean `read` for old records. */
  function notifRead(n) {
    if (Array.isArray(n.readBy)) {
      var me = viewerName();
      if (!me) return !!n.read;
      return n.readBy.indexOf(me) > -1;
    }
    return !!n.read;
  }
  function visibleNotifs() {
    var db = S.db, role = db.role;
    return db.notifications.filter(function (n) { return n.role === role || n.role === 'any'; });
  }
  function renderBell() {
    var list = visibleNotifs();
    var unread = list.filter(function (n) { return !notifRead(n); }).length;
    document.querySelectorAll('.bellCount').forEach(function (el) {
      el.textContent = unread > 9 ? '9+' : String(unread);
      el.style.display = unread ? '' : 'none';
    });
    document.querySelectorAll('.notifList').forEach(function (box) {
      box.innerHTML = list.length
        ? list.slice(0, 10).map(function (n) {
          return '<li class="notif-item' + (notifRead(n) ? '' : ' unread') + '">' +
            '<span class="nico">' + kindIcon(n.kind) + '</span>' +
            '<span><b>' + esc(n.text) + '</b><span class="muted">' + clock(n.at) + '</span></span></li>';
        }).join('')
        : '<li class="notif-item muted">No notifications for your role yet.</li>';
    });
    document.querySelectorAll('.bellWrap').forEach(function (w) { w.classList.toggle('has-unread', unread > 0); });
  }
  function kindIcon(k) {
    return { intake: UI.icon('inbox'), assign: UI.icon('wrench'), confirm: UI.icon('checkCircle'), remind: UI.icon('clock'), cancel: UI.icon('ban'), dep: UI.icon('pause'), job: UI.icon('toolbox'), sched: UI.icon('cal'), test: UI.icon('flask'), comment: UI.icon('message'), attachment: UI.icon('paperclip') }[k] || UI.icon('bell');
  }
  function renderPills() {
    var db = S.db, role = roleKey();
    var open = db.tickets.filter(function (t) {
      return (window.Query ? window.Query.OPEN_STATES : ['submitted', 'needs_info', 'assigned', 'in_progress', 'on_hold', 'resolved']).indexOf(t.status) > -1;
    }).length;
    var tickets = open;
    if (role === 'requester') {
      tickets = db.tickets.filter(function (t) { return t.status === 'needs_info' || t.status === 'resolved'; }).length;
    } else if (role === 'technician') {
      tickets = db.tickets.filter(function (t) {
        return t.technician === ROLES.technician.name && ['assigned', 'in_progress', 'on_hold'].indexOf(t.status) > -1;
      }).length;
    }
    var maint = db.jobs.filter(function (j) {
      if (j.status === 'closed' || j.status === 'cancelled') return false;
      return role !== 'technician' || j.technician === ROLES.technician.name;
    }).length;
    set('#pillTickets', tickets); set('#pillMaint', maint);
    function set(sel, v) { document.querySelectorAll(sel).forEach(function (e) { e.textContent = v; }); }
  }
  function applyRole() {
    var r = currentRole(), a = auth();
    document.querySelectorAll('.roleChip').forEach(function (c) { c.textContent = r.title + ' · ' + r.name; });
    document.querySelectorAll('.avatar').forEach(function (el) { el.textContent = initials(a.name); });
    document.querySelectorAll('.sideRole').forEach(function (e) { e.textContent = r.title; });
    document.querySelectorAll('.sideUser').forEach(function (e) { e.textContent = r.name; });
    var an = document.querySelector('.acctName'); if (an) an.textContent = a.name;
    var ae = document.querySelector('.acctEmail'); if (ae) ae.textContent = a.email;
  }
  function markAllRead() {
    /* The engine records read state per user; fall back to the local flag when
       the notification is a legacy record without readBy. */
    if (window.Admin && window.Admin.markNotificationsRead) {
      var ids = visibleNotifs().map(function (n) { return n.id; });
      if (ids.length) {
        try { window.Admin.markNotificationsRead(ids); } catch (e) { /* offline */ }
      }
    } else {
      S.update(function (db) {
        var me = viewerName();
        db.notifications.forEach(function (n) {
          if (n.role !== db.role && n.role !== 'any') return;
          if (Array.isArray(n.readBy)) { if (me && n.readBy.indexOf(me) === -1) n.readBy.push(me); }
          else n.read = true;
        });
      });
    }
    renderBell();
  }
  function bindChrome() {
    document.querySelectorAll('.notif-toggle').forEach(function (cb) {
      if (cb.dataset.bound) return; cb.dataset.bound = '1';
      cb.addEventListener('change', function () { if (cb.checked) renderBell(); });
    });
    document.querySelectorAll('.markAll').forEach(function (b) {
      if (b.dataset.bound) return; b.dataset.bound = '1';
      b.addEventListener('click', function (e) { e.preventDefault(); markAllRead(); });
    });
    /* The pop-up switch: one click to quiet the live notices, one to bring
       them back.  There are two bells (the app bar and the top bar), so both
       switches follow the same saved choice. */
    document.querySelectorAll('[data-popups]').forEach(function (b) {
      if (b.dataset.bound) return; b.dataset.bound = '1';
      b.addEventListener('click', function (e) { e.preventDefault(); setPopups(!popupsOn()); });
    });
    document.body.classList.toggle('popups-off', !popupsOn());
    syncPopupSwitch();
    applyRole();
  }

  /* ---------- timeline ---------- */
  var TONE = { status: '', note: '', cancel: 'tone-warn', dep: 'tone-warn', test: 'tone-warn', confirm: 'tone-ok', remind: 'tone-warn', link: 'tone-muted', comment: '' };
  function timeline(history) {
    if (!history || !history.length) return '<p class="muted">No activity recorded yet.</p>';
    return '<ol class="timeline">' + history.slice().reverse().map(function (h) {
      return '<li class="' + (TONE[h.kind] || '') + '">' +
        '<div class="tl-title">' + esc(h.text) + '</div>' +
        '<div class="tl-meta">' + clock(h.at) + ' · ' + esc(h.by) + ' (' + esc(h.role) + ')</div></li>';
    }).join('') + '</ol>';
  }

  /* Who may see internal staff notes: everyone except office requesters. */
  function canSeeInternal(role) {
    role = role || roleKey();
    return role !== 'requester';
  }

  /* May this role invoke this backend action?
   *
   * The question is answered by the one permission map (permissions.json),
   * the same map the trusted backend enforces.  Every button that triggers a
   * workflow action is gated with it, so the screen never offers a control
   * the server would refuse (specification 4A.1). */
  function canAct(method, role) {
    role = role || roleKey();
    if (!window.PermissionMap || !window.PermissionMap.canMethod) return false;
    return window.PermissionMap.canMethod(role, method);
  }

  /* Merge a ticket's audit history with its conversation into one chronological
     feed.  Internal notes are hidden from office (requester) users  --  the
     server never even sends them a foreign office's records, and this keeps the
     staff back-channel out of the office's view. */
  function feed(t, role) {
    role = role || roleKey();
    var items = [];
    var officeUser = !canSeeInternal(role);
    function hideCost(text) {
      if (!officeUser) return text;
      return String(text || '')
        .replace(/\s*\(?₱[\d,]+(?:\.\d+)?(?:\s*·\s*[\d.]+h)?\)?/g, '')
        .replace(/\s{2,}/g, ' ').trim();
    }
    (t.history || []).forEach(function (h) {
      items.push({ at: h.at, kind: h.kind || 'status', text: hideCost(h.text), by: h.by, role: h.role,
        legacyStatus: h.status, subject: 'history' });
    });
    (t.comments || []).forEach(function (c) {
      if (c.visibility === 'internal' && !canSeeInternal(role)) return;
      items.push({ at: c.at, kind: 'comment', text: hideCost(c.text), by: c.by, role: c.role,
        visibility: c.visibility || 'public', subject: 'comment', id: c.id, attachments: c.attachments || [] });
    });
    items.sort(function (a, b) {
      var ta = new Date(a.at).getTime(), tb = new Date(b.at).getTime();
      if (ta !== tb) return ta - tb;
      return 0;
    });
    return items;
  }

  function timelineMerged(t, role) {
    var items = feed(t, role);
    if (!items.length) return '<p class="muted">No activity recorded yet.</p>';
    return '<ol class="timeline">' + items.slice().reverse().map(function (h) {
      if (h.subject === 'comment') {
        var internal = h.visibility === 'internal';
        var tone = internal ? 'tone-warn' : '';
        return '<li class="' + tone + '">' +
          '<div class="tl-title">' + (internal ? '<span class="chip">internal</span> ' : '') + esc(h.text) + '</div>' +
          '<div class="tl-meta">' + clock(h.at) + ' · ' + esc(h.by) + ' (' + esc(h.role) + ') · message</div></li>';
      }
      return '<li class="' + (TONE[h.kind] || '') + '">' +
        '<div class="tl-title">' + esc(h.text) + '</div>' +
        '<div class="tl-meta">' + clock(h.at) + ' · ' + esc(h.by) + ' (' + esc(h.role) + ')</div></li>';
    }).join('') + '</ol>';
  }

  /* The status changes and the audit events on their own, without the
     conversation.  This is the History tab of the service record. */
  function timelineHistory(t, role) {
    var items = feed(t, role).filter(function (h) { return h.subject === 'history'; });
    if (!items.length) return '<p class="muted">No status change recorded yet.</p>';
    return '<ol class="timeline">' + items.slice().reverse().map(function (h) {
      return '<li class="' + (TONE[h.kind] || '') + '">' +
        '<div class="tl-title">' + esc(h.text) + '</div>' +
        '<div class="tl-meta">' + clock(h.at) + ' · ' + esc(h.by) + ' (' + esc(h.role) + ')</div></li>';
    }).join('') + '</ol>';
  }

  /* The loading skeleton.  The pages read their data synchronously, so this
     shows only where the app genuinely waits (an upload in flight). */
  function skeleton(lines) {
    var n = lines || 3;
    var h = '<div class="skeleton-block" role="status" aria-label="Loading">';
    for (var i = 0; i < n; i++) {
      h += '<div class="skeleton skeleton-line' + (i === n - 1 ? ' short' : (i % 2 ? ' mid' : '')) + '"></div>';
    }
    return h + '</div>';
  }

  /* The current instant.  Date.now() is frozen in the deterministic demo
     mode, so every "is this due yet" comparison stays consistent with the
     data the demo shows. */
  function nowMs() { return Date.now(); }

  /* The workflow stepper: the documented path, with the current step
     highlighted and the branch states called out.  The step names are the
     same eight status labels the badges use, so the screen and the
     Workflow Guide always tell the same story. */
  var STEP_PATH = ['submitted', 'assigned', 'in_progress', 'resolved', 'closed'];
  var STEP_BRANCH = { needs_info: 'Needs Information', on_hold: 'On Hold', cancelled: 'Cancelled' };

  function stepper(status, isJob) {
    var path = isJob ? ['submitted', 'assigned', 'in_progress', 'resolved', 'closed'] : STEP_PATH;
    var idx = path.indexOf(status);
    var labels = {};
    path.forEach(function (s) { labels[s] = (STATUS[s] && STATUS[s][0]) || s; });
    var html = '<ol class="stepper" aria-label="Workflow progress">';
    path.forEach(function (s, i) {
      var cls = 'step';
      if (idx > -1 && i < idx) cls += ' done';
      if (s === status) cls += ' now';
      if (i) html += '<li class="step-line" aria-hidden="true"><span></span></li>';
      html += '<li class="' + cls + '"' + (s === status ? ' aria-current="step"' : '') + '>' +
        '<span class="step-dot" aria-hidden="true"></span>' +
        '<span class="step-label">' + esc(labels[s]) + '</span></li>';
    });
    html += '</ol>';
    if (STEP_BRANCH[status]) {
      html += '<div class="step-branch"><span class="chip">' + esc(STEP_BRANCH[status]) + '</span>' +
        '<span class="hint">branch state  --  the main path is paused here</span></div>';
    }
    return html;
  }

  function qs(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  /* Theme: light (default) or dark.  ?theme=dark is the hook a design tool
     (Codia's dark-mode import) or a share link can use; data-theme is the
     explicit choice. */
  var THEME_KEY = 'itc_theme';
  /* The saved choice: light, dark or system.  js/theme.js owns the value so
     the pre-paint script, the account tray and the sign-in screen agree. */
  function themeChoice() {
    if (window.Theme && window.Theme.current) return window.Theme.current();
    try {
      var v = localStorage.getItem(THEME_KEY);
      if (v === 'dark' || v === 'light' || v === 'system') return v;
    } catch (e) { /* private mode */ }
    return 'system';
  }
  /* Light / Dark / System.  The shared helper in js/theme.js owns the logic so
     the pre-paint script, the user menu and the sign-in screen all agree. */
  function applyTheme(name) {
    if (window.Theme && window.Theme.apply) return window.Theme.apply(name);
    var t = name || qs('theme');
    if (!t) { try { t = localStorage.getItem(THEME_KEY) || ''; } catch (e) { t = ''; } }
    if (t !== 'dark' && t !== 'light') t = 'system';
    var el = document.documentElement;
    if (t === 'dark') el.setAttribute('data-theme', 'dark');
    else if (t === 'light') el.setAttribute('data-theme', 'light');
    else el.removeAttribute('data-theme');
    /* Keep the browser colour scheme in step so form controls, scrollbars and
       the canvas match the theme. */
    el.style.colorScheme = t === 'dark' ? 'dark' : t === 'light' ? 'light' : 'light dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0B1220' : '#1E3A5F');
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* quota */ }
    return t;
  }
  function theme() {
    /* The theme that is on screen.  The saved choice can be "system", so a
       switch follows what is really applied and never shows an empty state. */
    if (window.Theme && window.Theme.resolved) return window.Theme.resolved();
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function toggleTheme() { return applyTheme(theme() === 'dark' ? 'light' : 'dark'); }

  function activeNav() {
    var page = pageId();
    document.querySelectorAll('.side-link[href],.bottomnav a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      var on = hrefPage(href) === page;
      if (on && href.indexOf('?') > -1) {
        /* Queue links share one page, so the query decides which one is lit. */
        var want = href.slice(href.indexOf('?') + 1);
        var have = location.search.replace(/^\?/, '');
        on = have === want || have.indexOf(want + '&') === 0;
        if (!have && want === 'queue=open') on = true;
      }
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ---------- pagination ---------- */
  function paginate(items, page, perPage) {
    var start = (page - 1) * perPage;
    return { items: items.slice(start, start + perPage), total: items.length, page: page, perPage: perPage, pages: Math.ceil(items.length / perPage) };
  }
  function renderPagination(el, state, onChange) {
    if (!el) return;
    if (state.pages <= 1) { el.innerHTML = ''; return; }
    var from = (state.page - 1) * state.perPage + 1;
    var to = Math.min(state.page * state.perPage, state.total);
    var html = '<nav class="pagination" role="navigation" aria-label="Pagination">';
    if (state.page > 1) html += '<button class="btn btn-ghost sm" data-p="' + (state.page - 1) + '" aria-label="Previous page">‹ Previous</button>';
    if (state.page > 3) html += '<button class="btn btn-ghost sm" data-p="1" aria-label="First page">1</button>';
    if (state.page > 4) html += '<span class="pagination-gap" aria-hidden="true">…</span>';
    var start = Math.max(1, state.page - 2);
    var end = Math.min(state.pages, state.page + 2);
    for (var i = start; i <= end; i++) {
      html += '<button class="btn ' + (i === state.page ? 'btn-primary' : 'btn-ghost') + ' sm" data-p="' + i + '"' + (i === state.page ? ' aria-current="page" aria-label="Page ' + i + ', current"' : ' aria-label="Page ' + i + '"') + '>' + i + '</button>';
    }
    if (state.page < state.pages - 2) html += '<span class="pagination-gap" aria-hidden="true">…</span>';
    if (state.page < state.pages - 1) html += '<button class="btn btn-ghost sm" data-p="' + state.pages + '" aria-label="Last page">' + state.pages + '</button>';
    if (state.page < state.pages) html += '<button class="btn btn-ghost sm" data-p="' + (state.page + 1) + '" aria-label="Next page">Next ›</button>';
    html += '<span class="pagination-info" aria-live="polite"><span class="current">' + from + '–' + to + '</span> of <span class="total">' + state.total + '</span></span>';
    html += '</nav>';
    el.innerHTML = html;
    el.querySelectorAll('[data-p]').forEach(function (b) {
      b.addEventListener('click', function () { onChange(parseInt(b.dataset.p, 10)); });
    });
  }

  /* ---------- confirm dialog (uses the shared modal kit) ---------- */
  function confirmDialog(opts, onYes) {
    opts = opts || {};
    var body = '<p class="confirm-text">' + esc(opts.text || 'Are you sure?') + '</p>' +
      (opts.note ? '<p class="confirm-note">' + esc(opts.note) + '</p>' : '');
    openModal(opts.title || 'Please confirm', body,
      '<button class="btn btn-ghost" data-close>Cancel</button>' +
      '<button class="btn ' + (opts.danger ? 'btn-danger-soft' : 'btn-primary') + '" id="mGo">' + esc(opts.go || 'Confirm') + '</button>');
    var go = document.getElementById('mGo');
    if (go) go.onclick = function () { closeModal(); if (onYes) onYes(); };
    return modalHost;
  }

  /* ---------- small DOM helpers used by the new screens ---------- */
  function setHTML(sel, html) { document.querySelectorAll(sel).forEach(function (e) { e.innerHTML = html; }); }
  function byId(id) { return document.getElementById(id); }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 220);
    };
  }
  /* CSV export of an array of row arrays (first row = header). */
  function downloadCSV(filename, rows) {
    var csv = rows.map(function (r) {
      return r.map(function (c) {
        var s = c == null ? '' : String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  window.UI = {
    esc: esc, attr: attr, badge: badge, prio: prio, timeAgo: timeAgo, clock: clock, dateOnly: dateOnly,
    workCard: workCard, categoryIcon: categoryIcon, sparkline: sparkline, gauge: gauge,
    openPalette: openPalette, closePalette: closePalette, paletteResults: cmCommandResults,
    toast: toast, openModal: openModal, closeModal: closeModal, field: field, input: input,
    openAttachment: openAttachment, closeAttachment: closeAttachment,
    attachmentKind: attachmentKind, humanSize: humanSize,
    popupsOn: popupsOn, setPopups: setPopups,
    dateInput: dateInput, numberInput: numberInput, select: select, textarea: textarea,
    modalValue: modalValue, icon: icon, mountChrome: mountChrome, remount: remount, guardPage: guardPage,
    renderBell: renderBell, renderPills: renderPills, timeline: timeline, timelineMerged: timelineMerged,
    timelineHistory: timelineHistory, stepper: stepper,
    feed: feed, canSeeInternal: canSeeInternal, qs: qs, activeNav: activeNav,
    applyTheme: applyTheme, theme: theme, toggleTheme: toggleTheme,
    themePickerHTML: themePickerHTML, bindThemePicker: bindThemePicker,
    paginate: paginate, renderPagination: renderPagination,
    pageId: pageId, STATUS: STATUS, notifRead: notifRead, viewerName: viewerName, markAllRead: markAllRead,
    confirmDialog: confirmDialog, setHTML: setHTML, byId: byId, debounce: debounce, downloadCSV: downloadCSV,
    /* client-side validation */
    validateForm: validateForm, validateField: validateField, bindFormValidation: bindFormValidation,
    showFieldError: showFieldError, clearFieldError: clearFieldError, getFieldValue: getFieldValue,
    VALIDATORS: VALIDATORS, ERROR_MESSAGES: ERROR_MESSAGES,
    /* role model & access */
    ROLES: ROLES, ROLE_ORDER: ROLE_ORDER, ACCESS: ACCESS, CAPS: CAPS, ALL: ALL,
    roleKey: roleKey, currentRole: currentRole, can: can, initials: initials, auth: auth,
    canAct: canAct, nowMs: nowMs, skeleton: skeleton,
    /* next action owner (specification 4A.3) */
    NEXT_OWNER: NEXT_OWNER, NEXT_OWNER_JOB: NEXT_OWNER_JOB,
    nextOwner: nextOwner, waitsOnMe: waitsOnMe, waitingOn: waitingOn,
    signIn: signIn, signOut: signOut, capabilities: capabilities, capsForRole: capsForRole,
    /* url role */
    URL_PREFIX: URL_PREFIX, PREFIX_ROLE: PREFIX_ROLE, parseUrlRole: parseUrlRole,
    urlFor: urlFor, bindUrlRole: bindUrlRole
  };
})();





