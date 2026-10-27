/* Quick permission parity check using Node.js only (no Python needed). */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var perm = JSON.parse(fs.readFileSync(path.join(ROOT, 'permissions.json'), 'utf8'));
var permjs = fs.readFileSync(path.join(ROOT, 'js', 'permissions.js'), 'utf8');

var PASS = 0, FAIL = 0;

function check(name, cond, detail) {
  if (cond) { PASS++; } else { FAIL++; console.log('FAIL: ' + name + (detail ? ' - ' + detail : '')); }
}

// All action keys present
var actionsFromJson = Object.keys(perm.actions).sort();
actionsFromJson.forEach(function(a) {
  check('action present: ' + a, permjs.indexOf('"' + a + '"') >= 0);
});

// All roles present
perm.roles.forEach(function(r) {
  check('role present: ' + r, permjs.indexOf('"' + r + '"') >= 0);
});

// All transition statuses present
Object.keys(perm.transitions).forEach(function(s) {
  check('transition status: ' + s, permjs.indexOf('"' + s + '"') >= 0);
});

console.log('');
console.log('RESULT: ' + PASS + ' passed, ' + FAIL + ' failed');
if (FAIL === 0) console.log('Permission parity: PASS');
