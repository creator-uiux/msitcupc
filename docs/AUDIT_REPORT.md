# Completeness Audit Report

Audit date: 2026-10-29, refreshed against the current tree on 2026-10-30 (Phase 43)
Branch: `audit/completeness` at the first pass, `chore/scope-guard` for the refresh
Project: IT Service and Maintenance Management System (zero-build HTML/CSS/JS plus Python SQLite backend)
Scope: every role, every checklist item in the audit prompt, every page group, and the 102 tests in Section 17 of `docs/MASTER_PROMPT_COMPLETE.md`.
Mode: the 2026-10-29 pass was read-only, writing only this report, `tests/audit/*` and `docs/audit-screenshots/*`. The 2026-10-30 refresh re-ran those probes and changed application code where a gap was still open in code: the 44 px phone targets in `css/console.css`, positive tests in `server/tests.py`, manifest assertions in `tools/pagetest.js`, and one recreated probe script. No login file, theme token value, business workflow, status label, route, data model or security rule was changed, and no production data or production rule was touched.

## 1. Summary

| Group | Items | PASS | PARTIAL | FAIL | NOT VERIFIED |
|---|---|---|---|---|---|
| Workflow and statuses (W) | 16 | 16 | 0 | 0 | 0 |
| Preventive maintenance (M) | 11 | 11 | 0 | 0 | 0 |
| Register, audit, reports (R) | 8 | 8 | 0 | 0 | 0 |
| Security and roles (S) | 8 | 7 | 1 | 0 | 0 |
| Pages and UI (U) | 14 | 14 | 0 | 0 | 0 |
| Theme, responsive, PWA (V) | 4 | 2 | 2 | 0 | 0 |
| End-to-end scenarios | 6 | 6 | 0 | 0 | 0 |
| **Total** | **67** | **64** | **3** | **0** | **0** |

The three PARTIAL rows are S5 (the demo account list stays visible by owner decision D25), V1 (System theme paints light; the dark media query was removed in the first commit) and V4 (muted and on-brand text sit under 4.5:1 on the frozen tokens). None is a Blocker or a High, and none is fixable in code without the owner lifting a decision or the theme freeze; they are listed again in Section 9. U14 left that list on 2026-10-31: a deployed screen whose server stops answering now says so on the screen, in the style of the not-available panel, instead of leaving a quiet stale list.

Across the 102 required tests in Section 4.2 the count on this tree, measured 2026-11-01, is 94 Present and passing, 5 Missing, 2 Partial and 1 recorded deviation from the prompt (test 92, the demo list, which `AGENTS.md` requires visible). Six rows left that list since the 2026-10-30 refresh: 58, 62, 83, 95 and 97 were re-scored against the drivers and gates Phases 43 to 46 add, and 101 turned from Partial to passing when `tools/responsive.py` grew a dark pass and a real `Emulation.setPageScaleFactor` pass. Of the 8 rows that do not read Present and passing, one is the demo list the project deliberately keeps visible, four are contrast or theme readings against frozen surfaces (65, 75, 76 and 93), and three need an eye that no assertion can replace (64 and 81, a screenshot review, and 94, an image comparison of the frozen sign-in render). Each of those rows names what does prove it today, so the gap is stated rather than guessed.

Automated coverage measured on this tree on 2026-11-01: `python server/tests.py` 673 assertions, `node tools/pagetest.js` 1014, `node tools/rolepages_test.js` 507, `node tools/smoke.js` 103, `node tools/deep_audit.js` 608, `node tools/ui_audit.js` 325, `python tools/api_check.py` 17, plus the parity, Appendix C, workflow coverage, UI ownership, UI consistency, validation, print, session, time and JS syntax gates, all passing, and the three gates this refresh adds: `python tools/theme_discipline_check.py` (theme rule), `python tools/responsive_behavior.py` (126 driven checks) and `python tests/audit/theme_tokens.py` (41 tokens, 0 mismatches). There is no lint or build step in this zero-dependency architecture. Passing suites do not make the system complete on their own: the rows above are decisions and visual readings, not tests.

Honest status: the workflow, the role separation, the office and technician scoping, the audit trail, the maintenance lifecycle, the reports and the responsive shell are implemented and backed by passing suites, including the paths the 2026-10-29 pass found unguarded. What is left is not code: the demo list, the explicit-only dark theme, the frozen contrast values and one load-failure panel are owner calls, and the live deployment still needs the items in `docs/OPERATIONS.md` (an OAuth client id, a host with TLS, mail credentials and the real people and asset records).

## 2. Results

Result values are PASS (evidence given), PARTIAL (part works, gap stated), FAIL (missing or wrong), and NOT VERIFIED (not used in this report). Severity is Blocker, High, Medium, or Low.

### 2.1 Workflow and statuses

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| W1 | Exactly the eight status labels exist | `server/engine.py:98-104` defines the eight labels; `js/ui.js:21-26` renders text plus icon; repository search found no alternative status names, only copy such as "Awaiting your reply" | PASS | - | - | - |
| W2 | New tickets start Submitted through both intake paths | `_record_ticket` (`server/engine.py:411-440`) records every ticket as `submitted` and `create_ticket` (`server/engine.py:471-527`) is the only intake path; coordinator source is validated against settings; `server/tests.py:70-90`, `tools/smoke.js:72-83` | PASS | - | - | - |
| W3 | `IT-YYYY-NNNNNN`, transactional, unique under concurrency | `engine.next_id` (`server/engine.py:343`) mints the number under the state lock and the ticket id is the SQLite primary key; `POST /api/state` strips any client id before creating (`server/app.py:1062-1067`); `test_http_ticket_ids` submits twelve requests over four threads and asserts the format and uniqueness | PASS | - | - | - |
| W4 | Needs Information loop updates the same ticket | `request_info` (`server/engine.py:669-690`) returns the same ticket to Needs Information and `submit_info` (`server/engine.py:530-564`) updates that record rather than creating a new one; `server/tests.py:76`; `tools/smoke.js:83` | PASS | - | - | - |
| W5 | Assignment requires impact, urgency, priority, target date, technician, notifies | `assess` (`server/engine.py:693-720`) and `assign` (`server/engine.py:723-746`); `server/tests.py:83-84`; audit assertion at `server/tests.py:2453` `test_audit_trail` | PASS | - | - | - |
| W6 | In Progress only after the assigned technician coordinates | `coordinate` (`server/engine.py:811-831`) and `start_work` (`server/engine.py:991-1025`) require the assigned technician, a coordination note or schedule and the approval gate | PASS | - | - | - |
| W7 | On Hold requires four dependency fields; outcomes work | `place_hold` (`server/engine.py:1095-1124`) and `server/tests.py:152-173` | PASS | - | - | - |
| W8 | Approval only for gated categories | `approve` (`server/engine.py:781-808`) and the gated-category check in `start_work` (`server/engine.py:991-1025`); `server/tests.py:2674-2686` | PASS | - | - | - |
| W9 | Resolved impossible without a passed test | the resolve method gates on a passed test; `POST /api/state` refuses a new ticket in any status but Submitted (`server/app.py:1055`) and initialises `tests` server-side; `test_http_integrity` proves a forged `closed` record is refused and every merged record entered at Submitted | PASS | - | - | - |
| W10 | Resolved notifies the office and is never auto-closed | `record_test` (`server/engine.py:1127-1164`) notifies the office on the Resolved move and nothing closes the ticket automatically; `server/tests.py:103-114`, `2736-2741` | PASS | - | - | - |
| W11 | Accept records person/date and closes; reject returns to In Progress; no response stays Resolved with reminders | `office_decision` (`server/engine.py:567-635`) closes on accept and returns a rejection to In Progress; `send_reminder` (`server/engine.py:1220-1238`) and `world_tick` (`server/engine.py:1379-1491`) run the reminder loop for pending and no_response; `server/tests.py:114-116`, `2736-2741` | PASS | - | - | - |
| W12 | Authorized closure roles, reason, audit | `close` in `server/engine.py` limits the authorized path to the configured roles and demands a reason; `test_authorized_ticket_closure` closes a Resolved ticket as the coordinator, keeps the reason on the record, checks the audit line names it and the actor, and shows the office, the technician and the administrator all refused | PASS | - | - | - |
| W13 | Cancellation records reason, notifies, preserves history | `cancel` (`server/engine.py:871-898`); `server/tests.py:2467-2470` | PASS | - | - | - |
| W14 | Recurrence creates a new linked ticket only from Closed | `create_linked_ticket` (`server/engine.py:638-666`) refuses any record that is not Closed; `server/tests.py:176-188` | PASS | - | - | - |
| W15 | Every disallowed transition rejected by backend or rules, with a test | the `TRANSITIONS` table guards every method; `POST /api/state` refuses a status change (`server/app.py:1022`) and merges by id so an omitted record survives; `test_http_transition_matrix` walks all 64 from-to pairs across the four roles over HTTP and `test_http_integrity` asserts a merge never deletes | PASS | - | - | - |
| W16 | Previous service record can be linked at creation | `request.html:79-81` carries the previous-record selector, filled at `:240` and sent at `:480`; the generated coordinator and office pages carry it; detail renders the link | PASS | - | - | - |

