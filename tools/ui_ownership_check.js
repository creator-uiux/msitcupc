/* UI ownership check: every screen says which lane it belongs to.

   `permissions.json` answers "may this role open this page" and "may this role
   run this action".  This tool asks the matching questions of the UI as it
   stands, and prints the two tables the owner asked for:

     1. per lane: the pages the map opens, the lane page files that exist, the
        nav entries and mobile bar it is offered, its home page, and whether
        every screen it is entitled to is actually reachable;
     2. the UI that does not belong: a file no lane may open, a link that paints
        for a lane the map denies, a nav entry outside its lane, a control wired
        to an action the map does not have, a control with no handler, a handler
        no screen offers, and an action a lane holds that appears nowhere.

   The assertable surface is what paints.  A link in markup paints for everyone
   who opens the page, unless a role gate covers it: the CSS regions
   (`body.role-x .staff-only` and friends, read from css/console.css rather than
   assumed) and the anchors a script hides or re-points by id.  Both are
   understood here, so a gated card is not mistaken for an open door.  A link
   assembled inside a script is gated by the code that assembles it; that gate
   runs live in tools/rolepages_test.js and tools/pagetest.js, so this tool
   counts those strings for reachability and leaves their enforcement to the
   suites that click them.

   Run:  node tools\ui_ownership_check.js
*/
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

var PERM = JSON.parse(read('permissions.json'));
var ROLES = PERM.roles;
var PREFIX = { requester: 'or', technician: 'itc', coordinator: 'ic', management: 'mgmt' };
var LANE = {
  requester: 'Office Requester', technician: 'IT Technician',
  coordinator: 'IT Coordinator', management: 'System Administrator'
};
/* Chrome no lane owns: the entry, the sign in page and the two fallbacks.
   tools/role_pages.py keeps the same list for the generated files. */
var NO_ROLE = ['login.html', '404.html', 'index.html', 'offline.html'];

var problems = [];
function bad(text) { problems.push(text); }

