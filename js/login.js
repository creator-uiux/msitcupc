/* login.js -- the sign-in screen.
 *
 * Google Workspace sign-in is the production path.  The demo account list is
 * part of every build of this page: it does not depend on the host, the port
 * or a server flag, so the same file works on a different localhost port, a
 * static copy and Firebase Hosting.  The list is always labelled "Demo only".
 */
(function () {
  'use strict';

  var signedIn = document.getElementById('signedIn');
  var authBlock = document.getElementById('authBlock');
  var accessDenied = document.getElementById('accessDenied');
  var deniedMail = document.getElementById('deniedMail');
  var googleBtn = document.getElementById('googleBtn');
  var gsiHost = document.getElementById('gsiBtn');
  var loginErr = document.getElementById('loginError');
  var demoBlock = document.getElementById('demoBlock');
  var demoAccounts = document.getElementById('demoAccounts');
  var themeSwitch = document.getElementById('themeSwitch');

  var SERVER = window.ITC_SITE === true;
  var SESSION_KEY = 'itc_session';

  var metaClient = document.querySelector('meta[name="google-client-id"]');
  var GOOGLE_CLIENT_ID = UI.qs('google_client_id') ||
    (metaClient && metaClient.content) || window.ITC_GOOGLE_CLIENT_ID || '';

  function sessionToken() {
    try {
      var s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      return s && s.token ? s.token : null;
    } catch (e) { return null; }
  }

  function saveSession(data) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: data.token, user: data.user }));
    } catch (e) { /* private mode */ }
  }

  function dropSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  function showError(msg) {
    if (!loginErr) return;
    loginErr.textContent = msg || '';
    loginErr.hidden = !msg;
  }

  function clearError() { showError(''); }

  function landing(role) {
    var want = UI.qs('next');
    var page = 'dashboard.html';
    if (want && /^[a-z0-9-]+\.html$/i.test(want)) {
      var parsed = UI.parseUrlRole ? UI.parseUrlRole(want) : null;
      if (parsed && parsed.role === role && UI.can(parsed.page, role)) page = parsed.page;
      else if (!parsed && UI.can(want, role)) page = want;
    }
    return UI.urlFor(page, role);
  }

  function redirect(role) {
    window.location.assign(landing(role));
  }

  function acceptSession(data) {
    if (!data || !data.token || !data.user) {
      showError('The server did not return a usable session.');
      return;
    }
    saveSession(data);
    if (data.state) Store.adopt(data.state);
    Store.update(function (db) {
      db.role = data.user.role;
      db.auth = {
        name: data.user.name, email: data.user.email, role: data.user.role,
        office: data.user.office, signedInAt: Store.NOW()
      };
    });
    redirect(data.user.role);
  }

  function showDenied(email) {
    clearError();
    authBlock.hidden = true;
    signedIn.hidden = true;
    accessDenied.hidden = false;
    deniedMail.textContent = email ? 'Signed in as ' + email : '';
    var head = accessDenied.querySelector('h3');
    if (head) {
      head.setAttribute('tabindex', '-1');
      try { head.focus(); } catch (e) { /* ignore */ }
    }
  }

  function showAuth() {
    accessDenied.hidden = true;
    authBlock.hidden = false;
    clearError();
  }

  /* --------------------------------------------------------------- theme */
  function paintTheme() {
    if (!themeSwitch) return;
    var cur = (window.Theme && Theme.current) ? Theme.current() : 'system';
    Array.prototype.forEach.call(themeSwitch.querySelectorAll('[data-theme-choice]'), function (b) {
      var on = b.getAttribute('data-theme-choice') === cur;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  if (themeSwitch) {
    themeSwitch.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-theme-choice]') : null;
      if (!b) return;
      var choice = b.getAttribute('data-theme-choice');
      if (window.Theme && Theme.apply) Theme.apply(choice);
      paintTheme();
    });
  }
  paintTheme();

  /* --------------------------------------------------------------- demo */
  function renderDemo() {
    if (!demoAccounts) return;
    demoAccounts.innerHTML = UI.ROLE_ORDER.map(function (key) {
      var r = UI.ROLES[key];
      return '<li><button type="button" class="lp-demo-account" data-acct="' + key + '">' +
        '<span class="lp-avatar" style="background:' + r.accent + '" aria-hidden="true">' +
        UI.initials(r.name) + '</span>' +
        '<span class="lp-demo-text"><b>' + UI.esc(r.name) + '</b><i>' + UI.esc(r.email) + '</i></span>' +
        '<span class="lp-demo-role">' + UI.esc(r.short) + '</span></button></li>';
    }).join('');
  }

  function showDemo() {
    if (!demoBlock) return;
    demoBlock.hidden = false;
  }

  function openDemo() {
    showDemo();
    var first = demoAccounts && demoAccounts.querySelector('[data-acct]');
    if (first) {
      try { first.focus(); } catch (e) { /* ignore */ }
      if (first.scrollIntoView) first.scrollIntoView({ block: 'nearest' });
    }
  }

  function authRole(res) {
    var r = UI.ROLES[res.role] || { title: res.role, short: res.role };
    return r;
  }

  function postJSON(path, body) {
    var x = new XMLHttpRequest();
    try { x.open('POST', path, false); } catch (e) { return { status: 0, data: null }; }
    x.setRequestHeader('Content-Type', 'application/json');
    try { x.send(JSON.stringify(body)); } catch (e) { return { status: 0, data: null }; }
    var data = null;
    try { data = JSON.parse(x.responseText); } catch (e) { data = null; }
    return { status: x.status, data: data };
  }

  function signInLocally(role) {
    UI.signIn(role);
    renderSignedIn();
    setTimeout(function () { redirect(role); }, 450);
  }

  function signInAs(role) {
    if (SERVER) {
      var res = postJSON('/api/login', { role: role });
      if (res.status === 200 && res.data && res.data.token) {
        acceptSession(res.data);
        return;
      }
      /* A hosted server can keep its demo gate closed.  The account list is
         part of the page anyway, so take the browser demo session instead of
         refusing the choice.  API calls still require a real server token. */
      if (res.status === 0 || (res.data && res.data.code === 'demo_disabled')) {
        UI.signIn(role);
        redirect(role);
        return;
      }
      showError((res.data && res.data.msg) || 'Demo sign-in was declined by the server.');
      return;
    }
    signInLocally(role);
  }

  if (demoAccounts) {
    demoAccounts.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-acct]') : null;
      if (!b) return;
      signInAs(b.getAttribute('data-acct'));
    });
  }

  /* ---------------------------------------------------------- signed in */
  function renderSignedIn() {
    var a = Store.db.auth;
    var valid = a && (!SERVER || sessionToken());
    if (!valid) {
      signedIn.hidden = true;
      signedIn.innerHTML = '';
      authBlock.hidden = false;
      accessDenied.hidden = true;
      return;
    }
    var r = authRole(a);
    signedIn.hidden = false;
    authBlock.hidden = true;
    accessDenied.hidden = true;
    signedIn.innerHTML =
      '<div class="lp-user">' +
        '<span class="lp-avatar" style="background:' + (UI.ROLES[a.role] || {}).accent + '" aria-hidden="true">' +
          UI.initials(a.name) + '</span>' +
        '<span class="lp-user-text"><b>' + UI.esc(a.name) + '</b><i>' + UI.esc(a.email) + '</i></span>' +
        '<span class="lp-user-role">' + UI.esc(r.short || r.title) + '</span>' +
      '</div>' +
      '<a class="lp-upm lp-upm-small" href="' + landing(a.role) + '">Continue to dashboard</a>' +
      '<button type="button" class="lp-link" data-use-other>Use another account</button>';
    var other = signedIn.querySelector('[data-use-other]');
    if (other) other.addEventListener('click', function () {
      UI.signOut();
      dropSession();
      renderSignedIn();
      focusLogin();
    });
  }

  function focusLogin() {
    if (googleBtn) {
      try { googleBtn.focus(); } catch (e) { /* ignore */ }
    }
  }

  /* -------------------------------------------------------- Google OIDC */
  function claimEmail(credential) {
    try {
      var part = credential.split('.')[1];
      var json = decodeURIComponent(Array.prototype.map.call(atob(part.replace(/-/g, '+').replace(/_/g, '/')),
        function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join(''));
      return (JSON.parse(json).email || '').toLowerCase();
    } catch (e) { return ''; }
  }

  function onCredential(response) {
    if (!response || !response.credential) return;
    clearError();
    var res = postJSON('/api/login', { credential: response.credential });
    if (res.status === 200 && res.data && res.data.token) {
      acceptSession(res.data);
      return;
    }
    if (res.data && (res.data.code === 'not_provisioned' || res.status === 403)) {
      showDenied(claimEmail(response.credential));
      return;
    }
    showError((res.data && res.data.msg) || 'Google sign-in was declined by the server.');
  }

  var REAL_OIDC = false;

  function setupGoogleIdentity() {
    if (!GOOGLE_CLIENT_ID) return;
    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = function () {
      if (!window.google || !google.accounts) {
        showError('Google sign-in could not load. Check the network and try again.');
        return;
      }
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      REAL_OIDC = true;
      if (gsiHost) {
        var action = googleBtn ? googleBtn.parentNode : gsiHost.parentNode;
        var width = Math.max(200, Math.min(320, (action && action.clientWidth) || 280));
        gsiHost.hidden = false;
        google.accounts.id.renderButton(gsiHost, {
          type: 'standard', theme: 'outline', size: 'large',
          text: 'signin_with', shape: 'pill', width: width
        });
      }
    };
    script.onerror = function () {
      showError('Could not reach Google sign-in. Check the network and try again.');
    };
    document.head.appendChild(script);
  }

  if (googleBtn) {
    googleBtn.addEventListener('click', function () {
      if (REAL_OIDC && window.google && google.accounts) {
        try { google.accounts.id.prompt(); } catch (e) { /* the overlay handles it */ }
        return;
      }
      showError('UPMail sign-in is not configured on this server. Use a demo account below.');
      openDemo();
    });
  }

  var tryAnother = document.getElementById('tryAnother');
  if (tryAnother) {
    tryAnother.addEventListener('click', function () {
      try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
      UI.signOut();
      dropSession();
      showAuth();
      renderSignedIn();
      focusLogin();
    });
  }

  if (UI.qs('out') || UI.qs('signout')) {
    UI.signOut();
    dropSession();
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) { /* ignore */ }
  }

  /* A server page with no bearer session must not keep a stale local demo
     identity around.  The server session is the only authority there. */
  if (SERVER && !sessionToken() && Store.db.auth) {
    UI.signOut();
  }

  renderDemo();
  showDemo();
  renderSignedIn();
  setupGoogleIdentity();

  window.LoginPage = {
    refresh: renderSignedIn,
    renderDemo: renderDemo,
    openDemo: openDemo
  };
})();
