# Data model

The records the system keeps, the relationships between them, and where
each one lives.  The workflow is the source of truth for the fields: every
field here is written by a documented step of the process and read by a
screen, a report or the audit trail.

The backend is `server/` (standard library Python plus SQLite).  The browser
mirror is `js/flow.js` with `js/store.js` holding the same shapes, so the
offline prototype and the live service agree on the field names.

## How the data is stored

The live service keeps a single dataset in SQLite (`server/itc.sqlite3`),
split into tables so the append-only tables really are append-only:

| Table | Holds | Written by |
|---|---|---|
| `tickets` | one row per service request | the workflow engine |
| `ticket_history` | the chronological record of every ticket | append only |
| `ticket_tests` | every technician test result | append only |
| `ticket_comments` | the conversation: office replies and internal notes | append only |
| `schedules` | the preventive maintenance plans | the coordinator and the administrator |
| `jobs` | one row per maintenance occurrence | the schedule check and the technician |
| `notifications` | the in-app notification centre | the engine and the workers |
| `audit_events` | the append-only audit trail | every mutating action |
| `attachments` | the uploaded evidence, with the bytes | the upload endpoint |
| `users`, `offices`, `sessions`, `deliveries`, `settings`, `sequences` | people, places, sign-ins, the delivery outbox, the configuration and the counters | the administration actions |

The dataset is also serialised as one JSON snapshot, which is what the
browser receives over `GET /api/state` and what the audit trail checks
against.

## The entities

### Office

| Field | Notes |
|---|---|
| `name` | The primary key. A ticket, a job and a schedule all point at the office by name |
| `code` | Short office code, shown in the register and the exports |
| `location` | Free text, used on the register and in the service history |
| `contactPerson`, `contactEmail`, `contactPhone` | The office contact |
| `active` | An inactive office stays on the historical records but is not offered for new work |
| `createdAt`, `updatedAt` | Server timestamps |

### Person (user)

| Field | Notes |
|---|---|
| `id` | The primary key |
| `name` | The identity written on every service record. A rename cascades |
| `email`, `phone` | Contact details, editable on the profile screen |
| `role` | `office_requester`, `it_coordinator`, `it_technician` or `system_admin` |
| `office` | The office an office requester belongs to. One person belongs to one office in this build; the membership is the office tenancy key |
| `active` | An inactive person cannot sign in and is not offered as an assignee |
| `prefs` | The saved appearance and session preferences |

### Ticket (service request)

| Field | Notes |
|---|---|
| `id` | `IT-YYYY-NNNNNN`, unique and never reused |
| `office` | The owning office. An office requester may only reach their own office |
| `requester` | The person who raised the request |
| `source` | Online Portal, Telephone, Email, Walk-in or On-site |
| `category` | One of the configured categories |
| `issue` | The reported problem |
| `asset` | The equipment tag, empty for a service without equipment |
| `dateReported` | The date the office reported the issue |
| `attachments` | The evidence file names |
| `status` | One of the eight labels: Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved, Closed, Cancelled |
| `impact`, `urgency` | Low, Medium or High, recorded separately |
| `priority` | Low, Medium, High or Critical, derived from the matrix |
| `target` | The target completion date |
| `technician` | The assigned technician |
| `reviewed` | True once the coordinator has assessed the request |
| `approval` | The coordinator sign-off, present only for a category that needs approval |
| `previousRecord` | The previous service record this one continues |
| `linkedTo` | The ticket this one was created from, for a recurrence or a corrective ticket |
| `maintenanceJobId` | The maintenance job a corrective ticket came from |
| `idempotencyKey` | The key that makes a double submission harmless |
| `createdAt`, `updatedAt` | Server timestamps |
| `resolvedAt`, `closedAt` | Set when the technician resolves and when the ticket closes |
| `diagnosis` | `findings`, `actions`, `parts`, `cost`, `labor`, `dates`, `evidence` |
| `tests` | The test results: `passed` or `failed`, with the note, the tester and the time |
| `dependency` | `type`, `reason`, `responsible`, `nextAction`, `state` and the follow-up `updates` |
| `confirmation` | `state`, `person`, `date`, `feedback`: the office decision |
| `cancelReason`, `closure`, `authorizedReason` | The cancellation reason, the closure mode and the authorized-closure reason |
| `withdrawal` | The office request to withdraw, with the reason the office gave |
| `recurring` | True when the issue recurred after closure |
| `history` | The chronological record of every step, with the actor, the role, the status and the text |
| `comments` | The conversation: public replies and internal notes, with a `visibility` flag |

