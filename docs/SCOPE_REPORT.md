# Scope Guard Report

Date: 2026-10-29

Branch: `chore/scope-guard`

Base sources used for every decision:

- A: `docs/source/Maintenance_System.pdf` and Appendices A to C of `docs/MASTER_PROMPT_COMPLETE.md`.
- B: the owner pictures in `docs/reference/` (`ticket-list.png`, `ticket-details.png`, `dashboard.png`), described in Appendix E.
- C: explicit owner requests, including the master UI brief behind sections 25.5A and 25.5B.

The rule applied: keep only what is traceable to A, B or C. Everything else is off by default in one registry and can be restored without deleting code, data or files.

## 1. Central feature registry

`features.json` is the single source of truth. `tools/build_features.py` writes `js/features.js`. `tools/feature_parity_check.py` proves that the registry, the browser mirror and every page reference agree.

All eleven flags are `false` in this build:

| Flag | Feature | Baseline source | State |
|---|---|---|---|
| `ticketsBoardView` | Kanban board for tickets | none | OFF |
| `workspaceCommandPalette` | Global command palette and Ctrl/Cmd K | none | OFF |
| `maintenancePlanner` | Month, week and agenda calendar | none | OFF |
| `dashboardKpiSparklines` | Seven day sparklines under KPI tiles | none | OFF |
| `designGallery` | Development gallery and framed previews on `index.html` | none | OFF |
| `rolesReferencePage` | Standalone roles and access matrix | none | OFF |
| `ticketJumpPicker` | Second ticket chooser and search inside ticket detail | none | OFF |
| `requestIdempotencyField` | Visible duplicate protection key on intake | none | OFF |
| `demoIntakeSimulation` | Demo traffic simulation switch in Configuration | none | OFF |
| `profilePasswordChange` | In-app password change card | none | OFF |
| `notificationPopupsToggle` | Pop-up preference inside the notification tray | none | OFF |

## 2. Inventory by surface and role

Navigation is identical in the desktop rail, the phone tab bar and the More sheet. The role sets below are asserted at 390, 768 and 1440 px.

### Office Requester

Visible: Dashboard; My Requests, New Request, Confirmation; Office Register, Maintenance Visits, Reports; Notifications, Profile.

| Surface | Baseline | Decision | Flag | Files |
|---|---|---|---|---|
| Dashboard | B Appendix E.3, C 25.5A | KEPT, sparklines off | `dashboardKpiSparklines` | `dashboard.html`, generated `or-dashboard.html` |
| My Requests and ticket detail | B Appendix E.1 and E.2 | KEPT, jump picker off | `ticketJumpPicker` | `tickets.html`, `ticket.html` |
| New Request intake | A intake channels | KEPT, key field off, "chat notes" label corrected | `requestIdempotencyField` | `request.html` |
| Confirmation and maintenance visits | A office availability and confirmation | KEPT | none | `confirm.html`, `visits.html` |
| Office Register | A register, C 25.5A health strip | KEPT | none | `register.html` |
| Reports | A eight reports and filters | KEPT, "past SLA" corrected to "past due" | none | `reports.html` |
| Notifications | A assignment notifications | KEPT, pop-up toggle off | `notificationPopupsToggle` | `notifications.html`, `js/ui.js` |
| Profile | B E.0 profile link, C theme | KEPT, password card off, density kept from C 25.5B | `profilePasswordChange` | `profile.html` |

### IT Technician

Visible: Dashboard; My Tickets, My Maintenance Jobs; Office Register, Reports; Notifications, Profile.

| Surface | Baseline | Decision | Flag | Files |
|---|---|---|---|---|
| Dashboard | B Appendix E.3, C 25.5A | KEPT, sparklines off | `dashboardKpiSparklines` | `dashboard.html`, generated `itc-dashboard.html` |
| My Tickets and ticket detail | B Appendix E.1 and E.2 | KEPT, jump picker off | `ticketJumpPicker` | `tickets.html`, `ticket.html` |
| My Maintenance Jobs | A preventive maintenance execution | KEPT, calendar planner off | `maintenancePlanner` | `maintenance.html` |
| Register and reports | A register and reports | KEPT | none | `register.html`, `reports.html` |
| Notifications and profile | A notifications, B E.0 | KEPT, pop-up toggle and password card off | two flags | `notifications.html`, `profile.html`, `js/ui.js` |

### IT Coordinator

Visible: Dashboard; Tickets, New Request, Review and Assign, Confirmation; Maintenance; Office Register, Reports; Notifications, Profile.

