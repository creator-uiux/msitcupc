# Implementation checklist

Tracks the master specification against this repository
(`C:\Users\Admin\Documents\MaintenanceV5`). Status legend:

- `DONE` implemented and covered by a test or a documented check.
- `PARTIAL` behaviour exists but does not yet satisfy the whole clause.
- `NOT RUN` implemented but not verified by an executed check.
- `ASSUMED` implemented as a configurable default and recorded in `ASSUMPTIONS.md`.

The authoritative workflow is the 29 step SOP in the bundled
`docs/source/Maintenance_System.pdf`, which matches Appendix A verbatim.

## Phase 1. Repository and source

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1.1 | Keep the existing zero-build HTML/CSS/JS stack and the stdlib Python and SQLite backend | DONE | root pages, `css/`, `js/`, `server/`; no bundler or package manager step |
| 1.2 | Read the source PDF and compare it with Appendix A | DONE | one page, 9509 characters; the 29 step SOP matches Appendix A; owner Anthony Derecho |
| 1.3 | Use one canonical dataset in the server and the browser demo | DONE | 9 tickets, 8 offices, 10 people, 7 schedules, 6 jobs, 4 notifications and 11 audit records in `server/seed.py` and `js/store.js` |
| 1.4 | Keep the browser demo deterministic | DONE | `?demo=1` freezes the clock and disables the random intake; fixed anchor 1786550400000 |

## Phase 2. Status model, transitions and audit

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 2.1 | Exactly eight status labels | DONE | `engine._LABELS`, `query.ALL_STATES`; the same labels appear on every screen |
| 2.2 | The trusted backend rejects every transition outside the matrix | DONE | `permissions.json`, `engine.TRANSITIONS`; exhaustive transition test in `server/tests.py` |
| 2.3 | Technician writes are limited to records assigned to them | DONE | `engine._assigned_to_actor`; HTTP scope assertions |
| 2.4 | Requester withdrawal and coordinator cancellation split | DONE | `engine.request_withdrawal` and `engine.cancel`, with a mandatory reason |
| 2.5 | Authorized closure roles are configurable and always audited | DONE | `settings.authorizedClosureRoles`; `engine.close` |
| 2.6 | Internal notes never reach an office session | DONE | `app._scoped_requester` removes them; `server/tests.py` |
| 2.7 | Internal cost and labour never reach an office session | DONE | `app._scoped_requester` removes `diagnosis.cost`, `diagnosis.labor` and peso amounts from history; cost columns are hidden in the requester interface |
| 2.8 | The audit log is append only and has no client update or delete path | DONE | `engine._audit`; no audit mutation endpoint |
| 2.9 | Every mutation records actor, role, time, from and to status and reason | DONE | `engine._audit` / `_audit_status`; automated steps use the System actor |
| 2.10 | Asia/Manila display and storage in UTC | DONE | `js/time.js`; `tools/time_check.js` passes under three host timezones |
| 2.11 | Idempotent intake and maintenance occurrence keys | DONE | `idempotencyKey` on intake; normalized occurrence key plus a unique index |
| 2.12 | Unprovisioned Google accounts are refused with "Access not granted" | DONE | `server/auth.py` `not_provisioned`; `login.html` access panel |
| 2.13 | Google sign-in is restricted to `@upcebu.edu.ph` on the trusted layer | DONE | default allowed domain in `server/app.py`; domain check in `server/oidc.py`; assertion in `server/tests.py` |
| 2.14 | Server demo credentials are behind an explicit flag and off by default on a network bind (the sign-in account list is always shown, see Phase 19) | DONE | `server/app.py` demo gate, `--demo` / `--no-demo`, `ITC_DEMO_MODE`; demo usernames refused when off |
| 2.15 | Attachments are limited to the specified types and size | DONE | `server/app.py` allows jpg, png, webp, pdf, docx, xlsx, csv and txt only, 10 MB per file and 10 files per record; video is refused by test |
| 2.16 | Attachments are streamed from an authorised endpoint, never a public path | DONE | `GET /api/attachment` checks the bearer token or the media token, office scope and role |

## Phase 3. Workflow

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 3.1 | Review, ask for missing information and return the same ticket | DONE | `engine.request_info`, `submit_info`; tests and smoke |
| 3.2 | Impact and urgency map to priority through the configurable matrix | DONE | `engine.priority_for`, `settings.priorityMatrix`; settings screen |
| 3.3 | Per category approval flag, off by default | DONE | `settings.approvalCategories`; `engine.start_work` |
| 3.4 | Assignment and reassignment with notification and audit | DONE | `engine.assign`, `engine.reassign` |
| 3.5 | Dependency hold, follow-up and its three outcomes | DONE | `place_hold`, `follow_up`, `resolve_dependency`, `cancel_from_dependency` |
| 3.6 | Diagnosis, repair record, parts, cost, labour, dates and evidence | DONE | `engine.diagnose`, `engine.record_repair`; costs are staff only |
| 3.7 | Test pass resolves, test fail returns to diagnosis | DONE | `engine.record_test`; exhaustive tests |
| 3.8 | Office confirmation, rejection and the no response reminder loop | DONE | `office_decision`, `world_tick`; a no response never auto closes |
| 3.9 | Recurrence creates a linked new ticket | DONE | `engine.create_linked_ticket` |
| 3.10 | The record screen shows conversation, service record, dependencies, history and related records | DONE | `ticket.html` tabs; `js/ui.js` |
| 3.11 | The stepper and the "Waiting on" owner are visible on every record | DONE | `UI.stepper`, `UI.waitingOn`; ticket, list, dashboard and job screens |

