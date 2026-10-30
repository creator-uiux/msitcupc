"""Server-side list queries  --  search / filter / sort / paginate + KPI maths.

Live mode never ships the whole ticket table to the browser: the list screen
calls ``GET /api/tickets?...`` and this module narrows the caller's *authorized*
snapshot (requester office tenancy is applied by app.py before we get here), so
visibility is decided on the server and pagination actually saves bytes.

The turnaround / overdue maths here is the single source of truth referenced by
the Reports screen; ``js/query.js`` is its line-for-line mirror for the offline
localStorage demo, so both modes report the same numbers.
"""
from datetime import datetime, timedelta, timezone

# Canonical internal statuses (display labels live in engine._label).
OPEN_STATES = ("submitted", "needs_info", "assigned", "in_progress", "on_hold", "resolved")
TERMINAL_STATES = ("closed", "cancelled")
ALL_STATES = OPEN_STATES + TERMINAL_STATES

PRIORITY_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1}
STATUS_ORDER = {s: i for i, s in enumerate(ALL_STATES)}

# One definition of "overdue": a target date when the coordinator set one,
# otherwise intake plus the configured service level window (assumption A1).
DEFAULT_SLA_DAYS = 5
SLA_MIN_DAYS, SLA_MAX_DAYS = 1, 365
SORT_KEYS = ("updated", "created", "status", "priority", "id", "target")
MAX_SIZE = 100


def sla_days(settings=None):
    """The service level window in force: what the office set, else the shipped default."""
    try:
        val = int((settings or {}).get("slaDays", DEFAULT_SLA_DAYS))
    except (TypeError, ValueError):
        return DEFAULT_SLA_DAYS
    return val if SLA_MIN_DAYS <= val <= SLA_MAX_DAYS else DEFAULT_SLA_DAYS


def parse_ms(iso):
    if not iso:
        return 0.0
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return 0.0


