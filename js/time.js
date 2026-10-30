/* time.js: every displayed timestamp is rendered in Asia/Manila.
 *
 * The backend stores server timestamps in UTC.  The display layer must not
 * depend on the browser's own timezone, so every format call pins the zone
 * explicitly.  Format follows the specification: "MMM d, yyyy h:mm a".
 */
(function (global) {
  'use strict';

  var TZ = 'Asia/Manila';

  function toDate(iso) {
    if (!iso) return null;
    var d = (iso instanceof Date) ? iso : new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function parts(d) {
    return {
      date: new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric'
      }).format(d),
      time: new Intl.DateTimeFormat('en-US', {
        timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true
      }).format(d).toLowerCase().replace(/\s+/g, ' ')
    };
  }

  /* "Oct 8, 2026 2:05 pm" */
  function fmt(iso) {
    var d = toDate(iso);
    if (!d) return 'Not set';
    var p = parts(d);
    return p.date + ' ' + p.time;
  }

  /* "Oct 8, 2026" */
  function date(iso) {
    var d = toDate(iso);
    if (!d) return 'Not set';
    return parts(d).date;
  }

  /* "2026-10-08"  (the calendar date in Asia/Manila) */
  function day(iso) {
    var d = toDate(iso);
    if (!d) return 'Not set';
    var y = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(d);
    var m = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, month: '2-digit' }).format(d);
    var dd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, day: '2-digit' }).format(d);
    return y + '-' + m + '-' + dd;
  }

  /* "just now", "12m ago", "3h ago", "4d ago" */
  function ago(iso) {
    var d = toDate(iso);
    if (!d) return 'Not set';
    var m = Math.floor((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  /* An ISO string shifted into Asia/Manila, for <input type="date"> values. */
  function inputValue(iso) {
    return day(iso);
  }

  /* The Manila calendar date `n` days from today, as "YYYY-MM-DD". */
  function todayPlus(n) {
    var now = new Date();
    var base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    var shifted = new Date(base.getTime() + (n || 0) * 864e5 + 8 * 3600000);
    return day(shifted.toISOString());
  }

  /* The Manila calendar date of a timestamp shifted by `n` days. */
  function dayPlus(iso, n) {
    var d = toDate(iso);
    if (!d) return 'Not set';
    return day(new Date(d.getTime() + (n || 0) * 864e5).toISOString());
  }

  /* The UTC instant of a Manila calendar day, as an ISO string. */
  function manilaDayStart(dayStr) {
    // Manila is UTC+8 with no daylight saving, so the offset is fixed.
    return new Date(new Date(dayStr + 'T00:00:00+08:00').toISOString());
  }

  global.Time = {
    TZ: TZ,
    fmt: fmt,
    date: date,
    day: day,
    ago: ago,
    inputValue: inputValue,
    todayPlus: todayPlus,
    dayPlus: dayPlus,
    manilaDayStart: manilaDayStart,
    toDate: toDate
  };
})(window);
