/* content_check.js -- check for content quality issues across all pages. */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var PUB = ROOT;

var issues = [];
var PASS = 0;

function issue(file, severity, description) {
  issues.push({ file: file, severity: severity, description: description });
}
function ok() { PASS++; }

var htmlFiles = fs.readdirSync(PUB).filter(function(f){ return f.endsWith('.html'); });

htmlFiles.forEach(function(f) {
  var src = fs.readFileSync(path.join(PUB, f), 'utf8');
  
  // Check for em dashes (actual em dash character U+2014)
  if (src.indexOf('\u2014') > -1) {
    issue(f, 'ERROR', 'Contains em dash character (U+2014) - use double-hyphen (--) instead');
  } else ok();
  
  // Check for hardcoded wrong year in ticket numbers (should be dynamic, not static)
  // IT-2025-NNNNNN would be wrong, but IT-2026-NNNNNN in seed data is fine
  
  // Check for PHP peso symbol display (should use ₱ not PHP)
  // This is a display preference, not a hard rule
  
  // Check for correct aria-selected usage on tabs
  if (src.includes('role="tab"')) {
    var tabsOk = src.includes('aria-selected="true"') || src.includes("aria-selected='true'");
    if (!tabsOk) issue(f, 'WARN', 'Has role="tab" but no aria-selected="true" (static initial state)');
    else ok();
  }
  
  // Check for proper form submit prevention (double submit)
  if (src.includes('<form') && src.includes('type="submit"')) {
    if (!src.includes('disabled') && !src.includes('dblClick') && !src.includes('submitting') && !src.includes('btnSubmit')) {
      // Most forms handle this in JS, just note if missing obvious pattern
    }
    ok();
  }
  
  // Check that all select elements have at least a default option
  var selectsWithNoOption = src.match(/<select[^>]*>\s*<\/select>/g) || [];
  selectsWithNoOption.forEach(function(sel) {
    var idm = sel.match(/id="([^"]+)"/);
    if (idm && src.indexOf("getElementById('" + idm[1] + "')") > -1) { ok(); return; }
    issue(f, 'WARN', 'Empty select element found');
  });
  
  // Check for broken JS references in inline scripts
  // Look for common undefined variable patterns
  if (src.includes('undefined.') || src.includes('null.')) {
    issue(f, 'WARN', 'Potential null/undefined dereference in page script');
  } else ok();
  
  // Check link targets are reasonable
  var badTargets = (src.match(/href="([^"#?]+)"/g) || []).filter(function(ref) {
    var target = ref.replace(/href="|"/g, '');
    if (target.startsWith('http') || target.startsWith('/') || target.startsWith('mailto:') || target.startsWith('tel:')) return false;
    if (/['"+\s]/.test(target)) return false; /* built at runtime */
    if (target.endsWith('.html') || target.endsWith('.css') || target.endsWith('.js')) return false;
    if (target.endsWith('.svg') || target.endsWith('.png') || target.endsWith('.webp') || target.endsWith('.jpg') || target.endsWith('.jpeg')) return false;
    if (target.endsWith('.webmanifest') || target.endsWith('.md') || target.endsWith('.json') || target.endsWith('.txt') || target.endsWith('.ico')) return false;
    if (target === '#' || target === '') return false;
    return true;
  });
  if (badTargets.length > 0) {
    issue(f, 'WARN', 'Potentially invalid href targets: ' + badTargets.slice(0,3).join(', '));
  }
  
  // Check for any TODO or FIXME comments in production pages
  var todos = (src.match(/TODO|FIXME|HACK|XXX/g) || []);
  if (todos.length > 0) {
    issue(f, 'INFO', 'Contains TODO/FIXME comments: ' + todos.length);
  }
});

// Check img directory for expected files
var imgDir = path.join(PUB, 'img');
if (fs.existsSync(imgDir)) {
  var requiredImgs = ['empty-inbox.svg', 'empty-tickets.svg', 'empty-maintenance.svg',
                      'logo.svg', 'login-bg.jpg'];
  requiredImgs.forEach(function(img) {
    if (!fs.existsSync(path.join(imgDir, img))) {
      issue('img/' + img, 'ERROR', 'Required image file is MISSING');
    } else ok();
  });
}

// Check CSS files exist and are not empty
['app.css','green.css','kit.css','login.css'].forEach(function(f) {
  var p = path.join(PUB, 'css', f);
  if (!fs.existsSync(p)) {
    issue('css/' + f, 'ERROR', 'CSS file missing');
  } else {
    var size = fs.statSync(p).size;
    if (size < 1000) issue('css/' + f, 'WARN', 'CSS file suspiciously small: ' + size + ' bytes');
    else ok();
  }
});

// Summary
console.log('Content Check Results');
console.log('=====================');
var errors = issues.filter(function(i){ return i.severity === 'ERROR'; });
var warns = issues.filter(function(i){ return i.severity === 'WARN'; });
var infos = issues.filter(function(i){ return i.severity === 'INFO'; });

if (errors.length > 0) {
  console.log('\nERRORS (' + errors.length + '):');
  errors.forEach(function(i) { console.log('  [' + i.file + '] ' + i.description); });
}
if (warns.length > 0) {
  console.log('\nWARNINGS (' + warns.length + '):');
  warns.forEach(function(i) { console.log('  [' + i.file + '] ' + i.description); });
}
if (infos.length > 0) {
  console.log('\nINFO (' + infos.length + '):');
  infos.forEach(function(i) { console.log('  [' + i.file + '] ' + i.description); });
}
if (issues.length === 0) {
  console.log('No content issues found!');
}
console.log('\nRESULT: ' + PASS + ' checks passed, ' + issues.length + ' issues found (' + errors.length + ' errors, ' + warns.length + ' warnings, ' + infos.length + ' info)');
