# Completeness Audit Report

Audit date: 2026-10-29
Branch: `audit/completeness`
Project: IT Service and Maintenance Management System (zero-build HTML/CSS/JS plus Python SQLite backend)
Scope: every role, every checklist item in the audit prompt, every page group, and the 102 tests in Section 17 of `docs/MASTER_PROMPT_COMPLETE.md`.
Mode: read-only. No application code, login file, theme token, security rule, or production data was changed. Only this report, `tests/audit/*`, and `docs/audit-screenshots/*` were created.

## 1. Summary

| Group | Items | PASS | PARTIAL | FAIL | NOT VERIFIED |
|---|---|---|---|---|---|
| Workflow and statuses (W) | 16 | 12 | 2 | 2 | 0 |
| Preventive maintenance (M) | 11 | 7 | 4 | 0 | 0 |
| Register, audit, reports (R) | 8 | 5 | 1 | 2 | 0 |
| Security and roles (S) | 8 | 6 | 1 | 1 | 0 |
| Pages and UI (U) | 14 | 7 | 6 | 1 | 0 |
| Theme, responsive, PWA (V) | 4 | 0 | 3 | 1 | 0 |
| End-to-end scenarios | 6 | 4 | 2 | 0 | 0 |
| **Total** | **67** | **41** | **19** | **7** | **0** |

Automated test coverage of the 102 required tests: 49 present and passing, 40 partial, 13 missing. The Python and JavaScript suites that exist all pass (383 backend assertions, 60 smoke checks, 555 page tests, 182 role-page tests, 17 API checks, parity, Appendix C, UI consistency, validation, JS syntax). Passing suites do not make the system complete: the defects below are in paths those suites do not exercise.

Honest status: the functional workflow is broadly implemented and well tested. The system is **not complete** because the backend state merge endpoint can create a Resolved ticket with no passed test and can delete every ticket by omission, the audit trail is not genuinely append-only through the import endpoint, there is no idle session timeout, System theme does not follow the operating system, the requester intake form exposes coordinator-only fields, and the responsive and contrast checks record failures. One Blocker, three High, nine Medium, and thirteen Low issues remain.

## 2. Results

Result values are PASS (evidence given), PARTIAL (part works, gap stated), FAIL (missing or wrong), and NOT VERIFIED (not used in this report). Severity is Blocker, High, Medium, or Low.

### 2.1 Workflow and statuses

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| W1 | Exactly the eight status labels exist | `server/engine.py:98-104` defines the eight labels; `js/ui.js:20-27` renders text plus icon; repository search found no alternative status names, only copy such as "Awaiting your reply" | PASS | - | - | - |
| W2 | New tickets start Submitted through both intake paths | `server/engine.py:370-450` records every ticket as `submitted`; coordinator source is validated against settings; `server/tests.py:66-90`, `tools/smoke.js:72-83` | PASS | - | - | - |
| W3 | `IT-YYYY-NNNNNN`, transactional, unique under concurrency | `server/engine.py:309-326` increments an in-memory sequence; ticket id is the SQLite primary key; `tools/smoke.js:72` checks the format | PARTIAL | No concurrent-submission test; `POST /api/state` accepts an arbitrary id such as `IT-9999-000099` (`server/app.py:884-890`) | Medium | Force server-side id generation for every create path; add a parallel-submit test |
| W4 | Needs Information loop updates the same ticket | `server/engine.py:453-487`; `server/tests.py:76`; `tools/smoke.js:83` | PASS | - | - | - |
| W5 | Assignment requires impact, urgency, priority, target date, technician, notifies | `server/engine.py:616-669`; `server/tests.py:83-84`; audit assertion at `server/tests.py:1165` | PASS | - | - | - |
| W6 | In Progress only after the assigned technician coordinates | `server/engine.py:914-950` requires a coordination note/schedule and the approval gate | PASS | - | - | - |
| W7 | On Hold requires four dependency fields; outcomes work | `server/engine.py:1018-1048`, `824-912`; `server/tests.py:140-162` | PASS | - | - | - |
| W8 | Approval only for gated categories | `server/engine.py:704-733`; `server/tests.py:1306` | PASS | - | - | - |
| W9 | Resolved impossible without a passed test | `server/engine.py:1050-1087` gates Resolved on a pass | FAIL | `POST /api/state` creates a ticket already in `resolved` with `tests: []` (probe result: `ticket_created: true`, `created_status: "resolved"`, `created_has_tests: false`) | High | Reject client-created tickets in the state merge, or route them through `engine.create_ticket` and the workflow methods |
| W10 | Resolved notifies the office and is never auto-closed | `server/engine.py:490-558`, `1090-1140`, `1250-1280`; `server/tests.py:103-114`, `1360-1362` | PASS | - | - | - |
| W11 | Accept records person/date and closes; reject returns to In Progress; no response stays Resolved with reminders | `server/engine.py:490-558` closes in one step; reminder loop runs for pending and no_response; `server/tests.py:114-116`, `1360-1362` | PASS | - | - | - |
| W12 | Authorized closure roles, reason, audit | `server/engine.py:1090-1140` rejects other roles and requires a reason | PASS | Positive ticket-path test is partial; job closure is tested at `server/tests.py:226` | - | - |
| W13 | Cancellation records reason, notifies, preserves history | `server/engine.py:794-821`; `server/tests.py:1178` | PASS | - | - | - |
| W14 | Recurrence creates a new linked ticket only from Closed | `server/engine.py:561-589`; `server/tests.py:164-177` | PASS | - | - | - |
| W15 | Every disallowed transition rejected by backend or rules, with a test | `server/engine.py:228-268` has a transition table, but no exhaustive matrix test exists | FAIL | `POST /api/state` accepts a new ticket in any of the eight statuses and replaces the whole tickets collection, deleting omitted records (probe: `deleted_count: 9`); no test enumerates from-to pairs | Blocker | Make the state endpoint append-only for updates and workflow-only for creation; add an exhaustive matrix test |
| W16 | Previous service record can be linked at creation | Engine accepts `previousRecord` (`server/engine.py:370-400`); detail renders it (`or-ticket.html:348-364`) | PARTIAL | The intake forms have no control to choose a previous record | Low | Add a previous-record selector to the coordinator intake form |