## Phase 4. Preventive maintenance

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 4.1 | Schedules, due checks and occurrence generation | DONE | `engine.create_schedule`, `run_schedule_check`; worker and manual action |
| 4.2 | Duplicate occurrences are impossible | DONE | occurrence key normalization and unique index; tests |
| 4.3 | Reschedule keeps the cadence anchor and records from, by, role and reason | DONE | `engine.reschedule_job`; history |
| 4.4 | Office availability and the new date are agreed, not set by the technician | DONE | `confirm_availability`, `reschedule_job`; lane tests |
| 4.5 | Checklist items, evidence and an incomplete checklist guard | DONE | `record_checklist_item`, `record_outcome` |
| 4.6 | Additional fault creates a linked corrective ticket | DONE | `flag_additional_fault`, `create_fault_ticket` |
| 4.7 | Outcome is Successful, Incomplete or Cancelled, never Rescheduled | DONE | `engine.record_outcome`, `_finalize_job_outcome` |
| 4.8 | Next due date advances after a completed, incomplete or cancelled visit | DONE | `engine._advance_next_due`; tests |

## Phase 5. Register, reports and dashboard

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 5.1 | Office IT Service Register with history, assets, maintenance and audit tabs | DONE | `register.html`; audit tab is hidden for office users |
| 5.2 | Eight standard reports with one definition each | DONE | `REPORT_DEFINITIONS.md`, `server/query.py`, `js/query.js` |
| 5.3 | Completed and awaiting confirmation are separate; cancelled is separate from both | DONE | `query.summarize`; tests |
| 5.4 | Overdue excludes Resolved, Closed and Cancelled | DONE | `query.is_overdue`; seeded overdue ticket `IT-2026-000142` |
| 5.5 | Turnaround and time to closure | DONE | `query.turnaround_hours`, `closure_hours` |
| 5.6 | Office scoped reports and CSV exports | DONE | `app._api_reports`, `app._api_export`; requester and technician scope tests |
| 5.7 | Dashboard has the eight status counts, overdue, activity chart and breakdowns | DONE | `dashboard.html`; page tests |
| 5.8 | Requester report and export contain no cost column | DONE | `reports.html`, `tickets.html` role gate; server snapshot strips the fields |

## Phase 6. Roles, navigation and access

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 6.1 | One permission map shared by the browser and the backend | DONE | `permissions.json`, `server/engine.py`, `js/permissions.js`; parity check |
| 6.2 | Page access and generated role pages for all four roles | DONE | `js/ui.js` `ACCESS`, `tools/role_pages.py`, 49 generated pages |
| 6.3 | Action buttons are gated by the same map the backend enforces | DONE | `UI.canAct`; parity check |
| 6.4 | Office isolation and technician queue isolation on every API path | DONE | `app._scoped`, `_scoped_requester`, `_scoped_technician`; HTTP tests |
| 6.5 | Sessionless role URLs render a signed-out preview, never another role's session | DONE | `bindUrlRole`; `tools/rolepages_test.js` |
| 6.6 | Four primary destinations in the bottom tab bar, the rest in More | DONE | `js/ui.js`; phone page tests |
| 6.7 | Workflow Guide and Roles reference are omitted from phone navigation | DONE | `js/ui.js`; page tests |

## Phase 7. Interface, themes and PWA

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 7.1 | Login screen follows Section 14.15 | DONE | full campus photograph, 1000 by 548 split card, glass hero, badge, two line serif headline, paragraph, Live/Secure/Fast tiles, off white panel, two seals, Welcome back, UPMail pill, helper text and domain line |
| 7.2 | Login works from 320 px to 1440 px, including short screens | DONE | reviewed captures at 320x720, 390x844, 531x553, 768x1024 and 1440x900; the UPMail button stays visible on short phones |
| 7.3 | Light, Dark and System themes, System by default | DONE | `applyTheme`, pre-paint script, theme switch on the login screen and in the app; both themes captured |
| 7.4 | Dark mode keeps the campus photograph visible | DONE | `css/login.css` dark rules; 1440 dark capture reviewed |
| 7.5 | Responsive from 320 px with no horizontal overflow | DONE | `tools/responsive.py`: 0 problems at 8 widths across 71 pages |
| 7.6 | Accessible labels, modal semantics and tap targets | DONE | `tools/deep_audit.js`, `tools/responsive.py`; 0 issues |
| 7.7 | Status and priority badges carry icon and text | DONE | `UI.badge`, `UI.prio` |
| 7.8 | School identity and institutional green design system | DONE | `docs/DESIGN_SYSTEM.md`; tokens in `css/green.css` over `css/app.css` and `css/kit.css` |
| 7.9 | Installable PWA with an offline shell | DONE | `manifest.webmanifest`, `sw.js`, `offline.html`, `js/pwa.js`, maskable icons |
| 7.10 | No emoji in the interface | DONE | shared outline SVG set in `js/ui.js` |
| 7.11 | No em dash in generated text | DONE | `tools/em_dash_check.py` reports zero |
| 7.12 | The Workflow Guide uses all Appendix C nodes, edges and four lanes in order | DONE | `js/flowdata.js`; `tools/appendix_c_check.py` passes with 81 nodes and 106 edges |