### 2.2 Preventive maintenance

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| M1 | Schedule stores all fields; eight frequency choices | `server/db.py:236-239` seeds daily, weekly, biweekly, monthly, quarterly, semiannual, annual and custom; `engine.frequency_days` honours a custom interval and `server/tests.py` asserts both the added cadence and its day count | PASS | - | - | - |
| M2 | Not-due schedule stays active | `_run_schedule_check` (`server/engine.py:1267-1306`) updates `lastCheck` and reports the wait without generating | PASS | - | - | - |
| M3 | Due schedule reuses or creates by occurrence key | `_run_schedule_check` (`server/engine.py:1267-1306`): lookup by `scheduleId` and `occurrence`, then linked generation | PASS | - | - | - |
| M4 | Duplicate generation impossible, including concurrent runs | unique index `ux_jobs_occurrence` (`server/db.py:182`), checks run under the state lock; `test_schedule_generation` proves sequential idempotency and one job per occurrence, and `test_http_job_generation_race` runs six tickers concurrently against one due schedule | PASS | - | - | - |
| M5 | Coordinator assigns technician and coordinates the visit | `reassign_job` (`server/engine.py:1536`) is coordinator-only, refuses a closed visit, audits the move and notifies both technicians; `server/tests.py` asserts the reassignment, the owner it keeps and the technician refusal | PASS | - | - | - |
| M6 | Unavailable office reschedules and availability is re-checked on the agreed date | `reschedule_job` clears the answer to `pending`; `world_tick` re-asks the office when the agreed date arrives and only returns the visit to Assigned after a yes, once and not on every tick; `test_agreed_date_recheck` drives all of it | PASS | - | - | - |
| M7 | Each checklist item records task, result, findings, technician, date, evidence | `record_checklist_item` (`server/engine.py:1623-1648`) writes all five fields per item; `server/tests.py:296` `test_engine_maintenance` asserts each one | PASS | - | - | - |
| M8 | Additional fault creates a linked Submitted corrective ticket | `create_fault_ticket` (`server/engine.py:1651-1683`); `server/tests.py:420-435` | PASS | - | - | - |
| M9 | Maintenance confirmation and closure mirror tickets | `close_job` and `job_confirmation` (`server/engine.py:1849-1947`) mirror the ticket confirmation, including the accepted and rejected branches | PASS | - | - | - |
| M10 | Incomplete or cancelled maintenance is never Successful | `record_outcome` (`server/engine.py:1736-1807`) and `_checklist_complete` (`server/engine.py:1710-1713`); `server/tests.py:326` and `server/tests.py:395-400` | PASS | - | - | - |
| M11 | Next due date follows the configured cadence | `frequency_days` and `_advance_next_due` in `server/engine.py`; `test_schedule_generation` advances one job through a weekly, a quarterly and a 10-day custom cadence and reads the dates back (Jan 1 to Jan 8, Jan 8 to Apr 9, Apr 9 to Apr 19), so the anchor moves and does not follow today | PASS | - | - | - |

### 2.3 Register, audit, and reports

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| R1 | Every status change writes an audit event with actor, server time, previous, new, remarks | `engine._audit` and `_audit_status` write the five fields and every workflow path calls them; `POST /api/state` refuses status changes (`server/app.py:1022`) and writes one server creation event per new record (`server/app.py:1091-1096`); `test_audit_trail` and `test_http_integrity` assert both | PASS | - | - | - |
| R2 | Audit history is append-only; clients cannot update or delete it | the state merge ignores an incoming audit list (`server/app.py:1090`); `/api/import` requires a prefix-preserving superset and answers 400 otherwise; `test_http_integrity` rewrites an entry and asserts the import refuses it | PASS | - | - | - |
| R3 | Office IT Service Register links all entities and updates in the same transaction | the register is a derived view over tickets, jobs and audit in one save, so it cannot drift; `test_register_propagation` asserts closure, cancellation, the recurring pair and the job outcome all reach the register, and that propagation duplicates no record | PASS | - | - | - |
| R4 | Services without an asset can be recorded | Asset is optional in `_record_ticket` (`server/engine.py:411-440`); `test_schedule_generation` at `server/tests.py:579` records a service with no unit and asserts its generated job | PASS | - | - | - |
| R5 | All eight report types exist | `reports.html:60-107`, `410-479` | PASS | - | - | - |
| R6 | Filters: office, date, category, technician, status | `_matches` in `server/query.py` and `reports.html`; `test_query_module` filters the seed by office, status, priority, technician, category, the date window and overdue, and proves a window set in the future keeps nothing | PASS | - | - | - |
| R7 | D12 metric definitions | `server/query.py`; `server/tests.py:2534-2538`; definitions note at `reports.html:107` | PASS | - | - | - |
| R8 | CSV export exists and respects role and office scope | `reports.html:450-479`; `_api_export` (`server/app.py:1216-1243`) exports only the rows the signed-in role may see; `server/tests.py:1469` and `server/tests.py:1693` | PASS | - | - | - |

### 2.4 Security and roles

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| S1 | One permission map, parity test | `permissions.json`, `js/permissions.js`, backend; `tools/parity_check.js` output: PERMISSION PARITY PASS | PASS | - | - | - |
| S2 | Office users limited to their offices; URL or API change cannot bypass | `_scoped`, `_scoped_requester` and `_scoped_technician` (`server/app.py:279-447`) plus `_office_block` (`server/engine.py:326`); `tests/audit/results/scope_probe.json` (foreign office decision blocked); `server/tests.py:1445` and `server/tests.py:1955` | PASS | Requester can choose any active office at intake (documented decision D26) | - | - |
| S3 | Technicians only access assigned work | `_assigned_to_actor` (`server/engine.py:303-315`) guards every technician method; `server/tests.py:2635-2644`; `tests/audit/results/technician_scope_probe.json` (start work blocked after reassignment) | PASS | - | - | - |
| S4 | Internal notes and costs never reach requesters | `_scoped_requester` and `_redact_costs` (`server/app.py:331-399`) strip internal comments, diagnosis cost/labor, cost text, priority and staff fields; `server/tests.py:1434-1438` | PASS | - | - | - |
| S5 | Google restricted to `@upcebu.edu.ph`; unprovisioned sees Access not granted; demo list only with flag | `ITC_ALLOWED_DOMAINS` defaults to upcebu.edu.ph (`server/oidc.py`), an unprovisioned account answers `not_provisioned` (`server/auth.py`) and the page renders "Access not granted"; the server demo gate exists (`server/app.py`) | PARTIAL | the demo account list stays visible on every host by owner decision D25 and `AGENTS.md`, so master test 92 is a recorded deviation rather than a pass; `tools/pagetest.js` asserts the list is visible by default | Low | none; owner decision D25 stands |
| S6 | Attachments per D21 validated on the trusted layer | `server/app.py:642-814`: `ALLOWED_UPLOAD_MIMES`, `MAX_UPLOAD_BYTES` (10 MB), the ten-file cap, the content-matches-type check and record ownership in `_api_upload`; `server/tests.py:1644-1677` | PASS | - | - | - |
| S7 | No secrets; rules present and tested with the emulator | No client secrets found; there is no Firebase deployment, so no emulator applies; server-side guards are covered by the backend suite | PASS | Firebase emulator test not applicable to this architecture | - | - |
| S8 | Session idle timeout configured (default 30 minutes) | `server/auth.py:85` `SESSION_IDLE_MINUTES = 30`; `resolve()` expires an idle session and a 24-hour absolute one, and `server/tests.py` asserts both plus the once-a-minute touch window; `tools/session_check.py` shows an expired token landing on the sign-in screen | PASS | - | - | - |

### 2.5 Pages and UI

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| U1 | Login page unchanged | `sha256sum -c docs/login-baseline.sha256` verifies every entry, and `git diff b47ffd9..HEAD` shows no tracked edit to `login.html`, `css/login.css`, `js/login.js`, `js/theme.js` or the login images | PASS | - | - | - |
| U2 | Theme tokens unchanged | `tests/audit/theme_tokens.py`: 41 tokens, 0 mismatches; hard-coded colours in `css/console.css` are white/black alpha overlays plus shadow tones, permitted by AGENTS.md | PASS | - | - | - |
| U3 | App shell: rail, top bar, seal lockup, breadcrumb, search, bell, account tray, footer | `js/ui.js:1260-1371` (seal lockup, rail, app bar, breadcrumb) and `js/ui.js:1613-1644` (top bar, footer); rendered screenshots show all elements; footer year is generated | PASS | - | - | - |
| U4 | Dashboard per role with timeframe, chart and data table, statistics tabs, export, action panel | `dashboard.html:50-109`, `728-990`; role walkthrough headings | PASS | - | - | - |
| U5 | Ticket list: queues, filters, sort, pagination, chips, exports, board | `tickets.html` board and pagination; `boardMoveGuard` in `tools/pagetest.js` drags a Submitted card onto a closure column, reads the refusal naming the illegal move and checks the card snaps back; the same move is refused by the guarded method | PASS | - | - | - |
| U6 | Ticket detail: blocks, stepper, action bar, tabs, thread, composer, status selector, print view | `ticket.html:33` carries the Print ticket action wired at `:554`, the paper layout and the letterhead live in `css/console.css`, and `tools/print_check.py` verifies the printed record (2 pages) | PASS | - | - | - |
| U7 | New request form with validation, camera input, coordinator-only fields restricted | `request.html` hides the priority field and the request-source field for the office role and files an online request as "online portal"; the trusted engine starts an office intake at Medium and refuses an unknown priority; `tools/pagetest.js` asserts both lanes | PASS | - | - | - |
| U8 | Maintenance schedules, planner, form, job detail, checklist, corrective panel | `maintenance.html:37-62`, `611-740` | PASS | - | - | - |
| U9 | Office register selector, health strip, tabs | `register.html:31-100`, `443-481` | PASS | - | - | - |
| U10 | Reports: sticky filters, tiles, chart and table, definitions, CSV, print with letterhead | `reports.html` prints every filtered row rather than the page on screen (`fPrint`), the paper document carries the UP Cebu letterhead (`#rPrintDoc`), CSV export and the metric definitions are present, and `tools/pagetest.js` asserts all three | PASS | - | - | - |
| U11 | Notifications tray and page | `bellHTML` (`js/ui.js:1130-1147`); `notifications.html`; `tools/pagetest.js` asserts the tray and the page | PASS | - | - | - |
| U12 | Workflow Guide: four lanes, PDF names, current lane, Appendix C coverage | `flow.html:246-260`; `tools/appendix_c_check.py` PASS (81 nodes, 106 edges); the guide is in every lane's navigation (`js/ui.js:289` `ALL`, `js/ui.js:1113-1120`), asserted by `tools/rolepages_test.js:612-615` and `tools/pagetest.js:1119` | PASS | - | - | - |
| U13 | Administration: users, roles, offices, categories, assets, configuration, audit | `mgmt-users.html`, `mgmt-offices.html`, `mgmt-settings.html`, `mgmt-audit.html`; walkthrough navigation | PASS | - | - | - |
| U14 | Loading, empty, error and not-available states | Each of the four states is on the screen and asserted. Loading: `skeleton` (`js/ui.js:2057-2068`) renders an announced status block. Empty: a filter with no rows reveals the illustrated empty state (`tools/pagetest.js:2376` `readStates`). Not available: the neutral panel reads "This page is not available" (`js/ui.js:1803-1833`), asserted per role in `tools/rolepages_test.js:668` and `tools/pagetest.js:1356`. Outage: `renderOutageNotice` (`js/ui.js:1661-1691`, styled at `css/console.css:1141-1156`) names the silent server, says which copy the list is holding and offers a retry, and is asserted to appear on all four role lanes, to leave when the server answers and not to stack on re-render. A refused merge re-reads the stored dataset in the open (`js/api.js:170-174`), an unreachable backend answers "Backend unavailable." (`js/api.js:199`), and a dropped network falls back to `offline.html` | PASS | - | - | - |