### 2.2 Preventive maintenance

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| M1 | Schedule stores all fields; eight frequency choices | `server/engine.py:1165-1183` requires office, category, due date, frequency, technician, checklist; assets optional | PARTIAL | `server/db.py:220-223` seeds only Weekly, Monthly, Quarterly, Semi-annual, Annual; Daily, Every 2 weeks, Every 6 months and Custom are absent | Medium | Seed the full frequency list and allow a custom interval in days |
| M2 | Not-due schedule stays active | `server/engine.py:1186-1200` updates `lastCheck` and continues | PASS | - | - | - |
| M3 | Due schedule reuses or creates by occurrence key | `server/engine.py:1201-1224`: lookup by `scheduleId` and `occurrence`, then linked generation | PASS | - | - | - |
| M4 | Duplicate generation impossible, including concurrent runs | `server/db.py:166-167` unique index `ux_jobs_occurrence`; checks run under the state lock | PARTIAL | Test 34 checks sequential idempotency only; no concurrent attempt | Low | Add a parallel-generation test |
| M5 | Coordinator assigns technician and coordinates the visit | Technician is a required schedule field (`server/engine.py:1170-1180`); job inherits it | PARTIAL | There is no job-level assignment or reassignment action; only the schedule can be edited | Low | Add an assign/reassign action for a generated job |
| M6 | Unavailable office reschedules and availability is re-checked on the agreed date | `server/engine.py:1311-1349` records old date, new date, reason and sets `availability: pending`; `world_tick` returns the job to coordination on the date | PARTIAL | On the agreed date the job proceeds (`server/engine.py:1295-1305`); the office is not asked again | Medium | Re-open the availability question when the agreed date arrives |
| M7 | Each checklist item records task, result, findings, technician, date, evidence | `server/engine.py:1382-1405` | PASS | - | - | - |
| M8 | Additional fault creates a linked Submitted corrective ticket | `server/engine.py:1408-1440`; `server/tests.py:260` | PASS | - | - | - |
| M9 | Maintenance confirmation and closure mirror tickets | `server/engine.py:1602-1679` | PASS | - | - | - |
| M10 | Incomplete or cancelled maintenance is never Successful | `server/engine.py:1493-1583`; `server/tests.py:236-242` | PASS | - | - | - |
| M11 | Next due date follows the configured cadence | `server/engine.py:131-140`, `1473-1491`; `server/tests.py:206` | PASS | Test asserts the value is set, not the arithmetic | - | Add an arithmetic test per frequency |

### 2.3 Register, audit, and reports

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| R1 | Every status change writes an audit event with actor, server time, previous, new, remarks | `server/engine.py:75-100`; normal workflow paths call it; `server/tests.py:1145-1180` | FAIL | Tickets created or altered through `POST /api/state` add no audit event; the client audit list is ignored but no server event is synthesized (`server/app.py:884-896`) | High | Emit audit events for every accepted state-merge change |
| R2 | Audit history append-only; clients cannot update or delete | Engine methods append only; `server/app.py:968-975` accepts an incoming audit list of equal or greater length and replaces its content | FAIL | A management import can rewrite existing entries in place; no test asserts immutability | High | Require the incoming audit list to be an exact prefix-preserving superset and add an immutability test |
| R3 | Office IT Service Register links all entities and updates in the same transaction | The register is a derived view over tickets and jobs (`register.html:100-481`), so it cannot drift; state saves are transactional | PARTIAL | No materialized register and no automated assertion that close/cancel appears in the register | Medium | Add register propagation assertions for close, cancel, recurrence and job outcome |
| R4 | Services without an asset can be recorded | Asset is optional in `server/engine.py:402-450`; `server/tests.py:983` | PASS | - | - | - |
| R5 | All eight report types exist | `reports.html:60-107`, `410-479` | PASS | - | - | - |
| R6 | Filters: office, date, category, technician, status | `reports.html` filters and `server/query.py`; `server/tests.py:1205` | PASS | Test covers office and status only | - | Add date, category and technician assertions |
| R7 | D12 metric definitions | `server/query.py`; `server/tests.py:1185`; definitions note at `reports.html:107` | PASS | - | - | - |
| R8 | CSV export exists and respects role and office scope | `reports.html:450-479`; scoped export `server/app.py:997+`; `server/tests.py:508` | PASS | - | - | - |

