# Known limitations

Honest list of what this system does not do, or does only partly, at the
current commit. Blocked or unverified items are listed first.

## Source limitations

- **The PDF was read as text, and its diagram as vector data.** The bundled
  `docs/source/Maintenance_System.pdf` was opened and its text extracted; the
  29 step SOP matches Appendix A verbatim and the owner is Anthony Derecho.
  The lane ownership, the decision diamonds and the connectors in Appendix B
  were produced by rendering the page and reading its vector data. Two
  connectors are drawn without arrowheads and one label has no line at all;
  they are listed in Appendix B.6 and were implemented from the label text
  and the SOP numbering.
- **The PDF is not dated consistently.** The title block reads "Last Updated
  January 30, 2021" while the file metadata says it was generated September
  30, 2026. This does not affect the process.
- **The PDF is stored twice.** The specification names
  `docs/source/Maintenance_System.pdf`, which exists; a copy also sits at the
  repository root as `Maintenance System.pdf`. The diagrams and the SOP were
  read from the same one page PDF.
- **The reference screenshots arrived in two batches.** `docs/reference/`
  holds `UPLoginUI.PNG` and `login-bg.jpg`, and both were used for the sign-in
  screen. The ticket list, ticket detail and dashboard images arrived later,
  as `ticket-list.png.png`, `ticket-details.png.png` and `dashboard.png.png`,
  after those screens had been built from the written requirements in Section
  14. They are kept as a comparison reference; the screens follow the written
  requirements and the design system, not a copy of those pictures.
- **The Figma kit page was fetched and read.** The kit page at
  `https://itcmaintenancesystem.web.app/figma-kit/everything.html` returned
  the screen inventory and the intended look, and it matches what this
  repository implements. It was used as a screen and component reference
  only; no component was copied from it, and the styling follows the design
  system in `docs/DESIGN_SYSTEM.md`.
- **The visual review was a machine check plus a read of the captures.** The
  124 captures in `docs/screenshots/` were produced with headless Chrome;
  the 64 base captures were checked for horizontal overflow and clipped
  text, and the login, ticket, dashboard, role, board, planner, widget,
  mobile and dark captures were read individually. Not every one of the 124
  was read by a designer, so this is not a full design review.

## Platform constraints

- **Firebase is not in use.** The project is a zero build HTML, CSS and
  JavaScript front end with a zero dependency Python and SQLite backend. The
  specification's "reuse Firebase" rule therefore does not apply, and the
  equivalent guarantees are enforced on the trusted backend instead:
  transitions, role checks, office tenancy, validation and append only audit
  all live in `server/engine.py` and `server/app.py`.
- **The world clock is advanced by an in-process worker, not by a cloud
  scheduler.** `server/workers.py` runs one daemon thread that ticks on a fixed
  interval (`--interval`, default 9 seconds, `--no-worker` to disable), which is
  what advances schedule checks, confirmation reminders, dependency follow-ups
  and rescheduled visits. `POST /api/tick` does the same thing on demand and is
  restricted to the IT Coordinator and System Administrator. The consequence is
  that the clock only moves while the server process is running: there is no
  external cron, and a restart with no traffic resumes the tick rather than
  replaying the missed ones.
- **Email and SMS delivery are configured, not proven.** `server/delivery.py`
  routes notifications over the channels named in `ITC_NOTIFY_CHANNELS`: the
  always-on outbox, console, SMTP (`ITC_SMTP_*`) and a generic JSON webhook for
  SMS (`ITC_SMS_*`). In-app notifications are the working default. No
  credentials ship with this repository and no live SMTP or SMS send has been
  tested from here, so the channels are unverified rather than broken.
- **Push notifications are not wired.** The in-app notification centre is
  complete; a push service integration is the boundary to add.
- **The web font is fetched from a CDN.** `css/app.css` imports Sora and
  Inter from Google Fonts. The project also carries the full system font
  fallback stack, so nothing breaks when the CDN is unreachable, but the
  intended typeface is only present when the CDN answers. The test suites
  answer that request locally so they stay offline and deterministic.
