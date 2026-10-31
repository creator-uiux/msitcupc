"""Technician scope probe for the audit (S3 evidence).

Runs against a disposable demo server.  A coordinator moves one of J. Tan's
tickets to another technician; the probe then asks what J. Tan can still reach
over the API:

  * starting work on the ticket that is no longer theirs is refused;
  * the ticket leaves the technician's own snapshot.

The same rules are asserted inside the suite (`test_technician_notification_scope`
and `test_reassign_and_no_response` in `server/tests.py`); this script records
the answers a running server gives over HTTP.

Run:  python tests/audit/technician_scope_probe.py --base http://127.0.0.1:8901
      python tests/audit/technician_scope_probe.py > tests/audit/results/technician_scope_probe.json
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
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw or "{}")
        except ValueError:
            return e.code, {"raw": raw[:200]}


def login(role):
    st, res = call("POST", "/api/login", body={"role": role})
    assert st == 200 and res.get("ok"), res
    return res["token"], res["user"]


def main():
    out = {}
    ctok, _ = login("coordinator")
    ttok, tuser = login("technician")
    st, snap = call("GET", "/api/state", token=ctok)
    tickets = snap.get("tickets") or []
    mine = next((t for t in tickets
                 if t.get("technician") == tuser.get("name")
                 and t.get("status") in ("assigned", "in_progress")), None)
    if not mine:
        print(json.dumps({"error": "no ticket assigned to the demo technician"}))
        return 1
    tid = mine["id"]

    st, res = call("POST", "/api/call", token=ctok,
                   body={"method": "reassign", "args": [tid, "M. Uy"]})
    out["reassign"] = {"http": st, "ok": bool(res.get("ok")), "msg": res.get("msg")}

    st, res = call("POST", "/api/call", token=ttok,
                   body={"method": "startWork", "args": [tid, "probe"]})
    out["technician_foreign_startWork"] = {"ticket": tid, "http": st,
                                          "ok": bool(res.get("ok")), "msg": res.get("msg")}

    st, tssnap = call("GET", "/api/state", token=ttok)
    out["technician_visible_after_reassign"] = [
        [t["id"], t.get("technician")] for t in (tssnap.get("tickets") or [])
        if t.get("technician") == tuser.get("name")]
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    if "--base" in sys.argv:
        BASE = sys.argv[sys.argv.index("--base") + 1].rstrip("/")
    sys.exit(main())