### 2.4 Security and roles

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| S1 | One permission map, parity test | `permissions.json`, `js/permissions.js`, backend; `tools/parity_check.js` output: PERMISSION PARITY PASS | PASS | - | - | - |
| S2 | Office users limited to their offices; URL or API change cannot bypass | `server/app.py:276-327`, `_office_block`; `tests/audit/results/scope_probe.json` (foreign office decision blocked); `server/tests.py:466-511` | PASS | Requester can choose any active office at intake (documented decision D26) | - | - |
| S3 | Technicians only access assigned work | `server/engine.py:269-283`; `server/tests.py:1257`; `tests/audit/results/technician_scope_probe.json` (start work blocked after reassignment) | PASS | - | - | - |
| S4 | Internal notes and costs never reach requesters | `server/app.py:276-327` strips internal comments, diagnosis cost/labor, cost text, priority and staff fields; `server/tests.py:476-480` | PASS | - | - | - |
| S5 | Google restricted to `@upcebu.edu.ph`; unprovisioned sees Access not granted; demo list only with flag | Domain check `server/oidc.py:175-185`; `server/auth.py:126-140`; `server/tests.py:801-845` | PARTIAL | The demo list is shown on every host by project decision D25 and `AGENTS.md`, which directly conflicts with master test 92 ("only when the demo flag is on"); `tools/pagetest.js:772` asserts it is visible by default | Low | Record the owner-approved deviation, or gate the list behind the flag |
| S6 | Attachments per D21 validated on the trusted layer | `server/app.py:550-619`: type list, 10 MB, 10 files, base64 and record-ownership checks; `server/tests.py:608-644` | PASS | - | - | - |
| S7 | No secrets; rules present and tested with the emulator | No client secrets found; there is no Firebase deployment, so no emulator applies; server-side guards are covered by the backend suite | PASS | Firebase emulator test not applicable to this architecture | - | - |
| S8 | Session idle timeout configured (default 30 minutes) | `server/auth.py:86-94` issues 24-hour absolute sessions | FAIL | No idle timer exists in the server or the client | Medium | Add a 30-minute idle expiry and a test |

### 2.5 Pages and UI

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| U1 | Login page unchanged | During this audit `git status` showed no tracked edits; image hashes pass | PARTIAL | `sha256sum -c docs/login-baseline.sha256` fails for `login.html`, `css/login.css`, `js/login.js`, `js/theme.js`; `git diff c384e4c..HEAD` shows 85 insertions and 38 deletions across those four files, from owner commits that predate this audit. No baseline render was available for a before/after style comparison | Low | Re-record an approved login baseline or revert to the frozen one with owner sign-off |
| U2 | Theme tokens unchanged | `tests/audit/theme_tokens.py`: 41 tokens, 0 mismatches; hard-coded colours in `css/console.css` are white/black alpha overlays plus shadow tones, permitted by AGENTS.md | PASS | - | - | - |
| U3 | App shell: rail, top bar, seal lockup, breadcrumb, search, bell, account tray, footer | `js/ui.js:938-1060`, `1161-1200`, `1518-1530`; rendered screenshots show all elements; footer year is generated | PASS | - | - | - |
| U4 | Dashboard per role with timeframe, chart and data table, statistics tabs, export, action panel | `dashboard.html:50-110`, `728-990`; role walkthrough headings | PASS | - | - | - |
| U5 | Ticket list: queues, filters, sort, pagination, chips, exports, board | `tickets.html:99-330`, `541-560`; board and pagination present | PARTIAL | The board renders, but invalid-move snap-back and the matching backend rejection were not exercised; test 99 covers order and permitted moves only | Low | Add a snap-back and direct-API rejection test for the board |
| U6 | Ticket detail: blocks, stepper, action bar, tabs, thread, composer, status selector, print view | `ticket.html`; tabs and action bar verified in walkthrough; global print CSS only hides the chrome (`css/green.css:521-526`) | PARTIAL | There is no print action and no dedicated ticket print layout | Low | Add the Appendix E.2 print view |
| U7 | New request form with validation, camera input, coordinator-only fields restricted | `request.html` and generated `or-request.html` | FAIL | A requester sees "Request source" (`or-request.html:73-81`) and "Priority" (`or-request.html:64-71`), both coordinator-only per Section 4.1; no role logic hides them | Medium | Hide and server-reject source and priority for requesters |
| U8 | Maintenance schedules, planner, form, job detail, checklist, corrective panel | `maintenance.html:37-62`, `611-740` | PASS | - | - | - |
| U9 | Office register selector, health strip, tabs | `register.html:31-100`, `443-481` | PASS | - | - | - |
| U10 | Reports: sticky filters, tiles, chart and table, definitions, CSV, print with letterhead | `reports.html:60-118`, `410-479` | PARTIAL | CSV works; there is no report print action or letterhead; metric definitions are an inline note, not a popover | Low | Add the print view and definitions popover |
| U11 | Notifications tray and page | `js/ui.js:1020-1060`; `notifications.html`; tests | PASS | - | - | - |
| U12 | Workflow Guide: four lanes, PDF names, current lane, Appendix C coverage | `flow.html:246-260`; `tools/appendix_c_check.py` PASS (81 nodes, 106 edges) | PARTIAL | The page exists and highlights the current lane, but no role navigation links to it; reference entries were removed in commit b66e55d | Low | Restore a Workflow Guide destination for each role, or get the removal approved |
| U13 | Administration: users, roles, offices, categories, assets, configuration, audit | `mgmt-users.html`, `mgmt-offices.html`, `mgmt-settings.html`, `mgmt-audit.html`; walkthrough navigation | PASS | - | - | - |
| U14 | Loading, empty, error and not-available states | Skeleton `js/ui.js:1904-1912`; empty states with illustrations on every list; neutral access panel `js/ui.js:1666-1690` | PARTIAL | No general error state is rendered on API failure; a wrong-role prefixed URL redirects to a 404 page titled "Page not found" rather than "This page is not available" | Low | Add an error state and align the forbidden-URL copy |

