/* html_check.js -- basic HTML validation for every page in the working tree. */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PUB = ROOT;  /* the working tree is the site root */

var files = fs.readdirSync(PUB).filter(function(f) { return f.endsWith('.html'); });
var issues = [];
var PASS = 0, FAIL = 0;

function check(name, cond, detail) {
  if (cond) { PASS++; } else { FAIL++; issues.push(name + (detail ? ': ' + detail : '')); }
}

files.forEach(function(f) {
  var src = fs.readFileSync(path.join(PUB, f), 'utf8');
  
  // Three stylesheets in order
  var aIdx = src.indexOf('app.css');
  var gIdx = src.indexOf('green.css');
  var kIdx = src.indexOf('kit.css');
  if (aIdx > -1 && gIdx > -1 && kIdx > -1) {
    check(f + ' stylesheet order', aIdx < gIdx && gIdx < kIdx);
  }
  
  // No inline style blocks
  check(f + ' no inline style block', src.indexOf('<style') < 0 || f === 'login.html', 'has <style>');
  
  // Has lang attribute on html
  check(f + ' html lang', src.indexOf('<html lang="en">') > -1 || src.indexOf('<html lang=') > -1);
  
  // Has meta viewport
  check(f + ' meta viewport', src.indexOf('name="viewport"') > -1);
  
  // Has charset
  check(f + ' charset', src.indexOf('charset="utf-8"') > -1 || src.indexOf("charset='utf-8'") > -1);
});

console.log('Checked ' + files.length + ' HTML files (' + (files.length * 5) + ' assertions)');
if (FAIL > 0) {
  console.log('FAIL: ' + FAIL + ' issues:');
  issues.slice(0, 20).forEach(function(i) { console.log('  ' + i); });
} else {
  console.log('HTML markup check: PASS');
}
console.log('RESULT: ' + PASS + ' passed, ' + FAIL + ' failed');
