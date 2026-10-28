# Known limitations

Honest list of what this system does not do, or does only partly, at the
current commit. Blocked or unverified items are listed first.

## Source limitations

- **The PDF was read as text, and its diagram as vector data.** The bundled
  `docs/source/Maintenance_System.pdf` was opened and its text extracted; the
  29 step SOP matches Appendix A verbatim and the owner is Anthony Derecho.
  The lane ownership, the decision diamonds and the connectors in Appendix B
  were produced by rendering the page and reading its vector data. A few
  connectors have their arrowhead hidden behind an edge label; they are
  listed in Appendix B.6 and were implemented from the label text and the SOP
  numbering.
- **The PDF is not dated consistently.** The title block reads "Last Updated
  January 30, 2021" while the file metadata says it was generated September
  30, 2026. This does not affect the process.
- **The PDF is stored twice.** The specification names
  `docs/source/Maintenance_System.pdf`, which exists; a copy also sits at the
  repository root as `Maintenance System.pdf`. The diagrams and the SOP were
  read from the same one page PDF.
- **The reference screenshots were only partly available.** `docs/reference/`
  holds `UPLoginUI.PNG` and `login-bg.jpg`, and both were used for the sign-in
  screen. The ticket list, ticket detail and dashboard screenshots named in
  the specification are not present, so those screens were built from the
  written requirements in Section 14 rather than copied from a picture.
- **The Figma kit page was fetched and read.** The kit page at
  `https://itcmaintenancesystem.web.app/figma-kit/everything.html` returned
  the screen inventory and the intended look, and it matches what this
  repository implements. It was used as a screen and component reference
  only; no component was copied from it, and the styling follows the design
  system in `docs/DESIGN_SYSTEM.md`.
- **The visual review was a machine check plus a read of the captures.** The
  108 captures in `docs/screenshots/` were produced with headless Chrome;
  the 60 base captures were checked for horizontal overflow and clipped
  text, and the login, ticket, dashboard, role, mobile and dark captures
  were read individually. Not every one of the 108 was read by a designer,
  so this is not a full design review.

## Platform constraints

- **Firebase is not in use.** The project is a zero build HTML, CSS and
  JavaScript front end with a zero dependency Python and SQLite backend. The
  specification's "reuse Firebase" rule therefore does not apply, and the
  equivalent guarantees are enforced on the trusted backend instead:
  transitions, role checks, office tenancy, validation and append only audit
  all live in `server/engine.py` and `server/app.py`.
- **No Cloud Functions or Cloud Scheduler**, so there is no server side cron.
  The world clock advances on `POST /api/tick`, which is restricted to the IT
  Coordinator and System Administrator. A deployment would schedule that
  call, or move the schedule check into a scheduled function.
- **Email delivery is an external dependency.** In-app notifications are the
  working default and `server/delivery.py` records an outbox. No credentials
  ship with this repository and no email is claimed to work.
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
  `@upcebu.edu.ph`; the demo account shortcut exists behind an explicit flag
  and is off by default.

## Partial

- **Two execution modes ship in one codebase**: live mode against the Python
  and SQLite backend, and an offline demo mode in the browser. The offline
  demo stores state in the browser and is not the production database.
- **Seed data is demo data.** It is marked as such, but it has the same shape
  as live records.
- **The offline demo keeps only the name of an attachment.** The bytes live
  with the server, so in the browser-only demo the attachment list shows the
  name and the details and the viewer says that the file itself is not kept
  here. The intake form records the names of the files it was given for the
  same reason: it does not upload the bytes.
- **The requester has no Maintenance Visits page in the rail.** The
  permission map does not grant `maintenance.html` to the requester, and the
  Phase 10 rules forbid changing security rules. Upcoming visits still
  appear on the dashboard and availability is still answered on
  `confirm.html`. A read-only maintenance page for the office would require
  a permission map change and a backend review.
- **Reports are not in the requester and technician rails.** Section 25.2.1
  and 25.2.3 do not list Reports for those lanes even though the permission
  map permits the page. A permitted role can still open the page directly.
- **The System Administrator does not see the create-schedule control.**
  `create_schedule` is coordinator-only. Edit and pause remain visible
  because `update_schedule` and `set_schedule_active` include that role.
- **System resolves to light on authenticated app pages.** The frozen
  `js/theme.js` applies the pre-paint default before the page styles load.
  Dark mode and an explicit Light choice work; changing the System result
  would require editing a frozen shared file.
- **Role visibility is a presentation layer.** Elements a role cannot use
  are hidden with body-class rules, not removed from the markup. The
  permission map and the backend guards remain the security boundary, and
  the parity checks prove they agree with the mirror.
- **The demo account chooser is development-only.** It appears only behind
  the explicit demo flag; it is never shown in a network-facing deployment.
- **The page test suite is flaky while another process edits the same tree.**
  The suite takes a free port, serves through a threaded server and answers
  the external font request locally, so it is stable on a quiet tree. When a
  second writer is active, or when two copies of the suite run at the same
  time, the browser can receive a partially written script and the suite
  reports failures that are not real. This is a harness limitation, not an
  application defect.
- **The requester cannot cancel directly.** The office may request a
  withdrawal, and the IT Coordinator records the cancellation reason, because
  the PDF places that step in the coordinator lane. A requester therefore
  cannot end a ticket in one step.
- **The permission map is regenerated, not edited.** `permissions.json` is
  the source of truth; `js/permissions.js` is generated from it and
  `tools/permission_parity_check.py` fails if the copies drift. Adding an
  action means adding it to the engine and rebuilding, not editing the
  mirror by hand.
- **Installability was checked by the manifest and the service worker**, by
  loading the pages over HTTP with the worker registered; it was not verified
  by a real install on a phone's home screen.
- **The demo flag gates the account list, not the backend.** When demo mode is
  off, the demo usernames are refused by `server/app.py`; the browser-only
  demo still runs from `js/store.js` when the API is absent, which is why the
  live server is the supported path.

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
