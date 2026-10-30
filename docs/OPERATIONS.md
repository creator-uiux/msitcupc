# Operations

Every operation the trusted backend exposes, with the roles that may call
it, what it requires, and what it writes.  An operation that is not listed
for a role is refused by the backend, not merely hidden in the interface.

All of them are dispatched through one endpoint:

```
POST /api/call
{ "method": "createTicket", "args": [ { "office": "Records Office", ... } ] }
```

The response is `{ ok, msg, id?, state }`.  `state` is the caller's scoped
snapshot, so a page never has to ask for a second time.

The list is generated from the same permission map the guards use, so the
map in `permissions.json` and this table cannot drift apart silently.  The
parity check `python tools/permission_parity_check.py` proves it.

## What every operation does

1. Checks the caller's role against the permission map, and narrows it
   further if `settings.roleActions` says so.  A narrowing may only remove
   a role, never add one.
2. Checks the caller's office scope and, for a technician, that the record
   is assigned to them.
3. Checks the current status and the transition whitelist.
4. Validates the required fields for the operation.
5. Writes the ticket history entry, the audit event and the register entry
   in the same transaction as the change itself.

## Intake and review (Section 1)

| Operation | Roles | Requires | Effect |
|---|---|---|---|
| `createTicket` | Office Requester, IT Coordinator | office, requester, category, issue; date reported and source default in; asset optional, offered from the register as a suggestion and still free to type | Records the request, issues the ticket number, sets status Submitted, links a previous service record when one is given. An idempotency key makes a double submission harmless |
| `requestInfo` | IT Coordinator | the missing details to ask for | Sets status Needs Information, asks the office, notifies the requester |
| `submitInfo` | Office Requester, IT Coordinator | the information supplied | Updates the **same** ticket and returns it to Submitted for review. No new ticket is created |
| `assess` | IT Coordinator | impact, urgency, priority, target completion date | Records the assessment, derives the priority from the matrix, marks the request reviewed |
| `assign` | IT Coordinator | a technician, an assessed request | Sets status Assigned, notifies the technician and the requester |
| `reassign` | IT Coordinator, System Administrator | a technician, a reason | Moves ownership, keeps the status, writes an assignment-change event |
| `approve` | IT Coordinator, System Administrator | a note | The coordinator sign-off for a category that needs approval |

## Service execution (Section 2)

| Operation | Roles | Requires | Effect |
|---|---|---|---|
| `coordinate` | IT Technician, IT Coordinator | a date or a coordination note | Records the agreed service schedule |
| `startWork` | the assigned IT Technician | the schedule coordinated, and the category approval when the category needs one | Sets status In Progress |
| `diagnose` | the assigned IT Technician | the findings | Records the diagnosis and the findings |
| `recordRepair` | the assigned IT Technician | the actions, and the parts, materials, cost, labour, dates and evidence | Appends the service record |
| `placeHold` | the assigned IT Technician | the dependency, the reason, the responsible person and the next action | Sets status On Hold and notifies the office and the coordinator |
| `followUp` | IT Coordinator | the update text | Records a dependency follow-up, keeps the ticket On Hold and moves the follow-up date on |
| `resolveDependency` | IT Coordinator | the outcome note | Sets status In Progress and returns the work to the technician |
| `cancelFromDependency` | IT Coordinator | the cancellation reason | Sets status Cancelled, notifies the requester and preserves the record |
| `recordTest` | the assigned IT Technician | `passed` or `failed`, and a note | A failed test keeps the ticket In Progress and returns it to diagnosis. A passed test sets status Resolved and asks the office to confirm |

## Confirmation, cancellation and closure (Section 3)

| Operation | Roles | Requires | Effect |
|---|---|---|---|
| `officeDecision` | Office Requester | the decision and, when accepting, the confirming person; when rejecting, the office feedback | Accepted records the confirmation, the person and the date. Rejected records the feedback and returns the ticket to In Progress for diagnosis. No response keeps the ticket Resolved and schedules a reminder. The IT Coordinator may **not** answer on the office's behalf |
| `close` | Office Requester (confirmation), IT Coordinator and System Administrator (authorized closure) | mode `confirmation` needs an accepted confirmation; mode `authorized` needs a reason | Sets status Closed, records the closure mode, updates the office service history and the reporting |
| `sendReminder` | IT Coordinator, System Administrator, the system worker | a Resolved ticket with a pending confirmation | Sends the follow-up reminder and writes an audit event. The status never changes |
| `cancel` | IT Coordinator | the cancellation reason | Sets status Cancelled, notifies the requester and preserves every record and the history |
| `requestWithdrawal` | Office Requester | the reason | Records the office request to withdraw. The IT Coordinator then records the cancellation reason, because that step belongs to their lane |
| `createLinkedTicket` | Office Requester, IT Coordinator | a Closed ticket, and the description of the recurrence | Creates a **new** linked ticket that starts at Submitted, and flags the previous record as recurring. Only a Closed ticket can be the source |
| `addComment` | every role | the message | Posts a public reply or an internal note. An internal note is never delivered to an office session, and a technician may only post on a ticket assigned to them |
| `updateTicket` | Office Requester | the ticket is their own and is Submitted or Needs Information | Corrects the intake details of a ticket that has not been assessed yet |

## Preventive maintenance (Section 4)

