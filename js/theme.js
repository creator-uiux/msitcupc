/* theme.js: apply the colour theme before the first paint.
 *
 * Loaded in <head>, after the inline pre-paint snippet, so the choice is
 * applied before anything renders and there is never a flash of the wrong
 * theme.  Three choices are supported:
 *
 *   light    data-theme="light"
 *   dark     data-theme="dark"
 *   system   no data-theme attribute, so the prefers-color-scheme media query
 *            in css/app.css decides
 *
 * System is the default.  The browser color-scheme and the theme-color meta
 * tag are kept in step so form controls, scrollbars and the browser chrome
 * follow the theme.
 */
(function () {
  'use strict';
  var KEY = 'itc_theme';
  var DARK = '#0B1220';
  var LIGHT = '#1E3A5F';

  function read() {
    var m = /[?&]theme=(dark|light|system)\b/.exec(location.search);
    if (m) return m[1];
    try {
      var v = localStorage.getItem(KEY);
      if (v === 'dark' || v === 'light' || v === 'system') return v;
    } catch (e) { /* private mode */ }
    return 'system';
  }

  function apply(choice) {
    var t = choice || read();
    if (t !== 'dark' && t !== 'light') t = 'system';
    var el = document.documentElement;
    if (t === 'dark') el.setAttribute('data-theme', 'dark');
    else if (t === 'light') el.setAttribute('data-theme', 'light');
    else el.removeAttribute('data-theme');
    el.style.colorScheme = t === 'dark' ? 'dark' : t === 'light' ? 'light' : 'light dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? DARK : LIGHT);
    try { localStorage.setItem(KEY, t); } catch (e) { /* quota */ }
    return t;
  }

  /* ---------- table density ----------
     Comfortable is the default; compact tightens the long registers so more
     rows fit on one screen.  The choice is set before first paint, like the
     theme, so a saved compact view never flashes the roomy layout. */
  var DENSITY_KEY = 'itc_density';

  function readDensity() {
    try {
      return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
    } catch (e) { return 'comfortable'; }
  }

  function applyDensity(choice) {
    var d = choice === 'compact' ? 'compact' : 'comfortable';
    document.documentElement.setAttribute('data-density', d);
    try { localStorage.setItem(DENSITY_KEY, d); } catch (e) { /* quota */ }
    return d;
  }

  /* The theme that is actually on screen.  The saved choice may be "system",
     and the sheet paints that with the light palette, so a switch has to
     report what is really applied rather than the name of the choice. */
  function resolved() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  window.Theme = {
    apply: apply,
    current: function () { return read(); },
    resolved: resolved,
    density: readDensity,
    applyDensity: applyDensity
  };
  apply();
  applyDensity();
})();