### 2.6 Theme, responsive, and PWA

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| V1 | Light, Dark, System work, persist, no flash | `js/theme.js:1-72` removes `data-theme` for System; `js/ui.js:1955-1993`; page prepaint forces light; `css/app.css:1614` records that the dark `prefers-color-scheme` block was removed | FAIL | System always renders light and ignores the operating system; choice persists, and there is no flash | Medium | Restore the `prefers-color-scheme` rules and make the prepaint snippet respect System |
| V2 | Installable PWA with valid manifest, icons, shell-only SW, no protected cache | `manifest.webmanifest:10-12` lists only `favicon.svg`; `sw.js:18-60` precaches shell only and excludes `/api/`; offline fallback present | PARTIAL | `icons/icon-192.png`, `icon-512.png` and the maskable icon exist but are not listed; SVGs are not accepted by every installer | Low | Add the PNG and maskable icons to the manifest |
| V3 | Phone bottom tab bar, safe areas, 44 px targets, camera | Bottom bar `js/ui.js:1572-1612`; safe-area CSS `css/app.css:497-551`; camera `capture="environment"` on attachment inputs; `tests/audit/results/contrast_touch.json` | PARTIAL | At 390 px, status chips are 36 px high, checklist segments 40 px, ticket links 36 px and text inputs 36 px, below 44 px | Medium | Raise interactive controls to at least 44 px at touch widths |
| V4 | Accessibility: headings, labels, keyboard, focus, chart table, status not by colour, contrast | Semantic headings and labels present; chart has a data table (`dashboard.html:75-77`); status badges include text and icon; contrast probe finds failures | PARTIAL | Light muted text is 4.09 to 4.42:1; dark primary buttons and avatar text are 3.38:1 | Medium | Adjust the muted and on-brand text tokens to reach 4.5:1 |

### 2.7 End-to-end scenarios

| ID | Scenario | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| E1 | Full service lifecycle: submit, information loop, assign, diagnose, hold, follow-up, failed test, pass, resolve, reject, pass again, accept, recurrence | Composed from `server/tests.py:66-177`, `tools/smoke.js:72-190`, `tools/pagetest.js:223-510`; every step has a test and the final statuses match | PASS | Not replayed as one live UI session; steps are asserted separately | - | Add one scripted end-to-end session |
| E2 | Coordinator walk-in request then cancel with reason; Cancelled stays out of completed totals | `server/tests.py:955`, `1178`; cancellation and audit assertions | PASS | Exclusion from completed totals is not directly asserted | - | Add the completed-total assertion |
| E3 | Dependency that cannot proceed leads to cancellation with reason | `server/tests.py:161` | PASS | - | - | - |
| E4 | No response stays Resolved, reminder sent, then authorized closure with reason | `server/tests.py:1360-1362`; closure code `server/engine.py:1090-1140` | PASS | Authorized ticket closure has no positive automated test, only the job-closure analogue | - | Add a positive authorized-closure test |
| E5 | Maintenance schedule, duplicate check, reschedule, checklist, fault, complete, confirm, next due; incomplete/cancelled never Successful | `server/tests.py:179-303`, `tools/smoke.js:192-215` | PARTIAL | Availability re-check on the agreed date and next-due arithmetic are not asserted; M6 is partial | Low | Extend the maintenance scenario with both checks |
| E6 | Reports show the scenario outcomes with filters; Resolved, Closed, Cancelled separate | `server/tests.py:1185-1240`, `tools/pagetest.js:675` | PARTIAL | Cancelled exclusion from completed and Resolved/Closed separation are only partly asserted | Low | Add report count assertions for the scenario dataset |

## 3. Role matrix

Walkthrough evidence: `docs/audit-screenshots/role-walkthrough.json`, `docs/audit-screenshots/forbidden-probe.json`, `tests/audit/results/scope_probe.json`, `tests/audit/results/technician_scope_probe.json`. Demo accounts were used with the demo gate on and a throwaway database.

### 3.1 Office Requester (A. Delos Reyes, Records Office; 2 tickets in scope)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Dashboard, My Requests, New Request, Maintenance Visits, Office Register, Workflow Guide, Notifications | Dashboard, My Requests, New Request, Confirmation, Office Register, Maintenance Visits, Reports, Notifications, Profile. Workflow Guide missing; Confirmation and Reports are extra but office-scoped |
| Dashboard panels | Needs your action, office counts, upcoming visits | My service dashboard, ticket activity, status breakdown, needs your action, recent updates, active queue, service breakdown |
| Ticket actions | Supply information, reply, accept or reject, request withdrawal, recurrence on Closed, availability and reschedule | In Progress: read only, "Waiting on IT Technician". Closed: open Confirmation and Closure. Actions match the lane |
| Hidden expected | Internal notes, costs, assignment, priority, other offices, schedules, admin, staff filters, bulk actions | No internal notes or costs in API data; no staff navigation; office scope enforced |
| Direct URL | Forbidden page rejected | `mgmt-users.html` redirected to non-existent `/or-users.html` (404); bare `users.html` showed the neutral access panel with content hidden by `body.access-denied` |
| Direct API | Rejected | `/api/users` 403; assign, officeDecision, diagnose blocked; `POST /api/state` 403 |

### 3.2 IT Technician (J. Tan; 7 tickets in scope)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Dashboard, My Tickets, My Maintenance Jobs, Office Register, Workflow Guide, Notifications | Dashboard, My Tickets, My Maintenance Jobs, Office Register, Reports, Notifications, Profile. Workflow Guide missing |
| Dashboard panels | My queue, On Hold, today's visits, workload | Technician dashboard, ticket activity, status breakdown, coming up, needs your action, recent updates, active queue, costs/recurring/PM, service breakdown |
| Ticket actions | Start work, diagnose, hold, service entries, tests, resolve, checklist, fault, internal notes | Assigned: Return to work, Place on hold. In Progress: Place on hold, Record the test result. Resolved/On Hold: read only with "Waiting on" |
| Hidden expected | New Request, assign, priority, cancel, close, schedules edit, other technicians, org reports, admin | Navigation contains none of the forbidden destinations; no other technicians' tickets in the list |
| Direct URL | Forbidden page rejected | `ic-review.html` redirected to `/or-review.html` (404); bare `review.html` neutral panel |
| Direct API | Rejected | `/api/users` 403; officeDecision and diagnose blocked; start work on a reassigned ticket rejected ("Only the assigned technician can start this ticket") |

