"""Office and technician scope probes for the audit (read/write attempts).

Runs against a disposable demo server on port 8899. It signs in as a
requester and as a technician, then attempts cross-office and cross-technician
reads and writes directly against the API.

Run:  python tests/audit/scope_probe.py
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
    ctok, cuser = login("coordinator")
    st, snap = call("GET", "/api/state", token=ctok)
    tickets = snap.get("tickets") or []
    out["dataset"] = {"tickets": len(tickets), "rev": snap.get("rev")}

    rtok, ruser = login("requester")
    st, rsnap = call("GET", "/api/state", token=rtok)
    out["requester_scope"] = {
        "office": ruser.get("office"),
        "visible": len(rsnap.get("tickets") or []),
        "offices_seen": sorted({t.get("office") for t in (rsnap.get("tickets") or [])}),
        "all_offices": sorted({t.get("office") for t in tickets}),
    }
    foreign = next((t for t in tickets if t.get("office") != ruser.get("office")), None)
    if foreign:
        st, res = call("POST", "/api/call", token=rtok,
                       body={"method": "officeDecision", "args": [foreign["id"], "accepted", {"person": "Probe"}]})
        out["requester_foreign_write"] = {"ticket": foreign["id"], "office": foreign.get("office"),
                                          "http": st, "ok": bool(res.get("ok")), "msg": res.get("msg")}
    st, res = call("GET", "/api/users", token=rtok)
    out["requester_users_api"] = {"http": st, "ok": bool(res.get("ok"))}

    ttok, tuser = login("technician")
    other = next((t for t in tickets if t.get("technician") and t.get("technician") != tuser.get("name")), None)
    if other:
        st, res = call("POST", "/api/call", token=ttok,
                       body={"method": "startWork", "args": [other["id"], "probe"]})
        out["technician_foreign_ticket"] = {"ticket": other["id"], "assigned": other.get("technician"),
                                            "http": st, "ok": bool(res.get("ok")), "msg": res.get("msg")}
    st, tssnap = call("GET", "/api/state", token=ttok)
    visible = tssnap.get("tickets") or []
    out["technician_scope"] = {
        "name": tuser.get("name"),
        "visible": len(visible),
        "assigned_to_others": [t["id"] for t in visible
                               if t.get("technician") and t.get("technician") != tuser.get("name")],
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    sys.exit(main())