- **SQLite is a single machine store.** The server is a stdlib threaded HTTP
  server over one SQLite file. It is right for one office deployment and is
  not a clustered or multi-tenant database.

## Deliberately out of scope

- No holiday calendar. Business day maths treats Monday to Friday as working
  days and ignores public holidays (assumption A5).
- No virus scanning on attachments. Files are size limited, type limited and
  stored outside the web root; they are not scanned.
- No password sign-in. Production uses UPMail Google sign-in restricted to
  `@upcebu.edu.ph`; the demo account list on the sign-in page is always
  available and labelled "Demo only".
- **One navigation column, not a rail plus a contextual menu.** Section 25.5B
  suggests a narrow rail with a collapsible contextual menu between 1024 and
  1919 px. The owner asked for the double navigation to be removed, so the
  single grouped sidebar is kept at every width and the side menu never
  reopens next to it. Below 1024 px the same sidebar becomes an off canvas
  drawer opened from the mobile app bar.

## Partial

- **Two execution modes ship in one codebase**: live mode against the Python
  and SQLite backend, and an offline demo mode in the browser. The offline
  demo stores state in the browser and is not the production database.
- **Seed data is demo data.** It is marked as such, but it has the same shape
  as live records.
- **The asset register records a unit, not its whole life.** Administration
  keeps the number, the name, the category, the office that holds it, its
  location and whether it is in service or retired
  (`assets.html`, `docs/DECISIONS.md` D43). It does not hold a purchase date, a
  cost, a warranty or a serial number, and retiring a unit does not close the
  tickets that name it. A ticket and a schedule still carry the number as free
  text, and intake offers the register as suggestions rather than as a
  constraint, so a unit that was never registered remains writable.
- **The offline demo keeps only the name of an attachment.** The bytes live
  with the server, so in the browser-only demo the attachment list shows the
  name and the details and the viewer says that the file itself is not kept
  here. The intake form records the names of the files it was given for the
  same reason: it does not upload the bytes.
- **The requester's Maintenance Visits page is read-only and office-scoped.**
  `visits.html` is granted to the requester and lists the visits and plans for
  the requester's own office only. It cannot edit, reschedule or confirm a
  visit; those actions stay on `confirm.html` and in the coordinator lane.
- **Schedule controls belong to the coordinator.** `create_schedule`,
  `update_schedule` and `set_schedule_active` name the coordinator alone, and
  under role scope 5 the administrator lane does not reach the maintenance
  screen at all, so it is offered no schedule control. Only the lane that
  plans the work can change a plan.
- **The sign-in page still reads "Continue to dashboard" for the
  administrator.** `js/login.js` is a frozen surface, so its copy was not
  touched. `landing()` asks for `dashboard.html` and `UI.urlFor` resolves a
  page outside the lane to that lane's own home, so the administrator signs in
  on the users directory while the link text still says dashboard. Fixing the
  label needs an explicit owner request to unfreeze the sign-in page
  (`docs/DECISIONS.md` D23).
- **System resolves to light on authenticated app pages.** The frozen
  `js/theme.js` applies the pre-paint default before the page styles load.
  Dark mode and an explicit Light choice work; changing the System result
  would require editing a frozen shared file.
- **Role visibility is a presentation layer.** A control the lane cannot use is
  left out of the rendered markup rather than grayed out, and the generated
  role page for a page outside the lane does not exist. The hiding is still not
  the security boundary: the permission map, the scoped snapshot and the
  backend guards are, and the parity checks prove the browser mirror agrees
  with them.
- **The demo account list is on the sign-in page everywhere.** It is labelled
  "Demo only" and does not depend on the host, the port or a server flag, so
  it is visible on a different localhost port, a static copy and Firebase
  Hosting. On a live server whose demo gate is closed, choosing an account
  takes a browser-only demo session backed by `js/store.js`; API calls still
  require a real server token, so the list never widens server access.