## Phase 8. Documentation

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 8.1 | `IMPLEMENTATION_CHECKLIST.md` | DONE | this file |
| 8.2 | `DECISIONS.md` | DONE | D1 to D25 with defaults and change paths |
| 8.3 | `DATA_MODEL.md` | DONE | records, relationships and storage |
| 8.4 | `OPERATIONS.md` | DONE | every backend operation and its role gate |
| 8.5 | `REPORT_DEFINITIONS.md` | DONE | one definition per metric |
| 8.6 | `TRACEABILITY.md` | DONE | clause to code to check |
| 8.7 | `KNOWN_LIMITATIONS.md` | DONE | honest gap list |
| 8.8 | `ROLE_MATRIX.md` | DONE | pages, actions, transitions and data scope per role |
| 8.9 | `DESIGN_SYSTEM.md` | DONE | tokens, components and page patterns |
| 8.10 | `docs/screenshots/` evidence | DONE | 124 captures: 64 base screens (10 screens at 390, 768 and 1440 in light and dark plus four card-view captures), 48 role captures of dashboard and ticket detail, and 12 feature captures of the board, planner and dashboard widgets |

## Phase 9. Verification

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 9.1 | Backend suite | DONE | `python server/tests.py`: 335 passed, 0 failed |
| 9.2 | Workflow smoke | DONE | `node tools/smoke.js`: 60 passed, 0 failed |
| 9.3 | Page integration | DONE | `node tools/pagetest.js`: 361 passed, 0 failed |
| 9.4 | Role page tests | DONE | `node tools/rolepages_test.js`: 182 passed, 0 failed, including computed-display checks for the role visibility classes |
| 9.5 | API integration | DONE | `python tools/api_check.py`: 17 passed, 0 failed |
| 9.6 | Markup and DOM ids | DONE | `python tools/validate.py`: PASSED |
| 9.7 | UI house rules | DONE | `python tools/ui_check.py`: PASSED (71 pages) |
| 9.8 | JavaScript syntax | DONE | `python tools/js_syntax_check.py`: PASS (24 files, 188 inline blocks) |
| 9.9 | Permission parity | DONE | Python and Node parity checks pass; `node tools/parity_check.js` 54 passed |
| 9.10 | Appendix C coverage | DONE | `python tools/appendix_c_check.py`: PASS (81 nodes, 106 edges) |
| 9.11 | Responsive audit | DONE | `python tools/responsive.py`: 0 problems |
| 9.12 | Visual gate | DONE | `python tools/gate_shots.py`: 60 captures, no overflow, no clipped text; 48 additional role captures in `docs/screenshots/` |
| 9.13 | Static structure and content audits | DONE | `html_check.js` 355 passed; `ui_audit.js` 335 passed; `script_order_check.js` 67 passed; `deep_audit.js` 628 passed; `content_check.js` 174 passed |
| 9.14 | Time zone behavior | DONE | `node tools/time_check.js`: PASS under three host timezones |
| 9.15 | Visual review of the captures | DONE | login at 1440 light and dark, 390 light and dark, 320x720, 531x553 and 768 reviewed; the 48 role captures of dashboard and ticket detail read at all three widths in both themes |
| 9.16 | Full designer review of every capture | PARTIAL | the machine gate passed and the key screens were read, but not all 108 images were re-reviewed individually |
| 9.17 | Role visibility in the interface | DONE | `rolepages_test.js` asserts hidden-not-disabled classes per role, sidebar links against the permission map, requester plain language and the neutral forbidden-page panel; `docs/UI_POLISH_REPORT.md` records the matrix |

## Phase 11. One sidebar, role dashboards and pagination

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 11.1 | One navigation column instead of two competing columns | DONE | `js/ui.js` `navModel`/`renderSide`; `css/console.css` `.side-head`, `.side-user`, `.side-nav`, `.side-group`, `.side-link`, `.side-foot`; the old `.rail`/`.ctx` markup and styles are removed |
| 11.2 | Every permitted screen reachable from the sidebar, grouped and labelled | DONE | groups Workspace, Service Requests, Maintenance, Records, Administration; account links at the foot; empty groups omitted. Phase 17 removes the two reference entries from navigation while keeping their routes |
| 11.3 | Role-focused dashboard | DONE | four role tiles, the eight status labels plus Overdue as links into the filtered queue, four role quick actions, scoped data, paginated Needs your action list |
| 11.4 | Status links open the matching filtered queue | DONE | `?status=` and `?queue=overdue` handled in `tickets.html`; the advanced status filter no longer loses the chip |
| 11.5 | Pagination wherever a list or table can grow | DONE | `UI.paginate`/`UI.renderPagination` in dashboard queues, tickets, users, offices, settings reference data, register history/assets/maintenance/audit, reports, review, confirm, notifications |
| 11.6 | No duplicate breadcrumb | DONE | breadcrumbs render once in the top bar; the page-frame injection was removed |
| 11.7 | Frozen surfaces intact | DONE | no diff for `login.html`, `css/login.css`, `js/login.js`, `js/theme.js`, the seals, `app.css`, `green.css`, `kit.css`; only the phase label in `docs/THEME_SNAPSHOT.md` changed, no token values |
| 11.8 | Tests and role pages refreshed | DONE | role pages regenerated (49); page suite 361 passed; role page suite 182 passed; responsive 0 problems; visual gate PASS |

