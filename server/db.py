"""SQLite persistence + in-memory state for the ITC Maintenance backend.

The workflow engine (engine.py) works on an in-memory `State` dict whose shape
matches the browser prototype exactly (see js/store.js).  Each mutation is
written back to a normalised SQLite schema, so the data is a real relational
store (queryable for reports) while the engine port stays a faithful 1:1 copy of
js/flow.js.

Standard library only: sqlite3.
"""
import json
import os
import sqlite3
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "itc.sqlite3")

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, office TEXT, requester TEXT, category TEXT, source TEXT,
  issue TEXT, asset TEXT, attachments TEXT, status TEXT, impact TEXT, urgency TEXT,
  priority TEXT, target TEXT, technician TEXT, reviewed INTEGER DEFAULT 0,
  recurring INTEGER DEFAULT 0, linked_to TEXT, cancel_reason TEXT, closure TEXT,
  authorized_reason TEXT, resolved_at TEXT, closed_at TEXT, hold_return TEXT,
  created_at TEXT, updated_at TEXT, rev INTEGER DEFAULT 0,
  diagnosis TEXT, confirmation TEXT, dependency TEXT, reminders TEXT,
  previous_record TEXT
);

CREATE TABLE IF NOT EXISTS ticket_history (
  ticket_id TEXT, seq INTEGER, at TEXT, by TEXT, role TEXT, status TEXT,
  kind TEXT, text TEXT, PRIMARY KEY (ticket_id, seq)
);

CREATE TABLE IF NOT EXISTS ticket_tests (
  ticket_id TEXT, seq INTEGER, at TEXT, by TEXT, result TEXT, note TEXT,
  PRIMARY KEY (ticket_id, seq)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY, office TEXT, assets TEXT, category TEXT, checklist TEXT,
  frequency TEXT, due_date TEXT, technician TEXT, active INTEGER DEFAULT 1,
  last_check TEXT, next_check TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, schedule_id TEXT, occurrence TEXT, office TEXT, assets TEXT,
  technician TEXT, category TEXT, checklist TEXT, items TEXT, status TEXT,
  availability TEXT, visit_date TEXT, reschedules TEXT, additional_fault TEXT,
  linked_ticket_id TEXT, outcome TEXT, outcome_notes TEXT, confirmation TEXT,
  next_due TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, at TEXT, role TEXT, office TEXT, kind TEXT,
  ticket_id TEXT, job_id TEXT, text TEXT, read INTEGER DEFAULT 0, read_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, by TEXT, role TEXT,
  subject_type TEXT, subject_id TEXT, status TEXT, kind TEXT, text TEXT
);

CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS sequences (name TEXT PRIMARY KEY, value INTEGER);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, name TEXT,
  role TEXT, office TEXT, email TEXT, phone TEXT, pw_hash TEXT,
  active INTEGER DEFAULT 1, prefs TEXT
);

CREATE TABLE IF NOT EXISTS offices (
  name TEXT PRIMARY KEY, code TEXT, location TEXT, contact_person TEXT,
  contact_email TEXT, contact_phone TEXT, active INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  ticket_id TEXT, seq INTEGER, at TEXT, by TEXT, role TEXT,
  visibility TEXT, text TEXT, attachments TEXT, PRIMARY KEY (ticket_id, seq)
);

