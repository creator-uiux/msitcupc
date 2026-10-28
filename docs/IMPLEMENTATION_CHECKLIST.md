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
| 2.14 | Demo sign-in is behind an explicit flag and off by default on a network bind | DONE | `server/app.py` demo gate, `--demo` / `--no-demo`, `ITC_DEMO_MODE`; demo usernames refused when off |
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
| 8.10 | `docs/screenshots/` evidence | DONE | 108 captures: 60 base screens at 390, 768 and 1440 in light and dark, plus 48 role captures of dashboard and ticket detail |

## Phase 9. Verification

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 9.1 | Backend suite | DONE | `python server/tests.py`: 335 passed, 0 failed |
| 9.2 | Workflow smoke | DONE | `node tools/smoke.js`: 60 passed, 0 failed |
| 9.3 | Page integration | DONE | `node tools/pagetest.js`: 361 passed, 0 failed |
| 9.4 | Role page tests | DONE | `node tools/rolepages_test.js`: 174 passed, 0 failed, including computed-display checks for the role visibility classes |
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
| 9.17 | Role visibility in the interface | DONE | `rolepages_test.js` asserts hidden-not-disabled classes per role, rail links against the permission map, requester plain language and the neutral forbidden-page panel; `docs/UI_POLISH_REPORT.md` records the matrix |

## Phase 11. One sidebar, role dashboards and pagination

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 11.1 | One navigation column instead of two competing columns | DONE | `js/ui.js` `navModel`/`renderSide`; `css/console.css` `.side-head`, `.side-user`, `.side-nav`, `.side-group`, `.side-link`, `.side-foot`; the old `.rail`/`.ctx` markup and styles are removed |
| 11.2 | Every permitted screen reachable from the sidebar, grouped and labelled | DONE | groups Workspace, Service Requests, Maintenance, Records, Administration, Reference; account links at the foot; empty groups omitted |
| 11.3 | Role-focused dashboard | DONE | four role tiles, the eight status labels plus Overdue as links into the filtered queue, four role quick actions, scoped data, paginated Needs your action list |
| 11.4 | Status links open the matching filtered queue | DONE | `?status=` and `?queue=overdue` handled in `tickets.html`; the advanced status filter no longer loses the chip |
| 11.5 | Pagination wherever a list or table can grow | DONE | `UI.paginate`/`UI.renderPagination` in dashboard queues, tickets, users, offices, settings reference data, register history/assets/maintenance/audit, reports, review, confirm, notifications |
| 11.6 | No duplicate breadcrumb | DONE | breadcrumbs render once in the top bar; the page-frame injection was removed |
| 11.7 | Frozen surfaces intact | DONE | no diff for `login.html`, `css/login.css`, `js/login.js`, `js/theme.js`, the seals, `app.css`, `green.css`, `kit.css`; only the phase label in `docs/THEME_SNAPSHOT.md` changed, no token values |
| 11.8 | Tests and role pages refreshed | DONE | role pages regenerated (49); page suite 361 passed; role page suite 174 passed; responsive 0 problems; visual gate PASS |

## Known gaps

The items that remain partial or unverified are listed in
`KNOWN_LIMITATIONS.md`. The page suite, the screenshot review and the test
counts above are the results of the commands on this working tree, not
expectations.
