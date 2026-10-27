/* root_vs_public_check.js -- verify root HTML files and public/ copies are consistent for key bugs. */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var BUG_PATTERN = '"" class=';

// Files that were fixed in both root and public/
var KEY_FILES = ['ticket.html', 'or-ticket.html', 'ic-ticket.html', 'itc-ticket.html', 'mgmt-ticket.html',
                 'technician.html', 'itc-technician.html', 'profile.html', 'or-profile.html',
                 'ic-profile.html', 'itc-profile.html', 'mgmt-profile.html'];

var PASS = 0, FAIL = 0;

KEY_FILES.forEach(function(f) {
  var rootPath = path.join(ROOT, f);
  var pubPath = path.join(ROOT, 'public', f);
  
  var rootExists = fs.existsSync(rootPath);
  var pubExists = fs.existsSync(pubPath);
  
  if (!rootExists) {
    console.log('INFO: ' + f + ' not at root (may be generated into public/ only)');
    // Check public/
    if (!pubExists) {
      FAIL++; console.log('FAIL: ' + f + ' missing from public/');
    } else {
      var pubSrc = fs.readFileSync(pubPath, 'utf8');
      if (pubSrc.indexOf(BUG_PATTERN) > -1) {
        FAIL++; console.log('FAIL: ' + f + ' in public/ still has the broken attribute');
      } else {
        PASS++; console.log('PASS: ' + f + ' in public/ is clean');
      }
    }
    return;
  }
  
  var rootSrc = fs.readFileSync(rootPath, 'utf8');
  var rootBug = rootSrc.indexOf(BUG_PATTERN) > -1;
  
  if (pubExists) {
    var pubSrc = fs.readFileSync(pubPath, 'utf8');
    var pubBug = pubSrc.indexOf(BUG_PATTERN) > -1;
    if (rootBug || pubBug) {
      FAIL++;
      console.log('FAIL: ' + f + ' -- root:' + (rootBug?'BUG':'ok') + ' public:' + (pubBug?'BUG':'ok'));
    } else {
      PASS++;
    }
  } else if (rootBug) {
    FAIL++; console.log('FAIL: ' + f + ' at root has the bug');
  } else {
    PASS++;
  }
});

// Check label-for fixes in profile pages
var LABEL_FILES = ['profile.html', 'or-profile.html', 'ic-profile.html', 'itc-profile.html', 'mgmt-profile.html'];
var LABEL_FIX = 'for="pEmail"';

LABEL_FILES.forEach(function(f) {
  var pubPath = path.join(ROOT, 'public', f);
  if (!fs.existsSync(pubPath)) { FAIL++; console.log('FAIL: ' + f + ' missing'); return; }
  var src = fs.readFileSync(pubPath, 'utf8');
  if (src.indexOf(LABEL_FIX) > -1) { PASS++; }
  else { FAIL++; console.log('FAIL: ' + f + ' missing label for="pEmail"'); }
});

console.log('\nRESULT: ' + PASS + ' passed, ' + FAIL + ' failed');
if (FAIL === 0) console.log('All key files clean: PASS');
