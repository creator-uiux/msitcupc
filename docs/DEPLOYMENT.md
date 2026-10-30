# Deployment runbook

Getting this repository onto a host that other people sign in to.

There is no build step. What ships is a folder of HTML, CSS and JavaScript
served by one Python process over one SQLite file. Everything below assumes
that shape.

The rules that survive deployment are the ones in `AGENTS.md`: the permission
map in `permissions.json` is enforced on the server, the audit trail is
append-only, Google sign-in is limited to `@upcebu.edu.ph`, and the four demo
accounts stay listed on the sign-in page labelled "Demo only". Deployment
changes which of those a person can reach with real data, not whether the page
shows them.

---

## 1. What the host needs

| Need | Note |
|---|---|
| Python 3 with the standard library | no `pip install`, no Node, no build. Verified on 3.14 with the bundled `sqlite3` |
| One writable directory for the SQLite file | the database, its WAL sidecar and the attachment bytes all live there |
| A TLS-terminating proxy | the process speaks plain HTTP. Put Caddy or nginx in front, or bind it on the same machine as the proxy |
| Time on the host | the world-clock worker advances the schedule check, the reminders and the dependency follow-ups from the wall clock |

Check the interpreter before anything else:

```bash
python -c "import sqlite3, sys; print(sys.version.split()[0], sqlite3.sqlite_version)"
```

---

## 2. Configure

```bash
cp .env.example .env      # then fill it in; .env is git-ignored
```

The three decisions to make here, and what each one actually does:

| Setting | Left blank | Set |
|---|---|---|
| `ITC_GOOGLE_CLIENT_ID` | the demo login is the only way in | the login page offers real Google sign-in and `server/oidc.py` verifies the token itself |
| `ITC_DEMO_MODE` | on for a loopback bind, off for a network-facing bind | `0` closes the server-side demo gate explicitly |
| `ITC_NOTIFY_CHANNELS` | `outbox` only, so every delivery is recorded and nothing is sent | add `email` (with `ITC_SMTP_*`) or `sms` (with `ITC_SMS_*`) |

`ITC_ALLOWED_DOMAINS` defaults to `upcebu.edu.ph` and should stay that way: it
is the hosted-domain rule, and an account in the domain that has no record of
its own is provisioned as an Office Requester rather than given a louder role.

The Google client id is a public value; `ITC_SMTP_PASS` and `ITC_SMS_TOKEN` are
not, so they belong in `.env` on the host and in no commit.

---

## 3. First run

```bash
git clone <this repository> /srv/itc
cd /srv/itc
set -a; . ./.env; set +a
python server/app.py --host 127.0.0.1 --port 8787 --db /srv/itc-data/itc.sqlite3
```

Then, in another shell, prove the four things that matter:

```bash
curl -s http://127.0.0.1:8787/api/health
```

`googleClientId` non-empty means real sign-in is wired, `demo` false means the
server-side demo gate is closed, and `channels` says what will actually leave
the building. A `demo: true` on a network-facing host means `ITC_DEMO_MODE` was
not set and the bind is not loopback; fix it before anyone else arrives.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/login.html
curl -s -X POST http://127.0.0.1:8787/api/login -d '{"role":"coordinator"}'
```

The second call is the check that the demo gate is closed: on a
network-facing host with `ITC_DEMO_MODE=0` it returns the refusal rather than a
token. The first proves the site is served.

Finally, run the gate suite on the target machine, not only on the machine that
wrote the code:

```bash
python server/tests.py
node tools/pagetest.js
python tools/permission_parity_check.py
```

---

## 4. HTTPS

Terminate TLS in front of the process and pass the real host through, because
the sign-in page, the manifest and the cookie-free bearer tokens all assume one
origin.

Caddy, which takes care of the certificate on its own:

```
maintenance.upcebu.edu.ph {
    reverse_proxy 127.0.0.1:8787 {
        flush_interval -1
    }
}
```

`flush_interval -1` matters: `GET /api/events` is a Server-Sent Events stream,
and a proxy that buffers it holds every change notification until the response
completes, so open screens stop refreshing.

nginx equivalent for the same two points:

```
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # the SSE stream
    proxy_read_timeout 3600s;
}
```

Keep the Python process on `127.0.0.1`. It has no TLS listener, and a bind to
`0.0.0.0` puts an unauthenticated-looking HTTP port on the network even when
the demo gate is closed.

---

## 5. Put the people in

Sign-in proves who a person is; the role comes from a record, not from the
token. Order of work:

1. Sign in as a real `@upcebu.edu.ph` account so it exists in the `users` table.
   A first-time in-domain account lands as an Office Requester.
2. Open **Accounts** (`users.html`) as Administration and set the role, the
   office and the active state for each person who needs a working role. The
   coordinator and technician lanes only ever open for an account the record
   says so.
3. Open **Offices** (`offices.html`) and correct the directory: contact person,
   e-mail, phone, code and location. An office referenced by an account but
   missing from the directory still appears there, so the list shows what is
   actually in use.
4. Open **Assets** (`assets.html`) and register the units, office by office.
   Intake offers the numbers of the office in hand as suggestions and still
   accepts an unregistered one, so a unit that was never registered remains
   writable and a ticket never blocks on a missing record.
5. Check **Settings** (`settings.html`): the categories, priorities, sources and
   maintenance frequencies, the reminder interval, the approval categories and
   the authorized closure roles. `settings.roleActions` may only narrow the
   shipped permission map, never widen it.
6. **Audit Log** (`audit.html`) is the evidence trail from here on. It is
   append-only and no client can edit or delete it.

The seeded demo dataset comes with the database. The owner has chosen to keep
it: it is labelled as demo data everywhere it appears, and the four demo
accounts stay on the sign-in page on every host. What a deployment changes is
that a demo account no longer reaches server data once `ITC_DEMO_MODE=0`.

To replace the dataset with real records, use `POST /api/import` as
Administration rather than deleting rows (the route is limited to the
administrator lane): every
incoming ticket must carry one of the eight statuses, and the history, the
comments and the audit trail may only grow.

---

## 6. Backup and restore

One file is the whole system: tickets, schedules, jobs, notifications, audit
events, users, sessions, the delivery outbox and the attachment bytes.

Backup, without stopping the process (WAL mode allows it, and `.backup` takes a
consistent copy rather than a torn one):

```bash
sqlite3 /srv/itc-data/itc.sqlite3 ".backup '/srv/itc-backups/itc-$(date +%Y%m%d-%H%M).sqlite3'"
```

If the host has no `sqlite3` command line tool (Python's module is enough to
run the app, but not to take this backup), the same copy in Python:

```bash
python - <<'PY'
import sqlite3, time
src = sqlite3.connect("/srv/itc-data/itc.sqlite3")
dst = sqlite3.connect("/srv/itc-backups/itc-%s.sqlite3" % time.strftime("%Y%m%d-%H%M"))
src.backup(dst)
dst.close(); src.close()
PY
```

A file copy of a running WAL database is not safe on its own: it needs the
`-wal` sidecar, and the pair can disagree with the main file. Use `.backup`, or
copy all three files only after the process is stopped.

Restore:

```bash
python server/app.py --db /srv/itc-backups/itc-20261030-0200.sqlite3 --no-worker
```

`--no-worker` first, deliberately. Start with the world clock stopped, open the
site, sign in as Administration and read the audit log to confirm the rev and
the records are the ones expected. Then stop it and start the normal unit.
A tick that runs against the wrong file would write reminders into the copy.

Keep at least seven daily copies and one per month, and confirm a restore works
before a restore is needed.

---

## 7. Run it as a service

```ini
# /etc/systemd/system/itc.service
[Unit]
Description=ITC Maintenance System
After=network-online.target

