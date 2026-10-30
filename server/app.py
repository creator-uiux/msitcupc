"""ITC Maintenance System: website server (HTTP API + static, standard library only).

Run:
    python server/app.py                 # serves the site on http://127.0.0.1:8787
    python server/app.py --open          # ...and opens it in your browser
    python server/app.py --port 9000
    python server/app.py --no-worker     # disable the background world clock

One process serves the whole website: the HTML/CSS/JS front end and the JSON API
on one origin (no CORS, no build step). Open http://127.0.0.1:8787/. The site is
live against the backend by default; append ?api=0 to a page for offline demo mode.

Endpoints
    GET  /                           sign-in page (the site entry)
    GET  /api/health                 public
    POST /api/login                  {username,password} | {role} | {credential}
    POST /api/logout                 bearer token
    GET  /api/state                  bearer token  -> dataset (office-scoped for requesters)
    GET  /api/tickets?filters        server-side list, scoped to the lane; the
                                     administrator lane is refused (role scope 5)
    GET  /api/users                  user records (management/coordinator)
    POST /api/users                  create/update a user (management)
    POST /api/profile                own contact details / password
    POST /api/upload                 attach a file (base64 JSON) to a ticket/job
    GET  /api/attachment?id=         stream stored bytes (authorization checked)
    POST /api/call                   {method, args} -> {ok,msg,id?,state}
    GET  /api/events?token=          Server-Sent Events stream
    GET  /api/reports                aggregate report, on the lane's own scope
    GET  /api/export                 CSV of the ticket records the lane may read
    GET  /api/notifications/outbox   delivery log (coordinator/management)
    POST /api/tick                   run one world-clock tick (tests/ops)
    POST /api/reset                  re-seed (coordinator/management)
    POST /api/import                 replace the whole dataset (coordinator/management)
"""
import argparse
import base64
import binascii
import hashlib
import io
import json
import mimetypes
import os
import posixpath
import queue
import re
import secrets
import sys
import threading
import traceback
import urllib.parse
import webbrowser
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import auth
import db as database
import delivery as delivery_mod
import engine
import oidc
import query as query_mod
import seed as seed_mod
from workers import Worker

HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(HERE)  # repository root
# Serve from HTMLUP/ first (new UI under active development), then fall back
# to the assembled public/ directory, then the repo root as a last resort.
# This keeps the local dev server in sync with Firebase Hosting, which is also
# now pointed at HTMLUP/ via firebase.json "public": "HTMLUP".
_HTMLUP = os.path.join(_REPO, "HTMLUP")
_PUBLIC = os.path.join(_REPO, "public")
if os.path.isdir(_HTMLUP) and os.path.isfile(os.path.join(_HTMLUP, "index.html")):
    ROOT = _HTMLUP
elif os.path.isdir(_PUBLIC) and os.path.isfile(os.path.join(_PUBLIC, "index.html")):
    ROOT = _PUBLIC
else:
    ROOT = _REPO

# What "/" serves: the sign-in page, so the bare host looks like a real site.
SITE_ENTRY = "login.html"

# Small content-type fixes (some systems ship a sparse mime.types).
EXTRA_TYPES = {
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}

# Injected into every HTML response served by this process.  It switches the
# client adapter on (the backend is the source of truth) and wires up branding,
# without touching the static files that also run as a standalone demo.
HEAD_BOOTSTRAP = (
    "<script>window.ITC_API=true;window.ITC_SITE=true;</script>"
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
    '<link rel="manifest" href="/manifest.webmanifest">'
    '<meta name="theme-color" content="#014421">'
    '<meta name="application-name" content="ITC Maintenance System">'
)



class Hub:
    """Fan-out of server events to connected SSE clients."""

    def __init__(self):
        self._lock = threading.Lock()
        self._subs = set()

    def subscribe(self):
        q = queue.Queue(maxsize=256)
        with self._lock:
            self._subs.add(q)
        return q

    def unsubscribe(self, q):
        with self._lock:
            self._subs.discard(q)

    def publish(self, message):
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(message)
            except queue.Full:
                pass


class ItcHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ITCMaint/1.0"
    quiet = True

    # ------------------------------------------------------------- utilities
    def log_message(self, fmt, *args):
        if not self.quiet:
            BaseHTTPRequestHandler.log_message(self, fmt, *args)

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        # An error reply sent before the request body is read must close the
        # socket: the unread bytes would be parsed as the next request line on
        # this keep-alive connection and every later call would fail.
        if self.command == "POST" and self._body_unread():
            self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _body_length(self):
        try:
            return max(int(self.headers.get("Content-Length") or 0), 0)
        except ValueError:
            return 0

    def _body_unread(self):
        return self._body_length() > 0 and not getattr(self, "_body_read", False)

    def _read_json(self):
        length = self._body_length()
        if not length:
            self._body_read = True
            return {}
        raw = self.rfile.read(length)
        self._body_read = True
        try:
            return json.loads(raw or b"{}")
        except ValueError:
            return {}

    def _token(self):
        hdr = self.headers.get("Authorization") or ""
        if hdr.lower().startswith("bearer "):
            return hdr[7:].strip()
        qs = urllib.parse.urlparse(self.path).query
        return urllib.parse.parse_qs(qs).get("token", [None])[0]

    def _user(self):
        # The shared connection and the whole-dataset save mean any write here
        # must hold the state lock or it can commit a half-built dataset.
        with self.server.state.lock:
            return auth.resolve(self.server.state.conn, self._token())

    def _require(self):
        user = self._user()
        if not user:
            self._json({"ok": False, "msg": "Not authenticated."}, 401)
        return user

    def _engine_call(self, state, role, method, args, user):
        """Run one engine action against the live dataset.

        Only a successful action is written to SQLite, so an action that fails
        partway would leave the dataset in memory ahead of the saved copy and
        the next save would persist that half-state.  Roll back instead.
        """
        with state.lock:
            try:
                return engine.call(state.data, role, method, args, user=user)
            except Exception as exc:
                traceback.print_exc()
                state.data = database.load_state(state.conn)
                return {"ok": False,
                        "msg": "The server could not complete that action (%s)." % type(exc).__name__}

    # ----------------------------------------------------------------- routing
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/health":
            return self._json({
                "ok": True, "rev": self.server.state.data.get("rev"),
                "googleClientId": (getattr(self.server, "oidc", None) or {}).get("client_id") or "",
                "channels": getattr(getattr(self.server, "delivery", None), "channels", []),
                "demo": bool(getattr(self.server, "demo", False)),
            })
        if path == "/api/state":
            return self._api_state()
        if path == "/api/tickets":
            return self._api_tickets()
        if path == "/api/users":
            return self._api_users_get()
        if path == "/api/attachment":
            return self._api_attachment()
        if path == "/api/reports":
            return self._api_reports()
        if path == "/api/export":
            return self._api_export()
        if path == "/api/notifications/outbox":
            return self._api_outbox()
        if path == "/api/events":
            return self._api_events()
        return self._static(path)

    def do_HEAD(self):
        return self.do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/login":
            return self._api_login()
        if path == "/api/logout":
            return self._api_logout()
        if path == "/api/call":
            return self._api_call()
        if path == "/api/users":
            return self._api_users_post()
        if path == "/api/profile":
            return self._api_profile()
        if path == "/api/upload":
            return self._api_upload()
        if path == "/api/tick":
            return self._api_tick()
        if path == "/api/reset":
            return self._api_reset()
        if path == "/api/import":
            return self._api_import()
        if path == "/api/state":
            return self._api_state_post()
        return self._json({"ok": False, "msg": "Not found."}, 404)

    # -------------------------------------------------------------------- api
    def _scoped(self, snap, user):
        """Role scoped snapshot.

        Office tenancy (SOP 28.2): a requester only sees the records of the
        offices they belong to, and never an internal note.

        Technician scope (specification 4A.2): a technician only sees the
        tickets and the maintenance jobs assigned to them.  The office and
        asset history of those offices stays readable through the register,
        but another technician's queue is never exposed, so a technician
        cannot reach a colleague's record by changing an id or a url.
        """
        if not user:
            return snap
        role = user.get("role")
        if role == "requester":
            return self._scoped_requester(snap, user)
        if role == "technician":
            return self._scoped_technician(snap, user)
        if role == "management":
            return self._scoped_management(snap)
        return snap

    def _scoped_management(self, snap):
        """The administrator lane is Administration plus the read-only audit
        viewer (role scope 5).  Operational records are not its data to read,
        so none enter its snapshot: the workflow stays in the three diagram
        lanes, and the audit trail keeps the evidence the administrator does
        need.  The keys stay as empty lists because the Workflow Guide paints
        from them for every signed-in role.
        """
        for key in ("tickets", "jobs", "schedules"):
            snap[key] = []
        # A notice is addressed by role.  The lane reads its own notices and
        # the ones sent to everyone signed in, exactly as the bell does, so
        # another lane's traffic never reaches this session either.
        snap["notifications"] = [
            n for n in snap.get("notifications", [])
            if n.get("role") in ("any", "management")]
        return snap

    @staticmethod
    def _asset_ref(a):
        """The part of an asset record another lane may read.

        The register itself belongs to Administration.  The other lanes only
        name a unit on a ticket or a plan, so they get the pick list and nothing
        else: no internal id and no record-keeping timestamps.
        """
        return {k: a.get(k) for k in ("tag", "name", "category", "office",
                                      "location", "active")}

    def _scoped_requester(self, snap, user):
        if not user.get("office"):
            return snap
        scope = user["office"]
        snap = dict(snap)
        # tickets: the office's records plus the requests this user raised,
        # which may name another active office
        tickets = []
        visible = set()
        for t in snap.get("tickets", []):
            if t.get("office") != scope and t.get("requester") != user.get("name"):
                continue
            visible.add(t.get("id"))
            tt = dict(t)
            # Redact internal notes/comments from requester view
            if tt.get("comments"):
                tt["comments"] = [c for c in tt.get("comments") or [] if c.get("visibility") != "internal"]
            # Internal cost and labour stay with the IT team
            if tt.get("diagnosis"):
                diag = dict(tt["diagnosis"])
                diag.pop("cost", None)
                diag.pop("labor", None)
                tt["diagnosis"] = diag
            if tt.get("history"):
                tt["history"] = [
                    dict(h, text=self._redact_costs(h.get("text") or ""))
                    for h in tt["history"]
                ]
            # Assignment and the internal assessment stay with the IT team
            # (Office Requester lane: hidden assignment, priority, schedules).
            for key in ("technician", "priority", "impact", "urgency"):
                tt.pop(key, None)
            tickets.append(tt)
        snap["tickets"] = tickets
        # Preventive schedules are an IT planning surface; the office only
        # reads the visits that concern it.
        snap["schedules"] = []
        snap["jobs"] = [
            {k: v for k, v in j.items() if k != "technician"}
            for j in snap.get("jobs", []) if j.get("office") == scope
        ]
        visible_jobs = set(j.get("id") for j in snap["jobs"])
        # Attachment metadata follows the same scope as the record it belongs
        # to: the office never learns the name or size of another office's file.
        snap["files"] = [
            f for f in snap.get("files", [])
            if f.get("ticketId") in visible or f.get("jobId") in visible_jobs
        ]
        snap["notifications"] = [
            n for n in snap.get("notifications", [])
            if n.get("role") == "any"
            or (n.get("role") == "requester"
                and (not n.get("office") or n.get("office") == scope
                     or (n.get("ticketId") and n.get("ticketId") in visible)))]
        # The office reads the units held in its own office, never another's.
        snap["assets"] = [
            self._asset_ref(a) for a in snap.get("assets", [])
            if a.get("office") == scope]
        # The audit log is an administration screen; an office user never reads it
        snap["audit"] = []
        snap["scope"] = scope
        return snap

    @staticmethod
    def _redact_costs(text):
        """Remove recorded peso amounts and labour hours from office-facing text."""
        import re
        text = re.sub(r"\s*\(?₱[\d,]+(?:\.\d+)?(?:\s*·\s*[\d.]+h)?\)?", "", text or "")
        return re.sub(r"\s{2,}", " ", text).strip()

    def _scoped_technician(self, snap, user):
        """Only the records this technician owns (specification 4A.2)."""
        name = user.get("name")
        if not name:
            return snap
        snap = dict(snap)
        tickets = []
        mine = set()
        for t in snap.get("tickets", []):
            if t.get("technician") == name:
                # Priority is the coordinator's assessment (D29); the technician
                # lane hides it, so the trusted snapshot never ships it either.
                tickets.append({k: v for k, v in t.items()
                                if k not in ("priority", "impact", "urgency")})
                mine.add(t.get("id"))
        jobs = [j for j in snap.get("jobs", []) if j.get("technician") == name]
        job_ids = set(j.get("id") for j in jobs)
        schedules = set(j.get("scheduleId") for j in jobs)
        snap["tickets"] = tickets
        snap["jobs"] = jobs
        snap["schedules"] = [s for s in snap.get("schedules", []) if s.get("id") in schedules]
        snap["files"] = [
            f for f in snap.get("files", [])
            if f.get("ticketId") in mine or f.get("jobId") in job_ids
        ]
        # The audit trail is a management screen; a technician only sees the
        # entries about the records they own.
        snap["audit"] = [
            a for a in snap.get("audit", [])
            if (a.get("subjectType") == "ticket" and a.get("subjectId") in mine)
            or (a.get("subjectType") == "job" and a.get("subjectId") in job_ids)]
        # A technician only receives the notices about their own records, or
        # notices addressed to them by name (28.2).  A colleague's ticket or
        # job notice is never delivered.
        snap["notifications"] = [
            n for n in snap.get("notifications", [])
            if n.get("role") == "any"
            or (n.get("role") == "technician"
                and (n.get("to") == name
                     or (n.get("ticketId") and n.get("ticketId") in mine)
                     or (n.get("jobId") and n.get("jobId") in job_ids)))]
        # A technician works in every office, so the whole pick list is readable,
        # but only as a reference: the register and its record-keeping stay with
        # Administration.
        snap["assets"] = [self._asset_ref(a) for a in snap.get("assets", [])]
        snap["scope"] = name
        return snap

    def _api_login(self):
        body = self._read_json()
        if body.get("credential"):
            return self._api_login_google(body["credential"])
        demo = bool(getattr(self.server, "demo", False))
        if not demo and (body.get("role") or body.get("username") in auth.DEMO_USERNAMES):
            return self._json({"ok": False, "code": "demo_disabled",
                               "msg": "Demo sign-in is disabled on this server."}, 403)
        with self.server.state.lock:
            res = auth.login(self.server.state.conn, username=body.get("username"),
                             password=body.get("password"), role=body.get("role"))
            state = self._scoped(dict(self.server.state.data), res["user"]) if res.get("ok") else None
        if not res.get("ok"):
            return self._json(res, 401)
        state["role"] = res["user"]["role"]
        state["user"] = {"name": res["user"]["name"], "role": res["user"]["role"],
                         "office": res["user"]["office"], "email": res["user"].get("email")}
        res["state"] = state
        return self._json(res)

    def _api_login_google(self, credential):
        cfg = getattr(self.server, "oidc", None) or {}
        if not cfg.get("client_id"):
            return self._json({"ok": False, "msg": "Google sign-in is not configured "
                              "(set ITC_GOOGLE_CLIENT_ID)."}, 400)
        try:
            claims = oidc.verify_id_token(credential, cfg["client_id"],
                                          cfg.get("domains"), jwks=cfg.get("jwks"))
        except oidc.OidcError as exc:
            return self._json({"ok": False, "msg": "Google sign-in failed: %s" % exc}, 401)
        with self.server.state.lock:
            res = auth.login_google(self.server.state.conn, claims)
            state = self._scoped(dict(self.server.state.data), res["user"]) if res.get("ok") else None
        if not res.get("ok"):
            return self._json(res, 403 if res.get("code") == "not_provisioned" else 401)
        state["role"] = res["user"]["role"]
        state["user"] = {"name": res["user"]["name"], "role": res["user"]["role"],
                         "office": res["user"]["office"], "email": res["user"].get("email")}
        res["state"] = state
        return self._json(res)

    def _api_logout(self):
        with self.server.state.lock:
            auth.logout(self.server.state.conn, self._token())
        return self._json({"ok": True})

    def _api_state(self):
        user = self._require()
        if not user:
            return
        with self.server.state.lock:
            snap = self._scoped(dict(self.server.state.data), user)
        snap["role"] = user["role"]
        snap["user"] = {"name": user["name"], "role": user["role"],
                        "office": user["office"], "email": user.get("email")}
        return self._json(snap)

    # ------------------------------------------------- list / records / files
    def _api_tickets(self):
        """Server-side ticket list: search, filter, sort, paginate.

        The caller's authorized view is decided here (office tenancy first);
        requesters default to their own requests (``mine``), ``mine=0`` widens
        to their office's register.
        """
        user = self._require()
        if not user:
            return
        if user["role"] == "management":
            # No service-record screen in the administrator lane (role scope 5).
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        qs = urllib.parse.urlparse(self.path).query
        params = {k: v[0] for k, v in urllib.parse.parse_qs(qs).items()}
        if user["role"] == "requester" and "mine" not in params:
            params["mine"] = "1"
        tickets = self._scoped({"tickets": self.server.state.data.get("tickets", [])}, user)["tickets"]
        # Ensure internal comments remain redacted
        if user["role"] == "requester":
            cleaned = []
            for t in tickets:
                tt = dict(t)
                if tt.get("comments"):
                    tt["comments"] = [c for c in tt.get("comments") or [] if c.get("visibility") != "internal"]
                cleaned.append(tt)
            tickets = cleaned
        res = query_mod.query_tickets(tickets, params, user_name=user["name"])
        res["ok"] = True
        res["scope"] = user.get("office") if user["role"] == "requester" else None
        return self._json(res)

    def _api_users_get(self):
        user = self._require()
        if not user:
            return
        if user["role"] not in ("management", "coordinator"):
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        people = self.server.state.data.get("people", [])
        qs = urllib.parse.urlparse(self.path).query
        params = {k: v[0] for k, v in urllib.parse.parse_qs(qs).items()}
        if params.get("role"):
            people = [p for p in people if p.get("role") == params["role"]]
        if params.get("office"):
            people = [p for p in people if (p.get("office") or "") == params["office"]]
        if params.get("q"):
            needle = params["q"].lower()
            people = [p for p in people
                      if needle in (" ".join([p.get("name") or "", p.get("username") or "",
                                              p.get("email") or ""])).lower()]
        return self._json({"ok": True, "users": people, "total": len(people)})

    def _api_users_post(self):
        """REST wrapper over engine.savePerson: same guards, same audit."""
        user = self._require()
        if not user:
            return
        if user["role"] != "management":
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        body = self._read_json()
        state = self.server.state
        with state.lock:
            before = state.data.get("rev")
            res = self._engine_call(state, user["role"], "savePerson", [body], user)
            changed = state.data.get("rev") != before
            if changed:
                state.save()
            snap = self._scoped(dict(state.data), user)
            snap["role"] = user["role"]
            snap["user"] = {"name": user["name"], "role": user["role"],
                            "office": user["office"], "email": user.get("email")}
        if changed:
            self.server.hub.publish({"type": "state", "rev": state.data.get("rev"),
                                     "by": user["name"], "method": "savePerson"})
        res = dict(res)
        res["state"] = snap
        return self._json(res)

    def _api_profile(self):
        """Own record: e-mail/phone/prefs + password change (auth.py owns hashes).

        Names are intentionally not editable here; a person's name is the
        identity written on service records (requester/technician references);
        an administrator renames people through the Users screen, which cascades.
        """
        user = self._require()
        if not user:
            return
        body = self._read_json()
        state = self.server.state
        with state.lock:
            person = next(
                (p for p in state.data.get("people", [])
                 if str(p.get("username")) == str(user.get("username"))
                 or str(p.get("id")) == str(user.get("id"))), None)
            if not person:
                return self._json({"ok": False, "msg": "User record not found."}, 404)

            pw_msg = None
            if body.get("newPassword"):
                pw = auth.change_password(state.conn, user["id"],
                                          body.get("currentPassword"), body.get("newPassword"))
                if not pw.get("ok"):
                    return self._json(pw, 400)
                pw_msg = pw["msg"]

            changed = []
            for key in ("email", "phone"):
                if body.get(key) is not None and str(body[key]).strip() != str(person.get(key) or ""):
                    person[key] = str(body[key]).strip()
                    changed.append(key)
            if isinstance(body.get("prefs"), dict):
                person["prefs"] = dict(body["prefs"])
                changed.append("prefs")
            if changed:
                state.data["_user"] = user
                try:
                    engine._touch(state.data)
                    engine._audit(state.data, "user", person.get("username") or user["id"], "profile",
                                  "Profile updated (%s)." % ", ".join(changed))
                finally:
                    state.data.pop("_user", None)
                state.save()
                self.server.hub.publish({"type": "state", "rev": state.data.get("rev"),
                                         "by": user["name"], "method": "profile"})
            elif pw_msg:
                state.save()  # keep the snapshot aligned with the users table
        msg = "Profile updated." if changed else "Nothing to update."
        if pw_msg:
            msg = "%s %s" % (msg, pw_msg)
        return self._json({"ok": True, "msg": msg, "user": person})

    # The allowed attachment types (decision D21): jpg, png, webp, pdf,
    # docx, xlsx, csv and txt.  Nothing that can carry a script is accepted.
    ALLOWED_UPLOAD_MIMES = {
        "image/jpeg", "image/png", "image/webp",
        "application/pdf", "text/plain", "text/csv",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
    MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB per file (D21)
    MAX_FILES_PER_RECORD = 10  # 10 files per record (D21)

    # A browser sends no type at all for some of these files, so the extension
    # fills the gap here on the trusted layer; the bytes are still checked
    # against whatever type is finally used.
    UPLOAD_EXT_MIMES = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".pdf": "application/pdf",
        ".txt": "text/plain", ".csv": "text/csv",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }

    # The browser-declared type is only trusted once the bytes agree with it,
    # so a renamed executable cannot be filed as a picture.  Text has no
    # signature, so it is checked by what it must not contain.
    @staticmethod
    def _text_is_text(data):
        if b"\x00" not in data:
            return True
        # A spreadsheet export can be UTF-16, whose ASCII text is full of NUL
        # bytes.  Those are text too, so the BOM decides whether they decode.
        if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
            try:
                data.decode("utf-16")
                return True
            except UnicodeDecodeError:
                return False
        return False

    @classmethod
    def _zip_is_office(cls, mime, data):
        if data[:4] != b"PK\x03\x04":
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = zf.namelist()
        except (zipfile.BadZipFile, OSError, ValueError):
            return False
        if "[Content_Types].xml" not in names:
            return False
        folder = "word/" if mime.endswith("wordprocessingml.document") else "xl/"
        return any(n.startswith(folder) for n in names)

    @classmethod
    def _content_matches_type(cls, mime, data):
        if mime == "image/jpeg":
            return data[:3] == b"\xff\xd8\xff"
        if mime == "image/png":
            return data[:8] == b"\x89PNG\r\n\x1a\n"
        if mime == "image/webp":
            return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
        if mime == "application/pdf":
            return data[:5] == b"%PDF-"
        if mime in ("application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
            return cls._zip_is_office(mime, data)
        if mime in ("text/plain", "text/csv"):
            return cls._text_is_text(data)
        return False

    def _api_upload(self):
        """Store attachment bytes in SQLite; metadata joins state["files"]."""
        user = self._require()
        if not user:
            return
        body = self._read_json()
        name = os.path.basename(str(body.get("name") or "").strip()).strip()
        mime = (body.get("mime") or "application/octet-stream").split(";")[0].strip().lower()
        if mime == "application/octet-stream":
            mime = self.UPLOAD_EXT_MIMES.get(os.path.splitext(name)[1].lower(), mime)
        ticket_id = body.get("ticketId") or None
        job_id = body.get("jobId") or None
        if not name:
            return self._json({"ok": False, "msg": "File name is required."}, 400)
        if mime not in self.ALLOWED_UPLOAD_MIMES:
            return self._json({"ok": False, "msg": "File type not allowed: %s" % mime}, 400)
        try:
            data = base64.b64decode(str(body.get("data") or ""), validate=True)
        except (binascii.Error, ValueError):
            return self._json({"ok": False, "msg": "File payload is not valid base64."}, 400)
        if not data:
            return self._json({"ok": False, "msg": "File is empty."}, 400)
        limit = self.MAX_UPLOAD_BYTES
        if len(data) > limit:
            return self._json({"ok": False, "msg": "File exceeds the %d MB limit." % (limit // 1048576)}, 400)
        if not self._content_matches_type(mime, data):
            return self._json({"ok": False,
                               "msg": "The file contents do not match the %s type it claims." % mime}, 400)

        state = self.server.state
        with state.lock:
            # The System Administrator holds no ticket or maintenance work.
            if user["role"] == "management":
                return self._json({"ok": False, "msg": "The System Administrator is read-only on workflow records."}, 403)
            # a technician attaches only to the records assigned to them
            if user["role"] == "technician":
                if ticket_id:
                    target = engine.get_ticket(state.data, ticket_id)
                    if not target or target.get("technician") != user["name"]:
                        return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
                elif job_id:
                    target = next((j for j in state.data.get("jobs", []) if j["id"] == job_id), None)
                    if not target or target.get("technician") != user["name"]:
                        return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
            # tenancy: requesters only attach to their own office's records
            if user["role"] == "requester":
                target = None
                if ticket_id:
                    target = engine.get_ticket(state.data, ticket_id)
                    if not target:
                        return self._json({"ok": False, "msg": "Ticket not found."}, 404)
                elif job_id:
                    target = next((j for j in state.data.get("jobs", []) if j["id"] == job_id), None)
                    if not target:
                        return self._json({"ok": False, "msg": "Job not found."}, 404)
                if target is None:
                    return self._json({"ok": False, "msg": "Choose a ticket to attach to."}, 400)
                if (target.get("office") != user.get("office")
                        and target.get("requester") != user.get("name")):
                    return self._json({"ok": False, "msg": "Blocked by office-based access (28.2)."}, 403)
            # at most ten files on one record (D21)
            if ticket_id or job_id:
                key = "ticketId" if ticket_id else "jobId"
                held = len([f for f in state.data.get("files", []) if f.get(key) == (ticket_id or job_id)])
                if held >= self.MAX_FILES_PER_RECORD:
                    return self._json({"ok": False, "msg": "This record already holds the maximum of %d files." % self.MAX_FILES_PER_RECORD}, 400)
            file_id = "att-" + secrets.token_hex(8)
            meta = {"id": file_id, "ticketId": ticket_id, "jobId": job_id, "name": name,
                    "mime": mime, "size": len(data), "by": user["name"],
                    "at": engine.now_iso()}
            state.conn.execute(
                "INSERT INTO attachments (id, ticket_id, job_id, name, mime, size, sha, "
                "uploaded_by, uploaded_role, at, data) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (file_id, ticket_id, job_id, name, mime, len(data),
                 hashlib.sha256(data).hexdigest(), user["name"], user["role"], meta["at"], data))
            state.conn.commit()
            state.data.setdefault("files", []).append(meta)
            # The record itself lists the evidence by name, the way the data
            # model says it does.  Without this the file is stored but never
            # shows up on the ticket.
            if ticket_id:
                target = engine.get_ticket(state.data, ticket_id)
                if target is not None:
                    names = target.setdefault("attachments", [])
                    if name not in names:
                        names.append(name)
            elif job_id:
                for j in state.data.get("jobs", []):
                    if j.get("id") == job_id:
                        names = j.setdefault("attachments", [])
                        if name not in names:
                            names.append(name)
                        break
            state.data["_user"] = user
            try:
                engine._touch(state.data)
                engine._audit(state.data, "ticket" if ticket_id else "job",
                              ticket_id or job_id, "attach",
                              "Attachment uploaded: %s (%d KB)." % (name, (len(data) + 1023) // 1024))
            finally:
                state.data.pop("_user", None)
            state.save()
        self.server.hub.publish({"type": "state", "rev": state.data.get("rev"),
                                 "by": user["name"], "method": "upload"})
        return self._json({"ok": True, "msg": "Attached %s." % name, "file": meta})

    def _api_attachment(self):
        user = self._require()
        if not user:
            return
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        fid = (qs.get("id") or [None])[0]
        if not fid:
            return self._json({"ok": False, "msg": "Missing id."}, 400)
        row = self.server.state.conn.execute(
            "SELECT id, ticket_id, job_id, name, mime, size, uploaded_by, data "
            "FROM attachments WHERE id = ?", (fid,)).fetchone()
        if not row:
            return self._json({"ok": False, "msg": "Attachment not found."}, 404)
        if user["role"] == "requester":
            allowed = row["uploaded_by"] == user["name"]
            t = engine.get_ticket(self.server.state.data, row["ticket_id"]) if row["ticket_id"] else None
            if t and (t.get("office") == user.get("office") or t.get("requester") == user.get("name")):
                allowed = True
            j = next((j for j in self.server.state.data.get("jobs", [])
                      if j["id"] == row["job_id"]), None) if row["job_id"] else None
            if j and j.get("office") == user.get("office"):
                allowed = True
            if not allowed:
                return self._json({"ok": False, "msg": "Blocked by office-based access (28.2)."}, 403)
        elif user["role"] == "technician":
            # a technician reads only the evidence on their own records
            t = engine.get_ticket(self.server.state.data, row["ticket_id"]) if row["ticket_id"] else None
            j = next((x for x in self.server.state.data.get("jobs", [])
                      if x["id"] == row["job_id"]), None) if row["job_id"] else None
            if not ((t and t.get("technician") == user["name"]) or (j and j.get("technician") == user["name"])):
                return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        download = (qs.get("download") or ["0"])[0] in ("1", "true")
        body = row["data"] or b""
        ctype = row["mime"] or "application/octet-stream"
        disposition = "attachment" if download else "inline"
        # A range request lets a reader seek: the browser asks for the part of
        # the file it still needs instead of the whole thing again.
        rng = self._range(len(body))
        if rng is None:            # no Range header: the whole file
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Disposition",
                             '%s; filename*=UTF-8\'\'%s' % (disposition, urllib.parse.quote(row["name"] or "file")))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        if rng is False:            # the range cannot be served
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % len(body))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        start, end = rng
        chunk = body[start:end + 1]
        self.send_response(206)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(chunk)))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Disposition",
                         '%s; filename*=UTF-8\'\'%s' % (disposition, urllib.parse.quote(row["name"] or "file")))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(chunk)

    def _range(self, total):
        """Parse a Range header.  None: serve the whole file.  False: the
        range cannot be served.  A pair: the first and the last byte."""
        raw = self.headers.get("Range") or ""
        m = re.match(r"^bytes=(\d*)-(\d*)$", raw.strip())
        if not m:
            return None
        if not total:
            return False
        first, last = m.group(1), m.group(2)
        if first == "" and last == "":
            return False
        if first == "":                      # the last N bytes
            n = int(last)
            if n <= 0:
                return False
            start = max(0, total - n)
            end = total - 1
        else:
            start = int(first)
            end = int(last) if last else total - 1
        if start >= total or start > end:
            return False
        return (start, min(end, total - 1))

    def _api_call(self):
        user = self._require()
        if not user:
            return
        body = self._read_json()
        method = body.get("method")
        args = body.get("args") or []
        state = self.server.state
        with state.lock:
            before = state.data.get("rev")
            res = self._engine_call(state, user["role"], method, args, user)
            changed = state.data.get("rev") != before
            if changed:
                state.save()
            snap = self._scoped(dict(state.data), user)
            snap["role"] = user["role"]
            snap["user"] = {"name": user["name"], "role": user["role"],
                            "office": user["office"], "email": user.get("email")}
        if changed:
            self.server.hub.publish({"type": "state", "rev": state.data.get("rev"),
                                     "by": user["name"], "method": method})
        res = dict(res)
        res["state"] = snap
        return self._json(res)

    def _api_tick(self):
        """Run one world-clock tick (system workers). Staff-driven only."""
        user = self._require()
        if not user:
            return
        if user["role"] not in ("coordinator", "management"):
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        events = self.server.worker.tick() if getattr(self.server, "worker", None) else \
            engine.world_tick(self.server.state.data)
        return self._json({"ok": True, "events": events})

    def _api_reset(self):
        user = self._require()
        if not user:
            return
        if user["role"] not in ("coordinator", "management"):
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        state = self.server.state
        with state.lock:
            state.reset(seed_mod.seed)
        self.server.hub.publish({"type": "state", "rev": state.data.get("rev"), "by": "system", "method": "reset"})
        return self._json({"ok": True, "rev": state.data.get("rev")})

    def _api_state_post(self):
        """State merge endpoint (local/offline adapter only).

        Hardened so a crafted body can never bypass the workflow: any ticket
        status change is refused outright (use /api/call with the guarded
        methods), history and comments must be exact append-only supersets, the
        client audit log is ignored entirely (the audit trail is append-only
        and server-written), and only content fields are merged.  This keeps
        the offline prototype's content edits working without letting anyone
        forge status moves or audit entries (Sections 19 + 28.2).
        """
        user = self._require()
        if not user:
            return
        body = self._read_json()
        if user["role"] == "requester":
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        incoming = body.get("state")
        state = self.server.state
        role = user["role"]
        # The System Administrator holds no ticket work: a state merge can
        # never create or edit a workflow record under that role.
        if role == "management" and isinstance(incoming, dict) and incoming.get("tickets"):
            return self._json({"ok": False, "msg": "The System Administrator is read-only on workflow records."}, 403)
        # Workflow-protected fields: the server copy always wins; a client
        # payload can never set or change them through this endpoint.
        PROTECTED = ("status", "technician", "confirmation", "closure", "authorizedReason",
                     "cancelReason", "resolvedAt", "closedAt", "dependency", "holdReturn",
                     "approval", "tests", "reminders", "impact", "urgency", "priority",
                     "target", "reviewed", "recurring", "diagnosis", "withdrawal",
                     # Evidence names only ever come from /api/upload, so a merge
                     # cannot list a file whose bytes the server does not hold.
                     "attachments")
        with state.lock:
            cur = state.data
            merged = dict(cur)
            # Validate and merge only allowed fields
            created = []
            if isinstance(incoming, dict) and "tickets" in incoming and isinstance(incoming["tickets"], list):
                # Start from the live collection: a merge edits content and may
                # add a record, but it never deletes one.  Dropping a ticket
                # would erase its record and its audit trail without a guarded
                # workflow action, so an omitted id is simply left alone.
                merged_tickets = list(cur.get("tickets", []))
                cur_t = {t["id"]: t for t in merged_tickets if t.get("id")}
                index = {t["id"]: i for i, t in enumerate(merged_tickets) if t.get("id")}
                seen_ids = set()
                for t in incoming["tickets"]:
                    if not isinstance(t, dict) or not t.get("id"):
                        return self._json({"ok": False, "msg": "Invalid ticket payload."}, 400)
                    tid = t["id"]
                    if tid in seen_ids:
                        return self._json({"ok": False, "msg": "Duplicate ticket id: %s." % tid}, 400)
                    seen_ids.add(tid)
                    if tid in cur_t:
                        old = cur_t[tid]
                        # enforce office tenancy
                        ob = engine._office_block({"role": role, "_user": user}, old.get("office"),
                                                  old.get("requester"))
                        if ob:
                            return self._json(ob, 403)
                        # No status changes over this endpoint, for any role.
                        newst = t.get("status")
                        oldst = old.get("status")
                        if newst is not None and newst != oldst:
                            return self._json({"ok": False, "msg": "Status changes go through the guarded "
                                                                   "workflow methods, not the state merge (%s)." % tid}, 400)
                        # history/comments must be exact append-only supersets
                        oldhist = old.get("history") or []
                        newhist = t.get("history") or []
                        if len(newhist) < len(oldhist) or newhist[:len(oldhist)] != oldhist:
                            return self._json({"ok": False, "msg": "History can only be appended to."}, 400)
                        oldcom = old.get("comments") or []
                        newcom = t.get("comments") or []
                        if len(newcom) < len(oldcom) or newcom[:len(oldcom)] != oldcom:
                            return self._json({"ok": False, "msg": "Comments can only be appended to."}, 400)
                        # merge content fields only; the server wins on everything
                        # that drives the workflow, the audit trail or reporting.
                        mt = dict(old)
                        for k, v in t.items():
                            if k in PROTECTED or k in ("id", "history", "comments", "createdAt", "dateReported"):
                                continue
                            mt[k] = v
                        merged_tickets[index[tid]] = mt
                    else:
                        # creating tickets via state merge? only coordinator/management
                        if role not in ("coordinator", "management"):
                            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
                        ob = engine._office_block({"role": role, "_user": user}, t.get("office"))
                        if ob:
                            return self._json(ob, 403)
                        # A new record enters at Submitted.  Resolved, Closed or
                        # any other advanced state is only reachable through the
                        # guarded workflow methods, never by crafting a record.
                        # The key or the display label both read as Submitted,
                        # and an omitted status is not a reason to lose the batch.
                        stated = str(t.get("status") or "submitted").strip().lower().replace(" ", "_")
                        if stated != "submitted":
                            return self._json({"ok": False, "msg": "New tickets must start as Submitted "
                                                                   "and advance through the workflow."}, 400)
                        for field in ("office", "requester", "category", "issue"):
                            if not t.get(field):
                                return self._json({"ok": False, "msg": "A new ticket needs office, requester, "
                                                                       "category and issue."}, 400)
                        now = engine.now_iso()
                        nt = {k: v for k, v in t.items() if k not in PROTECTED and k != "id"}
                        # Ticket numbers are minted by the server (D19).  The id
                        # in a create payload is ignored, so a crafted number
                        # like IT-9999-000099 can never enter the register.
                        tid = engine.next_id(cur, "ticket")
                        nt["id"] = tid
                        nt.update({
                            "status": "submitted", "reviewed": False, "priority": "medium",
                            "createdAt": now, "updatedAt": now,
                            "history": [{"at": now, "by": user["name"], "role": role,
                                         "status": "submitted", "kind": "status",
                                         "text": "Request recorded. Status: Submitted."}],
                            "comments": [], "tests": [], "reminders": []})
                        for key in ("technician", "confirmation", "closure", "authorizedReason",
                                    "cancelReason", "resolvedAt", "closedAt", "dependency",
                                    "holdReturn", "approval", "target", "impact", "urgency",
                                    "withdrawal", "recurring"):
                            nt.pop(key, None)
                        merged_tickets.append(nt)
                        index[tid] = len(merged_tickets) - 1
                        created.append(nt)
                merged["tickets"] = merged_tickets
            else:
                merged["tickets"] = cur.get("tickets", [])
            # The client audit log is ignored: the audit trail is append-only
            # and written by the engine, so an incoming list can never add,
            # rewrite or remove entries.  New records get a server-written
            # creation entry, since their history was server-built above.
            merged["audit"] = list(cur.get("audit") or [])
            for nt in created:
                merged["audit"].append({
                    "at": nt["createdAt"], "by": user["name"], "role": role,
                    "subjectType": "ticket", "subjectId": nt["id"],
                    "status": "Submitted", "kind": "create",
                    "text": "Ticket created through the offline state merge."})
            # settings merge if provided (coordinator/management)
            if "settings" in incoming and isinstance(incoming["settings"], dict):
                if role not in ("coordinator", "management"):
                    return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
                ms = dict(cur.get("settings") or {})
                ms.update(incoming["settings"])
                merged["settings"] = ms
            # Still inside the lock: the merge was built from the snapshot taken
            # above, so publishing it must not interleave with another write.
            merged["rev"] = cur.get("rev", 1) + 1
            merged["updatedAt"] = engine.now_iso()
            state.data = merged
            state.save()
        self.server.hub.publish({"type": "state", "rev": state.data.get("rev"), "by": user["name"], "method": "state"})
        with state.lock:
            snap = self._scoped(dict(state.data), user)
        snap["role"] = user["role"]
        snap["user"] = {"name": user["name"], "role": user["role"],
                        "office": user["office"], "email": user.get("email")}
        return self._json({"ok": True, "rev": state.data.get("rev"), "state": snap})

    def _api_import(self):
        """Full dataset replace from an `itc_db_v4`-shaped blob (Section 20).

        Restricted to management (a whole-dataset replace is an administrative
        restore, not a coordination task).  Every incoming ticket must carry
        one of the eight workflow statuses, history and comments must be exact
        append-only supersets of the live records, and the import is recorded
        in the append-only audit log with the acting manager.
        """
        user = self._require()
        if not user:
            return
        if user["role"] != "management":
            return self._json({"ok": False, "msg": "Dataset import is limited to management (28.2)."}, 403)
        body = self._read_json()
        incoming = body.get("state")
        if not isinstance(incoming, dict):
            return self._json({"ok": False, "msg": "Provide a state object."}, 400)
        state = self.server.state
        role = user["role"]
        with state.lock:
            cur = state.data
            if not isinstance(incoming.get("tickets"), list):
                return self._json({"ok": False, "msg": "Provide a state object with tickets."}, 400)
            merged = dict(cur)
            cur_t = {t["id"]: t for t in cur.get("tickets", [])}
            new_t = []
            for t in incoming.get("tickets", []):
                if not isinstance(t, dict) or not t.get("id"):
                    return self._json({"ok": False, "msg": "Invalid ticket payload."}, 400)
                # Status validation: only the eight workflow statuses exist.
                if t.get("status") not in engine._LABELS:
                    return self._json({"ok": False, "msg": "Imported ticket %s has an unknown status (%s)."
                                       % (t.get("id"), t.get("status"))}, 400)
                tid = t["id"]
                if tid in cur_t:
                    old = cur_t[tid]
                    ob = engine._office_block({"role": role, "_user": user}, old.get("office"))
                    if ob:
                        return self._json(ob, 403)
                    oldhist = old.get("history") or []
                    newhist = t.get("history") or []
                    if len(newhist) < len(oldhist) or newhist[:len(oldhist)] != oldhist:
                        return self._json({"ok": False, "msg": "History can only be appended to."}, 400)
                    oldcom = old.get("comments") or []
                    newcom = t.get("comments") or []
                    if len(newcom) < len(oldcom) or newcom[:len(oldcom)] != oldcom:
                        return self._json({"ok": False, "msg": "Comments can only be appended to."}, 400)
                    # An import restores content; it never moves a live record
                    # through the workflow.  Status transitions stay with the
                    # guarded methods even for management (D14).
                    if t.get("status") != old.get("status"):
                        return self._json({"ok": False, "msg": "Status changes go through the guarded "
                                                               "workflow methods, not a dataset import (%s)." % tid}, 400)
                    mt = dict(old)
                    for k, v in t.items():
                        if k in ("id", "status", "history", "comments", "createdAt", "audit"):
                            continue
                        mt[k] = v
                    new_t.append(mt)
                else:
                    ob = engine._office_block({"role": role, "_user": user}, t.get("office"))
                    if ob:
                        return self._json(ob, 403)
                    new_t.append(dict(t))
            merged["tickets"] = new_t
            if "audit" in incoming:
                if not isinstance(incoming["audit"], list):
                    return self._json({"ok": False, "msg": "Invalid audit payload."}, 400)
                cura = cur.get("audit") or []
                ina = incoming["audit"] or []
                if len(ina) < len(cura) or ina[:len(cura)] != cura:
                    return self._json({"ok": False, "msg": "The audit log is append-only: existing "
                                                           "entries cannot be changed or removed."}, 400)
                merged["audit"] = ina
            for k in ("schedules", "jobs", "notifications", "offices", "people", "ref", "seq", "files"):
                if k in incoming:
                    if not isinstance(incoming[k], list) and not isinstance(incoming[k], dict):
                        return self._json({"ok": False, "msg": "Invalid %s payload." % k}, 400)
                    merged[k] = incoming[k]
            if "settings" in incoming:
                if not isinstance(incoming["settings"], dict):
                    return self._json({"ok": False, "msg": "Invalid settings payload."}, 400)
                ms = dict(cur.get("settings") or {})
                ms.update(incoming["settings"])
                merged["settings"] = ms
            merged.setdefault("audit", []).append({
                "at": engine.now_iso(), "by": user["name"], "role": "management",
                "subjectType": "dataset", "subjectId": "import",
                "status": None, "kind": "import",
                "text": "Dataset imported by %s - %d ticket(s) replaced/added." % (user["name"], len(new_t))})
            merged["rev"] = cur.get("rev", 1) + 1
            merged["updatedAt"] = engine.now_iso()
            state.data = merged
            state.save()
        self.server.hub.publish({"type": "state", "rev": state.data.get("rev"), "by": user["name"], "method": "import"})
        return self._json({"ok": True, "rev": state.data.get("rev")})

    def _api_export(self):
        user = self._require()
        if not user:
            return
        if user["role"] == "management":
            # CSV export belongs to the register and report screens, which the
            # administrator lane does not hold (role scope 5).
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        data = self.server.state.data
        # The export carries the same scope as the screens: an office user
        # exports their own office, a technician exports their own workload,
        # the coordinator exports every office.  The administrator lane holds
        # neither the register nor the reports, so it is refused above.
        tickets = self._scoped({"tickets": data.get("tickets", [])}, user)["tickets"]
        import io, csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "office", "requester", "category", "source", "status", "priority", "createdAt", "resolvedAt", "closedAt", "target", "technician", "issue"])
        for t in tickets:
            w.writerow([t.get("id"), t.get("office"), t.get("requester"), t.get("category"), t.get("source"), t.get("status"), t.get("priority"), t.get("createdAt"), t.get("resolvedAt"), t.get("closedAt"), t.get("target"), t.get("technician"), t.get("issue")])
        body = buf.getvalue().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", "attachment; filename=itc-tickets.csv")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)


    def _api_reports(self):
        user = self._require()
        if not user:
            return
        if user["role"] == "management":
            # Reports belong to the three diagram lanes; the administrator lane
            # holds Administration and the audit viewer only (role scope 5).
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        data = self.server.state.data
        # Reports follow the caller's data scope: an office user sees its own
        # office, a technician sees their own workload and completed work, and
        # the coordinator and the administrator see every office.
        scoped = self._scoped({
            "tickets": data.get("tickets", []),
            "schedules": data.get("schedules", []),
            "jobs": data.get("jobs", []),
        }, user)
        tickets = scoped.get("tickets", [])
        schedules = scoped.get("schedules", [])
        jobs = scoped.get("jobs", [])
        # The report filters apply server-side too, so an export or an API
        # client sees exactly the same slice as the reports screen.
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        flt = {k: (qs.get(k) or [""])[0] for k in
               ("office", "category", "cat", "technician", "tech", "status", "from", "to")}
        flt["category"] = flt["category"] or flt["cat"]
        flt["technician"] = flt["technician"] or flt["tech"]

        def keep(r):
            if flt["office"] and r.get("office") != flt["office"]:
                return False
            if flt["category"] and r.get("category") != flt["category"]:
                return False
            if flt["technician"] and r.get("technician") != flt["technician"]:
                return False
            if flt["status"] and r.get("status") != flt["status"]:
                return False
            day = str(r.get("createdAt") or "")[:10]
            if flt["from"] and day and day < flt["from"]:
                return False
            if flt["to"] and day and day > flt["to"]:
                return False
            return True

        tickets = [t for t in tickets if keep(t)]
        jobs = [j for j in jobs if keep(j)]
        summary = query_mod.summarize(tickets)
        jobs_due = sum(1 for j in jobs if j.get("status") != "closed")
        jobs_completed = sum(1 for j in jobs if j.get("status") == "closed" and j.get("outcome") == "success")
        prev_compliance = round(jobs_completed / jobs_due * 100, 1) if jobs_due else 0
        return self._json({
            "ok": True,
            "tickets_total": len(tickets),
            "open_tickets": summary["open"],
            "by_status": summary["by_status"],
            "by_office": summary["by_office"],
            "by_priority": summary["by_priority"],
            "by_category": summary["by_category"],
            "by_source": summary["by_source"],
            "overdue": summary["overdue"],
            "turnaround_avg_hours": summary["turnaround_avg_hours"],
            "turnaround_samples": summary["turnaround_samples"],
            "resolved_within_target": summary["resolved_within_target"],
            "resolved_with_target": summary["resolved_with_target"],
            "default_sla_days": summary["default_sla_days"],
            "schedules_active": sum(1 for s in schedules if s.get("active")),
            "jobs_total": len(jobs),
            "jobs_open": sum(1 for j in jobs if j.get("status") != "closed"),
            "jobs_completed": sum(1 for j in jobs if j.get("status") == "closed" and j.get("outcome") == "success"),
            "preventive_compliance": round(sum(1 for j in jobs if j.get("status") == "closed" and j.get("outcome") == "success") / sum(1 for j in jobs if j.get("status") != "closed") * 100, 1) if sum(1 for j in jobs if j.get("status") != "closed") else 0,
            "notifications_unread": sum(1 for n in data.get("notifications", []) if not n.get("read")),
        })


    def _api_outbox(self):
        user = self._require()
        if not user:
            return
        if user["role"] not in ("coordinator", "management"):
            return self._json({"ok": False, "msg": "Blocked by role-based access (28.2)."}, 403)
        d = getattr(self.server, "delivery", None)
        if not d:
            return self._json({"ok": True, "channels": [], "stats": {}, "outbox": []})
        return self._json({"ok": True, "channels": d.channels, "stats": d.stats(),
                           "outbox": d.outbox(100)})

    def _api_events(self):
        if not self._require():
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Transfer-Encoding", "chunked")
        self._cors()
        self.end_headers()
        self.close_connection = True
        hub = self.server.hub
        q = hub.subscribe()
        try:
            self._chunk(": connected\n\n")
            while True:
                try:
                    msg = q.get(timeout=15)
                    self._chunk("data: %s\n\n" % json.dumps(msg))
                except queue.Empty:
                    self._chunk(": ping\n\n")
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            hub.unsubscribe(q)

    def _chunk(self, text):
        payload = text.encode("utf-8")
        self.wfile.write(b"%x\r\n" % len(payload) + payload + b"\r\n")
        self.wfile.flush()

    # ----------------------------------------------------------------- static
    def _static(self, path):
        rel = urllib.parse.unquote(path)
        parts = [p for p in rel.replace("\\", "/").split("/") if p not in ("", ".")]
        # Reject traversal outright, and never expose the backend source tree.
        if ".." in parts or (parts and parts[0].lower() == "server"):
            return self._not_found()
        rel = posixpath.join(*parts) if parts else SITE_ENTRY
        target = os.path.normpath(os.path.join(ROOT, rel.replace("/", os.sep)))
        if os.path.commonpath([ROOT, target]) != ROOT or not os.path.isfile(target):
            return self._not_found()
        ext = os.path.splitext(target)[1].lower()
        ctype = EXTRA_TYPES.get(ext) or mimetypes.guess_type(target)[0] or "application/octet-stream"
        with open(target, "rb") as fh:
            body = fh.read()
        if ext == ".html":
            body = self._inject(body)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _inject(self, body):
        """Add the site bootstrap (live api mode + branding) into <head>."""
        snippet = HEAD_BOOTSTRAP
        if getattr(self.server, "demo", False):
            snippet = "<script>window.ITC_DEMO_MODE=true;</script>" + snippet
        snippet = snippet.encode("utf-8")
        lowered = body.lower()
        at = lowered.find(b"</head>")
        if at != -1:
            return body[:at] + snippet + body[at:]
        i = lowered.find(b"<head")
        if i == -1:
            return body
        j = lowered.find(b">", i)
        if j == -1:
            return body
        at = j + 1
        return body[:at] + snippet + body[at:]

    def _not_found(self):
        """A friendly HTML 404 for navigations, JSON for everything else."""
        wants_html = "text/html" in (self.headers.get("Accept") or "")
        page = os.path.join(ROOT, "404.html")
        if wants_html and os.path.isfile(page):
            with open(page, "rb") as fh:
                body = fh.read()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        return self._json({"ok": False, "msg": "Not found."}, 404)


class ItcServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # A browser/SDK closing a keep-alive or SSE socket is normal; don't spam.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def _demo_from_env():
    raw = os.environ.get("ITC_DEMO_MODE")
    if raw is None:
        return None
    return raw.strip().lower() in ("1", "true", "yes", "on")


def build_server(host="127.0.0.1", port=8787, db_path=None, start_worker=True, interval=9.0,
                 google_client_id=None, allowed_domains=None, channels=None, jwks=None,
                 demo=None):
    """Create (but do not start) the HTTP server. Returns (server, state, worker).

    Demo sign-in (the role shorthand and the seeded demo credentials) is on for
    loopback hosts and off for a network-facing bind, unless ITC_DEMO_MODE or
    the ``demo`` argument says otherwise.  The sign-in page itself always lists
    the demo accounts, but they only reach real server data through this gate.
    """
    if demo is None:
        demo = _demo_from_env()
    if demo is None:
        demo = host in ("127.0.0.1", "localhost", "::1")
    state = database.State(path=db_path or database.DB_PATH, seed_fn=seed_mod.seed)
    auth.ensure_users(state.conn)

    env_client_id, env_domains = oidc.config_from_env()
    if google_client_id is None:
        google_client_id = env_client_id
    if allowed_domains is None:
        # The institution is the only sign-in domain unless an operator
        # explicitly widens or replaces it.
        allowed_domains = env_domains or ["upcebu.edu.ph"]

    delivery = delivery_mod.Delivery(
        channels=channels or delivery_mod.channels_from_env(),
        conn=state.conn,
        resolve=lambda role, office: auth.contacts_for(state.conn, role, office))
    engine.NOTIFY_HOOK = _make_notify_hook(delivery, state)

    hub = Hub()
    httpd = ItcServer((host, port), ItcHandler)
    httpd.daemon_threads = True
    httpd.state = state
    httpd.hub = hub
    httpd.delivery = delivery
    httpd.oidc = {"client_id": google_client_id or "", "domains": allowed_domains, "jwks": jwks}
    httpd.demo = bool(demo)
    worker = Worker(state, hub, interval=interval)
    httpd.worker = worker
    if start_worker:
        worker.start()
    return httpd, state, worker