| Surface | Baseline | Decision | Flag | Files |
|---|---|---|---|---|
| Dashboard | B Appendix E.3, C 25.5A | KEPT, sparklines off | `dashboardKpiSparklines` | `dashboard.html`, generated `ic-dashboard.html` |
| Tickets and ticket detail | B Appendix E.1 and E.2 | KEPT, board and jump picker off | `ticketsBoardView`, `ticketJumpPicker` | `tickets.html`, `ticket.html` |
| Intake on behalf of an office | A intake channels | KEPT, key field off | `requestIdempotencyField` | `request.html` |
| Review and Assign | A review, assessment, assignment | KEPT | none | `review.html` |
| Confirmation | A accept, reject, no response, closure | KEPT | none | `confirm.html` |
| Maintenance | A preventive maintenance | KEPT, calendar planner off | `maintenancePlanner` | `maintenance.html` |
| Register and reports | A register and reports | KEPT | none | `register.html`, `reports.html` |
| Notifications and profile | A notifications, B E.0 | KEPT, pop-up toggle and password card off | two flags | `notifications.html`, `profile.html`, `js/ui.js` |

### System Administrator

Visible: Administration Users, Offices, Configuration, Audit Log, plus the
shared Workflow Guide, Notifications and Profile.  Role scope 5 takes the
dashboard, the ticket screens, the office register, reports and maintenance out
of this lane, so it holds administration work and the read-only audit viewer
only.  `GET /api/tickets`, `/api/reports` and `/api/export` answer 403 for the
lane, and the generated `mgmt-*` files exist only for the pages it may open.

| Surface | Baseline | Decision | Flag | Files |
|---|---|---|---|---|
| Dashboard | B Appendix E.3, C 25.5A | REMOVED from the lane (role scope 5) | none | `permissions.json`, `js/ui.js` |
| Service Records and ticket detail | B Appendix E.1 and E.2 | REMOVED from the lane, refused by the backend | none | `permissions.json`, `server/app.py` |
| Maintenance | A preventive maintenance | REMOVED from the lane | none | `permissions.json` |
| Register and reports | A register and reports | REMOVED from the lane | none | `permissions.json`, `server/app.py` |
| Workflow Guide | A process documentation | KEPT, read-only, no lane filter without a swimlane | none | `flow.html` |
| Users | C administration provisioning | KEPT | none | `users.html` |
| Offices | C administration provisioning | KEPT | none | `offices.html` |
| Configuration | C administration configuration | KEPT, demo simulation switch off | `demoIntakeSimulation` | `settings.html` |
| Audit Log | A status and audit history | KEPT | none | `audit.html` |
| Notifications and profile | A notifications, B E.0 | KEPT, pop-up toggle and password card off | two flags | `notifications.html`, `profile.html`, `js/ui.js` |

### Reference and non-workspace routes

| Surface | Where it appeared | Baseline | Decision | Flag |
|---|---|---|---|---|
| `index.html` design gallery | All roles, direct address | none | HIDDEN, neutral panel, no navigation entry | `designGallery` |
| `roles.html` roles and access matrix | All roles, direct address | none (role enforcement lives in `permissions.json`) | HIDDEN, neutral panel, no navigation entry | `rolesReferencePage` |
| Board layout on the register | Coordinator, technician, management | none; owner listed it as optional | HIDDEN, deep link falls back to list | `ticketsBoardView` |
| Command palette and top bar search | All roles | none; owner listed it as optional | HIDDEN, no trigger and no shortcut | `workspaceCommandPalette` |
| Calendar planner | Technician, coordinator, management | none; owner listed it as optional | HIDDEN, schedule list stays | `maintenancePlanner` |
| KPI sparklines | All roles | none; owner listed it as optional | HIDDEN, KPI counts stay | `dashboardKpiSparklines` |
| Ticket jump picker | Ticket detail, all roles | none | HIDDEN | `ticketJumpPicker` |
| Visible idempotency key | Intake, requester and coordinator | The key is required by the master prompt, the visible field is not | HIDDEN | `requestIdempotencyField` |
| Demo simulation switch | Configuration, management | none | HIDDEN | `demoIntakeSimulation` |
| Password change card | Profile, all roles | none; production sign-in is Google OIDC | HIDDEN pending owner confirmation | `profilePasswordChange` |
| Pop-up toggle | Notification tray, all roles | none | HIDDEN pending owner confirmation | `notificationPopupsToggle` |
| Row density | Account tray and profile, all roles | C 25.5B explicitly asks for a Comfortable and Compact density toggle | KEPT | none |

## 3. Copy corrections

| Location | Before | After | Why |
|---|---|---|---|
| Intake attachment label | Relevant files / chat notes | Photos and files | The master prompt states that the PDF's relevant files and chat notes are viewer elements and not part of the process. Attachments and evidence remain in scope. |
| Ticket register target column | past SLA | past due | SLA plans are explicitly out of scope. The underlying target date and the five day fallback are unchanged. |
| Configuration card hint | reminder loop and simulation | reminder loop | The simulation switch is off by default. |

## 4. Dependencies kept