[Service]
User=itc
WorkingDirectory=/srv/itc
EnvironmentFile=/srv/itc/.env
ExecStart=/usr/bin/python server/app.py --host 127.0.0.1 --port 8787 --db /srv/itc-data/itc.sqlite3
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

No `--reset` in the unit: it re-seeds the demo dataset and would rebuild it on
every restart. Start it with `systemctl start itc` after `daemon-reload`, and
watch the journal for the startup banner, which prints the bind, the site, the
storage path, the sign-in mode and the delivery channels in one block.

---

## 8. Day to day

| Question | Where the answer is |
|---|---|
| Is the clock moving? | `rev` in `GET /api/health` changes as the worker ticks; a value frozen for minutes means the worker died or `--no-worker` is in the unit |
| Did a notification go out? | `GET /api/notifications/outbox` as coordinator or Administration, with `ok` and the error text per channel |
| Who changed what? | `audit.html`, filterable by actor, subject and event |
| Something needs doing today? | each lane's own screen: the coordinator's Review and Assign, the technician's My Work, the office's Confirmation and Closure |
| A visit is not generated? | `POST /api/tick` as coordinator or Administration runs one turn by hand, and reports what it did |

---

## 9. What a deployment does not yet cover

Honest limits, restated from `docs/KNOWN_LIMITATIONS.md` in operational terms.

- **Plain HTTP only.** This process has no TLS listener, so the proxy in front
  is not optional.
- **One machine.** SQLite in WAL behind a single process. It is right for one
  helpdesk; it is not a clustered or multi-tenant database, and two hosts
  sharing one file over a network filesystem is not a scaling plan.
- **The clock stops when the process stops.** Ticks are not replayed after a
  restart; the next tick catches up on the state, not on the missed timer
  events.
- **Push notifications are not wired.** An open screen refreshes through the
  SSE hub and the notification centre is complete, but a closed browser is not
  woken. A push service needs VAPID keys and a subscription store that this
  repository does not have.
- **Attachments are not scanned.** Type and size are validated on the trusted
  layer, the bytes are stored in the database and served only through the
  authorised download route, and nothing looks inside them for malware.
- **The holiday calendar is typed, not imported.** The reminder interval skips
  the working week and the closed dates entered on `settings.html`, so a date
  nobody entered counts as a working day. Nothing reads an institutional
  calendar, and the service level window stays in calendar days.
- **No monitoring or alerting.** `GET /api/health` is the probe to hang a check
  on; the platform itself does not page anyone.
- **E-mail and SMS are configured, not proven from here.** The channels run, the
  credentials and the reachable relay are the deployment's, and the first send
  on a new host should be watched rather than assumed.

## 10. Rollback

The front end is a checked-out folder and the state is one SQLite file, so
rolling back is a `git checkout` of the site plus a restore of the database from
before the change. Do the database restore first if the newer build wrote
records the older engine cannot read, and re-run the three checks in section 3
before opening the site to people again.