| Operation | Roles | Requires | Effect |
|---|---|---|---|
| `createSchedule` | IT Coordinator | office, assets, category, checklist, frequency, due date, technician | Records the plan |
| `updateSchedule` | IT Coordinator, System Administrator | the fields to change | Edits the plan |
| `setScheduleActive` | IT Coordinator, System Administrator | the active flag | Pauses or resumes the plan |
| `runScheduleCheck` | the system worker, or the IT Coordinator by hand | nothing | Idempotent. For every due plan it looks for the occurrence `scheduleId` plus the scheduled timestamp. If the job exists it reuses it, otherwise it generates one. The same key means a second run never duplicates a job |
| `updateSchedule` with a new technician | IT Coordinator | a technician | The job inherits the technician from the plan, so assigning the maintenance technician is a change to the schedule. The generated job is coordinated on that assignment |
| `confirmAvailability` | Office Requester, IT Coordinator | the answer | Records the office availability. The office answers, the system records it |
| `rescheduleJob` | Office Requester, IT Coordinator | the new date, and the reason | Records the reschedule with the old date, the new date, the reason, who agreed and who recorded it. The schedule keeps its cadence anchor, so no duplicate job appears |
| `recordChecklistItem` | the assigned IT Technician | the result, and the findings | Records the task, the result, the findings, the technician, the date and the evidence |
| `flagAdditionalFault` | the assigned IT Technician | yes or no | Answers the additional fault question |
| `createFaultTicket` | the assigned IT Technician | the additional fault answered yes | The system creates the linked corrective ticket, which starts at Submitted and follows Section 1. The job keeps its own documentation |
| `recordOutcome` | the assigned IT Technician, IT Coordinator | the checklist complete and the fault answered, for the completed visit | The completed visit moves the job to Resolved and asks the office to confirm. An Incomplete or Cancelled outcome may only be recorded by the IT Coordinator, and neither is ever Successful |
| `jobConfirmation` | Office Requester | the decision, and the confirming person when accepting | Accepted closes the job. Rejected returns it to verification. No response keeps it pending |
| `closeJob` | IT Coordinator, System Administrator | a reason | The authorized closure of a maintenance visit. The system records the outcome as Successful only when the checklist is complete, otherwise Incomplete |

## Reporting and administration

| Operation | Roles | Notes |
|---|---|---|
| `GET /api/tickets` | every role | Server-side search, filter, sort and pagination, scoped to the caller |
| `GET /api/reports` | every role | The aggregates for the dashboard and the reports, scoped to the caller |
| `GET /api/export` | every role | The CSV export of the filtered list, scoped to the caller |
| `POST /api/upload` | every role | The attachment, restricted by type and size, with the office scope checked |
| `GET /api/attachment` | every role | The download, authorised on every request |
| `POST /api/state` | every role, except the office requester | A content edit only. A status change over this endpoint is refused outright, the client audit list is ignored, and the workflow-protected fields always keep the server copy |
| `saveOffice`, `setOfficeActive` | System Administrator | The office record. A rename cascades to every record that names it |
| `saveAsset`, `setAssetActive` | System Administrator | The asset register: the number, the name, the category, the office that holds it and its location. A number must fit `AA-AA-00` and may be registered once; retiring keeps the record so an older ticket still resolves to the same unit. A rename of an office carries the units with it |
| `savePerson`, `setPersonActive` | System Administrator | The person record. A rename cascades the same way |
| `saveRef` | System Administrator | One reference row: a category, a source, a priority or a frequency |
| `saveSettings` | System Administrator | The operational settings: the reminder interval, the approval categories, the priority matrix and the authorized closure roles |
| `markNotificationsRead` | every role | The per-user read state of the notification centre |
| `POST /api/tick` | IT Coordinator, System Administrator | One turn of the world clock: the schedule check, the reminder loop and the dependency nudges |
| `POST /api/reset` | IT Coordinator, System Administrator | Re-seeds the development dataset |
| `POST /api/import` | System Administrator | A whole dataset replace. Every incoming ticket must carry one of the eight statuses, and the history, the comments and the audit trail may only grow |

## The operations that are refused

The backend refuses, with a message the interface shows as a toast:

- Any status change that is not in the transition whitelist.
- Any operation called by a role the permission map does not list.
- A technician acting on a ticket or a job that is not assigned to them.
- An office requester reaching another office's records, except the requests
  they raised themselves.
- An office requester accepting or rejecting on the office's behalf.
- A ticket becoming Resolved without a passed test.
- A maintenance job becoming Successful without a complete checklist.
- An edit to a Closed or Cancelled record.
- Any attempt to change or remove an audit event.

## Where the rules live

| Rule | Location |
|---|---|
| Which role may call which operation | `permissions.json`, action map |
| Which status may move to which | `permissions.json`, transition map |
| The office scope and the technician ownership | `server/engine.py`, `_office_block` and `_assigned_to_actor` |
| The status labels | `server/engine.py`, `_LABELS` |
| The required fields per operation | `server/engine.py`, one function per operation |
| The browser mirror | `js/flow.js`, one function per operation |

`js/flow.js` is a faithful mirror of `server/engine.py`: the same guards,
the same required fields, the same messages.  `tools/smoke.js` drives the
mirror through every branch of the flowchart, and `python server/tests.py`
drives the backend through the same branches.