### 3.3 IT Coordinator (all offices; 9 tickets in scope)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Dashboard, Tickets, New Request, Maintenance, Office Register, Reports, Workflow Guide, Notifications | Dashboard, Tickets, New Request, Review and Assign, Confirmation, Maintenance, Office Register, Reports, Notifications, Profile. Workflow Guide missing |
| Dashboard panels | Submitted review, On Hold follow-ups, unassigned, overdue, workload, maintenance due | Coordination dashboard, ticket activity, status breakdown, technician workload, coming up, needs your action, on hold dependency, recent updates, active queue, costs/PM, service breakdown |
| Ticket actions | Review, request information, assess, assign, follow-up, cancel, authorized closure, reminders, internal notes | Submitted: request missing details, assign, cancel. On Hold: return to work, cancel. Resolved: cancel. No diagnose, test, accept or reject |
| Hidden expected | Diagnosis and tests, office decision, administration | No diagnose or test action appears; officeDecision API blocked |
| Direct URL | Forbidden page rejected | `mgmt-users.html` redirected to `/or-settings.html` (404); bare `settings.html` neutral panel |
| Direct API | Rejected except documented reads | `/api/users` 200: server permits coordinator read (`server/app.py:448-466`), consistent with choosing staff; assign blocked until assessment; diagnose and officeDecision blocked |

### 3.4 System Administrator (all offices; 9 tickets in scope)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Administration, audit viewer, Workflow Guide, Notifications | Dashboard, Service Records, Maintenance, Office Register, Reports, Users, Offices, Configuration, Audit Log, Notifications, Profile. Workflow Guide missing |
| Dashboard panels | Oversight only; read-only records | Oversight dashboard, ticket activity, status breakdown, workload, coming up, recent updates, queue, costs/PM, breakdown |
| Ticket actions | None | Every status is read only with the correct "Waiting on" owner; `transitions: []` for all eight |
| Hidden expected | Ticket steps, editing audit | No transition controls; audit page has no edit or delete controls |
| Direct URL | Forbidden page rejected | `or-request.html` redirected to `/or-request.html`-style missing own-prefix page (404); bare `request.html` neutral panel |
| Direct API | Read-only | `/api/users` 200; ticket write through `POST /api/state` is refused by code (`server/app.py:823-824`) |

Cross-role observations:
- No role navigation currently includes the Workflow Guide, although every role is permitted to open it. This affects Section 4.1 to 4.4 and test 73.
- The access guard is visually effective but a cross-role prefixed URL lands on `404.html`, not on the neutral panel. The neutral panel appears only when the bare page is opened.
- The server allows coordinators to read the user list. This is not treated as a failure because the assignment and maintenance forms need staff names, but it is broader than the "no administration" wording in Section 4.2.

## 4. Tests

### 4.1 Commands run and results

Environment: Python 3.14, Node.js 24, headless Chrome through the DevTools Protocol. There is no `package.json`, so npm install, lint, type check and a production build are not applicable. There is no Firebase project in this architecture, so the security-rules emulator is not applicable. No command touched production data, production rules, or secrets, and `firebase deploy` was never run.

| Command | Result |
|---|---|
| `python server/tests.py` | 383 passed, 0 failed |
| `node tools/smoke.js` | 60 passed, 0 failed |
| `node tools/pagetest.js` | 555 passed, 0 failed |
| `node tools/rolepages_test.js` | 182 passed, 0 failed |
| `python tools/api_check.py` | 17 passed, 0 failed |
| `node tools/parity_check.js` | PERMISSION PARITY PASS (20 pages, 42 actions, 8 transition sources) |
| `python tools/appendix_c_check.py` | PASS (81 nodes, 106 edges, 80 implemented plus N75 legend artifact) |
| `python tools/ui_check.py` | PASS, 73 pages checked |
| `python tools/validate.py` | VALIDATION PASSED |
| `python tools/js_syntax_check.py` | PASS, 193 inline blocks |
| `python tools/responsive.py` | 73 pages x 37 viewports, 15 failures, all dashboard label clipping at 1180x820, 1280x720 and 1366x768 |
| `python tests/audit/theme_tokens.py` | 41 tokens, 0 mismatches |
| `python tests/audit/contrast_touch_probe.py` | 52 screens checked; contrast and 44 px failures recorded |
| `python tests/audit/role_walkthrough.py` | Four-role walkthrough JSON and screenshots |
| `python tests/audit/scope_probe.py` | Office scope enforced |
| `python tests/audit/state_merge_probe.py` | Two integrity defects reproduced over HTTP |

### 4.2 The 102 required tests

Status values: Present and passing (asserts the core behavior; the suite passes), Partial (touches part of the claim), Missing (no automated assertion found). "Audit probe only" means this audit measured it but the project has no test.

