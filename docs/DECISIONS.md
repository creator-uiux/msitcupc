# Decisions

This log records every decision that shapes the workflow, the data or the
access rules, together with the default that ships and how to change it.
Decisions marked as fixed are enforced in both the trusted backend and its
browser mirror.

## Fixed rules

| Area | Rule | Where it is enforced |
|---|---|---|
| Workflow vocabulary, transitions and guards | A rule that is never configurable at runtime | `server/engine.py` and its browser mirror `js/flow.js` |

A configured `settings.roleActions` may only **narrow** the shipped
permission map, never widen it, so an administrator cannot grant a role a
move the workflow does not allow.

## Workflow decisions

| ID | Topic | Decision | Default that ships | How to change it |
|---|---|---|---|---|
| D1 | Cancel from Resolved | Allowed, for the IT Coordinator, with a reason | Cancel from `resolved` is permitted | `permissions.json` transition table, rebuilt with `python tools/build_permissions.py` |
| D2 | Cancel from Submitted, Needs Information, In Progress | Allowed, for the IT Coordinator, with a reason. The PDF draws it from Assigned and from a dependency that cannot proceed | Permitted source statuses: `submitted`, `needs_info`, `assigned`, `in_progress`, `on_hold`, `resolved` | `permissions.json` transition table |
| D3 | Reassigning a technician | Allowed while Assigned, In Progress or On Hold. The status does not change and an assignment-change audit event is written | `reassign` is open to the IT Coordinator | `permissions.json` action `reassign` |
| D4 | Authorized closure | Only the IT Coordinator, only from Resolved, always with a reason, actor and timestamp, and always visible in the history as "Authorized closure". The System Administrator never closes operational records, even if a stale configuration names it. Silence is never acceptance | `settings.authorizedClosureRoles = ["coordinator"]` | `settings.html`, Operational settings |
| D5 | Request source values | Online Portal, Telephone, Email, Walk-in, On-site | `settings.sources` | `settings.html`, Reference data |
| D6 | Priority matrix | Impact (Low, Medium, High) and Urgency (Low, Medium, High) map to Priority (Low, Medium, High, Critical). Impact, urgency and priority are stored separately | `settings.priorityMatrix`, the shipped matrix below | `settings.html`, Impact and urgency matrix |
| D7 | Categories | A configurable table | Hardware Repair, Software Support, Network and Connectivity, Account Assistance, Printer and Peripheral, Installation and Configuration, Other | `settings.html`, Reference data |
| D8 | Approval | A per-category flag, off by default. It is never required for every service | `settings.approvalCategories = []` | `settings.html`, Categories that need coordinator approval |
| D9 | Reminder interval | Configurable, three business days by default. A reminder is an audit event and never changes a status | `settings.reminderBusinessDays = 3`, `settings.reminderRepeatDays = 7` | `settings.html`, Operational settings |
| D10 | Maintenance job status | The same eight status labels as a ticket, plus a separate outcome field: Successful, Incomplete or Cancelled. Only a Closed job whose checklist is complete may be Successful | `jobs.status` from the eight labels, `jobs.outcome` from the three outcomes | The status vocabulary is fixed by the workflow; the outcome is written by the system in `server/engine.py` |
| D11 | Next due date | Fixed cadence by default, so a late visit never drifts the plan. The next due date still advances after an incomplete or cancelled outcome | `engine.frequency_days` and the schedule `dueDate` | `settings.html`, Maintenance frequencies |
| D12 | Metrics | Completed means Closed. Resolved is reported separately as Awaiting confirmation. Cancelled is always separate. Overdue means the target date passed and the status is not Resolved, Closed or Cancelled. Turnaround runs from Submitted to Resolved, with time to closure shown separately. A recurring issue is a ticket linked to a previous Closed ticket. Preventive compliance is Successful Closed jobs divided by the occurrences that came due | See `REPORT_DEFINITIONS.md` | The definitions are in `server/query.py` and are not configurable, so every screen and every report agrees |
| D13 | Office visibility | Office users never see internal notes or internal cost details | Enforced in `app._scoped` and in the engine guards | Not configurable, by design |
| D14 | Administrator | Manages users, offices, categories, assets and configuration. Holds no ticket, maintenance, scheduling or closure work unless the person is also given an operational role; oversight reads only. The audit history cannot be edited | The administrator is read only on the workflow, with no authorized closure | `permissions.json` action list |
| D15 | Requester withdrawal | The Requester sends a withdrawal request. The IT Coordinator records the reason and sets Cancelled, because the PDF places that step in the IT Coordinator lane | `request_withdrawal` (requester) and `cancel` (coordinator) | `permissions.json` action list |
| D16 | Swimlane for System steps | System steps are automatic application behaviour, triggered by the human step that precedes them. The office availability answer is given by the Office Requester and recorded by the System | Enforced in `server/engine.py` | Not configurable, by design |
| D17 | Hidden-arrow links | The five links the PDF draws with the arrowhead hidden behind a label are implemented from the label text and the SOP numbering | See `TRACEABILITY.md` | Not configurable |
| D18 | Needs Information return | After the office supplies the information, the same ticket returns to Submitted for review. No new ticket is created | `needs_info -> submitted` for the requester and the coordinator | `permissions.json` transition table |
| D19 | Ticket number | `IT-YYYY-NNNNNN`, the year plus a zero padded yearly sequence, generated on the server inside a transaction on a counter record, so a number is unique and never reused | `IT-2026-000101` | `server/db.py` counter, `server/engine.py` ticket numbering |
| D20 | Queues | Open covers Submitted, Needs Information, Assigned, In Progress, On Hold and Resolved. Closed covers Closed and Cancelled, with a filter to separate them. My Tickets means assigned to me (technician) or created by me (requester) | `server/query.py` | The queue definitions are in `js/query.js` and `server/query.py` and are not configurable |
| D21 | Attachments | jpg, png, webp, pdf, docx, xlsx, csv and txt only. At most 10 MB per file and 10 files per record. A malware scan is an external integration boundary | `server/app.py` `ALLOWED_UPLOAD_MIMES`, `MAX_UPLOAD_BYTES` and `MAX_FILES_PER_RECORD` | A code change to the constants; the list is deliberately not a runtime setting |
| D21a | The attachment viewer | An attachment opens over the record, in place: the image or the PDF is shown without leaving the screen, and a file whose bytes are not held here says so plainly. The bytes are streamed from the server, never from a public path, and every request is authorised | `js/ui.js` `openAttachment`, `server/app.py` `GET /api/attachment` | The types that can be previewed are in `js/ui.js` `attachmentKind` |
| D22 | Schedule check and sessions | The maintenance schedule check runs daily at 06:00 Asia/Manila, or through the manual, idempotent "Run schedule check" action by the IT Coordinator when scheduled functions are unavailable. The idle session timeout is 30 minutes | `server/workers.py` and `server/engine.py` | The timeout is in `server/auth.py` |
| D23 | Login copy | Headline "Maintenance Management, from request to closure." and the subtitle in Section 14.15. Seals, photo, pill badge, tile labels, Welcome back, button text, and helper text follow the reference image exactly | As specified in `login.html` | Not configurable; update `login.html` and rebuild |
| D24 | Sign-in domain | Google sign-in limited to `@upcebu.edu.ph` (configurable), enforced on the trusted layer. Users must be provisioned with a role. Unprovisioned users see "Access not granted" | `@upcebu.edu.ph` enforced server-side; unprovisioned see access denied | `server/auth.py`, `server/app.py` |
| D25 | Demo sign-in | The sign-in page always lists the four demo accounts, labelled "Demo only", on every host: any localhost port, a static copy and Firebase Hosting. The server demo gate still governs server-side demo credentials; when a hosted server refuses them the page takes a browser-only demo session | Always on for the page; the backend gate stays off by default on a network bind | `js/login.js`; `server/app.py` demo gate |
| D26 | Requester office at intake | The Office Requester keeps their signed-in name but may choose any active office for a new request. The office they choose is stored in both transports, and they can follow the requests they raised even when the office differs. Reads and actions on other offices stay blocked | Office defaults to the requester's own; the name stays locked | `request.html` `applyRequesterLock`; `js/flow.js` `officeBlock`; `server/engine.py` `create_ticket` and `_office_block`; `server/app.py` `_scoped_requester` |
| D27 | Design language | The interface follows Section 25.5A (maintenance-system visual language) and 25.5B (responsive matrix) on top of the Canvas and Firebase layout patterns, using the existing colour theme. The login page is excluded and unchanged. Board moves are menus guarded by the transition table, not free drag and drop, so an invalid move is refused with a plain explanation | Sections 25.5A and 25.5B of `docs/MASTER_PROMPT_COMPLETE.md`; `css/console.css`; `tickets.html`; `technician.html`; `register.html`; `visits.html` | The design language is presentation only; the workflow, routes, data model and permission map stay as they are |
| D28 | Office acceptance | Accepting the result records the confirming person and the date and closes the ticket in that one step. Rejecting returns it to diagnosis with feedback. No response keeps the ticket Resolved and sends the follow-up reminder | One-step closure on acceptance; `no_response` is a reminder state, not a closure | `server/engine.py` `office_decision`; `js/flow.js` `officeDecision` |
| D29 | Lane visibility | The Office Requester never sees priority, impact, urgency, technician assignment or maintenance plans. The IT Technician never sees priority or assignment ownership controls. The coordinator assesses and reassigns | Enforced by the role-scoped API snapshot and in every screen that renders those fields | `server/app.py` `_scoped_requester`; `ticket.html`; `tickets.html`; `reports.html`; `visits.html`; `register.html`; `js/ui.js` |

## The shipped priority matrix

Impact down the side, urgency across the top.

| Impact \ Urgency | High | Medium | Low |
|---|---|---|---|
| High | Critical | High | Medium |
| Medium | High | Medium | Low |
| Low | Medium | Low | Low |

The coordinator records the impact and the urgency.  The matrix decides the
priority, and the entry that was actually made is always stored with all
three, so a report can group by any of them.  If the coordinator enters a
priority that disagrees with the matrix, the matrix wins and the difference
is written into the audit trail.

## Changes that need a code change

Two decisions are structural and are not configurable at run time:

- **The eight status labels.** They are the vocabulary of the workflow and
  every screen, badge, report and notification uses them.
- **The transition whitelist.** It lives in `permissions.json` and is read
  by the backend at run time, so changing it is a configuration change, but
  the rebuild step (`python tools/build_permissions.py`) must be run and the
  parity check (`python tools/permission_parity_check.py`) must pass.