### Ticket history entry (append only)

| Field | Notes |
|---|---|
| `ticketId`, `seq` | The owner and the order |
| `at` | The server timestamp |
| `by`, `role` | The actor. The System writes its own steps as "System" |
| `status` | The status the entry records |
| `kind` | `status`, `note`, `assign`, `confirm`, `dep`, `test`, `cancel`, `comment`, `outcome`, `sched`, `checklist` |
| `text` | The sentence a person reads |

### Ticket test (append only)

| Field | Notes |
|---|---|
| `ticketId`, `seq` | The owner and the order |
| `at`, `by` | When and who |
| `result` | `passed` or `failed` |
| `note` | What was tested |

A ticket can only become Resolved when at least one `passed` test exists.

### Ticket comment (append only)

| Field | Notes |
|---|---|
| `ticketId`, `seq` | The owner and the order |
| `at`, `by`, `role` | When and who |
| `visibility` | `public` for an office reply, `internal` for a staff note |
| `text` | The message |
| `attachments` | The evidence file names |

An internal note is never sent to an office session.  The server strips it
before the snapshot leaves the backend.

### Maintenance schedule

| Field | Notes |
|---|---|
| `id` | `SCH-2026-NNN` |
| `office` | The office the plan belongs to |
| `assets` | The equipment in scope, empty for a plan that covers the whole office |
| `category` | The maintenance category |
| `checklist` | The tasks to perform |
| `frequency` | The key of the configured frequency |
| `dueDate` | The next due date. The cadence anchor for the next occurrence |
| `technician` | The assigned technician |
| `active` | A paused plan is not checked |
| `lastCheck`, `nextCheck` | The schedule check timestamps |

### Maintenance job (one occurrence)

| Field | Notes |
|---|---|
| `id` | `MNT-2026-NNNN` |
| `scheduleId` | The plan it came from |
| `occurrence` | `scheduleId` plus the scheduled timestamp. The unique key that makes duplicate generation impossible |
| `office`, `assets`, `category`, `checklist` | Copied from the plan at generation time, so the occurrence is self contained |
| `items` | The checklist execution: `task`, `done`, `result`, `finding`, `tech`, `date`, `evidence` |
| `status` | The same eight labels as a ticket |
| `availability` | `pending`, `yes` or `no`: the office availability answer |
| `visitDate` | The agreed visit date |
| `reschedules` | `from`, `to`, `reason`, `by`, `role`, `at` for every reschedule |
| `additionalFault` | `unknown`, `yes` or `no` |
| `linkedTicketId` | The corrective ticket the system created |
| `outcome` | `success`, `incomplete` or `cancelled`. Only a Closed job with a complete checklist may be `success` |
| `outcomeNotes` | The technician's note |
| `confirmation` | `state`, `person`, `date`: the office decision on the visit |
| `nextDue` | The next due date calculated for this occurrence |
| `createdAt` | Server timestamp |

### Notification

| Field | Notes |
|---|---|
| `id` | The primary key |
| `at` | The server timestamp |
| `role` | The audience: `requester`, `technician`, `coordinator`, `management` or `any` |
| `office` | The office, for an office-scoped notice |
| `kind` | The event: `assign`, `intake`, `confirm`, `cancel`, `dep`, `remind`, `comment`, `sched`, `job` |
| `ticketId`, `jobId` | The record the notice points at |
| `text` | The message |
| `read`, `readBy` | The per-user read state |

### Audit event (append only)