| # | Required test | Status | Evidence |
|---|---|---|---|
| 1 | Unique ticket number | Present and passing | `tools/smoke.js:72` |
| 2 | Coordinator enters on behalf | Present and passing | `server/tests.py:975` |
| 3 | Both paths create valid records | Present and passing | `server/tests.py:955`, `975` |
| 4 | New request starts Submitted | Present and passing | `tools/smoke.js:75` |
| 5 | Incomplete becomes Needs Information | Present and passing | `server/tests.py:70` |
| 6 | Supplying details updates same ticket | Present and passing | `server/tests.py:76` |
| 7 | No duplicate in the information loop | Present and passing | `tools/smoke.js:83` |
| 8 | Prioritize and assign | Present and passing | `server/tests.py:83` |
| 9 | Assignment sets Assigned and records event | Present and passing | `server/tests.py:84`, `1165` |
| 10 | New ticket linked to previous record | Partial | `tools/smoke.js:161` covers recurrence only; intake link untested |
| 11 | Diagnosis and findings | Present and passing | `tools/pagetest.js:510` |
| 12 | On Hold requires four fields | Partial | `server/tests.py:146`; missing-field rejection not asserted |
| 13 | Pending dependency stays On Hold | Partial | `server/tests.py:149`; status not re-read |
| 14 | Resolved dependency returns to In Progress | Present and passing | `server/tests.py:152` |
| 15 | Cannot proceed leads to cancellation | Present and passing | `server/tests.py:161` |
| 16 | Approval only when required | Present and passing | `server/tests.py:1306` |
| 17 | Failed test stays In Progress | Present and passing | `tools/smoke.js:141` |
| 18 | Passed test allows Resolved; Resolved impossible without a pass | Present and passing for the engine path | `server/tests.py:103`; contradicted at API level by `tests/audit/results/state_merge_probe.json` (see W9) |
| 19 | Office notified when confirmation required | Partial | `server/tests.py:104`; notification not asserted |
| 20 | Accept records person and date | Present and passing | `server/tests.py:116` |
| 21 | Accept transitions to Closed | Present and passing | `server/tests.py:114` |
| 22 | Reject records feedback, returns to In Progress | Partial | `tools/smoke.js:177`; feedback text not asserted |
| 23 | No response stays Resolved | Present and passing | `server/tests.py:1360` |
| 24 | Reminders never close | Present and passing | `server/tests.py:1362` |
| 25 | Cancellation records reason, preserves history | Present and passing | `server/tests.py:1178` |
| 26 | Closed and Cancelled update the register | Missing | `server/tests.py:1181` asserts ticket count only |
| 27 | Recurrence only from Closed | Partial | `server/tests.py:176`; Closed-only guard not asserted |
| 28 | Authorized closure role, reason, audit | Partial | `server/tests.py:226` tests job closure; ticket path not asserted |
| 29 | Schedule records all fields | Present and passing | `tools/smoke.js:192` |
| 30 | Not-due schedule stays active | Partial | `tools/smoke.js:205`; active flag not re-read |
| 31 | Due schedule checks occurrence | Present and passing | `tools/pagetest.js:580` |
| 32 | Existing job reused | Present and passing | `tools/smoke.js:203` |
| 33 | Missing job generated and linked | Present and passing | `tools/pagetest.js:583` |
| 34 | Concurrent duplicate prevention | Partial | `server/tests.py:291` is sequential only |
| 35 | Unavailable office rescheduled, check repeats | Partial | `server/tests.py:265`; repeat check not asserted |
| 36 | Checklist item records all five fields | Partial | `tools/pagetest.js:543` covers result and finding |
| 37 | Additional fault linked ticket | Present and passing | `server/tests.py:260` |
| 38 | Job independently documented | Partial | `server/tests.py:260`; record integrity after fault not asserted |
| 39 | Incomplete or cancelled never Successful | Present and passing | `server/tests.py:236`, `242` |
| 40 | Next due follows schedule | Partial | `server/tests.py:206`; arithmetic not asserted |
| 41 | Service records linked to offices | Present and passing | `server/tests.py:1075` |
| 42 | Services without assets | Partial | `server/tests.py:983`; asset field not asserted |
| 43 | Every status change audited with all fields | Partial | `server/tests.py:1165`; timestamp and previous status not asserted |
| 44 | Report filters all five | Partial | `server/tests.py:1205`; date, category, technician not asserted |
| 45 | Cancelled excluded from completed | Partial | `tools/pagetest.js:675`; exclusion not asserted |
| 46 | Resolved not counted as Closed | Partial | `server/tests.py:1197`; closed exclusion not asserted |
| 47 | Reports and exports respect office scope | Present and passing | `server/tests.py:685` |
| 48 | Exhaustive disallowed transition test | Partial, requirement FAIL | `tools/permission_parity_check.py:130` compares lists statically; no pair is exercised; see W15 |
| 49 | Each role only its transitions | Partial | `tools/permission_parity_check.py:138`; runtime guards sampled |
| 50 | Unauthorized reads blocked | Present and passing | `server/tests.py:374` |
| 51 | URL or ID cannot bypass office scope | Present and passing | `server/tests.py:487` |
| 52 | Office users cannot read internal notes | Present and passing | `tools/pagetest.js:1307` |
| 53 | Audit cannot be updated or deleted | Missing | `server/tests.py:480` tests hiding, not immutability; see R2 |
| 54 | Asia/Manila display | Present and passing | `tools/time_check.js:38` |
| 55 | Availability answer; unavailable requires a date | Partial | `server/tests.py:273`; missing-date rejection not asserted |
| 56 | Fault ticket system-created, linked, Submitted | Partial | `server/tests.py:260`; creator and status not asserted |
| 57 | Requester recurrence only from Closed | Partial | `tools/smoke.js:161`; guard not asserted |
| 58 | Primary pages work on mobile, tablet, desktop | Partial | `tools/responsive.py:276` measures layout; behavior not driven |
| 59 | No horizontal overflow at 320 px | Present and passing | `tools/responsive.py:304`; no failure at 320 |
| 60 | Forms, dialogs, tables, menus, charts usable on small screens | Partial | `tools/responsive.py:322`; 36 to 42 px controls and clipping recorded |
| 61 | Loading, empty, error states | Missing | Empty states exist; no assertion |
| 62 | Shared design tokens only | Partial | `tools/ui_check.py:150` blocks inline styles; token values not checked per page |
| 63 | Status and priority badges show text and icon; Resolved and Closed distinct | Partial | `tools/pagetest.js:1250`; icon and distinctness not asserted |
| 64 | Screenshots at 390, 768, 1440 reviewed | Missing | `tools/shots.py` captures; no review assertion |
| 65 | Contrast 4.5:1 | Missing, measured FAIL | `tests/audit/contrast_touch_probe.py`; examples in V4 |
| 66 | Role navigation only | Present and passing | `tools/rolepages_test.js:523` |
| 67 | Actions per status; waiting owner | Present and passing | `tools/pagetest.js:338` |
| 68 | Direct URL or API outside role rejected | Present and passing | `server/tests.py:382` |
| 69 | Technician cannot read or change others' work | Present and passing | `server/tests.py:1257` |
| 70 | Coordinator cannot diagnose, test or decide | Partial | `server/tests.py:110`; coordinator diagnose not asserted |
| 71 | Requester limited actions and data | Present and passing | `tools/pagetest.js:461` |
| 72 | Permission map parity test | Present and passing | `tools/permission_parity_check.py:111` |
| 73 | Workflow Guide lanes and current lane | Present and passing | `tools/appendix_c_check.py:40`; `flow.html:246-260` |
| 74 | Waiting-on labels match 4A.3 | Present and passing | `tools/pagetest.js:1050` |
| 75 | Light, Dark, System, persist, no flash | Partial, measured FAIL for System | `tools/pagetest.js:781`; `js/theme.js:42-48`; no dark media query (`css/app.css:1614`) |
| 76 | Both themes 4.5:1; no hard-coded colours | Missing, measured FAIL | Contrast probe; see V1 and V4 |
| 77 | Resolved and Closed distinct in both themes | Missing | `tools/pagetest.js:1251` covers the priority edge only |
| 78 | PWA installable; no protected cache | Partial | `tools/pagetest.js:718`; cache and sign-out not asserted |
| 79 | Phone tab bar, safe areas, 44 px | Partial | `tools/pagetest.js:1153`; 36 to 40 px controls measured |
| 80 | Camera capture on phone inputs | Missing | `capture="environment"` present in markup; no test |
| 81 | Light and dark screenshots at three widths reviewed | Missing | `tools/shots.py` captures only |
| 82 | Appendix C coverage | Present and passing | `tools/appendix_c_check.py:45` |
| 83 | Ticket list per Appendix E.1 | Partial | `server/tests.py:540`; columns, chips, exports not asserted |
| 84 | Ticket detail per Appendix E.2 | Present and passing | `tools/pagetest.js:330`, `338` |
| 85 | Dashboard per Appendix E.3 | Present and passing | `tools/pagetest.js:954` |
| 86 | Ticket numbers unique under concurrency | Partial | `tools/smoke.js:72`; concurrency not tested |
| 87 | Every operation guards role, office, status and writes audit/register in one transaction | Partial | `server/tests.py:1257` samples guards; exhaustiveness not tested |
| 88 | Attachments per D21 | Present and passing | `server/tests.py:614` |
| 89 | Login matches 14.15 at desktop | Present and passing | `tools/pagetest.js:753`; `docs/screenshots/login-1440-*.png` |
| 90 | Login at 390x844 stacks and shows the button; no 320 overflow | Present and passing | `docs/screenshots/login-390-light.png` shows the button at about 549 px; responsive run has no 320 overflow |
| 91 | Non-institutional rejected; unprovisioned Access not granted | Partial | `server/tests.py:828`; the "Access not granted" screen is not tested |
| 92 | Demo list only with flag | Not met by design | `tools/pagetest.js:772` asserts the list is always visible, per `AGENTS.md` and D25; conflicts with the master prompt |
| 93 | Login readable in both themes, 4.5:1 over photo | Missing | Contrast probe skips photo backgrounds |
| 94 | Login files unchanged and render identical | Missing | Hash check and diff only; no render comparison |
| 95 | Theme tokens identical; no new hard-coded colours | Missing | `tests/audit/theme_tokens.py` passes (41/0), audit probe only |
| 96 | Role-only navigation, panels, actions, columns, report types; forbidden URL panel | Present and passing | `tools/rolepages_test.js:555` |
| 97 | Unavailable actions hidden, not disabled; waiting text | Partial | `tools/rolepages_test.js:498`; disabled/hidden distinction not asserted |
| 98 | Every authenticated page uses the shell and works at three widths in both themes | Partial | `tools/ui_audit.js:47`; shell placeholders only |
| 99 | Board view valid moves, snap back, backend rejects | Partial | `tools/pagetest.js:1290`; snap-back and backend rejection not asserted |
| 100 | Technician mobile: Today, queue, 44 px checklist, progress, evidence, sticky bar | Partial | `tools/pagetest.js:1551`; 40 px checklist segments measured |
| 101 | Responsive matrix at all widths, both themes, 200 percent zoom | Partial, measured FAIL | `tools/responsive.py:50`; 15 dashboard clip failures; no dark pass |
| 102 | Role-purposeful dashboard tiles; scoped command palette | Partial | `tools/pagetest.js:1336`; schedules not asserted |

