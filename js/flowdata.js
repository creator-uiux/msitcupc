/* flowdata.js: the source process diagram as data.
 *
 * This is the single source of truth for the Workflow Guide (flow.html) and for
 * the Appendix C coverage checks.  Node texts are VERBATIM from the PDF
 * process diagram (Appendix C.1) and every connector is the traced
 * source -> target arrow (Appendix C.2).  The stable IDs N00 to N80 are used
 * so the guide, the traceability checklist and the tests all agree.
 *
 * Legend artifact: N75 and the two legend connectors are drawing artifacts
 * from the PDF viewer legend box, not process flow.  They are recorded here
 * for completeness but flagged `ignore: true` and are never rendered.
 */
(function (global) {
  'use strict';

  /* Lane names are the PDF lane names, verbatim and in PDF order. */
  var LANES = [
    { id: 'office', name: 'Office Requester or Office Representative', role: 'requester',
      sub: 'the office that raises the request' },
    { id: 'coordinator', name: 'IT Coordinator', role: 'coordinator',
      sub: 'review, assessment, assignment, dependencies' },
    { id: 'technician', name: 'IT Technician', role: 'technician',
      sub: 'diagnosis, repair, dependencies, testing, checklists' },
    { id: 'system', name: 'System', role: 'system',
      sub: 'status transitions, records, schedules, reports' }
  ];

  /* type: start | proc | decision | store | end | annotation | action | legend */
  var NODES = [
    /* ---- Office Requester or Office Representative ---- */
    { id: 'N00', lane: 'office', type: 'proc', label: 'Agree on new maintenance date', live: 'hasResched' },
    { id: 'N01', lane: 'office', type: 'start', label: 'Start', live: 'always' },
    { id: 'N02', lane: 'office', type: 'proc', label: 'Office needs IT assistance', live: 'always' },
    { id: 'N03', lane: 'office', type: 'proc', label: 'Submit service request', live: 'hasSubmitted' },
    { id: 'N04', lane: 'office', type: 'proc', label: 'Supply missing information', live: 'hasNeedsInfo' },
    { id: 'N05', lane: 'office', type: 'proc', label: 'Review and verify service result', live: 'hasResolved' },
    { id: 'N06', lane: 'office', type: 'decision', label: 'Office accepts result?', live: 'hasResolved' },
    { id: 'N07', lane: 'office', type: 'proc', label: 'Record confirmation, confirming person, and date', live: 'hasConfirm' },
    { id: 'N08', lane: 'office', type: 'proc', label: 'Record office feedback', live: 'hasRejected' },
    { id: 'N09', lane: 'office', type: 'proc', label: 'Create new ticket linked to previous service record', live: 'hasRecurring' },

    /* ---- IT Coordinator ---- */
    { id: 'N10', lane: 'coordinator', type: 'start', label: 'Start', live: 'always' },
    { id: 'N11', lane: 'coordinator', type: 'proc', label: 'Create maintenance schedule', live: 'hasSchedules' },
    { id: 'N12', lane: 'coordinator', type: 'proc', label: 'Enter telephone, email, walk-in, or on-site request', live: 'hasTickets' },
    { id: 'N13', lane: 'coordinator', type: 'proc', label: 'Assign technician and coordinate visit', live: 'hasOpenJob' },
    { id: 'N14', lane: 'coordinator', type: 'proc', label: 'Review request', live: 'hasSubmitted' },
    { id: 'N15', lane: 'coordinator', type: 'proc', label: 'Request missing details', live: 'hasSubmitted' },
    { id: 'N16', lane: 'coordinator', type: 'decision', label: 'Details complete?', live: 'hasSubmitted' },
    { id: 'N17', lane: 'coordinator', type: 'proc', label: 'Assess impact and urgency', live: 'hasAssessed' },
    { id: 'N18', lane: 'coordinator', type: 'proc', label: 'Set priority and target completion date', live: 'hasAssessed' },
    { id: 'N19', lane: 'coordinator', type: 'proc', label: 'Assign technician', live: 'hasAssessed' },
    { id: 'N20', lane: 'coordinator', type: 'proc', label: 'Follow up dependency', live: 'hasOnHold' },
    { id: 'N21', lane: 'coordinator', type: 'decision', label: 'Dependency outcome?', live: 'hasOnHold' },
    { id: 'N22', lane: 'coordinator', type: 'proc', label: 'Record follow-up updates', live: 'hasOnHold' },
    { id: 'N23', lane: 'coordinator', type: 'proc', label: 'Record cancellation reason', live: 'hasOnHold' },

    /* ---- IT Technician ---- */
    { id: 'N24', lane: 'technician', type: 'proc', label: 'Perform maintenance checklist using Section 2', live: 'hasRunJob' },
    { id: 'N25', lane: 'technician', type: 'proc', label: 'Record task, result, findings, technician, date, and evidence', live: 'hasRunJob' },
    { id: 'N26', lane: 'technician', type: 'decision', label: 'Additional fault discovered?', live: 'hasRunJob' },
    { id: 'N27', lane: 'technician', type: 'proc', label: 'Continue maintenance verification', live: 'hasRunJob' },
    { id: 'N28', lane: 'technician', type: 'proc', label: 'Review ticket and previous office or asset history', live: 'hasAssigned' },
    { id: 'N29', lane: 'technician', type: 'proc', label: 'Coordinate service schedule', live: 'hasAssigned' },
    { id: 'N30', lane: 'technician', type: 'proc', label: 'Diagnose issue and record findings', live: 'hasInProgress' },
    { id: 'N31', lane: 'technician', type: 'decision', label: 'Parts, approval, or external support needed?', live: 'hasInProgress' },
    { id: 'N32', lane: 'technician', type: 'proc', label: 'Perform repair, installation, configuration, troubleshooting, or other IT service', live: 'hasInProgress' },
    { id: 'N33', lane: 'technician', type: 'proc', label: 'Record dependency, reason, responsible person, and next action', live: 'hasOnHold' },
    { id: 'N34', lane: 'technician', type: 'proc', label: 'Record diagnosis, actions, parts, costs, labor, dates, and evidence', live: 'hasDiagnosis' },
    { id: 'N35', lane: 'technician', type: 'proc', label: 'Test result', live: 'hasTests' },
    { id: 'N36', lane: 'technician', type: 'decision', label: 'Service passed testing?', live: 'hasInProgress' },
    { id: 'N37', lane: 'technician', type: 'proc', label: 'Record failed test', live: 'hasFailedTests' },

    /* ---- System ---- */
    { id: 'N38', lane: 'system', type: 'proc', label: 'Record reschedule', live: 'hasResched' },
    { id: 'N39', lane: 'system', type: 'store', label: 'Record maintenance schedule: office, assets, category, checklist, frequency, due date, technician', live: 'hasSchedules' },
    { id: 'N40', lane: 'system', type: 'proc', label: 'Check maintenance schedule', live: 'always' },
    { id: 'N41', lane: 'system', type: 'proc', label: 'Keep schedule active and wait', live: 'hasFutureSchedule' },
    { id: 'N42', lane: 'system', type: 'proc', label: 'Calculate next due date', live: 'hasDoneJob' },
    { id: 'N43', lane: 'system', type: 'decision', label: 'Maintenance due?', live: 'hasDueSchedule' },
    { id: 'N44', lane: 'system', type: 'proc', label: 'Check job for schedule occurrence', live: 'hasDueSchedule' },
    { id: 'N45', lane: 'system', type: 'decision', label: 'Job already exists?', live: 'hasDueSchedule' },
    { id: 'N46', lane: 'system', type: 'proc', label: 'Generate linked maintenance job', live: 'hasDueSchedule' },
    { id: 'N47', lane: 'system', type: 'proc', label: 'Use existing job; do not duplicate', live: 'hasDupSchedule' },
    { id: 'N48', lane: 'system', type: 'store', label: 'Maintenance Job Record', live: 'hasJobs' },
    { id: 'N49', lane: 'system', type: 'decision', label: 'Office available?', live: 'hasOpenJob' },
    { id: 'N50', lane: 'system', type: 'action', label: 'Create linked corrective ticket following Section 1', live: 'hasRunJob' },
    { id: 'N51', lane: 'system', type: 'store', label: 'Record service request', live: 'hasTickets' },
    { id: 'N52', lane: 'system', type: 'proc', label: 'Status: Submitted', live: 'hasSubmitted' },
    { id: 'N53', lane: 'system', type: 'store', label: 'Status and audit history', live: 'hasTickets' },
    { id: 'N54', lane: 'system', type: 'proc', label: 'Update existing ticket', live: 'hasNeedsInfo' },
    { id: 'N55', lane: 'system', type: 'proc', label: 'Status: Needs Information', live: 'hasNeedsInfo' },
    { id: 'N56', lane: 'system', type: 'proc', label: 'Status: Assigned', live: 'hasAssigned' },
    { id: 'N57', lane: 'system', type: 'proc', label: 'Notify technician and requester', live: 'hasAssigned' },
    { id: 'N58', lane: 'system', type: 'proc', label: 'Status: In Progress', live: 'hasInProgress' },
    { id: 'N59', lane: 'system', type: 'proc', label: 'Status: On Hold', live: 'hasOnHold' },
    { id: 'N60', lane: 'system', type: 'proc', label: 'Status: Resolved', live: 'hasResolved' },
    { id: 'N61', lane: 'system', type: 'proc', label: 'Notify office ready for confirmation', live: 'hasResolved' },
    { id: 'N62', lane: 'system', type: 'proc', label: 'Status: Cancelled', live: 'hasCancelled' },
    { id: 'N63', lane: 'system', type: 'proc', label: 'Notify requester', live: 'hasCancelled' },
    { id: 'N64', lane: 'system', type: 'proc', label: 'Preserve records and activity history', live: 'hasCancelled' },
    { id: 'N65', lane: 'system', type: 'proc', label: 'Keep status: Resolved', live: 'hasReminders' },
    { id: 'N66', lane: 'system', type: 'proc', label: 'Send follow-up reminder', live: 'hasReminders' },
    { id: 'N67', lane: 'system', type: 'proc', label: 'Status: Closed', live: 'hasClosed' },
    { id: 'N68', lane: 'system', type: 'proc', label: 'Update office service history and reporting', live: 'hasClosed' },
    { id: 'N69', lane: 'system', type: 'proc', label: 'Record maintenance outcome', live: 'hasRunJob' },
    { id: 'N70', lane: 'system', type: 'decision', label: 'Issue recurs after closure?', live: 'hasClosed' },
    { id: 'N71', lane: 'system', type: 'proc', label: 'Do not mark incomplete or cancelled maintenance successful', live: 'hasDoneJob' },
    { id: 'N72', lane: 'system', type: 'proc', label: 'Update office and asset service history', live: 'hasDoneJob' },
    { id: 'N73', lane: 'system', type: 'end', label: 'End', live: 'hasClosed' },
    { id: 'N74', lane: 'system', type: 'store', label: 'Office IT Service Register', live: 'hasTickets' },
    { id: 'N75', lane: 'system', type: 'legend', ignore: true,
      label: 'Legend: rounded = Start/End; rectangle = Activity; diamond = Decision; cylinder = Data Store; dashed = Loop or alternate', live: 'never' },
    { id: 'N76', lane: 'system', type: 'proc', label: 'Generate Office IT Service Reports', live: 'always' },
    { id: 'N77', lane: 'system', type: 'proc', label: 'Filter by office, date range, category, technician, and status', live: 'always' },
    { id: 'N78', lane: 'system', type: 'annotation',
      label: 'Cancelled separate from completed totals; authorized office access; role-based IT access; preserve completed records and audit history; office-linked services', live: 'always' },
    { id: 'N79', lane: 'system', type: 'proc', label: 'Service history, completed totals, pending and overdue, workload, turnaround, costs, recurring issues, compliance', live: 'always' },
    { id: 'N80', lane: 'system', type: 'end', label: 'Service record retained', live: 'hasClosed' }
  ];

  /* Connectors: [source, target, label].  `hidden: true` marks the arrows whose
   * head sits behind an edge label in the PDF; they were implemented from the
   * label text and the SOP numbering (Appendix B.6). */
  var EDGES = [
    ['N01', 'N02', ''],
    ['N02', 'N03', ''],
    ['N02', 'N12', ''],
    ['N03', 'N51', ''],
    ['N12', 'N51', ''],
    ['N51', 'N52', ''],
    ['N52', 'N53', ''],
    ['N53', 'N14', ''],
    ['N14', 'N16', ''],
    ['N16', 'N55', 'No'],
    ['N55', 'N15', ''],
    ['N15', 'N04', ''],
    ['N04', 'N54', ''],
    ['N54', 'N14', 'Return to review; no new ticket'],
    ['N16', 'N17', 'Yes'],
    ['N17', 'N18', ''],
    ['N18', 'N19', ''],
    ['N19', 'N56', ''],
    ['N56', 'N57', ''],
    ['N57', 'N28', 'To Section 2'],
    ['N56', 'N23', 'Active request withdrawn'],
    ['N28', 'N29', ''],
    ['N29', 'N58', ''],
    ['N58', 'N30', ''],
    ['N30', 'N31', ''],
    ['N31', 'N32', 'No'],
    ['N31', 'N59', 'Yes'],
    ['N59', 'N33', ''],
    ['N33', 'N20', ''],
    ['N20', 'N21', ''],
    ['N21', 'N58', 'Resolved'],
    ['N21', 'N22', 'Still pending'],
    ['N22', 'N21', 'Continue follow-up', true],
    ['N21', 'N23', 'Cannot proceed'],
    ['N23', 'N62', ''],
    ['N58', 'N32', 'After dependency resolved'],
    ['N32', 'N34', ''],
    ['N34', 'N35', ''],
    ['N35', 'N36', ''],
    ['N36', 'N37', 'No'],
    ['N37', 'N30', 'Return to diagnosis'],
    ['N36', 'N60', 'Yes'],
    ['N60', 'N61', ''],
    ['N34', 'N53', ''],
    ['N34', 'N74', ''],
    ['N60', 'N53', ''],
    ['N61', 'N05', 'To Section 3'],
    ['N05', 'N06', ''],
    ['N06', 'N07', 'Accepted', true],
    ['N06', 'N08', 'Rejected'],
    ['N06', 'N65', 'No response'],
    ['N08', 'N58', 'Return to Section 2 diagnosis (status In Progress)'],
    ['N08', 'N30', 'Return to Section 2 diagnosis'],
    ['N07', 'N67', ''],
    ['N07', 'N69', 'Maintenance confirmation'],
    ['N65', 'N66', ''],
    ['N66', 'N06', 'When office responds'],
    ['N67', 'N68', 'Maintenance closure'],
    ['N62', 'N63', ''],
    ['N63', 'N64', ''],
    ['N64', 'N68', ''],
    ['N68', 'N74', ''],
    ['N68', 'N70', ''],
    ['N70', 'N09', 'Yes'],
    ['N09', 'N51', 'Return to Section 1'],
    ['N70', 'N73', 'No'],
    ['N73', 'N80', ''],
    ['N10', 'N11', ''],
    ['N11', 'N39', ''],
    ['N39', 'N40', ''],
    ['N39', 'N48', ''],
    ['N39', 'N74', ''],
    ['N40', 'N43', ''],
    ['N43', 'N41', 'No'],
    ['N41', 'N40', 'Next scheduled check', true],
    ['N43', 'N44', 'Yes'],
    ['N44', 'N45', ''],
    ['N45', 'N47', 'Yes'],
    ['N45', 'N46', 'No'],
    ['N46', 'N48', ''],
    ['N47', 'N48', ''],
    ['N48', 'N13', ''],
    ['N13', 'N49', ''],
    ['N49', 'N00', 'No', true],
    ['N00', 'N38', ''],
    ['N38', 'N49', 'On agreed date'],
    ['N49', 'N24', 'Yes'],
    ['N24', 'N25', ''],
    ['N25', 'N26', ''],
    ['N25', 'N48', 'Continue maintenance documentation'],
    ['N26', 'N50', 'Yes'],
    ['N50', 'N51', 'Follow Section 1'],
    ['N50', 'N48', 'Continue maintenance documentation'],
    ['N26', 'N27', 'No'],
    ['N27', 'N05', 'Use Section 3 confirmation and closure'],
    ['N69', 'N71', ''],
    ['N71', 'N72', ''],
    ['N72', 'N74', ''],
    ['N72', 'N42', ''],
    ['N69', 'N74', ''],
    ['N42', 'N40', 'Return to scheduled maintenance check'],
    ['N51', 'N74', 'two parallel connectors'],
    ['N74', 'N76', ''],
    ['N76', 'N77', ''],
    ['N77', 'N79', ''],
    ['N74', 'N78', '']
  ];

  var byId = {};
  for (var i = 0; i < NODES.length; i++) byId[NODES[i].id] = NODES[i];

  function laneOf(id) {
    var n = byId[id];
    return n ? n.lane : null;
  }
  function node(id) { return byId[id] || null; }
  function labelOf(id) { return byId[id] ? byId[id].label : id; }
  /* Nodes that must be rendered and implemented (everything except the legend). */
  function implementedNodes() {
    return NODES.filter(function (n) { return !n.ignore; });
  }
  /* Legend connectors are drawing artifacts and are not process flow. */
  function isLegendEdge(e) {
    return byId[e[0]] && byId[e[0]].type === 'legend';
  }
  function implementedEdges() {
    return EDGES.filter(function (e) { return !isLegendEdge(e); });
  }

  global.FlowData = {
    LANES: LANES,
    NODES: NODES,
    EDGES: EDGES,
    node: node,
    laneOf: laneOf,
    labelOf: labelOf,
    implementedNodes: implementedNodes,
    implementedEdges: implementedEdges,
    isLegendEdge: isLegendEdge
  };
})(window);