| Field | Notes |
|---|---|
| `id` | The primary key, monotonic |
| `at` | The server timestamp |
| `by`, `role` | The actor. Automated steps are written as "System" |
| `subjectType`, `subjectId` | The record the event is about |
| `status` | The status the event records |
| `kind` | `create`, `status`, `assign`, `reassign`, `confirm`, `dep`, `test`, `cancel`, `comment`, `outcome`, `sched`, `checklist`, `remind`, `closure`, `settings` |
| `text` | The sentence a person reads |

The audit trail is append only.  The client never sends an audit list: the
`POST /api/state` endpoint ignores it entirely, and there is no update or
delete endpoint for it.

### Attachment

| Field | Notes |
|---|---|
| `id` | The primary key |
| `ticketId`, `jobId` | The owner |
| `name`, `mime`, `size`, `sha` | What was uploaded |
| `uploadedBy`, `uploadedRole`, `at` | Who and when |

The bytes are stored in the `data` column and are served only through the
authorised download endpoint, which checks the office and the role first.

### Settings and reference data

`settings` holds the operational configuration: the reminder interval, the
priority matrix, the approval categories, the authorized closure roles, the
service level window, the time zone and the upload limit.  `ref` holds the
reference tables: categories, sources, priorities and maintenance
frequencies.  Both are edited on `settings.html` and both are recorded in
the audit trail.

### Sequences

`sequences` holds the counters behind the identifiers: one per ticket,
schedule, job and notification.  A number is handed out inside a
transaction, so two concurrent submissions never receive the same number.

## Relationships

```
Office 1 --- n Ticket 1 --- n TicketHistory
                 |  1 --- n TicketTest
                 |  1 --- n TicketComment
                 |  1 --- n Attachment
                 |  n --- 1 Person (the technician)
                 |  n --- 1 Person (the requester)
                 |  n --- 1 Category
                 n --- n Person (the requester, through the office)

MaintenanceSchedule 1 --- n MaintenanceJob 1 --- n MaintenanceChecklistResult
                 |                    |
                 |                    n --- 1 Ticket (the corrective ticket)
                 |                    n --- n Ticket (the confirmation)
                 n --- 1 Office

Ticket n --- 1 Ticket (previousRecord, the recurrence chain)
Ticket 1 --- 1 Ticket (linkedTo, the corrective ticket)
```

## Indexes

| Index | Used by |
|---|---|
| `idx_tickets_status` | the status filters and the status counts |
| `idx_tickets_office` | the office scope and the office breakdown |
| `idx_history_ticket` | the ticket timeline |
| `idx_comments_ticket` | the conversation |
| `idx_notif_role` | the notification centre |
| `idx_jobs_schedule` on `(schedule_id, occurrence)` | the duplicate prevention on the occurrence key |
| `idx_attach_ticket` | the attachment list |

The list screen adds the filters the specification names, applied on the
server: ticket number, subject, requester and asset tag for the quick
search, and status, priority, office, category, technician, request source,
created date range, last updated range and overdue for the advanced
filters.  Sorting is by any column, and the default is last updated,
descending.

## The Office IT Service Register

The register is the central, office-linked list of every service record,
corrective and preventive.  It is a view over the same rows rather than a
second copy, so it can never drift from the records it summarises:

| Register entry | Comes from |
|---|---|
| A service request | the ticket, with its office, requester, category, asset and status |
| A preventive visit | the maintenance job, with its office, assets, checklist and outcome |
| A status change | the ticket history and the audit trail |
| A diagnosis, a test, a confirmation, a cancellation, a closure | the ticket history |
| A reschedule | the job reschedule list |
| A corrective ticket | the ticket, linked back to its job |

The register screen applies the same office scope as the rest of the
system, so an office requester sees their own office only.

## Data integrity rules

- A status is always one of the eight labels.  An import with another value
  is refused.
- A ticket can only be Resolved when a passed test exists, and only when
  the assigned technician recorded it.
- A Closed or Cancelled ticket is never edited, only actioned through an
  audited path.
- A maintenance job may only carry the outcome `success` when it is Closed
  and every checklist item is done.
- A job occurrence is unique per `(scheduleId, occurrence)`, so a schedule
  check that runs twice reuses the existing job.
- History, comments, tests and audit events are append only.
- A requester may only reach the records of their own office, and a
  technician only the records assigned to them.
