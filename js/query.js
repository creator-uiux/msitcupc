/* query.js  --  the browser mirror of server/query.py.
 *
 * One definition of the list contract and the KPI maths, shared by both modes:
 *   • live mode (window.ApiMode)  --  the ticket list calls GET /api/tickets, so the
 *     server decides visibility and only ships the requested page;
 *   • local demo mode  --  the identical filter/sort/paginate maths runs over
 *     Store.db, so a browser without the backend reports the same numbers.
 *
 * The turnaround / overdue / summarise semantics must stay line-for-line equal
 * to server/query.py: that module is the reference and this file is its port. */
(function () {
  'use strict';

  /* Canonical internal statuses (display labels live in js/ui.js STATUS). */
  var OPEN_STATES = ['submitted', 'needs_info', 'assigned', 'in_progress', 'on_hold', 'resolved'];
  var TERMINAL_STATES = ['closed', 'cancelled'];
  var ALL_STATES = OPEN_STATES.concat(TERMINAL_STATES);

  var PRIORITY_ORDER = { high: 3, medium: 2, low: 1 };
  var STATUS_ORDER = {};
  ALL_STATES.forEach(function (s, i) { STATUS_ORDER[s] = i; });

  /* One definition of "overdue": a target date when the coordinator set one,
     otherwise intake + the default SLA window. */
  var DEFAULT_SLA_DAYS = 5;
  var SORT_KEYS = ['updated', 'created', 'status', 'priority', 'id', 'target'];
  var MAX_SIZE = 100;

  function parseMs(iso) {
    if (!iso) return 0;
    var t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  }
  function nowMs() { return Date.now(); }

  function _int(v, def) {
    var n = parseInt(v, 10);
    return isNaN(n) ? def : n;
  }

  function turnaroundHours(t) {
    /* resolvedAt - createdAt in hours, else null (single definition). */
    if (!t.resolvedAt || t.status === 'cancelled') return null;
    var delta = parseMs(t.resolvedAt) - parseMs(t.createdAt);
    return delta >= 0 ? Math.round(delta / 36000) / 100 : null;
  }

  function dueMs(t) {
    /* When the ticket is considered overdue: target, else intake + default SLA. */
    if (t.target) return parseMs(t.target);
    var created = parseMs(t.createdAt);
    if (!created) return 0;
    return created + DEFAULT_SLA_DAYS * 86400000;
  }

  function isOverdue(t, at) {
    /* Active ticket past its due point (terminal tickets are never overdue). */
    if (t.status === 'resolved') return false;
    if (OPEN_STATES.indexOf(t.status) === -1) return false;
    var due = dueMs(t);
    if (!due) return false;
    return due < (at == null ? nowMs() : at);
  }

  function decorate(t, at) {
    var row = {};
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) row[k] = t[k];
    row.turnaroundHours = turnaroundHours(t);
    row.overdue = isOverdue(t, at);
    return row;
  }

  function _matches(t, params, userName) {
    var q = (params.q || '').trim().toLowerCase();
    if (q) {
      var hay = ['id', 'issue', 'requester', 'office', 'asset', 'technician', 'category']
        .map(function (k) { return String(t[k] == null ? '' : t[k]); }).join(' ');
      if (hay.toLowerCase().indexOf(q) === -1) return false;
    }
    var status = (params.status || '').trim().toLowerCase();
    if (status) {
      var wanted = {};
      status.split(',').forEach(function (s) { s = s.trim(); if (s) wanted[s] = true; });
      if (wanted.open) OPEN_STATES.forEach(function (s) { wanted[s] = true; });
      var ts = t.status || '';
      var tsAlias = ts.toLowerCase().replace(/ /g, '_');
      var hit = false;
      for (var w in wanted) if (w === ts || w === tsAlias) hit = true;
      if (!hit) return false;
    }
    var fields = [['office', 'office'], ['requester', 'requester'], ['technician', 'technician'],
      ['priority', 'priority'], ['category', 'category'], ['source', 'source']];
    for (var i = 0; i < fields.length; i++) {
      var want = (params[fields[i][0]] || '').trim();
      if (want && String(t[fields[i][1]] == null ? '' : t[fields[i][1]]).toLowerCase() !== want.toLowerCase()) return false;
    }
    if (['1', 'true', 'yes'].indexOf((params.mine || '').trim()) > -1) {
      if (userName && t.requester !== userName) return false;
    }
    var from = (params.from || '').trim();
    if (from && (t.createdAt || '').slice(0, 10) < from) return false;
    var to = (params.to || '').trim();
    if (to && (t.createdAt || '').slice(0, 10) > to) return false;
    if (['1', 'true', 'yes'].indexOf((params.overdue || '').trim()) > -1) {
      if (!isOverdue(t)) return false;
    }
    return true;
  }

  function _sortValue(t, key) {
    if (key === 'created') return parseMs(t.createdAt);
    if (key === 'target') return dueMs(t);
    if (key === 'priority') return PRIORITY_ORDER[t.priority] || 0;
    if (key === 'status') return STATUS_ORDER[t.status] == null ? 99 : STATUS_ORDER[t.status];
    if (key === 'id') return t.id || '';
    return parseMs(t.updatedAt || t.createdAt); /* updated (default) */
  }

  function queryTickets(tickets, params, userName) {
    /* Filter -> sort -> paginate. Returns the envelope the list screen needs. */
    params = params || {};
    var at = nowMs();
    var rows = tickets.filter(function (t) { return _matches(t, params, userName); });

    var sort = (params.sort || 'updated').trim();
    if (SORT_KEYS.indexOf(sort) === -1) sort = 'updated';
    var order = (params.order || 'desc').trim().toLowerCase();
    var dir = order === 'asc' ? 1 : -1;
    rows.sort(function (a, b) {
      var va = _sortValue(a, sort), vb = _sortValue(b, sort);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      var ia = a.id || '', ib = b.id || '';
      return (ia < ib ? -1 : ia > ib ? 1 : 0) * dir;
    });

    var counts = {}, overdueCount = 0;
    rows.forEach(function (t) {
      counts[t.status] = (counts[t.status] || 0) + 1;
      if (t.status === 'resolved') return;
      if (isOverdue(t, at)) overdueCount++;
    });

    var size = Math.min(Math.max(_int(params.size, 20), 1), MAX_SIZE);
    var total = rows.length;
    var pages = Math.max(Math.ceil(total / size), 1);
    var page = Math.min(Math.max(_int(params.page, 1), 1), pages);
    var slice_ = rows.slice((page - 1) * size, page * size);

    return {
      items: slice_.map(function (t) { return decorate(t, at); }),
      total: total, page: page, pages: pages, size: size,
      counts: counts, overdue: overdueCount,
      sort: sort, order: order === 'asc' ? 'asc' : 'desc'
    };
  }

  function summarize(tickets, at) {
    /* Shared aggregation used by the reports screen and the dashboard. */
    at = at == null ? nowMs() : at;
    var byStatus = {}, byOffice = {}, byPriority = {}, byCategory = {}, bySource = {};
    var turnarounds = [], overdue = 0;
    tickets.forEach(function (t) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byOffice[t.office] = (byOffice[t.office] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
      bySource[t.source] = (bySource[t.source] || 0) + 1;
      var h = turnaroundHours(t);
      if (h !== null) turnarounds.push(h);
      if (t.status === 'resolved') return;
      if (isOverdue(t, at)) overdue++;
    });
    var withinTarget = 0, resolvedWithTarget = 0;
    tickets.forEach(function (t) {
      if (t.target && t.resolvedAt && t.resolvedAt.slice(0, 10) <= t.target.slice(0, 10)) withinTarget++;
      if (t.target && t.resolvedAt) resolvedWithTarget++;
    });
    var open = OPEN_STATES.reduce(function (n, s) { return n + (byStatus[s] || 0); }, 0);
    var avg = null;
    if (turnarounds.length) {
      avg = Math.round((turnarounds.reduce(function (a, b) { return a + b; }, 0) / turnarounds.length) * 100) / 100;
    }
    return {
      by_status: byStatus, by_office: byOffice, by_priority: byPriority,
      by_category: byCategory, by_source: bySource,
      open: open,
      closed: byStatus.closed || 0,
      cancelled: byStatus.cancelled || 0,
      overdue: overdue,
      turnaround_avg_hours: avg,
      turnaround_samples: turnarounds.length,
      resolved_within_target: withinTarget,
      resolved_with_target: resolvedWithTarget,
      default_sla_days: DEFAULT_SLA_DAYS,
      closure_hours: null,
      resolved_awaiting: byStatus.resolved || 0
    };
  }

  /* Which list source: live mode asks the server (server-side filtering,
     pagination, office scoping); local mode runs over the local dataset. */
  function list(params, userName) {
    params = params || {};
    if (window.ApiMode && window.Api && window.Api.tickets) {
      return window.Api.tickets(params);
    }
    var user = userName;
    if (!user && window.Store && window.Store.db && window.Store.db.auth) user = window.Store.db.auth.name;
    return queryTickets(window.Store.db.tickets, params, user);
  }

  window.Query = {
    OPEN_STATES: OPEN_STATES, TERMINAL_STATES: TERMINAL_STATES, ALL_STATES: ALL_STATES,
    SORT_KEYS: SORT_KEYS, MAX_SIZE: MAX_SIZE, DEFAULT_SLA_DAYS: DEFAULT_SLA_DAYS,
    PRIORITY_ORDER: PRIORITY_ORDER, STATUS_ORDER: STATUS_ORDER,
    parseMs: parseMs, turnaroundHours: turnaroundHours, dueMs: dueMs,
    isOverdue: isOverdue, decorate: decorate,
    queryTickets: queryTickets, summarize: summarize, list: list
  };
})();