-- Uploaded file payloads.  Never rewritten by save_state(): the snapshot only
-- carries metadata (state["files"]), the bytes live here and are streamed back
-- through GET /api/attachment after an authorization check.
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, ticket_id TEXT, job_id TEXT, name TEXT, mime TEXT,
  size INTEGER, sha TEXT, uploaded_by TEXT, uploaded_role TEXT, at TEXT, data BLOB
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_office ON tickets(office);
CREATE INDEX IF NOT EXISTS idx_history_ticket ON ticket_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON ticket_comments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notif_role ON notifications(role);
CREATE INDEX IF NOT EXISTS idx_jobs_schedule ON jobs(schedule_id, occurrence);
CREATE INDEX IF NOT EXISTS idx_attach_ticket ON attachments(ticket_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER, role TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, channel TEXT, role TEXT,
  to_name TEXT, to_addr TEXT, subject TEXT, text TEXT, ticket_id TEXT,
  job_id TEXT, ok INTEGER DEFAULT 1, error TEXT
);
"""


def now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _j(v, default):
    if v is None:
        return default
    try:
        return json.loads(v)
    except (ValueError, TypeError):
        return default


def connect(path=DB_PATH):
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def _migrate(conn):
    """Additive migrations so an existing database keeps working."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}
    for name in ("email", "phone", "pw_hash"):
        if name not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN %s TEXT" % name)
    if "active" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1")
    if "prefs" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN prefs TEXT")
    ncols = {r["name"] for r in conn.execute("PRAGMA table_info(notifications)")}
    if "read_by" not in ncols:
        conn.execute("ALTER TABLE notifications ADD COLUMN read_by TEXT")
    tcols = {r["name"] for r in conn.execute("PRAGMA table_info(tickets)")}
    if "previous_record" not in tcols:
        conn.execute("ALTER TABLE tickets ADD COLUMN previous_record TEXT")
    if "idempotency_key" not in tcols:
        conn.execute("ALTER TABLE tickets ADD COLUMN idempotency_key TEXT")
    if "approval" not in tcols:
        conn.execute("ALTER TABLE tickets ADD COLUMN approval TEXT")

    # Duplicate maintenance jobs (same schedule occurrence) must be impossible
    # at the storage layer, not only in the engine.  Old databases are cleaned
    # once here (keeping the earliest job) before the unique index is created.
    conn.execute(
        "DELETE FROM jobs WHERE rowid NOT IN ("
        "  SELECT MIN(rowid) FROM jobs GROUP BY schedule_id, occurrence)")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_occurrence "
                 "ON jobs(schedule_id, occurrence)")

    # legacy job status vocabulary
    jobmap = {"generated": "submitted", "coord_visit": "assigned", "rescheduled": "on_hold",
              "done_awaiting_confirm": "resolved", "outcome_recorded": "resolved"}
    for old, new in jobmap.items():
        conn.execute("UPDATE jobs SET status = ? WHERE status = ?", (new, old))
    # normalize reminder mode
    try:
        row = conn.execute("SELECT v FROM settings WHERE k='reminderMode'").fetchone()
        if not row or not row["v"] or row["v"] in ("null", '""'):
            conn.execute("INSERT OR REPLACE INTO settings (k,v) VALUES ('reminderMode', ?)",
                         (json.dumps("business"),))
    except Exception:
        pass
    conn.commit()