## Phase 12. Dashboard clarity fixes

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 12.1 | One navigation column, no double navbar | DONE | fresh 390, 768 and 1440 captures show a single grouped sidebar; `pagetest.js` asserts the old `.rail` and `.ctx` columns are absent for every role |
| 12.2 | Read-only management gets no empty action card | DONE | the Needs your action card carries `.actor-only`; `body.role-management .actor-only` hides it; `rolepages_test.js` checks computed display for all four roles |
| 12.3 | Coming up items read as product copy, not debug output | DONE | office is the title; category, frequency and asset count form the meta line; technician, date and overdue form the due line; the internal "job ... exists  --  not duplicated" text is removed |
| 12.4 | KPI copy fits its card | DONE | the Overdue delta reads "Past the target date" and stays on one line at 390 and 1440 |
| 12.5 | Evidence refreshed | DONE | 48 role captures and 60 gate captures regenerated; page suite 361 passed; role page suite 182 passed; `ui_check.py`, `validate.py`, `responsive.py` and the visual gate all pass |

## Phase 13. Work-order cards and the command palette

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 13.1 | Work-order card with number, subject, office, category icon, status, priority edge and chip, assignee, due or overdue chip, attachment and reply counts | DONE | `UI.workCard` in `js/ui.js`; `.wo-card` in `css/console.css`; an office requester's reply count excludes internal notes |
| 13.2 | Register list and card layouts, phones default to cards | DONE | `#tkView` switch on `tickets.html`; the choice persists in `itc_ticket_view`; `?view=cards` deep link; bulk selection stays out of the card layout |
| 13.3 | Command palette on Ctrl or Cmd plus K over tickets, offices, assets and schedules, with recent items | DONE | palette in `js/ui.js`; top bar trigger plus the phone app bar search; Arrow keys, Enter and Esc; recent items in `itc_cmdk_recent_v1` |
| 13.4 | Palette scope follows the signed-in role | DONE | requesters stay in their office, technicians see only their assigned records, schedules appear only when the role can open Maintenance; `pagetest.js` asserts all three |
| 13.5 | Deep links open the register and the directory already filtered | DONE | `register.html?q=&office=&kind=&status=&from=&to=` and `offices.html?q=` set both the state and the visible controls |
| 13.6 | Pagination helper is safe when a filtered panel renders no pager | DONE | `UI.renderPagination` returns early for a missing host; this was exposed by the new deep links and fixed |
| 13.7 | Responsive and writing checks | DONE | `responsive.py` 0 problems after the 36 px view toggle on phones; page suite 406 passed; role page suite 182 passed; `ui_check.py`, `validate.py`, `html_check.js`, `parity_check.js` and the visual gate pass |
| 13.8 | Single sidebar retained | DONE (deliberate) | Section 25.5B suggests a rail plus a contextual menu at 1024 to 1919 px; the owner asked for one navigation column, so the grouped sidebar is kept and the deviation is recorded in `KNOWN_LIMITATIONS.md` |

## Phase 14. Ticket board

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 14.1 | A third layout groups the filtered register into the eight workflow states | DONE | `#tkView` Board on `tickets.html`; `#tkBoard` with eight `.wo-col` sections in workflow order |
| 14.2 | Each column states the true count and handles an empty state | DONE | the header uses the query counts for the filtered set, not just the loaded slice; an empty column reads "No tickets" |
| 14.3 | The board is honest about the load cap and never shows a hidden pager | DONE | up to `Query.MAX_SIZE` records per pass; the note reports "Showing the first N of M"; the pager is removed in board view |
| 14.4 | The board uses the same work-order card and respects role privacy | DONE | `UI.workCard`; the office requester's reply count still omits internal notes |
| 14.5 | Board is reachable by deep link, remembered, and hidden from bulk selection | DONE | `?view=board`, `itc_ticket_view`; the bulk bar only appears in the list layout |
| 14.6 | Phones scroll one column at a time with the next column visible | DONE | horizontal snap scroll, 84 vw columns, 36 px view buttons; `responsive.py` 0 problems |
| 14.7 | Tests and visual evidence | DONE | `pagetest.js` 452 passed, including the eight columns, counts, placement and no pager; captures at 1440 and 390 in both themes |

## Phase 15. Maintenance planner

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 15.1 | Month, week and agenda views over the same schedules and visits | DONE | `#plannerCard` on `maintenance.html`; `plannerGrid` and `renderPlannerAgenda`; the view is remembered in `itc_planner_view` |
| 15.2 | Due, visit, rescheduled and overdue are distinct and legible | DONE | typed chips with a legend; a coordinated visit replaces the due chip on the same day so no day prints twice |
| 15.3 | Navigation is explicit and honest | DONE | previous, today and next; month and week name their range, the agenda reports its item count; Today in the agenda jumps to the page holding today |
| 15.4 | A technician sees today's route | DONE | `#techToday` lists today's visits, otherwise names the next visit; hidden for every other role |
| 15.5 | Planner scope matches the page scope | DONE | a technician plans only their own schedules and jobs; IT leads plan the whole register |
| 15.6 | Phones stay readable | DONE | agenda is the phone default, month falls back to dots with a per-day accessible label; tap targets 36 px; `responsive.py` 0 problems |
| 15.7 | Tests and evidence | DONE | `pagetest.js` 452 passed, including six-week month, weekday names, chips, today, period navigation, view memory and the technician panel; captures at 1440 and 390 in both themes |

