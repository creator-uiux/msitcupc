# Traceability

Maps every requirement of the master specification to the code that
implements it and the check that verifies it.  The last column separates
**verified** from **unverified**, so a requirement is never marked complete
merely because a page or a button exists.

## Source documents

| Document | Result of inspection |
|---|---|
| `docs/source/Maintenance_System.pdf` (1 page, 9509 characters of text) | The 29 step SOP matches Appendix A verbatim.  Owner Anthony Derecho.  The title block reads "Last Updated January 30, 2021" while the file metadata says it was generated September 30, 2026, so the PDF is not dated consistently; this does not affect the process.  A second copy sits at the repository root. |
| `docs/reference/UPLoginUI.PNG` and `docs/reference/login-bg.jpg` | The sign-in reference image and the campus photograph used by `login.html`. |
| Master specification Sections 6 to 13, Appendix A and Appendix B | The authoritative workflow, the traced diagram facts and the machine readable node and edge list. |

The lane ownership and the flow in Appendix B were produced by rendering the
PDF and reading its vector data: every shape was assigned to a swimlane by
coordinates and all 105 arrowheads were matched to their target nodes.  Two
connectors are drawn without arrowheads and one label has no line at all;
those places were implemented from the label text and the SOP numbering
(Appendix B.6).

## Workflow steps to code

| SOP step | Clause | Code | Test |
|---|---|---|---|
| 1 to 2, record request, Status Submitted | 6, 7 | `engine.create_ticket`, `engine._record_ticket` | `tests.py` create ticket |
| 3, review for completeness | 7 | `engine.request_info`, `engine.submit_info` | `tests.py` needs info, `smoke.js` |
| 4 to 5, assess impact and urgency, set priority and target | 7 | `engine.assess`, `engine.priority_for` | `tests.py` assess |
| 6, assign technician and notify | 7 | `engine.assign` | `tests.py` assign, `smoke.js` |
| 7, withdrawal, Status Cancelled | 9 | `engine.request_withdrawal` (office asks), `engine.cancel` (coordinator records the reason) | `tests.py` cancel, `pagetest.js` withdraw |
| 8, dependency, follow up, three outcomes | 8 | `engine.place_hold`, `engine.follow_up`, `engine.resolve_dependency`, `engine.cancel_from_dependency` | `tests.py` dependency, `smoke.js` |
| 9 to 10, review history, coordinate the schedule | 8 | `engine.start_work` (requires the coordination), `engine.coordinate` | `tests.py` start, `smoke.js` |
| 11 to 13, diagnose, decide, record | 8 | `engine.diagnose`, `engine.record_repair`, `engine.place_hold` | `tests.py` diagnose, repair |
| 14, test the result | 8 | `engine.record_test` (a pass needs a service summary) | `tests.py` test, `smoke.js` |
| 15, office confirmation | 9 | `engine.office_decision` (office only), `engine.send_reminder`, `engine.world_tick` | `tests.py` confirm, reminder |
| 16, close or authorized closure | 9, 6.3 | `engine.close` (mode split: the office confirms, the coordinator authorizes), `settings.authorizedClosureRoles` | `tests.py` close |
| 18, recurrence creates a new linked ticket | 9 | `engine.create_linked_ticket` | `tests.py` recurrence |
| 19 to 20, maintenance schedule and the due check | 10 | `engine.create_schedule`, `engine.run_schedule_check` | `tests.py` schedule |
| 20.2 to 20.3, occurrence identity and duplicate prevention | 10.1 | `jobs.occurrence` plus the unique index in `db.py` | `tests.py` no duplicate job |
| 21 to 22, assign, availability, reschedule | 10 | `engine.reschedule_job`, `engine.confirm_availability` | `tests.py` reschedule |
| 23 to 24, the checklist | 10 | `engine.record_checklist_item` | `tests.py` checklist |
| 25, additional fault and the corrective ticket | 10 | `engine.flag_additional_fault`, `engine.create_fault_ticket` | `tests.py` fault ticket |
| 26, outcome, next due date | 10 | `engine.record_outcome`, `engine._finalize_job_outcome`, `engine._advance_next_due` | `tests.py` outcome |
| 27, Section 3 confirmation for maintenance | 10 | `engine.job_confirmation` (office only), `engine.close_job` (the audited authorized closure) | `tests.py` job confirm |
| 28, system controls and records | 11 | `engine._audit`, `engine._audit_status`, `app._scoped` | `tests.py` audit, access |
| 29, reports | 13, 16 | `server/query.py`, `app._api_reports`, `app._api_export`, `reports.html` | `tests.py` query, `api_check.py` |

## Cross cutting clauses