def _int(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def turnaround_hours(t):
    """resolvedAt - createdAt in hours, else None (single definition)."""
    if not t.get("resolvedAt") or t.get("status") == "cancelled":
        return None
    delta = parse_ms(t["resolvedAt"]) - parse_ms(t.get("createdAt"))
    return round(delta / 3600000.0, 2) if delta >= 0 else None


def closure_hours(t):
    """closedAt - createdAt in hours, else None."""
    if not t.get("closedAt") or t.get("status") == "cancelled":
        return None
    delta = parse_ms(t["closedAt"]) - parse_ms(t.get("createdAt"))
    return round(delta / 3600000.0, 2) if delta >= 0 else None


def due_ms(t, settings=None):
    """When the ticket is considered overdue: target, else intake + the SLA window."""
    if t.get("target"):
        return parse_ms(t["target"])
    created = parse_ms(t.get("createdAt"))
    if not created:
        return 0.0
    return created + sla_days(settings) * 86400000.0


def is_overdue(t, now_ms=None, settings=None):
    """Active ticket past its due point (terminal tickets are never overdue)."""
    if t.get("status") not in OPEN_STATES:
        return False
    due = due_ms(t, settings)
    if not due:
        return False
    return due < (now_ms if now_ms is not None else datetime.now(timezone.utc).timestamp() * 1000)


def decorate(t, now_ms=None, settings=None):
    """Derived list fields appended per row (kept small  --  no history payload)."""
    row = dict(t)
    row["turnaroundHours"] = turnaround_hours(t)
    row["overdue"] = is_overdue(t, now_ms, settings)
    return row


def _matches(t, params, user_name=None, settings=None):
    q = (params.get("q") or "").strip().lower()
    if q:
        hay = " ".join(str(t.get(k) or "") for k in
                       ("id", "issue", "requester", "office", "asset", "technician", "category"))
        if q not in hay.lower():
            return False
    status = (params.get("status") or "").strip().lower()
    if status:
        wanted = {s.strip() for s in status.split(",") if s.strip()}
        if "open" in wanted:
            wanted |= set(OPEN_STATES)
        ts = t.get("status") or ""
        ts_alias = ts.lower().replace(" ", "_")
        if not any(w == ts or w == ts_alias for w in wanted):
            return False
    for key, field in (("office", "office"), ("requester", "requester"),
                       ("technician", "technician"), ("priority", "priority"),
                       ("category", "category"), ("source", "source")):
        want = (params.get(key) or "").strip()
        if want and str(t.get(field) or "").lower() != want.lower():
            return False
    if (params.get("mine") or "").strip() in ("1", "true", "yes"):
        if user_name and t.get("requester") != user_name:
            return False
    created = (params.get("from") or "").strip()
    if created and (t.get("createdAt") or "")[:10] < created:
        return False
    created_to = (params.get("to") or "").strip()
    if created_to and (t.get("createdAt") or "")[:10] > created_to:
        return False
    if (params.get("overdue") or "").strip() in ("1", "true", "yes"):
        if not is_overdue(t, settings=settings):
            return False
    return True


def _sort_value(t, key, settings=None):
    if key == "created":
        return parse_ms(t.get("createdAt"))
    if key == "target":
        return due_ms(t, settings)
    if key == "priority":
        return PRIORITY_ORDER.get(t.get("priority"), 0)
    if key == "status":
        return STATUS_ORDER.get(t.get("status"), 99)
    if key == "id":
        return t.get("id") or ""
    return parse_ms(t.get("updatedAt") or t.get("createdAt"))  # updated (default)


def query_tickets(tickets, params, user_name=None, settings=None):
    """Filter -> sort -> paginate. Returns the envelope the list screen needs.

    params: dict of query-string values (strings). Keys:
      q, status (csv | "open"), office, requester, technician, priority,
      category, source, mine, from, to, overdue, sort, order, page, size.
    `settings` is the operational block, so the overdue point follows the
    service level window the office configured rather than the shipped default.
    """
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    rows = [t for t in tickets if _matches(t, params, user_name, settings)]

    sort = (params.get("sort") or "updated").strip()
    if sort not in SORT_KEYS:
        sort = "updated"
    order = (params.get("order") or "desc").strip().lower()
    rows.sort(key=lambda t: (_sort_value(t, sort, settings), t.get("id") or ""),
              reverse=(order != "asc"))

    counts = {}
    for t in rows:
        counts[t.get("status")] = counts.get(t.get("status"), 0) + 1
    overdue_count = sum(1 for t in rows if is_overdue(t, now_ms, settings))

    size = min(max(_int(params.get("size"), 20), 1), MAX_SIZE)
    total = len(rows)
    pages = max((total + size - 1) // size, 1)
    page = min(max(_int(params.get("page"), 1), 1), pages)
    slice_ = rows[(page - 1) * size: page * size]

    return {
        "items": [decorate(t, now_ms, settings) for t in slice_],
        "total": total,
        "page": page,
        "pages": pages,
        "size": size,
        "counts": counts,
        "overdue": overdue_count,
        "sort": sort,
        "order": "asc" if order == "asc" else "desc",
    }


def summarize(tickets, now_ms=None, settings=None):
    """Shared aggregation used by the reports endpoint and the dashboard."""
    now_ms = now_ms if now_ms is not None else datetime.now(timezone.utc).timestamp() * 1000
    by_status, by_office, by_priority, by_category, by_source = {}, {}, {}, {}, {}
    turnarounds, closure_hours_list, overdue = [], [], 0
    costs_total = 0.0
    recurring_count = 0
    for t in tickets:
        by_status[t.get("status")] = by_status.get(t.get("status"), 0) + 1
        by_office[t.get("office")] = by_office.get(t.get("office"), 0) + 1
        by_priority[t.get("priority")] = by_priority.get(t.get("priority"), 0) + 1
        by_category[t.get("category")] = by_category.get(t.get("category"), 0) + 1
        by_source[t.get("source")] = by_source.get(t.get("source"), 0) + 1
        hours = turnaround_hours(t)
        if hours is not None:
            turnarounds.append(hours)
        cl_hours = closure_hours(t)
        if cl_hours is not None:
            closure_hours_list.append(cl_hours)
        if t.get("status") in OPEN_STATES and is_overdue(t, now_ms, settings):
            overdue += 1
        # Costs
        diag = t.get("diagnosis") or {}
        costs_total += float(diag.get("cost") or 0) + float(diag.get("labor") or 0) * 500  # assume 500 PHP/hour labor rate
        # Recurring
        if t.get("recurring"):
            recurring_count += 1
    within_target = sum(
        1 for t in tickets
        if t.get("target") and t.get("resolvedAt") and t["resolvedAt"][:10] <= t["target"][:10])
    resolved_with_target = sum(1 for t in tickets if t.get("target") and t.get("resolvedAt"))
    closed_tickets = [t for t in tickets if t.get("status") == "closed"]
    cancelled_tickets = [t for t in tickets if t.get("status") == "cancelled"]
    return {
        "by_status": by_status, "by_office": by_office, "by_priority": by_priority,
        "by_category": by_category, "by_source": by_source,
        "open": sum(by_status.get(s, 0) for s in OPEN_STATES),
        "closed": by_status.get("closed", 0),
        "cancelled": by_status.get("cancelled", 0),
        "overdue": overdue,
        "turnaround_avg_hours": round(sum(turnarounds) / len(turnarounds), 2) if turnarounds else None,
        "turnaround_samples": len(turnarounds),
        "resolved_within_target": within_target,
        "resolved_with_target": resolved_with_target,
        "default_sla_days": sla_days(settings),
        "closure_hours": round(sum(closure_hours_list) / len(closure_hours_list), 2) if closure_hours_list else None,
        "resolved_awaiting": sum(1 for t in tickets if t.get("status") == "resolved"),
        "completed": by_status.get("closed", 0),
        "awaiting_confirmation": sum(1 for t in tickets if t.get("status") == "resolved"),
        "costs_total": round(costs_total, 2),
        "recurring_count": recurring_count,
    }
