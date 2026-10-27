/* script_order_check.js -- verify that every page loads scripts in the right order. */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var PUB = ROOT;

/*
  Required order for pages that use the full stack:
  1. js/store.js
  2. js/flow.js       (uses Store)
  3. js/api.js        (uses Store, Flow, Maint)
  4. js/permissions.js (must be before ui.js reads PermissionMap)
  5. js/time.js        (must be before ui.js calls Time)
  6. js/ui.js          (uses Store, Flow, Time, PermissionMap)
  7. js/query.js (optional, uses Store)
  8. js/actions.js (optional, uses Store, Flow, UI)
  9. js/live.js        (uses Store, UI, Flow, Maint)
  10. page <script> block
  11. js/pwa.js (last)

  Note: api.js, query.js, actions.js are optional for some pages.
  But the ORDER of what IS included must follow this sequence.
*/

var REQUIRED_ORDER = [
  'js/store.js',
  'js/flow.js',
  'js/api.js',          // optional
  'js/permissions.js',
  'js/time.js',
  'js/ui.js',
  'js/query.js',        // optional
  'js/actions.js',      // optional
  'js/live.js',
  // page script block is here
  'js/pwa.js'
];

var files = fs.readdirSync(PUB).filter(function(f){ return f.endsWith('.html'); });
var issues = [];
var PASS = 0, FAIL = 0;

files.forEach(function(f) {
  if (f === 'login.html' || f === '404.html' || f === 'offline.html' || f === 'index.html') {
    // these pages use minimal scripts
    return;
  }
  
  var src = fs.readFileSync(path.join(PUB, f), 'utf8');
  
  // Extract script srcs in order they appear
  var scriptRe = /src="(js\/[^"]+)"/g;
  var order = [];
  var m;
  while ((m = scriptRe.exec(src)) !== null) {
    order.push(m[1]);
  }
  
  if (order.length === 0) return; // no scripts, skip
  
  // Check that included scripts appear in the right relative order
  // Filter REQUIRED_ORDER to only those actually present on the page
  var pageOrder = REQUIRED_ORDER.filter(function(s) { return order.indexOf(s) > -1; });
  var actualOrder = order.filter(function(s) { return REQUIRED_ORDER.indexOf(s) > -1; });
  
  // Compare
  var ok = JSON.stringify(pageOrder) === JSON.stringify(actualOrder);
  if (ok) { PASS++; }
  else {
    FAIL++;
    issues.push({
      file: f,
      expected: pageOrder.join(', '),
      actual: actualOrder.join(', ')
    });
  }
  
  // Also check: permissions.js must be before ui.js
  var permIdx = order.indexOf('js/permissions.js');
  var uiIdx = order.indexOf('js/ui.js');
  var timeIdx = order.indexOf('js/time.js');
  
  if (uiIdx > -1) {
    if (permIdx === -1) {
      FAIL++;
      issues.push({ file: f, problem: 'ui.js loaded but permissions.js is missing' });
    } else if (permIdx > uiIdx) {
      FAIL++;
      issues.push({ file: f, problem: 'permissions.js loaded AFTER ui.js (pos '+permIdx+' vs '+uiIdx+')' });
    }
    if (timeIdx === -1) {
      FAIL++;
      issues.push({ file: f, problem: 'ui.js loaded but time.js is missing' });
    } else if (timeIdx > uiIdx) {
      FAIL++;
      issues.push({ file: f, problem: 'time.js loaded AFTER ui.js (pos '+timeIdx+' vs '+uiIdx+')' });
    }
  }
});

console.log('Checked ' + files.length + ' HTML files for script load order');
if (issues.length > 0) {
  console.log('\nISSUES FOUND:');
  issues.forEach(function(i) {
    console.log('  FILE: ' + i.file);
    if (i.problem) {
      console.log('    PROBLEM: ' + i.problem);
    } else {
      console.log('    EXPECTED: ' + i.expected);
      console.log('    ACTUAL:   ' + i.actual);
    }
  });
} else {
  console.log('Script load order: PASS');
}
console.log('\nRESULT: ' + PASS + ' passed, ' + FAIL + ' failed (including dependency checks)');