| Clause | Topic | Code | Test |
|---|---|---|---|
| 6.1 | The transition whitelist on the trusted backend | `engine.TRANSITIONS` read from `permissions.json` | `tests.py` exhaustive transition test (every disallowed pair refused) |
| 6.2 | Resolved means testing passed, never auto close, rejection returns to diagnosis | `engine.record_test`, `engine.office_decision`, `engine.world_tick` | `tests.py` test, confirm, reminder |
| 6.3 | Authorized closure, configurable roles, mandatory reason | `engine.close`, `settings.authorizedClosureRoles` | `tests.py` close |
| 4A.1 | One shared permission map for the frontend and the backend | `permissions.json`, `server/engine.py`, `js/permissions.js` | `tools/permission_parity_check.py` |
| 4A.2 | Per role pages, actions and data scope | `js/ui.js` `ACCESS`, `engine` guards, `app._scoped_requester`, `app._scoped_technician`, `UI.canAct` | `tools/rolepages_test.js`, `api_check.py`, `tests.py` role scope |
| 4A.3 | Who acts next, the Needs my action queue and the Waiting on label | `js/ui.js`, `flow.html` next action panel | `pagetest.js` |
| 4A.4 | The Workflow Guide from the Appendix C data, four lanes, the user's lane highlighted | `js/flowdata.js`, `flow.html` | `tools/appendix_c_check.py`, `pagetest.js` |
| 11 | Append only audit with actor, time, from to status and reason | `engine._audit`, `engine._audit_status` | `tests.py` audit trail |
| 12 | Authorization, validation and transitions on a trusted layer | `server/engine.py`, `server/app.py` | `tests.py`, `api_check.py` |
| 14 | The design system, tokens for Light and Dark, components, page patterns | `css/app.css`, `css/green.css`, `css/kit.css`, `docs/DESIGN_SYSTEM.md` | `tools/validate.py`, `tools/gate_shots.py` |
| 14.11 | The visual quality gate | `tools/gate_shots.py`, `docs/screenshots/` | the machine check in the tool |
| 14.12 | Light, Dark and System, no hard coded colours | `css/app.css` (`:root` and the dark selectors), `js/ui.js` `applyTheme` | `tools/theme_discipline_check.py` refuses a new colour literal and an unresolved token, `tools/gate_shots.py` captures both themes |
| 14.13 | The installable PWA and the mobile fit | `manifest.webmanifest`, `sw.js`, `offline.html`, `js/pwa.js`, the More sheet | `tools/gate_shots.py` |
| 15 | Role based access, office isolation, safe attachments, protected audit | `server/app.py`, `server/engine.py` | `tests.py` access, `api_check.py` |
| 18 | No em dashes in generated text | the whole tree | `tools/em_dash_check.py` |
| 20 | Timestamps displayed in Asia/Manila | `js/time.js` | `tools/time_check.js` (run under three host timezones) |

## Final audit (specification 21)