## Phase 16. Dashboard widgets

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 16.1 | Each role highlight carries a seven day trend | DONE | `UI.sparkline` draws a line and area under the four role tiles; the series key and its plain language title come from `SPARK_LABEL` | 
| 16.2 | Office health is visible without reading a table | DONE | `#healthStrip` lists one card per office with open and overdue counts, a completion meter and a tone; ordered by overdue then open; hidden for an office user and for any scope that resolves to one office |
| 16.3 | Dispatchers can see who carries the queue | DONE | `#workloadBars` stacks assigned, in progress, on hold and other per technician, names Unassigned, prints the total and keeps the stage legend; limited to the roles that dispatch work |
| 16.4 | Preventive compliance is readable at a glance | DONE | `UI.gauge` draws the ring in the costs card; the percent is printed inside it, repeated in words, and exposed through `aria-label` |
| 16.5 | Phones stay legible | DONE | office numbers wrap under the name instead of truncating it, sparklines shorten, the ring shrinks to 72 px; `responsive.py` 0 problems |
| 16.6 | Privacy and scope hold | DONE | the health strip is `staff-only`, the load card is `lead-only`, the ring lives in the `staff-only` costs section; the requester render hides the strip entirely |
| 16.7 | Tests and evidence | DONE | `pagetest.js` 452 passed, including sparkline markup and titles, office ordering and links, load segments adding to the total, ring value and label, and the requester hidden strip; captures at 1440 and 390 in both themes |

## Phase 17. Trimmed navigation and every-screen sizing

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 17.1 | Workflow Guide and Roles and Access no longer clutter the signed-in navigation | DONE | the Reference group is removed from `navModel` in `js/ui.js`, the top bar help link is removed from `renderTop`, and the mobile More sheet derives from `navModel`, so none of the three surfaces lists either page. `pagetest.js` `roleNav` checks all four roles and `mobileNav` checks the More sheet |
| 17.2 | Routes and permissions are unchanged | DONE | `ACCESS` still grants `flow.html` and `roles.html` to every role; `rolesPage` and the role page suite still open them; `permission_parity_check.py` and `parity_check.js` pass |
| 17.3 | One responsive matrix covers phones, tablets, laptops, desktops, ultrawide and 8K | DONE | `tools/responsive.py` `VIEWPORTS` holds 34 viewports from 320x480 to 7680x2160, including 844x390, 932x430, 820x1180, 1180x820, 1366x768, 3440x1440 and 3840x2160 |
| 17.4 | The frozen login is measured, not edited | DONE | `FROZEN_SCREEN_SCROLL` accepted a bounded scroll of at most 120 px on `login.html` only; the largest observed overshoot was 85 px at 360x640. `git diff` showed no change to `login.html`, `css/login.css`, `js/login.js` or the login images. Superseded by Phase 19: the demo account block is now always shown |
| 17.5 | Static checks and suites | DONE | `pagetest.js` 461 passed; `rolepages_test.js` 182 passed; `server/tests.py` 335 passed; `ui_check.py` 71 pages; `validate.py`, `html_check.js` (355), `script_order_check.js` (67), `parity_check.js` (54), `permission_parity_check.py`, `appendix_c_check.py`, `js_syntax_check.py` and `em_dash_check.py` pass |
| 17.6 | Documentation matches the trimmed navigation | DONE | `DESIGN_SYSTEM.md`, `UI_POLISH_REPORT.md`, `ROLE_MATRIX.md`, `KNOWN_LIMITATIONS.md`, `TRACEABILITY.md` and `README.md` describe the hidden entries, the 34-viewport matrix and the bounded login scroll |
| 17.7 | Every page at every audited size | DONE | `responsive.py`: 2414 checks (71 pages x 34 viewports) with 0 problems. The only accepted scroll is the frozen login at 320x480 (19 px), 360x640 (85 px), 375x667 (61 px) and 844x390 (75 px) |

## Phase 18. Requester name locked to the signed-in account

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 18.1 | An Office Requester files only under their own name | DONE | `request.html` `applyRequesterLock`: for the requester role the Requester field shows `UI.auth().name` (A. Delos Reyes on the demo account) and is disabled, so it cannot be typed over |
| 18.2 | The locked value still reaches the ticket | DONE | the submit handler reads `form.elements.requester`, so the disabled field files under the signed-in account; `pagetest.js` asserts the created ticket carries it |
| 18.3 | Clear and Submit another keep the lock | DONE | both paths re-run `applyRequesterLock`; `pagetest.js` checks Clear leaves the field disabled with the same name |
| 18.4 | A coordinator keeps the field editable | DONE | the lock is guarded by `Store.db.role === 'requester'`; the field explains what to enter and `pagetest.js` checks both states |
| 18.5 | Reply mode is unchanged and honest | DONE | `respond` mode still shows the ticket's requester, disabled, with the help text "Carried over from the original ticket." |
| 18.6 | Disabled fields read as set, in both themes | DONE | `css/console.css` locked-value rule uses existing tokens; captured at 1440 in light and dark, computed colours confirm the muted surface and `not-allowed` cursor |
| 18.7 | Tests | DONE | role pages regenerated and `role_pages.py --check` passes; `pagetest.js` 470 passed; `rolepages_test.js` 182 passed; `responsive.py` on the three request pages 0 problems; syntax, em dash, HTML, script order, permission parity and `ui_check.py` pass |