- **The page test suite is flaky while another process edits the same tree.**
  The suite takes a free port, serves through a threaded server and answers
  the external font request locally, so it is stable on a quiet tree. When a
  second writer is active, or when two copies of the suite run at the same
  time, the browser can receive a partially written script and the suite
  reports failures that are not real. This is a harness limitation, not an
  application defect.
- **The responsive sweep can outlive a single browser session.** On Windows
  the headless browser occasionally closes its debugging socket after a few
  hundred navigations. `tools/responsive.py` detects the drop, starts a fresh
  browser and retries the page it was measuring, so the full matrix still
  completes; the run output reports how many times that happened.
- **The requester cannot cancel directly.** The office may request a
  withdrawal, and the IT Coordinator records the cancellation reason, because
  the PDF places that step in the coordinator lane. A requester therefore
  cannot end a ticket in one step.
- **The printed copy is measured on two pages.** `tools/print_check.py` asks
  Chrome for the print media on `ticket.html` and `reports.html` and fails if a
  screen control survives or the letterhead stays hidden. Every other page
  benefits from the same `@media print` rules, but only those two are measured,
  and the measurement is of the demo dataset.
- **The feature registry gates one behaviour, not only its control.** With
  `demoIntakeSimulation` off, the offline world clock creates no simulated
  intake at all, so a browser-only demonstration shows a register that changes
  only when the demo acts on it. Turning the flag on restores the invented
  traffic; the live server never simulates.
- **The permission map is regenerated, not edited.** `permissions.json` is
  the source of truth; `js/permissions.js` is generated from it and
  `tools/permission_parity_check.py` fails if the copies drift. Adding an
  action means adding it to the engine and rebuilding, not editing the
  mirror by hand.
- **Installability was checked by the manifest and the service worker**, by
  loading the pages over HTTP with the worker registered; it was not verified
  by a real install on a phone's home screen.
- **The sign-in screen scrolls vertically on short viewports.** The demo
  account list is always part of the page, so at 360x640 the page needs
  1017 px (377 px over), at 320x480 it needs 816 px (336 px over), in a
  844x390 phone landscape it needs 735 px (345 px over), and at 200 percent
  zoom it needs 788 px at 640x360 (428 px over) and 404 px over at 683x384.
  `tools/responsive.py` records the overshoot in `FROZEN_SCREEN_SCROLL` and
  accepts it up to a bound of 460 px; the rest of the app fits every audited
  viewport from 320 to 7680 px wide without page overflow.
- **The Workflow Guide and Roles and Access are routable but not listed.**
  Both pages remain at `flow.html` and `roles.html` under the unchanged
  permission map, so a direct link still opens them, but the sidebar, the top
  bar and the mobile More sheet no longer offer either page.
- **The demo flag gates server credentials, not the account list.** The
  account list is always on the page. When the server demo gate is off, the
  demo usernames are refused by `server/app.py`; the browser-only demo still
  runs from `js/store.js` when the API refuses or is absent, which is why the
  live server is the supported path for real data. A refused session is not
  one of those cases: when a server answers that the token has expired, the
  browser clears it and returns to `login.html?next=` the page in hand instead
  of carrying on against the bundled seed dataset.
- **A state merge that the server refuses is reported, and the screen reloads
  the stored dataset.** `js/api.js` names the reason and re-pulls, because a
  page still holding the rejected edits would go on offering changes that do
  not exist. The pending record edit is not kept for a retry, so a rejection
  costs the last change and not the whole draft.
- **The concurrency check is a smoke test, not a reproduction.**
  `test_http_concurrency` in `server/tests.py` runs four readers and two
  tickers over six threads against one server for 130 requests and asserts
  that every request succeeds and that the tickets and audit rows in memory
  match the rows in the database. The torn commit it guards against was never
  observed before the lock was added, so the test proves the guard holds under
  load, not that the old code failed. `tools/session_check.py` proves the expired-session path
  end to end in a real browser: a live register, a dropped session row, the
  landing on the sign-in screen with the page to return to, the demo sign-in
  back to the reports page, and a static copy still running offline.