def _make_notify_hook(delivery, bound_state):
    """Deliver notifications, but only for the state this server owns."""
    def hook(data, notif):
        if getattr(bound_state, "data", None) is data:
            delivery.deliver(notif)
    return hook


def main():
    ap = argparse.ArgumentParser(description="ITC Maintenance System backend")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--db", default=None)
    ap.add_argument("--interval", type=float, default=9.0, help="world-clock tick seconds")
    ap.add_argument("--no-worker", action="store_true")
    ap.add_argument("--reset", action="store_true", help="re-seed before starting")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--google-client-id", default=None,
                    help="Google OAuth client id (else ITC_GOOGLE_CLIENT_ID)")
    ap.add_argument("--allowed-domains", default=None,
                    help="comma-separated Workspace domains (else ITC_ALLOWED_DOMAINS)")
    ap.add_argument("--channels", default=None,
                    help="notification channels outbox,console,email,sms (else ITC_NOTIFY_CHANNELS)")
    ap.add_argument("--open", action="store_true", help="open the site in your browser after start")
    ap.add_argument("--demo", action="store_true",
                    help="force demo sign-in on (role shorthand + demo account list)")
    ap.add_argument("--no-demo", action="store_true",
                    help="force demo sign-in off even on loopback")
    args = ap.parse_args()
    if args.demo and args.no_demo:
        ap.error("--demo and --no-demo are mutually exclusive")

    domains = [d.strip() for d in args.allowed_domains.split(",") if d.strip()] \
        if args.allowed_domains else None
    channels = [c.strip() for c in args.channels.split(",") if c.strip()] \
        if args.channels else None

    httpd, state, worker = build_server(
        host=args.host, port=args.port, db_path=args.db,
        start_worker=not args.no_worker, interval=args.interval,
        google_client_id=args.google_client_id, allowed_domains=domains, channels=channels,
        demo=True if args.demo else False if args.no_demo else None)
    httpd.RequestHandlerClass.quiet = not args.verbose
    if args.reset:
        with state.lock:
            state.reset(seed_mod.seed)
    host, port = httpd.server_address[:2]
    view = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    site = "http://%s:%d/" % (view, port)
    print("ITC Maintenance System: serving %s" % site)
    print("  site      : %s" % site)
    print("  health    : http://%s:%d/api/health" % (view, port))
    print("  storage   : %s" % (args.db or database.DB_PATH))
    if httpd.oidc["client_id"]:
        print("  sign-in   : Google Workspace OIDC (%s)" % ", ".join(httpd.oidc["domains"] or []))
    else:
        print("  sign-in   : Google Workspace OIDC not configured (set ITC_GOOGLE_CLIENT_ID)")
    print("  demo mode : %s" % ("on" if httpd.demo else "off"))
    print("  delivery  : %s" % ", ".join(httpd.delivery.channels))
    if args.open:
        try:
            webbrowser.open(site)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping…")
    finally:
        worker.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
