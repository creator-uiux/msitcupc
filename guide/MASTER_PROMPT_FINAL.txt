# MASTER IMPLEMENTATION PROMPT (FINAL): IT SERVICE AND MAINTENANCE MANAGEMENT SYSTEM

## 0. HOW TO USE THIS PROMPT (READ FIRST)

You are running in a CLI agent. You cannot reliably open PDFs, screenshots, or external websites. Therefore:

1. The full business process is embedded in this prompt (Sections 6 to 13, Appendix A, and Appendix B). Treat this prompt as the complete, authoritative copy of the Maintenance System PDF. Appendix B was produced by rendering the PDF and reading its vector data: every shape, its text, its swimlane, and every connector with its arrowhead (105 arrows) were traced from source to target. Swimlane ownership (Section 4) and the flow (Appendix B) are therefore VERIFIED from the PDF. Appendix B.6 lists the few places where the drawing itself hides an arrowhead behind a label, so you know exactly which links come from label placement and SOP numbering.
2. If `docs/source/Maintenance_System.pdf` exists in the repository, try to read it and report any difference from the appendices. If you cannot read it, say so and continue with the appendices. Never claim you inspected something you could not open.
3. Reference files to look for (use them if present, never claim to have read a file you could not open): `docs/source/Maintenance_System.pdf` (the process diagram), `docs/reference/` (ticket list, ticket details, and dashboard screenshots supplied by the owner, the required login design `UPLoginUI.PNG`, and `it-service-demo.html`, a role-based visual demo that shows the intended look and role behavior; use it as a visual baseline for layout, tokens, and role scoping, not as code to copy). If images cannot be read in your environment (the owner's OpenCode CLI is text-only), rely on the written UI requirements in this prompt. The login design is fully described in text in Section 14.15.
4. Try to fetch the project website and the Figma kit page. If you cannot, continue using the UI requirements in Section 14 and document the limitation.
5. Work in phases (Section 22). After each phase: update `docs/IMPLEMENTATION_CHECKLIST.md`, run build and tests, and make a git commit. Do not stop after an audit or plan. Keep going until the Definition of Done (Section 24) is met or a genuine blocker exists.
6. Items marked **[DECISION]** are final defaults chosen where the PDF is silent (they are listed in Appendix D). Implement them exactly as written, make them configurable where stated, and record them in `docs/DECISIONS.md`. They are not open questions, so do not stop to ask about them. The owner can change a default later through configuration.
7. Do not use em dashes in any generated documentation, UI text, comments, or commit messages.

## 1. ROLE

Act as a senior full-stack engineer, systems analyst, UI/UX designer, database architect, security engineer, and QA engineer.

Inspect, complete, test, and refine my existing project into a working, responsive IT Service and Maintenance Management System.

- Website: https://itcmaintenancesystem.web.app/
- Figma kit reference: https://itcmaintenancesystem.web.app/figma-kit/everything.html

Do not produce only a design, prototype, static dashboard, or disconnected screens. Implement working navigation, forms, validation, workflows, persistence, permissions, reports, and responsive behavior inside the existing repository. Preserve useful existing work.

## 2. SOURCE OF TRUTH AND PRIORITY

1. **Priority 1: The documented workflow** (Sections 6 to 13 and Appendix A, which reproduce the PDF diagram text and SOP). Preserve every documented step, decision, branch, loop, and rule. Do not simplify in a way that removes a step or changes its meaning.
2. **Priority 2: The rest of this prompt** (modules, rules, tests).
3. **Priority 3: The existing repository architecture.** Extend it. Do not replace it without justification. Do not remove working features or break working routes without justification.
4. **Priority 4: Screenshot references** (ticket list, ticket details, dashboard). They guide the UI only, never the business workflow. Recreate the useful functionality in a modern interface, not the dated styling. If screenshots are not accessible, use Section 14.
5. **Priority 5: Visual design and usability.**

## 3. MANDATORY INITIAL INSPECTION

Before coding:

1. Inspect the working directory and repository.
2. Read package manifests, configs, routing, source, database schemas or Firestore rules, and docs.
3. List existing pages and features. Identify incomplete, duplicated, broken, and placeholder functionality.
4. Determine how data is persisted and how authentication works.
5. Identify test, lint, type-check, and build commands.
6. Check for any copy of the PDF or SOP in the repo.
7. Determine the Firebase plan constraints (see Section 12, Platform constraints) before choosing how to enforce rules.
8. Create `docs/IMPLEMENTATION_CHECKLIST.md` and work through it.

If a required detail is unavailable, make the smallest reasonable documented assumption and continue.

## 4. SWIMLANES AND ROLE RESPONSIBILITIES (VERIFIED FROM THE PDF)

The PDF diagram has exactly four swimlanes, in this top to bottom order: **Office Requester or Office Representative**, **IT Coordinator**, **IT Technician**, **System**. The system administrator is an additional operational role, not a swimlane. The table below is taken from the actual lane placement of every node in the PDF (see Appendix B for the full node list).

| Lane | Responsibilities (as placed in the PDF) |
|---|---|
| Office Requester or Office Representative | Start: office needs IT assistance. Submit service request. Supply missing information. Review and verify service result. Decide: office accepts result (Accepted, Rejected, No response). Record confirmation, confirming person, and date. Record office feedback. Create new ticket linked to previous service record (recurrence). Agree on new maintenance date. |
| IT Coordinator | Start of the maintenance path. Create maintenance schedule. Enter telephone, email, walk-in, or on-site request. Review request. Decide: details complete. Request missing details. Assess impact and urgency. Set priority and target completion date. Assign technician. Follow up dependency. Decide: dependency outcome. Record follow-up updates. Record cancellation reason. Assign technician and coordinate visit (maintenance). |
| IT Technician | Review ticket and previous office or asset history. Coordinate service schedule. Diagnose issue and record findings. Decide: parts, approval, or external support needed. Record dependency, reason, responsible person, and next action. Perform repair, installation, configuration, troubleshooting, or other IT service. Record diagnosis, actions, parts, costs, labor, dates, and evidence. Test result. Decide: service passed testing. Record failed test. Perform maintenance checklist using Section 2. Record task, result, findings, technician, date, and evidence. Decide: additional fault discovered. Continue maintenance verification. |
| System | Record service request and create the ticket number. Set every status (Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved, Closed, Cancelled). Update existing ticket when information is supplied. Notify technician and requester. Notify office ready for confirmation. Notify requester on cancellation. Keep status Resolved and send follow-up reminder. Preserve records and activity history. Status and audit history. Update office service history and reporting. Decide: issue recurs after closure, and End (service record retained). Record maintenance schedule. Check maintenance schedule. Decide: maintenance due. Keep schedule active and wait. Check job for schedule occurrence. Decide: job already exists. Use existing job. Generate linked maintenance job and Maintenance Job Record. Decide: office available. Record reschedule. Create linked corrective ticket. Record maintenance outcome. Do not mark incomplete or cancelled maintenance successful. Update office and asset service history. Calculate next due date. Office IT Service Register. Generate Office IT Service Reports with filters. |
| System Administrator (extra, not in the PDF) | Manage users, roles, offices, categories, assets, and configuration. May perform authorized closure if configured. Cannot edit audit history. |

How to interpret the System lane: System steps are automated or rule-driven behavior of the application (status changes, notifications, record keeping, scheduled checks, calculations). A human role triggers them by completing its own step (for example, the technician records a passed test and the system then sets Resolved). The one System-lane decision that needs human input is "Office available?": the Office Requester states availability or proposes a new date, the system records the answer and the reschedule.

Enforce this matrix on the trusted backend or database rules, not only in the UI.

## 4A. ROLE-BASED FEATURES AND ROLE-ALIGNED WORKFLOW (MANDATORY)

### 4A.1 Principle

Every user sees and does only what their role owns in the PDF swimlanes (Section 4). Every navigation item, page, button, dashboard widget, report, notification, and API operation is tied to a role. If a step belongs to another lane, the user gets no control for it, only a read-only view where reading is allowed. Hiding a button is never enough: the same rule must be enforced on the backend or database rules.

Create ONE shared permission map (for example `permissions.ts`) that lists, for each role, the allowed pages, actions, status transitions, and data scope. The frontend and the backend must both read from it (or mirror it exactly), and tests must verify it. Document it in `docs/ROLE_MATRIX.md`.

### 4A.2 Feature matrix per role

**Office Requester or Office Representative (data scope: only offices they belong to)**

- Navigation: Dashboard (own offices), Tickets, New Request, Office Register (read-only), Maintenance Visits (read-only list of visits for their offices), Workflow Guide, Notifications, Profile.
- Can: submit a request, supply missing information when the ticket is Needs Information, reply and attach files, view the conversation (never internal notes), view diagnosis summary and test result, review and verify the service result, accept the result (confirmation, confirming person, and date are recorded, status Closed), reject the result with feedback (status In Progress), create a new linked ticket from a Closed ticket when the issue recurs, answer maintenance availability and agree on a new maintenance date, confirm maintenance results through the same confirmation steps, request withdrawal of an active request (this sends a message to the IT Coordinator, who records the cancellation reason, because the PDF places that step with the IT Coordinator).
- Cannot: set priority or target date, assign technicians, diagnose, record tests, change a status other than accept or reject, see other offices, see internal notes or internal cost details **[DECISION]**, edit schedules, run organization-wide reports, or manage users.
- Reports: service history for their own offices only.

**IT Coordinator (data scope: all offices)**

- Navigation: Dashboard (all offices), Tickets (all), New Request (on behalf of an office), Maintenance Schedules, Maintenance Jobs, Office Register, Reports, Workflow Guide, Notifications, Profile.
- Can: enter telephone, email, walk-in, or on-site requests, review requests, request missing details (status Needs Information), assess impact and urgency, set priority and target date, assign and reassign the technician (status Assigned, notifications sent), follow up dependencies, record follow-up updates, choose the dependency outcome (resolved returns to In Progress, still pending stays On Hold, cannot proceed leads to cancellation), record the cancellation reason (status Cancelled), perform authorized closure when configured (reason required), send a manual reminder when automatic reminders are not available, create and edit maintenance schedules, assign the maintenance technician and coordinate the visit, record a reschedule on behalf of the office, run all reports, add internal notes.
- Cannot: diagnose, record test results, mark Resolved, accept or reject a result for the office (except authorized closure), edit audit history, or manage users and system settings.

**IT Technician (data scope: tickets and maintenance jobs assigned to them, plus read-only office and asset history for those offices)**

- Navigation: Dashboard (my workload), My Tickets (assigned to me), My Maintenance Jobs, Office Register (read-only, limited to offices linked to their assigned work), Workflow Guide, Notifications, Profile.
- Can: review the ticket and previous office or asset history, coordinate the service schedule, start work (status In Progress), diagnose and record findings, record a dependency and place the ticket On Hold (dependency, reason, responsible person, next action), record actions, parts, materials, costs, labor, dates, and evidence, record the test result (a failed test is recorded and work returns to diagnosis, a passed test allows Resolved), perform the maintenance checklist and record each task, flag an additional fault (the system creates the linked corrective ticket), add internal notes.
- Cannot: assign or reassign tickets, set priority or target date, cancel a request, close a ticket, edit maintenance schedules, see other technicians' tickets, run organization-wide reports (only their own workload and completed work).

**System (automated behavior, not a user)**

- No screens or buttons. Implements: unique ticket numbers, recording requests, setting statuses after the human step is complete, notifications, reminders for Resolved tickets, preserving records and audit history, updating the register and reporting data, the scheduled maintenance check, occurrence check, job generation, corrective ticket creation, next due date calculation, and report generation.
- Events done by the system appear in the ticket timeline with the actor labeled "System".

**System Administrator (extra role, not a swimlane)**

- Navigation: Administration (users, roles, office membership, offices, categories, assets, configuration), read-only Audit viewer, Workflow Guide, Notifications, Profile.
- Can: manage users and roles, offices and memberships, categories (including the optional approval flag), assets, and configuration. Authorized closure only if configured.
- Cannot: edit or delete audit history, or perform operational ticket steps unless the person is also assigned an operational role **[DECISION]**.

### 4A.3 Who acts next (drives queues, badges, and notifications)

| Ticket status | Next action owner |
|---|---|
| Submitted | IT Coordinator (review) |
| Needs Information | Office Requester (supply information) |
| Assigned | IT Technician (review, coordinate schedule, start work) |
| In Progress | IT Technician (diagnose, service, test) |
| On Hold | IT Coordinator (follow up the dependency) |
| Resolved | Office Requester (confirm or reject) |
| Closed, Cancelled | Nobody (record retained, recurrence creates a new ticket) |

| Maintenance job step | Next action owner |
|---|---|
| Job generated, not yet assigned | IT Coordinator (assign technician and coordinate visit) |
| Availability unconfirmed or office unavailable | Office Requester (confirm availability or agree on a new date) |
| Checklist in progress | IT Technician |
| Awaiting confirmation | Office Requester |

Show a "Needs my action" queue on each role's dashboard and a "Waiting on" label (role name) on every ticket and maintenance job. The ticket detail page shows only the actions the current user may perform in the current status, and states who must act next when the user has none.

### 4A.4 Role-aligned workflow view

- Create a **Workflow Guide** page that draws the documented flowchart as four horizontal swimlanes in the same order and with the same names as the PDF (Office Requester or Office Representative, IT Coordinator, IT Technician, System), using Appendix B for the steps and arrows. Use the same shapes as the PDF (rounded start, rectangles, diamonds). Build it from data (the typed nodes and edges in Appendix C), not a static image, and include every node and edge from Appendix C, so it stays aligned with the implemented workflow.
- Add a role filter: by default highlight the current user's lane and dim the other lanes, and offer "Show all lanes". Mark the user's own steps clearly.
- On the ticket detail page, the workflow stepper must mark the current step and the owning lane or role so the screen and the flowchart tell the same story.
- Lane names, role names, status names, and action names must be identical across the sidebar, badges, buttons, timeline, notifications, reports, and the Workflow Guide. Do not use alternative labels.
- On mobile, show the Workflow Guide as a vertical, lane-grouped list with the same content.

## 5. TERMINOLOGY AND SECTION MAP

The PDF refers to Sections 1, 2, 3. They map as follows:

- **Section 1:** Request intake, review, and assignment (Section 7 of this prompt).
- **Section 2:** Diagnosis and service execution (Section 8).
- **Section 3:** Office confirmation, cancellation, and closure (Section 9).
- **Section 4:** Preventive maintenance (Section 10).
- **Section 5:** Central records, audit history, and reporting (Sections 11 and 16).

## 6. EXACT TICKET STATUS MODEL

Use these eight labels exactly, with no alternatives: **Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved, Closed, Cancelled.**

### 6.1 Transition matrix (reject everything else on the backend)

| From | To | Allowed actor | Required data |
|---|---|---|---|
| (new) | Submitted | Office Requester, or IT Coordinator on behalf of an office | Office, requester, category, issue, date reported, source. Asset when applicable. |
| Submitted | Needs Information | IT Coordinator | Missing details requested (text) |
| Needs Information | Submitted | Office Requester (or IT Coordinator recording info received by phone, email, or walk-in) | Information supplied. Same ticket. No new ticket. |
| Submitted | Assigned | IT Coordinator | Impact, urgency, priority, target completion date, technician |
| Assigned | In Progress | Assigned IT Technician | Schedule coordinated (date or note) |
| In Progress | On Hold | IT Technician | Dependency, reason, responsible follow-up person, next action |
| On Hold | In Progress | IT Coordinator | Dependency resolved note |
| In Progress | Resolved | Assigned IT Technician | A passed test record and service summary exist |
| Resolved | Closed | Office Requester or authorized office representative (accept), or authorized closure (Section 6.3) | Confirming person and date. Or closure authorizer, reason, and date. |
| Resolved | In Progress | Office Requester (reject) | Office feedback. Ticket returns to the assigned technician for diagnosis. |
| Submitted, Needs Information, Assigned, In Progress, On Hold | Cancelled | IT Coordinator | Cancellation reason |
| Resolved | Cancelled | IT Coordinator **[DECISION]** | Cancellation reason |
| Closed, Cancelled | none | none | Terminal states. Issue recurrence creates a NEW linked ticket. |

Notes:

- A failed technician test does not change status. The ticket stays In Progress, the failed test is recorded, and work returns to diagnosis.
- Reassigning a technician while the ticket is Assigned, In Progress, or On Hold keeps the status and writes an assignment-change audit event. **[DECISION]**
- **Cancellation as drawn in the PDF:** the PDF draws withdrawal ("Active request withdrawn") from the Assigned status, and "Cannot proceed" from the dependency decision on a request that was On Hold. SOP step 7 says "if the request is withdrawn" without limiting the status, so cancellation from Submitted, Needs Information, In Progress, and Resolved is kept as a permitted extension **[DECISION]**. Make the allowed source statuses configurable.
- **After a resolved dependency the PDF returns to In Progress and goes straight to "Perform repair, installation, configuration, troubleshooting, or other IT service"** (it does not repeat the diagnosis step).
- **After an office rejection the PDF sets In Progress and returns to "Diagnose issue and record findings".**
- Whenever the technician or the system decides a dependency cannot proceed, the IT Coordinator cancels with a reason (documented cancellation path).

### 6.2 Critical rules

- Resolved means technician testing passed. It does not mean the office confirmed.
- Never close a ticket merely because testing passed.
- Never auto-close a Resolved ticket because the office did not respond. Keep it Resolved and send a reminder.
- Reject: record feedback, return to the assigned technician, status In Progress.
- Accept: record confirming person and confirmation date, then Closed.
- Cancellation preserves all records and activity history.
- A recurring issue creates a new linked ticket and never overwrites the old one.
- Invalid transitions are rejected by trusted backend or database rules.

### 6.3 Authorized closure

**[DECISION]** The PDF says "authorized closure" without defining who. Implement: only IT Coordinator or System Administrator, only from Resolved, with a mandatory reason, actor, and timestamp, shown visibly in the ticket history as "Authorized closure". Lack of response alone is never acceptance. Make the permitted roles configurable.

## 7. SECTION 1 WORKFLOW: REQUEST INTAKE AND ASSIGNMENT

1. Office needs IT assistance.
2. The office submits a request, or an IT Coordinator enters a telephone, email, walk-in, or on-site request.
3. The system records the request, creates a unique ticket number, and links it to any previous service record when one is given (SOP step 2).
4. Required capture: office, location, requester, contact details, category, issue description, date reported, asset or equipment tag when applicable, attachments, and request source.
5. Request source values: **Online Portal, Telephone, Email, Walk-in, On-site.** **[DECISION]** (the PDF names the four assisted channels, and the direct office submission is the portal).
6. Status is set to Submitted.
7. The IT Coordinator reviews the request.
8. Decision: details complete?
   - No: status Needs Information, request missing details, Office Requester supplies them, the system updates the existing ticket, and it returns to review as Submitted. No new ticket.
   - Yes: assess impact and urgency, set priority and target completion date, assign technician, status Assigned, notify technician and requester.
9. Continue to Section 2.

Services without physical equipment (account assistance, software support) must be supported with no asset. Prevent duplicate submissions where practical (idempotency key plus double-click protection). Both intake channels must create valid records and follow the same review and assignment workflow.

**Priority matrix [DECISION]:** Impact (Low, Medium, High) and Urgency (Low, Medium, High) map to Priority (Low, Medium, High, Critical). Store impact, urgency, and priority separately. Make the matrix configurable.

**Categories [DECISION]:** a configurable table. Seed examples: Hardware Repair, Software Support, Network and Connectivity, Account Assistance, Printer and Peripheral, Installation and Configuration, Other.

## 8. SECTION 2 WORKFLOW: DIAGNOSIS AND SERVICE EXECUTION

1. Technician reviews the ticket and previous service history for the office or asset.
2. Coordinate the service schedule with the office.
3. Set In Progress.
4. Diagnose and record findings.
5. Decision: parts, approval, or external support needed?
   - Yes: set On Hold. Record dependency, reason, responsible follow-up person, and next action.
   - The IT Coordinator follows up and records each update.
   - Still pending: stay On Hold, record updates.
   - Resolved: set In Progress and continue.
   - Cannot proceed: follow the cancellation procedure (Section 9).
   - No: perform the work.
6. Approval applies only where organizational policy requires it. **[DECISION]** Implement as a per-category flag, default off. Do not require approval for every service.
7. Perform repair, installation, configuration, troubleshooting, or other IT service.
8. Record diagnosis, actions, parts, materials, actual costs (currency PHP), labor time, actual service dates, and supporting evidence.
9. Test the result.
   - Fail: record the failed test and return to diagnosis.
   - Pass: record the successful test and service summary, set Resolved, and notify the office that confirmation is required.
10. Continue to Section 3.

## 9. SECTION 3 WORKFLOW: CONFIRMATION, CANCELLATION, AND CLOSURE

1. The office reviews and verifies the result.
2. Decision: does the office accept?
   - Accepted: record confirmation, confirming person, and date, then Closed.
   - Rejected: record feedback, return to the assigned technician, In Progress, back to diagnosis.
   - No response: keep Resolved and send a follow-up reminder. Return to the decision when the office responds. Reminder interval is configurable. **[DECISION]** default 3 business days. The reminder is an audit event and never changes the status.
3. Cancellation: the IT Coordinator records the reason, the system sets Cancelled, notifies the requester, and preserves all records and history.
4. After closure or cancellation, update office service history and reporting records. Keep cancelled requests separate from completed totals.
5. If the issue recurs after closure, the Office Requester creates a new ticket linked to the previous record (an IT Coordinator may do so on behalf of the office) and Section 1 is followed. Only Closed tickets can be the source of a recurrence link. If it does not recur, the record is retained and the workflow ends.

## 10. SECTION 4 WORKFLOW: PREVENTIVE MAINTENANCE

1. The IT Coordinator creates a maintenance schedule with: office, relevant assets (when applicable), maintenance category, checklist, frequency, next due date, and assigned technician.
2. The system checks the schedule at each configured interval.
3. Decision: maintenance due? No: keep the schedule active and wait.
4. Yes: check whether a job already exists for this schedule occurrence.
   - Exists: use the existing job. Do not create a duplicate.
   - Missing: generate a maintenance job linked to office, schedule, and relevant assets.
5. Assign the technician and coordinate the visit.
6. Confirm office availability (the Office Requester answers, the System records it).
   - Unavailable: the Office Requester agrees on a new date, the System records the reschedule (old date, new date, reason, who agreed), and the availability check repeats on the agreed date.
   - Available: perform the checklist using the approved procedure and the applicable service workflow (Section 2).
7. For each checklist item record: task performed, result, findings, technician, actual service date, supporting evidence.
8. Decision: additional fault discovered?
   - Yes: create a separate corrective ticket linked to the maintenance job, follow Section 1 for it, and keep documenting the maintenance job independently.
   - No: continue maintenance verification.
9. Use Section 3 for office confirmation and closure of the maintenance.
10. Record the maintenance outcome. Do not mark incomplete or cancelled maintenance as successful.
11. Update office and asset service history.
12. Calculate the next due date from the configured schedule and return to the scheduled check.

### 10.1 Implementation rules

- **Occurrence identifier:** `scheduleId + occurrenceDueDate` (for example `SCH123_20261101`). Use it as the deterministic document ID or a unique constraint. Generate the job inside a transaction that first checks for the existing ID.
- **Maintenance job status [DECISION]:** reuse the same eight status labels, so Section 3 confirmation and closure applies unchanged. Add a separate **outcome** field: Successful, Incomplete, Cancelled. Only Closed jobs with at least all checklist items completed may have outcome Successful. Incomplete or Cancelled jobs can never be Successful.
- **Next due date [DECISION]:** configurable. Default is fixed cadence (previous scheduled due date plus frequency), so completion delays do not drift the schedule. The next due date is still advanced after an incomplete or cancelled outcome, with that outcome recorded honestly.
- **Schedule check trigger:** see Section 12, Platform constraints.
- Maintenance records stay separate from corrective tickets, with relationships preserved.

## 11. AUDIT HISTORY AND DATA INTEGRITY

For every status change record: actor, server timestamp, previous status, new status, remarks.

Also record: ticket creation, information requests and responses, assignment changes, diagnosis, service actions, dependency updates, test results, office feedback and confirmation, cancellation reasons, checklist results, reschedules, corrective ticket creation, closure, authorized closure, reminders, and relevant attachment or record changes.

- Audit history is append-only. Database rules must deny update and delete.
- Use server timestamps. Display in Asia/Manila consistently.
- Completed records (Closed, Cancelled) cannot be edited except through explicitly authorized, audited actions.
- Use relationships instead of duplicating data.

## 12. DATABASE, BACKEND, AND PLATFORM CONSTRAINTS

Use the existing backend. If Firebase is in use, reuse it. Do not create a second database. Do not use localStorage as the production database. Keep secrets and privileged credentials out of client code.

Enforce authorization, validation, and transitions on a trusted layer. Prefer Cloud Functions (callable) for transitions, assignment, job generation, and notifications. Use transactions or batched writes for operations that must not partially succeed.

**Platform constraints to resolve during inspection:**

- Cloud Functions and scheduled functions require the Firebase Blaze plan. If the project is on Spark, do this instead and document it: enforce transitions with Firestore Security Rules (field-level validation, allowed-transition checks, role checks, append-only audit), generate maintenance jobs and send reminders through an authorized "Run schedule check" action by the IT Coordinator that is idempotent via the occurrence ID, and state clearly that fully automatic scheduling needs Blaze plus Cloud Scheduler.
- Email delivery is an external dependency. Implement in-app notifications as the working default and an email integration boundary (for example a Trigger Email extension or provider interface). Do not pretend email works if it is not configured.
- Attachments: restrict file types and size, validate on the trusted layer or Storage rules, and apply office-level access to files.

Notification events (in-app at minimum): assigned (technician and requester), information requested (requester), information supplied (coordinator), On Hold and follow-ups (requester), Resolved ready for confirmation (office), reminder (office), rejected (technician), Closed (technician and coordinator), Cancelled (requester), maintenance job generated, rescheduled, and corrective ticket created.

Seed or demo data only in an explicitly labeled development environment. Never present fake data as live.

## 13. REQUIRED MODULES

### A. Authentication and user management
Sign-in is Google sign-in with UPMail on the existing Firebase Auth, limited to the institutional domain, exactly as in Section 14.15. Roles come from a provisioned user profile, never from the client.
Use the existing auth provider. Roles: Office Requester (also called Office Representative), IT Coordinator, IT Technician, System Administrator. A user can belong to one or more offices through a user-office membership record. Office users access only records of their offices. IT roles follow the matrix in Section 4. Enforce server-side. No insecure hardcoded auth.

### B. Dashboard
Responsive, backed by real queries (no hardcoded chart values). Include: counts per status (Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved awaiting confirmation, Closed, Cancelled), pending and overdue, technician workload, turnaround, service costs, recurring issues, preventive maintenance compliance, ticket activity over a selectable date range, and department, category, and technician statistics. Provide loading, empty, error, and refresh states. Include export where practical.

### C. Ticket list
From the screenshot reference: ticket number, last update, subject, requester, priority, department or office. Navigation: Open, My Tickets, Closed, Search, New Ticket. Search by ticket number, subject, requester, and permitted fields. Advanced filters: status, priority, office, category, technician, date range. Sorting, pagination, ticket creation, and role- and status-appropriate row actions. Status indicators use text plus icon, never color alone. Desktop: table. Small screens: compact cards. No unusable shrunken table.

### D. Ticket details and conversation thread
Show: ticket number, subject, status, priority, category, office, requester and permitted contact details, assigned technician, created and last-updated times, target date and actual service dates, asset information, description, attachments, previous service history for the office or asset, linked tickets (previous record, recurrence, corrective), maintenance linkage, dependency information, diagnosis and actions, parts, costs, labor, test results, office confirmation and feedback, cancellation reason.

Include a chronological thread and activity history, a reply composer, attachments, assignment controls, and status controls. **Internal notes are visible to IT roles only. Office users must never receive them**, enforced at the data layer. Every action validates permissions and business rules.

### E. New service request form
Fields per Section 7. Coordinator mode includes request source and the "on behalf of office or requester" selection. Validation near fields, input preserved on error, double-submit protection, optional "previous service record" link.

### F. Preventive maintenance module
Schedule create and edit, due and overdue indicators, job generation with duplicate prevention, technician assignment, availability confirmation, reschedule history, checklist execution with task-level evidence, additional-fault flag and corrective ticket creation, outcome recording, history updates, and next due date calculation. Follow Section 10.

### G. Office IT Service Register
Central, reliable links among: Office, Requester, Ticket, Technician, Category, Asset, Maintenance schedule, Maintenance job, Corrective ticket, Conversation entry, Status history, Evidence. Include primary and foreign keys or equivalent references, indexes, validation, and transactions. Ticket creation, service updates, confirmation, cancellation, and maintenance outcomes update it consistently.

### H. Reporting
Required reports: service history per office, completed services by category and period, pending and overdue requests, technician workload, service turnaround time, recorded service costs, recurring issues, preventive maintenance compliance.

Filters: office, date range, category, technician, status. Provide charts with accompanying tables, summary stats, and export (CSV at minimum). Reports respect role and office-level permissions, including exports.

**Metric definitions [DECISION]. Document these in `docs/REPORT_DEFINITIONS.md` and use them everywhere:**

- **Completed service:** a ticket in Closed status. Resolved tickets are reported separately as "Awaiting confirmation" and never counted as Closed.
- **Cancelled:** always reported separately and excluded from completed totals.
- **Overdue:** target completion date has passed and status is not Resolved, Closed, or Cancelled.
- **Turnaround time:** from ticket creation (Submitted) to Resolved timestamp, in business-agnostic elapsed hours. Also show creation to Closed as "time to closure". Exclude Cancelled.
- **Costs:** sum of recorded actual costs (parts, materials, labor cost if recorded) on tickets in the filtered set, shown by category and office.
- **Recurring issue:** a ticket created with a link to a previous Closed ticket. Group by recurrence chain, office, category, and asset.
- **Preventive maintenance compliance:** Closed jobs with outcome Successful divided by maintenance occurrences that came due in the period, shown with counts. Incomplete and cancelled jobs count as non-compliant.

## 14. UI DESIGN, RESPONSIVENESS, AND ACCESSIBILITY

### 14.1 Design goal

The interface must look professional, formal, calm, and trustworthy, like a modern institutional IT service management product. It must be pleasant to look at for long working sessions: clean alignment, generous but efficient spacing, a restrained color palette, clear hierarchy, and consistent components on every page. It must feel like one product, not a collection of separate pages.

Before building pages, create a small design system, and then build every page from it. Document it in `docs/DESIGN_SYSTEM.md` and implement it as design tokens (CSS variables or the project's theme file) plus reusable components. Reuse the existing styling system and component library of the project if there is one. Use the Figma kit page only as a component reference. Do not import every component from it, and do not copy the old ticket-system look from the screenshots.

### 14.2 Visual language (use these defaults unless the project already has an approved brand)

**Color tokens** (adjust slightly to match existing institutional colors or logo, keep contrast accessible):

- Primary (navy): `#1E3A5F`. Primary hover: `#162C48`. Used for the sidebar, primary buttons, and key headings.
- Accent (blue): `#2563EB`. Used for links, focus rings, selected states, and chart highlights.
- Background: `#F5F7FA`. Surface (cards, tables, dialogs): `#FFFFFF`. Subtle surface (table headers, side panels): `#F8FAFC`.
- Border: `#E2E8F0`. Strong border: `#CBD5E1`.
- Text: primary `#0F172A`, secondary `#475569`, muted `#64748B`, disabled `#94A3B8`.
- Semantic: success `#15803D` on `#DCFCE7`, warning `#B45309` on `#FEF3C7`, danger `#B91C1C` on `#FEE2E2`, info `#1D4ED8` on `#DBEAFE`, neutral `#334155` on `#F1F5F9`.
- Use color sparingly. The page should be mostly white, light gray, and navy, with color reserved for status, priority, and the single primary action on a screen.

**Typography:**

- Use the font already in the project. Otherwise use Inter with the fallback stack `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Do not depend on a font that fails to load.
- Scale: 12px (captions, badges), 14px (body and table text), 16px (form inputs on mobile, large body), 20px (section titles), 24px (page titles), 32px (dashboard key numbers). Line height 1.4 to 1.6 for text.
- Weights: 400 body, 500 labels and table headers, 600 headings. Sentence case everywhere. No all-caps paragraphs, no decorative fonts.
- Use tabular numbers for counts, costs, and dates so columns align.

**Spacing, shape, depth:**

- 4px spacing grid (4, 8, 12, 16, 24, 32, 48). Page padding 24px on desktop, 16px on mobile. Card padding 16 to 24px.
- Corner radius 6px for inputs and buttons, 8px for cards and dialogs. Do not round everything heavily.
- 1px borders as the main separator. One subtle shadow level for cards and one for floating layers (menus, dialogs, drawers). No heavy shadows, no glow effects.
- No decorative gradients, patterns, or large background images anywhere, with one required exception: the login page (Section 14.15) uses a full-viewport campus photo and glass panel exactly as specified.

**Icons and imagery:**

- One consistent outline icon set (for example Lucide or the set already in the project), 16 or 20px, with the same stroke width. Pair icons with text labels in navigation and badges. No emoji in the interface.
- Use the institution's existing logo without distortion. If no logo exists, use a simple text wordmark. Do not invent official branding.

**Motion:**

- Short transitions only (120 to 200 ms) for hover, focus, drawers, and dialogs. Skeleton loaders for loading. Respect `prefers-reduced-motion`.

### 14.3 Application shell and layout

- **Desktop:** fixed left sidebar (about 240px, collapsible to an icon rail) in navy with white text, grouped navigation (Overview: Dashboard; Service: Tickets, New Request; Maintenance: Schedules, Jobs; Records: Office Register; Insights: Reports; Administration: Users, Offices, Categories, Assets, Settings). Show only the items the user's role may use (see Section 4A.2).
- **Top bar:** page breadcrumb on the left; global ticket search, notification bell with unread count, and user menu (name, role, office, sign out) on the right.
- **Page header pattern on every page:** page title, one line of helper text, and the primary action button aligned right. Content below in cards or tables with consistent gutters. Maximum content width about 1440px, centered on very large screens.
- **Tablet:** sidebar collapses to an icon rail or an overlay drawer. **Mobile:** top bar with a menu button that opens a full-height drawer. Bottom or inline primary actions must be reachable with one thumb.

### 14.4 Core components (build once, reuse everywhere)

- **Buttons:** primary (navy fill), secondary (white with border), ghost, and danger. One primary button per section. Clear disabled and loading states. Minimum 40px height on desktop and 44px touch target on mobile.
- **Form controls:** visible labels above inputs, helper text, required marker, inline error text in danger color with an icon, and focus ring in accent blue. Group related fields in titled sections with clear spacing. Use proper input types (tel, email, date). Use a searchable select for offices, assets, and technicians.
- **Status badge:** pill with an icon and the exact status text, never color alone. Suggested pairs: Submitted (info blue), Needs Information (warning amber), Assigned (indigo `#4338CA` on `#E0E7FF`), In Progress (blue), On Hold (orange `#C2410C` on `#FFEDD5`), Resolved (teal `#0F766E` on `#CCFBF1`), Closed (success green), Cancelled (neutral gray). Resolved and Closed must look clearly different.
- **Priority badge:** Low (neutral), Medium (info), High (warning), Critical (danger), with an icon and text.
- **Tables:** sticky header, 14px text, comfortable row height, subtle row hover, clear sort indicators, right-aligned numbers, a compact density toggle, pagination with page-size control, and a visible empty state. Ticket number is a link. Row actions go in a kebab menu. On mobile, switch to stacked cards that show ticket number, subject, status, priority, office, and last update.
- **Cards and stat tiles:** white surface, 1px border, small uppercase-free label, large number, and an optional trend or secondary line. Align tiles on a grid.
- **Tabs, breadcrumbs, pagination, tooltips, dropdown menus, toasts (top right, auto dismiss, with close), confirmation dialogs (for cancel, authorized closure, reject), and side drawers (for filters and quick edit).**
- **Feedback states:** skeleton loading, friendly empty states with a short explanation and a relevant action, and error states with a retry button. Never show a blank screen.
- **Workflow stepper:** on ticket detail, show a horizontal (desktop) or vertical (mobile) progress indicator of the documented path Submitted, Assigned, In Progress, Resolved, Closed, with On Hold, Needs Information, and Cancelled shown as branch states. The current step is highlighted.
- **Timeline:** the conversation and activity history as a vertical timeline with avatar, actor name and role, timestamp (Asia/Manila), event type icon, and message. Internal notes use a distinct subtle amber background and an "Internal note" label, visible to IT roles only.

### 14.5 Page designs (build each as described)

1. **Login:** build exactly as specified in Section 14.15 (required reference design).
2. **Dashboard:** row of stat tiles (Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved awaiting confirmation, Closed, Cancelled, Overdue), then a ticket activity chart with date-range selector next to a status breakdown chart, then tables or charts for technician workload, category, office, recurring issues, turnaround, costs, and preventive maintenance compliance. A refresh button and last updated time at the top. Prioritize the few most important items above the fold.
3. **Ticket list:** toolbar with search box, status tabs (Open, My Tickets, Closed, All), an Advanced filters drawer (status, priority, office, category, technician, date range), sort control, and a New Ticket button. Active filters appear as removable chips. Columns: ticket number, subject, requester, office, category, priority, status, assignee, last updated.
4. **Ticket detail:** header with ticket number, subject, status badge, priority badge, and the allowed action buttons for the user's role and the current status. Two-column layout on desktop: main column (workflow stepper, description, attachments, tabbed sections for Conversation, Service record with diagnosis, actions, parts, costs, labor, tests, Dependencies, and History) and a right properties panel (office, requester and contact, category, asset, assignee, priority, impact, urgency, dates, target date, linked tickets, maintenance link). Reply composer fixed at the bottom of the conversation with reply and internal note toggle, attachment button, and send. On mobile the properties panel becomes a collapsible section above the conversation.
5. **New service request:** a single clear form in titled sections (Office and requester, Service details, Asset, Attachments, Source for coordinators), inline validation, a summary of what will happen after submit, and a success screen showing the ticket number.
6. **Maintenance:** a schedule list with due and overdue indicators and a calendar or timeline view toggle; schedule form; job detail with the status stepper, availability and reschedule history, and an interactive checklist where each item has result, findings, date, technician, and evidence upload; a prominent panel for "Additional fault found" that creates a linked corrective ticket.
7. **Office IT Service Register:** office selector, summary header (open, resolved, closed, cancelled, recurring counts), tabs for Service history, Assets, Maintenance, and Audit trail.
8. **Reports:** a sticky filter bar (office, date range, category, technician, status), summary tiles, chart plus data table for each report, definitions shown in a help popover, and Export (CSV at minimum, print-friendly view).
9. **Administration:** clean list and form pages for users, roles, office membership, offices, categories, assets, and configuration. Visible to System Administrators only.
10. **Workflow Guide:** the four-lane flowchart described in Section 4A.4, with the role highlight filter.
11. Every page above is shown only to the roles listed in Section 4A.2, and the content on each page is limited to that role's data scope.

### 14.6 Content and tone

Formal, concise, and neutral. Sentence case labels. Clear button verbs (Assign technician, Record diagnosis, Mark as resolved, Confirm result, Reject result, Cancel request). Error messages say what happened and how to fix it. Dates as `MMM d, yyyy h:mm a` in Asia/Manila. Currency in PHP with thousands separators. No slang, no exclamation marks, and no emoji.

### 14.7 Responsiveness

- Support 320 px and up with no horizontal page overflow. Verify at 320, 375, 390, 430, 768, 1024, 1280, and 1440 px.
- Do not simply shrink the desktop layout. Reorganize: stacked forms, cards instead of wide tables, drawers instead of side panels, collapsible filters, and scrollable chart containers.
- Wide tables, code, and diagrams scroll inside their own container. Touch targets at least 44px.

### 14.8 Accessibility

Semantic HTML, correct heading hierarchy, labels bound to inputs, full keyboard operation, visible focus states, contrast of at least 4.5:1 for text, accessible dialogs (focus trap, Escape to close, return focus), accessible error messages (aria-live and aria-describedby), alt text for informative images, charts with accompanying data tables, status and priority never shown by color alone, and reduced motion support.

### 14.9 Validation and forms

Validate required fields, dates, numbers, file types and sizes, and permissions. Show errors next to the field, keep the user's input after an error, prevent double submits, and show loading states on submit buttons.

### 14.10 Avoid

Excessive gradients, decorative backgrounds (except on the login page, Section 14.15), heavy shadows, neon or saturated colors, many different fonts, tiny text, overly rounded everything, crowded dashboards, inconsistent spacing, buttons that do nothing, fake data in production views, and unrelated modules.

### 14.11 Visual quality gate (required before finishing)

Run the app and use a headless browser (for example Playwright) to capture screenshots in BOTH light and dark mode of the login, dashboard, ticket list, ticket detail, new request, maintenance schedule, maintenance job, register, reports, and administration pages at 390, 768, and 1440 px. Review them for alignment, spacing, overflow, truncation, contrast, and consistency, fix the problems found, and save the final screenshots in `docs/screenshots/`. If a browser cannot be run, say so in `docs/KNOWN_LIMITATIONS.md` and do a code-level review of the same items instead. Do not claim a visual review that was not done.

### 14.12 Light and dark mode (required)

- Provide Light, Dark, and System options. Default to System (`prefers-color-scheme`). Put the toggle in the user menu and on the login page. Apply the saved choice before first paint so there is no flash. Store the choice on the user profile when signed in, with a try/catch-guarded local fallback for the device. Set `color-scheme` and the browser `theme-color` meta tag to match.
- Implement themes only through design tokens (CSS variables). No page may hard-code a color.
- **Light tokens:** the values in Section 14.2. Never use pure white as the page background (page is `#F5F7FA`, cards are white) and never use pure black text.
- **Dark tokens (comfortable, not harsh):** page `#0B1220`, surface `#111B2E`, subtle surface `#16233A`, border `#24344F`, text `#E5EDF8`, secondary text `#B4C2D6`, muted `#8FA1BA`, accent `#60A5FA`. Primary buttons use the accent fill with dark text. Never use pure black backgrounds or pure white text.
- **Status and priority badges in dark mode (desaturated):** Submitted `#93C5FD` on `#13294F`, Needs Information `#FCD34D` on `#3D2E0B`, Assigned `#A5B4FC` on `#23275A`, In Progress `#93C5FD` on `#13294F`, On Hold `#FDBA74` on `#47230D`, Resolved `#5EEAD4` on `#0F3A36`, Closed `#86EFAC` on `#14391F`, Cancelled `#CBD5E1` on `#1E293B`. Resolved and Closed must stay clearly different in both themes.
- Charts, tables, dialogs, drawers, toasts, form controls, the Workflow Guide, scrollbars, and printed or exported views must all follow the theme. Logos and images must remain readable in both themes (use transparent or theme-aware assets, never a white box on a dark page).
- Text and controls must meet contrast of at least 4.5:1 in both themes.

### 14.13 Web and mobile app fit

- One responsive codebase must feel good as a website and as a mobile app. Make the app an installable PWA: web app manifest (name, short name, theme and background colors, icons including maskable), a service worker that caches only the static app shell and assets, an offline fallback page, and standalone display mode. Never cache protected data in a shared cache, and clear private data on sign out.
- On phones use mobile-app patterns: a bottom tab bar for the role's four most used destinations (the rest in a More menu), a compact top bar with title and actions, safe-area padding (`env(safe-area-inset-*)`), 44 px touch targets, sticky primary action buttons where useful, bottom sheets instead of side drawers, swipe-friendly cards, and no hover-only interactions.
- Forms for mobile: correct input types and `inputmode`, `autocomplete` hints, large tap-friendly selects, date pickers that work on touch, and attachment inputs that allow taking a photo with the camera (`accept="image/*"` with `capture`) as supporting evidence.
- Respect landscape and small heights, avoid fixed heights that clip content, and prevent horizontal page scroll at 320 px.
- Push notifications and email are external dependencies. Build the in-app notification center first and put push behind a clear integration boundary (for example Firebase Cloud Messaging), reported honestly if not configured.
- On tablets and desktop, the same pages expand into the sidebar layout from Section 14.3.

### 14.14 Polish and eye comfort (make it look great)

- Calm, low-noise screens: at most three non-semantic colors on a page (navy, blue accent, neutrals), semantic colors only for status, priority, and feedback, no saturated or neon colors, and no more than one primary button per section.
- Strong visual hierarchy: clear page titles, section headings, muted helper text, and consistent alignment on the 4 px grid. Group related content in cards with consistent padding. Keep tables comfortable (not cramped) with a density option.
- Comfortable reading: body text 14 to 16 px with 1.5 line height, line length under about 80 characters in text blocks, tabular numbers in tables and tiles.
- Soft depth: 1 px borders and one subtle shadow level. No heavy shadows, glows, or decorative gradients.
- Smooth, subtle feedback: hover, focus, pressed, loading, and success states on every interactive element, skeleton loaders, friendly empty states with a simple inline SVG illustration, and short transitions that respect `prefers-reduced-motion`.
- Polished details: consistent icon set and stroke width, avatars with initials, relative plus exact timestamps (Asia/Manila), truncation with tooltips, and sensible default sort orders.
- Compare the result with `docs/reference/it-service-demo.html` (if present) and the screenshots, and raise the quality bar above them. Do not ship a page that looks inconsistent with the others.

### 14.15 Login page (REQUIRED, must match the owner's reference image)

The reference image is `docs/reference/UPLoginUI.PNG`. If you cannot view images, build it from the exact description below, which was written from that image. This overrides the generic login description in Section 14.5 and the "no large background images" rule in 14.2 and 14.10 (the login page is the one allowed exception).

**Overall composition**
- Full-viewport background photo of the University of the Philippines Cebu campus: the main building with the Oblation statue in the center, a warm sunrise sky with soft clouds on top, and green trees on both sides. Use `object-fit: cover` and center the statue. Keep the photo bright and natural. Add only a light neutral gradient or vignette for text legibility (stronger at the bottom and edges). Do NOT add a heavy dark green wash.
- Use the photo and the two seal logos that already exist in the project assets (look in the existing login page and public or assets folders). Do not invent or redraw official logos. If a file is missing, use a plain neutral background and a clear placeholder, and list it in `docs/KNOWN_LIMITATIONS.md`.
- One large rounded card centered horizontally and vertically, about 1000 px wide by 548 px tall at desktop (max width about 1000 px, never wider than the viewport minus 32 px), corner radius about 16 px, soft shadow, split into two equal halves.

**Left half (glass panel)**
- Frosted glass: translucent dark tint (about 30 to 40 percent), backdrop blur, 1 px light border (white at about 25 percent). The campus photo shows softly through it.
- Top left, 20 px from the edges: a small pill badge with a 1 px light border containing a small amber dot and the text "University of the Philippines Cebu" (13 px, white).
- Middle left: headline in a classical serif font (for example Libre Baskerville or Source Serif 4, fallback Georgia, "Times New Roman", serif), about 32 px, weight 600, slight letter spacing, white, two lines: **"Maintenance Management, from request to closure."**
- Below the headline: a short serif paragraph, about 14 px, white at about 85 percent, letter spaced slightly: **"Submit, track, and close IT service and maintenance requests efficiently with our user-friendly platform."**
- Bottom: three equal glass tiles in a row (each about 145 by 82 px, radius 14 px, 1 px light border, 12 px gap), each with a white outline icon (20 px) above a 13 px white label: **Live** (pulse or activity icon), **Secure** (shield-check icon), **Fast** (lightning icon).

**Right half (sign-in panel)**
- Solid soft off-white background (`#F8F8F6` in light mode), no border between halves except the change in surface.
- Vertically centered content, horizontally centered: the two circular seals side by side (about 60 px each, 6 px gap): the University of the Philippines seal and the University of the Philippines Cebu seal. Alt text: "University of the Philippines seal" and "University of the Philippines Cebu seal".
- Heading "Welcome back" in the same serif, about 24 px, weight 600, very dark green-gray text.
- Below it, a small uppercase sans-serif line (12 px, letter spacing about 0.04 em, dark gray, centered, two lines allowed): **"IT SERVICE AND MAINTENANCE MANAGEMENT SYSTEM"**.
- Then a full-width outlined pill button (about 320 px wide, 40 px tall, 1 px dark border, white or transparent fill, radius 999 px) with the Google "G" logo and the text **"Login with UPMail"** (14 px sans-serif). Hover: light gray fill. Focus: visible accent ring. Loading state: spinner and disabled.
- Under the button, a serif helper line (14 px, muted): **"Sign in using your existing "** followed by bold **"UPMail"** and a period.
- Error and notice messages appear below the helper line in a small accessible alert.

**Behavior**
- The button starts Google sign-in with the existing Firebase Auth Google provider and restricts accounts to the institutional domain `@upcebu.edu.ph` (configurable). Enforce the domain on the trusted layer (rules or function), not only with the `hd` hint on the client. A Google account outside the domain is rejected with a clear message.
- A signed-in user with no provisioned profile or role sees an "Access not granted" screen that explains they must be registered by the IT Coordinator or System Administrator, with a sign-out button. Never create privileged roles automatically.
- After sign-in, route by role (Section 4A): Office Requester to Dashboard (own offices), IT Coordinator to Dashboard (all offices), IT Technician to My Tickets, System Administrator to Administration.
- **Demo mode (development and demo environments only, behind an explicit flag such as `VITE_DEMO_MODE=true`):** after the user clicks "Login with UPMail", reveal a short labeled list of demo accounts (one per role) so roles can be previewed. Clearly mark it "Demo only". In production the flag is off, the list is never rendered, and demo accounts cannot sign in.
- Theme: Light, Dark, and System apply here too. In dark mode the right half uses the dark surface (`#111B2E`) with light text, the left glass panel keeps its glass look, and the seals remain fully visible. A small theme toggle sits in the top right corner of the page.

**Responsive**
- Tablet (up to 1024 px): keep the split card but reduce padding and sizes.
- Phone (up to 768 px): stack into one centered card. Show the pill badge and a compact two-line headline on a glass strip above (tiles hidden or reduced to icons), then the sign-in panel below it. The "Login with UPMail" button must be visible without scrolling on a 390 by 844 screen. Keep the photo full-bleed behind, respect safe areas, and use 44 px minimum touch targets.
- No horizontal overflow at 320 px.

**Accessibility**
- The background photo is decorative (CSS background, hidden from assistive technology). Text on the glass panel must reach contrast of 4.5:1 against the photo plus overlay in the worst case, so adjust the tint if needed. The button is a real `button` with a visible label, a focus ring, and keyboard support. Announce errors with `aria-live`. Respect `prefers-reduced-motion` (no parallax or zoom animations).

## 15. SECURITY

Role-based access. Office-level isolation. Server-side or rules-based enforcement on reads, writes, exports, assignment, status transitions, and reports. A user must not reach another office's data by changing a URL, ID, API request, or frontend state. Sanitize input. Safe attachment handling. Protected audit history. Safe error messages. No secrets in client code.

## 16. FUNCTIONALITY CHECK

Every visible control must perform a real action and persist real data: navigation, search, filters, sorting, pagination, ticket create and edit, assignment, replies, attachments, status transitions, confirmation, rejection, reminders, cancellation, recurrence linking, schedule create, job generation, duplicate prevention, reschedule, checklist, corrective tickets, register updates, dashboard stats, report filters, exports, and user and role management. If a feature depends on an unavailable external service, name the dependency and build a safe, testable boundary.

## 17. TESTING AND VERIFICATION

Run existing tests, lint, type checks, and the production build. Add unit, integration, and end-to-end tests using existing tools. If Firebase is used, test security rules with the Firebase emulator where possible. Report each test as passed, failed, or not executed. Never claim a test passed if it was not run.

**Service request**
1. Office submits a request and gets a unique ticket number.
2. IT Coordinator enters a request on behalf of an office.
3. Both paths create valid records.
4. New request starts as Submitted.
5. Incomplete request becomes Needs Information.
6. Supplying details updates the existing ticket and returns it to Submitted for review.
7. No duplicate ticket during the information loop.
8. Complete request can be prioritized and assigned.
9. Assignment sets Assigned and records the event.
10. A new ticket can be created with a link to a previous service record.

**Diagnosis**
11. Technician records diagnosis and findings.
12. Dependency puts the ticket On Hold with all four dependency fields required.
13. Pending dependency stays On Hold.
14. Resolved dependency returns to In Progress.
15. Dependency that cannot proceed follows cancellation with a reason.
16. Approval is requested only when policy requires it.
17. Failed test records the failure and keeps In Progress.
18. Passed test allows Resolved, and Resolved is impossible without a passed test record.

**Confirmation and closure**
19. Office is notified when confirmation is required.
20. Accepted result records confirming person and date.
21. Accepted result transitions to Closed.
22. Rejected result records feedback and returns to In Progress for the assigned technician.
23. No response leaves the ticket Resolved.
24. Reminders never close tickets.
25. Cancellation records the reason and preserves history.
26. Closed and Cancelled update the register.
27. Recurrence creates a new linked ticket and only from Closed.
28. Authorized closure requires an authorized role, a reason, and is audited. Other roles are rejected.

**Preventive maintenance**
29. Schedule records all required fields.
30. Not-due schedule stays active.
31. Due schedule checks for an existing occurrence.
32. Existing job is reused.
33. Missing job is generated and linked correctly.
34. Duplicate generation is prevented, including concurrent attempts.
35. Unavailable office can be rescheduled and the availability check repeats.
36. Each checklist item is recorded with result, findings, technician, date, and evidence.
37. Additional fault creates a linked corrective ticket.
38. The maintenance job remains independently documented.
39. Incomplete or cancelled maintenance is never Successful.
40. Next due date follows the configured schedule.

**Register and reports**
41. Service records stay linked to offices.
42. Services without assets can be recorded.
43. Every status change creates an audit event with actor, timestamp, previous status, new status, and remarks.
44. Reports filter by office, date range, category, technician, and status.
45. Cancelled requests are excluded from completed totals.
46. Resolved tickets are not counted as Closed.
47. Reports and exports respect office-level access.

**Transition and security**
48. Exhaustive transition test: every disallowed from-to pair is rejected by the backend or rules.
49. Each role can perform only its permitted transitions.
50. Unauthorized users cannot read protected records.
51. Changing a URL or ID cannot bypass office permissions.
52. Office users cannot read internal notes.
53. Audit history cannot be updated or deleted by any client.
54. Timestamps display in Asia/Manila.

**Lane ownership**
55. The system records office availability supplied by the Office Requester, and an unavailable answer requires a proposed new date.
56. A corrective ticket created from a maintenance job is created by the system, is linked to the job, and starts as Submitted.
57. A recurrence ticket can be created by the Office Requester (or by an IT Coordinator on behalf) only from a Closed ticket.

**Responsive**
58. All primary pages work on mobile, tablet, and desktop.
59. No horizontal overflow at 320 px.
60. Forms, dialogs, tables, menus, and charts are usable on small screens.
61. Loading, empty, and error states work.

**Visual quality**
62. Every page uses the shared design tokens and components (no one-off colors, fonts, or spacing).
63. Status and priority badges show text and icon, and Resolved and Closed are visually distinct.
64. Screenshots at 390, 768, and 1440 px were captured and reviewed for alignment, overflow, truncation, and contrast, or the limitation was disclosed.
65. Contrast of text and controls meets 4.5:1.

**Role scoping**
66. Each role sees only its own navigation items (Section 4A.2). No admin or coordinator pages appear for Office Requesters or Technicians.
67. Each role sees only the action buttons allowed for it in the current status. A user with no allowed action sees who must act next.
68. Direct URL access to a page or API call outside the role is rejected by the backend or database rules, not just hidden.
69. An IT Technician cannot read or change tickets assigned to other technicians, and cannot assign, prioritize, cancel, or close.
70. An IT Coordinator cannot diagnose, record tests, or accept or reject on behalf of the office, except through audited authorized closure.
71. An Office Requester cannot see internal notes, other offices, or coordinator and technician actions, and can only accept, reject, supply information, reply, and request withdrawal.
72. The permission map is the single source of truth: a test compares the frontend and backend action lists for every role and fails on any difference.
73. The Workflow Guide shows four lanes with the PDF names and order, highlights the current user's lane, and its nodes and edges match Appendix B.
74. Next action owner and "Waiting on" labels match the tables in Section 4A.3 for every status.

**Theme and mobile app fit**
75. Light, Dark, and System modes work, the choice persists, and there is no flash of the wrong theme on load.
76. Every page, chart, dialog, badge, and the Workflow Guide is readable in both themes with contrast of at least 4.5:1, and no page hard-codes colors.
77. Resolved and Closed badges are clearly distinct in both themes.
78. The app is installable (valid manifest, icons, service worker, offline fallback) and no protected data is cached in a shared cache or kept after sign out.
79. At phone widths the role's primary destinations appear in a bottom tab bar, safe areas are respected, and touch targets are at least 44 px.
80. Attachment inputs allow taking a photo on a phone.
81. Screenshots in light and dark mode at 390, 768, and 1440 px were captured and reviewed, or the limitation was disclosed.
82. Workflow Guide data covers every node and edge in Appendix C except the legend artifacts.

**Reference screens, data, and operations**
83. The ticket list has the queues, columns, sorting, pagination, quick search, advanced filters, chips, and exports described in Appendix E.1, and queue membership follows D20.
84. The ticket detail page has the header, information blocks, tabs, thread entry types, composer, and valid-transition status selector described in Appendix E.2.
85. The dashboard has the timeframe selector, activity chart with data table, tiles, and office, category, and technician tables described in Appendix E.3, using the D12 definitions.
86. Ticket numbers follow D19 and are unique under concurrent submissions.
87. Every operation in Appendix G rejects callers whose role, office scope, or current status does not allow it, and writes its audit event and register entry in the same transaction.
88. Attachments follow D21 and invalid files are rejected on the trusted layer.

**Login page**
89. The login page matches Section 14.15 at desktop: full-viewport campus photo, centered split card, glass left half with badge, headline, paragraph, and Live, Secure, Fast tiles, and off-white right half with both seals, Welcome back, the system subtitle, the "Login with UPMail" button, and the helper text.
90. At 390 by 844 the layout stacks and the sign-in button is visible without scrolling, with no horizontal overflow at 320 px.
91. Google sign-in from a non-institutional account is rejected on the trusted layer, and an unprovisioned institutional account sees "Access not granted".
92. The demo account list appears only when the demo flag is on and never in production.
93. The login page is readable and correct in light and dark mode, with text contrast of at least 4.5:1 over the photo.

## 18. IMPLEMENTATION RULES

Make real changes. Follow the current architecture. Reuse components. Avoid unnecessary dependencies and duplicate business logic. Keep business rules in shared services or the backend. Use consistent date handling with Asia/Manila display. Do not hardcode production metrics. Do not bypass authorization. Do not change the documented workflow to simplify development. Do not add unrelated modules or extra mandatory approval steps. No em dashes in generated text.

## 19. DOCUMENTS YOU MUST PRODUCE

- `docs/IMPLEMENTATION_CHECKLIST.md` (live progress)
- `docs/DECISIONS.md` (every [DECISION] with the chosen default and how to change it)
- `docs/DATA_MODEL.md` (entities, fields, relationships, indexes from Appendix F) and `docs/OPERATIONS.md` (the operation list with roles, transitions, and validations from Appendix G)
- `docs/REPORT_DEFINITIONS.md`
- `docs/TRACEABILITY.md` (Section 21)
- `docs/KNOWN_LIMITATIONS.md` (blocked or unverified items, including unreadable PDF, screenshots, Firebase plan limits, email dependency)
- `docs/ROLE_MATRIX.md` (the permission map from Section 4A, per role: pages, actions, transitions, data scope)
- `docs/DESIGN_SYSTEM.md` (tokens for light and dark, components, page patterns, PWA and mobile patterns) and `docs/screenshots/` (final visual review images)

## 20. SOURCE LIMITATIONS TO DISCLOSE

State in `docs/KNOWN_LIMITATIONS.md`: all shapes, lanes, and arrows were read from the PDF geometry and visually spot checked. A few connectors have their arrowheads hidden behind edge labels or drawn as duplicates. They are listed in Appendix B.6 and were implemented from the label text and SOP numbering. The Process context frame, relevant files, and chat notes seen in the PDF are viewer elements and are not part of the process. The PDF is not dated consistently (Last Updated January 30, 2021, generated September 30, 2026), which does not affect the process.

## 21. REQUIRED FINAL AUDIT

Create a traceability table: Requirement, Implementation location, Verification method, Result, Remaining limitation. Verify all of the following, and do not mark a requirement complete merely because a page or button exists:

1. All four swimlanes map to the lane ownership in Section 4 and Appendix B.
2. Every intake path works.
3. All eight statuses and every transition are correct.
4. Missing information updates the existing ticket.
5. Dependency handling covers all three outcomes (resolved, still pending, cannot proceed).
6. Technician testing and office confirmation are separate.
7. Rejection returns the ticket to diagnosis.
8. No response never auto-closes.
9. Cancellation preserves the record.
10. Recurring issues create linked new tickets.
11. Preventive maintenance has its own start and schedule.
12. Duplicate jobs are prevented.
13. Availability and rescheduling work.
14. Checklist results and evidence are retained.
15. Corrective tickets are linked to maintenance jobs.
16. Incomplete or cancelled maintenance is never successful.
17. The Office IT Service Register is consistent.
18. Reports use real data and correct filters.
19. Cancelled is separate from completed totals.
20. Audit history records every status change and is append-only.
21. Office-level permissions are enforced.
22. Ticket list, ticket detail, and dashboard have the reference functionality.
23. All pages are responsive and accessible.
24. No primary control is nonfunctional.
25. Tests and the production build were executed, with honest results.
26. The UI follows the design system in Section 14 and looks professional, formal, and consistent on every page, with the visual quality gate completed or its limitation disclosed.
27. Role scoping: each role has only its own pages, actions, and data (Section 4A), enforced on the backend, and the Workflow Guide matches the PDF lanes and Appendix B.
28. Light, dark, and System themes work everywhere, and the UI is calm, polished, and comfortable to read (Section 14.12 and 14.14).
29. The app works as a responsive website and as an installable mobile-style PWA (Section 14.13).
30. Appendix C is fully represented: every node and edge (except the legend artifacts) is covered by the implemented workflow, the Workflow Guide, and the traceability checklist.
31. Appendices E to H are implemented: reference screens, data model, operations, defaults, notification templates, seed data (dev only), and deployment notes.
32. The login page matches the required reference design (Section 14.15), enforces the institutional domain on the trusted layer, and keeps demo sign-in out of production.

## 22. EXECUTION ORDER

- Phase 1: Inspect repository, architecture, pages, data models, Firebase plan, tests.
- Phase 2: Map this workflow to the existing implementation and list gaps in the checklist.
- Phase 3: Data model, relationships, role matrix, transition enforcement, permissions, append-only audit.
- Phase 4: Intake, review, assignment, diagnosis, execution, dependencies, testing, confirmation, cancellation, closure, recurrence.
- Phase 5: Preventive maintenance, occurrence-based duplicate prevention, checklist, corrective tickets, next due date.
- Phase 6: Register, dashboard, reports, filters, exports.
- Phase 7: Create the design system (Section 14) first, then build the ticket list, ticket details, thread, dashboard, forms, maintenance, register, reports, and administration pages from it.
- Phase 8: Responsive, light and dark themes, mobile app (PWA) fit, accessibility, and the visual quality gate (Sections 14.11 to 14.14).
- Phase 9: Tests, lint, type checks, build, workflow verification, fix defects.
- Phase 10: Traceability, known limitations, concise summary.

Commit after each phase. If blocked, finish all independent work and state exactly what remains blocked.

## 23. PRIORITIES

Faithful workflow first, complete functionality second, polished responsive UI third. All three must work together without changing the intended business process.

## 24. DEFINITION OF DONE

- The workflow works end to end with exact status labels and enforced rules.
- Records persist reliably, and the register and reports use consistent real data.
- Permissions, office isolation, and append-only audit work.
- The ticket interface covers the useful reference functionality.
- Desktop, tablet, and mobile are usable.
- The build succeeds, tests were executed, and failures were addressed.
- All assumptions and limitations are disclosed, and the traceability checklist separates verified from unverified items.

Begin by inspecting the repository, then execute. Do not repeat this prompt back to me.

---

# APPENDIX A: SOURCE PROCESS (from Maintenance_System.pdf)

Title: IT Service and Maintenance Management System. Workflow: Office IT Service Request, Maintenance, and Closure Workflow. Owner: Anthony Derecho. Scope: office IT service requests, technician assignment and execution, office confirmation and closure, cancellation, scheduled preventive maintenance, central office-linked records, audit history, and reporting. Begins when an office needs IT assistance or maintenance is scheduled. Ends when the service record is retained or the maintenance schedule returns to its next check.

Legend: rounded = Start/End, rectangle = Activity, diamond = Decision, cylinder = Data Store, dashed = Loop or alternate.

Decisions in the diagram: Details complete? (Yes/No). Parts, approval, or external support needed? (Yes/No). Dependency outcome? (Resolved / Still pending / Cannot proceed). Service passed testing? (Yes/No). Office accepts result? (Accepted / Rejected / No response). Issue recurs after closure? (Yes/No). Maintenance due? (Yes/No). Job already exists? (Yes/No). Office available? (Yes/No). Additional fault discovered? (Yes/No).

Data stores: Record service request (ticket, office, requester, category, issue, date, asset, attachments, source). Office IT Service Register. Status and audit history. Record maintenance schedule (office, assets, category, checklist, frequency, due date, technician). Maintenance Job Record. Report data (service history, completed totals, pending and overdue, workload, turnaround, costs, recurring issues, compliance).

Annotations: "Resolved means technician testing passed." "Return to review; no new ticket." "Active request withdrawn." "Cancelled separate from completed totals; authorized office access; role-based IT access; preserve completed records and audit history; office-linked services."

## SOP

1. Start when an office needs IT assistance.
 1.1 Accept requests by telephone, email, walk-in, or on-site channels.
 1.2 Capture the office, requester, category, issue, date, asset, attachments, and request source.
2. Create a service ticket linked to any previous service record and set the status to Submitted.
3. Review the request for completeness.
 3.1 If information is missing, set the status to Needs Information.
 3.2 Request the missing details from the office.
 3.3 Update the existing ticket when information is received; do not create a duplicate ticket.
4. Assess the request's impact and urgency.
5. Set the priority and target completion date.
6. Assign a technician and notify the technician and requester.
7. If the request is withdrawn, record the cancellation reason, set the status to Cancelled, notify the requester, and preserve the record.
8. If the request is placed on hold because of a dependency, record the dependency, reason, responsible person, and next action.
 8.1 Follow up on the dependency and record each update.
 8.2 If the dependency remains pending, continue follow-up.
 8.3 If the dependency is resolved, return the request to active processing.
 8.4 If the dependency cannot proceed, record the cancellation reason and cancel the request.
9. Review the ticket and previous office or asset history.
10. Coordinate the service schedule with the office.
11. Diagnose the issue and record findings.
12. Determine whether parts, approval, or external support are required.
 12.1 If required, place the request on hold and document the dependency.
 12.2 If not required, perform the repair, installation, configuration, troubleshooting, or other IT service.
13. Record the diagnosis, actions, parts, costs, labor, dates, and supporting evidence.
14. Test the completed service.
 14.1 If testing fails, record the failed test and return to diagnosis.
 14.2 If testing passes, set the status to Resolved and notify the office that confirmation is required.
15. Request office confirmation of the result.
 15.1 If the office accepts the result, record the confirmation, confirming person, and date.
 15.2 If the office rejects the result, record the feedback and return to diagnosis.
 15.3 If there is no response, retain the Resolved status and send a follow-up reminder.
16. Close the service record after confirmation or authorized closure, and preserve all activity history.
17. Update the office service history and reporting data.
18. If the issue recurs after closure, create a new ticket linked to the previous service record and follow the service-request procedure.
 18.1 If the issue does not recur, retain the service record and end the workflow.
19. For maintenance planning, create a schedule containing the office, assets, category, checklist, frequency, due date, and assigned technician.
20. Check the maintenance schedule at each scheduled interval.
 20.1 If maintenance is not due, keep the schedule active and wait for the next check.
 20.2 If maintenance is due, check whether a job already exists for that occurrence.
 20.3 Use the existing job when one exists; otherwise generate a linked maintenance job record.
21. Assign the maintenance technician and coordinate the visit.
22. Confirm office availability.
 22.1 If the office is unavailable, agree on a new maintenance date and record the reschedule.
 22.2 On the agreed date, continue with the maintenance visit.
23. Perform the maintenance checklist using the approved maintenance procedure.
24. Record each task, result, finding, technician, date, and evidence.
25. Determine whether an additional fault was discovered.
 25.1 If an additional fault is found, create a linked corrective ticket and follow the service-request procedure.
 25.2 If no additional fault is found, continue maintenance verification.
26. Record the maintenance outcome.
 26.1 Do not mark incomplete or cancelled maintenance as successful.
 26.2 Update the office and asset service history.
 26.3 Calculate the next due date and return to the scheduled maintenance check.
27. Use the Section 3 confirmation and closure process for completed maintenance.
28. Maintain system controls and records.
 28.1 Keep Cancelled records separate from completed totals.
 28.2 Restrict office access to authorized users and apply role-based IT access.
 28.3 Preserve completed records and audit history.
29. Generate Office IT Service Reports.
 29.1 Filter reports by office, date range, category, technician, and status.
 29.2 Report completed totals, pending and overdue work, workload, turnaround time, costs, recurring issues, compliance, and service history.


---

# APPENDIX B: DIAGRAM FACTS (traced from the PDF)

Method: the PDF page was rendered and its vector data was read. Each shape was assigned to a swimlane by coordinates. Each of the 105 arrowheads was matched to its target node and traced back along its connector to its source node. Edge labels were attached to the connector they sit on.

## B.1 Shapes

- Lanes (top to bottom): Office Requester or Office Representative, IT Coordinator, IT Technician, System.
- Rounded terminators: two "Start" shapes only (one in the Office lane, one in the IT Coordinator lane).
- "End" is drawn as a rectangle in the System lane and is followed by the rectangle "Service record retained". Implement both as the final retained state.
- Decision diamonds (10 real decisions): Details complete?, Dependency outcome?, Parts, approval, or external support needed?, Service passed testing?, Office accepts result?, Issue recurs after closure?, Maintenance due?, Job already exists?, Office available?, Additional fault discovered?.
- **Drawing quirk:** "Create linked corrective ticket following Section 1" (System lane) is drawn as a diamond but has no Yes or No branches. Implement it as an action step.
- Status boxes: Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved, Closed, Cancelled (all System lane).
- Data-store style boxes: Record service request, Status and audit history, Office IT Service Register, Maintenance Job Record, Record maintenance schedule.
- The legend is a box in the System lane with two connectors: "Generate Office IT Service Reports" to Legend, and Legend to "Office IT Service Register". These are drawing artifacts and are not process flow. Do not implement them.
- Annotation boxes: "Cancelled separate from completed totals; authorized office access; role-based IT access; preserve completed records and audit history; office-linked services" (fed from the Register), and "Captured ticket, office, requester, category, issue, date, asset, attachments, source" (next to Record service request).

## B.2 Section 1: request intake, review, assignment (all arrows verified)

1. Start (Office) to Office needs IT assistance.
2. Office needs IT assistance to Submit service request (Office).
3. Office needs IT assistance to Enter telephone, email, walk-in, or on-site request (IT Coordinator).
4. Submit service request to Record service request (System).
5. Enter telephone, email, walk-in, or on-site request to Record service request.
6. Record service request to Status: Submitted, then to Status and audit history, then to Review request (IT Coordinator).
7. Review request to Details complete?.
8. No: Status: Needs Information (System), then Request missing details (IT Coordinator), then Supply missing information (Office), then Update existing ticket (System), then back to Review request. Edge label on the return: "Return to review; no new ticket".
9. Yes: Assess impact and urgency, then Set priority and target completion date, then Assign technician (all IT Coordinator), then Status: Assigned (System), then Notify technician and requester (System).
10. Notify technician and requester to Review ticket and previous office or asset history (IT Technician). Edge label: "To Section 2".
11. Status: Assigned to Record cancellation reason (IT Coordinator). Edge label: "Active request withdrawn".

## B.3 Section 2: diagnosis and execution (all arrows verified)

1. Review ticket and previous office or asset history, then Coordinate service schedule (IT Technician), then Status: In Progress (System), then Diagnose issue and record findings (IT Technician).
2. Diagnose issue and record findings to Parts, approval, or external support needed?.
3. No: Perform repair, installation, configuration, troubleshooting, or other IT service, then Record diagnosis, actions, parts, costs, labor, dates, and evidence, then Test result, then Service passed testing?.
4. Record diagnosis, actions, parts, costs, labor, dates, and evidence also writes to Status and audit history and to the Office IT Service Register.
5. Service passed testing? No: Record failed test, then back to Diagnose issue and record findings. Edge label: "Return to diagnosis".
6. Service passed testing? Yes: Status: Resolved (System), then Notify office ready for confirmation (System). Annotation: "Resolved means technician testing passed". Status: Resolved also writes to Status and audit history. Edge label to the next section: "To Section 3".
7. Parts decision Yes: Status: On Hold (System), then Record dependency, reason, responsible person, and next action (IT Technician), then Follow up dependency (IT Coordinator), then Dependency outcome?.
8. Dependency outcome? has these branches (label to destination):
   - Resolved: Status: In Progress (then straight on to Perform repair, installation, configuration, troubleshooting, or other IT service).
   - Still pending: Record follow-up updates (IT Coordinator).
   - Continue follow-up: a short connector between Record follow-up updates and the decision, so follow-up repeats while the dependency is pending.
   - Cannot proceed: Record cancellation reason (IT Coordinator).
9. Record cancellation reason, then Status: Cancelled (System).

## B.4 Section 3: confirmation, cancellation, closure (all arrows verified)

1. Notify office ready for confirmation to Review and verify service result (Office), then Office accepts result? (Office).
2. Accepted: Record confirmation, confirming person, and date (Office). Then Status: Closed (System). Edge label "Maintenance confirmation" leads from the same box to Record maintenance outcome (System) for maintenance jobs.
3. Rejected: Record office feedback (Office). It then goes to Status: In Progress and returns to Diagnose issue and record findings. Edge label: "Return to Section 2 diagnosis".
4. No response: Keep status: Resolved, then Send follow-up reminder (both System). The reminder returns to Office accepts result? with edge label "When office responds".
5. Status: Closed to Update office service history and reporting (edge label "Maintenance closure" is attached to this connector).
6. Status: Cancelled, then Notify requester, then Preserve records and activity history, then Update office service history and reporting (all System).
7. Update office service history and reporting writes to the Office IT Service Register and then goes to Issue recurs after closure?.
8. Yes: Create new ticket linked to previous service record (Office lane), then back to Record service request. Edge label: "Return to Section 1".
9. No: End, then Service record retained.

## B.5 Section 4: preventive maintenance (all arrows verified)

1. Start (IT Coordinator), then Create maintenance schedule (IT Coordinator), then Record maintenance schedule (System). Record maintenance schedule also writes to the Maintenance Job Record store and to the Office IT Service Register.
2. Record maintenance schedule to Check maintenance schedule, then Maintenance due?.
3. No: Keep schedule active and wait. Edge label "Next scheduled check" returns to Check maintenance schedule.
4. Yes: Check job for schedule occurrence, then Job already exists?.
5. Yes: Use existing job; do not duplicate, then Maintenance Job Record.
6. No: Generate linked maintenance job, then Maintenance Job Record.
7. Maintenance Job Record to Assign technician and coordinate visit (IT Coordinator), then Office available? (System).
8. No: Agree on new maintenance date (Office), then Record reschedule (System), then back to Office available?. Edge label: "On agreed date".
9. Yes: Perform maintenance checklist using Section 2 (IT Technician), then Record task, result, findings, technician, date, and evidence (this also writes to the Maintenance Job Record, edge label "Continue maintenance documentation"), then Additional fault discovered?.
10. Yes: Create linked corrective ticket following Section 1 (System). It goes to Record service request (edge label "Follow Section 1") and writes to the Maintenance Job Record ("Continue maintenance documentation").
11. No: Continue maintenance verification, then Review and verify service result (Office), edge label "Use Section 3 confirmation and closure".
12. After acceptance and closure: Record maintenance outcome (System), then "Do not mark incomplete or cancelled maintenance successful", then Update office and asset service history, then Office IT Service Register, and also Calculate next due date, which returns to Check maintenance schedule with edge label "Return to scheduled maintenance check".
13. Record maintenance outcome also writes to the Office IT Service Register.

## B.6 Records, reporting, and the few links implemented from labels (final, implement as written)

- The Office IT Service Register receives writes from: Record service request (two connectors), Record diagnosis, actions, parts, costs, labor, dates, and evidence, Record maintenance schedule, Record maintenance outcome, Update office and asset service history, and Update office service history and reporting.
- Office IT Service Register to Generate Office IT Service Reports, then Filter by office, date range, category, technician, and status, then "Service history, completed totals, pending and overdue, workload, turnaround, costs, recurring issues, compliance". The Register also links to the system-controls annotation.
- Status and audit history receives writes from Status: Submitted, Status: Resolved, and Record diagnosis. Implement the rule for all eight statuses, as the SOP requires audit history for every status change.
- **Links where the arrowhead is hidden behind a label (implemented from label text and SOP numbering):** (a) Office accepts result? with label "Accepted" to Record confirmation; (b) Continue follow-up between Dependency outcome? and Record follow-up updates; (c) Next scheduled check from Keep schedule active and wait back to Check maintenance schedule. Verified with a real arrowhead (not hidden): Office available? (top exit, the No branch) to Agree on new maintenance date. The two parallel connectors from Record service request to the Register are both real and both must be implemented as written.

---

# APPENDIX C: MACHINE-READABLE NODES AND EDGES (use this to build the Workflow Guide and the traceability checks)

Source: the PDF. IDs are stable (N00 to N80). Lanes are in PDF order. Use these exact texts for node labels. N75 (legend box) and its two connectors are drawing artifacts: do not render or implement them. Edges marked "[arrowhead hidden]" are implemented from label text and SOP numbering.

## C.1 Nodes

| ID | Lane | Type | Text |
|---|---|---|---|
| N00 | Office Requester or Office Representative | activity | Agree on new maintenance date |
| N01 | Office Requester or Office Representative | start | Start |
| N02 | Office Requester or Office Representative | activity | Office needs IT assistance |
| N03 | Office Requester or Office Representative | activity | Submit service request |
| N04 | Office Requester or Office Representative | activity | Supply missing information |
| N05 | Office Requester or Office Representative | activity | Review and verify service result |
| N06 | Office Requester or Office Representative | decision | Office accepts result? |
| N07 | Office Requester or Office Representative | activity | Record confirmation, confirming person, and date |
| N08 | Office Requester or Office Representative | activity | Record office feedback |
| N09 | Office Requester or Office Representative | activity | Create new ticket linked to previous service record |
| N10 | IT Coordinator | start | Start |
| N11 | IT Coordinator | activity | Create maintenance schedule |
| N12 | IT Coordinator | activity | Enter telephone, email, walk-in, or on-site request |
| N13 | IT Coordinator | activity | Assign technician and coordinate visit |
| N14 | IT Coordinator | activity | Review request |
| N15 | IT Coordinator | activity | Request missing details |
| N16 | IT Coordinator | decision | Details complete? |
| N17 | IT Coordinator | activity | Assess impact and urgency |
| N18 | IT Coordinator | activity | Set priority and target completion date |
| N19 | IT Coordinator | activity | Assign technician |
| N20 | IT Coordinator | activity | Follow up dependency |
| N21 | IT Coordinator | decision | Dependency outcome? |
| N22 | IT Coordinator | activity | Record follow-up updates |
| N23 | IT Coordinator | activity | Record cancellation reason |
| N24 | IT Technician | activity | Perform maintenance checklist using Section 2 |
| N25 | IT Technician | activity | Record task, result, findings, technician, date, and evidence |
| N26 | IT Technician | decision | Additional fault discovered? |
| N27 | IT Technician | activity | Continue maintenance verification |
| N28 | IT Technician | activity | Review ticket and previous office or asset history |
| N29 | IT Technician | activity | Coordinate service schedule |
| N30 | IT Technician | activity | Diagnose issue and record findings |
| N31 | IT Technician | decision | Parts, approval, or external support needed? |
| N32 | IT Technician | activity | Perform repair, installation, configuration, troubleshooting, or other IT service |
| N33 | IT Technician | activity | Record dependency, reason, responsible person, and next action |
| N34 | IT Technician | activity | Record diagnosis, actions, parts, costs, labor, dates, and evidence |
| N35 | IT Technician | activity | Test result |
| N36 | IT Technician | decision | Service passed testing? |
| N37 | IT Technician | activity | Record failed test |
| N38 | System | activity | Record reschedule |
| N39 | System | data store | Record maintenance schedule: office, assets, category, checklist, frequency, due date, technician |
| N40 | System | activity | Check maintenance schedule |
| N41 | System | activity | Keep schedule active and wait |
| N42 | System | activity | Calculate next due date |
| N43 | System | decision | Maintenance due? |
| N44 | System | activity | Check job for schedule occurrence |
| N45 | System | decision | Job already exists? |
| N46 | System | activity | Generate linked maintenance job |
| N47 | System | activity | Use existing job; do not duplicate |
| N48 | System | data store | Maintenance Job Record |
| N49 | System | decision | Office available? |
| N50 | System | action (drawn as diamond) | Create linked corrective ticket following Section 1 |
| N51 | System | data store | Record service request |
| N52 | System | activity | Status: Submitted |
| N53 | System | data store | Status and audit history |
| N54 | System | activity | Update existing ticket |
| N55 | System | activity | Status: Needs Information |
| N56 | System | activity | Status: Assigned |
| N57 | System | activity | Notify technician and requester |
| N58 | System | activity | Status: In Progress |
| N59 | System | activity | Status: On Hold |
| N60 | System | activity | Status: Resolved |
| N61 | System | activity | Notify office ready for confirmation |
| N62 | System | activity | Status: Cancelled |
| N63 | System | activity | Notify requester |
| N64 | System | activity | Preserve records and activity history |
| N65 | System | activity | Keep status: Resolved |
| N66 | System | activity | Send follow-up reminder |
| N67 | System | activity | Status: Closed |
| N68 | System | activity | Update office service history and reporting |
| N69 | System | activity | Record maintenance outcome |
| N70 | System | decision | Issue recurs after closure? |
| N71 | System | activity | Do not mark incomplete or cancelled maintenance successful |
| N72 | System | activity | Update office and asset service history |
| N73 | System | end | End |
| N74 | System | data store | Office IT Service Register |
| N75 | System | legend (ignore) | Legend: rounded = Start/End; rectangle = Activity; diamond = Decision; cylinder = Data Store; dashed = Loop or alternate |
| N76 | System | activity | Generate Office IT Service Reports |
| N77 | System | activity | Filter by office, date range, category, technician, and status |
| N78 | System | annotation | Cancelled separate from completed totals; authorized office access; role-based IT access; preserve completed records and audit history; office-linked services |
| N79 | System | activity | Service history, completed totals, pending and overdue, workload, turnaround, costs, recurring issues, compliance |
| N80 | System | end | Service record retained |

## C.2 Edges (source to target, label)

- N01 to N02  (Start to Office needs IT assistance)
- N02 to N03  (Office needs IT assistance to Submit service request)
- N02 to N12  (Office needs IT assistance to Enter telephone, email, walk-in, or on)
- N03 to N51  (Submit service request to Record service request)
- N12 to N51  (Enter telephone, email, walk-in, or on to Record service request)
- N51 to N52  (Record service request to Status: Submitted)
- N52 to N53  (Status: Submitted to Status and audit history)
- N53 to N14  (Status and audit history to Review request)
- N14 to N16  (Review request to Details complete?)
- N16 to N55 [No]  (Details complete? to Status: Needs Information)
- N55 to N15  (Status: Needs Information to Request missing details)
- N15 to N04  (Request missing details to Supply missing information)
- N04 to N54  (Supply missing information to Update existing ticket)
- N54 to N14 [Return to review; no new ticket]  (Update existing ticket to Review request)
- N16 to N17 [Yes]  (Details complete? to Assess impact and urgency)
- N17 to N18  (Assess impact and urgency to Set priority and target completion dat)
- N18 to N19  (Set priority and target completion dat to Assign technician)
- N19 to N56  (Assign technician to Status: Assigned)
- N56 to N57  (Status: Assigned to Notify technician and requester)
- N57 to N28 [To Section 2]  (Notify technician and requester to Review ticket and previous office or a)
- N56 to N23 [Active request withdrawn]  (Status: Assigned to Record cancellation reason)
- N28 to N29  (Review ticket and previous office or a to Coordinate service schedule)
- N29 to N58  (Coordinate service schedule to Status: In Progress)
- N58 to N30  (Status: In Progress to Diagnose issue and record findings)
- N30 to N31  (Diagnose issue and record findings to Parts, approval, or external support n)
- N31 to N32 [No]  (Parts, approval, or external support n to Perform repair, installation, configur)
- N31 to N59 [Yes]  (Parts, approval, or external support n to Status: On Hold)
- N59 to N33  (Status: On Hold to Record dependency, reason, responsible)
- N33 to N20  (Record dependency, reason, responsible to Follow up dependency)
- N20 to N21  (Follow up dependency to Dependency outcome?)
- N21 to N58 [Resolved]  (Dependency outcome? to Status: In Progress)
- N21 to N22 [Still pending]  (Dependency outcome? to Record follow-up updates)
- N22 to N21 [Continue follow-up [arrowhead hidden]]  (Record follow-up updates to Dependency outcome?)
- N21 to N23 [Cannot proceed]  (Dependency outcome? to Record cancellation reason)
- N23 to N62  (Record cancellation reason to Status: Cancelled)
- N58 to N32 [After dependency resolved]  (Status: In Progress to Perform repair, installation, configur)
- N32 to N34  (Perform repair, installation, configur to Record diagnosis, actions, parts, cost)
- N34 to N35  (Record diagnosis, actions, parts, cost to Test result)
- N35 to N36  (Test result to Service passed testing?)
- N36 to N37 [No]  (Service passed testing? to Record failed test)
- N37 to N30 [Return to diagnosis]  (Record failed test to Diagnose issue and record findings)
- N36 to N60 [Yes]  (Service passed testing? to Status: Resolved)
- N60 to N61  (Status: Resolved to Notify office ready for confirmation)
- N34 to N53  (Record diagnosis, actions, parts, cost to Status and audit history)
- N34 to N74  (Record diagnosis, actions, parts, cost to Office IT Service Register)
- N60 to N53  (Status: Resolved to Status and audit history)
- N61 to N05 [To Section 3]  (Notify office ready for confirmation to Review and verify service result)
- N05 to N06  (Review and verify service result to Office accepts result?)
- N06 to N07 [Accepted [arrowhead hidden]]  (Office accepts result? to Record confirmation, confirming person)
- N06 to N08 [Rejected]  (Office accepts result? to Record office feedback)
- N06 to N65 [No response]  (Office accepts result? to Keep status: Resolved)
- N08 to N58 [Return to Section 2 diagnosis (status In Progress)]  (Record office feedback to Status: In Progress)
- N08 to N30 [Return to Section 2 diagnosis]  (Record office feedback to Diagnose issue and record findings)
- N07 to N67  (Record confirmation, confirming person to Status: Closed)
- N07 to N69 [Maintenance confirmation]  (Record confirmation, confirming person to Record maintenance outcome)
- N65 to N66  (Keep status: Resolved to Send follow-up reminder)
- N66 to N06 [When office responds]  (Send follow-up reminder to Office accepts result?)
- N67 to N68 [Maintenance closure]  (Status: Closed to Update office service history and repo)
- N62 to N63  (Status: Cancelled to Notify requester)
- N63 to N64  (Notify requester to Preserve records and activity history)
- N64 to N68  (Preserve records and activity history to Update office service history and repo)
- N68 to N74  (Update office service history and repo to Office IT Service Register)
- N68 to N70  (Update office service history and repo to Issue recurs after closure?)
- N70 to N09 [Yes]  (Issue recurs after closure? to Create new ticket linked to previous s)
- N09 to N51 [Return to Section 1]  (Create new ticket linked to previous s to Record service request)
- N70 to N73 [No]  (Issue recurs after closure? to End)
- N73 to N80  (End to Service record retained)
- N10 to N11  (Start to Create maintenance schedule)
- N11 to N39  (Create maintenance schedule to Record maintenance schedule: office, a)
- N39 to N40  (Record maintenance schedule: office, a to Check maintenance schedule)
- N39 to N48  (Record maintenance schedule: office, a to Maintenance Job Record)
- N39 to N74  (Record maintenance schedule: office, a to Office IT Service Register)
- N40 to N43  (Check maintenance schedule to Maintenance due?)
- N43 to N41 [No]  (Maintenance due? to Keep schedule active and wait)
- N41 to N40 [Next scheduled check [arrowhead hidden]]  (Keep schedule active and wait to Check maintenance schedule)
- N43 to N44 [Yes]  (Maintenance due? to Check job for schedule occurrence)
- N44 to N45  (Check job for schedule occurrence to Job already exists?)
- N45 to N47 [Yes]  (Job already exists? to Use existing job; do not duplicate)
- N45 to N46 [No]  (Job already exists? to Generate linked maintenance job)
- N46 to N48  (Generate linked maintenance job to Maintenance Job Record)
- N47 to N48  (Use existing job; do not duplicate to Maintenance Job Record)
- N48 to N13  (Maintenance Job Record to Assign technician and coordinate visit)
- N13 to N49  (Assign technician and coordinate visit to Office available?)
- N49 to N00 [No]  (Office available? to Agree on new maintenance date)
- N00 to N38  (Agree on new maintenance date to Record reschedule)
- N38 to N49 [On agreed date]  (Record reschedule to Office available?)
- N49 to N24 [Yes]  (Office available? to Perform maintenance checklist using Se)
- N24 to N25  (Perform maintenance checklist using Se to Record task, result, findings, technic)
- N25 to N26  (Record task, result, findings, technic to Additional fault discovered?)
- N25 to N48 [Continue maintenance documentation]  (Record task, result, findings, technic to Maintenance Job Record)
- N26 to N50 [Yes]  (Additional fault discovered? to Create linked corrective ticket follow)
- N50 to N51 [Follow Section 1]  (Create linked corrective ticket follow to Record service request)
- N50 to N48 [Continue maintenance documentation]  (Create linked corrective ticket follow to Maintenance Job Record)
- N26 to N27 [No]  (Additional fault discovered? to Continue maintenance verification)
- N27 to N05 [Use Section 3 confirmation and closure]  (Continue maintenance verification to Review and verify service result)
- N69 to N71  (Record maintenance outcome to Do not mark incomplete or cancelled ma)
- N71 to N72  (Do not mark incomplete or cancelled ma to Update office and asset service histor)
- N72 to N74  (Update office and asset service histor to Office IT Service Register)
- N72 to N42  (Update office and asset service histor to Calculate next due date)
- N69 to N74  (Record maintenance outcome to Office IT Service Register)
- N42 to N40 [Return to scheduled maintenance check]  (Calculate next due date to Check maintenance schedule)
- N51 to N74 [first of two parallel connectors]  (Record service request to Office IT Service Register)
- N51 to N74 [second of two parallel connectors]  (Record service request to Office IT Service Register)
- N74 to N76  (Office IT Service Register to Generate Office IT Service Reports)
- N76 to N77  (Generate Office IT Service Reports to Filter by office, date range, category)
- N77 to N79  (Filter by office, date range, category to Service history, completed totals, pen)
- N74 to N78  (Office IT Service Register to Cancelled separate from completed tota)

Coverage rule: the in-app Workflow Guide and the traceability checklist must include every node except N75, and every edge above except the legend connectors. In the in-app guide, merge N48 and the other data stores as rectangles with a small "record" marker.

---

# APPENDIX D: DECISIONS LOG (final defaults where the PDF is silent)

These are final. Implement them as written. Each is configurable where the text says so.

| ID | Topic | Final decision |
|---|---|---|
| D1 | Cancel from Resolved | Allowed for the IT Coordinator with a reason. |
| D2 | Cancel from Submitted, Needs Information, In Progress | Allowed for the IT Coordinator with a reason (the PDF draws it from Assigned and from a dependency that cannot proceed). Source statuses are configurable. |
| D3 | Reassigning a technician | Allowed while Assigned, In Progress, or On Hold. Status unchanged and an assignment-change audit event is written. |
| D4 | Authorized closure | Only IT Coordinator or System Administrator, only from Resolved, with mandatory reason, actor, and timestamp, shown in the history. Never triggered by silence. Allowed roles are configurable. |
| D5 | Request source values | Online Portal, Telephone, Email, Walk-in, On-site. |
| D6 | Priority matrix | Impact and Urgency (Low, Medium, High) produce Priority (Low, Medium, High, Critical). Stored separately, matrix configurable. |
| D7 | Categories | Configurable table. Seed: Hardware Repair, Software Support, Network and Connectivity, Account Assistance, Printer and Peripheral, Installation and Configuration, Other. |
| D8 | Approval | Per-category flag, default off. Never required for every service. |
| D9 | Reminder interval | Configurable, default 3 business days. A reminder is an audit event and never changes the status. |
| D10 | Maintenance job status | Same eight status labels as tickets, plus an outcome field (Successful, Incomplete, Cancelled). Only a Closed job with all checklist items completed can be Successful. |
| D11 | Next due date | Fixed cadence by default (previous scheduled due date plus frequency), configurable to count from completion. Advances even after an incomplete or cancelled outcome. |
| D12 | Metrics | Completed means Closed. Resolved is reported separately as Awaiting confirmation. Cancelled is always separate. Overdue means target date passed and status is not Resolved, Closed, or Cancelled. Turnaround is Submitted to Resolved, with time to Closed shown separately. Recurring issue means a ticket linked to a previous Closed ticket. PM compliance is Successful Closed jobs divided by occurrences due in the period. |
| D13 | Office visibility | Office users never see internal notes or internal cost details. |
| D14 | Administrator | Manages configuration and users only. No operational ticket steps unless also given an operational role. Cannot edit audit history. |
| D15 | Requester withdrawal | The Requester sends a "request withdrawal" message. The IT Coordinator records the reason and sets Cancelled (as in the PDF lane). |
| D16 | Swimlane for System steps | System steps are automatic application behavior, triggered by the human step that precedes them. Office availability is answered by the Office Requester and recorded by the System. |
| D17 | Hidden-arrow links | Implement the three hidden-arrowhead links and the verified links listed in Appendix B.6 as written. |
| D18 | Needs Information return | After the office supplies information the same ticket returns to Submitted for review (no new ticket). |
| D19 | Ticket number | Format `IT-YYYY-NNNNNN` (year plus zero-padded yearly sequence, for example IT-2026-000101), generated inside a transaction on a counter record so numbers are unique and never reused. |
| D20 | Queues | Open means Submitted, Needs Information, Assigned, In Progress, On Hold, and Resolved. Closed queue means Closed and Cancelled, with a filter to separate them. My Tickets means assigned to me (Technician) or created by me (Requester). |
| D21 | Attachments | Allowed: jpg, png, webp, pdf, docx, xlsx, csv, txt. Maximum 10 MB per file and 10 files per upload. Checked on the trusted layer and storage rules. A malware scan is an external integration boundary. |
| D22 | Schedule check and sessions | The maintenance schedule check runs daily at 06:00 Asia/Manila (or by the manual idempotent action when scheduled functions are unavailable). Idle session timeout is 30 minutes, configurable. |


---

# APPENDIX E: REFERENCE SCREEN SPEC (ticket list, ticket details, dashboard)

This spec turns the owner's screenshot references (a classic helpdesk ticket system) into concrete requirements. The business workflow always overrides the screenshots. Use modern styling from Section 14, not the dated look.

## E.1 Ticket list

- Top queue tabs with live counts: Open, My Tickets, Closed, Search, New Ticket (queue definitions in D20).
- Columns: Ticket (number, link), Last Updated, Subject, From (requester), Priority, Office (department), plus Status, Category, and Assignee. Sort by any column ascending or descending, default Last Updated descending. Pagination with total count and a page-size control.
- Quick search box (ticket number, subject, requester, asset tag) and an Advanced search drawer: status, priority, office, category, assignee, request source, created date range, last updated range, overdue only. Active filters appear as removable chips. Saved searches are optional.
- Row indicators: overdue, new reply since last visit, has attachments, linked to maintenance, recurring (linked to a previous ticket). Each indicator has text or a tooltip, not color alone.
- Row selection with bulk actions only for roles that own them (the IT Coordinator may bulk assign). A per-row menu shows only actions allowed for the role and status.
- Export the filtered list to CSV for IT roles. Office users export only their own offices.

## E.2 Ticket details

- Header: ticket number and subject, status and priority badges, workflow stepper, "Waiting on" label, and the action bar for the current role and status (Reply, Internal note for IT roles, Assign, Change status through the allowed transitions only, More: print, link ticket).
- Information block: Status, Priority, Impact, Urgency, Office, Category, Request source, Created, Last updated, Target completion date, Actual service dates, Equipment or asset. Requester block: name, email, phone, office. Assignment block: technician, target date, previous record link, maintenance link.
- Tabs: Conversation (the chronological thread), Service record (diagnosis, actions, parts, materials, costs, labor, test results, evidence), Dependencies, History (status changes and audit events), Related (previous service record, recurrence tickets, corrective tickets, maintenance job).
- Thread entry types: Message, Reply, Internal note (IT only, visually distinct), System event (actor "System"). Each entry shows avatar, name, role, exact and relative time in Asia/Manila, text, and attachments.
- Composer: tabs for Reply and Internal note, attachments (with camera on phones), and a status selector that lists only valid transitions for the user's role with the required fields (for example dependency fields for On Hold, feedback for reject, reason for cancel).
- Print-friendly ticket view.

## E.3 Dashboard

- Header "Ticket activity" with a timeframe selector (Last 7 days, Last 30 days, Last 90 days, This month, Custom range), a refresh button with last updated time, and an export button.
- Activity chart over the period: Submitted, Resolved, Closed, and Cancelled per day, with a data table alternative.
- Summary tiles for the eight statuses plus Overdue.
- Tabs for Offices (departments), Categories (topics), and Technicians (agents). Table columns: name, Submitted, Assigned, Overdue, Resolved, Closed, Cancelled, Recurring (new tickets linked to a previous Closed ticket), Average turnaround, Average time to assignment. Definitions follow D12.
- Also show technician workload, service costs, recurring issues, and preventive maintenance compliance.
- Everything respects role scoping (Section 4A).

---

# APPENDIX F: DATA MODEL (adapt to Firestore collections or SQL tables)

Use stable IDs, server timestamps, and references instead of copied data. Names are suggestions. Keep the existing project's conventions where they exist.

- **users:** id, name, email, phone, role (office_requester, it_coordinator, it_technician, system_admin), active, themePreference, lastLoginAt.
- **offices:** id, name, code, location, active. **userOffices:** userId, officeId (membership, defines office-level access).
- **categories:** id, name, requiresApproval (default false), active. **assets:** id, assetTag, officeId, type, name, active (a ticket may have no asset).
- **tickets:** id, number (D19), officeId, requesterId, enteredById, source, categoryId, assetId (optional), subject, description, dateReported, status, priority, impact, urgency, assigneeId, targetDate, previousTicketId (optional), maintenanceJobId (optional, for corrective tickets), nextActionRole, idempotencyKey, createdAt, updatedAt, resolvedAt, closedAt, cancelledAt.
- **ticketServiceEntries:** ticketId, technicianId, diagnosis, findings, actions, parts (name, quantity, cost), materials, actualCost, laborMinutes, serviceStart, serviceEnd, evidence. **ticketTests:** ticketId, result (passed or failed), notes, testedBy, testedAt.
- **ticketDependencies:** ticketId, type (parts, approval, external support), reason, responsibleUserId, nextAction, status (pending, resolved, cannot_proceed), updates (text, by, at).
- **ticketConfirmations:** ticketId, outcome (accepted, rejected), confirmedBy, confirmedAt, feedback, authorizedClosure (by, reason, at, optional).
- **ticketCancellations:** ticketId, reason, recordedBy, recordedAt.
- **ticketEvents (append-only, never updated or deleted):** id, ticketId, type (created, information_requested, information_supplied, assigned, reassigned, status_changed, reply, internal_note, diagnosis, service_action, dependency_recorded, dependency_updated, test_recorded, confirmed, rejected, authorized_closure, cancelled, reminder_sent, attachment_added, linked, maintenance_linked), actorId, actorRole, createdAt (server), previousStatus, newStatus, remarks, visibility (public or internal).
- **attachments:** id, ownerType (ticket, job, checklist item), ownerId, officeId, storagePath, fileName, contentType, size, uploadedBy, uploadedAt.
- **notifications:** id, userId, type, refType, refId, message, createdAt, readAt.
- **maintenanceSchedules:** id, officeId, assetIds, categoryId, checklist (items), frequency (unit and interval), cadenceMode (fixed or from completion), nextDueDate, technicianId, active, createdBy.
- **maintenanceJobs:** id (the occurrence key, scheduleId plus due date, unique), scheduleId, occurrenceDueDate, officeId, assetIds, technicianId, status (same eight labels), outcome (Successful, Incomplete, Cancelled), scheduledDate, availability (available, unavailable), reschedules (oldDate, newDate, reason, agreedBy, recordedBy, at), correctiveTicketIds, confirmation.
- **maintenanceChecklistResults:** jobId, item, task, result (pass, fail, not applicable), findings, technicianId, actualDate, evidence.
- **officeRegisterEntries:** officeId, entryType (request, assignment, status_change, diagnosis, test, confirmation, cancellation, closure, recurrence, schedule, job, corrective_ticket, asset), refType, refId, at. This is the Office IT Service Register. Keep it consistent in the same transaction as the change.
- **counters:** ticketNumber per year. **settings:** configurable defaults from Appendix D and H. **adminAuditLog:** user, role, and configuration changes.
- Indexes: tickets by (officeId, status, updatedAt), (assigneeId, status), (status, targetDate), (requesterId), (previousTicketId); events by (ticketId, createdAt); jobs by (technicianId, status), (scheduleId); unique constraint on the job occurrence key.

---

# APPENDIX G: OPERATIONS (trusted backend, rules, or callable functions)

Every operation validates the caller's role (Section 4A), office scope, the current status and allowed transition (Section 6.1), required fields, and writes the audit event and register entry in the same transaction. Operations not listed for a role must be rejected.

**Tickets:** createRequest (Office Requester, or IT Coordinator on behalf), requestInformation (IT Coordinator), supplyInformation (Office Requester), assignTicket and reassignTicket (IT Coordinator, requires impact, urgency, priority, target date, technician), startWork (assigned Technician), recordDiagnosis and recordServiceEntry (assigned Technician), placeOnHold (Technician, requires dependency, reason, responsible person, next action), recordDependencyUpdate and resolveDependency (IT Coordinator), recordTest (Technician), markResolved (system, only after a passed test), acceptResult and rejectResult (Office Requester), authorizedClose (D4), cancelTicket (IT Coordinator, requires reason), requestWithdrawal (Office Requester), sendReminder (system, or IT Coordinator manually), createRecurrenceTicket (from a Closed ticket), addReply, addInternalNote (IT roles only), uploadAttachment.

**Maintenance:** createSchedule and updateSchedule (IT Coordinator), runScheduleCheck (system or manual, idempotent), generateJob (internal, uses the occurrence key and a transaction), assignJobTechnician (IT Coordinator), confirmAvailability and agreeNewDate (Office Requester), recordReschedule (system), startJob and recordChecklistItem (assigned Technician), flagAdditionalFault (Technician, the system creates the linked corrective ticket as Submitted), confirmJobResult (Office Requester, same accept or reject rules), recordMaintenanceOutcome and computeNextDue (system).

**Reports and admin:** getDashboardStats, getReport, exportReport (role and office scoped), and administration operations (System Administrator only).

---

# APPENDIX H: DEFAULTS, TEMPLATES, SEED DATA, DEPLOYMENT

- **Frequencies:** Daily, Weekly, Every 2 weeks, Monthly, Quarterly, Every 6 months, Yearly, and Custom (every N days, weeks, or months).
- **Notification templates (formal, in-app first, email through the integration boundary):**
  - Assigned: "Ticket {number} has been assigned to {technician}. Target completion date: {date}."
  - Information requested: "More information is needed for ticket {number}: {details}."
  - Ready for confirmation: "The service for ticket {number} is complete. Please review and confirm the result."
  - Reminder: "Ticket {number} is awaiting your confirmation."
  - Rejected: "The office rejected the result of ticket {number}. Feedback: {feedback}."
  - Closed: "Ticket {number} has been closed."
  - Cancelled: "Ticket {number} has been cancelled. Reason: {reason}."
  - Maintenance: "Maintenance for {office} is scheduled on {date}. Please confirm availability."
- **Seed and demo data:** only in a development or demo environment, labeled clearly as demo, with one account per role and an administrator. Provide a seed script that refuses to run in production.
- **Deployment:** keep the existing Firebase Hosting setup. Document environment variables, deploy steps, security rules deployment, and the PWA headers in the README. Never commit secrets.
- **Language and formats:** English. Dates `MMM d, yyyy h:mm a` in Asia/Manila. Currency PHP.
| D23 | Login copy | Headline "Maintenance Management, from request to closure." and the subtitle in Section 14.15. Seals, photo, pill badge, tile labels, Welcome back, button text, and helper text follow the reference image exactly. |
| D24 | Sign-in domain | Google sign-in limited to `@upcebu.edu.ph` (configurable), enforced on the trusted layer. Users must be provisioned with a role. Unprovisioned users see "Access not granted". |
| D25 | Demo sign-in | Demo account list appears only when an explicit demo flag is on, never in production. |
