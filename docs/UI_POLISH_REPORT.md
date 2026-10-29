# UI Polish Report

Phases 10 and 11, Section 25 pass. Recorded 2026-10-28 on the V5 tree.

Phase 11 replaced the icon rail and contextual second column with one grouped
sidebar, made each dashboard role-focused, and added pagination wherever a
list or table can grow. The workflow, routes, palette and sign-in screen did
not change.

This report replaces the earlier v2 document. That document described a
retired `HTMLUP/` tree, a blue palette and a serif display face; none of
those apply here. The current palette is the green token layer in
`css/green.css`, the display face is the existing Sora, and the sign-in
screen is frozen rather than redesigned.

## 1. Scope and frozen surfaces

| Surface | State | Proof |
|---|---|---|
| `login.html`, `js/login.js` | Changed by the owner-approved Phase 19 demo list, not in this pass | `git diff`; see Login and theme integrity |
| `css/login.css` | Not edited in this pass; the working tree carries a concurrent change made outside this pass | `git diff` against `docs/login-baseline.sha256` |
| `js/theme.js` | Changed by the row density preference (item 10), not in this pass | `git diff` |
| `img/up-seal.png`, `img/upc-seal.png` | Not edited | SHA-256 values match the same baseline |
| `css/app.css`, `css/green.css`, `css/kit.css` | Not edited | no working tree diff against the last commit |
| Palette, radii, shadows, type scale | Unchanged | `docs/THEME_SNAPSHOT.md` |
| Routes, workflow, status names, API, security rules | Unchanged | `server/tests.py`, `permission_parity_check.py` |

The only new stylesheet is `css/console.css`. Authenticated pages load it
after `app.css`, `green.css` and `kit.css`. The login page does not load it
and still loads `app.css`, `green.css`, `kit.css` and `login.css` in the
same order as before.

The eight status labels are unchanged and are used everywhere:
Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved,
Closed, Cancelled.

## 2. Shared authenticated shell

The shell is rendered by `js/ui.js` into four placeholders on every
authenticated page: `#chromeSide`, `#chromeAppbar`, `#chromeTopbar` and
`#chromeBottom`. No page markup carries the navigation itself, so a role
change re-renders the same shell everywhere.

- **Grouped sidebar.** One 256 px column. The top block carries the two
  existing seals, "UP Cebu" and the system name. The signed-in person, role
  and account shortcut sit directly below it. The navigation is a labelled
  list (Workspace, Requests or Service Requests, Maintenance, Records,
  Administration) with a left accent bar on the active screen and role-scoped
  count pills. A "Your account" block at the foot holds Notifications and
  Profile. There is no second navigation column.
- **Top bar.** Breadcrumbs, ticket search, role chip, notification tray and
  account tray. The account tray holds the Light, Dark and System theme
  picker. Breadcrumbs appear once, in the top bar, not in the page body.
- **Mobile app bar.** Menu control, seal lockup, notification bell and
  account trigger. The same theme picker is bound inside the mobile tray.
- **Bottom bar.** Four main destinations per role plus a More sheet. The
  More sheet exposes every remaining destination for the role.
- **Reference pages.** The Workflow Guide and Roles and Access reference
  remain routable at `flow.html` and `roles.html` under the same permission
  map, but they are no longer listed in the sidebar, the top bar or the More
  sheet. The navigation was trimmed; the routes and permissions were not
  changed.
- **Page frame.** A formal footer on every authenticated page: copyright
  line with the current year, University of the Philippines Cebu. The page
  content fills the remaining height so the footer sits at the bottom of
  short screens.

The design borrows the layout grammar of Firebase Console: one grouped
navigation column, a slim utility bar, underlined tabs, card-based content
and a right-side properties rail. It does not copy their branding. UP Cebu
identity comes from the existing seals, the university wordmark, the formal
page titles and the existing green palette.

## 3. Role-driven visibility

One source of truth: `permissions.json`, mirrored into `js/permissions.js`
and enforced by `server/engine.py`. The UI never grants access on its own.

The shell adds a body class for the active role: `role-requester`,
`role-technician`, `role-coordinator` or `role-management`. Markup opts into
role rules with utility classes, and `css/console.css` hides the elements a
role may not use. The elements are hidden, not disabled, and the backend
guard still refuses the operation if it is called directly.

| Role | Sidebar destinations | Hidden in the interface |
|---|---|---|
| Office Requester | Dashboard, My Requests, New Request, Confirmation, Office Register, Reports | staff, technician and coordinator panels; cost and labour columns; internal notes; technician, office and scope filters; bulk selection; assignment and scheduling controls |
| IT Technician | Dashboard, My Tickets, My Maintenance Jobs, Office Register, Reports | coordinator and administration panels; schedule create, edit and pause controls; office and scope filters; bulk selection |
| IT Coordinator | Dashboard, Tickets, New Request, Review and Assign, Confirmation, Maintenance, Office Register, Reports | administration panels |
| System Administrator | Dashboard, Service Records, Maintenance, Office Register, Reports, Users, Offices, Configuration, Audit Log | operational technician panels; coordination-only controls such as creating a maintenance schedule; edit and pause remain because the permission map allows them |