### 2.6 Theme, responsive, and PWA

| ID | Requirement | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| V1 | Light, Dark, System work, persist, no flash | `js/theme.js:33-44` applies the choice before the first paint, keeps `color-scheme` and the `theme-color` meta in step and persists it; `js/theme.js:67-70` reports the palette actually on screen; `tools/pagetest.js:1037-1042` clicks the three choices on the sign-in screen and reads `data-theme` | PARTIAL | System is a saved choice that paints light: the `prefers-color-scheme` dark block was removed in the first commit (`css/app.css:1613-1615`), so the operating system is never followed. Light, Dark, persistence and the no-flash path all hold | Low | none in code; following the OS repaints every screen, which the frozen theme in `AGENTS.md` forbids. Lifting the freeze is the owner's call |
| V2 | Installable PWA with valid manifest, icons, shell-only SW, no protected cache | `manifest.webmanifest:10-16` lists `icons/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` and `favicon.svg`, all present on disk; `sw.js:18-60` precaches the shell only and names every `/api/` route as never cached; `offline.html` is the fallback; `tools/pagetest.js` now fetches each listed icon and asserts a 192 px, a 512 px and a maskable PNG | PASS | - | - | - |
| V3 | Phone bottom tab bar, safe areas, 44 px targets, camera | Bottom bar `js/ui.js:1692-1755`; safe-area CSS `css/app.css:497-551`; camera `capture="environment"` on the attachment inputs; the touch block `css/console.css:1115-1129` raises buttons, tabs, sidebar links, status chips, quick actions, record and file links, checklist segments and every field to 44 px; `tests/audit/contrast_touch_probe.py` now measures the phone views with touch emulation on, so `pointer:coarse` matches the way a hand-held device does: 0 controls under 44 px across the 26 phone views (29 to 74 controls measured each) | PASS | - | - | - |
| V4 | Accessibility: headings, labels, keyboard, focus, chart table, status not by colour, contrast | Semantic headings and labels present; chart has a data table (`dashboard.html:75-77`); status badges carry text and icon, not colour alone; focus rings via `:focus-visible` in `css/console.css`; contrast measured by `tests/audit/results/contrast_touch.json` | PARTIAL | Light muted text sits at 4.09 to 4.42:1 and white on the brand green at 3.38:1, under the 4.5:1 the probe demands; a breadcrumb separator reads 1.41:1, which the probe counts but WCAG treats as decorative. The values behind them are the frozen `--muted` and brand tokens | Medium | Owner decision: `AGENTS.md` freezes the theme tokens and `docs/THEME_SNAPSHOT.md`, so reaching 4.5:1 needs the freeze lifted rather than a style edit |

### 2.7 End-to-end scenarios

| ID | Scenario | Evidence | Result | Gap | Severity | Suggested fix |
|---|---|---|---|---|---|---|
| E1 | Full service lifecycle: submit, information loop, assign, diagnose, hold, follow-up, failed test, pass, resolve, reject, pass again, accept, recurrence | Composed from `server/tests.py:70-188`, `tools/smoke.js:72-190`, `tools/pagetest.js:223-510`; every step has a test and the final statuses match | PASS | Not replayed as one live UI session; steps are asserted separately | - | Add one scripted end-to-end session |
| E2 | Coordinator walk-in request then cancel with reason; Cancelled stays out of completed totals | `server/tests.py:149` and `2467-2470`; cancellation and audit assertions; `server/tests.py:2549` asserts a cancelled record never reaches a completed total | PASS | - | - | - |
| E3 | Dependency that cannot proceed leads to cancellation with reason | `server/tests.py:161` | PASS | - | - | - |
| E4 | No response stays Resolved, reminder sent, then authorized closure with reason | `server/tests.py:2736-2741` for the reminder path; `server/tests.py:191` `test_authorized_ticket_closure` for the closure: a reasonless closure and the two roles without the right are refused, the coordinator closure records the reason, the closure mode and the date, audits "Authorized closure" and notifies the office | PASS | - | - | - |
| E5 | Maintenance schedule, duplicate check, reschedule, checklist, fault, complete, confirm, next due; incomplete/cancelled never Successful | `test_schedule_generation` drives generation, idempotency, one job per occurrence and the cadence maths (weekly, quarterly from the anchor, a custom day count); `test_agreed_date_recheck` re-opens the availability question when the agreed date arrives, asks once and not on every tick, and returns the visit to Assigned only on a yes; `test_engine_maintenance` covers the checklist, the fault ticket, the outcomes and the never-Successful rule; `tools/smoke.js` mirrors it in the browser | PASS | - | - | - |
| E6 | Reports show the scenario outcomes with filters; Resolved, Closed, Cancelled separate | `test_query_module` reads a four-record scenario and asserts `completed` counts the closed pair only, `cancelled` is 1, `resolved_awaiting` is 1 and the three endings add up; the same test filters by office, status, priority, technician, category, the date window and overdue; `test_http_sla_window` reads the figures through `/api/reports`; `tools/pagetest.js` checks the tiles on the screen | PASS | - | - | - |

## 3. Role matrix

Walkthrough evidence: `docs/audit-screenshots/role-walkthrough.json`, `docs/audit-screenshots/forbidden-probe.json`, `tests/audit/results/scope_probe.json`, `tests/audit/results/technician_scope_probe.json`. Demo accounts were used with the demo gate on and a throwaway database. The four tables below were re-walked on 2026-10-30 against a clean disposable server; the 2026-10-29 capture is what the original rows described.

### 3.1 Office Requester (A. Delos Reyes, Records Office; 2 tickets in scope)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Dashboard, My Requests, New Request, Maintenance Visits, Office Register, Workflow Guide, Notifications | Dashboard, My Requests, New Request, Confirmation, Office Register, Maintenance Visits, Reports, Workflow Guide, Notifications, Profile. Confirmation and Reports are office-scoped screens, not staff routes |
| Dashboard panels | Needs your action, office counts, upcoming visits | My service dashboard, ticket activity, status breakdown, needs your action, recent updates, active queue, service breakdown |
| Ticket actions | Supply information, reply, accept or reject, request withdrawal, recurrence on Closed, availability and reschedule | In Progress: read only, "Waiting on: IT Technician". Closed: read only with "Open in Confirmation & Closure", where the office accepts, rejects, withdraws or asks for a repeat. Actions match the lane |
| Hidden expected | Internal notes, costs, assignment, priority, other offices, schedules, admin, staff filters, bulk actions | No internal notes or costs in API data; no staff navigation; office scope enforced |
| Direct URL | Forbidden page rejected | `mgmt-users.html` lands on `/or-dashboard.html`, the requester's own page, with the requester's data; bare `users.html` shows the neutral "This page is not available" panel with the content hidden by `body.access-denied` |
| Direct API | Rejected | `/api/users` 403; assign, officeDecision and diagnose answer "Blocked by role-based access (28.2)."; `POST /api/state` 403 |

### 3.2 IT Technician (J. Tan; 7 tickets in scope)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Dashboard, My Tickets, My Maintenance Jobs, Office Register, Workflow Guide, Notifications | Dashboard, My Tickets, My Maintenance Jobs, Office Register, Reports, Workflow Guide, Notifications, Profile |
| Dashboard panels | My queue, On Hold, today's visits, workload | Technician dashboard, ticket activity, status breakdown, coming up, needs your action, recent updates, active queue, costs/recurring/PM, service breakdown |
| Ticket actions | Start work, diagnose, hold, service entries, tests, resolve, checklist, fault, internal notes | Assigned: Return to work. In Progress: Place on hold for a dependency, Record the test result. On Hold: read only, "Waiting on: IT Coordinator". Resolved: read only, "Waiting on: Office Requester". Cancelled and Closed: closed for action with the history retained |
| Hidden expected | New Request, assign, priority, cancel, close, schedules edit, other technicians, org reports, admin | Navigation contains none of the forbidden destinations; no other technicians' tickets in the list |
| Direct URL | Forbidden page rejected | `ic-review.html` lands on `/itc-dashboard.html`; bare `review.html` shows the neutral panel |
| Direct API | Rejected | `/api/users` 403; officeDecision and saveSettings blocked; assign refused for a different reason ("Complete review and assessment first"), and start work on a reassigned ticket is refused ("Only the assigned technician can start this ticket") |

### 3.3 IT Coordinator (all offices; 9 tickets in scope)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Dashboard, Tickets, New Request, Maintenance, Office Register, Reports, Workflow Guide, Notifications | Dashboard, Tickets, New Request, Review and Assign, Confirmation, Maintenance, Office Register, Reports, Workflow Guide, Notifications, Profile |
| Dashboard panels | Submitted review, On Hold follow-ups, unassigned, overdue, workload, maintenance due | Coordination dashboard, ticket activity, status breakdown, technician workload, coming up, needs your action, on hold dependency, recent updates, active queue, costs/PM, service breakdown |
| Ticket actions | Review, request information, assess, assign, follow-up, cancel, authorized closure, reminders, internal notes | Submitted: Request missing details, Assign a technician, Record the cancellation reason. Needs Information: Supply the missing information, cancel. Assigned and In Progress and Resolved: cancel only. On Hold: Return to work, cancel. Cancelled and Closed: read only. No diagnose, test, accept or reject |
| Hidden expected | Diagnosis and tests, office decision, administration | No diagnose or test action appears; officeDecision API blocked |
| Direct URL | Forbidden page rejected | `mgmt-users.html` lands on `/ic-dashboard.html`; bare `settings.html` shows the neutral panel |
| Direct API | Rejected except documented reads | `/api/users` 200: the server permits a coordinator read (`server/app.py`), consistent with choosing staff; assign blocked until assessment; diagnose and officeDecision blocked |

### 3.4 System Administrator (M. Reyes; role scope 5: no operational read surface)