/* camelCase browser method -> snake_case map action, as canMethod does it */
function methodKey(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
function pageOf(href) {
  return String(href).split('?')[0].split('#')[0];
}
function openTo(role, page) {
  return (PERM.pages[page] || []).indexOf(role) > -1;
}

var FILES = fs.readdirSync(ROOT).filter(function (f) { return /\.html$/.test(f); });

/* ---------- 1. every file answers "which lane is this?" ---------- */

function classify(file) {
  if (NO_ROLE.indexOf(file) > -1) return { kind: 'public' };
  if (PERM.pages[file]) return { kind: 'base' };
  var m = /^(or|itc|ic|mgmt)-(.+\.html)$/.exec(file);
  if (m) {
    var role = Object.keys(PREFIX).filter(function (r) { return PREFIX[r] === m[1]; })[0];
    return {
      kind: 'role', role: role, base: m[2],
      granted: PERM.pages[m[2]] ? openTo(role, m[2]) : false
    };
  }
  return { kind: 'unknown' };
}

var owned = { base: 0, role: 0, public: 0 };
FILES.forEach(function (f) {
  var c = classify(f);
  if (c.kind === 'unknown') {
    bad('no lane may open ' + f + ': it is neither a page in the permission map, ' +
        'a lane copy of one, nor shared chrome');
    return;
  }
  owned[c.kind]++;
  if (c.kind === 'role' && !c.granted) {
    bad(f + ' is drawn for the ' + LANE[c.role] + ' lane, but the map does not open ' +
        c.base + ' to that role');
  }
});

ROLES.forEach(function (role) {
  Object.keys(PERM.pages).forEach(function (page) {
    if (!openTo(role, page) || NO_ROLE.indexOf(page) > -1) return;
    if (FILES.indexOf(PREFIX[role] + '-' + page) < 0) {
      bad('the map opens ' + page + ' to the ' + LANE[role] + ' lane, but ' +
          PREFIX[role] + '-' + page + ' does not exist');
    }
  });
});
Object.keys(PERM.pages).forEach(function (page) {
  if (!PERM.pages[page].length) bad(page + ' is in the permission map with no role at all');
});

/* ---------- 2. the role gates that cover a screen ---------- */

/* Read the gate classes from the sheet that defines them rather than from a
   list kept here, so a new gate is understood the moment it is written. */
var GATES = (function () {
  var css = read('css/console.css').replace(/\/\*[\s\S]*?\*\//g, '');
  var raw = {};
  var rule, re = /([^{}]+)\{([^{}]*)\}/g;
  while ((rule = re.exec(css))) {
    if (!/display:\s*none\s*!important/.test(rule[2])) continue;
    rule[1].split(',').forEach(function (sel) {
      var one = /^body:not\(\.role-(\w+)\)\s+\.([a-z][\w-]*)$/.exec(sel.trim());
      var hid = /^body\.role-(\w+)\s+\.([a-z][\w-]*)$/.exec(sel.trim());
      if (one) (raw[one[2]] = raw[one[2]] || { only: {}, hide: {} }).only[one[1]] = true;
      if (hid) (raw[hid[2]] = raw[hid[2]] || { only: {}, hide: {} }).hide[hid[1]] = true;
    });
  }
  var out = {};
  Object.keys(raw).forEach(function (cls) {
    var g = raw[cls];
    out[cls] = ROLES.filter(function (r) {
      if (Object.keys(g.only).length) return !!g.only[r];
      return !g.hide[r];
    });
  });
  return out;
})();

var VOID = { input: 1, img: 1, br: 1, hr: 1, meta: 1, link: 1, source: 1, track: 1,
  area: 1, col: 1, wbr: 1, path: 1, circle: 1, rect: 1, line: 1, polyline: 1,
  polygon: 1, ellipse: 1, use: 1, stop: 1 };

function markupOnly(src) {
  return src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
}
function scriptOnly(src) {
  return (src.match(/<script[\s\S]*?<\/script>/g) || []).join('\n');
}

/* Every anchor in markup, with the lanes that can actually see it: the gate
   classes on the anchor or any open ancestor, and the ids a script touches. */
function markupLinks(file) {
  var src = read(file);
  var body = markupOnly(src);
  var code = scriptOnly(src);
  var out = [];
  var stack = [];
  var re = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
  var token;
  while ((token = re.exec(body))) {
    var tag = token[2].toLowerCase();
    var attrs = token[3] || '';
    if (token[1] === '/') {
      for (var i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    var cls = (attrs.match(/class="([^"]*)"/) || [, ''])[1].split(/\s+/).filter(Boolean);
    var id = (/\bid="([^"]+)"/.exec(attrs) || [, ''])[1];
    if (tag === 'a') {
      var href = (/\bhref="([^"]+)"/.exec(attrs) || [, ''])[1];
      if (/\.html/.test(href)) {
        var viewers = ROLES.slice();
        stack.concat([{ tag: tag, cls: cls, id: id }]).forEach(function (node) {
          node.cls.forEach(function (c) {
            if (GATES[c]) viewers = viewers.filter(function (r) { return GATES[c].indexOf(r) > -1; });
          });
        });
        var gatedByCode = !!id && new RegExp(
          "getElementById\\('" + id + "'\\)[^;]{0,160}(\\.hidden|\\.href|\\.remove\\(|\\.outerHTML|display)"
        ).test(code);
        out.push({ page: pageOf(href), viewers: viewers, codeGated: gatedByCode });
      }
    }
    if (!VOID[tag] && !/\/>$/.test(attrs)) stack.push({ tag: tag, cls: cls, id: id });
  }
  return out;
}

var LINKS = {};
function laneFile(role, page) {
  var want = PREFIX[role] + '-' + page;
  return FILES.indexOf(want) > -1 ? want : (FILES.indexOf(page) > -1 ? page : null);
}
FILES.forEach(function (f) { if (/\.html$/.test(f)) LINKS[f] = markupLinks(f); });

function scriptPages(file) {
  var code = scriptOnly(read(file));
  var found = {};
  (code.match(/'([a-z0-9_-]+\.html)/g) || []).forEach(function (s) {
    var p = s.slice(1);
    if (PERM.pages[p]) found[p] = true;
  });
  return Object.keys(found);
}

/* ---------- 3. the navigation each lane is offered ---------- */

function navBranches() {
  var src = read('js/ui.js');
  var from = src.indexOf('function navModel(role) {');
  var to = src.indexOf('function accountItems(role)', from);
  if (from < 0 || to < 0) { bad('navModel is not where this check expects it in js/ui.js'); return []; }
  var branches = [];
  var current = null;
  var claimed = [];
  var sawElse = false;
  src.slice(from, to).split('\n').forEach(function (line) {
    var open = /^\s*(?:\} else )?if \(role === '(\w+)'\) \{$/.exec(line);
    if (open) {
      if (claimed.indexOf(open[1]) > -1) bad('navModel branches on ' + open[1] + ' twice');
      current = { role: open[1], hrefs: [] };
      branches.push(current);
      claimed.push(open[1]);
      return;
    }
    if (/^\s*\} else \{$/.test(line)) {
      sawElse = true;
      var rest = ROLES.filter(function (r) { return claimed.indexOf(r) < 0; });
      if (rest.length !== 1) {
        bad('the last navModel branch must belong to exactly one lane, got ' + rest.join('/'));
        return;
      }
      current = { role: rest[0], hrefs: [] };
      branches.push(current);
      claimed.push(rest[0]);
      return;
    }
    /* the branch chain closes on its own line; what follows is shared chrome */
    if (/^\s{4}\}$/.test(line)) { current = null; return; }
    var href = /href: '([^']+)'/.exec(line);
    if (!href) return;
    if (!current) {
      current = { role: 'all', hrefs: [] };
      branches.push(current);
    }
    current.hrefs.push(href[1]);
  });
  if (!sawElse) bad('navModel has no final else branch, so one lane is offered no nav');
  ROLES.forEach(function (r) {
    if (claimed.indexOf(r) < 0) bad('navModel offers the ' + LANE[r] + ' lane no branch');
  });
  return branches;
}

