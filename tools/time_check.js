/* time_check.js -- every timestamp must display in Asia/Manila.
 *
 * Run twice: once with the host timezone and once with a far-away one.  The
 * rendered output must be identical, because the helper pins the zone rather
 * than using the browser's timezone.
 *
 *   node tools/time_check.js
 *   TZ=America/New_York node tools/time_check.js
 */
'use strict';

var path = require('path');
var fs = require('fs');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var src = fs.readFileSync(path.join(ROOT, 'js', 'time.js'), 'utf8');

var sandbox = { window: {}, Intl: Intl, Date: Date, console: console };
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
var Time = sandbox.window.Time;

var failures = [];
function check(name, got, want) {
  if (got !== want) {
    failures.push(name + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
    console.log('  FAIL  ' + name + ' -> ' + JSON.stringify(got));
  } else {
    console.log('  ok    ' + name + ' -> ' + JSON.stringify(got));
  }
}

/* 2026-10-08 06:05:00Z is 2026-10-08 2:05 pm in Asia/Manila (UTC+8). */
var instant = '2026-10-08T06:05:00.000Z';

check('zone is Asia/Manila', Time.TZ, 'Asia/Manila');
check('timestamp formats as MMM d, yyyy h:mm a', Time.fmt(instant), 'Oct 8, 2026 2:05 pm');
check('date part formats as MMM d, yyyy', Time.date(instant), 'Oct 8, 2026');
check('calendar day is the Manila day', Time.day(instant), '2026-10-08');

/* 2026-10-08 20:30:00Z is already 2026-10-09 4:30 am in Manila, so the
   calendar day must roll over even though the UTC day has not. */
var lateInstant = '2026-10-08T20:30:00.000Z';
check('late UTC rolls to the next Manila day', Time.day(lateInstant), '2026-10-09');
check('late UTC renders in Manila', Time.fmt(lateInstant), 'Oct 9, 2026 4:30 am');

/* 2026-10-08 17:00:00Z is 2026-10-09 1:00 am in Manila. */
check('evening UTC is already tomorrow in Manila', Time.fmt('2026-10-08T17:00:00.000Z'), 'Oct 9, 2026 1:00 am');

check('empty timestamp is a dash', Time.fmt(null), ' -- ');
check('garbage timestamp is a dash', Time.fmt('not-a-date'), ' -- ');

/* todayPlus must land on the Manila calendar day. */
var tp = Time.todayPlus(7);
check('todayPlus returns an ISO calendar day', /^\d{4}-\d{2}-\d{2}$/.test(tp), true);
check('todayPlus is seven days out', (function () {
  var a = new Date(tp + 'T00:00:00Z');
  var b = new Date();
  var delta = Math.round((a - Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) / 864e5);
  return delta;
})(), 7);

console.log('\nhost timezone: ' + (process.env.TZ || '(system default)'));
if (failures.length) {
  console.log('\nASIA/MANILA DISPLAY: FAIL');
  failures.forEach(function (f) { console.log('  - ' + f); });
  process.exit(1);
}
console.log('\nASIA/MANILA DISPLAY: PASS');