| Check | Expected | Actual |
|---|---|---|
| Visible navigation | Administration, audit viewer, Workflow Guide, Notifications | Users, Offices, Assets, Configuration, Audit Log, Workflow Guide, Notifications, Profile. There is no dashboard, ticket, maintenance or report route in the lane |
| Landing panels | Oversight of the directory only | Users & roles, Accounts |
| Ticket actions | None | The lane holds no ticket page, so there is nothing to act on; a direct ticket write is refused |
| Hidden expected | Ticket steps, editing audit | No transition controls exist on any page; the audit page has no edit or delete control, and `/api/import` refuses an audit rewrite |
| Direct URL | Forbidden page rejected | `or-request.html` lands on `/mgmt-users.html`; bare `request.html` shows the neutral panel |
| Direct API | Read-only over records | `/api/users` 200 (the directory is the lane's own work); assign, diagnose and officeDecision answer "Blocked by role-based access (28.2)." and the administrator cannot save settings through a ticket route |

Cross-role observations:
- Every lane now lists the Workflow Guide (`js/ui.js:1113-1120`), which is what the 2026-10-29 capture found missing; the guide offers no action, so it is safe in all four lanes.
- A prefixed address for another lane no longer lands on `404.html`. `bindUrlRole()` (`js/ui.js:420-441`) sends the visitor to their own page for that screen, or to their own landing page when the screen is outside their permission map, and the neutral panel covers the bare address. Both paths are asserted in `tools/rolepages_test.js:668` and `tools/pagetest.js:1357`.
- The server allows coordinators to read the user list. This is not treated as a failure because the assignment and maintenance forms need staff names, but it is broader than the "no administration" wording in Section 4.2.

### 3.5 Lane ownership, read out of the tree

`node tools/ui_ownership_check.js` reads the whole tree (files, the navigation
model, the phone tab bar, the home page, markup links, the controls each screen
offers, the actions the map grants, and reachability from the landing page) and
prints the two tables below. `python tools/workflow_coverage_check.py` binds the
diagram to the same map: it walks the 63 SOP steps of
`Maintenance System.pdf`, asks which lane the diagram draws each move in, and
requires the grant set of that action to be exactly those lanes. Both ran again on
2026-11-01 on this tree and both pass.

Table 1. Each lane, and whether its UI is there

| Lane | Home | Pages the map opens | Lane page files | Nav | Mobile bar | Markup links checked |
|---|---|---|---|---|---|---|
| Office Requester | dashboard.html | 13 | 12/12 | 6 | 4 | 1 |
| IT Technician | dashboard.html | 12 | 11/11 | 4 | 4 | 2 |
| IT Coordinator | dashboard.html | 14 | 13/13 | 7 | 4 | 2 |
| System Administrator | users.html | 10 | 9/9 | 5 | 4 | 0 |

| Lane | Prefix | Pages the lane may open |
|---|---|---|
| Office Requester | or- | confirm, dashboard, flow, notifications, profile, register, reports, request, roles, ticket, tickets, visits |
| IT Technician | itc- | dashboard, flow, maintenance, notifications, profile, register, reports, roles, technician, ticket, tickets |
| IT Coordinator | ic- | confirm, dashboard, flow, maintenance, notifications, profile, register, reports, request, review, roles, ticket, tickets |
| System Administrator | mgmt- | assets, audit, flow, notifications, offices, profile, roles, settings, users |

Each lane also opens `index.html`, which is the shared launcher and is counted
in the "Pages the map opens" column but has no lane file.

Table 2. UI that does not belong

| Finding | Where it would show |
|---|---|
| none | every file, nav entry, bar entry, painted link, control and granted action resolves to a lane the map grants |

The gate reports a finding in this table for a lane file that exists without the
map granting its base page, a lane copy whose base the map denies, a nav or tab
bar entry that leads outside the lane, a markup link into a page the reader
cannot open, a control whose handler does not exist, a handler no screen offers,
an action the map grants but no diagram step draws, and a screen unreachable from
the lane's own landing page.

Counts the same run reads: 69 HTML files (4 shared chrome, 20 base pages in the
map, 45 generated lane pages); the map carries 21 pages, 45 actions and 4 lanes;
23 `Actions.act` handlers are live and every one is offered by a screen; 15 role
gate classes are read out of `css/console.css` and matched to the controls they
hide; 5 painted markup links assert against the map and 3 more are anchors a
script hides or re-points by id. The link strings assembled inside page scripts
are the larger surface, and `node tools/rolepages_test.js` drives them: 507
assertions over all 45 lane pages, 663 painted links read on a signed-in lane,
each one required to lead to a page that lane may open.

That pair found two real defects on 2026-10-31, both fixed and both now asserted:

- The office register linked each maintenance visit into `maintenance.html`, the
  IT planning screen the office has no route to. The office now reads the visit
  id as text and reaches its own view through the Maintenance Visits ledger
  (`register.html:154`).
- The audit viewer turned a ticket number into a link to `ticket.html`, a page
  the administrator cannot open. The id is a link only when the reader's lane
  holds the record screen, which the map decides (`audit.html:141`).

## 4. Tests

### 4.1 Commands run and results

Environment: Python 3.14, Node.js 24, headless Chrome through the DevTools Protocol. There is no `package.json`, so npm install, lint, type check and a production build are not applicable. There is no Firebase project in this architecture, so the security-rules emulator is not applicable. No command touched production data, production rules, or secrets, and `firebase deploy` was never run.

| Command | Result |
|---|---|
| `python server/tests.py` | 673 passed, 0 failed |
| `node tools/pagetest.js` | 1014 passed, 0 failed |
| `node tools/rolepages_test.js` | 507 passed, 0 failed (45 lane pages, 663 painted links) |
| `node tools/smoke.js` | 103 passed, 0 failed |
| `node tools/deep_audit.js` | 608 checks passed, 0 issues |
| `node tools/ui_audit.js` | 325 checks passed, 0 issues, 69 pages |
| `node tools/html_check.js` | 345 assertions passed, 69 HTML files |
| `node tools/content_check.js` | 166 checks passed, 0 issues |
| `node tools/parity_check.js` | 57 passed, 0 failed, Permission parity PASS |
| `node tools/script_order_check.js` | 65 passed, 0 failed, script load order PASS |
| `python tools/api_check.py` | 17 passed, 0 failed |
| `python tools/permission_parity_check.py` | PERMISSION PARITY PASS (21 pages, 45 actions, 8 transition sources) |
| `python tools/feature_parity_check.py` | FEATURE PARITY PASS (11 flags, 66 workspace pages) |
| `python tools/appendix_c_check.py` | PASS (81 nodes, 106 edges, 80 implemented plus N75 legend artifact) |
| `python tools/workflow_coverage_check.py` | WORKFLOW COVERAGE PASS (63 SOP steps across lanes 1 to 29, 45 map actions all claimed by a step, 84 engine guard functions, lanes requester, coordinator, technician, system) |
| `node tools/ui_ownership_check.js` | UI OWNERSHIP PASS (69 html files, 21 pages, 45 actions, 4 lanes, 6 nav branches, 23 live handlers, Table 2 empty) |
| `python tools/theme_discipline_check.py` | THEME DISCIPLINE PASS (211 custom-property reads all resolve, 40 colour literals in `css/console.css` all allowed, 41 snapshot rows still declared in their sheet, 69 pages carry no own `<style>` block or inline colour, 6 sheets read) |
| `python tools/ui_check.py` | PASS, 69 pages checked |
| `python tools/validate.py` | VALIDATION PASSED |
| `python tools/js_syntax_check.py` | PASS, 27 js files, 181 inline blocks |
| `python tools/role_pages.py --check` | PASS (45 role pages, 45 unique titles) |
| `python tools/em_dash_check.py` | PASS, 0 em dashes |
| `python tools/session_check.py` | SESSION EXPIRY PASS (16 checks) |
| `python tools/print_check.py` | PRINT VIEW PASS (2 pages) |
| `node tools/time_check.js` | ASIA/MANILA DISPLAY PASS |
| `python tools/responsive.py` | 0 page/viewport checks with problems (69 pages x 37 widths = 2553 measures, light theme, run 2026-11-01) |
| `python tools/responsive.py --theme=dark` | 0 page/viewport checks with problems (the same 2553 measures on the explicit dark palette; the frozen sign-in screen's worst recorded overshoot is 428 px inside its 460 px budget) |
| `python tools/responsive.py --scale=2 --viewports=phone-390,tablet-768,landscape-1180,desktop-1440,zoom-1280` | 0 page/viewport checks with problems (345 measures at a real `Emulation.setPageScaleFactor` of 2) |
| `python tools/responsive_behavior.py` | RESPONSIVE BEHAVIOR PASS (126 checks at phone 390, tablet 768 and desktop 1440, 0 problems: the register's layout choice, search, sort, column picker and bulk dialog, a record's tabs, next-step selector and attachment viewer, the review screen the selector hands off to, the office form and the dashboard chart and tab bar are clicked and read back through `getComputedStyle`) |
| `python tests/audit/theme_tokens.py` | 41 tokens, 0 mismatches |
| `python tests/audit/contrast_touch_probe.py` | 52 views (13 primary screens x light and dark x 1440 and 390 px): 7172 text pairs checked with the lowest ratio 1.41, recorded in Section 2.6 row V4, and 666 interactive controls measured across the 26 phone views with touch emulation on, none under 44 px |
| `python tests/audit/role_walkthrough.py` | Four-role walkthrough JSON and screenshots, re-captured 2026-10-30 |
| `python tests/audit/scope_probe.py` | Run on 2026-11-01 against a freshly reset disposable demo server (`--base http://127.0.0.1:8911`, `--reset --demo --no-worker`): the office sees 2 of 9 tickets and one office name, its foreign-office write answers "Blocked by office-based access (28.2)", `/api/users` answers 403, and the technician's snapshot holds 7 tickets, none assigned to another name |
| `python tests/audit/technician_scope_probe.py` | Same fresh server: the coordinator's reassign succeeds, the technician's `startWork` on the ticket that is no longer theirs answers "Only the assigned technician can start this ticket.", and the technician's list after the move carries the other 6 records and not that one |
| `python tests/audit/state_merge_probe.py` | Same fresh server: both 2026-10-29 integrity defects refused over HTTP (the bad-priority create answers HTTP 400 and adds no row, the client-side delete answers `ok: false` with the 9 seeded ids intact) |

### 4.2 The 102 required tests

Status values: Present and passing (asserts the core behavior; the suite passes), Partial (touches part of the claim), Missing (no automated assertion found). "Audit probe only" means this audit measured it but the project has no test.

The table was written on 2026-10-29. On 2026-10-30 the rows whose gap had since been closed were re-scored against the current tree and their evidence now names the test that proves it. On 2026-11-01 every row that did not read Present and passing was re-read against this working tree and the suites behind it were run again, and the rows whose evidence a suite now carries were turned to Present and passing; the rows left Partial or Missing say what no assertion on this tree measures today, and each names what does prove part of it.

| # | Required test | Status | Evidence |
|---|---|---|---|
| 1 | Unique ticket number | Present and passing | `tools/smoke.js:72` |
| 2 | Coordinator enters on behalf | Present and passing | `server/tests.py:2114` `test_intake_priority` |
| 3 | Both paths create valid records | Present and passing | `server/tests.py:2083` and `2114` `test_intake_priority` |
| 4 | New request starts Submitted | Present and passing | `tools/smoke.js:75` |
| 5 | Incomplete becomes Needs Information | Present and passing | `server/tests.py:70` |
| 6 | Supplying details updates same ticket | Present and passing | `server/tests.py:76` |
| 7 | No duplicate in the information loop | Present and passing | `tools/smoke.js:83` |
| 8 | Prioritize and assign | Present and passing | `server/tests.py:83` |
| 9 | Assignment sets Assigned and records event | Present and passing | `server/tests.py:84` and the audit entry at `server/tests.py:2453` |
| 10 | New ticket linked to previous record | Present and passing | `server/tests.py:2149` stores a `previousRecord` chosen at intake, refuses an unknown number and refuses a link into another office; `server/tests.py:181` `test_engine_recurrence` and `tools/pagetest.js:478` assert the recurrence pair carries `linkedTo` and marks the old record recurring |
| 11 | Diagnosis and findings | Present and passing | `tools/pagetest.js:510` |
| 12 | On Hold requires four fields | Present and passing | `server/tests.py:236` `test_office_confirmation_guards` refuses a hold that omits the next action and re-reads the ticket to prove it is still In Progress; `server/tests.py:242` refuses the same hold from the coordinator; the complete hold then lands on On Hold |
| 13 | Pending dependency stays On Hold | Present and passing | `server/tests.py:247` reads the status back after the accepted hold, and `server/tests.py:250` reads it back again after `resolveDependency` returns the ticket to In Progress |
| 14 | Resolved dependency returns to In Progress | Present and passing | `server/tests.py:152` |
| 15 | Cannot proceed leads to cancellation | Present and passing | `server/tests.py:171-173` |
| 16 | Approval only when required | Present and passing | `server/tests.py:2674-2686` `test_role_scope_and_policy` |
| 17 | Failed test stays In Progress | Present and passing | `tools/smoke.js:141` |
| 18 | Passed test allows Resolved; Resolved impossible without a pass | Present and passing | `server/tests.py:103`; the API path is closed too: a crafted Resolved or Closed record is refused on `POST /api/state` (`server/tests.py:849` `test_http_integrity`, and `tests/audit/results/state_merge_probe.json` answers HTTP 400 and creates nothing) |
| 19 | Office notified when confirmation required | Present and passing | `server/tests.py:257` `test_office_confirmation_guards`: the moment the test passes, a requester-scoped notification naming that ticket asks the office to confirm the result |
| 20 | Accept records person and date | Present and passing | `server/tests.py:116` |
| 21 | Accept transitions to Closed | Present and passing | `server/tests.py:118` asserts the one-step close |
| 22 | Reject records feedback, returns to In Progress | Present and passing | `server/tests.py:265` `test_office_confirmation_guards`: a rejection without feedback is refused, the accepted rejection moves the ticket back to In Progress, keeps `confirmation.feedback` on the record, audits the office words and sends the technician back to diagnosis |
| 23 | No response stays Resolved | Present and passing | `server/tests.py:2738` `test_reassign_and_no_response` |
| 24 | Reminders never close | Present and passing | `server/tests.py:2740` asserts the reminder is recorded and the status stays Resolved |
| 25 | Cancellation records reason, preserves history | Present and passing | `server/tests.py:2467-2470` `test_audit_trail` |
| 26 | Closed and Cancelled update the register | Present and passing | `server/tests.py:1277` `test_register_propagation`: closure writes `status`, `closure`, `closedAt`, the confirming person and date plus the audit feed entry; cancellation writes `status` and `cancelReason` with the `cancel` audit entry and the requester notice; recurrence pairs the new ticket to the old through `linkedTo` and `recurring` |
| 27 | Recurrence only from Closed | Present and passing | `server/tests.py:283` `test_office_confirmation_guards`: `createLinkedTicket` is refused while the record is In Progress with a message naming Closed, and is accepted only after the rework and the office acceptance close it |
| 28 | Authorized closure role, reason, audit | Present and passing | `server/tests.py:191` `test_authorized_ticket_closure`: a reasonless closure is refused, requester and management are refused, the coordinator closure records `closure`, reason and `closedAt`, writes the "Authorized closure" audit entry and notifies the office |
| 29 | Schedule records all fields | Present and passing | `tools/smoke.js:192` |
| 30 | Not-due schedule stays active | Present and passing | `server/tests.py:564` `test_schedule_generation`: the not-due schedule answers the check with a `wait` event, generates no job for itself and keeps `active` set with `lastCheck` written |
| 31 | Due schedule checks occurrence | Present and passing | `tools/pagetest.js:580` |
| 32 | Existing job reused | Present and passing | `tools/smoke.js:203` |
| 33 | Missing job generated and linked | Present and passing | `tools/pagetest.js:583` |
| 34 | Concurrent duplicate prevention | Present and passing | `server/tests.py:1045` `test_http_job_generation_race`: four ticks run side by side, one job is generated for the occurrence and the database agrees with memory |
| 35 | Unavailable office rescheduled, check repeats | Present and passing | `server/tests.py:475` `test_agreed_date_recheck`: the re-ask is audited, the office is asked once and not on every tick, and an "unavailable" answer demands a new reschedule |
| 36 | Checklist item records all five fields | Present and passing | `server/tests.py:314` `test_engine_maintenance`: an item with no result is refused, and the accepted item re-reads with `result`, `finding`, `tech` (the assigned technician), `date` and its `evidence` list |
| 37 | Additional fault linked ticket | Present and passing | `server/tests.py:420` `test_engine_maintenance` |
| 38 | Job independently documented | Present and passing | `server/tests.py:422` `test_engine_maintenance`: after the corrective ticket is raised, the job record re-reads with its items, assets, status and fault flag unchanged and only `linkedTicketId` added, so the visit and the ticket are two documents that reference each other |
| 39 | Incomplete or cancelled never Successful | Present and passing | `server/tests.py:326` and `395-400` `test_engine_maintenance` |
| 40 | Next due follows schedule | Present and passing | `server/tests.py:545-560` `test_schedule_generation` now asserts the arithmetic: monthly plus 31 days, weekly plus seven days, quarterly to the same day three months later, custom plus the interval, and the schedule moving to the new due date |
| 41 | Service records linked to offices | Present and passing | `server/tests.py:1772` `test_seed_shape` |
| 42 | Services without assets | Present and passing | `server/tests.py:579` `test_schedule_generation`: a schedule with no assets is accepted and keeps `assets: []`, the job it generates carries no unit and one checklist item, and an intake filed without a unit number records with `asset` empty rather than a placeholder |
| 43 | Every status change audited with all fields | Present and passing | `server/tests.py:889-890` asserts actor, role, server timestamp and status on the creation event; `test_audit_trail` (`server/tests.py:2434`) asserts the `Previous -> New` text, the new status label, the actor and the ticket subject on every lifecycle entry |
| 44 | Report filters all five | Present and passing | `server/tests.py:2474` `test_query_module` filters by office, status, technician, category and date window, plus the empty future window |
| 45 | Cancelled excluded from completed | Present and passing | `server/tests.py:2549` asserts a cancelled record never reaches a completed total |
| 46 | Resolved not counted as Closed | Present and passing | `server/tests.py:2551` `test_query_module`: "completed counts closed records only", with the Resolved ticket held out of the total |
| 47 | Reports and exports respect office scope | Present and passing | `server/tests.py:1693-1701` `test_http_records` |
| 48 | Exhaustive disallowed transition test | Present and passing | `server/tests.py:1145` `test_http_transition_matrix` exercises all 256 from-to-role combinations over the HTTP API for the four roles: no off-whitelist move changes a ticket and every whitelisted move succeeds. `tools/permission_parity_check.py:130` still compares the shipped map to the engine statically |
| 49 | Each role only its transitions | Present and passing | `server/tests.py:1145` `test_http_transition_matrix` drives all 256 from-to-role moves through the HTTP API and fails if any off-whitelist move is accepted or any whitelisted move is refused; `tools/permission_parity_check.py` proves the map and the backend agree on all 8 transition sources and every target role list, and `tools/parity_check.js` keeps the eight labels in the client map |
| 50 | Unauthorized reads blocked | Present and passing | `server/tests.py:757` and `1447` |
| 51 | URL or ID cannot bypass office scope | Present and passing | `server/tests.py:1520` and `2160` |
| 52 | Office users cannot read internal notes | Present and passing | `tools/pagetest.js:1307` |
| 53 | Audit cannot be updated or deleted | Present and passing | `server/app.py:1086-1092`: the client audit list on `POST /api/state` is ignored and the server appends only its own events; `server/app.py:1184-1191`: an import whose audit prefix differs from the live trail, shorter or rewritten, answers HTTP 400 "The audit log is append-only". `server/tests.py:947` asserts the refusal |
| 54 | Asia/Manila display | Present and passing | `tools/time_check.js:38` |
| 55 | Availability answer; unavailable requires a date | Present and passing | `server/tests.py:440`: the office answer releases the visit, an unavailable office is refused as an availability record and sent to the reschedule, and a reschedule with no agreed date is refused with a message naming the date (`server/engine.py:1514`) |
| 56 | Fault ticket system-created, linked, Submitted | Present and passing | `server/tests.py:427` `test_engine_maintenance`: the corrective ticket opens as Submitted, is requested by "Maintenance visit MNT-2026-0059", carries `linkedTo` and `previousRecord` to the job, keeps the job office, records the technician as the history author, and a second one for the same visit is refused |
| 57 | Requester recurrence only from Closed | Present and passing | `server/tests.py:291` and `:293` `test_office_confirmation_guards`: the technician is refused, the requester is refused while the record is In Progress (`:283`) and succeeds once it is Closed |
| 58 | Primary pages work on mobile, tablet, desktop | Present and passing | The claim is driven, not measured. `tools/responsive_behavior.py` opens the screens a person works on in headless Chrome at phone 390, tablet 768 and desktop 1440 with a signed-in session (no demo flag, so the storage write and the cascade are the real ones) and reads the layout back through `getComputedStyle`. The register takes the layout its width asks for (the cards container at 390, the laid-out table at 768 and 1440), states the whole register it holds ("9 of 9" on the first width), leaves 1 record at every width on a search of "printer" (from 9, 10 and 11: the widths share one browser session, and this driver's own office submission is in the register by the second width), and on the widths that lay the table out sorts descending then ascending on a header click with the ids returned in the order the header states, opens its column picker inside the viewport (196x208 at x=1105 on a desktop) and takes Target out of the laid-out table with `display:none` and back to `table-cell`, reveals the bulk toolbar on a selection and opens an assign dialog that fits and closes (540x317 at x=450 on a desktop, one 42 px control to tap), offers a record link that stays in the lane (`ic-ticket.html?id=IT-2026-000143`), switches a tab to `aria-selected=true` with its panel displayed, sends the coordinator through a 3-move selector to `ic-review.html?id=IT-2026-000143` where the panel heading carries that same id and the first panel control opens the dialog that records the step (350x322 inside 390 px, one 94 px textarea) and Cancel leaves nothing behind, opens an attachment in place (`.viewer-card` 390x844) and closes it, keeps what the office types and reaches its success panel, draws 13 activity bars, and on a phone paints four 60 px tab destinations whose tap moves the reader inside the lane. Measured: 126 checks, 0 problems, RESPONSIVE BEHAVIOR PASS. The floors applied here are the documented fine-pointer ones (36 px at or below 480 px, WCAG 2.5.8's 24 px above it, `css/app.css:1927-1947`); the 44 px finger minimum is measured under real touch emulation by `tests/audit/contrast_touch_probe.py`, and `tools/responsive.py` still carries the 37-width layout sweep of row 101 |
| 59 | No horizontal overflow at 320 px | Present and passing | `tools/responsive.py:304`; no failure at 320 |
| 60 | Forms, dialogs, tables, menus, charts usable on small screens | Present and passing | `tools/responsive.py` measures every page at 37 widths and reports no overflow, no clipped text and no tap target under its 36 px floor; `tests/audit/contrast_touch_probe.py` re-measures 672 controls on 26 phone views with touch emulation and finds none under 44 px |
| 61 | Loading, empty, error states | Present and passing | `tools/pagetest.js:2376` `readStates` asserts the announced loading skeleton, the empty state on a filter that matches nothing, the not-available panel per role, and the outage panel that appears when a deployed page's server stops answering, leaves when it answers and does not stack on re-render |
| 62 | Shared design tokens only | Present and passing | `tools/ui_check.py:150` blocks inline styles on all 69 pages, and `python tools/theme_discipline_check.py` reads the rest of the rule off the shipped surface instead of trusting a review: all 211 custom-property reads in the stylesheets resolve to a property some sheet declares, so no rule quietly resolves to nothing; all 40 colour literals in `css/console.css` are in the allowed set (white and black alpha overlays plus the shadow ink the frozen green palette already uses at `css/green.css:49-51`), and the only other inks it accepts are the paper values inside the print block; the 41 rows `docs/THEME_SNAPSHOT.md` names are each found declared in the sheet the snapshot records them in; and all 69 pages were scanned for a `<style>` block or a colour literal in an inline style attribute and carry neither, so every screen is styled by the tokens or not at all. Measured: THEME DISCIPLINE PASS (211 reads, 40 literals, 41 snapshot rows, 69 pages, 6 sheets) |
| 63 | Status and priority badges show text and icon; Resolved and Closed distinct | Present and passing | `tools/pagetest.js:2437` `badgeIdentity` renders all eight badges and refuses one without its glyph or its word, proves no two statuses share a label and that Resolved and Closed use different chip classes, and reads each status colour pair out of the three shipped palettes (light `css/app.css`, dark `html[data-theme="dark"]`, `css/green.css`) so Resolved is told from Closed there too. `tools/pagetest.js:1611` still asserts the work card carries the chip and the priority edge |
| 64 | Screenshots at 390, 768, 1440 reviewed | Missing | `tools/shots.py` captures; no review assertion |
| 65 | Contrast 4.5:1 | Missing, measured FAIL | `tests/audit/contrast_touch_probe.py`; examples in V4 |
| 66 | Role navigation only | Present and passing | `tools/rolepages_test.js:610` |
| 67 | Actions per status; waiting owner | Present and passing | `tools/pagetest.js:338` |
| 68 | Direct URL or API outside role rejected | Present and passing | `server/tests.py:2635-2644` `test_role_scope_and_policy` |
| 69 | Technician cannot read or change others' work | Present and passing | `server/tests.py:2635-2644` and `tests/audit/technician_scope_probe.json` |
| 70 | Coordinator cannot diagnose, test or decide | Present and passing | `server/tests.py:138` `test_engine_guards`: the coordinator is refused `diagnose`, `recordTest` and `officeDecision`, matching `server/engine.py:1030`, `:1129` and `:576`; the whitelisted alternative for a coordinator holding a Resolved ticket is the audited authorized closure with a reason (`server/tests.py:191`) |
| 71 | Requester limited actions and data | Present and passing | `tools/pagetest.js:461` |
| 72 | Permission map parity test | Present and passing | `tools/permission_parity_check.py:111` |
| 73 | Workflow Guide lanes and current lane | Present and passing | `tools/appendix_c_check.py:40`; `flow.html:246-260` |
| 74 | Waiting-on labels match 4A.3 | Present and passing | `tools/pagetest.js:1339-1341` |
| 75 | Light, Dark, System, persist, no flash | Partial, measured FAIL for System | `tools/pagetest.js:1057`; `js/theme.js:42-48`; no dark media query (`css/app.css:1614`) |
| 76 | Both themes 4.5:1; no hard-coded colours | Missing, measured FAIL | Contrast probe; see V1 and V4 |
| 77 | Resolved and Closed distinct in both themes | Present and passing | `tools/pagetest.js:2437` `badgeIdentity` reads the declared colour pair of every status in the light rules (`css/app.css:246-253`), in the explicit dark rules (`css/app.css:1619-1632`) and in the green palette (`css/green.css:219-226`), and fails if Resolved and Closed match in any of them. The dark sheet reuses one navy chip for Submitted and In Progress (`css/app.css:1619` and `:1625`); that overlap is asserted as the only one, and those two statuses stay apart in their words and glyphs, which the same test proves. `tests/audit/theme_tokens.py` still diffs the 41 token values against the frozen snapshot |
| 78 | PWA installable; no protected cache | Present and passing | `tools/pagetest.js:2596` `pwaCachePolicy` reads the worker never-cache list (`sw.js`), proves it starts at the API root, that all 9 `/api/...` routes the client calls are covered by it, that the precached shell holds no API route, and that a sign-out posts `ITC_CLEAR_PRIVATE_DATA` from both call sites in `js/api.js`. `tools/pagetest.js:835` `pwaShell` proves the install path: the manifest is valid JSON, names the app, opens at the sign-in page, lists its icons and maskable PNG, and every icon it lists is served |
| 79 | Phone tab bar, safe areas, 44 px | Present and passing | `tools/pagetest.js:1509` asserts the phone tab bar carries four destinations and the More sheet the rest; `css/console.css:1115-1129` sets a 44 px minimum for buttons, tabs, segmented controls, sidebar links, checklist controls, status chips, ticket links and every field under `@media (pointer:coarse)`; `tests/audit/results/contrast_touch.json` measures 672 controls at 390 px with touch emulation and finds none under 44 px |
| 80 | Camera capture on phone inputs | Present and passing | `tools/pagetest.js:2528` `captureAndRecordControls` scans the 69 pages in the tree for `<input type="file">` and fails if any of the 9 lacks `capture="environment"`, then checks the rendered technician lane, where all 8 evidence controls on an open checklist item carry it |
| 81 | Light and dark screenshots at three widths reviewed | Missing | `tools/shots.py` captures only |
| 82 | Appendix C coverage | Present and passing | `tools/appendix_c_check.py:45` |
| 83 | Ticket list per Appendix E.1 | Present and passing | `tools/pagetest.js:2645` `ticketListContract()` drives `or-`, `itc-` and `ic-tickets.html` and reads the register off the shipped headers: eight columns with the selection box first, the lane's own subset in the documented order, no cost column and no delete control, five sortable headers each carrying `aria-sort` and a direction mark that agrees with the advanced-filter selects, the default order proven as last update descending. It then asserts the row itself: the ticket number is a link into that lane's record file, the attachment, message and unread marks appear only with the counts that make them read without colour, a bold subject only while the lane has unread news, and the CSV export starts from `exportHead(role)`, so the office export never carries priority, technician or cost. The column picker is offered exactly the columns the lane may see and turning one off takes it out of the table and is remembered per lane; the printed copy carries the letterhead, the queue, the order and the count while the picker, buttons and chips leave the paper. The overdue queue is asserted to tint every row from a theme token and still say the word Overdue, bulk assign is offered to the coordinator and absent from the office lane, and the pager is driven on the seeded register (`PER_PAGE` lowered to 3) for range, total, page change and the short last page. `server/tests.py:1479` `test_http_records` still proves the same envelope comes back from the API |
| 84 | Ticket detail per Appendix E.2 | Present and passing | `tools/pagetest.js:330`, `338` |
| 85 | Dashboard per Appendix E.3 | Present and passing | `tools/pagetest.js:231-237` `dashboard()` and `:1220-1255` `dashboardActivity()` |
| 86 | Ticket numbers unique under concurrency | Present and passing | `server/tests.py:1206` `test_http_ticket_ids`: four threads submit three tickets each over real HTTP against the running server; all twelve are recorded, `server/tests.py:1270` asserts the minted ids are unique and the stored row count equals the live count |
| 87 | Every operation guards role, office, status and writes audit/register in one transaction | Present and passing | `server/tests.py:1203` `test_http_transition_matrix`: all 256 from-to-role moves run over HTTP, every off-whitelist move is refused with the status unchanged, and every whitelisted move both lands and appends its audit entry; office scoping is exercised by `test_http_tenancy` (`server/tests.py:1424`) and `tools/permission_parity_check.py` proves the same 45 actions in all three maps |
| 88 | Attachments per D21 | Present and passing | `server/tests.py:1668-1677` `test_http_records` |
| 89 | Login matches 14.15 at desktop | Present and passing | `tools/pagetest.js:753`; `docs/screenshots/login-1440-*.png` |
| 90 | Login at 390x844 stacks and shows the button; no 320 overflow | Present and passing | `docs/screenshots/login-390-light.png` shows the button at about 549 px; responsive run has no 320 overflow |
| 91 | Non-institutional rejected; unprovisioned Access not granted | Present and passing | `server/tests.py:1387` `test_google_login_gates`: an in-domain address with no profile is refused with `code: not_provisioned`, the message that names the IT Office, the same claims sign in once provisioned, the token resolves to that role and office, and a deactivated account is refused again with its token dead. `server/tests.py:738` proves the domain allow-list is on by default and `js/login.js:261` is the client that reads `not_provisioned` into the "Access not granted" panel |
| 92 | Demo list only with flag | Not met by design | `tools/pagetest.js:1051` asserts the list is always visible, per `AGENTS.md` and D25; conflicts with the master prompt |
| 93 | Login readable in both themes, 4.5:1 over photo | Missing | Contrast probe skips photo backgrounds |
| 94 | Login files unchanged and render identical | Partial | `docs/login-baseline.sha256` verifies all nine frozen entries and `git diff b47ffd9..HEAD` for those paths is empty, so "unchanged" holds; "render identical" has no automated image comparison, only the screenshots in `docs/screenshots/` |
| 95 | Theme tokens identical; no new hard-coded colours | Present and passing | Three readings, all run on this tree. `python tests/audit/theme_tokens.py` compares the 41 tokens `docs/THEME_SNAPSHOT.md` records against the frozen sheets: 41 tokens, 0 mismatches. The freeze is proved by git as well: `git diff b47ffd9..HEAD -- css/app.css css/green.css css/kit.css css/login.css js/login.js login.html docs/THEME_SNAPSHOT.md` is empty and the working tree reports no change to those paths, so the palette a person sees is the one that shipped. `python tools/theme_discipline_check.py` is the standing gate for the other half of the rule: a colour literal in `css/console.css` that is not a white or black overlay or the green palette's own shadow ink fails, and a paper ink outside the print block fails, so no new brand colour can arrive quietly. Measured: 41 tokens with 0 mismatches, THEME DISCIPLINE PASS |
| 96 | Role-only navigation, panels, actions, columns, report types; forbidden URL panel | Present and passing | `tools/rolepages_test.js:454` `roleVisibility()` holds the column, filter, panel and tab table per lane and compares each one's computed `display` with the map at `:503`; `:510` `managementLaneIsAdministrationOnly()` proves the administrator holds no operational page in the map and that no `mgmt-` dashboard, ticket, register, report or maintenance file is generated; `:546` `capabilityRowsFollowTheMap()` re-reads the capability reference against `permissions.json` so no row claims a page or an action its lane is not granted; `:647` `forbiddenUrlShowsNeutralPanel()` opens a page the URL pins to another role and requires the neutral `.access-panel` instead of the screen; `:676` `paintedLinksBelongToTheLane()` walks every painted link on all 45 lane pages. The navigation branches, the tab bar, the landing page and the per-lane file set are proved again by `node tools/ui_ownership_check.js`, and what a lane is offered inside a screen by `tools/pagetest.js` (the scoped command palette, `paletteLane` for the lane a palette hit opens, and `ticketRoleLinks` for the record's own links and next-step selector). Measured with this phase's run: ROLE PAGE TESTS 507 passed, 0 failed and UI OWNERSHIP PASS |
| 97 | Unavailable actions hidden, not disabled; waiting text | Present and passing | The hidden-versus-greyed distinction is now asserted, not assumed. `tools/rolepages_test.js:454` `roleVisibility()` holds a table of controls per lane page (the office's Office and Priority filters and its scoped picker, the technician's selection column and technician filter, the coordinator's bulk and schedule controls, the dependency tab on a record) and at `:503` compares each control's computed `display` with what the permission map says that role may see, so "hidden" has to mean taken out of the layout, not dimmed. `tools/rolepages_test.js:676` `paintedLinksBelongToTheLane()` then walks the painted workflow controls on a signed-in lane (95 controls read across requester, technician, coordinator and management, ancestors climbed so a control inside a hidden card is not counted as an open door, `:708`): `:844` fails if any painted control is `disabled`, carries `aria-disabled="true"` or a disabled class, and `:846` fails if any painted control offers a move the lane is not granted. The waiting text is proved in the same sweep at `:829`, where each of 14 record pages opened on a signed-in lane must either offer a way to act or state where the record stands. Measured with this phase's run: ROLE PAGE TESTS 507 passed, 0 failed |
| 98 | Every authenticated page uses the shell and works at three widths in both themes | Present and passing | `tools/ui_audit.js:43` walks the 65 shell pages (every page in the tree except `login.html`, `404.html`, `offline.html` and `index.html`) and requires each to carry the sidebar, appbar, topbar and bottom nav containers plus its `UI.mountChrome()` call, with `tools/script_order_check.js` holding the load order; `tools/responsive.py` then measures all 69 pages at 37 widths from 320 px to 7680 px in the light theme and `tools/responsive.py --theme=dark` measures the same sweep on the explicit dark palette, both with 0 problems (Section 4.1) |
| 99 | Board view valid moves, snap back, backend rejects | Present and passing | `tools/pagetest.js:1684` `boardMoveGuard()`: no card offers a move outside the whitelist and none hides an allowed one, a crafted closure button on a Submitted card is refused with a toast naming the illegal change, the ticket status is re-read as Submitted, the card stays in the Submitted column and the form closes itself; the same illegal move is refused by the backend for all 256 combinations (`server/tests.py:1145`) |
| 100 | Technician mobile: Today, queue, 44 px checklist, progress, evidence, sticky bar | Present and passing | The claim is now driven, not read: `tools/pagetest.js:2528` `captureAndRecordControls` opens `itc-technician.html` as the technician and asserts the workbench holds both the today block and the full queue with Today before the queue in document order, that the checklist progress bar is a share of the whole (60% on the seeded visit), that the read-out counts the items ("2 of 5 still to record."), that the sticky footer states how much of the visit is saved, and that the 8 evidence controls ask the phone camera. `tests/audit/contrast_touch_probe.py` measures 148 controls on that page at 390 px with touch emulation and finds none under 44 px; `tools/pagetest.js:615` and `:617` keep the queue and the recorded result and finding asserted |
| 101 | Responsive matrix at all widths, both themes, 200 percent zoom | Present and passing | `tools/responsive.py` sweeps 69 pages over 37 widths from 320 px to 7680 px and, on this tree on 2026-11-01, reports 0 of 2553 page/viewport checks with problems in the light theme and 0 of the same 2553 measures with `--theme=dark` on the explicit dark palette, so both the 2026-10-29 note about 15 dashboard clip failures and the older "the sweep measures the light theme only" residual are retired. Zoom is no longer width alone either: `--scale=2 --viewports=phone-390,tablet-768,landscape-1180,desktop-1440,zoom-1280` drives a real `Emulation.setPageScaleFactor` of 2 and reports 0 problems over its 345 checks. The three `zoom-*` entries in the standard sweep stay a halved CSS viewport, which is not the same reading, and that is what the scale pass adds. The one accepted overshoot is the frozen sign-in screen: every `login.html` width in both passes is inside the 460 px `FROZEN_SCREEN_SCROLL` budget (`tools/responsive.py:90`, worst measured 428 px in dark), which is decision D23's, not a new failure. What the behavior half of the claim needs is row 58's driver, which clicks the same screens rather than measuring them |
| 102 | Role-purposeful dashboard tiles; scoped command palette | Present and passing | `tools/pagetest.js:2581` `coordinatorComingUp` opens the coordinator dashboard and asserts the "Coming up" card is there, that it carries the scheduled visits (`#maintDue` is not empty) and that it links to `maintenance.html`. `tools/pagetest.js:1240` asserts the four role-focused tiles and `:1326-1337` the Needs-my-action queue; `tools/rolepages_test.js` keeps the command palette scoped per role |

## 5. Appendix C coverage

`python tools/appendix_c_check.py` reports:

- Nodes: 81 expected, 81 found, 80 implemented in the process data, with N75 as the legend artifact excluded by the prompt.
- Edges: 106 implemented.
- Lanes: Office Requester or Office Representative, IT Coordinator, IT Technician, System, in that order.
- Result: APPENDIX C COVERAGE PASS.

The Workflow Guide page renders these lanes and dims the lanes other than the signed-in role, and the guide is now reachable from every lane: `js/ui.js:289` lists it in the `ALL` group, so all four role sidebars carry the destination, which `tools/rolepages_test.js:612-616` and `tools/pagetest.js:1131-1137` assert.

## 6. Frozen items

### 6.1 Login page

Re-checked 2026-10-30 against the current tree.

- `git status --porcelain` lists no tracked login file as modified; only untracked screenshots and audit artifacts sit outside the freeze.
- `sha256sum -c docs/login-baseline.sha256` answers OK for all nine entries: `login.html`, `css/login.css`, `js/login.js`, `js/theme.js`, `img/UPLoginUI.PNG`, `img/login-bg.jpg`, `img/login-bg2.png`, `img/up-seal.png`, `img/upc-seal.png`. The baseline file records the approved state of the frozen surface, which is the demo-account block and the glass treatment, so the freeze is proved against the approved build rather than against the first commit.
- `git diff --stat b47ffd9..HEAD -- login.html css/login.css js/login.js js/theme.js img/` is empty: nothing touched the frozen surface in Phase 39 to 43.
- `python tools/feature_parity_check.py` keeps `login.html` in its FROZEN set and reports FEATURE PARITY PASS, and `python tools/ui_check.py` checks that the sign-in page still loads `app.css`, `green.css`, `kit.css` and `login.css` and no `console.css`.
- A pixel render comparison is still not automated, so master test 94 stays Partial. The evidence for the freeze is the hash baseline plus the empty diff, not a rendered comparison.

### 6.2 Colour theme

- `tests/audit/theme_tokens.py` compares 41 tokens with `docs/THEME_SNAPSHOT.md`: 0 mismatches.
- No new brand colours were added. `css/console.css` uses the existing tokens plus white and black (solid and alpha overlays), which `AGENTS.md` permits. Its only literals outside that set are the print sheet inside `@media print` (`css/console.css:1198-1206`: a `#014421` rule, `#333` text and `#b8b8b8` borders on paper, where the screen tokens do not apply). None of them reaches a screen colour, and `tests/audit/theme_tokens.py` answers 0 mismatches against the snapshot.
- The login page loads `app.css`, `green.css`, `kit.css` and `login.css` and does not load `console.css`, as required.

## 7. Screenshots and limitations

Audit screenshots in `docs/audit-screenshots/`:

| File | Content |
|---|---|
| `requester-landing-1440.png`, `requester-landing-390.png`, `requester-ticket-1440.png` | Requester role, captured 2026-10-30 |
| `technician-landing-1440.png`, `technician-landing-390.png`, `technician-ticket-1440.png` | Technician role, captured 2026-10-30 |
| `coordinator-landing-1440.png`, `coordinator-landing-390.png`, `coordinator-ticket-1440.png` | Coordinator role, captured 2026-10-30 |
| `management-landing-1440.png`, `management-landing-390.png` | Management role: the users directory, captured 2026-10-30. The lane has no dashboard and no ticket screen (role scope 5), so it has no ticket capture |
| `role-walkthrough.json` | Navigation, landing headings, action card per status, forbidden URL and API probes, written 2026-10-30 by `tests/audit/role_walkthrough.py` |
| `forbidden-probe.json` | Redirects and the neutral panel per role, written 2026-10-30 |

The `requester-dashboard-*.png`, `technician-dashboard-*.png`, `coordinator-dashboard-*.png` and `management-dashboard-*.png` files, and `management-ticket-1440.png`, are dated 2026-10-29. The current walkthrough script writes the `-landing-` and `-ticket-` captures, so those older images still show the pre-scope-5 administrator lane, which had a dashboard and a ticket screen. They are kept for the record and are not cited as current evidence.

The repository already contains 124 light and dark screenshots at 390, 768 and 1440 px in `docs/screenshots/` for every major page, captured on 2026-10-29 before this audit. Two were reviewed for this report (requester dashboard and login at 390). The rest were not re-reviewed image by image, which is why tests 64 and 81 stay marked Missing: the captures exist, the review is a human step with no automated assertion.

Limitations:

1. The in-app browser tool reported `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`, so all runtime checks used a headless Chrome session over the DevTools Protocol. There was no other browser engine.
2. A pixel render comparison of the login page is not automated; the freeze is proved by the hash baseline and the empty diff, not by an image comparison.
3. The contrast probe cannot measure text painted over a photograph, so the login page photo contrast (test 93) is not measured.
4. The responsive sweep measured layout, clipping, overflow and touch target boxes. It did not drive every form and dialog at every width.
5. Phone touch targets only reach the 44 px rule when the session also sends `Emulation.setTouchEmulationEnabled`; a phone-sized viewport with a fine pointer does not match `pointer:coarse`. `tests/audit/contrast_touch_probe.py` enables it, `tools/responsive.py` does not, which is why the two tools report different control sizes at 390 px.
6. There is no npm toolchain, Firebase project, or emulator; those checks are not applicable and were not run.
7. All runtime work used demo accounts, the demo gate and a throwaway SQLite database. Production data and rules were never accessed.

## 8. Prioritized fix list

The list below is the 2026-10-29 finding list with what happened to each item. Every entry says either the phase that closed it or the decision that keeps it open.

### Closed in code

| Original item | Severity | Where it went |
|---|---|---|
| 1. State merge integrity (W15, W9, R1) | Blocker | Phase 30. `POST /api/state` now merges by id, never deletes an omitted record, mints ticket numbers itself, forces a new record to Submitted, refuses an advanced forged status with HTTP 400, ignores client-supplied attachment names and audit entries, and writes one server audit event per accepted creation. Proved by `server/tests.py:849` `test_http_integrity`, `server/tests.py:1206` `test_http_ticket_ids` and `tests/audit/results/state_merge_probe.json` |
| 2. Audit immutability (R2) | High | Phase 30. `server/app.py:1184-1191` refuses an import whose audit prefix is shorter or different, and `server/tests.py:947` asserts the refusal |
| 3. Transition enforcement tests (W15, test 48) | High | Phase 43. `server/tests.py:1145` `test_http_transition_matrix` drives all 256 from-to-role combinations through the HTTP API |
| 4. State-created records audit (R1) | High | Phase 30. `server/tests.py:889-890` asserts one creation event carrying the actor, the role and the server time |
| 5. 30-minute idle session timeout (S8) | Medium | Phase 30. `server/auth.py` `SESSION_IDLE_MINUTES = 30` plus the touch window, asserted in `test_http_integrity` and `tools/session_check.py` |
| 6. Daily, Every 2 weeks, Every 6 months and Custom frequencies (M1) | Medium | Phase 30, cadence arithmetic asserted since Phase 43 in `test_schedule_generation` |
| 7. Re-open availability when the agreed date arrives (M6) | Medium | Phase 30. `test_agreed_date_recheck` |
| 8. Hide Request source and Priority from requester intake (U7) | Medium | Phase 31 and 37, with the server refusing the fields for that role |
| 11. Phone controls at 44 px (V3, test 100) | Medium | Phase 43. The `@media (pointer:coarse)` block in `css/console.css:1115-1129` and the pager square at `css/console.css:1084-1086`; `tests/audit/contrast_touch_probe.py` now measures phone views with touch emulation on, and `tools/pagetest.js:2528` drives the technician workbench itself |
| 12. Dashboard label clipping at 1180x820, 1280x720, 1366x768 (test 101) | Medium | Closed by measurement in Phase 43, not by a new rule: `tools/responsive.py` reports 0 problems across its 37 widths in the light theme and 0 again on the dark palette, including the three widths the 2026-10-29 run flagged. The clip is gone from the current tree |
| 14. Ticket and report print views with letterhead (U6, U10) | Low | Phase 32, proved by `tools/print_check.py` |
| 15. Workflow Guide in each role navigation (U12) | Low | Phase 35, asserted by `tools/rolepages_test.js:612-616` |
| 16. Login baseline (U1) | Low | Phase 33. `docs/login-baseline.sha256` hashes the approved build; nine entries verify OK and the diff since `b47ffd9` is empty |
| 17. Visible error state, "This page is not available" copy and the outage notice (U14, test 61) | Low | Phase 33 and 37 for the panel and the copy; Phase 43 for the read path: `renderOutageNotice` (`js/ui.js:1661-1691`) names a server that did not answer, on every lane, asserted in `tools/pagetest.js:2376` `readStates` |
| 18. PNG and maskable icons in the manifest (V2) | Low | Phase 43, asserted by `tools/pagetest.js` fetching every listed icon |
| 19. Concurrent ticket id and job generation tests (W3, M4) | Low | Phase 30. `test_http_ticket_ids` and `test_http_job_generation_race` |
| 20. Job-level technician assignment (M5) | Low | Phase 30, engine and browser |
| 21. Previous-record selector on coordinator intake (W16) | Low | Phase 31, `createLinkedTicket` plus the intake link assertions in `test_engine_recurrence` |
| 23. Maintenance and reports scenario coverage (E5, E6) | Low | Phase 43. `test_schedule_generation`, `test_query_module` and `test_http_sla_window` |
| 24. Board invalid-move snap-back and direct-API rejection (U5, test 99) | Low | Phase 32, `boardMoveGuard` in `tools/pagetest.js` |
| - Authorized ticket closure, positive test (test 28, E4) | Medium | Phase 43. `test_authorized_ticket_closure` |
| - Report filters and completed totals (tests 44, 45, 46) | Medium | Phase 43. `test_query_module` |
| - Register propagation (R3) | Medium | Phase 30. `test_register_propagation` |

### Open by owner decision, not in code

| Original item | Severity | Why it stays open |
|---|---|---|
| 9. System theme following `prefers-color-scheme` (V1) | Medium | The dark block was removed in the first commit and `AGENTS.md` freezes the theme. Following the operating system repaints every screen, so lifting the freeze is the owner's call, recorded as D24 in `docs/DECISIONS.md` |
| 10. Muted and brand text to 4.5:1 (V4, test 76) | Medium | The failing ratios are the frozen `--muted` and brand token values. A style edit cannot reach 4.5:1 without changing them, which the freeze forbids |
| 22. Demo list visibility versus master test 92 (S5) | Low | `AGENTS.md` and decision D25 require the four demo accounts on every host. The recorded deviation stands |

### Open because it is not a code task

The remaining distance to a live service is accounts, data and a host, all listed as item 40.7 in `docs/IMPLEMENTATION_CHECKLIST.md`: the Google OAuth client id, the host and TLS certificate, SMTP credentials if mail must leave the outbox, the real people records and the real asset numbers. The owner also asked that the four demo accounts and the seeded dummy dataset stay exactly as they are, because the build is a demo.

## 9. Verdict

**COMPLETE for the code, with the three residuals named below.**

Of the 67 audited requirement rows, 64 PASS and 3 are PARTIAL: S5, V1 and V4. None is Blocker or High, and no row is FAIL. Of the 102 required tests, every row whose gap was code-completable now names a passing test in Section 4.2. That meets the condition the prompt sets for a complete verdict: zero FAIL or PARTIAL items at Blocker or High severity, and every remaining item explained.

The three residuals are, in order: the demo account list stays visible by owner decision D25 rather than behind a flag; the System theme choice is a saved preference that paints light because following the operating system would repaint every screen the frozen theme governs; and light-theme muted text measures 4.09 to 4.42:1 against the 4.5:1 the probe asks for, on token values `AGENTS.md` freezes. The last two need the owner to lift the theme freeze, not a style edit. The fourth row that was on that list, U14, closed on 2026-10-31: a deployed screen whose server stops answering now names the outage on the screen, and the loading, empty and not-available states are each asserted.

The service workflow, the eight statuses, role separation, office scoping, the maintenance lifecycle, the asset register, reports, the append-only audit trail, the PWA shell and the visual system are implemented and backed by the passing suites listed in Section 4.1. What is left between this tree and a live service is a host, credentials, real people records and real asset numbers, which is deployment work rather than development work.