var NAV = navBranches();
var navFor = {};
ROLES.forEach(function (r) { navFor[r] = []; });
NAV.forEach(function (b) {
  b.hrefs.forEach(function (h) {
    var page = pageOf(h);
    if (b.role === 'all') {
      /* a shared entry is filtered by pageOpen, so it paints only for the lanes
         the map opens; assert the page exists and that some lane may use it */
      if (!PERM.pages[page]) {
        bad('the shared nav offers ' + h + ' which the map does not have');
      } else if (!PERM.pages[page].length) {
        bad('the shared nav offers ' + h + ' which no lane may open');
      }
      return;
    }
    navFor[b.role].push(page);
    if (!PERM.pages[page]) {
      bad('the ' + LANE[b.role] + ' nav offers ' + h + ' which the map does not have');
    } else if (!openTo(b.role, page)) {
      bad('the ' + LANE[b.role] + ' nav offers ' + h + ', but pageOpen hides it from that lane, ' +
          'so the entry is dead text in the code');
    }
  });
});

function chromeHrefs(fn, stop) {
  var src = read('js/ui.js');
  var from = src.indexOf(fn);
  var to = src.indexOf(stop, from);
  if (from < 0 || to < 0) { bad(fn + ' is not where this check expects it in js/ui.js'); return []; }
  return (src.slice(from, to).match(/href: '([^']+)'/g) || [])
    .map(function (s) { return pageOf(/'([^']+)'/.exec(s)[1]); });
}
var ACCOUNT = chromeHrefs('function accountItems(role)', 'function bellHTML');
ACCOUNT.forEach(function (page) {
  if (!PERM.pages[page] && NO_ROLE.indexOf(page) < 0) {
    bad('the account sheet names ' + page + ' which the map does not have');
  }
});

function barFor(role) {
  var src = read('js/ui.js');
  var from = src.indexOf('function bottomItems(role) {');
  var block = /var map = \{([\s\S]*?)\n    \};/.exec(src.slice(from));
  if (from < 0 || !block) { bad('bottomItems is not where this check expects it in js/ui.js'); return []; }
  var body = block[1];
  var start = body.indexOf(role + ': [');
  if (start < 0) { bad('the mobile bar map names no lane for ' + LANE[role]); return []; }
  return (body.slice(start, body.indexOf(']', start)).match(/href: '([^']+)'/g) || [])
    .map(function (s) { return pageOf(/'([^']+)'/.exec(s)[1]); });
}
var BAR = {};
ROLES.forEach(function (role) {
  BAR[role] = barFor(role);
  BAR[role].forEach(function (page) {
    if (!PERM.pages[page]) {
      bad('the ' + LANE[role] + ' mobile bar names ' + page + ' which the map does not have');
    } else if (!openTo(role, page)) {
      bad('the ' + LANE[role] + ' mobile bar offers ' + page + ' which the map denies');
    }
  });
});

var HOME = {};
(function () {
  var block = /var HOME_PAGE = \{([^}]*)\}/.exec(read('js/ui.js'));
  if (!block) { bad('HOME_PAGE is not where this check expects it in js/ui.js'); return; }
  (block[1].match(/(\w+): '([^']+)'/g) || []).forEach(function (pair) {
    var kv = /(\w+): '([^']+)'/.exec(pair);
    HOME[kv[1]] = kv[2];
  });
})();
ROLES.forEach(function (role) {
  if (!HOME[role]) { bad('HOME_PAGE gives the ' + LANE[role] + ' lane no home'); return; }
  if (!openTo(role, HOME[role])) {
    bad('HOME_PAGE sends the ' + LANE[role] + ' lane to ' + HOME[role] + ', which the map denies it');
  }
});

