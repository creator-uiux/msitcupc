# ITC Maintenance System

A zero-build website derived from **Maintenance System.pdf**
("Office IT Service Request, Maintenance, and Closure Workflow" + 29-step SOP):
plain HTML/CSS/JS pages plus an optional zero-dependency Python backend.
Everything lives in this folder  --  nothing here touches `sysaditc-main`.

## Run it

```bash
python server/app.py            # then open http://127.0.0.1:8787/
```

The backend serves the whole site on one origin and every page is **live against
it**  --  sign-in, the dataset and every action round-trip through `server/app.py`,
and RBAC is enforced server-side. On Windows, double-click `start.bat` in the
project root. (The QA and capture tools in `tools/` serve the files statically
for deterministic frames; there they use the bundled seed dataset.)

## Deploy it

The repository root is the served tree. `server/app.py` serves the pages and
the API on one origin, and there is no build step and no `public/` assembly in
V5.

For a static host, publish only the site files at the root: the pages, `css/`,
`js/`, `img/`, `icons/`, `manifest.webmanifest`, `sw.js` and `offline.html`.
Do not publish `server/`, `tools/` or `docs/`. Host the backend separately if
you want live data; when the API is absent, `js/api.js` falls back to the
browser engine, so the pages still work, and when it is present the same pages
switch to the live service on their own.

**The cache policy.** The site files are not renamed when they change, so a
long cache on them would leave a returning visitor on the old build for a
year. Only the images, the icons and the fonts are cached for a year; the
pages, the stylesheets and the scripts revalidate every time, and the service
worker precaches the whole shell (`sw.js`) under a version that is bumped when
the shell changes, so a release reaches the phones that installed it.

## Pages

| File | Screen | SOP coverage |
|---|---|---|
| `index.html` | Gallery / preview |  --  |
| `login.html` | **UPMail sign-in**: real Google Identity Services when the backend has a client id; the development account chooser appears only when the explicit demo flag is on |  --  |
| `roles.html` | **Roles & Access**: the four roles, what each can do, full feature matrix | 28, 28.1, 28.2 |
| `dashboard.html` | Role-focused summary: four role tiles, the eight status labels as links, quick actions, the active ticket queue, maintenance due, audit feed, on-hold pointers | steps 2–8, 26, 28 |
| `ticket.html` | **Read-only service record**: status & audit history, impact/urgency, dependency hold, diagnosis/parts/costs, testing, confirmation  --  with links into the section screens | steps 3–18 |
| `request.html` | Office requester submits a service request (all 4 intake channels), replies to *Needs information*, withdraws an active request | steps 1–2 |
| `review.html` | **IT Coordinator review & assign**: request missing details, assess, prioritise, assign, monitor dependency holds | steps 3–8, 10 |
| `technician.html` | IT Technician workbench: assigned queue, service-schedule coordination, diagnosis, repair actions, test pass/failed, dependencies, checklist execution | steps 6, 9–14, 23–24 |
| `tickets.html` | **Service Ticket register**: server-side filter / sort / page across every record the signed-in role may see, bulk assign, CSV export, responsive card layout on phones | steps 2–8, 29 |
| `ticket.html` | **Service record**: status & merged conversation/audit history, reply composer (office reply vs internal note), attachments, impact/urgency, dependency hold, diagnosis/parts/costs, testing, confirmation  --  with links into the section screens | steps 3–18 |
| `register.html` | **Central Office IT Service Register**: one audit-proof list of every corrective ticket *and* preventive job across all offices | step 29, 28.2 |
| `maintenance.html` | Maintenance schedule + generated job + checklist + next due date; schedule edit / pause for management & coordinator | steps 19–26 |
| `confirm.html` | **Confirmation & closure**: office availability / agreed dates, office accepts/rejects, reminders, authorized closure, recurrence, maintenance-visit confirmation | steps 9, 15–18, 27 |
| `reports.html` | Office IT Service Reports with filters, metrics, the SLA/overdue definition and an **eight-report catalogue** with per-report CSV export | step 29, 28.1 |
| `notifications.html` | **Notification centre**: the full role-addressed inbox (the bell popover is the two-line preview), per-user read state, mark-all-read | SOP notify steps 6, 7, 14.2 |
| `audit.html` | **Audit log**: tamper-evident "who did what, when" history with actor/subject/event filters and CSV export | 26, 28 |
| `users.html` | **Accounts** (System Administrator): create / edit people, set role, office and active state; rename cascades to every record | 28, 28.1 |
| `offices.html` | **Offices** (System Administrator): office records, codes, contacts, active state; renaming cascades everywhere | 28.2 |
| `assets.html` | **Assets** (System Administrator): the unit register  --  number, name, category, holding office, location, retire or restore; intake offers these numbers as suggestions | D43 |
| `settings.html` | **Settings & reference data** (System Administrator): categories, priorities, sources, maintenance frequencies, reminder interval |  --  |
| `profile.html` | **My profile**: contact details, password change, appearance / session preferences |  --  |
| `flow.html` | Swimlane flowchart rebuilt from the PDF: 81 nodes in four lanes (one legend artifact excluded) and 106 connectors, with every Yes/No branch and a node-by-node coverage proof | all steps (reference) |

