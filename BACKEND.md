# Backend  --  ITC Maintenance System

**Status: implemented (reference server) + design notes.** This document maps the
working front end (vanilla JS + `localStorage`) onto a production backend
and now describes the reference implementation that ships in [`server/`](server/)
 --  a zero-dependency **Python 3 standard library** service (SQLite + `http.server`
+ SSE) that ports the workflow engine verbatim. Every page still runs standalone
with no build step; the backend is optional.

The design keeps the exact same workflow semantics the front end already enforces
in `js/flow.js` and `js/live.js`, so the UI can switch from `localStorage` to HTTP
without changing screens. The adapter that does this is [`js/api.js`](js/api.js).
When a page is served by `server/app.py` it is live against the backend by
default  --  there is no user-facing API toggle.

```bash
python server/app.py            # serves the whole site on http://127.0.0.1:8787/
# open http://127.0.0.1:8787/
python server/tests.py          # 271 backend assertions (engine, RBAC, tenancy, OIDC, delivery, HTTP, SSE, site serving)
python tools/api_check.py       # 17 end-to-end browser assertions against the API
```

> The sections below keep the original design narrative; where the shipped
> implementation makes a concrete choice, it is called out in **§12 Reference
> implementation**.

---

## 1. Where we are today (client-only)

| Concern | Current implementation |
|---|---|
| Storage | `localStorage` key `itc_db_v4` (one JSON blob)  --  `js/store.js` |
| Cross-tab sync | `BroadcastChannel('itc_live')` + `storage` events |
| Workflow rules | `js/flow.js`  --  `Flow.*` (service) and `Maint.*` (maintenance) methods, each with role guards and status guards |
| Background jobs | `js/live.js`  --  one `tick()` on a timer: schedule check, reminder loop, dependency follow-ups, rescheduled-job activation, simulated intake |
| Identity | Google-only sign-in (`login.html`) maps a UP Cebu Workspace account → one of four roles (`db.auth`, `db.role`). The role comes only from the signed-in account  --  there is no in-app role switch |
| Demo mode | `?demo=1`  --  canonical seed, frozen clock, no persistence, no simulation |

Everything below preserves the field names, status values and guard messages
already used by the tests (`tools/smoke.js`, `tools/pagetest.js`).

---

## 2. Target architecture

The **shipped reference implementation** (§12) realises this with the Python
standard library only  --  no third-party packages, no separate DB server:

```
Browser (unchanged UI)  + js/api.js adapter (live by default)
    │  fetch /api/call, /api/state   ▲  Server-Sent Events /api/events
    ▼                                │
┌──────────────────────────────────────────────────────┐
│  server/app.py     ThreadingHTTPServer                 │
│  ├─ server/auth.py   sessions + RBAC (bearer tokens)   │
│  ├─ server/engine.py Flow.* / Maint.* port + dispatcher│
│  └─ server/app.py    static files + REST + SSE hub     │
├──────────────────────────────────────────────────────┤
│  server/workers.py   background world-clock thread     │
│  ├─ maintenance schedule check                         │
│  ├─ reminder loop (15.3 / 16)                          │
│  ├─ dependency follow-ups (8.x)                        │
│  └─ rescheduled-job activation                         │
├──────────────────────────────────────────────────────┤
│  server/db.py   SQLite (WAL)  --  normalised tables       │
│  server/seed.py canonical seed (port of js/store.js)   │
└──────────────────────────────────────────────────────┘
```

A relational database is recommended because the domain is a small set of
well-defined entities with a strict state machine and an append-only history;
row-level integrity + foreign keys match the workflow better than a document
store. A single service is enough  --  no microservices needed.

> **Production note.** For a real deployment, drop `http.server` for a WSGI/ASGI
> framework, swap the bearer demo tokens for Google Workspace OIDC (§4), and
> replace the per-mutation full snapshot in `db.save_state` with row-level
> writes. The engine, guards and API shape stay the same. The reference service
> is deliberately dependency-free so the prototype can be evaluated with nothing
> but a Python interpreter.

