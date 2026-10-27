/* deep_audit.js -- deep UI audit checking for broken JS patterns, missing elements, and functional issues. */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var PUB = ROOT;

var PASS = 0, FAIL = 0;
var issues = [];

function issue(file, severity, description) {
  FAIL++;
  issues.push({ file: file, severity: severity, description: description });
}
function ok() { PASS++; }

var htmlFiles = fs.readdirSync(PUB).filter(function(f) { return f.endsWith('.html'); });

// Check specifically for known broken patterns
htmlFiles.forEach(function(f) {
  var src = fs.readFileSync(path.join(PUB, f), 'utf8');
  
  // 1. Stray double-quotes in generated HTML (the specific bug we fixed)
  if (src.match(/"" class=/)) {
    issue(f, 'ERROR', 'Stray "" before class= attribute (broken HTML attribute)');
  } else ok();
  
  // 2. Labels without for attributes (accessibility) - count them
  var labelsWithoutFor = (src.match(/<label>(?!<\/label>)/g) || []).length;
  if (labelsWithoutFor > 0) {
    issue(f, 'WARN', labelsWithoutFor + ' label(s) without for attribute found');
  } else ok();
  
  // 3. Check for undefined function calls in inline scripts
  // Look for common undefined patterns that would cause runtime errors
  var inlineScript = (src.match(/<script>[\s\S]*?<\/script>/g) || []).join(' ');
  
  // Check for direct variable references to Admin without window prefix
  if (inlineScript.includes('Admin.') && !inlineScript.includes('window.Admin')) {
    issue(f, 'WARN', 'Uses Admin. without window.Admin check');
  } else ok();
  
  // 4. Check for broken href="#" with no handler - these are usually ok but flag standalone links
  
  // 5. Check for missing title on the HTML element (accessibility)
  if (!src.includes('<title>')) {
    issue(f, 'ERROR', 'Missing <title> element');
  } else ok();
  
  // 6. Check that main element exists
  if (src.includes('<div class="app">') && !src.includes('<main')) {
    issue(f, 'ERROR', 'Shell structure: no <main> element');
  } else ok();
  
  // 7. Check that pwa.js is loaded last
  var scripts = (src.match(/src="js\/[^"]+"/g) || []);
  if (scripts.length > 0) {
    var lastScript = scripts[scripts.length - 1];
    if (lastScript !== 'src="js/pwa.js"' && src.includes('pwa.js')) {
      issue(f, 'WARN', 'pwa.js is not the last script tag (currently: ' + lastScript + ')');
    } else ok();
  }
  
  // 8. Check for incomplete Store.subscribe - missing the function parameter
  if (src.includes('Store.subscribe()')) {
    issue(f, 'ERROR', 'Store.subscribe() called with no callback');
  } else ok();
  
  // 9. Check for Flow. calls (should be window.Flow or just Flow as a global)
  // Flow is a global set by flow.js so direct Flow.xxx calls are fine
  
  // 10. Check pagination containers match usage
  var renderPaginationCalls = (src.match(/UI\.renderPagination\(/g) || []).length;
  var paginationContainers = (src.match(/id="[^"]*[Pp]agination[^"]*"/g) || []).length;
  if (renderPaginationCalls > 0 && paginationContainers === 0) {
    issue(f, 'WARN', 'renderPagination called but no pagination container found');
  } else ok();
});

// Check specific page behaviors
var pageChecks = {
  'login.html': function(src) {
    if (!src.includes('googleBtn') && !src.includes('gaccounts')) {
      issue('login.html', 'ERROR', 'Missing Google sign-in button and account chooser');
    } else ok();
    if (!src.includes('data-fit="viewport"')) {
      issue('login.html', 'WARN', 'login.html should have data-fit="viewport" for responsive fit');
    } else ok();
  },
  '404.html': function(src) {
    if (!src.includes('404') && !src.includes('not found')) {
      issue('404.html', 'ERROR', 'No 404 message text found');
    } else ok();
  },
  'offline.html': function(src) {
    if (!src.includes('offline')) {
      issue('offline.html', 'ERROR', 'No offline message text found');
    } else ok();
    if (!src.includes('window.addEventListener') || !src.includes('online')) {
      issue('offline.html', 'WARN', 'No online event listener for auto-reconnect');
    } else ok();
  }
};

Object.keys(pageChecks).forEach(function(f) {
  if (fs.existsSync(path.join(PUB, f))) {
    var src = fs.readFileSync(path.join(PUB, f), 'utf8');
    pageChecks[f](src);
  } else {
    issue(f, 'ERROR', 'File missing from the repository root');
  }
});

// Check that js/query.js is included on pages that use Query.*
var queryPages = ['tickets.html', 'register.html', 'reports.html', 'offices.html', 'dashboard.html', 'review.html'];
queryPages.forEach(function(f) {
  if (fs.existsSync(path.join(PUB, f))) {
    var src = fs.readFileSync(path.join(PUB, f), 'utf8');
    if (src.includes('Query.') && !src.includes('js/query.js')) {
      issue(f, 'ERROR', 'Uses Query.* but does not load js/query.js');
    } else ok();
  }
});

// Check role-prefixed pages for correct prefix detection
var rolePrefixes = ['or-', 'itc-', 'ic-', 'mgmt-'];
rolePrefixes.forEach(function(prefix) {
  var pages = htmlFiles.filter(function(f) { return f.startsWith(prefix); });
  pages.forEach(function(f) {
    var src = fs.readFileSync(path.join(PUB, f), 'utf8');
    // Role page should have the ITC_URL_ROLE script
    if (!src.includes('ITC_URL_ROLE') && !src.includes('window.ITC_URL_ROLE')) {
      issue(f, 'ERROR', 'Missing ITC_URL_ROLE guard script');
    } else ok();
  });
});

// Summary
console.log('Deep UI Audit Results');
console.log('=====================');

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
if (issues.length === 0) {
  console.log('No issues found!');
}

console.log('\nRESULT: ' + PASS + ' checks passed, ' + issues.length + ' issues (' + errors.length + ' errors, ' + warns.length + ' warnings)');