/* ---------- 4. markup links, per lane ---------- */

var codeGatedLinks = 0;
ROLES.forEach(function (role) {
  Object.keys(PERM.pages).forEach(function (page) {
    /* the launcher is shared chrome: it links every lane's screens on purpose,
       so its own links are read for reachability, never as a lane's door */
    if (!openTo(role, page) || NO_ROLE.indexOf(page) > -1) return;
    var file = laneFile(role, page);
    if (!file) return;
    LINKS[file].forEach(function (link) {
      if (link.viewers.indexOf(role) < 0) return;
      if (link.codeGated) { codeGatedLinks++; return; }
      if (link.page === page || NO_ROLE.indexOf(link.page) > -1) return;
      if (!PERM.pages[link.page]) {
        bad(file + ' links to ' + link.page + ' which the map does not have');
      } else if (!openTo(role, link.page)) {
        bad(file + ' paints a link to ' + link.page + ' for the ' + LANE[role] +
            ' lane, which the map denies');
      }
    });
  });
});

/* ---------- 5. controls, handlers and the actions behind them ---------- */

var CLIENT_JS = fs.readdirSync(path.join(ROOT, 'js')).filter(function (f) { return /\.js$/.test(f); });
var SOURCES = {};
CLIENT_JS.forEach(function (f) { SOURCES['js/' + f] = read('js/' + f); });
FILES.forEach(function (f) { SOURCES[f] = read(f); });
var ALL_SRC = Object.keys(SOURCES).map(function (k) { return SOURCES[k]; });

var handlers = (read('js/actions.js').match(/case '([a-z]+)':/g) || [])
  .map(function (s) { return /'([a-z]+)'/.exec(s)[1]; });
/* Screens offer a control through the button helpers of the page, and those
   differ in argument order (btn(label, key, cls) against wbtn(key, label, cls)).
   A key counts as asked for when it is passed to one of those shapes: that
   direction is strict, because a control naming a key nobody handles is a dead
   button on a real screen.  The other direction is read loosely: a handler is
   alive if a screen's own code ever quotes that key, since several pages compute
   the key from the next status rather than writing it into the button. */