---

## 3. Domain model

Entities below are a 1:1 transcription of the prototype's data shapes.
IDs are server-generated from per-kind sequences (today: `db.seq`).

### 3.1 `tickets`

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | `IT-YYYY-NNNNNN` |
| `office`, `requester`, `category`, `source` | text | intake fields (source: email/telephone/walk-in/on-site) |
| `issue` | text | |
| `asset` | text | per CMMS/asset naming (`PC-OF-118`) |
| `attachments` | text[] | object-storage keys |
| `status` | enum | `submitted · needs_info · assigned · in_progress · on_hold · resolved · closed · cancelled` |
| `impact`, `urgency` | enum | High/Medium/Low |
| `priority` | enum | low/medium/high/critical |
| `target` | date | target completion |
| `technician` | text | assignee |
| `reviewed` | bool | assessment complete |
| `linkedTo` | text? | previous ticket (recurrence / corrective) |
| `recurring` | bool | |
| `cancelReason` | text? | |
| `closure` | enum? | `confirmation` \| `authorized` |
| `authorizedReason` | text | |
| `resolvedAt`, `closedAt`, `createdAt`, `updatedAt` | timestamp | |
| `holdReturn` | text | status to restore after a dependency resolves |
| `diagnosis` | object | `{ findings, actions, parts, cost, labor, dates, evidence[] }` |
| `confirmation` | object | `{ state: none/pending/accepted/rejected/no_response, person, date, feedback }` |
| `dependency` | object? | `{ reason, responsible, nextAction, state: pending/resolved/blocked, dueAt, updates[] }` |
| `tests` | array | `{ at, by, result: pass/fail, note }` |
| `reminders` | timestamp[] | follow-up reminders sent |
| `history` | array | append-only audit trail (see 3.5) |
| `rev` (optimistic lock) | int | see §9 |

### 3.2 `schedules`

`id (SCH-YYYY-NNN) · office · assets[] · category · checklist[] · frequency
(weekly/monthly/quarterly/semiannual/annual) · dueDate · technician · active ·
lastCheck · nextCheck`

### 3.3 `jobs`

`id (MNT-YYYY-NNNN) · scheduleId FK · occurrence (date) · office · assets[] ·
technician · category · checklist[] · items[] · status · availability ·
visitDate · reschedules[] · additionalFault (yes/no/unknown) · linkedTicketId FK ·
outcome · outcomeNotes · confirmation · nextDue · createdAt`

- `items`: `{ task, done, result, finding, tech, date, evidence[] }`
- `reschedules`: `{ from, to, reason, at, by, role }`
- `status`: `generated · coord_visit · rescheduled · in_progress ·
  done_awaiting_confirm · outcome_recorded · closed`
- Uniqueness: **one job per `(scheduleId, occurrence)`**  --  this is how
  `runScheduleCheck` avoids duplicating jobs. Enforce with a unique index.

### 3.4 `notifications`

`id · at · role (requester/coordinator/technician/any) · kind · ticketId? ·
jobId? · office? · text · read`

### 3.5 `history` (audit entries, per ticket/job)

`at · by · role · status · kind (status/note/cancel/dep/test/confirm/remind/
link) · text`

Recommendation: promote `history` to a single `audit_events` table with a
polymorphic `subject_type`/`subject_id`, so a global audit feed and the report
exports read from one place. Keep the exact `kind` vocabulary above.

### 3.6 Configuration & counters

- `settings`: `reminderMinutes`, `tickMs`, (`simulate` is prototype-only)
- sequences: `ticket`, `sched`, `job`, `notif`  --  replace with DB sequences /
  identity columns and server-side ID formatting.

---

## 4. Roles & access control