## Role URLs

Every screen also exists as a **real, role-named page** so the address bar says
which role's workspace you are standing in:

| URL | Role |
|---|---|
| `or-dashboard.html`, `or-ticket.html`, … | Office Requester |
| `itc-dashboard.html`, `itc-technician.html`, … | IT Technician |
| `ic-dashboard.html`, `ic-review.html`, … | IT Coordinator |
| `mgmt-users.html`, `mgmt-offices.html`, … | System Administrator |

These are generated  --  one file per legal page × role  --  by
`python tools/role_pages.py` from the `ACCESS` map in `js/ui.js`, so a route
only exists when the app actually allows that role on that screen (there is no
`or-review.html`, because a requester has no Review & Assign).

**The prefix names the role; it never grants access.** Opening a page whose
prefix disagrees with the signed-in role redirects to your own equivalent page
(e.g. a requester opening `itc-dashboard.html` lands on `or-dashboard.html`).

A **signed-out** visitor is *not* bounced to login: the page renders that URL's
role as a signed-out preview, so a role URL can be shared, bookmarked, or
imported cold by a design tool (Codia, html.to.design) and still produce the
right screen. The "Sign in" affordances carry `?next=<page>` so signing in
returns you to the page you were on.

The bare pages (`dashboard.html`…) keep working for bookmarks and the frozen
design snapshots; the sidebar simply links to the role-named ones.

## Sign-in & roles

Authentication is **UPMail Google Workspace only**, restricted to
`@upcebu.edu.ph`, with no local passwords. When the backend runs with a Google
client id, `login.html` performs real Google Identity Services sign-in and the
server verifies the `id_token`. The four demo accounts are always listed on the
sign-in page, labelled "Demo only", so the same build can be previewed on any
localhost port, a static copy or Firebase Hosting. On a server whose demo gate
is closed, a demo account opens a browser-only session backed by the bundled
seed; the server still refuses demo credentials. Either way the chosen account
scopes the whole workspace to that role, and an account with no provisioned
role sees **Access not granted**:

| Role | Person | Can primarily |
|---|---|---|
| **Office Requester** | A. Delos Reyes · Records Office | submit / follow up requests, reply to *Needs information*, confirm office availability &amp; results |
| **IT Technician** | J. Tan · IT Office | coordinate the service schedule, diagnosis, repair actions, dependency holds, testing, maintenance checklists |
| **IT Coordinator** | K. Ramos · IT Office | review, assess, assign, coordinate the schedule, monitor, close; roles reference |
| **System Administrator** | M. Reyes · IT Office | every read-only dashboard, schedule and report, **plus** the administrative screens: accounts, offices, reference data and the audit log. Stays read-only on the operational ticket/job workflow |

The role model, screen-access map and the whole capability matrix live in
**one place**  --  `js/ui.js` (`ROLES`, `ACCESS`, `CAPS`)  --  and mirror the workflow
guards in `js/flow.js`. The signed-in account sets the active role; it re-scopes
the navigation, the visible action buttons and the page guard live. A sidebar
group with nothing to show is omitted entirely. Opening a screen your role does
not own shows a friendly *“not part of your role”* panel instead of dead
actions. Every role can read `roles.html`.

## Responsive tiers

One layout system, three layout tiers, all tested:

- **Desktop** → **≥ 1024 px** (targets: 1440 × 900, 1024 × 768)  --  persistent grouped sidebar, wide tables and grids. The two-column *main + side* canvas engages at **≥ 1280 px**; from 1024–1279 px the content stacks to one full-width column so the wide ticket/report tables never spill into the adjacent column.
- **Tablet** → **600–1023 px** (target: 768 × 1024)  --  collapsible navigation, compact grids
- **Mobile** → **≤ 599 px** (targets: 390 × 844, 360 × 800)  --  bottom navigation, stacked cards

At **≤ 480 px** real touch targets are enforced: table checkboxes, `.t-id`
record links, chip links and the reply-visibility switch all get a ≥ 36 px
hit area (desktop density is deliberately unchanged).

## Getting PNGs for design review

**Automated (recommended):**

```
python tools/shots.py            # all 20 pages x 6 viewports -> shots/
python tools/shots.py --both     # canvas frames + full-page frames
python tools/shots.py --only dashboard.html reports.html
python tools/shots.py --viewports desktop mobile
```

