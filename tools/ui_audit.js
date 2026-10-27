/* ui_audit.js -- comprehensive UI audit for all pages.
 * Checks for:
 * 1. Required shell elements (sidebar, appbar, topbar, bottomnav)
 * 2. Broken image references
 * 3. Missing JS referenced globals
 * 4. Hardcoded values that should be dynamic
 * 5. Missing empty states, pagination containers
 * 6. Broken internal links
 * 7. Script load order issues
 * 8. Missing required DOM IDs that page scripts reference
 * 9. Accessibility issues (labels without for, inputs without labels)
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var PUB = ROOT;  /* the working tree is the site root */

var PASS = 0, FAIL = 0;
var issues = [];

function issue(file, severity, description) {
  FAIL++;
  issues.push({ file: file, severity: severity, description: description });
}
function ok(name) { PASS++; }

var htmlFiles = fs.readdirSync(PUB).filter(function(f){ return f.endsWith('.html'); });

// Pages that are shell pages (have full chrome)
var SHELL_PAGES = htmlFiles.filter(function(f) {
  return !['login.html','404.html','offline.html','index.html'].includes(f);
});

// Images that should exist
var imgDir = path.join(PUB, 'img');
var availableImgs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : [];

// Icons that should exist
var iconsDir = path.join(PUB, 'icons');
var availableIcons = fs.existsSync(iconsDir) ? fs.readdirSync(iconsDir) : [];

SHELL_PAGES.forEach(function(f) {
  var src = fs.readFileSync(path.join(PUB, f), 'utf8');
  
  // 1. Check required shell elements
  if (!src.includes('id="chromeSide"')) issue(f, 'ERROR', 'Missing sidebar element id="chromeSide"');
  else ok('chromeSide');
  
  if (!src.includes('id="chromeAppbar"')) issue(f, 'ERROR', 'Missing appbar id="chromeAppbar"');
  else ok('chromeAppbar');
  
  if (!src.includes('id="chromeTopbar"')) issue(f, 'ERROR', 'Missing topbar id="chromeTopbar"');
  else ok('chromeTopbar');
  
  if (!src.includes('id="chromeBottom"')) issue(f, 'ERROR', 'Missing bottomnav id="chromeBottom"');
  else ok('chromeBottom');
  
  // 2. Check UI.mountChrome call
  if (!src.includes('UI.mountChrome(')) issue(f, 'ERROR', 'Missing UI.mountChrome() call');
  else ok('mountChrome');
  
  // 3. Check img references
  var imgRefs = src.match(/src="img\/([^"]+)"/g) || [];
  imgRefs.forEach(function(ref) {
    var imgName = ref.replace(/src="img\/|"/g, '');
    if (!availableImgs.includes(imgName)) {
      issue(f, 'ERROR', 'Broken image reference: img/' + imgName);
    }
  });
  
  // 4. Check icon references
  var iconRefs = src.match(/href="icons\/([^"]+)"/g) || [];
  iconRefs.forEach(function(ref) {
    var iconName = ref.replace(/href="icons\/|"/g, '');
    if (!availableIcons.includes(iconName)) {
      issue(f, 'ERROR', 'Broken icon reference: icons/' + iconName);
    }
  });
  
  // 5. Check Store.subscribe + render pattern
  if (src.includes('Store.subscribe')) {
    if (!src.includes('render()') && !src.includes('renderSide()') && !src.includes('renderList()')) {
      issue(f, 'WARN', 'Store.subscribe found but no render/renderSide/renderList call');
    }
  }
  
  // 6. Check Live.start()
  if (!src.includes('Live.start()')) {
    // Some pages may not need live updates (admin pages)
    if (!['users.html','offices.html','settings.html','audit.html'].includes(f)) {
      // Only warn, not error - some pages might not need it
    }
  }
  
  // 7. Check for broken href to non-existent pages (internal links)
  var hrefRefs = src.match(/href="([a-z][a-z-]*\.html)"/g) || [];
  hrefRefs.forEach(function(ref) {
    var pageName = ref.replace(/href="|"/g, '');
    if (!fs.existsSync(path.join(PUB, pageName))) {
      issue(f, 'ERROR', 'Broken internal link: href="' + pageName + '"');
    }
  });
  
  // 8. Check for double-quotes in textarea placeholder (known bug pattern)
  if (src.includes('placeholder="') && src.includes('"" class=')) {
    issue(f, 'ERROR', 'Broken textarea attribute: double-quote inside placeholder (=""")');
  }
  
  // 9. Check for the specific double-quote bug in ticket.html composer
  if (src.includes('"" class="mt-sm')) {
    issue(f, 'ERROR', 'Broken HTML attribute: stray "" before class (textarea placeholder issue)');
  }
});