Sign-in is **Google Workspace only**  --  there are no local passwords. In the
prototype `login.html` simulates the Google account chooser and stores the
chosen identity in `db.auth` (`{ name, email, role, office, signedInAt }`),
which also sets the active role `db.role`. The server must become the source of
truth.

| Persona (prototype) | Role | Screen access (`ACCESS` in `js/ui.js`) | Example permissions |
|---|---|---|---|
| Office Requester | `requester` | dashboard, tickets, new request, reports, roles*, flowchart | create ticket; supply missing info; accept/reject result; confirm office availability / agree a new maintenance date; cancel own request; confirm maintenance |
| IT Technician | `technician` | dashboard, tickets, my work, maintenance, reports, roles*, flowchart | coordinate the service schedule; start work; diagnose; record repair actions; place/resolve dependency; record tests; run maintenance checklist; record outcome |
| IT Coordinator | `coordinator` | dashboard, tickets, new request, review & assign, maintenance, confirmation, reports, roles*, flowchart | request info; assess; assign; coordinate schedule; cancel; close; confirm/close maintenance; view roles & access reference |
| System Administrator | `management` | dashboard, tickets, register, maintenance (read-only), reports, notifications, audit, users, offices, settings, profile, roles*, flowchart | read-only oversight of the operational workflow  --  no ticket/job transitions; **administration**: accounts, offices, reference data, audit log |
| System worker | `system` | (no user) | reminders, schedule checks, dependency nudges |

\* `roles.html` (the capability matrix) is readable by every role; only the
Coordinator and the System Administrator (`management`) see the administration
controls on it.

The role model, the screen-access map (`ACCESS`) and the full capability matrix
(`CAPS`) are defined **once** in `js/ui.js`; the workflow guards in `js/flow.js`
pass the matching role lists to `guardRole([...])`. `management` appears in no
*operational* guard, so it is inherently read-only on tickets, jobs and
schedules; it appears only in the administrative guards (`Admin` save/rename/
activate), which the System Administrator owns. Lanes stay strictly separated: a role sees
only its own screens and action buttons, the sidebar never renders an empty
group, and shared screens (maintenance, the ticket record, the dashboard) show
read-only notices instead of actions the role cannot perform.

Enforcement:
1. **Authenticate** each request via Google OIDC (Workspace domain restricted to
   `@upcebu.edu.ph`) and resolve the account → user → role + office. **Shipped:**
   `server/oidc.py` verifies Google `id_token`s with no third-party libraries
   (RS256 against the JWKS, plus issuer/audience/expiry/verified-e-mail/hosted-
   domain checks) and `auth.login_google` maps the e-mail to a user, provisioning
   novel in-domain accounts as requesters. The role-based demo sessions remain the
   fallback when no client id is configured.
2. **Authorize** server-side using the same role lists currently passed to
   `guardRole([...])` in `js/flow.js`, and the same page map in `js/ui.js`
   (`ACCESS`)  --  mirror them exactly so the UI's promises stay true. Unauthorized
   requests return the same shape as the client guard:
   `{ ok: false, msg: 'Blocked by role-based access (28.2).' }` → HTTP 403.