## Phase 19. Demo accounts on the sign-in page everywhere

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 19.1 | The four demo accounts are always listed on the sign-in page, labelled "Demo only", on every host: any localhost port, a static copy and Firebase Hosting. The list no longer depends on `ITC_DEMO_MODE` or the `itc-demo-mode` meta tag | DONE | `js/login.js` `renderDemo` and `showDemo` run unconditionally; the flag branch was removed from the UPMail click; `login.html` no longer carries the meta tag |
| 19.2 | Demo sign-in still works when a hosted server keeps its demo gate closed, without widening server access | DONE | on `0.0.0.0:8799 --no-demo` the page listed all four accounts and the coordinator choice reached `ic-dashboard.html` with `ApiMode` false and a local session; on `127.0.0.1:8798` (demo on) it reached the same page with a server token and `ApiMode` true. `server/app.py` still refuses `{"role": ...}` with `demo_disabled` |
| 19.3 | Page tests cover the new behavior | DONE | `tools/pagetest.js` asserts the list is visible on load, four accounts, the click message and a local coordinator sign-in; PAGE TESTS: 479 passed, 0 failed |
| 19.4 | Every audited viewport still passes | DONE | `tools/responsive.py --pages=login.html`: 34 viewports, 0 problems; the accepted scroll is 377 px at 360x640, 336 px at 320x480 and 345 px at 844x390, recorded in `FROZEN_SCREEN_SCROLL` with a bound of 400 px |
| 19.5 | The service worker ships the new sign-in script | DONE | `sw.js` cache version raised to `itc-shell-v3`, so a returning visitor does not keep the cached `js/login.js` |
| 19.6 | Rules and docs match | DONE | `AGENTS.md`, `DECISIONS.md` D25, `ASSUMPTIONS.md` A26, `DESIGN_SYSTEM.md`, `KNOWN_LIMITATIONS.md`, `README.md` and this checklist describe the always-on list and the bounded scroll |

## Phase 20. Intake priority, office scope and the conversation composer

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 20.1 | New Request offers the office's priority | DONE | `request.html` `#fPriority` lists Low, Medium and High with Medium selected; Critical stays hidden and is reachable only when an existing ticket carries it into reply mode |
| 20.2 | The chosen priority reaches the ticket in both transports | DONE | `Flow.createTicket` validates the value and stores it; `engine.create_ticket` accepts only low, medium and high and stores the choice; `server/tests.py` `test_intake_priority` checks the stored value and the Medium default |
| 20.3 | Reply mode cannot silently re-prioritise | DONE | `setMode` copies the ticket priority, disables the control and labels it "Carried over from the original ticket." |
| 20.4 | The other intake controls are no longer decorative | DONE | the submit handler sends `dateReported` and `idempotencyKey`; the date defaults to today; `Flow.createTicket` and the backend both honour the duplicate key; `server/db.py` persists `date_reported` and `idempotency_key` |
| 20.5 | The Office dropdown covers the real directory | DONE | `fillOffices` reads active offices from `Store.db.offices`, so IT Office and Office of the Director appear; the coordinator keeps every active office selectable (the requester office lock is superseded by 21.1) |
| 20.6 | The conversation reply box is legible in both themes | DONE | `#tComposer textarea` in `css/console.css` uses `--surface-2`, `--ink`, `--line-strong`, `--muted` and the shared focus ring; light and dark captures at 1440 show the placeholder "Write a reply or update..." clearly |
| 20.7 | Tests and responsive audit | DONE | PAGE TESTS: 490 passed, 0 failed; `server/tests.py`: 343 passed; `responsive.py --pages=request.html,or-request.html,ic-request.html,ticket.html,or-ticket.html`: 0 problems; `rolepages_test.js`: 182 passed; UI, validation, HTML, script order, parity, permissions, Appendix C, syntax and em dash checks pass |
| 20.8 | The new shell reaches returning visitors | DONE | `sw.js` cache version raised to `itc-shell-v4`, so the updated request page, `js/flow.js` and `css/console.css` replace the cached v3 shell |
| 20.9 | Documentation matches the intake | DONE | `docs/DATA_MODEL.md` describes intake priority and its confirmation during assessment; this checklist records the phase |

## Phase 21. Requester chooses the office at intake

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 21.1 | The Office Requester can choose the office on New Request | DONE | `request.html` `applyRequesterLock` leaves `#fOffice` enabled, starts it on the signed-in office and locks only `#fReq`; reply mode still carries both fields from the original ticket |
| 21.2 | The chosen office is stored in both transports | DONE | `Flow.createTicket` stores `d.office`; `engine.create_ticket` no longer overwrites it with the caller's office; `server/tests.py` `test_tenancy` checks the Library ticket keeps Library |
| 21.3 | A requester can follow a request raised for another office | DONE | `officeBlock(office, requester)` in `js/flow.js` and `_office_block(state, office, requester)` in `server/engine.py` allow the signed-in name; `_scoped_requester` includes those tickets and their notifications; attachments follow the same rule |
| 21.4 | Other offices stay closed | DONE | `test_tenancy` still blocks `IT-2026-000143`; `test_requester_scope_includes_own_requests` hides another requester's Library ticket and its notification |
| 21.5 | A saved draft keeps the chosen office | DONE | `restoreDraft()` now runs after `applyRequesterLock()`, so a saved draft reopens with its office; Clear and Submit another return the office to the requester default |
| 21.6 | Tests and static checks | DONE | `server/tests.py`: 347 passed; PAGE TESTS: 549 passed; ROLE PAGE TESTS: 182 passed; `smoke.js`: 60 passed; `validate.py`: 365 assertions; `ui_check.py`: 73 pages; `role_pages.py --check` passes; HTML, script order, parity, Appendix C, syntax and em dash checks pass |
| 21.7 | Return visitors get the new page | DONE | `sw.js` cache version raised to `itc-shell-v5`, so the updated request page, `js/flow.js` and register note replace the cached v4 shell |
| 21.8 | Rules and docs match | DONE | `DECISIONS.md` D26, `ASSUMPTIONS.md` A12, `DATA_MODEL.md`, `ROLE_MATRIX.md` and `OPERATIONS.md` describe the selectable office and the raised-request follow-up; this checklist records the phase |