Every capture loads the page with `?demo=1`, which rebuilds the canonical seed,
freezes the clock and disables the random intake simulation  --  so the PNGs are
**deterministic** (identical on every run) and ready to import as design frames
at 1x scale. Output goes to `shots/` plus a `shots/index.html` review gallery.

- **Canvas frames** (`<page>--<view>.png`) are exactly the design canvas
  (1440×900, 1024×768, 768×1024, 390×844, 360×800).
- **Full-page frames** (`<page>--<view>-full.png`, with `--both`) capture the
  whole scroll height for long pages.

**Manual alternative:** open a page in Chrome → DevTools (F12) → Device Toolbar
(Ctrl+Shift+M). Pick **Desktop 1440 × 900**, screenshot (Ctrl+Shift+P → "Capture
screenshot"); switch to **iPhone 14/15 (390 × 844)** and capture again.

Open `index.html` to preview every page live at both widths.

## Status vocabulary (from the PDF)

Submitted → Needs Information → Assigned → In Progress ⇄ On Hold → Resolved → Closed,
plus Cancelled. *Resolved* means technician testing **passed**; Cancelled records stay
separate from completed totals and are preserved with audit history.

## Styling

Four stylesheets on authenticated pages, no framework, no build step. The
sign-in page loads the first three plus `css/login.css` and is frozen:

| File | Role |
|---|---|
| `css/app.css` | the structure: the shell, the components, the responsive tiers |
| `css/green.css` | the token layer: the green palette, the radii, the shadows, the type scale |
| `css/kit.css` | the shared kit: the page composition, the utilities, the parity rules |
| `css/console.css` | the Phase 11 shell: grouped sidebar, slim top bar, role-focused dashboards, pagination and role visibility rules |

`css/kit.css` is the single place where "how a screen is put together" is
decided, so every page and every role page looks the same. The house rule is
**no inline styles in the markup**: a page that needs a new arrangement takes a
class from the kit. The only inline values left are the ones computed at run
time (a bar width, a row index, a role accent colour), and those are CSS custom
properties. `python tools/ui_check.py` proves the rule on every page.
See `docs/DESIGN_SYSTEM.md`.

A closing *layout-alignment pass* keeps every grid to a consistent column count
so no row is ever left half-empty: KPI cards are 2-up on phones / 4-up from
768 px, role cards are 1 / 2 / 4-up, filter and key-value rows flex-grow to stay
flush to both edges, tables scroll inside their card instead of overlapping a
neighbouring column, and forms use a plain 2-column grid so `.span-2` fields
fill a whole row.

## Interactive states

- **Notification bell**  --  click to open the dropdown (top bar on desktop, app bar on mobile). Covers SOP notify steps (6, 7, 14.2).
- **Coordinate schedule modal**  --  on `technician.html` (IT Technician lane) and `review.html` (coordinator), click *Coordinate service schedule* (SOP 10).
- **Record repair / actions performed**  --  on `technician.html`, a distinct step from *Record diagnosis* (SOP 13→14): parts, costs, labour, dates and evidence.
- **Office availability**  --  on `confirm.html`, the office requester confirms *Office available* or proposes a new date; the coordinator may do the same on any office's behalf (SOP 9).
- **Test pass/failed**  --  segmented control states on `technician.html` + failure note on `ticket.html` (SOP 14.1–14.2).
- **Confirmation Accepted / Rejected / No response**  --  segmented states on `ticket.html` and `maintenance.html` (SOP 15).

## Tests

Zero-config checkers under `tools/` (plus the backend suite):

| Command | What it proves |
|---|---|
| `python tools/ui_check.py` | **the UI house rules** on all 73 pages: the four authenticated stylesheets (three plus `login.css` on the sign-in page) load in order, no inline style survives, the shell placeholders and the page head are always there, every class used in the markup is defined in the stylesheets, and no page carries its own `<style>` block |
| `python tools/validate.py` | HTML well-formedness, duplicate ids, `label for` → id, dead internal links, `getElementById` targets exist |
| `node tools/smoke.js` | **76 workflow assertions**  --  the whole SOP engine (`store/ui/flow/live`) in a VM: every branch of the flowchart |
| `node tools/pagetest.js` | **700 page assertions**  --  serves the pages and drives every screen in jsdom: forms, modals, sign-in, page guard, role-lane separation, filters, schedule check, plus a load+sentinel check for every Phase-C screen in each role and a reply-composer regression guard; fails on any console/window error |
| `node tools/rolepages_test.js` | **182 role-URL assertions**  --  every legal role page exists, no forbidden combo does, each page pins its own role and prefixes its nav links, a **sessionless** load renders the URL's role (never login  --  the import/share path), a signed-in wrong-role URL redirects, bare pages still work, role visibility classes are hidden or shown as the permission map says, and a forbidden URL shows the neutral panel |
| `python tools/responsive.py` | **responsive checks** (73 pages × 37 viewports, 320x480 to 7680x2160, plus 200 percent zoom at 640x360, 683x384 and 960x540)  --  drives headless Chrome over the DevTools Protocol and flags horizontal overflow, elements past the viewport, clipped text and sub-36 px tap targets (content inside an intentional horizontal scroller is exempt) |
| `python server/tests.py` | **457 backend assertions**  --  engine, RBAC, requester office-tenancy, technician data scope, Google OIDC verification, notification delivery, SQLite persistence, HTTP API, SSE, seed shape, site serving |
| `python tools/api_check.py` | **17 end-to-end assertions**  --  real Chrome loads the site served by the backend and verifies the UI talks to it (live by default) |
| `python tools/permission_parity_check.py` | the permission map, the backend guards and the frontend mirror never drift apart |
| `python tools/appendix_c_check.py` | every node and edge of the Appendix C workflow data is present in the Workflow Guide |
| `python tools/print_check.py` | the printed copy: drives Chrome under the print media and proves the letterhead and body of a record and of a report are on paper while the sidebar, toolbars, filters and every button are not (2 pages) |
| `python tools/session_check.py` | session expiry in a real browser: a live register, a session dropped by the server, the landing on the sign-in screen naming the page to return to, the demo sign-in back to the reports page, and a static copy still running offline (11 checks) |

`pagetest.js` needs `jsdom`. If it isn't installed locally it falls back to
`%TEMP%\opencode\node_modules`, so install it once with:

```
npm install jsdom --prefix "%TEMP%\opencode"
```

`responsive.py` and `api_check.py` drive the local Chrome install over the
DevTools Protocol (no extra packages); `responsive.py` sizes each viewport with
device emulation so it measures the real layout deterministically.

All suites should end with `PASSED` / `0 failed` / `0 problems`.

## Documentation

| File | What it holds |
|---|---|
| `docs/DECISIONS.md` | every decision the PDF left open, the default that ships and how to change it |
| `docs/DATA_MODEL.md` | the entities, the fields, the relationships, the indexes and the integrity rules |
| `docs/OPERATIONS.md` | every backend operation, the roles that may call it and what it writes |
| `docs/ROLE_MATRIX.md` | the permission map: pages, actions, transitions and the data scope per role |
| `docs/REPORT_DEFINITIONS.md` | one definition per metric, used by every screen and every report |
| `docs/IMPLEMENTATION_CHECKLIST.md` | the live progress against the specification |
| `docs/TRACEABILITY.md` | the requirement to code to test map, with verified and unverified separated |
| `docs/KNOWN_LIMITATIONS.md` | what this system does not do, and what could not be checked |
| `docs/ASSUMPTIONS.md` | the smaller implementation assumptions, all configurable |
| `docs/DESIGN_SYSTEM.md` | the tokens for both themes, the components, the page patterns and the PWA rules |
| `docs/screenshots/` | the visual quality gate captures, light and dark at 390, 768 and 1440 px |
| `server/README.md`, `BACKEND.md` | the backend, the API and the deployment notes |

## Backend (implemented)

`server/` is a **zero-dependency Python 3 service** (standard library + SQLite)
that ports the prototype's workflow engine, adds RBAC, background workers and
Server-Sent Events, and serves the whole site on the same origin:

```
python server/app.py                 # serves http://127.0.0.1:8787/
python server/app.py --open          # ...and opens your browser
python server/tests.py               # 457 assertions
```

Open `http://127.0.0.1:8787/` and every page is live. `js/api.js` wires the
untouched UI to the backend: it authenticates the current role, adopts the server
dataset, proxies every `Flow.*` / `Maint.*` action to `POST /api/call` so **RBAC
is enforced server-side**, pushes direct edits to `POST /api/state`, and follows
the SSE stream. See `server/README.md` and `BACKEND.md`.

Requester sessions are additionally scoped to their own office (SOP 28.2), every
notification is recorded in an auditable outbox (plus e-mail/SMS when
configured), and Google Workspace sign-in can be turned on with a client id  -- 
see `server/README.md`.

## Deterministic export mode

Append `?demo=1` to any page to load the canonical seed with a **frozen clock**
and the random live-intake simulation disabled (see `js/store.js`). This is what
`tools/shots.py` and `tools/responsive.py` use so screenshots and audits are
byte-for-byte reproducible. Normal browsing (no query string) is unaffected  -- 
data still persists to `localStorage` and syncs across tabs.

## Design exports

The checked-in visual evidence is `docs/screenshots/`, 108 captures: 60 base
screens at 390, 768 and 1440 px in both themes, plus 48 role captures of the
dashboard and ticket detail for each role at the same widths and themes. The
base set is produced by `python tools/gate_shots.py`. For a larger export,
`python tools/shots.py` renders 20 pages at six viewports into the generated
`shots/` directory, and `shots/index.html` is the review gallery.