3. Additionally scope by ownership where the prototype implicitly assumes it
   (a requester only sees/acts on their office's tickets). **Shipped:** the server
   scopes a requester's `/api/state` (and reports) to their office and rejects
   cross-office transitions with
   `{ ok: false, msg: 'Blocked by office-based access (28.2).' }`; `createTicket`
   forces the requester's own office; bulk `/api/state` replacement is limited to
   coordinator/management. The acting user is threaded through `engine.call(..., user=...)`.

---

## 5. Workflow engine → server state machine

Port each `Flow.*` / `Maint.*` method to a guarded transition. The guard order in
the prototype (role → existence → status → required fields) should be preserved
so error messages and tests match. Each successful transition:

1. validates the guard,
2. mutates the entity,
3. **appends a `history`/audit row**, and
4. **emits notifications** to the roles the prototype notifies.

| Prototype method | Transition | Endpoint (proposed) | Allowed roles |
|---|---|---|---|
| `createTicket` | → `submitted` | `POST /tickets` | requester, coordinator, technician |
| `submitInfo` | `needs_info` → `submitted` | `POST /tickets/:id/info` | requester, coordinator |
| `requestInfo` | `submitted` → `needs_info` | `POST /tickets/:id/request-info` | coordinator |
| `assess` | sets impact/urgency/priority/target | `POST /tickets/:id/assess` | coordinator |
| `assign` | `submitted` → `assigned` (needs `reviewed`) | `POST /tickets/:id/assign` | coordinator |
| `coordinate` | schedule record (no status change) | `POST /tickets/:id/schedule` | coordinator, technician |
| `cancel` | → `cancelled` (non-terminal only) | `POST /tickets/:id/cancel` | coordinator, requester |
| `followUp` | dependency update (pushes due date) | `POST /tickets/:id/dependency/follow-ups` | coordinator, technician |
| `resolveDependency` | `on_hold` → `holdReturn` | `POST /tickets/:id/dependency/resolve` | coordinator, technician |
| `cancelFromDependency` | → `cancelled` | `POST /tickets/:id/dependency/cancel` | coordinator |
| `startWork` | `assigned` → `in_progress` | `POST /tickets/:id/start` | technician |
| `diagnose` | records diagnosis | `POST /tickets/:id/diagnosis` | technician |
| `recordRepair` | records repair actions/parts/costs/labour/evidence (distinct from diagnosis) | `POST /tickets/:id/repair` | technician |
| `placeHold` | `in_progress` → `on_hold` | `POST /tickets/:id/hold` | technician |
| `recordTest` | pass → `resolved`; fail → stays `in_progress` | `POST /tickets/:id/tests` | technician |
| `officeDecision` | accept/reject/no-response | `POST /tickets/:id/confirmation` | requester, coordinator |
| `close` | `resolved` → `closed` (confirmation **or** authorized reason) | `POST /tickets/:id/close` | coordinator |
| `sendReminder` | follow-up reminder | `POST /tickets/:id/reminders` | system/coordinator |
| `createLinkedTicket` | new ticket linked from a `closed` one | `POST /tickets/:id/linked` | requester, coordinator |
| `createSchedule` | new schedule | `POST /schedules` | coordinator |
| `rescheduleJob` | job (+schedule) → `rescheduled` | `POST /jobs/:id/reschedule` | coordinator, technician, requester |
| `confirmAvailability` | job → `coord_visit` | `POST /jobs/:id/availability` | coordinator, technician, requester |
| `recordChecklistItem` | job → `in_progress`, item recorded | `POST /jobs/:id/items/:idx` | technician |
| `createFaultTicket` | linked corrective ticket | `POST /jobs/:id/fault-ticket` | technician |
| `recordOutcome` | success → `done_awaiting_confirm`; also computes `nextDue` | `POST /jobs/:id/outcome` | technician, coordinator |
| `jobConfirmation` | accept → `closed`; reject → `in_progress` | `POST /jobs/:id/confirmation` | coordinator, requester |

**Critical invariants to keep server-side:**
- Resolved means *technician testing passed*.
- Cancelled records are preserved and excluded from completed totals.
- Success cannot be recorded while a checklist is incomplete or the
  "additional fault?" question is unanswered (`Maint.recordOutcome` guards).
- Closing by confirmation requires `confirmation.state === 'accepted'`;
  otherwise an `authorized` reason is mandatory.
- Dependency resolution restores the previous active status (`holdReturn`).
- Recurrence/linked tickets create a **new** ticket; supplying missing info does
  **not** create a duplicate (`submitInfo` updates the same ticket).
- `nextDue` = `dueDate + frequency` (weekly 7, monthly 30, quarterly 91,
  semiannual 182, annual 365 days).

---

## 6. Background workers (port of `js/live.js`)

These must run server-side on a schedule (cron / job queue), not in the browser:

1. **Maintenance schedule check** (`Maint.runScheduleCheck`): for each active
   schedule whose `dueDate <= now`, generate a linked job for that occurrence
   **unless one already exists** (unique `scheduleId+occurrence`), and notify
   technician + coordinator.
2. **Resolved-confirmation reminder loop** (15.3/16): for `resolved` tickets with
   `confirmation.state = 'pending'`, send a follow-up every
   `settings.reminderMinutes` until confirmed/closed.
3. **Dependency follow-up** (8.x): when `dependency.dueAt <= now` and state is
   `pending`, notify the coordinator and push the due date forward (no spam).
4. **Rescheduled-job activation**: when a `rescheduled` job's `visitDate`
   arrives, move it to `coord_visit` and notify the technician.

The prototype's random "simulated intake" (`settings.simulate`) is a **demo-only**
feature and should not exist in production.

---

## 7. Realtime

Replace `BroadcastChannel` + `storage` polling with a push channel:

- **WebSocket** (or SSE where push-only is enough): clients subscribe per role
  (and per office for requester tenancy).
- Server events: `notification.created`, `ticket.updated`, `job.updated`,
  `schedule.updated`  --  each carrying the affected id + `rev`.
- The client can then refetch just that resource or apply the diff; the existing
  `Store.subscribe` render callbacks stay the same.

**Shipped:** the reference server exposes an SSE stream at `GET /api/events`
(push-only, which is all the prototype needs). Each mutation or worker tick
publishes `{ type, rev, by, method }`; [`js/api.js`](js/api.js) re-pulls
`GET /api/state` and calls `Store.adopt(...)`, so every open tab re-renders
through the existing subscriber callbacks. Swapping to WebSocket later is a
transport detail behind the same hub.

---

## 8. API conventions

- JSON request/response; every mutation returns the same envelope the UI already
  expects: `{ ok: boolean, msg: string, id?: string }`, plus the updated resource.
- Errors carry the prototype's human-readable `msg` so toasts are unchanged.
- List endpoints support the filters the reports screen uses (office, category,
  status, date range, technician, source).
- Suggested resources:

```
GET/POST   /tickets                 GET /tickets/:id
POST       /tickets/:id/{info,request-info,assess,assign,schedule,cancel,
                         dependency/follow-ups,dependency/resolve,
                         dependency/cancel,start,diagnosis,repair,hold,tests,
                         confirmation,close,reminders,linked}
GET/POST   /schedules               GET /schedules/:id
GET        /jobs                    GET /jobs/:id
POST       /jobs/:id/{reschedule,availability,items/:idx,fault-ticket,
                      outcome,confirmation}
GET        /notifications           POST /notifications/read
GET        /reports/...             (derived; step 29 outputs)
POST       /attachments             (presigned upload) → returns storage key
```

---

## 9. Concurrency, IDs, audit

- **Optimistic locking**: the prototype already tracks `db.rev` on every
  `Store.update`. Expose it as an `ETag` / `If-Match` (or `?rev=`) so a stale
  write returns `409 Conflict` instead of silently clobbering a colleague's
  change. This matters once multiple users share a database (the single-browser
  prototype never had real concurrency).
- **IDs**: server sequences formatted as today (`IT-YYYY-NNNNNN`, `SCH-YYYY-NNN`,
  `MNT-YYYY-NNNN`) so the UI and reports don't change.
- **Audit**: every mutation appends to `audit_events`; never mutate history.
- **Attachments/evidence**: move filenames to object storage; DB stores keys.
  (Today they are just strings in the JSON blob.)

---

## 10. Demo / deterministic mode

`?demo=1` must remain a **read-only, client-side** concept for screenshots and
QA (`tools/shots.py`, `tools/responsive.py`, `tools/smoke.js`, `tools/pagetest.js`).
It returns the canonical seed with a frozen clock and bypasses the network
entirely, so tooling keeps working without a server. No backend change required  -- 
but the server must **never** be required for demo mode, and demo mode must never
write to storage.

---

## 11. Migration path from `localStorage`

1. **Extract the seam.** The UI already talks to `window.Store` /
   `window.Flow` / `window.Maint` only. Introduce an async data adapter behind
   those same method names (`createTicket`, `assign`, …) so pages are untouched.
2. **Read-through.** Point `Store.load()` at `GET /tickets|schedules|jobs|
   notifications` instead of `localStorage`; keep the in-memory shape identical.
3. **Write-through.** Have each `Flow.*`/`Maint.*` call issue its REST request and
   apply the server's returned resource, then `fire()` subscribers.
4. **Realtime.** Swap `BroadcastChannel` for the WebSocket subscription.
5. **One-time data import.** Offer a `POST /import` that accepts the exact
   `itc_db_v3` blob shape so an office can migrate an existing browser dataset.
6. **Auth.** Replace the role `<select>` with real sign-in; keep the three roles
   and their permission lists unchanged.

Because the workflow rules are already isolated in `js/flow.js`, this is a
transport swap  --  the state machine, guards, audit text and notification wording
carry over verbatim.

**Shipped:** steps 1–4 are implemented by [`js/api.js`](js/api.js) + the server:
`Flow.*`/`Maint.*` are proxied to `POST /api/call` (server-authoritative, RBAC
enforced), `GET /api/state` is the read-through, `Store.adopt` applies the
returned snapshot, and SSE/`js/api.js` handles realtime. Step 5 is
`POST /api/state` (or `/api/import`), which already accepts the exact
`itc_db_v3` blob shape. Step 6 remains a deployment choice  --  the reference server
ships role-based demo sessions (`POST /api/login {role}`) and PBKDF2 local
accounts so the role model can be exercised today.

---

## 12. Reference implementation (shipped)

Zero-dependency Python 3 standard library service in [`server/`](server/); see
[`server/README.md`](server/README.md) for the full operator guide.

| File | Responsibility |
|---|---|
| `server/db.py` | SQLite schema, `State` (in-memory dataset + `load_state`/`save_state`), WAL, `now_iso` |
| `server/seed.py` | Canonical seed  --  a direct port of the `js/store.js` seed |
| `server/engine.py` | Port of `Flow.*` / `Maint.*` + `world_tick`, `METHODS`/`call` dispatcher, requester tenancy + delivery hook |
| `server/auth.py` | Users (PBKDF2) + sessions; token → role; Google claim → user mapping; notification contacts |
| `server/oidc.py` | Google Workspace `id_token` verification  --  pure-stdlib RS256 + claim rules |
| `server/delivery.py` | Notification delivery: outbox / console / SMTP e-mail / SMS webhook |
| `server/workers.py` | Background world-clock thread (schedule/reminder/dependency/reschedule) |
| `server/app.py` | `ThreadingHTTPServer`: static files + REST + SSE hub + CLI |
| `server/tests.py` | 271 assertions: engine, RBAC, tenancy, OIDC, delivery, persistence, HTTP, SSE, seed shape, site serving |

**HTTP surface**

```
GET  /api/health                 public  → {ok, rev, googleClientId, channels}
POST /api/login                  {username,password} | {role} | {credential} → {token,user,state}
POST /api/logout                 bearer
GET  /api/state                  bearer  → dataset (office-scoped for a requester)
POST /api/call                   {method,args} → {ok,msg,id?,state}   (server-authoritative)
GET  /api/events?token=          Server-Sent Events
GET  /api/reports                aggregate report
GET  /api/notifications/outbox   delivery log + channel stats (coordinator/management)
POST /api/tick                   run one world-clock tick (tests/ops)
POST /api/reset                  re-seed (coordinator/management)
POST /api/state | /api/import    replace dataset from an `itc_db_v3`-shaped blob (coordinator/management)
```

`POST /api/call` resolves the caller's bearer token to a role, invokes the same
`METHODS` map that mirrors the JS camelCase names (`requestInfo`, `assign`,
`recordOutcome`, …), and enforces the identical `guardRole([...])` lists  --  the
client **cannot** declare its own role. Guards return the prototype's exact
message (`Blocked by role-based access (28.2).`) and the same `{ok,msg}` envelope.

**Security & data choices**

- Every mutating route requires a bearer token; `/api/state` and `/api/events`
  too. Static serving is path-traversal-guarded and never exposes `server/`.
- Requesters are **office-scoped** on read and write (SOP 28.2); bulk
  import/reset is coordinator/management only. Google OIDC (when configured) and
  the delivery channels are additive  --  the core engine stays a straight port.
- `db.save_state` rewrites the normalised tables from the in-memory dataset
  (tiny prototype dataset) under a re-entrant lock; SQLite runs in WAL mode with
  `check_same_thread=False`. This keeps the engine a straight port of the JS.
- IDs, statuses, history `kind`s and notification wording are byte-for-byte the
  prototype's, so the existing suites (`tools/smoke.js`, `tools/pagetest.js`)
  still describe the system truthfully.

**Client adapter**

[`js/api.js`](js/api.js) stays dormant unless the backend injects
`window.ITC_API=true` (and for the `?demo=1` screenshots the QA tools serve the
files statically, so the bundled seed dataset is used). When the page is served
by the backend it is live by default. In API mode it:

1. logs in the current role and `Store.adopt`s the server dataset;
2. replaces `window.Flow`/`window.Maint` with proxies that call `/api/call`;
3. pushes direct `Store.update(...)` edits (sign-in, bell read) to
   `POST /api/state` via the `window.__itcPersistHook` seam in `js/store.js`;
4. opens the SSE stream and re-pulls on server events;
5. degrades gracefully to local demo mode if the backend is unreachable;
6. prefers a stored Google session (`sessionStorage.itc_session`) and exposes
   `Api.loginWithCredential(idToken)` for real Workspace sign-in;
7. never pushes a scoped requester snapshot back over the server, and re-pulls
   (server-authoritative) when the role changes.

**Verification**

```bash
python server/tests.py        # 271 passed
python tools/api_check.py     # 17 passed  (real Chrome over CDP; live by default)
python tools/validate.py      # static validation
node tools/smoke.js           # 54 passed
node tools/pagetest.js        # 232 passed
python tools/responsive.py    # 0 problems (71 pages × 5 viewports, CDP-measured)
```

## 13. Non-functional

- **Reporting (step 29)** becomes SQL/aggregate queries over the same tables;
  keep cancelled tickets out of completed totals.
- **Time**: store UTC ISO-8601; format in the UI.
- **Retention**: tickets/jobs are never hard-deleted (cancel/close only), which
  matches the PDF's "records preserved" requirement.
- **Security**: RBAC on every route (not just UI), server-side validation of all
  required fields the client currently checks, and signed attachment URLs.
- **Observability**: log every state transition with actor + before/after status.

---

## 14. Open questions

**Resolved in the reference server:**
- **Tenancy**  --  requester reads and actions are scoped to their office (SOP 28.2);
  coordinators/management see every office.
- **Out-of-app delivery**  --  `server/delivery.py` supports outbox / console /
  SMTP e-mail / SMS webhook for the reminder and notification loops.
- **Auth provider**  --  Google Workspace OIDC (`server/oidc.py`) with the
  role-based demo sessions as a configuration-free fallback.

**Still open:**
- Production hosting/runtime (the rules port cleanly to any framework).
- Whether the System Administrator (`management`) should gain any operational workflow transitions (currently read-only on tickets/jobs; it owns the admin screens instead).