## Phase 23. Maintenance visual language and the responsive matrix

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 23.1 | The board allows only valid, role-permitted moves and explains a refused move | DONE | `tickets.html` board cards carry a Move menu built from `Flow.canTransition`; the chosen move calls the same guarded action as the table, and a refusal keeps the card in place and shows the reason. `pagetest.js` `workOrderCards` asserts every move carries `data-move` and `data-id` |
| 23.2 | The board shows six workflow columns plus one collapsed archive lane | DONE | Submitted through Resolved render in workflow order; Closed and Cancelled share one `details.wo-archive` lane that starts collapsed and has no move controls. `workOrderCards` asserts 7 columns and the collapsed archive |
| 23.3 | Checklist cards record a result, finding and evidence, with progress and a sticky action bar | DONE | `technician.html` `renderJobs` draws one `.chk-card` per task with a four-way segmented control (Passed, Attention needed, Failed, Not applicable), a finding field, evidence chips and a camera input (`accept="image/*" capture="environment"`), a progress bar with text, and a sticky footer with Save progress and Flag additional fault. `pagetest.js` `maintenancePage` covers recording, the dialog fallback and the outcome guard |
| 23.4 | The technician lands on Today and My queue first | DONE | `#wToday` sits above the queue with Visits today and Due or overdue, and My queue sorts In Progress, Assigned, On Hold, Resolved before target date. `technicianToday` covers both |
| 23.5 | One-tap contact, camera evidence and preserved drafts | DONE | `UI.personLinks`, `telLink` and `mailLink` put tel: and mailto: chips on the ticket, user directory and register; contact chips are 36 px and grow to 40 px on a coarse pointer. `request.html` keeps a local draft of the intake fields, and `ticket.html` keeps a separate draft for the office-visible and internal reply modes. `oneTapContact` and `requestDraft` cover them |
| 23.6 | The Office Register shows office health | DONE | `register.html` `#gHealth` renders five health cards for the selected office, each with a tone, counts and a completion meter. `registerHealthAndTimeline` checks five cards, the office scope and the open count |
| 23.7 | A service timeline serves the register and asset history | DONE | the register gains a Service timeline tab built from tickets and jobs, every event carries a mono id and links to its record, and the timeline follows both the role scope and the office filter. `registerHealthAndTimeline` checks the hidden and shown states, the events and the filter |
| 23.8 | Quick create and the command palette stay inside the permitted scope | DONE | every dashboard carries role-specific quick actions, and the palette searches tickets, offices, assets and schedules through `cmScoped`, so a requester sees only their office and a technician only their queue. `commandPalette` covers the groups, the scope and the keyboard |
| 23.9 | The requester has a read-only Maintenance Visits page | DONE | `visits.html` is granted to the requester in `permissions.json` and mirrored in `js/permissions.js`; `or-visits.html` is generated by `tools/role_pages.py`. It lists the visits and plans for the requester's own office and changes no record. `maintenanceVisits` and the 50 page role suite cover it |
| 23.10 | Row density can be comfortable or compact | DONE | `js/theme.js` applies `data-density` before the first paint, the account tray and `profile.html` both offer the choice, and `css/console.css` tightens only table and list padding. `tableDensity` checks the attribute, persistence and the control |
| 23.11 | The responsive techniques and the 200 percent zoom audit | DONE | `css/console.css` adds `dvh` for the app frame, sidebar, trays, palette and dialogs; container queries for the checklist card and the health cards; `hover` rules only under `hover: hover`; and a 40 px control floor under `pointer: coarse`. `tools/responsive.py` now runs 37 viewports, including 640x360, 683x384 and 960x540 as the 200 percent zoom of 1280x720, 1366x768 and 1920x1080 |
| 23.12 | Documentation matches the final prompt | DONE | `docs/MASTER_PROMPT_COMPLETE.md` is the 1456 line final prompt (Sections 25.5A and 25.5B, D27, Definition of Done 35, items 99 to 102, corrected Appendix B.6); the `guide/` copies match. `DECISIONS.md` gains D27, and `KNOWN_LIMITATIONS.md` and `TRACEABILITY.md` use the corrected B.6 wording |
| 23.13 | Suites and captures | DONE | `pagetest.js` 555 passed; `server/tests.py` 382 passed; `rolepages_test.js` 182 passed; `ui_check.py` 73 pages; `js_syntax_check.py` 24 files and 193 inline blocks; `role_pages.py --check` 50 files; `validate.py`, `html_check.js`, `script_order_check.js`, `parity_check.js`, `permission_parity_check.py`, `appendix_c_check.py` and `em_dash_check.py` pass; `responsive.py` 0 problems over 73 pages × 37 viewports (the first 23 viewports in one pass, the remaining 14 in three viewport-bounded passes); `gate_shots.py` 60 captures, machine check PASS |