## 5. Appendix C coverage

`python tools/appendix_c_check.py` reports:

- Nodes: 81 expected, 81 found, 80 implemented in the process data, with N75 as the legend artifact excluded by the prompt.
- Edges: 106 implemented.
- Lanes: Office Requester or Office Representative, IT Coordinator, IT Technician, System, in that order.
- Result: APPENDIX C COVERAGE PASS.

The Workflow Guide page renders these lanes and dims the lanes other than the signed-in role. The only gap is discoverability: no role navigation links to the page.

## 6. Frozen items

### 6.1 Login page

- During this audit no tracked login file was edited. `git status --porcelain` listed only untracked audit directories.
- `sha256sum -c docs/login-baseline.sha256`:
  - `login.html`, `css/login.css`, `js/login.js`, `js/theme.js`: FAILED.
  - `img/UPLoginUI.PNG`, `img/login-bg.jpg`, `img/login-bg2.png`, `img/up-seal.png`, `img/upc-seal.png`: OK.
- `git diff --stat c384e4c..HEAD -- login.html css/login.css js/login.js js/theme.js`: 85 insertions, 38 deletions across the four failed files.
- The differences are the always-visible demo account block, the glass surface treatment, and the theme helper changes, all present in commits that predate this audit (for example b66e55d, 97b074b). They were not introduced by the audit.
- A before/after render comparison was not possible because the baseline build is not retained. This is disclosed as a limitation, not treated as proof of equality.