def _seed_offices(conn):
    """Bootstrap the office registry from the offices already referenced."""
    if conn.execute("SELECT COUNT(*) c FROM offices").fetchone()["c"]:
        return
    from datetime import datetime, timezone
    names = set()
    for table, col in (("tickets", "office"), ("schedules", "office"),
                       ("jobs", "office"), ("users", "office")):
        try:
            for r in conn.execute("SELECT DISTINCT %s n FROM %s" % (col, table)):
                if r["n"]:
                    names.add(r["n"])
        except sqlite3.OperationalError:
            pass
    at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    for name in sorted(names):
        code = "".join(w[0] for w in name.split() if w[0].isalnum())[:4].upper()
        conn.execute(
            "INSERT OR IGNORE INTO offices (name, code, location, contact_person, "
            "active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (name, code, "", "", 1, at, at))


# ---------------------------------------------------------------- state load
# Reference data defaults  --  the settings screen edits these, the workflow and
# the UI read them from the snapshot so there is one source of truth.
DEFAULT_REF = {
    "categories": ["Hardware Repair", "Software Support", "Network and Connectivity",
                   "Account Assistance", "Printer and Peripheral",
                   "Installation and Configuration", "Other"],
    "sources": ["telephone", "email", "walk-in", "on-site", "online portal"],
    "priorities": [["low", "Low"], ["medium", "Medium"], ["high", "High"],
                   ["critical", "Critical"]],
    # key -> (label, days until the next occurrence).  The next due date is
    # always "previous due date + days", so a late visit never drifts the plan.
    "frequencies": [["weekly", "Weekly", 7], ["monthly", "Monthly", 30],
                    ["quarterly", "Quarterly", 91], ["semiannual", "Semi-annual", 182],
                    ["annual", "Annual", 365]],
}

# Operational defaults editable on the settings screen.  Kept here so a fresh
# database and the browser mirror agree without duplicating constants.
DEFAULT_SETTINGS = {
    "reminderMinutes": 2,
    "reminderMode": "business",
    "reminderBusinessDays": 3,
    "reminderRepeatDays": 7,
    "tickMs": 9000,
    "simulate": False,
    "slaDays": 5,
    "timezone": "Asia/Manila",
    "maxUploadBytes": 10 * 1024 * 1024,
    "authorizedClosureRoles": ["coordinator", "management"],
    "approvalCategories": [],
    "priorityMatrix": {
        "critical": {"high": "critical", "medium": "critical", "low": "high"},
        "high": {"high": "critical", "medium": "high", "low": "medium"},
        "medium": {"high": "high", "medium": "medium", "low": "low"},
        "low": {"high": "medium", "medium": "low", "low": "low"},
    },
    "roleActions": {},
}


def _ticket(row, hist, tests, comments):
    return {
        "id": row["id"], "office": row["office"], "requester": row["requester"],
        "category": row["category"], "source": row["source"], "issue": row["issue"],
        "asset": row["asset"], "attachments": _j(row["attachments"], []),
        "status": row["status"], "impact": row["impact"], "urgency": row["urgency"],
        "priority": row["priority"], "target": row["target"],
        "technician": row["technician"], "reviewed": bool(row["reviewed"]),
        "recurring": bool(row["recurring"]), "linkedTo": row["linked_to"],
        "idempotencyKey": row["idempotency_key"] if "idempotency_key" in row.keys() else "",
        "approval": _j(row["approval"], None) if "approval" in row.keys() else None,
        "cancelReason": row["cancel_reason"], "closure": row["closure"],
        "authorizedReason": row["authorized_reason"] or "",
        "resolvedAt": row["resolved_at"], "closedAt": row["closed_at"],
        "holdReturn": row["hold_return"], "createdAt": row["created_at"],
        "updatedAt": row["updated_at"], "rev": row["rev"],
        "diagnosis": _j(row["diagnosis"], {"findings": "", "actions": "", "parts": "", "cost": 0, "labor": 0, "dates": "", "evidence": []}),
        "confirmation": _j(row["confirmation"], {"state": "none", "person": "", "date": None, "feedback": ""}),
        "dependency": _j(row["dependency"], None),
        "reminders": _j(row["reminders"], []),
        "comments": comments,
        "tests": tests,
        "history": hist,
    }


def load_state(conn):
    st = {"v": 3, "rev": 1, "updatedAt": now_iso(), "role": "coordinator",
          "lastSim": 0,
          "settings": dict(DEFAULT_SETTINGS),
          "seq": {"ticket": 144, "sched": 33, "job": 62, "notif": 40, "hist": 500},
          "tickets": [], "schedules": [], "jobs": [], "notifications": [],
          "audit": [], "people": [], "offices": [], "files": []}
    for k, v in conn.execute("SELECT k, v FROM settings"):
        try:
            st["settings"][k] = json.loads(v)
        except ValueError:
            st["settings"][k] = v
    for k, v in DEFAULT_REF.items():  # older databases predate the ref data
        st["settings"].setdefault(k, v)
    for name, value in conn.execute("SELECT name, value FROM sequences"):
        st["seq"][name] = value
    hist = {}
    for r in conn.execute("SELECT * FROM ticket_history ORDER BY ticket_id, seq"):
        hist.setdefault(r["ticket_id"], []).append(
            {"at": r["at"], "by": r["by"], "role": r["role"], "status": r["status"],
             "kind": r["kind"], "text": r["text"]})
    tests = {}
    for r in conn.execute("SELECT * FROM ticket_tests ORDER BY ticket_id, seq"):
        tests.setdefault(r["ticket_id"], []).append(
            {"at": r["at"], "by": r["by"], "result": r["result"], "note": r["note"]})
    comments = {}
    for r in conn.execute("SELECT * FROM ticket_comments ORDER BY ticket_id, seq"):
        comments.setdefault(r["ticket_id"], []).append(
            {"id": "%s-C%02d" % (r["ticket_id"], r["seq"] + 1),
             "at": r["at"], "by": r["by"], "role": r["role"],
             "visibility": r["visibility"] or "public", "text": r["text"],
             "attachments": _j(r["attachments"], [])})
    for r in conn.execute("SELECT * FROM tickets ORDER BY created_at"):
        st["tickets"].append(_ticket(r, hist.get(r["id"], []), tests.get(r["id"], []),
                                     comments.get(r["id"], [])))
    for r in conn.execute("SELECT * FROM schedules ORDER BY id"):
        st["schedules"].append({
            "id": r["id"], "office": r["office"], "assets": _j(r["assets"], []),
            "category": r["category"], "checklist": _j(r["checklist"], []),
            "frequency": r["frequency"], "dueDate": r["due_date"],
            "technician": r["technician"], "active": bool(r["active"]),
            "lastCheck": r["last_check"], "nextCheck": r["next_check"]})
    for r in conn.execute("SELECT * FROM jobs ORDER BY created_at"):
        st["jobs"].append({
            "id": r["id"], "scheduleId": r["schedule_id"], "occurrence": r["occurrence"],
            "office": r["office"], "assets": _j(r["assets"], []),
            "technician": r["technician"], "category": r["category"],
            "checklist": _j(r["checklist"], []), "items": _j(r["items"], []),
            "status": r["status"], "availability": r["availability"],
            "visitDate": r["visit_date"], "reschedules": _j(r["reschedules"], []),
            "additionalFault": r["additional_fault"], "linkedTicketId": r["linked_ticket_id"],
            "outcome": r["outcome"], "outcomeNotes": r["outcome_notes"],
            "confirmation": _j(r["confirmation"], {"state": "none", "person": "", "date": None}),
            "nextDue": r["next_due"], "createdAt": r["created_at"]})
    for r in conn.execute("SELECT * FROM notifications ORDER BY id DESC"):
        st["notifications"].append({
            "id": r["id"], "at": r["at"], "role": r["role"], "office": r["office"],
            "kind": r["kind"], "ticketId": r["ticket_id"], "jobId": r["job_id"],
            "text": r["text"], "read": bool(r["read"]), "readBy": _j(r["read_by"], [])})
    for r in conn.execute("SELECT * FROM audit_events ORDER BY id"):
        st["audit"].append({
            "id": r["id"], "at": r["at"], "by": r["by"], "role": r["role"],
            "subjectType": r["subject_type"], "subjectId": r["subject_id"],
            "status": r["status"], "kind": r["kind"], "text": r["text"]})
    for r in conn.execute("SELECT * FROM offices ORDER BY name"):
        st["offices"].append({
            "name": r["name"], "code": r["code"] or "", "location": r["location"] or "",
            "contactPerson": r["contact_person"] or "", "contactEmail": r["contact_email"] or "",
            "contactPhone": r["contact_phone"] or "", "active": bool(r["active"]),
            "createdAt": r["created_at"], "updatedAt": r["updated_at"]})
    for r in conn.execute(
            "SELECT id, ticket_id, job_id, name, mime, size, uploaded_by, at "
            "FROM attachments ORDER BY at"):
        st["files"].append({
            "id": r["id"], "ticketId": r["ticket_id"], "jobId": r["job_id"],
            "name": r["name"], "mime": r["mime"] or "", "size": r["size"] or 0,
            "by": r["uploaded_by"] or "", "at": r["at"]})
    st["people"] = load_people(conn)
    return st


def load_people(conn):
    """User accounts as safe records  --  never carries pw_hash into the snapshot."""
    out = []
    for r in conn.execute("SELECT * FROM users ORDER BY id"):
        out.append({"id": r["id"], "username": r["username"], "name": r["name"],
                    "role": r["role"], "office": r["office"] or "",
                    "email": r["email"] or "", "phone": r["phone"] or "",
                    "active": True if r["active"] in (1, "1", None) else False,
                    "prefs": _j(r["prefs"], {})})
    return out


# ---------------------------------------------------------------- state save
def save_state(conn, st):
    conn.execute("DELETE FROM tickets")
    conn.execute("DELETE FROM ticket_history")
    conn.execute("DELETE FROM ticket_tests")
    conn.execute("DELETE FROM ticket_comments")
    conn.execute("DELETE FROM schedules")
    conn.execute("DELETE FROM jobs")
    conn.execute("DELETE FROM notifications")
    conn.execute("DELETE FROM settings")
    conn.execute("DELETE FROM sequences")

    for t in st["tickets"]:
        conn.execute(
            """INSERT INTO tickets (id,office,requester,category,source,issue,asset,
               attachments,status,impact,urgency,priority,target,technician,reviewed,
               recurring,linked_to,cancel_reason,closure,authorized_reason,resolved_at,
               closed_at,hold_return,created_at,updated_at,rev,diagnosis,confirmation,
               dependency,reminders,previous_record)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (t["id"], t.get("office"), t.get("requester"), t.get("category"), t.get("source"),
             t.get("issue"), t.get("asset"), json.dumps(t.get("attachments", [])),
             t.get("status"), t.get("impact"), t.get("urgency"), t.get("priority"),
             t.get("target"), t.get("technician"), 1 if t.get("reviewed") else 0,
             1 if t.get("recurring") else 0, t.get("linkedTo"), t.get("cancelReason"),
             t.get("closure"), t.get("authorizedReason", ""), t.get("resolvedAt"),
             t.get("closedAt"), t.get("holdReturn"), t.get("createdAt"), t.get("updatedAt"),
             t.get("rev", 0), json.dumps(t.get("diagnosis", {})),
             json.dumps(t.get("confirmation", {})), json.dumps(t.get("dependency")),
             json.dumps(t.get("reminders", [])), t.get("previousRecord")))
        for i, h in enumerate(t.get("history", [])):
            conn.execute("INSERT INTO ticket_history VALUES (?,?,?,?,?,?,?,?)",
                         (t["id"], i, h.get("at"), h.get("by"), h.get("role"),
                          h.get("status"), h.get("kind"), h.get("text")))
        for i, x in enumerate(t.get("tests", [])):
            conn.execute("INSERT INTO ticket_tests VALUES (?,?,?,?,?,?)",
                         (t["id"], i, x.get("at"), x.get("by"), x.get("result"), x.get("note")))
        for i, c in enumerate(t.get("comments", [])):
            conn.execute("INSERT INTO ticket_comments VALUES (?,?,?,?,?,?,?,?)",
                         (t["id"], i, c.get("at"), c.get("by"), c.get("role"),
                          c.get("visibility") or "public", c.get("text"),
                          json.dumps(c.get("attachments", []))))

    for s in st["schedules"]:
        conn.execute("INSERT INTO schedules VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                     (s["id"], s.get("office"), json.dumps(s.get("assets", [])),
                      s.get("category"), json.dumps(s.get("checklist", [])),
                      s.get("frequency"), s.get("dueDate"), s.get("technician"),
                      1 if s.get("active") else 0, s.get("lastCheck"), s.get("nextCheck")))

    for j in st["jobs"]:
        conn.execute(
            """INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (j["id"], j.get("scheduleId"), j.get("occurrence"), j.get("office"),
             json.dumps(j.get("assets", [])), j.get("technician"), j.get("category"),
             json.dumps(j.get("checklist", [])), json.dumps(j.get("items", [])),
             j.get("status"), j.get("availability"), j.get("visitDate"),
             json.dumps(j.get("reschedules", [])), j.get("additionalFault"),
             j.get("linkedTicketId"), j.get("outcome"), j.get("outcomeNotes"),
             json.dumps(j.get("confirmation", {})), j.get("nextDue"), j.get("createdAt")))

    for n in st["notifications"]:
        conn.execute("INSERT INTO notifications VALUES (?,?,?,?,?,?,?,?,?,?)",
                     (n["id"], n.get("at"), n.get("role"), n.get("office"), n.get("kind"),
                      n.get("ticketId"), n.get("jobId"), n.get("text"), 1 if n.get("read") else 0,
                      json.dumps(n.get("readBy", []))))

    for k, v in st["settings"].items():
        conn.execute("INSERT INTO settings VALUES (?,?)", (k, json.dumps(v)))
    for name, value in st["seq"].items():
        conn.execute("INSERT INTO sequences VALUES (?,?)", (name, value))

    save_offices(conn, st)
    save_people(conn, st)
    st["people"] = load_people(conn)  # canonical ids after the mirror
    append_audit(conn, st)
    conn.commit()


def save_offices(conn, st):
    for o in st.get("offices", []):
        conn.execute(
            "INSERT INTO offices (name, code, location, contact_person, contact_email, "
            "contact_phone, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(name) DO UPDATE SET code=excluded.code, location=excluded.location, "
            "contact_person=excluded.contact_person, contact_email=excluded.contact_email, "
            "contact_phone=excluded.contact_phone, active=excluded.active, "
            "updated_at=excluded.updated_at",
            (o.get("name"), o.get("code", ""), o.get("location", ""),
             o.get("contactPerson", ""), o.get("contactEmail", ""), o.get("contactPhone", ""),
             1 if o.get("active", True) else 0,
             o.get("createdAt") or now_iso(), o.get("updatedAt") or now_iso()))


def save_people(conn, st):
    """Mirror state["people"] onto the users table.

    pw_hash is never part of the snapshot, so it is preserved for existing
    accounts; accounts created in the UI start on the documented demo password
    (the user changes it from the Profile screen).  A person removed from the
    list is deactivated, never deleted  --  sign-in history stays intact.
    """
    people = st.get("people")
    if not people:
        return  # nothing mirrored yet (fresh seed)  --  never mass-deactivate
    seen = set()
    for p in st.get("people", []):
        username = (p.get("username") or "").strip()
        if not username:
            continue
        seen.add(username)
        row = conn.execute("SELECT id, pw_hash FROM users WHERE username = ?",
                           (username,)).fetchone()
        if row:
            conn.execute(
                "UPDATE users SET name=?, role=?, office=?, email=?, phone=?, "
                "active=?, prefs=? WHERE username=?",
                (p.get("name"), p.get("role"), p.get("office"), p.get("email"),
                 p.get("phone"), 1 if p.get("active", True) else 0,
                 json.dumps(p.get("prefs", {})), username))
        else:
            conn.execute(
                "INSERT INTO users (username, name, role, office, email, phone, "
                "pw_hash, active, prefs) VALUES (?,?,?,?,?,?,?,?,?)",
                (username, p.get("name"), p.get("role"), p.get("office"), p.get("email"),
                 p.get("phone"), default_password_hash(), 1 if p.get("active", True) else 0,
                 json.dumps(p.get("prefs", {}))))
    if seen:
        marks = ",".join("?" for _ in seen)
        conn.execute("UPDATE users SET active = 0 WHERE username NOT IN (%s)" % marks,
                     tuple(seen))


def default_password_hash():
    """Initial password for accounts created from the UI.

    New accounts are provisioned with the documented demo password (`itc`) so
    they can sign in immediately; the user changes it from the Profile screen.
    The lazy import avoids a db <-> auth import cycle.
    """
    from auth import DEMO_PASSWORD, hash_password
    return hash_password(DEMO_PASSWORD)


def append_audit(conn, st):
    """Append-only audit: new events are written once and keep their ids."""
    events = st.get("audit", [])
    have = [e for e in events if e.get("id")]
    fresh = [e for e in events if not e.get("id")]
    if fresh:
        row = conn.execute("SELECT COALESCE(MAX(id), 0) m FROM audit_events").fetchone()
        nxt = row["m"]
        for e in fresh:
            nxt += 1
            e["id"] = nxt
            conn.execute(
                "INSERT INTO audit_events (id, at, by, role, subject_type, subject_id, "
                "status, kind, text) VALUES (?,?,?,?,?,?,?,?,?)",
                (nxt, e.get("at"), e.get("by"), e.get("role"), e.get("subjectType"),
                 e.get("subjectId"), e.get("status"), e.get("kind"), e.get("text")))
    if len(events) > 2000:  # keep the working set small; rows stay in SQLite
        st["audit"] = events[-2000:]
    if len(have) + len(fresh) > 2000:
        st["audit"] = st["audit"][-2000:]


class State:
    """Process-global state with a lock  --  small dataset, single service."""

    def __init__(self, path=DB_PATH, seed_fn=None):
        self.lock = threading.RLock()
        self.conn = connect(path)
        empty = self.conn.execute("SELECT COUNT(*) c FROM sequences").fetchone()["c"] == 0
        if empty and seed_fn is not None:
            self.data = seed_fn()
            with self.lock:
                save_state(self.conn, self.data)
        else:
            self.data = load_state(self.conn)

    def reset(self, seed_fn):
        with self.lock:
            self.data = seed_fn()
            save_state(self.conn, self.data)

    def save(self):
        with self.lock:
            save_state(self.conn, self.data)
