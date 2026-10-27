# Assumptions

Every `[ASSUMPTION]` in the master specification is implemented as a
configurable default, not a hard coded constant. This file records each one, the
default chosen, and where it is configured.

Configurable settings live in the state snapshot under `settings` and are edited
on `settings.html` (System Administrator) and read by both `server/engine.py` and
the browser mirror `js/flow.js`. Reference data (categories, sources, priorities,
frequencies) is likewise editable on `settings.html`.

## Workflow assumptions

| # | Assumption | Default | Where configured |
|---|---|---|---|
| A1 | Default service level window used when the coordinator sets no target date | 5 calendar days from intake | `settings.slaDays`, `query.DEFAULT_SLA_DAYS` |
| A2 | Priority is derived from an impact by urgency matrix, but the coordinator may override | matrix default, override allowed | `settings.priorityMatrix` |
| A3 | Certain categories require coordinator or office approval before work starts | disabled per category | `settings.approvalCategories` |
| A4 | Confirmation reminder cadence while a ticket waits at Resolved | 3 business days, repeat weekly | `settings.reminderBusinessDays`, `settings.reminderRepeatDays` |
| A5 | Business day definition for reminders and targets | Monday to Friday, no holiday calendar | `settings.workdays` |
| A6 | Time zone for all displayed and audited times | Asia/Manila (UTC+8) | `settings.timezone` |
| A7 | Maintenance occurrence identity | schedule id plus scheduled timestamp | `jobs.occurrence` |
| A8 | Recurrence next due calculation | previous due date plus configured frequency days | `engine.frequency_days` |
| A9 | Additional fault is unknown until the technician answers | `unknown` | `jobs.additionalFault` |
| A10 | Outcome success may only be recorded after every checklist item is done | enforced | `engine.record_outcome` |
| A11 | Preventive job closes only after office confirmation of the outcome | enforced | `engine.job_confirmation` |
| A12 | On behalf intake is permitted for coordinators only, requester stays office scoped | coordinator only | `settings.onBehalfRoles` |

## Data assumptions

| # | Assumption | Default | Where configured |
|---|---|---|---|
| A13 | Category taxonomy | Network, Hardware, Printer, Software, Accounting Software, Electrical, Other | `settings.categories` |
| A14 | Intake sources | telephone, email, walk-in, on-site, online portal | `settings.sources` |
| A15 | Priority vocabulary | low, medium, high, critical | `settings.priorities` |
| A16 | Maintenance frequencies and day counts | weekly 7, monthly 30, quarterly 91, semi-annual 182, annual 365 | `settings.frequencies` |
| A17 | Identifier formats | IT-YYYY-NNNNNN, SCH-YYYY-NNN, MNT-YYYY-NNNN | `engine.next_id` |
| A18 | Attachment size limit | 10 MB per file, at most 10 files per record; jpg, png, webp, pdf, docx, xlsx, csv and txt only | `server/app.py` `MAX_UPLOAD_BYTES`, `MAX_FILES_PER_RECORD`, `ALLOWED_UPLOAD_MIMES`; mirrored in `settings.maxUploadBytes` |
| A19 | Audit retention | most recent 4000 events kept in the snapshot | `engine._audit` |

## Access assumptions

| # | Assumption | Default | Where configured |
|---|---|---|---|
| A20 | Four roles: Requester, Technician, Coordinator, System Administrator | as named | `js/ui.js ROLES` |
| A21 | System Administrator is read only on the operational workflow and may perform authorized closure | read only plus authorized closure | `settings.roleActions` |
| A22 | Technician acts only on tickets assigned to them | enforced | `engine` guards |
| A23 | Requester may close a Resolved ticket for their own office | enabled | `engine.close` |
| A24 | Role by action matrix is configurable | current matrix shipped as default; narrowing-only (may not widen the default) | `settings.roleActions` |

## Demo assumptions

| # | Assumption | Default | Where configured |
|---|---|---|---|
| A25 | Authorized closure is limited to configurable roles | default: `["coordinator", "management"]` | `settings.authorizedClosureRoles` |
| A26 | Role only sign in shortcut exists for the offline demo only and is disabled by default | disabled in live mode | `settings.demoLogin` |
| A27 | Maintenance job status uses the eight canonical labels | status drawn from {submitted, needs_info, assigned, in_progress, on_hold, resolved, closed, cancelled} | `engine._LABELS`, `engine.record_outcome` |

## Open items (not assumed, deferred)

- Holiday calendar for business day maths is out of scope for this iteration
  (see `KNOWN_LIMITATIONS.md`).
- Real outbound e-mail or SMS delivery depends on server credentials supplied at
  deployment, not on this code.