## Phase 18. Chart detail

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 18.1 | The activity chart reads as a chart, not a strip of bars | DONE | `renderActivity` in `dashboard.html` draws a four step count axis with dashed gridlines and five evenly spaced date labels; `chartScale` keeps whole number ticks and a four step top; the four series, the `#actTable` alternative and the CSV export are unchanged |
| 18.2 | Every day explains itself | DONE | each `.col-day` carries a title with the date, the day's event total and the per series counts; the legend prints the period total beside each series |
| 18.3 | The selected period is summarised | DONE | `#actChart` prints events in range, the busiest day and its count, events per day and days with activity; an empty period states that no activity was recorded |
| 18.4 | Bar lists print their share as well as their count | DONE | the dashboard status breakdown and technician workload, and the reports status distribution and workload, add a `%` column with a title that states the count and denominator; the status fills now use the printed share, so bar length and percentage agree |
| 18.5 | The reports workload bar is genuinely split | FIXED | `#rWork` uses `hbar-split` with one track and two segments. Before, the second `display:block` fill stacked below the first and was clipped, so completed work was invisible. Active uses `--brand-3`, completed `--line-strong`, and the legend names both |
| 18.6 | The ring and sparklines carry more context | DONE | the compliance ring prints `x of y visits successful`, or states that no visits are recorded, under its caption; every KPI sparkline marks its last point with `.spark-dot` in the tile tone |
| 18.7 | Small screens keep the detail readable | DONE | long status and technician names wrap at 599 px and below instead of losing letters, the axis labels drop to 9 px, and the share column tightens; `responsive.py` 2414 checks with 0 problems |
| 18.8 | Tests and evidence | DONE | `ui_check.py` 71 pages, `validate.py`, `html_check.js` 355, `js_syntax_check.py` 24 files and 188 inline blocks, `em_dash_check.py` 0, `pagetest.js` 461 passed, `rolepages_test.js` 182 passed, `role_pages.py --check` 49 files; light and dark 1440 captures reviewed and the 390 px chart section crops reviewed |

## Phase 22. Lane strictness: acceptance, visibility and the read-only administrator

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 22.1 | Accepting the office result records the confirming person and date and closes in one step | DONE | `server/engine.py` `office_decision` accepted writes `confirmation`, sets `status = closed`, `closure = confirmation`, history and audit in the same call; `js/flow.js` mirrors it; `confirm.html` offers one "Office accepts result and closes" action; `server/tests.py` checks one-step closure and the confirming person/date |
| 22.2 | No response keeps the ticket Resolved and sends a reminder | DONE | `office_decision` `no_response` sets `confirmation.state = no_response`, appends a reminder, keeps `resolved`, notifies the office; `js/live.js` and `engine.world_tick` keep the reminder loop running for `pending` and `no_response` |
| 22.3 | The office never sees priority, impact, urgency, technician or maintenance plans | DONE | `server/app.py` `_scoped_requester` removes those fields and empties schedules; `request.html` hides the priority field; `ticket.html`, `tickets.html`, `register.html`, `visits.html`, `dashboard.html`, `reports.html` hide the columns and rows; `js/ui.js` `workCard` and `feed` omit priority and neutralise assignment text |
| 22.4 | The technician never sees priority or assignment controls | DONE | `ticket.html` omits the priority badge and assignment; `tickets.html` and `reports.html` hide the priority column for the technician; `technician.html` drops the priority badge |
| 22.5 | The coordinator can reassign the technician | DONE | `server/engine.py` `reassign` and `js/flow.js` `reassign` (Assigned, In Progress, On Hold; same-tech refused; history, audit and notifications); `review.html` offers "Reassign technician"; `js/actions.js` modal; page test drives it |
| 22.6 | The System Administrator holds no ticket or maintenance work | DONE | Backend guards and `TRANSITIONS_FALLBACK` no longer list management for reassign, approve, cancel, close, reminder, schedule check, schedule edit, job close or comments; `_api_upload` and state merges refuse management; `save_settings` rejects management as a closure role; `maintenance.html` hides the Manage column and schedule check; `permissions.json` management actions are the six administration methods only |
| 22.7 | Tests and static checks | DONE | `server/tests.py`: 382 passed (reassign, no response and administrator read-only covered); PAGE TESTS: 555 passed; ROLE PAGE TESTS: 182 passed; `smoke.js`: 60 passed; `validate.py`: 365 assertions; `ui_check.py`: 73 pages; `html_check.js` 365 passed; `script_order_check.js` 69 passed; `parity_check.js` 54 passed; `api_check.py` 17 passed; `responsive.py` reports 0 problems on the changed screens at 320, 360, 744, 932, 1366 and 1920 px; `role_pages.py --check`, permission parity, Appendix C, JS syntax and em dash checks pass |
| 22.8 | Return visitors get the new shell | DONE | `sw.js` cache version raised to `itc-shell-v6` |
| 22.9 | Rules and docs match | DONE | `ROLE_MATRIX.md` action table, rules and transition notes updated; `DECISIONS.md` D4, D14, D28 and D29 updated; this checklist records the phase |

## Phase 24. Sign-in glass (owner request)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 24.1 | The sign-in card reads as real glass over the campus photo | DONE | `.lp-card` drops the opaque fill, `.lp-hero` and `.lp-panel` use translucent gradients with `backdrop-filter` and a 1 px rim in `css/login.css`. No markup, copy, font, route or token value changed |
| 24.2 | Both themes keep the same look and the copy stays readable | DONE | the dark theme mirrors the light glass in the same sheet; 1440, 1280 and 390 px captures reviewed in light and dark |
| 24.3 | Checks | DONE | `ui_check.py` 73 pages, `validate.py` passed, `pagetest.js` 555 passed, `responsive.py --pages=login.html` 0 problems across 37 viewports |

## Known gaps

The items that remain partial or unverified are listed in
`KNOWN_LIMITATIONS.md`. The page suite, the screenshot review and the test
counts above are the results of the commands on this working tree, not
expectations.