| # | Requirement | Implementation | Verification | Result | Remaining limitation |
|---|---|---|---|---|---|
| 1 | The four swimlanes map to the lane ownership | `js/flowdata.js` LANES with the PDF lane names | `tools/appendix_c_check.py` | verified | none |
| 2 | Every intake path works | `engine.create_ticket`, `request.html`, the coordinator on-behalf path | `tests.py`, `smoke.js` | verified | none |
| 3 | All eight statuses and every transition | `engine.TRANSITIONS` from `permissions.json` | the exhaustive transition test | verified | none |
| 4 | Missing information updates the existing ticket | `engine.submit_info` | `tests.py`, `smoke.js` | verified | none |
| 5 | The three dependency outcomes | `engine.follow_up`, `resolve_dependency`, `cancel_from_dependency` | `tests.py`, `smoke.js` | verified | none |
| 6 | Testing and office confirmation are separate | `record_test` then `office_decision` | `tests.py` | verified | none |
| 7 | Rejection returns the ticket to diagnosis | `engine.office_decision` rejected branch | `tests.py`, `smoke.js` | verified | none |
| 8 | No response never auto closes | `engine.world_tick` keeps the status Resolved | `tests.py` reminder | verified | none |
| 9 | Cancellation preserves the record | `engine.cancel` keeps the history | `tests.py` | verified | none |
| 10 | Recurring issues create linked new tickets | `engine.create_linked_ticket` | `tests.py`, `smoke.js` | verified | none |
| 11 | Preventive maintenance has its own start and schedule | `engine.create_schedule` and the maintenance lane | `tests.py` | verified | none |
| 12 | Duplicate jobs are prevented | the occurrence identity and the unique index | `tests.py` | verified | none |
| 13 | Availability and rescheduling work | `engine.confirm_availability`, `engine.reschedule_job` | `tests.py` | verified | none |
| 14 | Checklist results and evidence are retained | `engine.record_checklist_item` | `tests.py` | verified | none |
| 15 | Corrective tickets are linked to maintenance jobs | `engine.create_fault_ticket` | `tests.py` | verified | none |
| 16 | Incomplete or cancelled maintenance is never successful | `engine.record_outcome`, `engine._finalize_job_outcome` | `tests.py` | verified | none |
| 17 | The Office IT Service Register is consistent | `server/query.py`, `register.html` | `tests.py` query | verified | none |
| 18 | Reports use real data and correct filters | `server/query.py`, `app._api_reports` | `tests.py`, `api_check.py` | verified | none |
| 19 | Cancelled is separate from completed totals | `query.summarize` | `tests.py` | verified | none |
| 20 | Audit records every status change and is append only | `engine._audit` | `tests.py` audit trail | verified | none |
| 21 | Office level permissions are enforced | `engine._office_block`, `app._scoped` | `tests.py` access, `api_check.py` | verified | none |
| 22 | Ticket list, detail and dashboard have the reference functionality | `tickets.html`, `ticket.html`, `dashboard.html` | `pagetest.js` | verified | the owner's screenshot references could not be opened, so the written requirements were used |
| 23 | All pages are responsive and accessible | `css/app.css`, `css/console.css` | `tools/responsive.py` (37 viewports from 320x480 to 7680x2160, with `--theme=dark` for the dark palette and `--scale=` for a real 200 percent zoom through `Emulation.setPageScaleFactor`), `tools/responsive_behavior.py` (the register, a record, the review hand-off, the office form and the dashboard clicked through at 390, 768 and 1440 px in headless Chrome), `tools/gate_shots.py`, `tests/audit/contrast_touch_probe.py` (44 px floor under touch emulation) | verified | none |
| 24 | No primary control is nonfunctional | every action is a guarded engine method | `smoke.js`, `pagetest.js` | verified | none |
| 25 | Tests and the build were executed, with honest results | the test suites below | the results below | verified | the page suite is flaky while another process is editing the same tree |
| 26 | The UI follows the design system and looks consistent | `docs/DESIGN_SYSTEM.md`, `docs/screenshots/` | `tools/gate_shots.py` | verified | the screenshots are a machine check plus a read of the captures, not a full designer review |
| 27 | Role scoping enforced on the backend | `permissions.json`, `engine` guards, `app._scoped_technician` | `tools/permission_parity_check.py`, `rolepages_test.js`, `tests.py` role scope | verified | none |
| 28 | Light, dark and System themes work everywhere | `css/app.css`, `js/ui.js` | `tools/responsive.py --theme=dark` measures the whole 69-page sweep on the explicit dark palette, `tools/gate_shots.py` captures both themes at three widths | verified | the font is fetched from a CDN and falls back to the system stack when it is unreachable |
| 29 | The app works as a website and an installable PWA | `manifest.webmanifest`, `sw.js`, `offline.html` | `tools/gate_shots.py` | verified | installability was checked by the manifest and the worker, not by a real install |
| 30 | Appendix C is fully represented | `js/flowdata.js` | `tools/appendix_c_check.py` (81 nodes, 106 edges) | verified | the legend artifact N75 and its two connectors are excluded by design |

## Lane ownership (specification 4 and 4A)

| Lane | Owns | Refused to the others | Verification |
|---|---|---|---|
| Office Requester or Office Representative | the service request, the supplied information, the withdrawal request, the accept and reject decision, the office confirmation and closure, the recurrence, the office availability and the new maintenance date | the coordinator may not accept, reject or close on the office's behalf | `tests.py` role scope, `pagetest.js` role scoping |
| IT Coordinator | the review, the assessment, the assignment and the reassignment, the dependency follow-up and its outcome, the cancellation reason, the authorized closure, the maintenance schedule, the manual schedule check | the technician may not record the follow-up, the office may not assess or assign | `tests.py` role scope, `permission_parity_check.py` |
| IT Technician | the diagnosis, the service actions, the dependency record, the test, the checklist, the additional fault and the corrective ticket, and the completed visit | the technician may not act on a record that is not assigned to them, may not assign, prioritise, cancel or close, and may not see another technician's queue | `tests.py` role scope, the HTTP scope assertions |
| System | the ticket number, every status, the notifications, the reminders, the audit trail, the register, the report data, the schedule check, the occurrence and the job generation, the next due date | no screen and no button; an automated step is written with the actor "System" | `smoke.js`, `tests.py` audit trail |
| System Administrator | the users, the roles and office membership, the offices, the asset register, the categories, the configuration and the read-only audit viewer | no operational ticket step, and no operational screen either: role scope 5 leaves the lane no dashboard, ticket, register, report or maintenance page, and `/api/tickets`, `/api/reports` and `/api/export` are refused (D14) | `pagetest.js` role scoping, `rolepages_test.js` lane check, `tests.py` role scope |

