"""Workflow engine - a 1:1 port of js/flow.js (Flow + Maint).

Every guard, message and notification matches the browser prototype, so the UI
can call the same methods through the API and get identical behaviour.  All
methods take the shared `state` dict (server/db.py) and the acting `role`.
"""
from db import now_iso
import json
import os
import re

# --------------------------------------------------------------------------
# Single permission map (specification 4A.1)
#
# permissions.json at the repository root is the one source of truth for
# which role may open which screen, invoke which action, and make which
# status transition.  The backend reads it; js/permissions.js is generated
# from it for the frontend.  tools/permission_parity_check.py fails if the
# three copies ever drift apart.
# --------------------------------------------------------------------------
_PERM_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "permissions.json")


def _load_permissions():
    try:
        with open(_PERM_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


PERMISSIONS = _load_permissions()
PERM_ACTIONS = PERMISSIONS.get("actions") or {}
PERM_PAGES = PERMISSIONS.get("pages") or {}
PERM_TRANSITIONS = PERMISSIONS.get("transitions") or {}

WHO = {
    "requester": {"by": "A. Delos Reyes", "role": "requester"},
    "coordinator": {"by": "K. Ramos", "role": "coordinator"},
    "technician": {"by": "J. Tan", "role": "technician"},
    "management": {"by": "M. Reyes", "role": "management"},
}

# Background workers (schedule checks, reminder loop, dependency nudges) act as
# System, never as whichever human role happened to call the API last.
SYSTEM = {"by": "System", "role": "system"}

ROLES = ("requester", "coordinator", "technician", "management")

# Optional sink for outbound delivery (set by server/app.py). Signature:
# hook(state, notification_dict). Kept as a module global so the engine stays a
# pure port of js/flow.js and unit tests can run without any delivery side effects.
NOTIFY_HOOK = None


def _touch(state):
    state["rev"] = state.get("rev", 1) + 1
    state["updatedAt"] = now_iso()


def _hist(t, status, kind, text, by, role):
    t.setdefault("history", []).append(
        {"at": now_iso(), "by": by, "role": role, "status": status, "kind": kind, "text": text})
    t["updatedAt"] = now_iso()


def _who(state):
    """The acting identity: the signed-in user when known, else the role persona."""
    u = state.get("_user")
    if u and u.get("name"):
        return {"by": u["name"], "role": u.get("role") or state.get("role")}
    return WHO.get(state.get("role"), WHO["coordinator"])


def _audit(state, subject_type, subject_id, kind, text, status=None, actor=None):
    """Append-only audit event (actor, timestamp, previous -> new status, reason).

    Written by every mutating action so the audit log always answers *who did
    what to which record, when, and why* - independent of the ticket timeline.
    ``actor`` overrides the acting identity; background workers pass SYSTEM so
    automated events are never attributed to a human.
    """
    w = actor or _who(state)
    state.setdefault("audit", []).append({
        "at": now_iso(), "by": w["by"], "role": w["role"],
        "subjectType": subject_type, "subjectId": subject_id,
        "status": status, "kind": kind, "text": text})


def _audit_status(state, t, prev, new, kind, text):
    """Status change audit: records the previous and the new status together."""
    _audit(state, "ticket", t["id"], kind,
           "%s -> %s: %s" % (_label(prev), _label(new), text), _label(new))


_LABELS = {"submitted": "Submitted", "needs_info": "Needs Information",
           "assigned": "Assigned", "in_progress": "In Progress", "on_hold": "On Hold",
           "resolved": "Resolved", "closed": "Closed", "cancelled": "Cancelled"}


def _label(status):
    return _LABELS.get(status, status or "-")


# Impact x urgency -> priority.  Used by `assess` when the admin-visible
# settings do not override it (settings.priorityMatrix).  Keys are lower case.
# The impact domain is Low, Medium and High; the urgency domain is Low,
# Medium and High; the priority domain is Low, Medium, High and Critical
# (decision D6).
DEFAULT_PRIORITY_MATRIX = {
    "high": {"high": "critical", "medium": "high", "low": "medium"},
    "medium": {"high": "high", "medium": "medium", "low": "low"},
    "low": {"high": "medium", "medium": "low", "low": "low"},
}


def priority_for(state, impact, urgency):
    """Impact x urgency -> priority from settings.priorityMatrix (fallback default)."""
    matrix = _settings(state).get("priorityMatrix")
    if not isinstance(matrix, dict) or not matrix:
        matrix = DEFAULT_PRIORITY_MATRIX
    row = matrix.get(str(impact or "").strip().lower())
    if not isinstance(row, dict):
        return None
    val = row.get(str(urgency or "").strip().lower())
    return str(val) if val else None


def frequency_days(state, key, interval_days=None):
    """Configured maintenance frequency -> days until the next occurrence."""
    if key == "custom":
        days = _interval_days(interval_days)
        if days:
            return days
    for row in (state.get("settings") or {}).get("frequencies", []):
        if isinstance(row, (list, tuple)) and len(row) >= 3 and row[0] == key:
            try:
                return int(row[2])
            except (TypeError, ValueError):
                return 91
    return {"daily": 1, "weekly": 7, "biweekly": 14, "monthly": 30, "quarterly": 91,
            "semiannual": 182, "annual": 365}.get(key, 91)


CUSTOM_INTERVAL_MIN_DAYS = 1
CUSTOM_INTERVAL_MAX_DAYS = 3650


def _interval_days(value):
    """The whole day count a Custom cadence needs, or None when it is unusable.

    The upper bound matters: the next due date is added to a real date, and a
    runaway interval lands outside the range a date can hold.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        days = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return days if CUSTOM_INTERVAL_MIN_DAYS <= days <= CUSTOM_INTERVAL_MAX_DAYS else None


def _custom_interval(d):
    """Validate the day count that a Custom schedule needs.

    Returns the day count, None when the frequency is not Custom, and False
    when Custom was chosen without a usable interval.
    """
    if (d or {}).get("frequency") != "custom":
        return None
    return _interval_days((d or {}).get("intervalDays")) or False


def _settings(state):
    """The live settings block (never None)."""
    return state.get("settings") or {}


def configured_roles(state, action, default):
    """Admin-configurable role matrix: `settings.roleActions[action]` (28.2).

    The setting may only *narrow* the engine default, never widen it: a role
    listed that the engine does not already permit is ignored, and a list that
    would empty the default keeps the default.  This keeps the shipped SOP
    matrix authoritative on the trusted backend while still letting an
    administrator lock an action down to fewer roles.  An action absent from
    the setting, an empty list, or a non-list value all keep the default, so a
    bad value can never lock everyone out.
    """
    if not action:
        return list(default)
    cfg = _settings(state).get("roleActions")
    if not isinstance(cfg, dict):
        return list(default)
    val = cfg.get(action)
    if not isinstance(val, (list, tuple)):
        return list(default)
    narrowed = [str(r) for r in val if str(r) in default]
    return narrowed if narrowed else list(default)


_ACTION_BY_METHOD = {}


def _action_roles(state, default):
    """The allowed roles for the running action, read from the permission map.

    The map (permissions.json) is authoritative.  The list passed by the caller
    is the fallback for a deployment without the map file, and
    tools/permission_parity_check.py proves the two never disagree.
    """
    method = state.get("_method")
    if not method:
        return list(default)
    if not _ACTION_BY_METHOD:
        for js_name, (fn, _names) in METHODS.items():
            _ACTION_BY_METHOD[js_name] = fn.__name__
    action = _ACTION_BY_METHOD.get(method)
    if action:
        roles = PERM_ACTIONS.get(action)
        if roles:
            return list(roles)
    return list(default)


def _guard(state, roles):
    roles = _action_roles(state, roles)
    roles = configured_roles(state, state.get("_method"), roles)
    if state.get("role") not in roles:
        return {"ok": False, "msg": "Blocked by role-based access (28.2)."}
    return {"ok": True}


# ---------------------------------------------------------------- transitions
# One authoritative whitelist of allowed status moves.  Keyed by the *current*
# status, each value maps the *next* status to the roles permitted to make the
# move.  Every status change in this module goes through `_transition_status`,
# so an invalid move is rejected here on the trusted backend regardless of what
# the browser sends.  `js/flow.js` mirrors this table.
TRANSITIONS_FALLBACK = {
    "submitted":   {"needs_info": ("coordinator",), "assigned": ("coordinator",),
                    "cancelled": ("coordinator",)},
    "needs_info":  {"submitted": ("requester", "coordinator"),
                    "cancelled": ("coordinator",)},
    "assigned":    {"in_progress": ("technician",),
                    "cancelled": ("coordinator",)},
    "in_progress": {"on_hold": ("technician",), "resolved": ("technician",),
                    "cancelled": ("coordinator",)},
    "on_hold":     {"in_progress": ("coordinator",),
                    "cancelled": ("coordinator",)},
    "resolved":    {"closed": ("requester", "coordinator"),
                    "in_progress": ("requester",),
                    "cancelled": ("coordinator",)},
    "closed":      {},
    "cancelled":   {},
}


def _build_transitions():
    """The transition whitelist, read from the single permission map.

    The literal above is only a fallback for a deployment that is missing
    permissions.json; tools/permission_parity_check.py proves the two agree.
    """
    if not PERM_TRANSITIONS:
        return dict(TRANSITIONS_FALLBACK)
    return {frm: {to: tuple(roles) for to, roles in targets.items()}
            for frm, targets in PERM_TRANSITIONS.items()}


TRANSITIONS = _build_transitions()


def can_transition(cur, nxt, role):
    """True when `role` may move a ticket from `cur` to `nxt`."""
    return role in TRANSITIONS.get(cur, {}).get(nxt, ())


def _check_transition(state, t, nxt):
    """Return an error result when the acting role may not make this move.

    ``None`` means the move is permitted and the caller proceeds with its own
    bookkeeping.  Two checks run here so no caller can skip them:

    1. The transition whitelist (``TRANSITIONS``) must permit the role.
    2. A technician may only status-change a ticket assigned to them, so a
       technician lane move on someone else's ticket is refused even if the
       matrix alone would allow it.
    """
    cur = t.get("status")
    role = state.get("role")
    if not can_transition(cur, nxt, role):
        return {"ok": False, "msg": "That status change is not allowed (%s to %s as %s)."
                % (_label(cur), _label(nxt), role or "unknown")}
    if role == "technician" and not _assigned_to_actor(state, t):
        return {"ok": False, "msg": "Only the assigned technician can change the status of this ticket."}
    return None


def _assigned_to_actor(state, t):
    """Technician ownership check: True when the actor may act on this ticket.

    A coordinator or administrator is never blocked here (they are not the
    technician lane). A technician may only act on tickets assigned to them.
    """
    if state.get("role") != "technician":
        return True
    tech = t.get("technician")
    actor = _who(state)["by"]
    if not tech:
        return False
    return tech == actor


def _scope_office(state):
    """The signed-in user's office, when the caller supplied one."""
    user = state.get("_user")
    if user and user.get("office"):
        return user["office"]
    return None


def _office_block(state, office, requester=None):
    """Requester tenancy (SOP 28.2): a requester may only touch their own office.

    The requests they raised stay reachable when they chose another active
    office at intake, so the requester field on the ticket is the same
    signed-in name.
    """
    if state.get("role") != "requester":
        return None
    scope = _scope_office(state)
    if scope and office and office != scope:
        if requester and requester == _who(state)["by"]:
            return None
        return {"ok": False, "msg": "Blocked by office-based access (28.2)."}
    return None


def next_id(state, kind):
    s = state["seq"]
    if kind == "ticket":
        s["ticket"] += 1
        # IT-YYYY-NNNNNN: the year plus a zero padded yearly sequence
        # (decision D19).  The counter only ever moves forward, so a number
        # is never reused.
        from datetime import datetime, timezone
        year = datetime.now(timezone.utc).year
        return "IT-%d-%06d" % (year, s["ticket"])
    if kind == "sched":
        s["sched"] += 1
        return "SCH-2026-%03d" % s["sched"]
    if kind == "job":
        s["job"] += 1
        return "MNT-2026-%04d" % s["job"]
    if kind == "asset":
        s["asset"] = s.get("asset", 0) + 1
        return "AST-%04d" % s["asset"]
    s["notif"] += 1
    return str(s["notif"])


def notify(state, role, text, kind="info", extra=None, to=None):
    state["seq"]["notif"] += 1
    n = {"id": state["seq"]["notif"], "at": now_iso(), "role": role,
         "kind": kind or "info", "text": text, "read": False, "readBy": []}
    if extra:
        for k in ("ticketId", "office", "jobId"):
            if extra.get(k):
                n[k] = extra[k]
    # A technician notification is addressed to one person; the scoped view
    # for a technician only returns notices addressed to them (28.2).
    if to:
        n["to"] = to
    state["notifications"].insert(0, n)
    if len(state["notifications"]) > 120:
        del state["notifications"][120:]
    if NOTIFY_HOOK is not None:
        try:
            NOTIFY_HOOK(state, n)
        except Exception:
            pass  # delivery must never break the workflow
    return n


def get_ticket(state, tid):
    for t in state["tickets"]:
        if t["id"] == tid:
            return t
    return None


def get_schedule(state, sid):
    for s in state["schedules"]:
        if s["id"] == sid:
            return s
    return None


def get_job(state, jid):
    for j in state["jobs"]:
        if j["id"] == jid:
            return j
    return None


# ============================================================== Flow (service)
def _record_ticket(state, d, created_by=None, created_by_role="requester"):
    """Create one ticket record. No role guard: callers own authorization.

    Used by the public ``create_ticket`` (guarded) and by the maintenance fault
    path, which raises a linked corrective ticket on the technician's behalf.
    """
    tid = next_id(state, "ticket")
    hist_by = created_by or d["requester"]
    t = {
        "id": tid, "office": d["office"], "requester": d["requester"], "category": d["category"],
        "source": d.get("source") or "email", "issue": d["issue"], "asset": d.get("asset") or "",
        # Section 5 intake: the date the office reported the issue (defaults to now).
        "dateReported": d.get("dateReported") or now_iso(),
        "attachments": list(d.get("attachments") or []), "status": "submitted",
        "impact": None, "urgency": None, "priority": d.get("priority") or "medium", "target": None,
        "technician": None,
        "createdAt": now_iso(), "updatedAt": now_iso(), "reviewed": False,
        "previousRecord": d.get("previousRecord") or d.get("linkedTo"),
        "idempotencyKey": d.get("idempotencyKey") or "",
        "approval": None,
        "history": [{"at": now_iso(), "by": hist_by, "role": created_by_role, "status": "submitted",
                     "kind": "status", "text": "Request recorded - Status: Submitted. Captured ticket, office, requester, category, priority, issue, date, asset, attachments, source."}],
        "tests": [], "reminders": [], "dependency": None, "linkedTo": d.get("linkedTo"),
        "cancelReason": None, "closure": None, "authorizedReason": "", "recurring": bool(d.get("linkedTo")),
        "withdrawal": None,
        "diagnosis": {"findings": "", "actions": "", "parts": "", "cost": 0, "labor": 0, "dates": "", "evidence": []},
        "confirmation": {"state": "none", "person": "", "date": None, "feedback": ""},
    }
    state["tickets"].insert(0, t)
    return tid


def _source_values(state):
    """The configured intake sources, in register order."""
    cfg = _settings(state).get("sources")
    if isinstance(cfg, (list, tuple)) and cfg:
        return [str(s) for s in cfg]
    return ["telephone", "email", "walk-in", "on-site", "online portal"]


def _normalize_source(state, value):
    """Map a posted source onto the configured reference value.

    Accepts the stored value or its display form ("Walk-in"), so a client that
    sends a human label is stored canonically.  Returns None when the value is
    not one of the configured sources.
    """
    allowed = _source_values(state)
    text = str(value or "").strip()
    for src in allowed:
        if text.lower() in (src.lower(), src.lower().replace("-", "-")):
            return src
        pretty = src.replace("-", " ").title() if " " not in src else src.title()
        if text.lower() == pretty.lower():
            return src
        if text.lower() == src.lower().replace("-", " "):
            return src
    return None


def create_ticket(state, role, d):
    state["role"] = role
    g = _guard(state, ["requester", "coordinator"])
    if not g["ok"]:
        return g
    if not isinstance(d, dict):
        return {"ok": False, "msg": "Provide the request details."}
    # A requester may choose any active office; the office they pick is kept.
    if not d.get("office") or not d.get("issue") or not d.get("category") or not d.get("requester"):
        return {"ok": False, "msg": "Office, requester, category and issue are required."}
    # Priority is set by the IT Coordinator during assessment.  A requester
    # cannot see or choose it (Office Requester lane: hidden priority), so an
    # intake filed by the office starts at Medium whatever the payload says.
    if role == "requester":
        prio = "medium"
    else:
        prio = str(d.get("priority") or "medium").strip().lower()
        if prio not in ("low", "medium", "high"):
            return {"ok": False, "msg": "Unknown priority (%s). Choose one of: Low, Medium, High." % prio}
    d = dict(d)
    d["priority"] = prio
    # Intake source must be one of the configured reference values, so free
    # text from a crafted request can never enter reports by_source.
    allowed_src = _source_values(state)
    src = _normalize_source(state, d.get("source") or ("email" if "email" in allowed_src else allowed_src[0]))
    if src is None:
        return {"ok": False, "msg": "Unknown intake source (%s). Choose one of: %s." % (d.get("source"), ", ".join(allowed_src))}
    d = dict(d)
    d["source"] = src
    # Idempotency: a retried submit with the same key returns the first ticket
    # instead of creating a duplicate (double click, network retry).
    key = (d.get("idempotencyKey") or "").strip()
    if key:
        for t in state["tickets"]:
            if t.get("idempotencyKey") == key:
                return {"ok": True, "msg": "%s already recorded - Status: Submitted." % t["id"],
                        "id": t["id"], "duplicate": True}
        d = dict(d)
        d["idempotencyKey"] = key
    prev = (d.get("previousRecord") or "").strip()
    if prev:
        pt = get_ticket(state, prev)
        if not pt:
            return {"ok": False, "msg": "Previous record %s was not found. Choose an existing ticket." % prev}
        # An office requester may only continue their own record, in the same office.
        if role == "requester":
            if pt.get("office") != d.get("office"):
                return {"ok": False, "msg": "Previous record %s belongs to %s, not %s." % (prev, pt.get("office"), d.get("office"))}
            if pt.get("requester") != _who(state)["by"]:
                return {"ok": False, "msg": "Previous record %s belongs to another requester." % prev}
    tid = _record_ticket(state, d, created_by=_who(state)["by"], created_by_role=role)
    _audit(state, "ticket", tid, "create",
           "Ticket recorded for %s (%s) - Status: Submitted." % (d["requester"], d["office"]), "Submitted")
    notify(state, "coordinator", "%s recorded - Status: Submitted (%s)." % (tid, d["office"]),
           "intake", {"ticketId": tid, "office": d["office"]})
    _touch(state)
    return {"ok": True, "msg": "%s recorded - Status: Submitted." % tid, "id": tid}


def submit_info(state, role, tid, d):
    state["role"] = role
    g = _guard(state, ["requester", "coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    ob = _office_block(state, t.get("office"), t.get("requester"))
    if ob:
        return ob
    if t["status"] != "needs_info":
        return {"ok": False, "msg": "Ticket is not in Needs Information."}
    if not d.get("issue") and not d.get("asset") and not d.get("note"):
        return {"ok": False, "msg": "Provide the missing information."}
    chk = _check_transition(state, t, "submitted")
    if chk:
        return chk
    if d.get("issue"):
        t["issue"] = d["issue"]
    if d.get("asset"):
        t["asset"] = d["asset"]
    if d.get("attachments"):
        t["attachments"] = t["attachments"] + list(d["attachments"])
    prev = t["status"]
    t["status"] = "submitted"
    _hist(t, "submitted", "status",
          "Missing information supplied (%s) - returned to review; no new ticket created." % (d.get("note") or "details updated"),
          t["requester"], "requester")
    _audit_status(state, t, prev, "submitted", "status",
                  "Missing information supplied - ticket returned to Submitted for review.")
    notify(state, "coordinator", "%s returned to review - missing information supplied." % t["id"],
           "intake", {"ticketId": t["id"]})
    _touch(state)
    return {"ok": True, "msg": "Information submitted for %s - back to review." % tid}


def office_decision(state, role, tid, decision, data):
    """The office decides on the result: accept, reject, or no response.

    Section 4A.2: accepting or rejecting is an *office* decision.  The IT
    Coordinator may never answer on the office's behalf; the only way the
    coordinator can close a Resolved ticket is the audited authorized closure,
    which always carries a reason (D4).
    """
    state["role"] = role
    g = _guard(state, ["requester"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    ob = _office_block(state, t.get("office"), t.get("requester"))
    if ob:
        return ob
    if t["status"] != "resolved":
        return {"ok": False, "msg": "Office confirmation applies to Resolved tickets (%s is %s)." % (tid, _label(t["status"]))}
    if t["confirmation"]["state"] != "pending" and decision != "no_response":
        return {"ok": False, "msg": "No confirmation is pending on %s." % tid}
    if decision == "accepted":
        if not data.get("person"):
            return {"ok": False, "msg": "Confirmation requires the confirming person."}
        chk = _check_transition(state, t, "closed")
        if chk:
            return chk
        t["confirmation"] = {"state": "accepted", "person": data["person"], "date": now_iso(), "feedback": data.get("feedback") or ""}
        t["status"] = "closed"
        t["closedAt"] = now_iso()
        t["closure"] = "confirmation"
        t["authorizedReason"] = ""
        _hist(t, "closed", "confirm", "Office accepts result - confirmation recorded for %s. Status: Closed." % data["person"],
              data["person"], "requester")
        _audit_status(state, t, "resolved", "closed", "confirm",
                      "Office accepted the result - confirmation recorded for %s; closed after confirmation." % data["person"])
        notify(state, "coordinator", "%s confirmed and closed by the office." % t["id"], "confirm", {"ticketId": t["id"]})
        notify(state, "requester", "%s is now Closed. Thank you." % t["id"], "confirm", {"ticketId": t["id"], "office": t["office"]})
        _touch(state)
        return {"ok": True, "msg": "Confirmation recorded for %s - Status: Closed." % tid}
    if decision == "rejected":
        if not data.get("feedback"):
            return {"ok": False, "msg": "Record office feedback before rejecting."}
        chk = _check_transition(state, t, "in_progress")
        if chk:
            return chk
        prev = t["status"]
        t["confirmation"] = {"state": "rejected", "person": data.get("person") or t["requester"], "date": now_iso(), "feedback": data["feedback"]}
        t["status"] = "in_progress"
        _hist(t, "in_progress", "confirm",
              'Office rejected the result - feedback recorded and returned to diagnosis: "%s"' % data["feedback"],
              t["requester"], "requester")
        _audit_status(state, t, prev, "in_progress", "confirm",
                      'Office rejected the result - feedback: "%s"' % data["feedback"])
        notify(state, "technician", "%s rejected by office - return to diagnosis with feedback." % t["id"], "confirm", {"ticketId": t["id"]})
        notify(state, "coordinator", "%s returned to diagnosis after office feedback." % t["id"], "confirm", {"ticketId": t["id"]})
        _touch(state)
        return {"ok": True, "msg": "Feedback recorded - %s returned to diagnosis." % tid}
    t["confirmation"]["state"] = "no_response"
    t.setdefault("reminders", []).append(now_iso())
    _hist(t, t["status"], "confirm",
          "No response from office - Status kept Resolved; follow-up reminder 1 sent to the office.", "System", "system")
    _audit(state, "ticket", tid, "confirm",
           "No response from office - Status kept %s; follow-up reminder sent." % _label(t["status"]), _label(t["status"]))
    notify(state, "requester", "Follow-up reminder: please confirm the result of %s (%s)." % (t["id"], t["office"]),
           "remind", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "No response recorded - %s stays Resolved, reminder sent." % tid}


def create_linked_ticket(state, role, tid, d):
    state["role"] = role
    g = _guard(state, ["requester", "coordinator"])
    if not g["ok"]:
        return g
    old = get_ticket(state, tid)
    if not old:
        return {"ok": False, "msg": "Ticket not found."}
    ob = _office_block(state, old.get("office"), old.get("requester"))
    if ob:
        return ob
    if old["status"] != "closed":
        return {"ok": False, "msg": "Recurrence can only follow a Closed ticket."}
    old["recurring"] = True
    _hist(old, old["status"], "link",
          "Issue recurs after closure - new ticket linked to previous service record; flows back to Section 1.",
          old["requester"], "requester")
    _audit(state, "ticket", old["id"], "link",
           "Issue recurs after closure - linked recurrence ticket created (Section 1).", _label(old["status"]))
    res = create_ticket(state, role, {
        "office": old["office"], "requester": old["requester"], "category": old["category"],
        "source": old["source"], "issue": d.get("issue") or old["issue"], "asset": old["asset"],
        "linkedTo": old["id"]})
    if not res["ok"]:
        return res
    nt = get_ticket(state, res["id"])
    _hist(nt, "submitted", "link", "Linked corrective ticket following Section 1 - previous record: %s." % old["id"], nt["requester"], "requester")
    _touch(state)
    return {"ok": True, "msg": "Linked ticket %s created (Section 1)." % res["id"], "id": res["id"]}


def request_info(state, role, tid, missing):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] != "submitted":
        return {"ok": False, "msg": "Only Submitted tickets can go back for details."}
    if not missing:
        return {"ok": False, "msg": "List the missing details."}
    chk = _check_transition(state, t, "needs_info")
    if chk:
        return chk
    prev = t["status"]
    t["status"] = "needs_info"
    _hist(t, "needs_info", "status", "Details complete? No - requested missing details: %s" % missing, _who(state)["by"], _who(state)["role"])
    _audit_status(state, t, prev, "needs_info", "status", "Details incomplete - requested: %s" % missing)
    notify(state, "requester", "%s needs information: %s" % (t["id"], missing), "intake", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Status: Needs Information - requester notified."}


def assess(state, role, tid, d):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] != "submitted":
        return {"ok": False, "msg": "Only Submitted tickets can be assessed."}
    if not d.get("impact") or not d.get("urgency") or not d.get("priority") or not d.get("target"):
        return {"ok": False, "msg": "Impact, urgency, priority and target date are all required."}
    d = dict(d)
    derived = priority_for(state, d["impact"], d["urgency"])
    note = ""
    if derived and derived != str(d["priority"]).lower():
        note = " (matrix set %s from %s impact / %s urgency; entered %s overridden)" % (
            derived, d["impact"], d["urgency"], d["priority"])
        d["priority"] = derived
    t["impact"] = d["impact"]; t["urgency"] = d["urgency"]; t["priority"] = d["priority"]; t["target"] = d["target"]
    t["reviewed"] = True
    _hist(t, "submitted", "note", "Details complete? Yes - assessed impact %s, urgency %s; priority %s, target %s."
          % (d["impact"], d["urgency"], d["priority"], d["target"]), _who(state)["by"], _who(state)["role"])
    _audit(state, "ticket", tid, "assess",
           "Assessed impact %s, urgency %s; priority %s, target %s.%s" % (d["impact"], d["urgency"], d["priority"], d["target"], note),
           _label(t["status"]))
    _touch(state)
    return {"ok": True, "msg": "Assessment recorded for %s." % tid}


def assign(state, role, tid, tech):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] != "submitted":
        return {"ok": False, "msg": "Ticket must be Submitted before assignment."}
    if not t.get("reviewed"):
        return {"ok": False, "msg": "Complete review and assessment first (Details complete?)."}
    if not tech:
        return {"ok": False, "msg": "Choose a technician."}
    chk = _check_transition(state, t, "assigned")
    if chk:
        return chk
    t["technician"] = tech; t["status"] = "assigned"
    _hist(t, "assigned", "status", "Assigned to %s - Status: Assigned. Notify technician and requester." % tech, _who(state)["by"], _who(state)["role"])
    _audit_status(state, t, "submitted", "assigned", "status", "Assigned to %s." % tech)
    notify(state, "technician", "%s assigned to you (%s - %s)." % (t["id"], t["office"], t["category"]), "assign", {"ticketId": t["id"]})
    notify(state, "requester", "%s has been assigned to a technician - Status: Assigned." % t["id"], "assign", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Status: Assigned - technician and requester notified."}


def reassign(state, role, tid, tech):
    """Coordinator moves an active ticket to a different technician.

    Valid while the ticket is Assigned, In Progress or On Hold.  The status is
    preserved; only ownership moves.  Both the previous and the new technician
    are notified and the change is audited with the reason.
    """
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] not in ("assigned", "in_progress", "on_hold"):
        return {"ok": False, "msg": "Only Assigned, In Progress or On Hold tickets can be reassigned."}
    if not tech:
        return {"ok": False, "msg": "Choose a technician."}
    if tech == t.get("technician"):
        return {"ok": False, "msg": "Already assigned to %s." % tech}
    old = t.get("technician")
    t["technician"] = tech
    w = _who(state)
    _hist(t, t["status"], "assign", "Reassigned from %s to %s." % (old or "unassigned", tech), w["by"], w["role"])
    _audit(state, "ticket", tid, "reassign",
           "Reassigned from %s to %s." % (old or "unassigned", tech), _label(t["status"]))
    notify(state, "technician", "%s reassigned to you (%s)." % (t["id"], t["office"]), "assign", {"ticketId": t["id"]})
    notify(state, "requester", "%s is now handled by a different technician." % t["id"], "assign", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Reassigned to %s." % tech}


def approve(state, role, tid, note):
    """Coordinator sign-off for categories that require approval before work.

    ``settings.approvalCategories`` lists the categories gated this way; the
    default is empty, so approval is off unless an administrator turns it on.
    ``start_work`` refuses a gated ticket until this sign-off exists.
    """
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t.get("approval") and t["approval"].get("state") == "approved":
        return {"ok": False, "msg": "%s is already approved." % tid}
    if t["status"] not in ("assigned", "on_hold"):
        return {"ok": False, "msg": "Approval applies to Assigned or On Hold tickets."}
    w = _who(state)
    t["approval"] = {"state": "approved", "by": w["by"], "role": w["role"],
                     "at": now_iso(), "note": note or ""}
    _hist(t, t["status"], "approval", "Approval granted by %s%s." % (
        w["by"], (": %s" % note) if note else ""), w["by"], w["role"])
    _audit(state, "ticket", tid, "approve",
           "Approval granted%s." % ((" - %s" % note) if note else ""), _label(t["status"]))
    notify(state, "technician", "%s approved for work (%s)." % (tid, t["office"]), "assign", {"ticketId": tid})
    _touch(state)
    return {"ok": True, "msg": "Approval recorded for %s." % tid}


def coordinate(state, role, tid, d):
    state["role"] = role
    g = _guard(state, ["coordinator", "technician"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if not d.get("date"):
        return {"ok": False, "msg": "Pick a service date."}
    text = "Service schedule coordinated: %s%s, technician %s%s" % (
        d["date"], (" (%s)" % d["slot"]) if d.get("slot") else "",
        d.get("tech") or t.get("technician") or "-",
        (" - %s" % d["notes"]) if d.get("notes") else "")
    actor = _who(state)
    _hist(t, t["status"], "sched", text, actor["by"], actor["role"])
    _audit(state, "ticket", tid, "sched", text, _label(t["status"]))
    notify(state, "technician", "Schedule for %s: %s%s" % (t["id"], d["date"], (" " + d["slot"]) if d.get("slot") else ""), "sched", {"ticketId": t["id"]})
    notify(state, "requester", "Visit scheduled for %s on %s." % (t["id"], d["date"]), "sched", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Schedule coordinated for %s." % tid}


def request_withdrawal(state, role, tid, reason):
    """Office Requester asks for an active request to be withdrawn.

    The PDF places the withdrawal itself ("Active request withdrawn" ->
    "Record cancellation reason") in the IT Coordinator lane, so the office
    only *requests* it here.  The status is unchanged: the coordinator records
    the cancellation reason, which is the move that sets Status: Cancelled.
    """
    state["role"] = role
    g = _guard(state, ["requester"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    ob = _office_block(state, t.get("office"), t.get("requester"))
    if ob:
        return ob
    if t["status"] in ("closed", "cancelled"):
        return {"ok": False, "msg": "This request is already closed or cancelled."}
    if t.get("withdrawal"):
        return {"ok": False, "msg": "Withdrawal already requested - the IT Coordinator will action it."}
    if not reason:
        return {"ok": False, "msg": "Record why the request is no longer needed."}
    t["withdrawal"] = {"reason": reason, "at": now_iso(), "by": _who(state)["by"]}
    _hist(t, t["status"], "withdraw",
          "Office requested withdrawal of the active request: %s - sent to the IT Coordinator, who records the cancellation reason." % reason,
          _who(state)["by"], _who(state)["role"])
    _audit(state, "ticket", tid, "withdraw",
           "Withdrawal requested by the office: %s - status unchanged, IT Coordinator to record the cancellation reason." % reason,
           _label(t["status"]))
    notify(state, "coordinator", "%s withdrawal requested by the office - record the cancellation reason." % t["id"],
           "cancel", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Withdrawal requested - the IT Coordinator will record the cancellation reason."}


def cancel(state, role, tid, reason):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    ob = _office_block(state, t.get("office"), t.get("requester"))
    if ob:
        return ob
    if t["status"] in ("closed", "cancelled"):
        return {"ok": False, "msg": "Terminal tickets cannot be cancelled."}
    if not reason:
        return {"ok": False, "msg": "Record the cancellation reason."}
    chk = _check_transition(state, t, "cancelled")
    if chk:
        return chk
    prev = t["status"]
    t["status"] = "cancelled"; t["cancelReason"] = reason
    withdrawn = t.get("withdrawal")
    if withdrawn:
        t["withdrawal"] = dict(withdrawn, actionedAt=now_iso(), actionedBy=_who(state)["by"])
    _hist(t, "cancelled", "cancel", "Cancellation reason recorded - Status: Cancelled. Requester notified; records and activity history preserved.", _who(state)["by"], _who(state)["role"])
    _audit_status(state, t, prev, "cancelled", "cancel", "Cancellation reason: %s" % reason)
    notify(state, "requester", "%s cancelled - reason: %s" % (t["id"], reason), "cancel", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Status: Cancelled - records preserved."}


def follow_up(state, role, tid, text):
    """Record a dependency follow-up update.

    Section 4A.2 and Appendix G: the IT Coordinator owns the dependency
    follow-up ("Follow up dependency" and "Record follow-up updates" are
    IT Coordinator lane steps).  The technician records the dependency itself,
    the coordinator chases it.
    """
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t or not t.get("dependency"):
        return {"ok": False, "msg": "No dependency recorded."}
    if not text:
        return {"ok": False, "msg": "Record the follow-up update."}
    from datetime import timedelta
    from db import now_iso as _n
    import datetime as _dt
    due = (_dt.datetime.now(_dt.timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    t["dependency"]["updates"].append({"at": _n(), "text": text})
    t["dependency"]["dueAt"] = due
    w = _who(state)
    _hist(t, t["status"], "dep", "Dependency outcome? Still pending - follow-up recorded: %s" % text, w["by"], w["role"])
    _audit(state, "ticket", tid, "dep", "Dependency follow-up recorded: %s" % text, _label(t["status"]))
    _touch(state)
    return {"ok": True, "msg": "Follow-up recorded for %s." % tid}


def resolve_dependency(state, role, tid, note=None):
    """Coordinator records the dependency outcome and returns the ticket to work.

    Section 7 decision "Dependency outcome? Resolved": the coordinator owns the
    dependency follow-up, so only a coordinator may resolve it, and the outcome
    note is mandatory (who confirmed, what changed).  The status move itself is
    still checked against the transition whitelist.
    """
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t or not t.get("dependency") or t["dependency"]["state"] != "pending":
        return {"ok": False, "msg": "No pending dependency."}
    if t["status"] != "on_hold":
        return {"ok": False, "msg": "Only On Hold tickets return through a resolved dependency."}
    if not note:
        return {"ok": False, "msg": "Record the dependency outcome note (what resolved it)."}
    prev = t["status"]
    target = t.get("holdReturn") or "in_progress"
    chk = _check_transition(state, t, target)
    if chk:
        return chk
    t["dependency"]["state"] = "resolved"
    t["status"] = target
    _hist(t, t["status"], "dep", "Dependency outcome? Resolved (%s) - returned to %s." % (note, t["status"].upper().replace("_", " ")), _who(state)["by"], _who(state)["role"])
    _audit_status(state, t, prev, t["status"], "dep", "Dependency resolved: %s - work resumes." % note)
    notify(state, "technician", "Dependency for %s resolved - work can continue." % t["id"], "dep", {"ticketId": t["id"]})
    _touch(state)
    return {"ok": True, "msg": "Dependency resolved - back in progress."}


def cancel_from_dependency(state, role, tid, reason):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t or not t.get("dependency"):
        return {"ok": False, "msg": "No dependency recorded."}
    if t["status"] in ("closed", "cancelled"):
        return {"ok": False, "msg": "Terminal tickets cannot be cancelled."}
    if not reason:
        return {"ok": False, "msg": "Record why the dependency cannot proceed."}
    # "Cannot proceed" is a Cancelled move, so it obeys the same transition
    # whitelist as any other cancellation (Section 7 + Appendix B matrix).
    chk = _check_transition(state, t, "cancelled")
    if chk:
        return chk
    prev = t["status"]
    t["dependency"]["state"] = "blocked"
    t["status"] = "cancelled"; t["cancelReason"] = reason
    _hist(t, "cancelled", "cancel", "Dependency outcome? Cannot proceed - cancellation reason recorded. Status: Cancelled; records preserved.", _who(state)["by"], _who(state)["role"])
    _audit_status(state, t, prev, "cancelled", "cancel", "Dependency cannot proceed - reason: %s" % reason)
    notify(state, "requester", "%s cancelled - dependency cannot proceed: %s" % (t["id"], reason), "cancel", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Cancelled with reason - records preserved."}


def start_work(state, role, tid, note=None):
    """Technician starts assigned work (Section 4: Status -> In Progress).

    Before work starts the visit must be coordinated with the office, so this
    refuses to start unless either a schedule-coordination entry already exists
    on the ticket or the technician records a coordination note here.
    """
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] != "assigned":
        return {"ok": False, "msg": "Only Assigned tickets can start."}
    if not _assigned_to_actor(state, t):
        return {"ok": False, "msg": "Only the assigned technician can start this ticket."}
    chk = _check_transition(state, t, "in_progress")
    if chk:
        return chk
    gated = _settings(state).get("approvalCategories")
    if isinstance(gated, (list, tuple)) and t.get("category") in [str(c) for c in gated]:
        if not (t.get("approval") and t["approval"].get("state") == "approved"):
            return {"ok": False, "msg": "This category needs coordinator approval before work starts (%s)." % t["category"]}
    coordinated = any(h.get("kind") == "sched" for h in t.get("history", []))
    if not coordinated and not note:
        return {"ok": False, "msg": "Coordinate the visit with the office first (schedule entry or coordination note)."}
    t["status"] = "in_progress"
    w = _who(state)
    _hist(t, "in_progress", "status", "Work started - Status: In Progress. Reviewed ticket and previous office/asset history.%s" % ((" Coordination note: %s" % note) if note else ""), w["by"], w["role"])
    _audit_status(state, t, "assigned", "in_progress", "status", "Work started.")
    notify(state, "coordinator", "%s is now In Progress (%s)." % (t["id"], w["by"]), "assign", {"ticketId": t["id"]})
    _touch(state)
    return {"ok": True, "msg": "Status: In Progress."}


def diagnose(state, role, tid, d):
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] not in ("in_progress", "on_hold"):
        return {"ok": False, "msg": "Diagnosis requires an active ticket."}
    if not _assigned_to_actor(state, t):
        return {"ok": False, "msg": "Only the assigned technician can record diagnosis."}
    if not d.get("findings"):
        return {"ok": False, "msg": "Diagnosis findings are required."}
    evidence = d.get("evidence") or t["diagnosis"].get("evidence", [])
    t["diagnosis"] = {"findings": d["findings"], "actions": d.get("actions") or "", "parts": d.get("parts") or "",
                      "cost": float(d.get("cost") or 0), "labor": float(d.get("labor") or 0),
                      "startDate": d.get("startDate") or now_iso()[:10], "endDate": d.get("endDate") or now_iso()[:10], "evidence": list(evidence)}
    _hist(t, t["status"], "note", "Diagnosis recorded: %s%s" % (d["findings"], (" | Actions: %s" % d["actions"]) if d.get("actions") else ""), _who(state)["by"], _who(state)["role"])
    _audit(state, "ticket", tid, "diagnosis", "Diagnosis recorded: %s" % d["findings"], _label(t["status"]))
    _touch(state)
    return {"ok": True, "msg": "Diagnosis recorded for %s." % tid}


def record_repair(state, role, tid, d):
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] not in ("in_progress", "on_hold"):
        return {"ok": False, "msg": "Repair recording requires an active ticket."}
    if not _assigned_to_actor(state, t):
        return {"ok": False, "msg": "Only the assigned technician can record the repair."}
    if not t["diagnosis"].get("findings"):
        return {"ok": False, "msg": "Record the diagnosis findings first (SOP 13 before repair)."}
    if not d.get("actions"):
        return {"ok": False, "msg": "Record the repair / actions performed."}
    diag = t["diagnosis"]
    diag["actions"] = d["actions"]
    if d.get("parts"):
        diag["parts"] = d["parts"]
    if d.get("cost") not in (None, ""):
        diag["cost"] = float(d["cost"])
    if d.get("labor") not in (None, ""):
        diag["labor"] = float(d["labor"])
    if d.get("startDate"):
        diag["startDate"] = d["startDate"]
    if d.get("endDate"):
        diag["endDate"] = d["endDate"]
    if d.get("evidence"):
        diag["evidence"] = list(d["evidence"])
    t["repairedAt"] = now_iso()
    _hist(t, t["status"], "note",
          "Perform repair/installation/configuration/troubleshooting - actions: %s%s | ₱%.2f · %sh."
          % (d["actions"], (" | parts: %s" % diag["parts"]) if diag.get("parts") else "",
             float(diag.get("cost") or 0), float(diag.get("labor") or 0)),
          _who(state)["by"], _who(state)["role"])
    _audit(state, "ticket", tid, "repair",
           "Repair recorded: %s (₱%.2f · %sh)." % (d["actions"], float(diag.get("cost") or 0), float(diag.get("labor") or 0)),
           _label(t["status"]))
    _touch(state)
    return {"ok": True, "msg": "Repair actions recorded for %s." % tid}


def place_hold(state, role, tid, dep):
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] != "in_progress":
        return {"ok": False, "msg": "Only In Progress tickets can be put on hold."}
    if not _assigned_to_actor(state, t):
        return {"ok": False, "msg": "Only the assigned technician can place this ticket on hold."}
    if not dep.get("reason") or not dep.get("responsible") or not dep.get("nextAction"):
        return {"ok": False, "msg": "Dependency reason, responsible person and next action are required."}
    chk = _check_transition(state, t, "on_hold")
    if chk:
        return chk
    import datetime as _dt
    from datetime import timedelta
    due = dep.get("dueAt") or ((_dt.datetime.now(_dt.timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z")
    t["holdReturn"] = "in_progress"
    t["dependency"] = {"reason": dep["reason"], "responsible": dep["responsible"], "nextAction": dep["nextAction"],
                       "state": "pending", "dueAt": due, "updates": []}
    t["status"] = "on_hold"
    _hist(t, "on_hold", "dep", "Parts, approval or external support needed? Yes - Status: On Hold. Dependency: %s (responsible: %s)." % (dep["reason"], dep["responsible"]), _who(state)["by"], _who(state)["role"])
    _audit_status(state, t, "in_progress", "on_hold", "dep",
                  "Dependency recorded: %s (responsible: %s, next: %s)." % (dep["reason"], dep["responsible"], dep["nextAction"]))
    notify(state, "coordinator", "%s On Hold - dependency: %s" % (t["id"], dep["reason"]), "dep", {"ticketId": t["id"]})
    _touch(state)
    return {"ok": True, "msg": "Status: On Hold - dependency recorded."}


def record_test(state, role, tid, result, note):
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] != "in_progress":
        return {"ok": False, "msg": "Testing happens while In Progress."}
    if not _assigned_to_actor(state, t):
        return {"ok": False, "msg": "Only the assigned technician can record the test result."}
    if not t["diagnosis"].get("findings"):
        return {"ok": False, "msg": "Record diagnosis first (SOP 13 before testing)."}
    if result == "pass":
        if not note:
            return {"ok": False, "msg": "Record the service summary note before resolving (what was done and verified)."}
        chk = _check_transition(state, t, "resolved")
        if chk:
            return chk
        t["tests"].append({"at": now_iso(), "by": _who(state)["by"], "result": "pass", "note": note})
        t["status"] = "resolved"; t["resolvedAt"] = now_iso()
        t["confirmation"] = {"state": "pending", "person": "", "date": None, "feedback": ""}
        w = _who(state)
        _hist(t, "resolved", "test", "Service passed testing - Status: Resolved (resolved means technician testing passed). Office notified, ready for confirmation. Summary: %s" % note, w["by"], w["role"])
        _audit_status(state, t, "in_progress", "resolved", "test",
                      "Service passed testing - office confirmation requested. Summary: %s" % note)
        notify(state, "requester", "%s is Resolved - please review and confirm the service result." % t["id"], "confirm", {"ticketId": t["id"], "office": t["office"]})
        notify(state, "coordinator", "%s resolved by %s - awaiting office confirmation." % (t["id"], w["by"]), "confirm", {"ticketId": t["id"]})
        _touch(state)
        return {"ok": True, "msg": "Test passed - Status: Resolved, office notified."}
    t["tests"].append({"at": now_iso(), "by": _who(state)["by"], "result": "fail", "note": note or ""})
    _hist(t, "in_progress", "test", "Record failed test - service did not pass testing; returned to diagnosis.%s" % ((" Notes: %s" % note) if note else ""), _who(state)["by"], _who(state)["role"])
    _audit(state, "ticket", tid, "test",
           "Failed test recorded - returned to diagnosis.%s" % ((" Notes: %s" % note) if note else ""), _label(t["status"]))
    notify(state, "coordinator", "%s failed testing - technician returned to diagnosis." % t["id"], "test", {"ticketId": t["id"]})
    _touch(state)
    return {"ok": True, "msg": "Failed test recorded - back to diagnosis."}


def close(state, role, tid, mode, reason):
    state["role"] = role
    g = _guard(state, ["coordinator", "requester"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    ob = _office_block(state, t.get("office"), t.get("requester"))
    if ob:
        return ob
    if t["status"] != "resolved":
        return {"ok": False, "msg": "Only Resolved tickets can be closed."}
    if mode == "confirmation":
        # Closing after office confirmation is an office decision: only the
        # office requester (the owning office) closes their own ticket once
        # they have accepted the result.  The IT Coordinator cannot answer on
        # the office's behalf; the coordinator closes through the audited
        # authorized closure, which always carries a reason (Section 4A.2,
        # D4 and the acceptance test).
        if role != "requester":
            return {"ok": False, "msg": "Confirmation closure is limited to the owning office requester."}
        if t["confirmation"]["state"] != "accepted":
            return {"ok": False, "msg": "Confirmation not yet accepted - use authorized closure only when allowed."}
    else:
        if not reason:
            return {"ok": False, "msg": "Authorized closure requires a reason."}
        allowed = _settings(state).get("authorizedClosureRoles")
        if not (isinstance(allowed, (list, tuple)) and allowed):
            allowed = ["coordinator"]
        allowed = [r for r in allowed if r != "management"]
        if not allowed:
            allowed = ["coordinator"]
        if role not in allowed:
            return {"ok": False, "msg": "Authorized closure is limited to: %s." % ", ".join(allowed)}
    chk = _check_transition(state, t, "closed")
    if chk:
        return chk
    t["status"] = "closed"; t["closedAt"] = now_iso(); t["closure"] = mode; t["authorizedReason"] = reason or ""
    actor = _who(state)
    _hist(t, "closed", "status",
          "Status: Closed after confirmation. Office service history and reporting updated; record retained."
          if mode == "confirmation" else
          "Authorized closure - reason: %s. Status: Closed; office service history and reporting updated." % reason,
          actor["by"], actor["role"])
    _audit_status(state, t, "resolved", "closed", "status",
                  "Closed after office confirmation." if mode == "confirmation"
                  else "Authorized closure - reason: %s" % reason)
    notify(state, "requester", "%s is now Closed. Thank you." % t["id"], "confirm", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Status: Closed - service record retained."}


def send_reminder(state, role, tid):
    state["role"] = role
    g = _guard(state, ["coordinator", "system"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t["status"] != "resolved":
        return {"ok": False, "msg": "Reminders apply to Resolved tickets awaiting confirmation."}
    if t["confirmation"]["state"] in ("accepted", "rejected"):
        return {"ok": False, "msg": "The office has already responded to %s." % tid}
    t["reminders"].append(now_iso())
    _hist(t, "resolved", "remind", "No response - Status kept Resolved; follow-up reminder sent to the office (%d)." % len(t["reminders"]), "System", "system")
    _audit(state, "ticket", tid, "remind",
           "Follow-up reminder %d sent to the office." % len(t["reminders"]), _label(t["status"]))
    notify(state, "requester", "Follow-up reminder: please confirm the result of %s." % t["id"], "remind", {"ticketId": t["id"], "office": t["office"]})
    _touch(state)
    return {"ok": True, "msg": "Follow-up reminder sent for %s." % tid}


# ===================================================== Maint (Sections 2 + 3)
def create_schedule(state, role, d):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    if not d.get("office") or not d.get("category") or not d.get("dueDate") or not d.get("frequency") or not d.get("technician"):
        return {"ok": False, "msg": "Office, category, frequency, due date and technician are required."}
    if not d.get("checklist"):
        return {"ok": False, "msg": "Provide at least one checklist item."}
    interval = _custom_interval(d)
    if interval is False:
        return {"ok": False, "msg": "A Custom cadence needs a whole number of days between 1 and 3650."}
    sid = next_id(state, "sched")
    state["schedules"].append({
        "id": sid, "office": d["office"], "assets": list(d.get("assets") or []), "category": d["category"],
        "checklist": list(d["checklist"]), "frequency": d["frequency"], "dueDate": d["dueDate"],
        "intervalDays": interval, "technician": d["technician"], "active": True,
        "lastCheck": None, "nextCheck": d["dueDate"]})
    notify(state, "coordinator", "%s created for %s - due %s." % (sid, d["office"], d["dueDate"][:10]), "sched", {"office": d["office"]})
    _audit(state, "schedule", sid, "sched",
           "Schedule created - %s %s every %s, first due %s." % (d["office"], d["category"], d["frequency"], d["dueDate"][:10]))
    _touch(state)
    return {"ok": True, "msg": "Schedule %s recorded." % sid, "id": sid}


def _run_schedule_check(state, silent=False):
    """System worker. Returns a list of event dicts."""
    from datetime import datetime, timezone
    events = []
    now = datetime.now(timezone.utc).timestamp() * 1000
    for sc in list(state["schedules"]):
        if not sc.get("active"):
            continue
        sc["lastCheck"] = now_iso()
        due_ms = _parse_ms(sc["dueDate"])
        if due_ms > now:
            if not silent:
                events.append({"kind": "wait", "id": sc["id"], "msg": "%s: not due yet - keep schedule active, next check %s" % (sc["id"], sc["dueDate"][:10])})
            continue
        occ = sc["dueDate"]
        existing = next((j for j in state["jobs"] if j["scheduleId"] == sc["id"] and j["occurrence"] == occ), None)
        if existing:
            if not silent:
                events.append({"kind": "exists", "id": sc["id"], "jobId": existing["id"], "msg": "%s: job %s already exists - used existing job, not duplicated." % (sc["id"], existing["id"])})
            continue
        jid = next_id(state, "job")
        state["jobs"].insert(0, {
            "id": jid, "scheduleId": sc["id"], "occurrence": occ, "office": sc["office"],
            "assets": list(sc["assets"]), "technician": sc["technician"], "category": sc["category"],
            "checklist": list(sc["checklist"]),
            "items": [{"task": task, "done": False, "result": "", "finding": "", "tech": "", "date": "", "evidence": []} for task in sc["checklist"]],
            "status": "submitted", "availability": None, "visitDate": None, "reschedules": [],
            "additionalFault": "unknown", "linkedTicketId": None, "outcome": None,
            "confirmation": {"state": "none", "person": "", "date": None}, "nextDue": None, "createdAt": now_iso()})
        _audit(state, "job", jid, "sched",
               "Maintenance job generated from schedule %s (%s) - occurrence %s, technician %s."
               % (sc["id"], sc["office"], occ[:10] if occ else "-", sc["technician"]),
               "Submitted", actor=SYSTEM)
        notify(state, "technician", "%s generated from %s (%s) - coordinate the visit." % (jid, sc["id"], sc["office"]), "job",
               {"jobId": jid, "office": sc["office"]}, to=sc.get("technician"))
        notify(state, "coordinator", "%s generated from %s - maintenance due." % (jid, sc["id"]), "job", {"jobId": jid})
        events.append({"kind": "gen", "id": sc["id"], "jobId": jid, "msg": "%s due - generated linked maintenance job %s." % (sc["id"], jid)})
    if events:
        _touch(state)
    return events


def _parse_ms(iso):
    from datetime import datetime, timezone
    try:
        s = iso.replace("Z", "+00:00")
        return datetime.fromisoformat(s).timestamp() * 1000
    except (ValueError, AttributeError):
        return 0


# The office is in Asia/Manila, which is UTC+8 with no daylight saving, so the
# calendar date of an instant is a fixed shift rather than a zone lookup.
MANILA_OFFSET_MS = 8 * 3600000
# Weekday numbers follow Python's `date.weekday()`: Monday is 0, Sunday is 6.
DEFAULT_WORKDAYS = (0, 1, 2, 3, 4)
WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                 "Saturday", "Sunday")
DAY_MS = 86400000


def _manila_day(ms):
    """The Asia/Manila calendar date of an instant and its weekday (Monday 0)."""
    from datetime import datetime, timezone
    d = datetime.fromtimestamp((ms + MANILA_OFFSET_MS) / 1000, timezone.utc)
    return d.strftime("%Y-%m-%d"), d.weekday()


def working_days(d):
    """Normalise a workweek setting to an ordered set of weekday numbers."""
    return set(int(x) for x in (DEFAULT_WORKDAYS if d is None else d))


def closed_days(h):
    """Normalise a holiday list to a set of `YYYY-MM-DD` dates."""
    return set(str(x).strip() for x in (h or []) if str(x).strip())


def working_due_ms(base_ms, days, workdays=None, holidays=None):
    """The instant `days` working days after the anchor, at the same clock time.

    Assumption A4 counts the reminder interval in business days and A5 defines
    them as Monday to Friday, so an interval that lands on a rest day or on a
    closed date moves to the next working day rather than firing into an empty
    office. The anchor itself moves first: a request answered on a Sunday starts
    its count on Monday.
    """
    days = max(0, int(days or 0))
    off = working_days(workdays)
    closed = closed_days(holidays)

    def next_working(ms):
        # Seven hops cover a whole rest week; 400 covers a settings block that
        # closes every date for a year, and then the interval is calendar based
        # rather than never arriving.
        for _ in range(400):
            key, weekday = _manila_day(ms)
            if weekday in off and key not in closed:
                return ms
            ms += DAY_MS
        return None

    ms = next_working(base_ms)
    if ms is None:
        return base_ms + days * DAY_MS
    for _ in range(days):
        ms = next_working(ms + DAY_MS)
        if ms is None:
            return base_ms + days * DAY_MS
    return ms


def world_tick(state):
    """One tick of the world clock (system workers).

    Ports the deterministic, non-simulation logic of js/live.js `tick()`:
    schedule checks, resolved-confirmation reminders, dependency follow-ups and
    rescheduled jobs whose agreed date arrived.  Returns a list of event messages.
    """
    from datetime import datetime, timedelta, timezone
    events = []
    for e in _run_schedule_check(state, silent=True):
        events.append(e.get("msg", e.get("kind")))

    now = datetime.now(timezone.utc)
    now_ms = now.timestamp() * 1000

    for t in state["tickets"]:
        if t["status"] != "resolved" or t["confirmation"]["state"] not in ("pending", "no_response"):
            continue
        base = _parse_ms(t.get("resolvedAt") or t["updatedAt"])
        st = _settings(state)
        mode = st.get("reminderMode", "minutes")
        if mode == "business" and st.get("reminderMinutes", 2) >= 1:
            sent = len(t.get("reminders", []))
            if sent == 0:
                every_days = int(st.get("reminderBusinessDays", 3))
            else:
                every_days = int(st.get("reminderRepeatDays", 7))
            due = working_due_ms(base, every_days, st.get("workdays"), st.get("holidays"))
        else:
            every = max(int(float(st.get("reminderMinutes", 2)) * 60000), 1)
            due = base + (len(t.get("reminders", [])) + 1) * every
        if now_ms >= due:
            t.setdefault("reminders", []).append(now_iso())
            _hist(t, "resolved", "remind", "No response - Status kept Resolved; follow-up reminder %d sent to the office." % len(t["reminders"]), "System", "system")
            _audit(state, "ticket", t["id"], "remind",
                   "Follow-up reminder %d sent to the office." % len(t["reminders"]), _label(t["status"]), actor=SYSTEM)
            t["updatedAt"] = now_iso()
            notify(state, "requester",
                   "Follow-up reminder: please confirm the result of %s (%s)." % (t["id"], t["office"]),
                   "remind", {"ticketId": t["id"], "office": t["office"]})
            events.append("Reminder loop: %s still Resolved - follow-up reminder sent." % t["id"])

    for j in state["jobs"]:
        cf = j.get("confirmation") or {}
        if j["status"] != "resolved" or cf.get("state") not in ("pending", "no_response"):
            continue
        base = _parse_ms(j.get("resolvedAt") or j.get("updatedAt") or j.get("createdAt"))
        st = _settings(state)
        if st.get("reminderMode", "minutes") == "business" and st.get("reminderMinutes", 2) >= 1:
            sent = len(j.get("reminders", []))
            every_days = int(st.get("reminderBusinessDays", 3)) if sent == 0 else int(st.get("reminderRepeatDays", 7))
            due = working_due_ms(base, every_days, st.get("workdays"), st.get("holidays"))
        else:
            every = max(int(float(st.get("reminderMinutes", 2)) * 60000), 1)
            due = base + (len(j.get("reminders", [])) + 1) * every
        if now_ms < due:
            continue
        j.setdefault("reminders", []).append(now_iso())
        _audit(state, "job", j["id"], "remind",
               "Follow-up reminder %d sent to the office - job still Resolved." % len(j["reminders"]),
               _label(j["status"]), actor=SYSTEM)
        notify(state, "requester",
               "Follow-up reminder: please confirm the result of maintenance %s (%s)." % (j["id"], j["office"]),
               "remind", {"jobId": j["id"], "office": j["office"]})
        events.append("Reminder loop: maintenance %s still Resolved - follow-up sent." % j["id"])

    for t in state["tickets"]:
        dep = t.get("dependency")
        if t["status"] != "on_hold" or not dep or dep.get("state") != "pending":
            continue
        if _parse_ms(dep.get("dueAt")) <= now_ms:
            dep["dueAt"] = (now + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
            notify(state, "coordinator",
                   "Dependency follow-up due: %s - %s (%s)." % (t["id"], dep.get("nextAction"), dep.get("responsible")),
                   "dep", {"ticketId": t["id"]})
            _audit(state, "ticket", t["id"], "dep",
                   "Dependency follow-up nudged - %s (%s)." % (dep.get("nextAction"), dep.get("responsible")),
                   _label(t["status"]), actor=SYSTEM)
            events.append("Follow up dependency due: %s." % t["id"])

    for j in state["jobs"]:
        if j["status"] == "on_hold" and j.get("visitDate") and _parse_ms(j["visitDate"]) <= now_ms:
            # A reschedule clears the old answer (N49 -> N38 -> N49).  When the
            # agreed date arrives the office answers availability again; the
            # visit only returns to Assigned after a yes.
            if j.get("availability") == "yes":
                j["status"] = "assigned"
                _audit(state, "job", j["id"], "sched",
                       "Agreed reschedule date reached after the office confirmed availability - visit may proceed.",
                       _label(j["status"]), actor=SYSTEM)
                notify(state, "technician",
                       "Agreed date reached for %s - continue the maintenance visit." % j["id"],
                       "sched", {"jobId": j["id"], "office": j["office"]}, to=j.get("technician"))
                events.append("On agreed date: %s visit can proceed." % j["id"])
            elif j.get("availability") != "asked":
                j["availability"] = "asked"
                _audit(state, "job", j["id"], "sched",
                       "Agreed reschedule date reached - availability confirmation requested from the office.",
                       _label(j["status"]), actor=SYSTEM)
                notify(state, "requester",
                       "Confirm availability for the rescheduled maintenance visit %s on %s."
                       % (j["id"], (j.get("visitDate") or "")[:10]),
                       "sched", {"jobId": j["id"], "office": j["office"]})
                notify(state, "coordinator",
                       "%s: agreed reschedule date reached; waiting for the office availability answer." % j["id"],
                       "sched", {"jobId": j["id"], "office": j["office"]})
                events.append("Availability confirmation requested: %s." % j["id"])

    if len(state["notifications"]) > 120:
        del state["notifications"][120:]
    if events:
        _touch(state)
    return events


def reschedule_job(state, role, job_id, new_date, reason):
    """Record a reschedule of a maintenance visit.

    Section 10 step 6: the Office Requester agrees a new maintenance date
    when the office is unavailable, and the IT Coordinator records the
    reschedule on the office's behalf.  The technician does not own the visit
    date, so the action is not offered to that role.
    """
    state["role"] = role
    g = _guard(state, ["coordinator", "requester"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    ob = _office_block(state, j.get("office"))
    if ob:
        return ob
    if j["status"] == "closed":
        return {"ok": False, "msg": "Job already closed."}
    if not new_date:
        return {"ok": False, "msg": "Agree on a new maintenance date."}
    actor = _who(state)
    sc = get_schedule(state, j["scheduleId"])
    j["reschedules"].append({"from": j.get("visitDate") or (sc["dueDate"] if sc else None), "to": new_date, "reason": reason or "Office unavailable", "at": now_iso(), "by": actor["by"], "role": actor["role"]})
    j["visitDate"] = new_date
    j["status"] = "on_hold"
    # The availability check repeats on the agreed date (node N49 -> N38 ->
    # N49), so the answer is no longer on record.
    j["availability"] = "pending"
    # Do NOT advance the schedule's due date on a one-off reschedule
    # (prevents the duplicate-job bug where run_schedule_check sees a new due
    # and generates another job). The schedule keeps its original cadence anchor.
    notify(state, "technician", "Job %s rescheduled to %s (record reschedule)." % (j["id"], new_date[:10]), "sched",
           {"jobId": j["id"], "office": j["office"]}, to=j.get("technician"))
    notify(state, "requester", "Maintenance for %s rescheduled to %s." % (j["office"], new_date[:10]), "sched", {"jobId": j["id"], "office": j["office"]})
    _audit(state, "job", j["id"], "sched",
           "Rescheduled to %s - reason: %s." % (new_date[:10], reason or "Office unavailable"), "Rescheduled")
    _touch(state)
    return {"ok": True, "msg": "Reschedule recorded - %s." % new_date[:10]}


def reassign_job(state, role, job_id, tech):
    """Coordinator moves a maintenance visit to a different technician.

    Section 10 step 7: the IT Coordinator assigns the maintenance technician.
    A visit already generated by the schedule carries the schedule's technician;
    this action changes the owner without touching the visit status or the
    agreed date.  Both the previous and the new technician are notified.
    """
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    ob = _office_block(state, j.get("office"))
    if ob:
        return ob
    if j["status"] not in ("submitted", "assigned", "in_progress", "on_hold"):
        return {"ok": False, "msg": "Only an open visit can be reassigned (%s is %s)." % (job_id, _label(j["status"]))}
    if not tech:
        return {"ok": False, "msg": "Choose a technician."}
    if tech == j.get("technician"):
        return {"ok": False, "msg": "Already assigned to %s." % tech}
    old = j.get("technician")
    j["technician"] = tech
    w = _who(state)
    _audit(state, "job", job_id, "assign",
           "Reassigned from %s to %s." % (old or "unassigned", tech), _label(j["status"]))
    if old:
        notify(state, "technician", "%s was reassigned to %s; it is no longer yours." % (j["id"], tech),
               "assign", {"jobId": j["id"], "office": j["office"]}, to=old)
    notify(state, "technician", "%s reassigned to you (%s, visit %s)." % (j["id"], j["office"], (j.get("visitDate") or "-")[:10]),
           "assign", {"jobId": j["id"], "office": j["office"]}, to=tech)
    notify(state, "coordinator", "%s reassigned from %s to %s by %s." % (j["id"], old or "unassigned", tech, w["by"]),
           "assign", {"jobId": j["id"], "office": j["office"]})
    _touch(state)
    return {"ok": True, "msg": "Reassigned to %s." % tech}


def confirm_availability(state, role, job_id, yes):
    """Office available? The office answers, the system records it.

    Section 10 step 6 and Section 4A.2: the Office Requester answers the
    availability question and the IT Coordinator may record the answer on the
    office's behalf.  The technician does not own the visit date.
    """
    state["role"] = role
    g = _guard(state, ["coordinator", "requester"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    ob = _office_block(state, j.get("office"))
    if ob:
        return ob
    if j["status"] not in ("submitted", "on_hold"):
        return {"ok": False, "msg": "Availability is recorded while the visit is being coordinated (%s is %s)." % (job_id, _label(j["status"]))}
    if yes:
        from datetime import datetime, timezone
        prev = j["status"]
        j["availability"] = "yes"
        j["visitDate"] = j.get("visitDate") or now_iso()
        # The office answered the availability question, so coordination is
        # done: Submitted -> Assigned releases the technician checklist.  A
        # rescheduled (On Hold) visit only returns once its agreed date arrives.
        if prev == "submitted":
            j["status"] = "assigned"
        elif prev == "on_hold" and _parse_ms(j.get("visitDate")) <= datetime.now(timezone.utc).timestamp() * 1000:
            j["status"] = "assigned"
        visit = (j.get("visitDate") or "")[:10]
        if j["status"] == "assigned":
            notify(state, "technician", "Office available for %s - visit confirmed for %s; the job is Assigned." % (j["id"], visit),
                   "sched", {"jobId": j["id"], "office": j["office"]}, to=j.get("technician"))
            notify(state, "coordinator", "%s: office available for %s - job Assigned to %s." % (j["id"], visit, j.get("technician")),
                   "sched", {"jobId": j["id"], "office": j["office"]})
        else:
            notify(state, "technician", "Office available for %s - visit remains On Hold until %s." % (j["id"], visit),
                   "sched", {"jobId": j["id"], "office": j["office"]}, to=j.get("technician"))
        _audit(state, "job", j["id"], "sched",
               "Office available - visit confirmed for %s." % visit, _label(j["status"]))
        _touch(state)
        return {"ok": True, "msg": "Office available - visit coordinated (%s)." % _label(j["status"])}
    return {"ok": False, "msg": "Record the reschedule instead (Office available? No)."}


def record_checklist_item(state, role, job_id, idx, data):
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    if not _assigned_to_actor(state, j):
        return {"ok": False, "msg": "Only the assigned technician can record the checklist."}
    if j["status"] not in ("assigned", "in_progress"):
        return {"ok": False, "msg": "The checklist opens once the visit is Assigned (%s is %s)." % (job_id, _label(j["status"]))}
    if idx < 0 or idx >= len(j["items"]):
        return {"ok": False, "msg": "Checklist item not found."}
    if not data.get("result"):
        return {"ok": False, "msg": "Record the result for this checklist item."}
    it = j["items"][idx]
    it["done"] = True; it["result"] = data["result"]; it["finding"] = data.get("finding") or ""
    it["tech"] = _who(state)["by"]; it["date"] = now_iso()
    if data.get("evidence"):
        it["evidence"] = list(data["evidence"])
    j["status"] = "in_progress"
    _audit(state, "job", j["id"], "checklist",
           "Checklist item %d/%d done - %s: %s." % (idx + 1, len(j["items"]), it["result"], it["task"]), "In Progress")
    _touch(state)
    return {"ok": True, "msg": "Checklist item recorded (%d/%d)." % (idx + 1, len(j["items"]))}


def create_fault_ticket(state, role, job_id):
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    if not _assigned_to_actor(state, j):
        return {"ok": False, "msg": "Only the assigned technician can raise a corrective ticket."}
    if j["additionalFault"] != "yes":
        return {"ok": False, "msg": 'Set "Additional fault discovered? Yes" first.'}
    if j.get("linkedTicketId"):
        return {"ok": False, "msg": "Corrective ticket %s already exists." % j["linkedTicketId"]}
    # The corrective ticket is raised on the technician's behalf, so it goes
    # through the unguarded recorder rather than the requester/coordinator intake.
    tid = _record_ticket(state, {
        "office": j["office"], "requester": "Maintenance visit %s" % j["id"], "category": j["category"],
        "source": "on-site",
        "issue": "Corrective fault found during preventive maintenance %s (%s)." % (j["id"], ", ".join(j["assets"])),
        "asset": (j["assets"][0] if j["assets"] else ""), "linkedTo": j["id"]},
        created_by=_who(state)["by"], created_by_role=role)
    j["linkedTicketId"] = tid
    _audit(state, "ticket", tid, "create",
           "Corrective ticket recorded from maintenance %s - Status: Submitted." % j["id"], "Submitted")
    t = get_ticket(state, tid)
    if t:
        _hist(t, t["status"], "link", "Create linked corrective ticket following Section 1 - maintenance job %s." % j["id"], _who(state)["by"], _who(state)["role"])
    _audit(state, "job", j["id"], "link",
           "Linked corrective ticket %s created (Section 1)." % tid, j["status"].replace("_", " ").title())
    notify(state, "coordinator", "Additional fault in %s - linked corrective ticket %s follows Section 1." % (j["id"], tid), "job", {"ticketId": tid, "jobId": j["id"]})
    _touch(state)
    return {"ok": True, "msg": "Linked corrective ticket %s created (Section 1)." % tid, "id": tid}


def flag_additional_fault(state, role, job_id, value):
    """Additional fault discovered? (Section 10 step 8, IT Technician lane).

    The technician raises the flag while verifying the maintenance.  The
    linked corrective ticket itself is created by the system, so it always
    starts as Submitted and follows Section 1.
    """
    state["role"] = role
    g = _guard(state, ["technician"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    if not _assigned_to_actor(state, j):
        return {"ok": False, "msg": "Only the assigned technician can flag an additional fault."}
    if value not in ("yes", "no", "unknown"):
        return {"ok": False, "msg": "Additional fault must be yes, no or unknown."}
    j["additionalFault"] = value
    _audit(state, "job", j["id"], "fault", "Additional fault discovered? %s." % value.capitalize())
    _touch(state)
    return {"ok": True, "msg": "Additional fault recorded: %s." % value}


def _checklist_complete(j):
    """True when every checklist item of the job has a recorded result."""
    items = j.get("items") or []
    return all(i.get("done") for i in items)


def _advance_next_due(state, j):
    """Calculate the next due date from the configured schedule (Section 10 step 12).

    The cadence anchor is the schedule's own due date, so a late or incomplete
    visit never drifts the plan.  The next due date is advanced for every
    finished occurrence, including an incomplete or cancelled one (D11).
    """
    sc = get_schedule(state, j.get("scheduleId"))
    if not sc:
        return
    mult = frequency_days(state, sc.get("frequency"), sc.get("intervalDays"))
    from datetime import datetime, timedelta, timezone
    nd = datetime.fromtimestamp(_parse_ms(sc["dueDate"]) / 1000, timezone.utc) + timedelta(days=mult)
    j["nextDue"] = nd.strftime("%Y-%m-%d")
    sc["dueDate"] = nd.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    sc["nextCheck"] = sc["dueDate"]
    sc["lastCheck"] = now_iso()
    sc["active"] = True


def record_outcome(state, role, job_id, outcome, notes):
    """Record the outcome of a maintenance visit (Section 10 step 10).

    The outcome vocabulary is exactly Successful, Incomplete and Cancelled
    (D10).  Two things are deliberately separated here:

      * The technician hands the finished checklist over.  That moves the job
        to Resolved (awaiting office confirmation) but it does **not** make
        the maintenance successful: only a Closed job may carry the outcome
        Successful, and only when every checklist item is done (Section 10.1).
      * The IT Coordinator or the System Administrator records an honest
        Incomplete or Cancelled outcome when the visit will not complete.
        Neither of those may ever be Successful.

    The system finalises the outcome when the job is closed, by office
    confirmation or by an audited authorized closure.
    """
    state["role"] = role
    g = _guard(state, ["technician", "coordinator"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    if role == "technician" and not _assigned_to_actor(state, j):
        return {"ok": False, "msg": "Only the assigned technician can complete this maintenance job."}
    if outcome not in ("success", "incomplete", "cancelled"):
        return {"ok": False, "msg": "The outcome must be Successful, Incomplete or Cancelled."}
    if outcome != "success" and role == "technician":
        return {"ok": False, "msg": "Only the IT Coordinator or the System Administrator can record an incomplete or cancelled maintenance."}
    if j["status"] == "closed":
        return {"ok": False, "msg": "Job already closed."}
    if outcome == "success":
        if j["status"] not in ("assigned", "in_progress"):
            return {"ok": False, "msg": "The visit must be Assigned before it can be completed (%s is %s)." % (job_id, _label(j["status"]))}
        all_done = _checklist_complete(j)
        if not all_done:
            pending = len([i for i in (j.get("items") or []) if not i.get("done")])
            return {"ok": False, "msg": "Cannot complete the visit - incomplete checklist (%d pending)." % pending}
        if j["additionalFault"] == "unknown":
            return {"ok": False, "msg": 'Answer "Additional fault discovered?" first.'}
        # The work is complete and the office must now confirm it (Section 3).
        # The outcome itself is decided by the system when the job closes.
        j["status"] = "resolved"
        j["workComplete"] = True
        j["outcome"] = None
        j["outcomeNotes"] = notes or ""
        j["resolvedAt"] = now_iso()
        j["reminders"] = []
        j["confirmation"] = {"state": "pending", "person": "", "date": None, "feedback": ""}
        _audit(state, "job", j["id"], "outcome",
               "Maintenance work completed - checklist complete, handed to the office for Section 3 confirmation%s."
               % ((" - " + notes) if notes else ""), "Resolved")
        notify(state, "requester", "Maintenance %s completed - Section 3 confirmation requested." % j["id"], "confirm", {"jobId": j["id"], "office": j["office"]})
        notify(state, "coordinator", "Maintenance %s is ready for the office to confirm (next check %s)."
               % (j["id"], j.get("nextDue") or "-"), "confirm", {"jobId": j["id"]})
        _touch(state)
        return {"ok": True, "msg": "Maintenance work completed - awaiting office confirmation."}
    # Incomplete or cancelled: recorded honestly, never successful, and the
    # next due date still advances so the plan does not stall (D11).
    j["outcome"] = outcome
    j["outcomeNotes"] = notes or ""
    j["status"] = "cancelled"
    j["confirmation"]["state"] = "none"
    _advance_next_due(state, j)
    _audit(state, "job", j["id"], "outcome",
           "Maintenance outcome %s recorded%s - not marked successful; records preserved."
           % (outcome, (" - " + notes) if notes else ""), "Cancelled")
    notify(state, "coordinator", 'Maintenance outcome "%s" for %s - not marked successful; next due advanced, records preserved.' % (outcome, j["id"]), "job", {"jobId": j["id"]})
    notify(state, "requester", "Maintenance %s was not completed (%s). The record is retained." % (j["id"], outcome), "job", {"jobId": j["id"], "office": j["office"]})
    _touch(state)
    return {"ok": True, "msg": "Maintenance outcome recorded: %s." % outcome}


def _finalize_job_outcome(state, j, closed_by, reason=None):
    """System step: record the maintenance outcome when the job closes.

    Section 10 step 10 and node N69: the outcome is recorded by the system
    after the office confirmation (or the authorized closure).  Successful is
    only possible for a Closed job whose checklist is complete; anything else
    is Incomplete, and an incomplete or cancelled maintenance is never marked
    successful (node N71).
    """
    complete = _checklist_complete(j)
    j["outcome"] = "success" if complete else "incomplete"
    j["closedAt"] = now_iso()
    _advance_next_due(state, j)
    _audit(state, "job", j["id"], "outcome",
           "Record maintenance outcome: %s. Do not mark incomplete or cancelled maintenance successful."
           % ("Successful" if complete else "Incomplete"),
           "Closed", actor=SYSTEM)
    if reason:
        _audit(state, "job", j["id"], "closure",
               "Authorized closure - reason: %s. Maintenance outcome recorded as %s."
               % (reason, "Successful" if complete else "Incomplete"), "Closed", actor=closed_by)


def run_schedule_check(state, role, silent=False):
    """The manual, idempotent "Run schedule check" (specification 12).

    When scheduled functions are not available the IT Coordinator runs the
    check by hand.  It is idempotent: the occurrence key decides whether a
    job is reused or generated, so running it twice never duplicates a job.
    """
    state["role"] = role
    g = _guard(state, ["coordinator", "system"])
    if not g["ok"]:
        return g
    events = _run_schedule_check(state, silent=bool(silent))
    return {"ok": True, "msg": "Schedule check finished: %d result(s)." % len(events),
            "events": events}


def close_job(state, role, job_id, reason):
    """Authorized closure of a maintenance job (Section 3, D4).

    The office did not answer, so the job stays Resolved and a reminder goes
    out.  When the record must nevertheless be closed, only the IT Coordinator
    may do it, only with a reason, and the action is always visible in the job
    history as an authorized closure.  The System Administrator holds no
    ticket or maintenance work.
    """
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    if j["status"] == "closed":
        return {"ok": False, "msg": "Job already closed."}
    if j["status"] != "resolved":
        return {"ok": False, "msg": "Only a Resolved job can be closed by authorized closure."}
    if not reason:
        return {"ok": False, "msg": "Authorized closure requires a reason."}
    actor = _who(state)
    j["status"] = "closed"
    j["confirmation"] = {"state": "authorized", "person": actor["by"], "date": now_iso()}
    _finalize_job_outcome(state, j, actor, reason)
    notify(state, "requester", "Maintenance %s was closed by authorized closure. Reason: %s." % (j["id"], reason), "job", {"jobId": j["id"], "office": j["office"]})
    notify(state, "coordinator", "Maintenance %s closed by authorized closure (%s)." % (j["id"], actor["by"]), "job", {"jobId": j["id"]})
    _touch(state)
    return {"ok": True, "msg": "Maintenance job closed by authorized closure."}


def job_confirmation(state, role, job_id, decision, person, feedback=""):
    """Section 3 confirmation and closure of a maintenance visit.

    The office decides (Accepted, Rejected, No response).  The IT Coordinator
    cannot answer on the office's behalf; the coordinator closes an unanswered
    job through the audited authorized closure instead (Section 4A.2, D4).

    A rejection must carry the office feedback that is returned to the
    technician.  A no response keeps the job Resolved, records a reminder and
    sends the follow-up to the office (Section 10 step 10).
    """
    state["role"] = role
    g = _guard(state, ["requester"])
    if not g["ok"]:
        return g
    j = get_job(state, job_id)
    if not j:
        return {"ok": False, "msg": "Job not found."}
    ob = _office_block(state, j.get("office"))
    if ob:
        return ob
    if j["status"] != "resolved":
        return {"ok": False, "msg": "The maintenance work must be complete before the office can confirm it."}
    if decision == "accepted":
        if not person:
            return {"ok": False, "msg": "Record the confirming person."}
        j["confirmation"] = {"state": "accepted", "person": person, "date": now_iso(), "feedback": feedback or ""}
        j["status"] = "closed"
        sc = get_schedule(state, j["scheduleId"])
        if sc:
            sc["lastCheck"] = now_iso()
        _finalize_job_outcome(state, j, {"by": person, "role": "requester"})
        notify(state, "coordinator", "Maintenance %s confirmed by %s - Section 3 closure recorded." % (j["id"], person), "confirm", {"jobId": j["id"]})
        notify(state, "technician", "Maintenance %s confirmed by the office and closed." % j["id"], "confirm",
               {"jobId": j["id"], "office": j["office"]}, to=j.get("technician"))
        _audit(state, "job", j["id"], "confirm",
               "Office confirmed maintenance - confirming person: %s. Section 3 closure recorded." % person, "Closed")
        _touch(state)
        return {"ok": True, "msg": "Maintenance confirmed and closed (Section 3)."}
    if decision == "rejected":
        if not feedback:
            return {"ok": False, "msg": "Record the office feedback before rejecting the maintenance."}
        j["confirmation"] = {"state": "rejected", "person": person or j["office"], "date": now_iso(), "feedback": feedback}
        j["status"] = "in_progress"; j["outcome"] = None; j["workComplete"] = False
        j["resolvedAt"] = None
        j["reminders"] = []
        notify(state, "technician", 'Maintenance %s rejected by office - return to verification. Feedback: "%s"' % (j["id"], feedback),
               "confirm", {"jobId": j["id"], "office": j["office"]}, to=j.get("technician"))
        notify(state, "coordinator", '%s returned to verification on office feedback: "%s"' % (j["id"], feedback),
               "confirm", {"jobId": j["id"], "office": j["office"]})
        _audit(state, "job", j["id"], "confirm",
               'Office rejected the maintenance result - feedback: "%s". Returned to verification.' % feedback, "In Progress")
        _touch(state)
        return {"ok": True, "msg": "Feedback recorded - job returned to verification."}
    j["confirmation"]["state"] = "no_response"
    j.setdefault("reminders", []).append(now_iso())
    _audit(state, "job", j["id"], "confirm",
           "No response from office - job kept Resolved; follow-up reminder %d sent to the office." % len(j["reminders"]),
           _label(j["status"]))
    notify(state, "requester", "Follow-up reminder: please confirm the result of maintenance %s (%s)." % (j["id"], j["office"]),
           "remind", {"jobId": j["id"], "office": j["office"]})
    _touch(state)
    return {"ok": True, "msg": "No response recorded - job stays Resolved, reminder %d sent." % len(j["reminders"])}


# --------------------------------------------------------------------------
# Conversation, records, notifications and administration (Admin namespace)
# --------------------------------------------------------------------------

def _next_comment_id(state, t):
    return "%s-C%02d" % (t["id"], len(t.get("comments") or []) + 1)


def add_comment(state, role, tid, d):
    """Post a message on a ticket: public reply or internal staff note."""
    state["role"] = role
    g = _guard(state, ["coordinator", "technician", "requester"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    ob = _office_block(state, t.get("office"), t.get("requester"))
    if ob:
        return ob
    if role == "technician" and not _assigned_to_actor(state, t):
        return {"ok": False, "msg": "You can only post on the tickets assigned to you."}
    text = ((d or {}).get("text") or "").strip()
    if not text:
        return {"ok": False, "msg": "Write a message before sending."}
    if role == "requester" and t.get("requester") != _who(state)["by"]:
        return {"ok": False, "msg": "You can only reply to your own tickets."}
    internal = role != "requester" and (d or {}).get("visibility") == "internal"
    c = {
        "id": _next_comment_id(state, t), "at": now_iso(), "by": _who(state)["by"],
        "role": role, "text": text,
        "visibility": "internal" if internal else "public",
    }
    t.setdefault("comments", []).append(c)
    if internal:
        notify(state, "technician", "Internal note on %s by %s." % (tid, c["by"]), "comment", {"ticketId": tid})
        notify(state, "coordinator", "Internal note on %s by %s." % (tid, c["by"]), "comment", {"ticketId": tid})
        _audit(state, "ticket", tid, "comment", "Internal note: %s" % text[:120])
    else:
        if role == "requester":
            notify(state, "coordinator", "Reply from %s on %s." % (c["by"], tid), "comment", {"ticketId": tid})
            notify(state, "technician", "Reply from %s on %s." % (c["by"], tid), "comment", {"ticketId": tid})
        else:
            notify(state, "requester", "Update from %s on %s." % (c["by"], tid), "comment", {"ticketId": tid})
        _audit(state, "ticket", tid, "comment", "Message posted: %s" % text[:120])
    _touch(state)
    vis = "internal note" if internal else "message"
    return {"ok": True, "msg": "Internal note recorded." if internal else "Message sent.", "comment": c, "visibility": vis}


def update_ticket(state, role, tid, d):
    """Requester corrects their own intake while Submitted / Needs Information."""
    state["role"] = role
    g = _guard(state, ["requester"])
    if not g["ok"]:
        return g
    t = get_ticket(state, tid)
    if not t:
        return {"ok": False, "msg": "Ticket not found."}
    if t.get("requester") != _who(state)["by"]:
        return {"ok": False, "msg": "You can only edit your own tickets."}
    if t["status"] not in ("submitted", "needs_info"):
        return {"ok": False, "msg": "Only Submitted or Needs Information tickets can be edited."}
    d = d or {}
    changed = []
    if (d.get("issue") or "").strip() and d["issue"].strip() != t.get("issue"):
        t["issue"] = d["issue"].strip(); changed.append("issue")
    if d.get("asset") is not None and str(d["asset"]).strip() != str(t.get("asset") or ""):
        t["asset"] = str(d["asset"]).strip(); changed.append("asset")
    for key in ("category", "source", "priority"):
        if d.get(key) and d[key] != t.get(key):
            value = d[key]
            if key == "source":
                allowed_src = _source_values(state)
                value = _normalize_source(state, value)
                if value is None:
                    return {"ok": False, "msg": "Unknown intake source (%s). Choose one of: %s." % (d[key], ", ".join(allowed_src))}
            t[key] = value; changed.append(key)
    if not changed:
        return {"ok": False, "msg": "Nothing to update."}
    t.setdefault("history", []).append(
        {"at": now_iso(), "by": _who(state)["by"], "role": role, "status": t["status"],
         "kind": "edit", "text": "Intake details updated (%s)." % ", ".join(changed)})
    _audit(state, "ticket", tid, "edit", "Intake details updated (%s)." % ", ".join(changed))
    _touch(state)
    return {"ok": True, "msg": "Ticket details saved."}


def mark_notifications_read(state, role, ids):
    """Mark the signed-in user's notifications as read (given ids, or all)."""
    state["role"] = role
    who = _who(state)["by"]
    wanted = None
    if ids:
        try:
            wanted = {int(i) for i in ids}
        except (TypeError, ValueError):
            wanted = None
    n_read = 0
    for n in state.get("notifications", []):
        if wanted is not None and int(n.get("id", 0)) not in wanted:
            continue
        rb = n.setdefault("readBy", [])
        if who not in rb:
            rb.append(who); n_read += 1
    if n_read:
        _touch(state)
    return {"ok": True, "msg": "Marked %d notification(s) as read." % n_read, "count": n_read}


REF_GROUPS = ("categories", "sources", "priorities", "frequencies")


def _rename_office(state, old, new):
    """Office name is the natural key - a rename cascades to every reference."""
    for t in state.get("tickets", []):
        if t.get("office") == old:
            t["office"] = new
    for s in state.get("schedules", []):
        if s.get("office") == old:
            s["office"] = new
    for j in state.get("jobs", []):
        if j.get("office") == old:
            j["office"] = new
    for n in state.get("notifications", []):
        if n.get("office") == old:
            n["office"] = new
    for p in state.get("people", []):
        if p.get("office") == old:
            p["office"] = new
    for a in state.get("assets", []):
        if a.get("office") == old:
            a["office"] = new


def save_office(state, role, d):
    """Create or update an office. Offices are keyed by name (their natural
    key: tickets, schedules and jobs all reference the office by name).

    d = {id?, name, location?, code?, contactPerson?, contactEmail?,
         contactPhone?, active?}.  ``id`` is the current name of the office to
    update (absent -> create).  Renaming cascades to every record.
    """
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    d = d or {}
    name = (d.get("name") or "").strip()
    if not name:
        return {"ok": False, "msg": "Office name is required."}
    offices = state.setdefault("offices", [])
    current = str(d.get("id") or "").strip()
    office = next((o for o in offices
                   if (o.get("name") or "").lower() == (current or name).lower()), None)
    if office is None:
        if current:
            return {"ok": False, "msg": "Office not found."}
        if any((o.get("name") or "").lower() == name.lower() for o in offices):
            return {"ok": False, "msg": "An office with that name already exists."}
        office = {"name": name, "code": (d.get("code") or "").strip(),
                  "location": (d.get("location") or "").strip(),
                  "contactPerson": "", "contactEmail": "", "contactPhone": "",
                  "active": True, "createdAt": now_iso(), "updatedAt": now_iso()}
        offices.append(office)
        _audit(state, "office", name, "office", "Office '%s' created." % name)
        _touch(state)
        return {"ok": True, "msg": "Office '%s' created." % name, "office": office}
    changed = []
    if name != office["name"]:
        if any(o is not office and (o.get("name") or "").lower() == name.lower() for o in offices):
            return {"ok": False, "msg": "An office with that name already exists."}
        old = office["name"]
        office["name"] = name
        _rename_office(state, old, name)
        changed.append("name -> %s" % name)
    for key in ("code", "location", "contactPerson", "contactEmail", "contactPhone"):
        if d.get(key) is not None and str(d.get(key)).strip() != str(office.get(key) or ""):
            office[key] = str(d.get(key)).strip(); changed.append(key)
    if "active" in d and bool(d["active"]) != bool(office.get("active", True)):
        office["active"] = bool(d["active"])
        changed.append("active" if d["active"] else "inactive")
    if not changed:
        return {"ok": False, "msg": "Nothing to update."}
    office["updatedAt"] = now_iso()
    _audit(state, "office", office["name"], "office",
           "Office '%s' updated (%s)." % (office["name"], ", ".join(changed)))
    _touch(state)
    return {"ok": True, "msg": "Office '%s' updated (%s)." % (office["name"], ", ".join(changed)),
            "office": office}


def set_office_active(state, role, name, active):
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    office = next((o for o in state.get("offices", [])
                   if (o.get("name") or "").lower() == str(name).lower()), None)
    if not office:
        return {"ok": False, "msg": "Office not found."}
    office["active"] = bool(active)
    office["updatedAt"] = now_iso()
    state_word = "activated" if active else "deactivated"
    _audit(state, "office", office["name"], "office", "Office '%s' %s." % (office["name"], state_word))
    _touch(state)
    return {"ok": True, "msg": "Office '%s' %s." % (office["name"], state_word)}


ASSET_TAG = re.compile(r"^[A-Z]{2,4}-[A-Z]{2,4}-\d{2,4}$")


def _find_asset(state, ident):
    key = str(ident or "").strip().lower()
    return next((a for a in state.get("assets", [])
                 if a.get("id", "").lower() == key or a.get("tag", "").lower() == key), None)


def save_asset(state, role, d):
    """Create or update one asset record (Administration, role scope 5).

    d = {id?, tag, name, category, office, location?, active?}.  The tag is the
    property number the other lanes already type by hand on a ticket and a
    schedule, so it is held to the same documented shape and is unique across
    the register, retired records included: a number must never name two units.
    """
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    d = d or {}
    tag = str(d.get("tag") or "").strip().upper()
    name = str(d.get("name") or "").strip()
    category = str(d.get("category") or "").strip()
    office = str(d.get("office") or "").strip()
    if not tag:
        return {"ok": False, "msg": "Asset number is required."}
    if not ASSET_TAG.match(tag):
        return {"ok": False, "msg": "Asset number needs the documented shape, e.g. PC-OF-118."}
    if not name:
        return {"ok": False, "msg": "Asset name is required."}
    if not category:
        return {"ok": False, "msg": "Choose a category."}
    known = [o for o in state.get("offices", [])]
    holder = next((o for o in known if (o.get("name") or "").lower() == office.lower()), None)
    if not office or not holder:
        return {"ok": False, "msg": "Choose the office that holds this asset."}
    assets = state.setdefault("assets", [])
    current = _find_asset(state, d.get("id")) if d.get("id") not in (None, "") else None
    if d.get("id") not in (None, "") and current is None:
        return {"ok": False, "msg": "Asset not found."}
    if current is None:
        if any(a.get("tag", "").upper() == tag for a in assets):
            return {"ok": False, "msg": "An asset with that number already exists."}
        asset = {"id": next_id(state, "asset"), "tag": tag, "name": name,
                 "category": category, "office": holder["name"],
                 "location": str(d.get("location") or "").strip(),
                 "active": True, "createdAt": now_iso(), "updatedAt": now_iso()}
        assets.append(asset)
        _audit(state, "asset", tag, "asset", "Asset '%s' (%s) registered to %s." % (tag, name, holder["name"]))
        _touch(state)
        return {"ok": True, "msg": "Asset '%s' registered." % tag, "asset": asset}
    if any(a is not current and a.get("tag", "").upper() == tag for a in assets):
        return {"ok": False, "msg": "An asset with that number already exists."}
    changed = []
    for key, label, value in (("tag", "number", tag), ("name", "name", name),
                              ("category", "category", category),
                              ("office", "office", holder["name"]),
                              ("location", "location", str(d.get("location") or "").strip())):
        if value != str(current.get(key) or ""):
            current[key] = value
            changed.append(label)
    if "active" in d and bool(d["active"]) != bool(current.get("active", True)):
        current["active"] = bool(d["active"])
        changed.append("active" if d["active"] else "retired")
    if not changed:
        return {"ok": False, "msg": "Nothing to update."}
    current["updatedAt"] = now_iso()
    _audit(state, "asset", current["tag"], "asset",
           "Asset '%s' updated (%s)." % (current["tag"], ", ".join(changed)))
    _touch(state)
    return {"ok": True, "msg": "Asset '%s' updated (%s)." % (current["tag"], ", ".join(changed)),
            "asset": current}


def set_asset_active(state, role, ident, active):
    """Retire or restore an asset.  Retiring keeps the record: a ticket or a
    visit that names the number still resolves to the same unit."""
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    asset = _find_asset(state, ident)
    if not asset:
        return {"ok": False, "msg": "Asset not found."}
    if bool(active) == bool(asset.get("active", True)):
        return {"ok": False, "msg": "Nothing to update."}
    asset["active"] = bool(active)
    asset["updatedAt"] = now_iso()
    word = "restored" if active else "retired"
    _audit(state, "asset", asset["tag"], "asset", "Asset '%s' %s." % (asset["tag"], word))
    _touch(state)
    return {"ok": True, "msg": "Asset '%s' %s." % (asset["tag"], word)}


def _slug_username(name, taken):
    base = "".join(ch for ch in name.lower() if ch.isalnum() or ch == " ").strip()
    base = base.replace(" ", ".")[:24] or "user"
    username = base
    i = 2
    while username in taken:
        username = "%s%d" % (base, i)
        i += 1
    return username


def _rename_person(state, old, new, role):
    """A person's name is the identity on service records - renaming cascades
    to the references so their tickets stay theirs (and jobs stay assigned)."""
    if role == "requester":
        for t in state.get("tickets", []):
            if t.get("requester") == old:
                t["requester"] = new
    for t in state.get("tickets", []):
        if t.get("technician") == old:
            t["technician"] = new
    for s in state.get("schedules", []):
        if s.get("technician") == old:
            s["technician"] = new
    for j in state.get("jobs", []):
        if j.get("technician") == old:
            j["technician"] = new


def save_person(state, role, d):
    """Create or update a user account record (the users table mirrors it).

    d = {id?, name, role, office, email?, phone?}.  New accounts get a unique
    username and start on the documented demo password.
    """
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    d = d or {}
    name = (d.get("name") or "").strip()
    prole = d.get("role")
    if not name:
        return {"ok": False, "msg": "Name is required."}
    if prole not in ("requester", "technician", "coordinator", "management"):
        return {"ok": False, "msg": "Choose a valid role."}
    people = state.setdefault("people", [])
    office = (d.get("office") or "").strip()
    if d.get("id") not in (None, ""):
        person = next((p for p in people
                       if str(p.get("id")) == str(d["id"])
                       or str(p.get("username")) == str(d["id"])), None)
        if not person:
            return {"ok": False, "msg": "User not found."}
        if person.get("name") != name and any(
                p is not person and p.get("name", "").lower() == name.lower() for p in people):
            return {"ok": False, "msg": "A user with that name already exists."}
        if person.get("name") != name:
            _rename_person(state, person["name"], name, person.get("role"))
        person["name"] = name
        person["role"] = prole
        person["office"] = office
        if d.get("email") is not None:
            person["email"] = (d.get("email") or "").strip()
        if d.get("phone") is not None:
            person["phone"] = (d.get("phone") or "").strip()
        _audit(state, "user", person.get("username") or person.get("id"), "user",
               "User '%s' updated (role: %s)." % (name, prole))
        _touch(state)
        return {"ok": True, "msg": "User '%s' updated." % name, "person": person}
    if any(p.get("name", "").lower() == name.lower() for p in people):
        return {"ok": False, "msg": "A user with that name already exists."}
    taken = {p.get("username") for p in people if p.get("username")}
    person = {"name": name, "role": prole, "office": office,
              "username": _slug_username(name, taken),
              "email": (d.get("email") or "").strip(),
              "phone": (d.get("phone") or "").strip(),
              "active": True, "prefs": {}}
    people.append(person)
    _audit(state, "user", person["username"], "user",
           "User '%s' created (role: %s, username: %s)." % (name, prole, person["username"]))
    _touch(state)
    return {"ok": True,
            "msg": "User '%s' created - username %s, initial password %s." % (name, person["username"], "itc"),
            "person": person}


def set_person_active(state, role, pid, active):
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    person = next((p for p in state.get("people", [])
                   if str(p.get("id")) == str(pid) or str(p.get("username")) == str(pid)), None)
    if not person:
        return {"ok": False, "msg": "User not found."}
    who = _who(state)
    if not active and person.get("name") == who["by"]:
        return {"ok": False, "msg": "You cannot deactivate your own account."}
    person["active"] = bool(active)
    word = "activated" if active else "deactivated"
    _audit(state, "user", person.get("username") or pid, "user",
           "User '%s' %s." % (person["name"], word))
    _touch(state)
    return {"ok": True, "msg": "User '%s' %s." % (person["name"], word)}


def save_ref(state, role, d):
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    d = d or {}
    group = d.get("group")
    if group not in REF_GROUPS:
        return {"ok": False, "msg": "Unknown reference group."}
    value = (d.get("value") or "").strip()
    if not value:
        return {"ok": False, "msg": "Enter a value."}
    items = state.setdefault("settings", {}).setdefault(group, [])
    if group == "frequencies":
        # rows are [key, label, days]
        def _row_label(row):
            return row[1] if isinstance(row, (list, tuple)) and len(row) >= 1 else row
        if d.get("remove"):
            hit = next((i for i, row in enumerate(items)
                        if str(_row_label(row)).lower() == value.lower()), None)
            if hit is None:
                return {"ok": False, "msg": "%s is not in the list." % value}
            removed = items.pop(hit)
            _audit(state, "ref", group, "ref", "Frequency '%s' removed." % value)
            msg = "'%s' removed from frequencies." % _row_label(removed)
        else:
            if any(str(_row_label(row)).lower() == value.lower() for row in items):
                return {"ok": False, "msg": "'%s' already exists." % value}
            try:
                days = int(d.get("days") or 30)
            except (TypeError, ValueError):
                return {"ok": False, "msg": "Frequency interval must be a number of days."}
            if days < 1 or days > 730:
                return {"ok": False, "msg": "Frequency interval must be between 1 and 730 days."}
            key = "".join(ch for ch in value.lower() if ch.isalnum() or ch == " ").strip().replace(" ", "-")
            items.append([key, value, days])
            _audit(state, "ref", group, "ref", "Frequency '%s' (%d days) added." % (value, days))
            msg = "'%s' every %d days added to frequencies." % (value, days)
    elif d.get("remove"):
        if not any(str(v).lower() == value.lower() for v in items):
            return {"ok": False, "msg": "%s is not in the list." % value}
        items[:] = [v for v in items if str(v).lower() != value.lower()]
        _audit(state, "ref", group, "ref", "%s option '%s' removed." % (group.title(), value))
        msg = "'%s' removed from %s." % (value, group)
    else:
        if any(str(v).lower() == value.lower() for v in items):
            return {"ok": False, "msg": "'%s' already exists." % value}
        items.append(value)
        _audit(state, "ref", group, "ref", "%s option '%s' added." % (group.title(), value))
        msg = "'%s' added to %s." % (value, group)
    _touch(state)
    return {"ok": True, "msg": msg}


def update_schedule(state, role, sid, d):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    sc = get_schedule(state, sid)
    if not sc:
        return {"ok": False, "msg": "Schedule not found."}
    ob = _office_block(state, sc.get("office"))
    if ob:
        return ob
    d = d or {}
    changed = []
    for key, label in (("office", "office"), ("category", "category"), ("frequency", "frequency"),
                       ("dueDate", "due date"), ("technician", "technician")):
        if d.get(key) and d[key] != sc.get(key):
            sc[key] = d[key]; changed.append(label)
    if d.get("frequency") == "custom":
        source = d if d.get("intervalDays") is not None else {
            "frequency": "custom", "intervalDays": sc.get("intervalDays")}
        interval = _custom_interval(source)
        if interval is False:
            return {"ok": False, "msg": "A Custom cadence needs a whole number of days between 1 and 3650."}
        if interval != sc.get("intervalDays"):
            sc["intervalDays"] = interval; changed.append("custom interval")
    elif d.get("frequency"):
        sc["intervalDays"] = None
    if d.get("assets") is not None and list(d.get("assets") or []) != list(sc.get("assets") or []):
        sc["assets"] = list(d["assets"]); changed.append("assets")
    if d.get("checklist"):
        sc["checklist"] = list(d["checklist"]); changed.append("checklist")
    if d.get("dueDate"):
        sc["nextCheck"] = d["dueDate"]
    if not changed:
        return {"ok": False, "msg": "Nothing to update."}
    _audit(state, "schedule", sid, "sched", "Schedule updated (%s)." % ", ".join(changed))
    _touch(state)
    return {"ok": True, "msg": "Schedule %s updated (%s)." % (sid, ", ".join(changed))}


def set_schedule_active(state, role, sid, active):
    state["role"] = role
    g = _guard(state, ["coordinator"])
    if not g["ok"]:
        return g
    sc = get_schedule(state, sid)
    if not sc:
        return {"ok": False, "msg": "Schedule not found."}
    ob = _office_block(state, sc.get("office"))
    if ob:
        return ob
    sc["active"] = bool(active)
    word = "activated" if active else "paused"
    _audit(state, "schedule", sid, "sched", "Schedule %s." % word)
    _touch(state)
    return {"ok": True, "msg": "Schedule %s %s." % (sid, word)}


def save_settings(state, role, d):
    """Update operational settings (settings screen).

    System settings are an administrative act: only the System Administrator
    may change them (specification 4A.2, decision D14).
    """
    state["role"] = role
    g = _guard(state, ["management"])
    if not g["ok"]:
        return g
    d = d or {}
    settings = state.setdefault("settings", {})
    changed = []
    if "reminderMinutes" in d:
        try:
            minutes = int(d["reminderMinutes"])
        except (TypeError, ValueError):
            return {"ok": False, "msg": "Reminder interval must be whole minutes."}
        if minutes < 1 or minutes > 1440:
            return {"ok": False, "msg": "Reminder interval must be 1 to 1440 minutes."}
        if settings.get("reminderMinutes") != minutes:
            settings["reminderMinutes"] = minutes; changed.append("reminder interval = %d min" % minutes)
    if "simulate" in d:
        flag = bool(d["simulate"])
        if settings.get("simulate") != flag:
            settings["simulate"] = flag; changed.append("simulation %s" % ("on" if flag else "off"))
    if "reminderMode" in d:
        mode = str(d["reminderMode"] or "").strip().lower()
        if mode not in ("business", "minutes"):
            return {"ok": False, "msg": "Reminder mode must be business or minutes."}
        if settings.get("reminderMode") != mode:
            settings["reminderMode"] = mode; changed.append("reminder mode = %s" % mode)
    for key, label in (("reminderBusinessDays", "first reminder (business days)"),
                       ("reminderRepeatDays", "repeat reminder (business days)")):
        if key in d:
            try:
                val = int(d[key])
            except (TypeError, ValueError):
                return {"ok": False, "msg": "%s must be a whole number of days." % label}
            if val < 1 or val > 60:
                return {"ok": False, "msg": "%s must be 1-60 days." % label}
            if settings.get(key) != val:
                settings[key] = val; changed.append("%s = %d" % (label, val))
    if "workdays" in d:
        val = d["workdays"]
        if not isinstance(val, (list, tuple)):
            return {"ok": False, "msg": "The workweek must be a list of weekdays."}
        try:
            nums = sorted(set(int(x) for x in val))
        except (TypeError, ValueError):
            return {"ok": False, "msg": "The workweek takes weekday numbers 0 to 6 (Monday is 0)."}
        if not nums:
            return {"ok": False, "msg": "The workweek needs at least one working day."}
        if [x for x in nums if x < 0 or x > 6]:
            return {"ok": False, "msg": "The workweek takes weekday numbers 0 to 6 (Monday is 0)."}
        if settings.get("workdays") != nums:
            settings["workdays"] = nums
            changed.append("workweek = %s" % ", ".join(WEEKDAY_NAMES[i] for i in nums))
    if "holidays" in d:
        from datetime import datetime as _day_cls
        val = d["holidays"]
        if not isinstance(val, (list, tuple)):
            return {"ok": False, "msg": "The holiday calendar must be a list of dates."}
        dates = []
        for h in val:
            s = str(h).strip()
            if not s:
                continue
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", s):
                return {"ok": False, "msg": "A holiday date must read YYYY-MM-DD, not %s." % s}
            try:
                _day_cls.strptime(s, "%Y-%m-%d")
            except ValueError:
                return {"ok": False, "msg": "%s is not a real date." % s}
            dates.append(s)
        if len(dates) > 400:
            return {"ok": False, "msg": "The holiday calendar holds at most 400 dates."}
        dates = sorted(set(dates))
        if settings.get("holidays") != dates:
            settings["holidays"] = dates
            changed.append("holiday calendar = %d closed date(s)" % len(dates))
    if "authorizedClosureRoles" in d:
        val = d["authorizedClosureRoles"]
        if not isinstance(val, (list, tuple)) or not val:
            return {"ok": False, "msg": "Authorized closure needs at least one role."}
        bad = [r for r in val if r not in ROLES]
        if bad:
            return {"ok": False, "msg": "Unknown role(s): %s." % ", ".join(map(str, bad))}
        if "management" in val:
            return {"ok": False, "msg": "The System Administrator holds no ticket work and cannot be an authorized closure role."}
        val = [r for r in ROLES if r in val]
        if settings.get("authorizedClosureRoles") != val:
            settings["authorizedClosureRoles"] = val
            changed.append("authorized closure roles = %s" % ", ".join(val))
    if "approvalCategories" in d:
        val = d["approvalCategories"]
        if not isinstance(val, (list, tuple)):
            return {"ok": False, "msg": "Approval categories must be a list."}
        known = list(((state.get("ref") or {}).get("categories") or []))
        bad = [c for c in val if known and c not in known]
        if bad:
            return {"ok": False, "msg": "Unknown categor(y/ies): %s." % ", ".join(map(str, bad))}
        val = [str(c) for c in val]
        if settings.get("approvalCategories") != val:
            settings["approvalCategories"] = val
            changed.append("approval needed for %s" % (", ".join(val) if val else "nothing"))
    if "priorityMatrix" in d:
        val = d["priorityMatrix"]
        if not isinstance(val, dict):
            return {"ok": False, "msg": "Priority matrix must be an object."}
        clean = {}
        for impact, row in val.items():
            if str(impact).strip().lower() not in ("high", "medium", "low"):
                return {"ok": False, "msg": "Unknown impact level: %s (use Low, Medium or High)." % impact}
            if not isinstance(row, dict):
                return {"ok": False, "msg": "Priority matrix rows must be objects."}
            clean[str(impact).strip().lower()] = {}
            for urg, pri in row.items():
                if str(urg).strip().lower() not in ("high", "medium", "low"):
                    return {"ok": False, "msg": "Unknown urgency level: %s." % urg}
                if str(pri).strip().lower() not in ("low", "medium", "high", "critical"):
                    return {"ok": False, "msg": "Unknown priority: %s." % pri}
                clean[str(impact).strip().lower()][str(urg).strip().lower()] = str(pri).strip().lower()
        if settings.get("priorityMatrix") != clean:
            settings["priorityMatrix"] = clean; changed.append("priority matrix")
    if "roleActions" in d:
        val = d["roleActions"]
        if not isinstance(val, dict):
            return {"ok": False, "msg": "Role actions must be an object."}
        clean = {}
        for action, roles in val.items():
            if not isinstance(roles, (list, tuple)):
                roles = [roles]
            bad = [r for r in roles if r not in ROLES]
            if bad:
                return {"ok": False, "msg": "Unknown role(s) for %s: %s." % (action, ", ".join(map(str, bad)))}
            if roles:
                clean[str(action)] = [r for r in ROLES if r in roles]
        # Never let an administrator lock the settings screen away entirely.
        clean.setdefault("saveSettings", ["management", "coordinator"])
        if settings.get("roleActions") != clean:
            settings["roleActions"] = clean; changed.append("role permissions")
    if "timezone" in d:
        tz = str(d["timezone"] or "").strip()
        if not tz:
            return {"ok": False, "msg": "Timezone is required."}
        if settings.get("timezone") != tz:
            settings["timezone"] = tz; changed.append("timezone = %s" % tz)
    if not changed:
        return {"ok": False, "msg": "Nothing to update."}
    _audit(state, "settings", "settings", "settings", "Settings updated (%s)." % ", ".join(changed))
    _touch(state)
    return {"ok": True, "msg": "Settings updated (%s)." % ", ".join(changed)}


# JS method name -> (function, positional arg names)
METHODS = {
    "createTicket": (create_ticket, ["d"]),
    "submitInfo": (submit_info, ["id", "d"]),
    "officeDecision": (office_decision, ["id", "decision", "data"]),
    "createLinkedTicket": (create_linked_ticket, ["id", "d"]),
    "requestInfo": (request_info, ["id", "missing"]),
    "assess": (assess, ["id", "d"]),
    "assign": (assign, ["id", "tech"]),
    "reassign": (reassign, ["id", "tech"]),
    "approve": (approve, ["id", "note"]),
    "coordinate": (coordinate, ["id", "d"]),
    "cancel": (cancel, ["id", "reason"]),
    "requestWithdrawal": (request_withdrawal, ["id", "reason"]),
    "followUp": (follow_up, ["id", "text"]),
    "resolveDependency": (resolve_dependency, ["id", "note"]),
    "cancelFromDependency": (cancel_from_dependency, ["id", "reason"]),
    "startWork": (start_work, ["id", "note"]),
    "diagnose": (diagnose, ["id", "d"]),
    "recordRepair": (record_repair, ["id", "d"]),
    "placeHold": (place_hold, ["id", "dep"]),
    "recordTest": (record_test, ["id", "result", "note"]),
    "close": (close, ["id", "mode", "reason"]),
    "sendReminder": (send_reminder, ["id"]),
    "createSchedule": (create_schedule, ["d"]),
    "runScheduleCheck": (run_schedule_check, ["silent"]),
    "rescheduleJob": (reschedule_job, ["jobId", "newDate", "reason"]),
    "reassignJob": (reassign_job, ["jobId", "tech"]),
    "confirmAvailability": (confirm_availability, ["jobId", "yes"]),
    "recordChecklistItem": (record_checklist_item, ["jobId", "idx", "data"]),
    "createFaultTicket": (create_fault_ticket, ["jobId"]),
    "flagAdditionalFault": (flag_additional_fault, ["jobId", "value"]),
    "recordOutcome": (record_outcome, ["jobId", "outcome", "notes"]),
    "closeJob": (close_job, ["jobId", "reason"]),
    "jobConfirmation": (job_confirmation, ["jobId", "decision", "person", "feedback"]),
    "addComment": (add_comment, ["id", "d"]),
    "updateTicket": (update_ticket, ["id", "d"]),
    "markNotificationsRead": (mark_notifications_read, ["ids"]),
    "saveOffice": (save_office, ["d"]),
    "setOfficeActive": (set_office_active, ["id", "active"]),
    "savePerson": (save_person, ["d"]),
    "setPersonActive": (set_person_active, ["id", "active"]),
    "saveRef": (save_ref, ["d"]),
    "saveAsset": (save_asset, ["d"]),
    "setAssetActive": (set_asset_active, ["id", "active"]),
    "updateSchedule": (update_schedule, ["id", "d"]),
    "setScheduleActive": (set_schedule_active, ["id", "active"]),
    "saveSettings": (save_settings, ["d"]),
}

NAMESPACE = {
    "createTicket": "Flow", "submitInfo": "Flow", "officeDecision": "Flow",
    "createLinkedTicket": "Flow", "requestInfo": "Flow", "assess": "Flow",
    "assign": "Flow", "reassign": "Flow", "approve": "Flow",
    "coordinate": "Flow", "cancel": "Flow", "requestWithdrawal": "Flow", "followUp": "Flow",
    "resolveDependency": "Flow", "cancelFromDependency": "Flow", "startWork": "Flow",
    "diagnose": "Flow", "recordRepair": "Flow", "placeHold": "Flow", "recordTest": "Flow", "close": "Flow",
    "sendReminder": "Flow",
    "createSchedule": "Maint", "rescheduleJob": "Maint", "reassignJob": "Maint",
    "confirmAvailability": "Maint", "runScheduleCheck": "Maint",
    "recordChecklistItem": "Maint", "createFaultTicket": "Maint", "flagAdditionalFault": "Maint",
    "recordOutcome": "Maint",
    "closeJob": "Maint",
    "jobConfirmation": "Maint",
    "addComment": "Flow", "updateTicket": "Flow", "markNotificationsRead": "Admin",
    "saveOffice": "Admin", "setOfficeActive": "Admin", "savePerson": "Admin",
    "setPersonActive": "Admin", "saveRef": "Admin", "saveSettings": "Admin",
    "saveAsset": "Admin", "setAssetActive": "Admin",
    "updateSchedule": "Maint", "setScheduleActive": "Maint",
}


def call(state, role, method, args, user=None):
    """Dispatch a /api/call request. `args` is a list, matching JS call order.

    The `names` list in METHODS documents the JS argument names (for the client
    adapter) and its length is the arity; the function is invoked positionally
    because the Python parameter names differ from the JS ones.

    `user` is the signed-in identity (``{role, office, ...}``) used for
    requester office-tenancy; it is stashed on the state only for the duration of
    the call so it is never persisted or leaked back to clients.
    """
    if method not in METHODS:
        return {"ok": False, "msg": "Unknown method: %s" % method}
    fn, names = METHODS[method]
    a = list(args or [])
    while len(a) < len(names):
        a.append(None)
    state["_user"] = user
    state["_method"] = method  # consulted by _guard for settings.roleActions
    try:
        return fn(state, role, *a[:len(names)])
    finally:
        state.pop("_user", None)
        state.pop("_method", None)