- The board, palette, planner, sparkline, gallery, roles route, jump picker, idempotency field, simulation switch, password card and pop-up toggle code all remain in the repository. No code, data, collection or file was deleted.
- `features.json` and `js/features.js` are the only switches. Setting a flag to `true` and running `python tools/build_features.py` restores the surface.
- Every workspace page loads `js/features.js` before `js/ui.js`. `tools/script_order_check.js` passes 69 checks.
- `permissions.json`, `js/permissions.js` and the backend remain the single permission map. Permission parity passes.
- No backend endpoint was removed or changed. There are no dedicated board, palette, planner, sparkline, gallery, roles, jump picker or pop-up endpoints to disable. The `idempotencyKey`, `simulate` and password operations remain part of the existing contract, so hiding them is a UI decision only. This is recorded as a limitation below.
- The service worker shell cache is raised to `itc-shell-v8` so returning installations receive the new HTML and JavaScript.

## 5. Proof of checks

Commands run on this working tree on 2026-10-29:

| Command | Result |
|---|---|
| `node tools/pagetest.js` | 693 passed, 0 failed. Includes exact navigation sets for all four roles at 390, 768 and 1440 px, cross-width equality, direct route checks and the new convenience checks. |
| `python tools/feature_parity_check.py` | PASS, 11 flags, 70 workspace pages, all off |
| `python tools/permission_parity_check.py` | PASS, 20 pages, 42 actions |
| `python tools/role_pages.py --check` | PASS, 50 files, 50 unique titles |
| `node tools/rolepages_test.js` | 182 passed, 0 failed |
| `python server/tests.py` | 383 passed, 0 failed |
| `python tools/validate.py` | VALIDATION PASSED |
| `python tools/ui_check.py` | UI CONSISTENCY PASSED, 73 pages |
| `node tools/content_check.js` | 178 checks passed, 0 issues |
| `node tools/ui_audit.js` | 345 checks passed, 0 issues |
| `python tools/js_syntax_check.py` | PASS, 25 files and 194 inline blocks |
| `node tools/script_order_check.js` | 69 passed, 0 failed |
| `python tools/em_dash_check.py` | PASS, 0 em dashes |

Frozen surfaces:

- `git diff --name-only -- login.html css/login.css js/login.js css/app.css css/green.css css/kit.css` prints nothing.
- No staged changes in those files either.
- The colour token files are byte identical in this working tree.

Not run in this phase:

- The full `tools/responsive.py` sweep of 73 pages across 37 viewports. The page suite simulated 390, 768 and 1440 px layout and asserted the same navigation and hidden features at all three. `responsive.py` should be run before release if a real Chrome pass is required.
- No manual screenshot review of the eleven hidden surfaces was needed because the page tests assert that the DOM nodes are absent, not merely transparent.

## 6. Needs owner decision

These items are not hidden silently. Each is either hidden behind a named flag or left in place, and each needs a yes or no.

1. Technician directory. Appendix E.0 and E.3 ask for an Agent Directory for IT roles. The product currently has a Technician workload card and Administration Users, but no separate directory page. Should I add a directory, keep the workload card as the substitute, or treat the directory as out of scope?
2. Password change card. It is hidden behind `profilePasswordChange` because production sign-in uses Google Workspace OIDC. Should it stay hidden, or should demo accounts keep an in-app password change?
3. Notification pop-up toggle. It is hidden behind `notificationPopupsToggle`. Assignment notifications and the notification centre remain. Should users be able to pause live pop-ups, or should the toggle stay hidden?
4. Duplicate protection key field. It is hidden behind `requestIdempotencyField`. The key still travels with the request and the double submit protection still works. Should the field stay hidden, or do you want it visible for testing?
5. Demo simulation switch. It is hidden behind `demoIntakeSimulation`. Should Configuration keep a demo traffic switch, or is it development-only and should stay hidden?
6. Dashboard statistics gaps. Appendix E.3 asks for a Range line and an Export link under the Statistics panel. The dashboard has report timeframe controls, a Ticket Activity CSV export, and report exports, but no Range line or export under the Service breakdown table. Should I add those two items or accept the current export routes?
7. Label wording. "Relevant files / chat notes" is now "Photos and files", and "past SLA" is now "past due". Confirm these replacements.
8. Roles reference route. `roles.html` is hidden behind `rolesReferencePage` and direct addresses show the neutral screen. Confirm that no role needs a standalone matrix. Role enforcement itself is unchanged.

## 7. Summary

- Eleven flags, all off, in one registry.
- All four role navigations match the baseline at 390, 768 and 1440 px.
- The hidden extras are absent from navigation, routes, DOM, shortcuts and backend API routes where such routes exist.
- No business logic, workflow, status label, permission rule, security rule, login file or colour token changed.
- All listed suites pass.
- Waiting for the owner answers in section 6 before closing the phase.