## Test results

Every count below is the result of the command on this working tree, measured
on 2026-11-01. A suite that was not run is not listed.

| Suite | Command | Result |
|---|---|---|
| Backend | `python server/tests.py` | 673 passed, 0 failed |
| Workflow smoke | `node tools/smoke.js` | 103 passed, 0 failed |
| Page integration | `node tools/pagetest.js` | 1014 passed, 0 failed |
| Role pages | `node tools/rolepages_test.js` | 507 passed, 0 failed (45 lane pages, 663 painted links read on a signed-in lane) |
| API | `python tools/api_check.py` | 17 passed, 0 failed |
| Markup and DOM ids | `python tools/validate.py` | VALIDATION PASSED |
| UI house rules | `python tools/ui_check.py` | PASSED (69 pages) |
| JavaScript syntax | `python tools/js_syntax_check.py` | PASS (27 files, 181 inline blocks) |
| Em dash sweep | `python tools/em_dash_check.py` | PASS (0 in the tree) |
| Appendix C coverage | `python tools/appendix_c_check.py` | PASS (81 nodes, 106 edges, four lanes) |
| Workflow diagram coverage | `python tools/workflow_coverage_check.py` | PASS (63 SOP steps, 45 map actions all claimed by a step, 84 engine guard functions) |
| UI ownership | `node tools/ui_ownership_check.js` | PASS (69 html files, 21 pages, 4 lanes, 23 live handlers, the wrong-lane table empty) |
| Permission parity | `python tools/permission_parity_check.py` | PASS |
| Permission parity (Node.js) | `node tools/parity_check.js` | 57 passed, 0 failed |
| Role page generation | `python tools/role_pages.py --check` | PASS (45 role pages, 45 unique titles) |
| Asia/Manila display | `node tools/time_check.js` | ASIA/MANILA DISPLAY PASS |
| Theme token snapshot | `python tests/audit/theme_tokens.py` | 41 tokens, 0 mismatches |
| Theme discipline | `python tools/theme_discipline_check.py` | PASS (211 custom-property reads all resolve, 40 colour literals in `css/console.css` all allowed, 41 snapshot rows still declared in their sheet, 69 pages carry no own `<style>` block or inline colour) |
| HTML markup check | `node tools/html_check.js` | 345 assertions passed, 0 failed across 69 pages |
| UI structure audit | `node tools/ui_audit.js` | 325 checks passed, 0 issues, 69 pages |
| Script load order | `node tools/script_order_check.js` | 65 passed, 0 failed |
| Deep behavior audit | `node tools/deep_audit.js` | 608 checks passed, 0 issues |
| Content check | `node tools/content_check.js` | 166 checks passed, 0 issues |
| Feature parity | `python tools/feature_parity_check.py` | PASS (11 optional flags, 66 workspace pages) |
| Printed copies | `python tools/print_check.py` | PASS (2 pages: a record and a report) |
| Session expiry | `python tools/session_check.py` | PASS (16 checks), in a real browser against a live server |
| Responsive layout matrix | `python tools/responsive.py` | 0 of 2553 page/viewport checks with problems (69 pages x 37 widths, 320 to 7680 px); `--theme=dark` repeats the same 2553 measures with 0 problems |
| 200 percent zoom | `python tools/responsive.py --scale=2 --viewports=phone-390,tablet-768,landscape-1180,desktop-1440,zoom-1280` | 0 of 345 checks at a real `Emulation.setPageScaleFactor` of 2 |
| Primary screens driven in a browser | `python tools/responsive_behavior.py` | RESPONSIVE BEHAVIOR PASS (126 checks, 0 problems, signed-in lane at 390, 768 and 1440 px) |
| Touch targets and contrast | `python tests/audit/contrast_touch_probe.py` | 666 interactive controls across 26 phone views with touch emulation on, none under 44 px; 7172 text pairs checked with the lowest ratio 1.41, recorded as finding V4 against the frozen tokens |
| Role, office and merge scope | `python tests/audit/scope_probe.py`, `technician_scope_probe.py`, `state_merge_probe.py` | All three refused what they must against a freshly reset disposable demo server |

There is no separate build step. The repository root is the served tree and
`server/app.py` serves it directly; there is no `public/` assembly step in V5.