Notifications and Profile sit in the "Your account" block of every sidebar.
A group with nothing permitted is omitted, so no heading renders empty.

Additional rules:

- Bulk selection and its action bar exist only for the coordinator.
- The Dependencies tab on a ticket is staff-only.
- The public reply control changes wording: a requester sees "Reply to IT",
  staff see "Reply to office".
- The cost and labour rows are omitted for requesters in the ticket view.
- A forbidden address renders a neutral panel that says "This page is not
  available" and directs the person to their own navigation. It does not
  name the role list or confirm that a hidden feature exists.

`tools/rolepages_test.js` asserts the computed display value of the
visibility classes on representative pages for all four roles, checks that
sidebar links agree with the permission map, checks requester plain language,
and opens forbidden URLs to confirm the neutral panel appears.

## 4. Screen treatment

- **Dashboard.** Greeting, four role-specific tiles (for example "To review",
  "Active work", "Dependency holds" and "Overdue" for the coordinator), the
  eight status labels plus Overdue as compact links into the filtered ticket
  queue, four quick actions for the role, the activity chart, the status
  breakdown and a paginated "Needs your action" list. Each highlight carries a
  seven day sparkline so a rising or falling trend is visible without opening
  a report. A staff-only health strip then ranks the offices by overdue and
  open work, with a completion meter per office. The roles that dispatch work
  also get stacked technician load bars, and the costs card opens with a
  preventive compliance ring. Management is read-only, so the "Needs your
  action" list is hidden there rather than shown as a permanent zero. The data
  is scoped the same way the backend scopes it, so a role never sees another
  office's figures, and an office user sees no cross office health strip at
  all. The grid is two columns on desktop and one column from 1024 px down.
- **Tickets.** Queue tabs, search, filter drawer, removable filter chips,
  sortable table, a card layout and a status board. The register can switch
  between rows, work-order cards and eight-column board; phones start on
  cards; the choice is remembered and can be deep linked with `?view=`.
  Each card carries the ticket number, subject, office, category icon,
  status, priority edge and text chip, assignee avatar, due or overdue chip
  and attachment and reply counts. An office requester's reply count omits
  internal notes. The coordinator also gets row selection and the bulk
  action bar in the list layout. The board loads up to the query cap in one
  pass, prints the true count per status in each sticky column header, and
  says plainly when the cap is reached so the filters, not a hidden pager,
  are the way to narrow it.
- **Search.** Ctrl or Cmd plus K opens one palette over tickets, offices,
  assets and maintenance schedules, plus the recent items the person opened
  from it. Scope matches the role: a requester stays in their office, a
  technician sees only assigned records, and a role without Maintenance
  never sees a schedule. The same search is the magnifier in the phone app
  bar.
- **Ticket detail.** Docket header with the status stepper, role-limited
  action bar, conversation and service record tabs, and a properties rail.
  The requester view omits internal notes, dependencies and money.
- **Maintenance.** A planner with month, week and agenda views over the same
  schedules and visits, a legend for due, visit, rescheduled and overdue,
  previous, today and next controls, and a count of the dated items. A
  coordinated visit replaces the due chip on the same day, so a day is never
  printed twice. Technicians get a Today on your route panel above the
  schedule tables. Phones default to the agenda because a month of dots is
  not readable at 320 px. Schedule and job lists, follow-up indicators,
  checklist execution and the corrective-ticket panel follow. Create is
  coordinator-only; edit and pause follow the permission map.
- **Office register.** Office selector, summary strip, service history,
  assets, maintenance and audit trail.
- **Reports.** Filter bar, summary tiles, chart plus table, metric
  definitions and CSV export.
- **Notifications, Workflow Guide and administration.** Role-appropriate
  notification lists, the Appendix C swimlanes with the current role's lane
  emphasized, and the administration screens for the System Administrator.
- **States.** Empty, loading and not-available screens use the existing
  outline icon set and formal copy. No emoji, no slang, no exclamation
  marks.
- **Pagination.** Every list and table that can grow uses `UI.paginate`
  with `UI.renderPagination`: 12 to 18 rows per page, first and last page
  buttons, a range label and the total, and the control only appears when
  there is more than one page. It covers the dashboard queues, service
  records, users, offices, reference data, the register tabs, reports,
  review, confirmation and notifications. The register audit tab now pages
  instead of stopping at 60 entries.

## 5. Themes and responsive behaviour

- Light and dark both use the existing tokens in `app.css`, `green.css` and
  `kit.css`. `console.css` adds no brand colour; it uses the existing
  tokens plus white and black alpha overlays for the dark sidebar, matching
  the existing shell.
- The theme picker offers Light, Dark and System. Dark mode was exercised on
  the dashboards, ticket detail and maintenance screens.
- Authenticated app pages resolve System to light because the frozen
  `js/theme.js` applies the pre-paint default before the page styles load.
  The login page keeps its own frozen System behavior. This is documented
  rather than changed, because `js/theme.js` is a frozen surface.