### 6.2 Colour theme

- `tests/audit/theme_tokens.py` compares 41 tokens with `docs/THEME_SNAPSHOT.md`: 0 mismatches.
- No new brand colours were added. `css/console.css` contains hard-coded white and black alpha overlays and shadow tones only, which `AGENTS.md` explicitly permits.
- The login page loads `app.css`, `green.css`, `kit.css` and `login.css` and does not load `console.css`, as required.

## 7. Screenshots and limitations

Audit screenshots in `docs/audit-screenshots/`:

| File | Content |
|---|---|
| `requester-dashboard-1440.png`, `requester-dashboard-390.png`, `requester-ticket-1440.png` | Requester role |
| `technician-dashboard-1440.png`, `technician-dashboard-390.png`, `technician-ticket-1440.png` | Technician role |
| `coordinator-dashboard-1440.png`, `coordinator-dashboard-390.png`, `coordinator-ticket-1440.png` | Coordinator role |
| `management-dashboard-1440.png`, `management-dashboard-390.png`, `management-ticket-1440.png` | Management role |
| `role-walkthrough.json` | Navigation, dashboard headings, action card per status, forbidden URL and API probes |
| `forbidden-probe.json` | Redirects and neutral panel behavior per role |

The repository already contains 124 light and dark screenshots at 390, 768 and 1440 px in `docs/screenshots/` for every major page, captured on 2026-10-29 before this audit. Two were reviewed for this report (requester dashboard and login at 390). The rest were not re-reviewed image by image, which is why test 81 is marked partial.

Limitations:

1. The in-app browser tool reported `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`, so all runtime checks used a headless Chrome session over the DevTools Protocol. There was no other browser engine.
2. No baseline login build exists, so the freeze comparison used hashes and `git diff`, not computed styles.
3. The contrast probe cannot measure text painted over a photograph, so the login page photo contrast (test 93) is not measured.
4. The responsive sweep measured layout, clipping, overflow and touch target boxes. It did not drive every form and dialog at every width.
5. There is no npm toolchain, Firebase project, or emulator; those checks are not applicable and were not run.
6. All runtime work used demo accounts, the demo gate and a throwaway SQLite database. Production data and rules were never accessed.

## 8. Prioritized fix list

### Blocker

1. **State merge integrity (W15, W9, R1).** `POST /api/state` accepts new tickets in any of the eight statuses, accepts arbitrary ids, and replaces the tickets collection with the incoming list, deleting omitted records. Rework it so updates merge by id without deleting absent records, and so creation is rejected or routed through `engine.create_ticket`. Emit an audit event for every accepted change.

### High

2. **Audit immutability (R2).** `POST /api/import` replaces the audit list when the incoming length is equal or greater. Require byte-for-byte prefix preservation of every existing entry and add a test that attempts an in-place rewrite.
3. **Transition enforcement tests (W15, test 48).** Add an exhaustive from-to matrix test over all eight statuses and four roles, called through the HTTP API, not only through the engine.
4. **State-created records audit (R1).** If creation through state sync remains supported, record actor, time, initial status and remarks in the same save.

### Medium

5. Add a 30-minute idle timeout to sessions (S8).
6. Seed Daily, Every 2 weeks, Every 6 months and Custom frequencies and support a custom interval (M1).
7. Re-open the availability question when a rescheduled visit date arrives (M6).
8. Hide Request source and Priority from requester intake and reject them on the server for that role (U7).
9. Implement System theme with `prefers-color-scheme`, including the prepaint path (V1).
10. Raise muted light text and white-on-brand dark text to 4.5:1 (V4, test 76).
11. Raise phone controls to at least 44 px: status chips, checklist segments, ticket links, inputs (V3, test 100).
12. Fix dashboard bar label clipping at 1180x820, 1280x720 and 1366x768 (test 101).
13. Add register propagation assertions for close, cancel, recurrence and maintenance outcome (R3).

### Low

14. Add ticket and report print views with letterhead (U6, U10).
15. Restore a Workflow Guide destination in each role navigation (U12), or record owner approval for removing it.
16. Re-record an approved login baseline or restore the frozen files (U1).
17. Add a visible error state and align forbidden-URL copy with "This page is not available" (U14).
18. List the PNG and maskable icons in `manifest.webmanifest` (V2).
19. Add concurrent tests for ticket id generation and job generation (W3, M4).
20. Add a job-level technician assignment or reassignment action (M5).
21. Add a previous-record selector to coordinator intake (W16).
22. Resolve the demo-list conflict between `AGENTS.md` D25 and master test 92 in writing (S5).
23. Extend the maintenance and reports end-to-end scenarios with the missing assertions (E5, E6).
24. Add a board invalid-move snap-back test and its direct-API rejection (U5, test 99).

## 9. Verdict

**NOT COMPLETE.**

There are 7 FAIL items, 1 of them Blocker and 3 High, and 19 PARTIAL items, 6 of them Medium. The prompt permits a COMPLETE verdict only when there are zero FAIL or PARTIAL items at Blocker or High severity and every NOT VERIFIED item is explained. That condition is not met.

The core service workflow, role separation, office scoping, maintenance lifecycle, reports and visual shell are substantially implemented and backed by passing automated suites. The blocking work is concentrated in the unguarded state merge path, audit immutability, and the missing transition matrix test. The remaining defects are bounded and can be fixed without redesigning the workflow.