- **A UTF-16 text file without a byte order mark is still refused.** The D21
  byte check in `server/app.py` rejects a NUL byte, because a Windows
  executable is full of them, so an Excel tab-delimited export saved as
  UTF-16 without the leading BOM cannot be told from a binary. The accepted
  forms are UTF-8 text and UTF-16 with a `FF FE` or `FE FF` mark, which the
  writer that produced the sample emits.
- **The idle clock moves about once a minute, not once per request.**
  `server/auth.py` refreshes `last_seen` only after `SESSION_TOUCH_SECONDS`
  (60 seconds), so a session that has been idle for 30 minutes can live up to
  31 minutes, and a screen left open with no request in flight expires on the
  next call rather than at the moment the deadline passes. The bound is the
  30 minutes of decision D22, and the 24 hour absolute age is checked on every
  request.
- **A half-applied action rolls back, and the reason stays in the log.** The
  guard in `server/app.py` reloads the stored dataset when an engine call
  raises and answers "The server could not complete that action", and the
  worker does the same after a failed tick. The reply names the exception
  type, not the cause, so the traceback is written to the server log and an
  operator has to read it there.

## Resolved during this work

- The sign-in photograph was hidden in dark mode by a global `body::before`
  rule; `css/login.css` now declares the photograph explicitly in both
  themes.
- The sign-in headline wrapped to three lines at 390px and 320px; the phone
  type step and the compact breakpoint were retuned, and it holds two lines
  up from 320px.
- The requester could see internal cost, labour and audit data; the trusted
  layer now strips cost, labour and the audit list from the office snapshot,
  and the pages, the feed and the CSV export redact peso amounts.
- The server accepted video attachments and a 25 MB limit; the policy is now
  the specified jpg, png, webp, pdf, docx, xlsx, csv and txt, 10 MB per file
  and 10 files per record, and a test proves video is refused.
- The default Google sign-in domain was unrestricted; it now defaults to
  `upcebu.edu.ph` and a test asserts it.
- A broken textarea attribute in the ticket reply composer was fixed, and the
  role pages regenerated.
- Missing `for` attributes on the profile form and the technician outcome
  select were fixed.
- The static audit tools (`deep_audit.js`, `script_order_check.js`,
  `content_check.js`) pointed at a `public/` directory that V5 does not build;
  they now audit the repository root.
- Internal notes are redacted server side in `_scoped`; worker audits are
  attributed to `System` rather than to whichever human role called last.
- `POST /api/state` is hardened: status changes refused, history and comments
  must be exact append only supersets, the client audit list is ignored, and
  the protected workflow fields always come from the server.
- Technician reassignment, idempotent intake and the impact by urgency matrix
  are implemented.
- The preventive job status uses the eight canonical labels with a separate
  outcome field.
- Reports 3, 4 and 8 use their own definitions rather than falling back to
  source counts.
- Every em dash is gone from the tree (`tools/em_dash_check.py`).
- The Workflow Guide is built from the Appendix C data, so all 81 nodes and
  106 connectors are present with the PDF lane names, the user's lane is
  highlighted, and the coverage is machine checked.
- The eight status labels, the transition whitelist, the role matrix and the
  audit trail all live in one place, `permissions.json`, and the frontend and
  the backend are proved to agree.
- Timestamps render in Asia/Manila regardless of the browser time zone.
- The app is an installable PWA with a manifest, maskable icons, a service
  worker that caches only the shell, an offline page, and a sign out that
  empties every cache.
- The IT Coordinator no longer answers on the office's behalf. Accepting and
  rejecting belong to the Office Requester, the dependency follow-up belongs
  to the coordinator, and the office owns the maintenance visit date. The
  buttons and the backend guards agree, and the permission map is the single
  source for both.
- The offline prototype used four obsolete maintenance job statuses, so the
  confirmation screen never matched a job. All job statuses now use the same
  eight labels as a ticket.