- Layout tiers: phone up to 599 px, tablet 600 to 1023 px, desktop 1024 px
  and up, with the two-column content grid engaging at 1280 px.
  `tools/responsive.py` exercises 73 pages at 37 viewports from 320x480 to
  7680x2160, including three 200 percent zoom viewports (640x360, 683x384
  and 960x540), and reports 0 problems, including 0 sub-36 px tap targets.
  The frozen login is measured with a bounded scroll allowance, recorded in
  `KNOWN_LIMITATIONS.md`.
- Breadcrumbs live in the top bar only and are hidden below 600 px; bulk
  selection hides on phones, and bottom tab labels are set to a single line
  at 10.5 px. Status links in the dashboard strip are at least 36 px tall.

## 6. Visual evidence

`docs/screenshots/` holds 124 captures:

- **64 base captures**: 60 from `python tools/gate_shots.py` (10 screens at
  390, 768 and 1440 px in light and dark), plus four card-view captures at
  1440 and 390 in both themes.
- **48 role captures**: dashboard and ticket detail for requester,
  technician, coordinator and management, at the same three widths and both
  themes, taken from the role-prefixed pages.
- **12 feature captures**: the ticket board, the maintenance planner and the
  dashboard widgets at 1440 and 390 in both themes.

The machine gate checks every base capture for horizontal overflow and
clipped text. The base captures, the 48 role captures, the feature captures,
and the phone and dark variants were read during this pass. A full individual
review of all 124 images by a designer has not been recorded, and
`docs/KNOWN_LIMITATIONS.md` says so.

## 7. Verification

Results from this working tree. Commands are listed with their outcome.

| Check | Command | Result |
|---|---|---|
| Backend suite | `python server/tests.py` | 382 passed, 0 failed |
| Workflow smoke | `node tools/smoke.js` | 60 passed, 0 failed |
| Page integration | `node tools/pagetest.js` | 555 passed, 0 failed |
| Role page suite | `node tools/rolepages_test.js` | 182 passed, 0 failed |
| API integration | `python tools/api_check.py` | 17 passed, 0 failed |
| Markup and DOM ids | `python tools/validate.py` | PASSED |
| UI house rules | `python tools/ui_check.py` | PASSED, 73 pages |
| JavaScript syntax | `python tools/js_syntax_check.py` | PASS, 24 files and 193 inline blocks |
| Role page generation | `python tools/role_pages.py --check` | PASS, 50 files |
| Permission parity | `python tools/permission_parity_check.py` | PASS |
| Appendix C coverage | `python tools/appendix_c_check.py` | PASS, 81 nodes and 106 edges |
| Em dash sweep | `python tools/em_dash_check.py` | 0 across 0 files |
| Responsive audit | `python tools/responsive.py` | 0 problems across 2701 checks (73 pages x 37 viewports) |
| Visual gate | `python tools/gate_shots.py` | 60 captures, no overflow, no clipped text |

Login and theme integrity were checked separately:

```
sha256sum login.html css/login.css js/login.js js/theme.js img/up-seal.png img/upc-seal.png
```

`login.html`, `css/login.css`, `js/login.js` and `js/theme.js` differ from
`docs/login-baseline.sha256`. The sign-in page carries the owner-approved
always-on demo list (Phase 19) in `login.html` and `js/login.js`, and
`js/theme.js` gained the row density preference (item 10). `css/login.css`
now also carries an uncommitted visual change that appeared at 14:32 during
concurrent work in this tree; no login file was edited by this pass. The two
seal images still match the baseline. `css/app.css`, `css/green.css` and
`css/kit.css` have no diff in the working tree.

## 8. Deviations and limitations

These are deliberate and are not hidden in the summary table above.

- **The requester now has a read-only Maintenance Visits page.** It is
  `visits.html`, granted to the requester in `permissions.json` and rendered
  with `or-visits.html`. It lists the visits and plans for the requester's own
  office only, and it changes no record. The requester also still sees
  upcoming visits on the dashboard and answers availability on
  `confirm.html`.
- **Schedule editing is coordinator-only in the backend.**
  `create_schedule`, `update_schedule` and `set_schedule_active` are granted
  to the IT Coordinator in the permission map. The management view still
  shows the Manage column because the shared `coord-only` rule hides it only
  for the office roles; the backend refuses an administrator edit, so the
  visible control does not grant a permission.
- **System resolves to light on authenticated app pages.** This follows
  from the frozen `js/theme.js`; the pass did not edit a shared, frozen
  file to change it.
- **The demo account chooser is development-only.** It appears only when
  the explicit demo flag is on, never in a network-facing deployment. The
  demo role shortcut on the sign-in page was used for the role captures.
- **The visual review is not a full design review.** The machine gate
  passed and the key screens were read, but not all 108 images were
  individually reviewed.
- **The page suite is sensitive to a second writer.** Two suites running
  against the same tree at the same time can produce false failures. This is
  a harness limitation noted in `docs/KNOWN_LIMITATIONS.md`.

## 9. No em dashes, no invented identity

All new UI copy, comments and documentation use plain punctuation; the em
dash sweep reports zero. The pass introduces no logo, seal, slogan or motto.
It reuses only `img/up-seal.png` and `img/upc-seal.png`, which already
existed, and the existing typography.
