"""Controlled probes for the POST /api/state merge endpoint (audit only).

Probes two behaviours on a throwaway demo database:

  A. A coordinator pushes a ticket that is already Resolved through the bulk
     state merge. The merge must refuse it: a new record enters as Submitted
     and the server writes its own tests, history and audit entry.
  B. The merge is then called with a partial array. It must merge by id, so a
     record the client left out survives.

Both were reproduced as defects in the 2026-10-29 audit and both are refused
on the current tree. Run against a disposable server, never against real data:

  python server/app.py --port 8899 --db /tmp/audit_itc.sqlite3 --reset --demo --no-worker
  python tests/audit/state_merge_probe.py
  python tests/audit/state_merge_probe.py --base http://127.0.0.1:8901
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8899"


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def main():
    out = {}
    st, login = call("POST", "/api/login", body={"role": "coordinator"})
    assert st == 200 and login.get("ok"), login
    token = login["token"]
    st, snap = call("GET", "/api/state", token=token)
    tickets = snap.get("tickets") or []
    out["before_count"] = len(tickets)
    out["before_ids"] = [t["id"] for t in tickets]

    # Probe A: new ticket created directly in Resolved.
    new_ticket = {
        "id": "IT-9999-000099",
        "office": "Registrar",
        "requester": "Audit Probe",
        "category": "Hardware Repair",
        "issue": "Audit probe: created already Resolved via state merge.",
        "status": "resolved",
        "priority": "high",
        "source": "online",
        "createdAt": "2026-10-29T00:00:00.000Z",
        "updatedAt": "2026-10-29T00:00:00.000Z",
        "history": [],
        "comments": [],
    }
    st_a, res_a = call("POST", "/api/state", token=token,
                       body={"state": {"tickets": tickets + [new_ticket]}})
    st_b, snap2 = call("GET", "/api/state", token=token)
    ids2 = [t["id"] for t in (snap2.get("tickets") or [])]
    created = [t for t in (snap2.get("tickets") or []) if t["id"] == "IT-9999-000099"]
    out["probe_a"] = {
        "http": st_a,
        "ok": bool(res_a.get("ok")),
        "ticket_created": bool(created),
        "created_status": created[0]["status"] if created else None,
        "created_has_tests": bool(created[0].get("tests")) if created else None,
        "count_after_a": len(ids2),
    }

    # Probe B: merge with a partial array (only the probe ticket).
    st_c, res_c = call("POST", "/api/state", token=token,
                       body={"state": {"tickets": [t for t in (snap2.get("tickets") or [])
                                                   if t["id"] == "IT-9999-000099"]}})
    st_d, snap3 = call("GET", "/api/state", token=token)
    ids3 = [t["id"] for t in (snap3.get("tickets") or [])]
    out["probe_b"] = {
        "http": st_c,
        "ok": bool(res_c.get("ok")),
        "count_after_b": len(ids3),
        "surviving_ids": ids3,
        "deleted_count": len(ids2) - len(ids3),
    }

    # Requester is refused at the same endpoint.
    st_r, login_r = call("POST", "/api/login", body={"role": "requester"})
    st_e, res_e = call("POST", "/api/state", token=login_r.get("token"),
                       body={"state": {"tickets": []}})
    out["probe_requester"] = {"http": st_e, "msg": res_e.get("msg")}

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    if "--base" in sys.argv:
        BASE = sys.argv[sys.argv.index("--base") + 1].rstrip("/")
    sys.exit(main())
