# Role matrix

The permission map for the whole system, per role: **pages**, **actions**,
**status transitions** and **data scope**.

## One source of truth

`permissions.json` at the repository root is the single permission map:

```json
{
  "roles":       ["requester", "technician", "coordinator", "management"],
  "pages":       { "review.html": ["coordinator"], ... },
  "actions":     { "assign": ["coordinator"], ... },
  "transitions": { "submitted": { "assigned": ["coordinator"], ... }, ... }
}
```

| Consumer | How it reads the map |
|---|---|
| Trusted backend (`server/engine.py`) | loads `permissions.json` directly; `_action_roles` resolves the allowed roles for the running action and `_build_transitions` builds the transition whitelist |
| Frontend (`js/permissions.js`) | generated from `permissions.json`; `js/ui.js` reads `window.PermissionMap.pages` and `js/flow.js` reads `window.PermissionMap.transitions` |
| Role page generator (`tools/role_pages.py`) | reads `permissions.json` to decide which role pages to build |
| Audit (`tools/permission_parity_check.py`) | proves the three copies never drift apart |

Rebuild the frontend mirror after any change:

```
python tools/build_permissions.py
python tools/permission_parity_check.py
```

The parity check fails if the backend guard list, the backend transition
matrix, `permissions.json` and `js/permissions.js` disagree on any action or
any transition.  A configured `settings.roleActions` may only **narrow** the
shipped matrix, never widen it, so an administrator cannot grant a role a
move the map does not allow.

## Roles and lanes

| Role | PDF lane | Data scope |
|---|---|---|
| Office Requester (Office Representative) | Office Requester or Office Representative | only the offices the user belongs to |
| IT Technician | IT Technician | tickets and maintenance jobs assigned to them, plus read-only office and asset history for those offices |
| IT Coordinator | IT Coordinator | all offices |
| System Administrator | not a swimlane | Administration only (role scope 5, `DECISIONS.md` D14): users, roles and office membership, offices, categories, configuration, and the read-only audit trail. No ticket, maintenance, scheduling or closure work, and no operational read surface: the ticket, job and schedule keys of its snapshot are empty and the ticket, report and export routes are refused |
| System | System lane (automated, no screens) | n/a |

## Pages

| Page | Requester | Technician | Coordinator | Management |
|---|---|---|---|---|
| Dashboard | yes | yes | yes | no |
| Tickets | yes | yes | yes | no |
| Ticket detail | yes | yes | yes | no |
| Office Service Register | yes | yes | yes | no |
| Maintenance Visits (read-only) | yes | no | no | no |
| Reports | yes | yes | yes | no |
| Workflow Guide | yes | yes | yes | yes |
| Roles and Access | yes | yes | yes | yes |
| Notifications | yes | yes | yes | yes |
| Profile | yes | yes | yes | yes |
| New Request | yes | no | yes | no |
| Review and Assign | no | no | yes | no |
| My Work | no | yes | no | no |
| Maintenance | no | yes | yes | no |
| Confirmation and Closure | yes | no | yes | no |
| Users | no | no | no | yes |
| Offices | no | no | no | yes |
| Settings | no | no | no | yes |
| Audit Log | no | no | no | yes |

The Workflow Guide, notifications and the profile are shared by every signed-in
role and appear in the navigation of all four lanes. Roles and Access describes
route permission, not navigation: the reference page stays reachable at
`roles.html` for every role but appears in no sidebar, top bar or mobile More
sheet.

A page a lane cannot open is not offered to it at any device size: it is absent
from the sidebar, the top bar and the mobile More sheet, and the generated role
file for that page and role does not exist, so the URL itself cannot reach it.
Page access is enforced twice: the pre-paint role guard in the generated role
pages redirects a wrong-role visitor to that lane's own landing page, and the
backend scopes every read and write to the signed-in user's role and office.

## Actions

`actions` lists the backend methods and the roles that may call them.  The
backend refuses anything not listed; the UI only ever offers the buttons a
role may use in the current status, and it reads the same map through
`UI.canAct`, so a button is never offered that the server would refuse.

