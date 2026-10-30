/* store.js: data model, persistence, pub/sub. No framework. */
(function () {
  'use strict';
  var KEY = 'itc_db_v3', V = 3;
  var CH = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('itc_live') : null;
  var subs = [];

  /* ---------- deterministic demo mode ----------
     ?demo=1  ->  rebuild the canonical seed and freeze the clock so every
     screenshot / QA run renders byte-identical relative dates and state.
     The live simulation (random intake) is switched off at the source. */
  var REAL_NOW = Date.now;
  var DEMO = /[?&]demo=1\b/.test(location.search);
  var DEMO_ANCHOR = (function () {
    var m = /[?&]at=(\d{10,})/.exec(location.search);
    if (m) { var t = parseInt(m[1], 10); if (t > 1e12) return t; }
    return 1786550400000; /* 2026-08-13T08:00:00Z, screenshot anchor */
  })();
  if (DEMO) Date.now = function () { return DEMO_ANCHOR; };
  window.DEMO = DEMO;
  window.DEMO_AT = DEMO ? DEMO_ANCHOR : null;

  function NOW() { return new Date(Date.now()).toISOString(); } /* Date.now() is frozen in demo mode */
  function days(n) { return new Date(Date.now() + n * 864e5).toISOString(); }
  function hours(n) { return new Date(Date.now() + n * 36e5).toISOString(); }

  function seed() {
    var t = function (o) {
      o.v = 3;
      o.createdAt = o.createdAt || NOW();
      o.updatedAt = o.createdAt;
      o.history = o.history || [];
      o.tests = o.tests || [];
      o.reminders = [];
      o.comments = o.comments || [];
      o.diagnosis = o.diagnosis || { findings: '', actions: '', parts: '', cost: 0, labor: 0, dates: '', evidence: [] };
      o.confirmation = o.confirmation || { state: 'none', person: '', date: null, feedback: '' };
      o.dependency = o.dependency || null;
      o.linkedTo = o.linkedTo || null;
      o.cancelReason = null;
      o.closure = null;
      o.authorizedReason = '';
      o.withdrawal = null;
      o.recurring = false;
      o.reviewed = false;
      return o;
    };
    var out = {
      v: V, rev: 1, updatedAt: NOW(), seq: { ticket: 144, sched: 33, job: 62, notif: 40, hist: 500, asset: 14 },
      role: 'coordinator', auth: null, lastSim: 0,
      settings: {
        reminderMinutes: 2, reminderMode: 'business', tickMs: 9000,
        reminderBusinessDays: 3, reminderRepeatDays: 7, timezone: 'Asia/Manila',
        workdays: [0, 1, 2, 3, 4], holidays: [],
        simulate: true, slaDays: 5, maxUploadBytes: 10 * 1024 * 1024,
        authorizedClosureRoles: ['coordinator'],
        approvalCategories: [],
        priorityMatrix: {
          high: { high: 'critical', medium: 'high', low: 'medium' },
          medium: { high: 'high', medium: 'medium', low: 'low' },
          low: { high: 'medium', medium: 'low', low: 'low' }
        },
        categories: ['Hardware Repair', 'Software Support', 'Network and Connectivity', 'Account Assistance', 'Printer and Peripheral', 'Installation and Configuration', 'Other'],
        sources: ['telephone', 'email', 'walk-in', 'on-site', 'online portal'],
        priorities: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']],
        frequencies: [['daily', 'Daily', 1], ['weekly', 'Weekly', 7], ['biweekly', 'Every 2 weeks', 14],
          ['monthly', 'Monthly', 30], ['quarterly', 'Quarterly', 91],
          ['semiannual', 'Every 6 months', 182], ['annual', 'Yearly', 365], ['custom', 'Custom', 30]]
      },
      offices: [
        { name: 'IT Office', code: 'IT', location: 'Admin Building, Room 101', contactPerson: 'K. Ramos', contactEmail: 'k.ramos@upcebu.edu.ph', contactPhone: '+63 917 000 0002', active: true, createdAt: days(-40), updatedAt: days(-40) },
        { name: 'Records Office', code: 'REC', location: 'Records Bldg, Room 2', contactPerson: 'A. Delos Reyes', contactEmail: 'a.delosreyes@upcebu.edu.ph', contactPhone: '+63 917 000 0001', active: true, createdAt: days(-40), updatedAt: days(-40) },
        { name: 'Accounting', code: 'ACC', location: 'Admin Building, Room 105', contactPerson: 'R. Villanueva', contactEmail: 'r.villanueva@upcebu.edu.ph', contactPhone: '', active: true, createdAt: days(-40), updatedAt: days(-40) },
        { name: 'Registrar', code: 'REG', location: 'Registrar Bldg, Ground Floor', contactPerson: 'P. Ocampo', contactEmail: 'p.ocampo@upcebu.edu.ph', contactPhone: '', active: true, createdAt: days(-40), updatedAt: days(-40) },
        { name: 'HR', code: 'HR', location: 'Admin Building, Room 108', contactPerson: 'L. Sarmiento', contactEmail: 'l.sarmiento@upcebu.edu.ph', contactPhone: '', active: true, createdAt: days(-40), updatedAt: days(-40) },
        { name: 'Library', code: 'LIB', location: 'Library Bldg, 2nd Floor', contactPerson: 'M. Bataller', contactEmail: 'm.bataller@upcebu.edu.ph', contactPhone: '', active: true, createdAt: days(-40), updatedAt: days(-40) },
        { name: 'SDG', code: 'SDG', location: 'Research Annex, Room 3', contactPerson: 'C. Yap', contactEmail: 'c.yap@upcebu.edu.ph', contactPhone: '', active: true, createdAt: days(-40), updatedAt: days(-40) },
        { name: 'Office of the Director', code: 'DIR', location: 'Admin Building, Room 201', contactPerson: 'M. Reyes', contactEmail: 'm.reyes@upcebu.edu.ph', contactPhone: '+63 917 000 0004', active: true, createdAt: days(-40), updatedAt: days(-40) }
      ],
      /* Demo register.  Most numbers are already typed by hand on a seed
         ticket or schedule, so the register agrees with the records that name
         them.  A unit no ticket has named yet is normal too: the register
         holds what an office owns, not only what has broken. */
      assets: [
        { id: 'AST-0001', tag: 'PC-OF-118', name: 'Dell OptiPlex 7090 SFF', category: 'Hardware Repair', office: 'Records Office', location: 'Records Bldg, Room 2, encoding desk', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0002', tag: 'PC-OF-119', name: 'Dell OptiPlex 7090 SFF', category: 'Hardware Repair', office: 'Records Office', location: 'Records Bldg, Room 2, encoding desk', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0003', tag: 'AP-OF-01', name: 'Ubiquiti U6-Pro access point', category: 'Network and Connectivity', office: 'Records Office', location: 'Records Bldg, Room 2, ceiling', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0004', tag: 'PRN-REG-02', name: 'Epson L3250 bulk-ink printer', category: 'Printer and Peripheral', office: 'Registrar', location: 'Registrar Bldg, Ground Floor, counter 3', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0005', tag: 'PRN-ACC-01', name: 'HP LaserJet Pro M404dn', category: 'Printer and Peripheral', office: 'Accounting', location: 'Admin Building, Room 105', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0006', tag: 'UPS-HR-01', name: 'APC Smart-UPS 1500VA', category: 'Hardware Repair', office: 'HR', location: 'Admin Building, Room 108, rack', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0007', tag: 'AP-LIB-01', name: 'Ubiquiti U6-Lite access point', category: 'Network and Connectivity', office: 'Library', location: 'Library Bldg, 2nd Floor, periodicals', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0008', tag: 'AP-LIB-02', name: 'Ubiquiti U6-Lite access point', category: 'Network and Connectivity', office: 'Library', location: 'Library Bldg, 2nd Floor, reference', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0009', tag: 'AP-LIB-04', name: 'Ubiquiti U6-Lite access point', category: 'Network and Connectivity', office: 'Library', location: 'Library Bldg, 2nd Floor, periodicals shelf', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0010', tag: 'PC-SDG-02', name: 'Lenovo ThinkCentre M70q', category: 'Hardware Repair', office: 'SDG', location: 'Research Annex, Room 3', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0011', tag: 'PC-IT-01', name: 'Dell OptiPlex 7010 SFF', category: 'Hardware Repair', office: 'IT Office', location: 'Admin Building, Room 101, tech bench', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0012', tag: 'AP-IT-01', name: 'Ubiquiti U6-Pro access point', category: 'Network and Connectivity', office: 'IT Office', location: 'Admin Building, Room 101, ceiling', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0013', tag: 'PRN-IT-01', name: 'HP LaserJet Pro M404dn', category: 'Printer and Peripheral', office: 'IT Office', location: 'Admin Building, Room 101, print corner', active: true, createdAt: days(-38), updatedAt: days(-38) },
        { id: 'AST-0014', tag: 'PC-DIR-01', name: 'HP EliteDesk 800 G6 SFF', category: 'Hardware Repair', office: 'Office of the Director', location: 'Admin Building, Room 201', active: true, createdAt: days(-38), updatedAt: days(-38) }
      ],
      people: [
        { username: 'areyes', name: 'A. Delos Reyes', role: 'requester', office: 'Records Office', email: 'a.delosreyes@upcebu.edu.ph', phone: '+63 917 000 0001', active: true, prefs: {} },
        { username: 'kramos', name: 'K. Ramos', role: 'coordinator', office: 'IT Office', email: 'k.ramos@upcebu.edu.ph', phone: '+63 917 000 0002', active: true, prefs: {} },
        { username: 'jtan', name: 'J. Tan', role: 'technician', office: 'IT Office', email: 'j.tan@upcebu.edu.ph', phone: '+63 917 000 0003', active: true, prefs: {} },
        { username: 'mreyes', name: 'M. Reyes', role: 'management', office: 'Office of the Director', email: 'm.reyes@upcebu.edu.ph', phone: '+63 917 000 0004', active: true, prefs: {} },
        { username: 'muy', name: 'M. Uy', role: 'technician', office: 'IT Office', email: 'm.uy@upcebu.edu.ph', phone: '', active: true, prefs: {} },
        { username: 'rvillanueva', name: 'R. Villanueva', role: 'requester', office: 'Accounting', email: 'r.villanueva@upcebu.edu.ph', phone: '', active: true, prefs: {} },
        { username: 'pocampo', name: 'P. Ocampo', role: 'requester', office: 'Registrar', email: 'p.ocampo@upcebu.edu.ph', phone: '', active: true, prefs: {} },
        { username: 'mbataller', name: 'M. Bataller', role: 'requester', office: 'Library', email: 'm.bataller@upcebu.edu.ph', phone: '', active: true, prefs: {} },
        { username: 'lsarmiento', name: 'L. Sarmiento', role: 'requester', office: 'HR', email: 'l.sarmiento@upcebu.edu.ph', phone: '', active: true, prefs: {} },
        { username: 'cyap', name: 'C. Yap', role: 'requester', office: 'SDG', email: 'c.yap@upcebu.edu.ph', phone: '', active: true, prefs: {} }
      ],
      files: [
        { id: 'att-seed-1', ticketId: 'IT-2026-000142', jobId: null, name: 'event-viewer.txt', mime: 'text/plain', size: 512, by: 'A. Delos Reyes', at: days(-3) }
      ],
      audit: [
        { id: 1, at: days(-12), by: 'A. Delos Reyes', role: 'requester', subjectType: 'ticket', subjectId: 'IT-2026-000125', status: 'Submitted', kind: 'create', text: 'Ticket recorded for A. Delos Reyes (Records Office). Status: Submitted.' },
        { id: 2, at: days(-11.8), by: 'K. Ramos', role: 'coordinator', subjectType: 'ticket', subjectId: 'IT-2026-000125', status: 'Assigned', kind: 'status', text: 'Submitted -> Assigned: Assigned to J. Tan.' },
        { id: 3, at: days(-10), by: 'J. Tan', role: 'technician', subjectType: 'ticket', subjectId: 'IT-2026-000125', status: 'Resolved', kind: 'test', text: 'In Progress -> Resolved: Service passed testing. Office confirmation requested.' },
        { id: 4, at: days(-9), by: 'K. Ramos', role: 'coordinator', subjectType: 'ticket', subjectId: 'IT-2026-000125', status: 'Closed', kind: 'status', text: 'Resolved -> Closed: Closed after office confirmation.' },
        { id: 5, at: days(-6.4), by: 'K. Ramos', role: 'coordinator', subjectType: 'ticket', subjectId: 'IT-2026-000128', status: 'Cancelled', kind: 'cancel', text: 'Assigned -> Cancelled: Cancellation reason: Requester withdrew the request. Office procured the monitor independently.' },
        { id: 6, at: days(-5), by: 'J. Tan', role: 'technician', subjectType: 'job', subjectId: 'MNT-2026-0058', status: 'Resolved', kind: 'outcome', text: 'Maintenance work completed. Checklist complete, handed to the office for Section 3 confirmation.' },
        { id: 6.5, at: days(-3), by: 'System', role: 'system', subjectType: 'job', subjectId: 'MNT-2026-0058', status: 'Closed', kind: 'outcome', text: 'Record maintenance outcome: Successful. Do not mark incomplete or cancelled maintenance successful.' },
        { id: 7, at: days(-40), by: 'M. Reyes', role: 'management', subjectType: 'office', subjectId: 'Library', status: null, kind: 'office', text: "Office 'Library' created." },
        { id: 8, at: days(-40), by: 'M. Reyes', role: 'management', subjectType: 'user', subjectId: 'muy', status: null, kind: 'user', text: "User 'M. Uy' created (role: technician, username: muy)." },
        { id: 9, at: days(-30), by: 'K. Ramos', role: 'coordinator', subjectType: 'schedule', subjectId: 'SCH-2026-024', status: null, kind: 'sched', text: 'Schedule created. Records Office Hardware quarterly, first due today.' },
        { id: 10, at: days(-1.5), by: 'M. Reyes', role: 'management', subjectType: 'settings', subjectId: 'settings', status: null, kind: 'settings', text: 'Settings updated (reminder interval = 2 min).' }
      ],
      tickets: [
        t({
          id: 'IT-2026-000143', office: 'Library', requester: 'M. Bataller', category: 'Network and Connectivity',
          source: 'email', issue: 'Wi-Fi drops every few minutes in the periodicals section.',
          asset: 'AP-LIB-04', attachments: ['wifi-log.txt'], status: 'submitted',
          impact: null, urgency: null, priority: 'medium', target: null, technician: null,
          createdAt: days(-0.2),
          comments: [
            { id: 'IT-2026-000143-C01', at: days(-0.15), by: 'M. Bataller', role: 'requester', visibility: 'public', text: 'The drop happens mostly near the periodicals shelves, AP-LIB-04 area.', attachments: [] }
          ],
          history: [{ at: days(-0.2), by: 'M. Bataller', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' }]
        }),
        t({
          id: 'IT-2026-000137', office: 'Accounting', requester: 'R. Villanueva', category: 'Software Support',
          source: 'telephone', issue: 'Payroll module will not open after the update.',
          asset: '', attachments: [], status: 'needs_info',
          impact: 'High', urgency: 'Medium', priority: 'high', target: days(3), technician: null,
          createdAt: days(-1.1),
          history: [
            { at: days(-1.1), by: 'R. Villanueva', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-1.0), by: 'K. Ramos', role: 'coordinator', status: 'needs_info', kind: 'status', text: 'Details incomplete. Requested: exact error message and machine number.' }
          ]
        }),
        t({
          id: 'IT-2026-000130', office: 'Registrar', requester: 'P. Ocampo', category: 'Printer and Peripheral',
          source: 'walk-in', issue: 'Grade printing jams on the second tray.',
          asset: 'PRN-REG-02', attachments: ['jam-photo.jpg'], status: 'assigned',
          impact: 'Medium', urgency: 'Medium', priority: 'medium', target: days(4), technician: 'J. Tan',
          createdAt: days(-2), reviewed: true,
          history: [
            { at: days(-2), by: 'P. Ocampo', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-1.8), by: 'K. Ramos', role: 'coordinator', status: 'submitted', kind: 'note', text: 'Review: details complete. Impact Medium, Urgency Medium.' },
            { at: days(-1.7), by: 'K. Ramos', role: 'coordinator', status: 'assigned', kind: 'status', text: 'Assigned to J. Tan. Status: Assigned. Technician and requester notified.' }
          ]
        }),
        t({
          id: 'IT-2026-000142', office: 'Records Office', requester: 'A. Delos Reyes', category: 'Hardware Repair',
          source: 'telephone', issue: 'PC-OF-118 shuts down randomly during encoding.',
          asset: 'PC-OF-118', attachments: ['event-viewer.txt'], status: 'in_progress',
          impact: 'High', urgency: 'High', priority: 'high', target: days(-1), technician: 'J. Tan',
          createdAt: days(-3), reviewed: true,
          diagnosis: { findings: 'PSU fan seized; unit overheats under load.', actions: 'Cleaned chassis, tested with bench PSU', parts: 'ATX 600W PSU (to replace)', cost: 1850, labor: 1.5, dates: 'Oct 7, 2026', evidence: ['psu-photo.jpg'] },
          comments: [
            { id: 'IT-2026-000142-C01', at: days(-2.5), by: 'A. Delos Reyes', role: 'requester', visibility: 'public', text: 'Please do the repair after 2 PM. The unit is used for encoding in the morning.', attachments: [] },
            { id: 'IT-2026-000142-C02', at: days(-0.4), by: 'J. Tan', role: 'technician', visibility: 'internal', text: 'ATX PSU already in stock in the IT store. No need to order.', attachments: [] }
          ],
          history: [
            { at: days(-3), by: 'A. Delos Reyes', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-2.9), by: 'K. Ramos', role: 'coordinator', status: 'assigned', kind: 'status', text: 'Assessed High/High, priority high, target ' + days(-1).slice(0, 10) + '. Assigned to J. Tan.' },
            { at: days(-2.8), by: 'J. Tan', role: 'technician', status: 'in_progress', kind: 'status', text: 'Work started. Status: In Progress.' },
            { at: days(-0.5), by: 'J. Tan', role: 'technician', status: 'in_progress', kind: 'note', text: 'Diagnosis recorded: PSU fan seized; replacement required.' }
          ]
        }),
        t({
          id: 'IT-2026-000139', office: 'HR', requester: 'L. Sarmiento', category: 'Software Support',
          source: 'on-site', issue: 'Performance evaluation spreadsheet throws #REF errors.',
          asset: '', attachments: ['perf-eval.xlsx'], status: 'on_hold',
          impact: 'Medium', urgency: 'Medium', priority: 'medium', target: days(5), technician: 'J. Tan',
          createdAt: days(-4), reviewed: true,
          diagnosis: { findings: 'Sheet references external workbook on a decommissioned share.', actions: 'Rebuilt two named ranges; remaining vendor template pending', parts: '', cost: 0, labor: 0.5, dates: 'Oct 6, 2026', evidence: [] },
          dependency: {
            reason: 'Vendor template file required from HR head.', responsible: 'HR Director',
            nextAction: 'Procurement to request template from vendor', state: 'pending', dueAt: hours(-1),
            updates: [{ at: days(-3.5), text: 'Chased vendor. Promised delivery end of week.' }]
          },
          history: [
            { at: days(-4), by: 'L. Sarmiento', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-3.9), by: 'K. Ramos', role: 'coordinator', status: 'assigned', kind: 'status', text: 'Assigned to J. Tan. Status: Assigned.' },
            { at: days(-3.8), by: 'J. Tan', role: 'technician', status: 'in_progress', kind: 'status', text: 'Work started. Status: In Progress.' },
            { at: days(-3.6), by: 'J. Tan', role: 'technician', status: 'on_hold', kind: 'dep', text: 'On hold. Dependency: vendor template. Responsible: HR Director.' }
          ]
        }),
        t({
          id: 'IT-2026-000141', office: 'Accounting', requester: 'R. Villanueva', category: 'Hardware Repair',
          source: 'email', issue: 'Second monitor flickers on the teller station.',
          asset: 'MON-ACC-11', attachments: [], status: 'resolved',
          impact: 'Medium', urgency: 'Low', priority: 'low', target: days(2), technician: 'J. Tan',
          createdAt: days(-2.5), reviewed: true, resolvedAt: hours(-3),
          confirmation: { state: 'pending', person: '', date: null, feedback: '' },
          diagnosis: { findings: 'Failing HDMI cable and loose VESA mount.', actions: 'Replaced cable, reseated mount', parts: 'HDMI cable 2m', cost: 180, labor: 0.5, dates: 'Oct 8, 2026', evidence: ['after-test.jpg'] },
          tests: [{ at: hours(-3), by: 'J. Tan', result: 'pass', note: '30-minute burn-in, no flicker.' }],
          comments: [
            { id: 'IT-2026-000141-C01', at: hours(-2), by: 'K. Ramos', role: 'coordinator', visibility: 'public', text: 'Service done and tested. Please confirm the result so we can close the ticket.', attachments: [] }
          ],
          history: [
            { at: days(-2.5), by: 'R. Villanueva', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-2.4), by: 'K. Ramos', role: 'coordinator', status: 'assigned', kind: 'status', text: 'Assigned to J. Tan. Status: Assigned.' },
            { at: days(-2.3), by: 'J. Tan', role: 'technician', status: 'in_progress', kind: 'status', text: 'Work started. Status: In Progress.' },
            { at: hours(-3), by: 'J. Tan', role: 'technician', status: 'resolved', kind: 'test', text: 'Test passed. Status: Resolved. Office notified, ready for confirmation.' }
          ]
        }),
        t({
          id: 'IT-2026-000134', office: 'Registrar', requester: 'P. Ocampo', category: 'Network and Connectivity',
          source: 'telephone', issue: 'Enrollment portal very slow during peak hours.',
          asset: '', attachments: [], status: 'resolved',
          impact: 'High', urgency: 'Medium', priority: 'high', target: days(-1), technician: 'J. Tan',
          createdAt: days(-6), reviewed: true, resolvedAt: days(-4),
          confirmation: { state: 'pending', person: '', date: null, feedback: '' },
          diagnosis: { findings: 'Uplink saturated by unmanaged switch in Room 204.', actions: 'Re-segmented VLAN, capped rogue AP', parts: '', cost: 0, labor: 2, dates: 'Oct 4, 2026', evidence: [] },
          tests: [{ at: days(-4), by: 'J. Tan', result: 'pass', note: 'Throughput restored to 90 Mbps.' }],
          history: [
            { at: days(-6), by: 'P. Ocampo', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-5.9), by: 'K. Ramos', role: 'coordinator', status: 'assigned', kind: 'status', text: 'Assigned to J. Tan. Status: Assigned.' },
            { at: days(-5.8), by: 'J. Tan', role: 'technician', status: 'in_progress', kind: 'status', text: 'Work started. Status: In Progress.' },
            { at: days(-4), by: 'J. Tan', role: 'technician', status: 'resolved', kind: 'test', text: 'Test passed. Status: Resolved. Office notified, ready for confirmation.' }
          ]
        }),
        t({
          id: 'IT-2026-000128', office: 'SDG', requester: 'C. Yap', category: 'Other',
          source: 'email', issue: 'Request for extra monitor, later withdrawn and supplied in-house.',
          asset: '', attachments: [], status: 'cancelled',
          impact: 'Low', urgency: 'Low', priority: 'low', target: days(-3), technician: 'J. Tan',
          createdAt: days(-7), reviewed: true, cancelReason: 'Requester withdrew the request. Office procured the monitor independently.',
          history: [
            { at: days(-7), by: 'C. Yap', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-6.9), by: 'K. Ramos', role: 'coordinator', status: 'assigned', kind: 'status', text: 'Assigned to J. Tan.' },
            { at: days(-6.4), by: 'K. Ramos', role: 'coordinator', status: 'cancelled', kind: 'cancel', text: 'Active request withdrawn. Status: Cancelled. Reason recorded. Requester notified; records preserved.' }
          ]
        }),
        t({
          id: 'IT-2026-000125', office: 'Records Office', requester: 'A. Delos Reyes', category: 'Hardware Repair',
          source: 'telephone', issue: 'PC-OF-118 thermal shutdowns, first occurrence.',
          asset: 'PC-OF-118', attachments: [], status: 'closed',
          impact: 'Medium', urgency: 'Medium', priority: 'medium', target: days(-8), technician: 'J. Tan',
          createdAt: days(-12), reviewed: true, resolvedAt: days(-10), closedAt: days(-9),
          closure: 'confirmation',
          confirmation: { state: 'accepted', person: 'A. Delos Reyes', date: days(-9), feedback: 'Working for two days straight.' },
          diagnosis: { findings: 'Dust buildup; cleaned and reseated heatsink.', actions: 'Cleaned, reapplied thermal paste', parts: '', cost: 0, labor: 1, dates: 'Sep 26, 2026', evidence: [] },
          tests: [{ at: days(-10), by: 'J. Tan', result: 'pass', note: '2-hour load test stable.' }],
          history: [
            { at: days(-12), by: 'A. Delos Reyes', role: 'requester', status: 'submitted', kind: 'status', text: 'Request recorded. Status: Submitted.' },
            { at: days(-11.8), by: 'K. Ramos', role: 'coordinator', status: 'assigned', kind: 'status', text: 'Assigned to J. Tan.' },
            { at: days(-11.7), by: 'J. Tan', role: 'technician', status: 'in_progress', kind: 'status', text: 'Work started. Status: In Progress.' },
            { at: days(-10), by: 'J. Tan', role: 'technician', status: 'resolved', kind: 'test', text: 'Test passed. Status: Resolved. Office notified.' },
            { at: days(-9), by: 'A. Delos Reyes', role: 'requester', status: 'resolved', kind: 'confirm', text: 'Office accepted the service result. Confirmation recorded.' },
            { at: days(-9), by: 'K. Ramos', role: 'coordinator', status: 'closed', kind: 'status', text: 'Status: Closed after confirmation. Office service history and reporting updated.' }
          ]
        })
      ],
      schedules: [
        {
          id: 'SCH-2026-024', office: 'Records Office', assets: ['PC-OF-118', 'PC-OF-119'], category: 'Hardware Repair',
          checklist: ['Inspect internal dust', 'Check PSU and voltages', 'Verify storage health', 'Update OS and antivirus', 'Log asset condition'],
          frequency: 'quarterly', dueDate: days(0.05), technician: 'J. Tan', active: true, lastCheck: null, nextCheck: days(0.05)
        },
        {
          id: 'SCH-2026-018', office: 'HR', assets: ['UPS-HR-01'], category: 'Hardware Repair',
          checklist: ['Battery self-test', 'Load test', 'Replace batteries if below 70%', 'Record runtime'],
          frequency: 'monthly', dueDate: days(-0.01), technician: 'M. Uy', active: true, lastCheck: null, nextCheck: days(-0.01)
        },
        {
          id: 'SCH-2026-031', office: 'Accounting', assets: ['PRN-ACC-01'], category: 'Printer and Peripheral',
          checklist: ['Clean rollers', 'Align printhead', 'Firmware check', 'Test print'],
          frequency: 'monthly', dueDate: days(0.1), technician: 'M. Uy', active: true, lastCheck: days(-4), nextCheck: days(0.1)
        },
        {
          id: 'SCH-2026-035', office: 'SDG', assets: ['PC-SDG-02'], category: 'Hardware Repair',
          checklist: ['Dust inspection', 'RAM diagnostics', 'OS patch level', 'Backup verification'],
          frequency: 'monthly', dueDate: days(-0.2), technician: 'M. Uy', active: true, lastCheck: days(-0.1), nextCheck: days(-0.2)
        },
        {
          id: 'SCH-2026-033', office: 'Records Office', assets: ['PC-OF-119'], category: 'Hardware Repair',
          checklist: ['Inspect internal dust', 'Check PSU and voltages', 'Verify storage health'],
          frequency: 'quarterly', dueDate: days(20), technician: 'J. Tan', active: true, lastCheck: days(-1), nextCheck: days(20)
        },
        {
          id: 'SCH-2026-012', office: 'Library', assets: ['AP-LIB-01', 'AP-LIB-02'], category: 'Network and Connectivity',
          checklist: ['Firmware update', 'Channel survey', 'Verify coverage', 'Check cabling'],
          frequency: 'quarterly', dueDate: days(46), technician: 'J. Tan', active: true, lastCheck: days(-44), nextCheck: days(46)
        },
        {
          id: 'SCH-2026-027', office: 'Records Office', assets: ['AP-OF-01'], category: 'Network and Connectivity',
          checklist: ['Firmware update', 'Channel survey', 'Verify coverage'],
          frequency: 'semiannual', dueDate: days(-0.4), technician: 'J. Tan', active: true, lastCheck: days(-0.5), nextCheck: days(-0.4)
        }
      ],
      jobs: [
        {
          id: 'MNT-2026-0061', scheduleId: 'SCH-2026-024', occurrence: 'seed-024', office: 'Records Office',
          assets: ['PC-OF-118', 'PC-OF-119'], technician: 'J. Tan', category: 'Hardware Repair',
          checklist: ['Inspect internal dust', 'Check PSU and voltages', 'Verify storage health', 'Update OS and antivirus', 'Log asset condition'],
          items: [
            { task: 'Inspect internal dust', done: true, result: 'Passed', finding: 'Heavy dust on PSU intake', tech: 'J. Tan', date: days(-0.1), evidence: ['dust-024.jpg'] },
            { task: 'Check PSU and voltages', done: true, result: 'Attention needed', finding: 'PSU fan noise on PC-OF-118', tech: 'J. Tan', date: days(-0.1), evidence: [] },
            { task: 'Verify storage health', done: true, result: 'Passed', finding: 'SMART all green', tech: 'J. Tan', date: days(-0.1), evidence: [] },
            { task: 'Update OS and antivirus', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'Log asset condition', done: false, result: '', finding: '', tech: '', date: '', evidence: [] }
          ],
          status: 'in_progress', availability: 'yes', visitDate: days(-0.1), reschedules: [],
          additionalFault: 'unknown', linkedTicketId: null, outcome: null,
          confirmation: { state: 'none', person: '', date: null },
          nextDue: null, createdAt: days(-0.5)
        },
        {
          id: 'MNT-2026-0057', scheduleId: 'SCH-2026-033', occurrence: 'seed-033', office: 'Records Office',
          assets: ['PC-OF-119'], technician: 'J. Tan', category: 'Hardware Repair',
          checklist: ['Inspect internal dust', 'Check PSU and voltages', 'Verify storage health'],
          items: [
            { task: 'Inspect internal dust', done: true, result: 'Passed', finding: '', tech: 'J. Tan', date: days(-1), evidence: [] },
            { task: 'Check PSU and voltages', done: true, result: 'Passed', finding: '', tech: 'J. Tan', date: days(-1), evidence: [] },
            { task: 'Verify storage health', done: true, result: 'Passed', finding: 'SMART all green', tech: 'J. Tan', date: days(-1), evidence: [] }
          ],
          status: 'resolved', availability: 'yes', visitDate: days(-1), reschedules: [],
          additionalFault: 'no', linkedTicketId: null, outcome: null,
          workComplete: true,
          confirmation: { state: 'pending', person: '', date: null },
          nextDue: null, createdAt: days(-2)
        },
        {
          id: 'MNT-2026-0058', scheduleId: 'SCH-2026-031', occurrence: 'seed-031', office: 'Accounting',
          assets: ['PRN-ACC-01'], technician: 'M. Uy', category: 'Printer and Peripheral',
          checklist: ['Clean rollers', 'Align printhead', 'Firmware check', 'Test print'],
          items: [
            { task: 'Clean rollers', done: true, result: 'Passed', finding: '', tech: 'M. Uy', date: days(-4), evidence: [] },
            { task: 'Align printhead', done: true, result: 'Passed', finding: '', tech: 'M. Uy', date: days(-4), evidence: [] },
            { task: 'Firmware check', done: true, result: 'Passed', finding: 'Updated to 4.2.1', tech: 'M. Uy', date: days(-4), evidence: [] },
            { task: 'Test print', done: true, result: 'Passed', finding: '', tech: 'M. Uy', date: days(-4), evidence: [] }
          ],
          status: 'closed', availability: 'yes', visitDate: days(-4), reschedules: [],
          additionalFault: 'no', linkedTicketId: null, outcome: 'success',
          workComplete: true, closedAt: days(-3),
          confirmation: { state: 'accepted', person: 'R. Villanueva', date: days(-3) },
          nextDue: null, createdAt: days(-5)
        },
        {
          id: 'MNT-2026-0060', scheduleId: 'SCH-2026-035', occurrence: 'seed-035', office: 'SDG',
          assets: ['PC-SDG-02'], technician: 'M. Uy', category: 'Hardware Repair',
          checklist: ['Dust inspection', 'RAM diagnostics', 'OS patch level', 'Backup verification'],
          items: [
            { task: 'Dust inspection', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'RAM diagnostics', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'OS patch level', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'Backup verification', done: false, result: '', finding: '', tech: '', date: '', evidence: [] }
          ],
          status: 'assigned', availability: 'yes', visitDate: days(-0.1), reschedules: [],
          additionalFault: 'unknown', linkedTicketId: null, outcome: null,
          confirmation: { state: 'none', person: '', date: null },
          nextDue: null, createdAt: days(-0.2)
        },
        {
          id: 'MNT-2026-0059', scheduleId: 'SCH-2026-012', occurrence: 'seed-012', office: 'Library',
          assets: ['AP-LIB-01', 'AP-LIB-02'], technician: 'J. Tan', category: 'Network and Connectivity',
          checklist: ['Firmware update', 'Channel survey', 'Verify coverage', 'Check cabling'],
          items: [
            { task: 'Firmware update', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'Channel survey', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'Verify coverage', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'Check cabling', done: false, result: '', finding: '', tech: '', date: '', evidence: [] }
          ],
          status: 'on_hold', availability: 'no', visitDate: hours(-1),
          reschedules: [{ from: days(-3), to: hours(-1), reason: 'Library examination week, office unavailable', at: days(-3) }],
          additionalFault: 'unknown', linkedTicketId: null, outcome: null,
          confirmation: { state: 'none', person: '', date: null },
          nextDue: null, createdAt: days(-3)
        },
        {
          id: 'MNT-2026-0062', scheduleId: 'SCH-2026-027', occurrence: 'seed-027', office: 'Records Office',
          assets: ['AP-OF-01'], technician: 'J. Tan', category: 'Network and Connectivity',
          checklist: ['Firmware update', 'Channel survey', 'Verify coverage'],
          items: [
            { task: 'Firmware update', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'Channel survey', done: false, result: '', finding: '', tech: '', date: '', evidence: [] },
            { task: 'Verify coverage', done: false, result: '', finding: '', tech: '', date: '', evidence: [] }
          ],
          status: 'submitted', availability: null, visitDate: null, reschedules: [],
          additionalFault: 'unknown', linkedTicketId: null, outcome: null,
          confirmation: { state: 'none', person: '', date: null },
          nextDue: null, createdAt: days(-0.4)
        }
      ],
      notifications: [
        { id: 40, at: hours(-3), role: 'requester', office: 'Accounting', kind: 'confirm', ticketId: 'IT-2026-000141', text: 'IT-2026-000141 is Resolved. Ready for your confirmation.', read: false, readBy: [] },
        { id: 39, at: hours(-3), role: 'coordinator', kind: 'confirm', ticketId: 'IT-2026-000141', text: 'IT-2026-000141 resolved by J. Tan. Awaiting office confirmation.', read: false, readBy: [] },
        { id: 38, at: days(-0.1), role: 'technician', kind: 'job', ticketId: null, jobId: 'MNT-2026-0061', text: 'MNT-2026-0061 generated from SCH-2026-024. Visit coordinated.', read: false, readBy: [] },
        { id: 37, at: hours(-1), role: 'coordinator', kind: 'dep', ticketId: 'IT-2026-000139', text: 'Dependency follow-up due for IT-2026-000139 (HR vendor template).', read: false, readBy: [] }
      ]
    };
    // normalise seeded job occurrences to their schedule's occurrence date
    out.jobs.forEach(function (j) {
      var sc = null;
      for (var i = 0; i < out.schedules.length; i++) if (out.schedules[i].id === j.scheduleId) sc = out.schedules[i];
      if (sc && String(j.occurrence).indexOf('seed-') === 0) j.occurrence = sc.dueDate.slice(0, 10);
    });
    return out;
  }

  var db = null;
  function load() {
    if (DEMO) { db = seed(); db.settings.simulate = false; return; }
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db || db.v !== V) db = seed();
    migrate(db);
  }
  /* Additive, idempotent normalisation for databases stored by older builds. */
  function migrate(d) {
    if (!d || typeof d !== 'object') return d;
    if (!Array.isArray(d.offices)) d.offices = [];
    if (!Array.isArray(d.assets)) d.assets = [];
    if (!Array.isArray(d.people)) d.people = [];
    if (!Array.isArray(d.files)) d.files = [];
    if (!Array.isArray(d.audit)) d.audit = [];
    if (!d.settings) d.settings = {};
    if (!Array.isArray(d.settings.categories)) d.settings.categories = ['Hardware Repair', 'Software Support', 'Network and Connectivity', 'Account Assistance', 'Printer and Peripheral', 'Installation and Configuration', 'Other'];
    if (!Array.isArray(d.settings.sources)) d.settings.sources = ['telephone', 'email', 'walk-in', 'on-site', 'online portal'];
    if (!Array.isArray(d.settings.priorities)) d.settings.priorities = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']];
    if (!Array.isArray(d.settings.frequencies)) d.settings.frequencies = [['daily', 'Daily', 1], ['weekly', 'Weekly', 7], ['biweekly', 'Every 2 weeks', 14], ['monthly', 'Monthly', 30], ['quarterly', 'Quarterly', 91], ['semiannual', 'Every 6 months', 182], ['annual', 'Yearly', 365], ['custom', 'Custom', 30]];
    // The working week the reminder interval counts (assumption A5).  Monday is 0.
    if (!Array.isArray(d.settings.workdays) || !d.settings.workdays.length) d.settings.workdays = [0, 1, 2, 3, 4];
    if (!Array.isArray(d.settings.holidays)) d.settings.holidays = [];
    // The service level window the overdue column counts (assumption A1).
    if (!(parseInt(d.settings.slaDays, 10) >= 1)) d.settings.slaDays = 5;
    var maxAudit = 0;
    d.audit.forEach(function (a) { if (typeof a.id === 'number' && a.id > maxAudit) maxAudit = a.id; });
    d.audit.forEach(function (a) { if (typeof a.id !== 'number') a.id = ++maxAudit; });
    (d.tickets || []).forEach(function (t) { if (!Array.isArray(t.comments)) t.comments = []; });
    (d.notifications || []).forEach(function (n) { if (!Array.isArray(n.readBy)) n.readBy = n.read ? [] : []; });
    return d;
  }
  function persist() {
    if (DEMO) return; /* deterministic mode is read-only; storage is never touched */
    /* API mode: the server is the source of truth; hand the snapshot over. */
    if (window.__itcPersistHook) { try { window.__itcPersistHook(db); } catch (e) { console.error(e); } return; }
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* quota */ }
    if (CH) { try { CH.postMessage({ t: 's', at: Date.now() }); } catch (e) { } }
  }
  function fire() { for (var i = 0; i < subs.length; i++) { try { subs[i](); } catch (e) { console.error(e); } } }
  function update(fn) { fn(db); db.rev++; db.updatedAt = NOW(); persist(); fire(); }

  window.Store = {
    get db() { return db; },
    load: load,
    update: update,
    fire: fire,
    subscribe: function (f) { subs.push(f); },
    reset: function () { db = seed(); persist(); fire(); },
    /* Replace the whole dataset (API mode). Fires subscribers but does not
       persist; the adopted snapshot already came from the server. */
    adopt: function (next) {
      if (!next || typeof next !== 'object') return;
      db = next;
      fire();
    },
    NOW: NOW,
    nextId: function (kind) {
      var s = db.seq;
      if (kind === 'ticket') {
        s.ticket++;
        /* IT-YYYY-NNNNNN: the year plus a zero padded yearly sequence
           (decision D19).  The counter only moves forward, so a number is
           never reused. */
        return 'IT-' + new Date(Date.now()).getFullYear() + '-' + String(s.ticket).padStart(6, '0');
      }
      if (kind === 'sched') { s.sched++; return 'SCH-2026-' + String(s.sched).padStart(3, '0'); }
      if (kind === 'job') { s.job++; return 'MNT-2026-' + String(s.job).padStart(4, '0'); }
      if (kind === 'asset') { s.asset = (s.asset || 0) + 1; return 'AST-' + String(s.asset).padStart(4, '0'); }
      s.notif++; return String(s.notif);
    },
    notify: function (role, text, kind, extra) {
      db.seq.notif++;
      var n = { id: db.seq.notif, at: NOW(), role: role, kind: kind || 'info', text: text, read: false, readBy: [] };
      if (extra) { if (extra.ticketId) n.ticketId = extra.ticketId; if (extra.office) n.office = extra.office; if (extra.jobId) n.jobId = extra.jobId; if (extra.to) n.to = extra.to; }
      db.notifications.unshift(n);
      if (db.notifications.length > 120) db.notifications.length = 120;
      return n;
    },
    getTicket: function (id) { for (var i = 0; i < db.tickets.length; i++) if (db.tickets[i].id === id) return db.tickets[i]; return null; },
    getSchedule: function (id) { for (var i = 0; i < db.schedules.length; i++) if (db.schedules[i].id === id) return db.schedules[i]; return null; },
    getJob: function (id) { for (var i = 0; i < db.jobs.length; i++) if (db.jobs[i].id === id) return db.jobs[i]; return null; }
  };

  load();
  window.addEventListener('storage', function (e) { if (e.key === KEY) { load(); fire(); } });
  if (CH) CH.onmessage = function () { load(); fire(); };
})();
