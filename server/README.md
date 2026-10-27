# ITC Maintenance System  --  backend (`server/`)

A zero-dependency **Python 3 standard library** service that runs the exact
workflow the prototype already enforces in `js/flow.js` / `js/live.js`, backed by
SQLite, with RBAC, background workers and Server-Sent Events.

Nothing else is required: no `pip install`, no Node, no build step, no external
database. On the tested machine it runs on **Python 3.14** with the bundled
`sqlite3`.

---

## Run it

```bash
# from the mockups/ folder
python server/app.py
```

```
ITC Maintenance System  --  serving http://127.0.0.1:8787/
  site      : http://127.0.0.1:8787/
  gallery   : http://127.0.0.1:8787/index.html
  health    : http://127.0.0.1:8787/api/health
  storage   : <mockups>/server/itc.sqlite3
  sign-in   : demo login (set ITC_GOOGLE_CLIENT_ID for real Google OIDC)
  delivery  : outbox
```

The process serves the **whole website**  --  the HTML/CSS/JS front end and the API
on one origin (no CORS, no second server, no build step). Open
`http://127.0.0.1:8787/` for the sign-in page; every page is **live against the
backend**  --  there is no user-facing API toggle.

| Flag | Meaning |
|---|---|
| `--host`, `--port` | bind address (default `127.0.0.1:8787`, `--port 0` = ephemeral) |
| `--db PATH` | SQLite file (default `server/itc.sqlite3`) |
| `--interval SECONDS` | world-clock tick period (default `9`) |
| `--no-worker` | disable the background worker (tests / read-only serving) |
| `--reset` | re-seed from the canonical dataset before serving |
| `--open` | open the site in your default browser after start |
| `--verbose` | log each HTTP request |
| `--google-client-id` | Google OAuth client id for real Workspace sign-in (else `ITC_GOOGLE_CLIENT_ID`) |
| `--allowed-domains` | comma-separated Workspace domains (else `ITC_ALLOWED_DOMAINS`, default `upcebu.edu.ph`) |
| `--channels` | notification channels `outbox,console,email,sms` (else `ITC_NOTIFY_CHANNELS`, default `outbox`) |

On Windows the `start.bat` in the project root launches the server and opens the
browser for you. When the backend is not running, the same pages still work as a
pure `localStorage` demo  --  the backend is never required. See `../BACKEND.md` for
the design narrative.

---

## Layout

| File | Responsibility |
|---|---|
| `db.py` | SQLite schema, `State` (in-memory dataset + `load_state`/`save_state`), WAL, `now_iso` |
| `seed.py` | Canonical seed  --  a direct port of the `js/store.js` seed |
| `engine.py` | Port of `Flow.*` / `Maint.*`, `world_tick`, the `METHODS` map and `call()` dispatcher |
| `auth.py` | Users (PBKDF2) + sessions; token → role resolution; Google claim → user mapping; notification contacts |
| `oidc.py` | Google Workspace id_token verification  --  RS256 signature check (pure stdlib) + claim rules |
| `delivery.py` | Notification delivery: outbox / console / SMTP e-mail / SMS webhook |
| `workers.py` | Background world-clock thread |
| `app.py` | `ThreadingHTTPServer`: static files + REST + SSE hub + CLI |
| `tests.py` | 271 assertions: engine, RBAC, tenancy, OIDC, delivery, persistence, HTTP, SSE, seed shape, site serving |

The engine keeps the prototype's method names (camelCase), status strings, guard
messages, history `kind`s and notification wording **verbatim**, so the existing
suites (`tools/smoke.js`, `tools/pagetest.js`) still describe the system.

---

## API

All mutating routes require `Authorization: Bearer <token>`. `POST /api/login`
issues one.

```
GET  /api/health                 public            → {ok, rev, googleClientId, channels}
POST /api/login                  {username,password} | {role} | {credential}
                                                    → {ok, token, user, state}
POST /api/logout                 bearer            → {ok}
GET  /api/state                  bearer            → dataset (office-scoped for a requester)
POST /api/call                   {method, args}    → {ok, msg, id?, state}
GET  /api/events?token=          SSE stream        → data: {type, rev, by, method} | {type:'tick', events}
GET  /api/reports                bearer            → aggregate counts
GET  /api/tickets                bearer            → server-side paged/filtered/sorted ticket list
GET  /api/users                  bearer (mgmt/coord) → people directory (role/office filters)
POST /api/users                  bearer (mgmt)     → create/update a person; rename cascades
POST /api/profile                bearer            → update own e-mail/phone/prefs/password
POST /api/upload                 bearer {base64…}  → store an attachment (bytes in SQLite)
GET  /api/attachment?id=         bearer            → stream one attachment's bytes
                                 bearer + ?token=  → the same, for a media element that
                                                      cannot carry an Authorization header
                                 Range: bytes=a-b  → 206 Partial Content, so a clip can seek
GET  /api/notifications/outbox   bearer (coord/management) → delivery log + channel stats
POST /api/tick                   bearer            → run one world-clock tick
POST /api/state  (= /api/import) bearer {state}    → replace dataset (coordinator/management)
POST /api/reset                  bearer            → re-seed (coordinator/management)
```