| Action | Requester | Technician | Coordinator | Management |
|---|---|---|---|---|
| `createTicket` | yes | no | yes | no |
| `submitInfo` | yes | no | yes | no |
| `requestWithdrawal` | yes | no | no | no |
| `officeDecision` | yes | no | no | no |
| `jobConfirmation` | yes | no | no | no |
| `createLinkedTicket` | yes | no | yes | no |
| `updateTicket` | yes | no | no | no |
| `requestInfo` | no | no | yes | no |
| `assess` | no | no | yes | no |
| `assign` | no | no | yes | no |
| `reassign` | no | no | yes | no |
| `approve` | no | no | yes | no |
| `coordinate` | no | yes | yes | no |
| `cancel` | no | no | yes | no |
| `cancelFromDependency` | no | no | yes | no |
| `followUp` | no | no | yes | no |
| `resolveDependency` | no | no | yes | no |
| `startWork` | no | yes | no | no |
| `diagnose` | no | yes | no | no |
| `recordRepair` | no | yes | no | no |
| `placeHold` | no | yes | no | no |
| `recordTest` | no | yes | no | no |
| `close` | yes | no | yes | no |
| `sendReminder` | no | no | yes | no |
| `createSchedule` | no | no | yes | no |
| `runScheduleCheck` | no | no | yes | no |
| `rescheduleJob` | yes | no | yes | no |
| `confirmAvailability` | yes | no | yes | no |
| `recordChecklistItem` | no | yes | no | no |
| `flagAdditionalFault` | no | yes | no | no |
| `createFaultTicket` | no | yes | no | no |
| `recordOutcome` | no | yes | yes | no |
| `closeJob` | no | no | yes | no |
| `addComment` | yes | yes | yes | no |
| `updateSchedule` | no | no | yes | no |
| `setScheduleActive` | no | no | yes | no |
| `saveOffice`, `setOfficeActive` | no | no | no | yes |
| `savePerson`, `setPersonActive` | no | no | no | yes |
| `saveRef` | no | no | no | yes |
| `saveSettings` | no | no | no | yes |

Three rules carry most of the lane ownership:

- **The office decides.**  `officeDecision` and `jobConfirmation` belong to
  the Office Requester alone.  Accepting records the confirming person and
  the date and closes the ticket in that one step; No response keeps the
  ticket Resolved and sends a follow-up reminder.  The IT Coordinator may not
  accept or reject on the office's behalf, and closes an unanswered record
  only through the audited authorized closure, which always carries a reason.
- **The technician works on their own queue.**  `startWork`, `diagnose`,
  `recordRepair`, `placeHold`, `recordTest`, `recordChecklistItem`,
  `flagAdditionalFault` and `createFaultTicket` are refused for any record
  that is not assigned to the acting technician, and so is `addComment`.
- **The coordinator chases the dependency.**  `followUp` and
  `resolveDependency` are the IT Coordinator's.  The technician records the
  dependency itself; the coordinator chases it and records the outcome.

`close` has two modes.  `mode == "confirmation"` is an office decision and
is limited to the owning office requester.  Authorized closure is limited to
`settings.authorizedClosureRoles`, default `["coordinator"]`; the System
Administrator is rejected even if a stale configuration still names it, and
a reason is always required.  `closeJob` is the same rule for a maintenance
visit.

The System Administrator administers, it does not operate.  Its actions are
`saveOffice`, `setOfficeActive`, `savePerson`, `setPersonActive`, `saveRef`
and `saveSettings`.  Role scope 5 keeps it out of the operational screens as
well as out of the workflow: it holds no dashboard, ticket, register, report or
maintenance page, `/api/tickets`, `/api/reports` and `/api/export` answer 403
for the lane, and its snapshot carries no ticket, job or schedule record.  It
reads the audit trail, which is the evidence the administration work needs, and
the backend refuses every workflow mutation, including state merges and
attachment uploads.

`recordOutcome` has two halves.  The assigned technician completes a visit
that has a full checklist, which hands the job to the office.  The IT
Coordinator records an Incomplete or Cancelled outcome, which is never
Successful.  The Successful outcome itself is written by the system when
the job closes.