- The maintenance outcome is Successful, Incomplete or Cancelled only, and
  only a Closed job with a complete checklist may be Successful. The system
  writes the outcome when the visit closes, and an audited authorized closure
  is available for a visit the office never confirmed.
- The offline state merge used to trust the client: it could create a ticket
  that was already Assigned, and a record the client left out was deleted. It
  now merges by id onto the stored records, admits a new record only as
  Submitted with server-written timestamps, history and audit, and never
  removes what the client did not send.
- The management import used to accept a changed status on a live record and
  a shortened audit list. History, comments and audit are now compared as an
  exact prefix of what is stored, and a status change on an existing record is
  refused.
- The audit trail used to be trimmed at 4000 entries, so the oldest evidence
  could vanish. Nothing trims it now.
- The technician snapshot still carried `priority`, `impact` and `urgency`, and
  both the technician and the office snapshot listed the name and size of
  attachments on records outside their scope. All four leaks are closed at the
  snapshot, and a test reads `/api/state` to prove it.
- The 30 minute idle session timeout in decision D22 was written down but not
  enforced. Sessions now carry a last-seen time, and a token that has not been
  used for 30 minutes, or is older than 24 hours, is dropped.
- The maintenance frequency list was short of the eight the settings table
  carries, and "Custom" fell back to a fixed interval. The eight are seeded,
  the plan editor offers a custom interval in days, and the cadence anchor uses
  it on both transports.
- A rescheduled visit let its agreed date pass in silence. The world clock now
  asks the office again, and returns the visit to Assigned only after a yes.
- `assigned` to `on_hold` was in the transition whitelist although Appendix B
  draws On Hold only from a dependency that cannot proceed. It is gone from the
  map, the mirror and both fallback tables, so the board no longer offers it.
- An attachment was accepted on the type the browser declared. The bytes are
  now checked against it, so a renamed executable is refused, and a browser
  that sends no type at all is served by the extension.
- Session bookkeeping wrote `last_seen` to SQLite on every authenticated
  request outside the state lock, while every save deletes all rows and
  re-inserts them over one shared connection, so a concurrent commit could
  make a half-rebuilt database durable. The write now happens at most once a
  minute and inside the lock, the sign-in and state snapshots are serialised
  the same way, and the connection waits up to five seconds for a write lock
  instead of failing the request.
- An unbounded custom interval reached `datetime + timedelta(days=...)` and
  raised `OverflowError` in the middle of `/api/call`, after the dataset in
  memory had been changed but before it was saved, so the two diverged and the
  browser read "Backend unavailable." The interval is now a whole number of
  days from 1 to 3650 in both mirrors, an out-of-range stored value falls back
  to the configured cadence instead of crashing the date maths, and an action
  that raises partway reloads the stored dataset.
- A state merge the server refused was thrown away in silence, so the screen
  kept showing edits that were never stored. The reason is now named and the
  stored dataset is re-read.
- A merged new ticket that arrived without a status, or with the display label
  "Submitted", rejected the whole batch with 400 and, with the silence above,
  lost every pending edit. An absent status or any casing of the label now
  reads as Submitted; only a real workflow status is refused.
- An expired session was reported as a missing backend and the page fell back
  to the bundled seed dataset, so the registers kept rendering demo records as
  if they were live. The browser tells the two apart and returns to the
  sign-in screen, while a static copy with no server at all still runs the
  local prototype.
- A plan labelled a schedule with no stored interval "Custom (0 days)" while
  the engine advanced it every 30 days. The label now reads "interval not set"
  and names the cadence actually in use.
- `"45.7"` and `"45abc"` were accepted offline and refused by the server. Both
  mirrors now require a plain whole number, and the offline suite runs the
  same table the server test runs.
- An Excel tab-delimited export saved as UTF-16 was refused as "contents do
  not match the type" because its ASCII text is full of NUL bytes. A marked
  UTF-16 body now decodes and is accepted.
- A merged record could name evidence files the server holds no bytes for, so
  the chip rendered with a size of 0. `attachments` is now protected on the
  merge, and the request page uploads the chosen files after the record
  exists.