The role key `management` is presented throughout the UI as **System
Administrator** (persona M. Reyes): it is read-only on the ticket/job workflow
and owns the administrative screens  --  `/api/users`, offices, reference data and
the audit log.

### `POST /api/call`

`{ "method": "<camelCase>", "args": [ ... ] }`  --  the server resolves the token to
a role, invokes the same guarded transition the browser would, persists it, and
returns the refreshed dataset:

```bash
TOKEN=$(curl -s -XPOST localhost:8787/api/login -d '{"role":"coordinator"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

curl -s -XPOST localhost:8787/api/call -H "Authorization: Bearer $TOKEN" \
     -d '{"method":"requestInfo","args":["IT-2026-000143","serial number of the unit"]}'
```

The client **cannot** declare its own role  --  RBAC is enforced server-side and
unauthorised calls return the prototype's exact message:
`{"ok": false, "msg": "Blocked by role-based access (28.2)."}`.

A **requester** is additionally scoped to their own office (SOP 28.2): their
`/api/state` only contains that office's tickets/jobs/schedules, and acting on
another office's record returns
`{"ok": false, "msg": "Blocked by office-based access (28.2)."}`. Bulk
`/api/state` replacement is limited to coordinators/management.

Methods mirror `js/flow.js`: `createTicket`, `submitInfo`, `requestInfo`,
`assess`, `assign`, `coordinate`, `cancel`, `followUp`, `resolveDependency`,
`cancelFromDependency`, `startWork`, `diagnose`, `placeHold`, `recordTest`,
`sendReminder`, `officeDecision`, `close`, `createLinkedTicket`, `createSchedule`,
`rescheduleJob`, `confirmAvailability`, `recordChecklistItem`,
`flagAdditionalFault`, `createFaultTicket`, `recordOutcome`, `jobConfirmation`.

---

## Authentication

Seeded demo personas (password `itc`, but `{"role": "..."}` is a password-free
shortcut for the prototype):

| username | name | role | office | e-mail |
|---|---|---|---|---|
| `areyes` | A. Delos Reyes | requester | Records Office | `a.delosreyes@upcebu.edu.ph` |
| `kramos` | K. Ramos | coordinator | IT Office | `k.ramos@upcebu.edu.ph` |
| `jtan` | J. Tan | technician | IT Office | `j.tan@upcebu.edu.ph` |
| `mreyes` | M. Reyes | management | IT Office | `m.reyes@upcebu.edu.ph` |

Passwords are PBKDF2-HMAC-SHA256 (120k iterations) with per-user salt. Sessions
are opaque tokens in the `sessions` table; they are pruned after 24h on login.

### Google Workspace sign-in (optional)

Give the server a client id and it verifies real Google `id_token`s itself
(`server/oidc.py`, still no third-party libraries):

```bash
ITC_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com \
ITC_ALLOWED_DOMAINS=upcebu.edu.ph \
python server/app.py
```

The login page then loads Google Identity Services and posts the credential to
`POST /api/login {"credential": "..."}`. The backend checks the RS256 signature
against Google's JWKS plus issuer, audience, expiry, verified e-mail and hosted
domain, then maps the e-mail to a user (novel in-domain accounts are provisioned
as requesters). Without a client id the demo login above is used unchanged.

### Notification delivery

Every notification the engine writes is also delivered by `server/delivery.py` to
the users holding the target role (office-scoped when a match exists):

```bash
ITC_NOTIFY_CHANNELS=outbox,email,sms \
ITC_SMTP_HOST=smtp.upcebu.edu.ph ITC_SMTP_USER=it-helpdesk ITC_SMTP_PASS=... \
ITC_SMS_WEBHOOK=https://sms.example/send \
python server/app.py
```

`outbox` is always recorded and is readable at `GET /api/notifications/outbox`
(coordinator/management). A failing channel is logged with its error and never
breaks the workflow.

---

## Data & concurrency

- SQLite in **WAL** mode, `check_same_thread=False`, guarded by a re-entrant
  lock. The engine mutates the in-memory dataset and `save_state` rewrites the
  normalised tables  --  fine for the tiny prototype dataset, and it keeps the
  engine a straight port of the JS. Swap for row-level writes when scaling.
- **IDs** stay `TKT-YYYY-NNNN`, `SCH-YYYY-NNN`, `MNT-YYYY-NNNN` (sequences in the
  `seq` table).
- **History** is append-only; cancelled tickets are preserved, never deleted.
- Re-running the seed / `--reset` rebuilds the canonical demo dataset.

---

## Tests

```bash
python server/tests.py        # 271 assertions (quiet); add -v to list each
```

Covers the full ticket lifecycle and guards, dependency hold/resolve/cancel,
recurrence linking, the maintenance checklist → outcome → confirmation path,
rescheduled jobs, schedule generation idempotency, the world clock (reminder /
dependency / reschedule), requester office-tenancy, Google OIDC id_token
verification (signature + claim rules), notification delivery, SQLite
persistence round-trips, RBAC over HTTP, the SSE stream, static serving +
traversal protection, and the seed shape.

End-to-end through a real browser:

```bash
python tools/api_check.py     # 12 assertions; drives Chrome over CDP (live by default)
```