## Status transitions

The transition whitelist, exactly as in the specification.  Any move not in
this table is refused by the trusted backend.

| From | To | Allowed role | Required data |
|---|---|---|---|
| (new) | Submitted | requester (name fixed, any active office; priority starts at Medium), or coordinator on behalf of an office | office, requester, category, issue, date reported, source; the coordinator may also set priority |
| Submitted | Needs Information | coordinator | the missing details requested |
| Needs Information | Submitted | requester, or coordinator recording what arrived | the information supplied, on the same ticket |
| Submitted | Assigned | coordinator | impact, urgency, priority, target date, technician |
| Assigned | In Progress | assigned technician | the schedule coordinated (a date or a note) |
| In Progress | On Hold | technician | dependency, reason, responsible person, next action |
| On Hold | In Progress | coordinator | the dependency resolved note |
| In Progress | Resolved | assigned technician | a passed test record and a service summary |
| Resolved | Closed | requester, or authorized closure | confirming person and date, or authoriser, reason and date |
| Resolved | In Progress | requester | office feedback, back to the assigned technician |
| Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved | Cancelled | coordinator | the cancellation reason |
| Closed, Cancelled | none | none | terminal; a recurrence creates a new linked ticket |

A failed technician test does not change the status.  The ticket stays In
Progress and the failed test is recorded, so the work returns to diagnosis.

## Who acts next

The queue owner per status, used for the "Needs my action" queue and the
"Waiting on" label on every ticket and maintenance job.

| Status | Next action owner |
|---|---|
| Submitted | IT Coordinator (review) |
| Needs Information | Office Requester (supply information) |
| Assigned | IT Technician (review, coordinate, start) |
| In Progress | IT Technician (diagnose, service, test) |
| On Hold | IT Coordinator (follow up the dependency) |
| Resolved | Office Requester (confirm or reject) |
| Closed, Cancelled | nobody, the record is retained |

| Maintenance job step | Next action owner |
|---|---|
| Generated, not yet assigned | IT Coordinator (assign and coordinate the visit) |
| Availability unconfirmed or office unavailable | Office Requester (confirm availability or agree a new date) |
| Checklist in progress | IT Technician |
| Awaiting confirmation | Office Requester |

## Data scope

| Rule | Where it is enforced |
|---|---|
| A requester only sees records of the offices they belong to | `engine._office_block`, `app._scoped`, `app._api_tickets`, `app._api_reports`, `app._api_export` |
| A technician only sees and acts on the tickets and jobs assigned to them | `engine._check_transition` and `_assigned_to_actor`; `app._scoped_technician` for the reads |
| Internal notes never reach an office session | `app._scoped` strips `visibility == "internal"` comments for requesters; the audit entry for an internal note is written by the engine, not exposed to the requester view |
| Completed and cancelled records are never edited, only actioned through an audited path | `engine` exposes no update or delete for a closed ticket, and the audit log is append-only |
| The audit log cannot be changed by any client | `POST /api/state` ignores the client audit list entirely; the database rejects updates and deletes on the audit table |
| Reports and exports respect the data scope | `app._api_reports` and `app._api_export` use the same scoped snapshot as the screens: an office user sees its own office and the requests it raised, a technician their own workload, the coordinator every office. The administrator lane is refused both routes, and every report and export command it is given, because it holds no operational read surface (role scope 5) |
| The administrator holds no operational record | `app._scoped_management` empties the `tickets`, `jobs` and `schedules` keys of its snapshot and `app._api_tickets`, `app._api_reports` and `app._api_export` answer 403 for the role; the audit trail and the administration data stay readable |

## Verification

| Check | Command |
|---|---|
| The map, the backend and the frontend mirror agree | `python tools/permission_parity_check.py` |
| Every disallowed transition is refused | `python server/tests.py` (the exhaustive transition test) |
| Each role sees only its own navigation and actions | `node tools/rolepages_test.js` |
| A wrong-role URL is rejected by the backend, not only hidden | `node tools/pagetest.js` (the access guard tests) and `python tools/api_check.py` |