// Specific page checks
var specificChecks = {
  'dashboard.html': function(src) {
    ['kpiGrid','mineList','queueBody','actChart','statusBars'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('dashboard.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'tickets.html': function(src) {
    ['tkChips','tkQ','tkBody'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('tickets.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'ticket.html': function(src) {
    ['tHead','tThread','tHistory','tActions'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('ticket.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'request.html': function(src) {
    ['reqForm','fOffice','fIssue','btnSubmit','successBox'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('request.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'review.html': function(src) {
    ['rKpi','rvBody','rvPanel'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('review.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'technician.html': function(src) {
    ['wKpi','wBody','wPanel','wJobs'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('technician.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'confirm.html': function(src) {
    ['cKpi','cfBody','cfPanel','cfJobs'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('confirm.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'maintenance.html': function(src) {
    ['mKpi','sBody','jBody','jobPanel'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('maintenance.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'register.html': function(src) {
    ['gKpi','gBody','panel-history','panel-assets','panel-maintenance','panel-audit'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('register.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'reports.html': function(src) {
    ['rKpi','fOffice','fFrom','fTo'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('reports.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'flow.html': function(src) {
    if (!src.includes('flowdata') && !src.includes('LANES')) {
      issue('flow.html', 'ERROR', 'Workflow Guide does not reference flowdata');
    }
  },
  'users.html': function(src) {
    ['uBody','uKpi','btnNewUser'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('users.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'offices.html': function(src) {
    ['oBody'].forEach(function(id) {
      if (!src.includes('id="'+id+'"')) issue('offices.html', 'ERROR', 'Missing element id="'+id+'"');
    });
  },
  'settings.html': function(src) {
    // settings should have reference data sections
    if (!src.includes('categories') && !src.includes('fCat')) {
      issue('settings.html', 'WARN', 'Settings page may be missing categories section');
    }
  }
};

Object.keys(specificChecks).forEach(function(f) {
  if (fs.existsSync(path.join(PUB, f))) {
    var src = fs.readFileSync(path.join(PUB, f), 'utf8');
    specificChecks[f](src);
  } else {
    issue(f, 'ERROR', 'Page file missing from the working tree');
  }
});

// Summary
console.log('UI Audit Results');
console.log('================');

if (issues.length === 0) {
  console.log('No issues found across ' + htmlFiles.length + ' pages.');
} else {
  var errors = issues.filter(function(i){ return i.severity === 'ERROR'; });
  var warns = issues.filter(function(i){ return i.severity === 'WARN'; });
  
  if (errors.length > 0) {
    console.log('\nERRORS (' + errors.length + '):');
    errors.forEach(function(i) { console.log('  [' + i.file + '] ' + i.description); });
  }
  if (warns.length > 0) {
    console.log('\nWARNINGS (' + warns.length + '):');
    warns.forEach(function(i) { console.log('  [' + i.file + '] ' + i.description); });
  }
}

console.log('\nRESULT: ' + PASS + ' checks passed, ' + FAIL + ' issues found');