var askedKeys = {};
var aliveKeys = {};
Object.keys(SOURCES).forEach(function (rel) {
  /* only a screen offers a control, so the client modules are not read here */
  if (rel.indexOf('.html') < 0) return;
  var src = SOURCES[rel];
  (src.match(/\w*btn\([^)]*\)/g) || []).forEach(function (call) {
    (call.match(/'([a-z]+)'/g) || []).forEach(function (a) {
      askedKeys[a.replace(/'/g, '')] = true;
    });
  });
  (src.match(/data-act="([a-z]+)"/g) || []).forEach(function (s) {
    askedKeys[/data-act="([a-z]+)"/.exec(s)[1]] = true;
  });
  (src.match(/Actions\.act\(\s*'([a-z]+)'/g) || []).forEach(function (s) {
    askedKeys[/'([a-z]+)'/.exec(s)[1]] = true;
  });
  /* a page may compute the key from the record's next state, so a literal in a
     return offers the control just as a written one does */
  src.split(';').forEach(function (stmt) {
    if (!/\breturn\b/.test(stmt)) return;
    (stmt.match(/'([a-z]+)'/g) || []).forEach(function (k) {
      aliveKeys[k.replace(/'/g, '')] = true;
    });
  });
});
handlers.forEach(function (k) {
  if (!askedKeys[k] && !aliveKeys[k]) {
    bad('js/actions.js handles "' + k + '" but no screen asks for it or computes it, ' +
        'so the case is dead code behind a control nobody can reach');
  }
});
Object.keys(askedKeys).forEach(function (k) {
  if (handlers.indexOf(k) < 0) bad('a screen asks for the control "' + k + '" which js/actions.js does not handle');
});

var named_actions = {};
ALL_SRC.forEach(function (src) {
  (src.match(/canAct\(\s*'([A-Za-z_]+)'\s*\)/g) || []).forEach(function (s) {
    named_actions[methodKey(/'([A-Za-z_]+)'/.exec(s)[1])] = true;
  });
  (src.match(/m: \[[^\]]*\]/g) || []).forEach(function (row) {
    (row.match(/'[a-z_]+'/g) || []).forEach(function (n) { named_actions[n.replace(/'/g, '')] = true; });
  });
});
Object.keys(named_actions).forEach(function (action) {
  if (!PERM.actions[action]) {
    bad('a control or a capability row names ' + action + ', which the permission map does not have');
  }
});

var mentioned = {};
ALL_SRC.forEach(function (src) {
  Object.keys(PERM.actions).forEach(function (action) {
    if (mentioned[action]) return;
    if (src.indexOf(action) > -1 ||
        src.indexOf(action.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); })) > -1) {
      mentioned[action] = true;
    }
  });
});
ROLES.forEach(function (role) {
  Object.keys(PERM.actions).forEach(function (action) {
    if (PERM.actions[action].indexOf(role) < 0 || mentioned[action]) return;
    bad('the map grants ' + action + ' to the ' + LANE[role] +
        ' lane, but no screen or client module names it');
  });
});

/* ---------- 6. reachability: a lane can walk its own lane ---------- */

var SHARED_NAV = NAV.filter(function (b) { return b.role === 'all'; })
  .reduce(function (list, b) { return list.concat(b.hrefs.map(pageOf)); }, []);

ROLES.forEach(function (role) {
  var entitled = Object.keys(PERM.pages).filter(function (p) {
    return openTo(role, p) && NO_ROLE.indexOf(p) < 0;
  });
  var seen = {};
  var queue = [];
  var expanded = {};
  function add(page) {
    if (!page || seen[page] || !PERM.pages[page] || !openTo(role, page)) return;
    seen[page] = true;
    queue.push(page);
  }
  add(HOME[role]);
  add('index.html');
  navFor[role].forEach(add);
  SHARED_NAV.forEach(add);
  ACCOUNT.forEach(add);
  BAR[role].forEach(add);
  while (queue.length) {
    var page = queue.shift();
    if (expanded[page]) continue;
    expanded[page] = true;
    var file = laneFile(role, page);
    if (!file) continue;
    LINKS[file].forEach(function (link) {
      if (link.viewers.indexOf(role) > -1 && !link.codeGated) add(link.page);
    });
    /* script-built links are gated by the code that builds them, and the suites
       that click them prove it; here they only show that a screen is led to */
    scriptPages(file).forEach(add);
  }
  entitled.forEach(function (page) {
    if (seen[page]) return;
    bad('the ' + LANE[role] + ' lane may open ' + page +
        ', but no nav entry, bar entry, account entry or page link leads there');
  });
});

/* ---------- the tables ---------- */

console.log('## Table 1. Each lane, and whether its UI is there\n');
console.log('| Lane | Home | Pages the map opens | Lane page files | Nav | Mobile bar | Markup links checked |');
console.log('|---|---|---|---|---|---|---|');
var linkTotals = {};
ROLES.forEach(function (role) {
  var pages = Object.keys(PERM.pages).filter(function (p) { return openTo(role, p); });
  var lanePages = pages.filter(function (p) { return NO_ROLE.indexOf(p) < 0; });
  var missing = lanePages.filter(function (p) { return FILES.indexOf(PREFIX[role] + '-' + p) < 0; });
  var links = 0;
  lanePages.forEach(function (p) {
    var f = laneFile(role, p);
    if (f) links += LINKS[f].filter(function (l) { return l.viewers.indexOf(role) > -1; }).length;
  });
  linkTotals[role] = links;
  console.log('| ' + LANE[role] + ' | ' + (HOME[role] || '-') + ' | ' + pages.length + ' | ' +
    (lanePages.length - missing.length) + '/' + lanePages.length +
    (missing.length ? ' (missing ' + missing.join(', ') + ')' : '') + ' | ' +
    navFor[role].length + ' | ' + BAR[role].length + ' | ' + links + ' |');
});
console.log('');
ROLES.forEach(function (role) {
  var pages = Object.keys(PERM.pages).filter(function (p) { return openTo(role, p); }).sort();
  console.log('- **' + LANE[role] + '** (' + PREFIX[role] + '-): ' + pages.map(function (p) {
    if (NO_ROLE.indexOf(p) > -1) return p + ' (shared chrome)';
    return p + (FILES.indexOf(PREFIX[role] + '-' + p) > -1 ? '' : ' [NO FILE]');
  }).join(', '));
});

console.log('\n## Table 2. UI that does not belong\n');
console.log('| Finding |');
console.log('|---|');
if (!problems.length) {
  console.log('| none: every file, nav entry, bar entry, painted link, control and granted action ' +
              'resolves to a lane the map grants |');
} else {
  problems.forEach(function (p) { console.log('| ' + p + ' |'); });
}

console.log('\n- Files: %d html (%d chrome, %d base pages in the map, %d lane pages)'
  , FILES.length, owned.public, owned.base, owned.role);
console.log('- Map: %d pages, %d actions, %d lanes. Nav branches: %d. Action handlers: %d.',
  Object.keys(PERM.pages).length, Object.keys(PERM.actions).length, ROLES.length,
  NAV.length, handlers.length);
console.log('- Role gate classes read from css/console.css: %s',
  Object.keys(GATES).sort().join(', ') || 'none');
console.log('- %d painted links assert against the map, %d more are anchors a script hides or ' +
  're-points by id, and the link strings inside page scripts are gated by that code instead.',
  ROLES.reduce(function (n, r) { return n + linkTotals[r]; }, 0), codeGatedLinks);

if (problems.length) {
  console.log('\nUI OWNERSHIP: FAIL (' + problems.length + ')');
  problems.forEach(function (p) { console.log('  !! ' + p); });
  process.exit(1);
}
console.log('\nUI OWNERSHIP: PASS');
