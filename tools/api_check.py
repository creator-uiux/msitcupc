"""End-to-end browser check: the prototype running against the live backend.

Starts server/app.py in-process on an ephemeral port, drives the installed
Chrome over the DevTools Protocol (reusing tools/shots.py) and verifies that
pages served by the backend really talk to it:

  • api mode activates and the server dataset is adopted;
  • a Flow.* action round-trips through /api/call and mutates the server DB;
  • pages render without JavaScript exceptions.

Run:  python tools/api_check.py
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)                          # tools/ (shots)
sys.path.insert(0, os.path.join(ROOT, "server"))  # server/ (app)

import shots  # noqa: E402
import app as appmod  # noqa: E402

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS  %s" % name)
    else:
        FAIL += 1
        print("  FAIL  %s%s" % (name, ("  :: " + str(detail)) if detail else ""))


def api_get(base, path, token=None):
    req = urllib.request.Request(base + path)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def api_post(base, path, data, token=None):
    body = json.dumps(data).encode()
    req = urllib.request.Request(base + path, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read())


def main():
    global PASS, FAIL
    if not os.path.exists(shots.CHROME):
        print("!! Chrome not found at %s" % shots.CHROME)
        return 2

    db = os.path.join(tempfile.gettempdir(), "itc_api_check.sqlite3")
    if os.path.exists(db):
        os.remove(db)
    httpd, state, worker = appmod.build_server(host="127.0.0.1", port=0, db_path=db, start_worker=False)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % port

    dbg = shots.free_port()
    udd = os.path.join(os.environ.get("TEMP", ROOT), "api_check_chrome_%d" % dbg)
    chrome = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
         "--remote-debugging-port=%d" % dbg, "--user-data-dir=" + udd, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws = shots.WS(shots.wait_endpoint(dbg))
    ws.command("Page.enable")
    ws.command("Runtime.enable")

    def nav(url):
        ws.drain_events()
        ws.command("Page.navigate", {"url": url})
        deadline = time.time() + 25
        while time.time() < deadline:
            r = ws.command("Runtime.evaluate", {"expression": "document.readyState", "returnByValue": True})
            if r.get("result", {}).get("value") == "complete":
                break
            time.sleep(0.1)
        time.sleep(0.9)

    def ev(expr):
        r = ws.command("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("value")

    def exceptions():
        out = []
        for e in ws.drain_events("Runtime.exceptionThrown"):
            d = e["params"].get("exceptionDetails", {})
            out.append(d.get("exception", {}).get("description") or d.get("text", "error"))
        return out

    try:
        print("api_check: load dashboard.html")
        nav(base + "dashboard.html")
        snap = json.loads(ev("JSON.stringify({api:!!window.ApiMode,proxied:!!window.Api,"
                             "n:(window.Store&&Store.db.tickets.length)||0,role:window.Store&&Store.db.role})") or "{}")
        check("api mode active", snap.get("api") is True, snap)
        check("backend adapter installed", snap.get("proxied") is True, snap)
        check("server dataset adopted (9 tickets)", snap.get("n") == 9, snap)
        errs = exceptions()
        check("dashboard has no JS exceptions", not errs, errs)

        print("api_check: authoritative Flow action (createTicket as coordinator)")
        n_before = len(api_get(base, "/api/state", token=api_post(base, "/api/login", {"role": "coordinator"})["token"])["tickets"])
        created = json.loads(ev("JSON.stringify(Flow.createTicket({office:'Library',requester:'API Check',"
                                "category:'Hardware',issue:'created by api_check',source:'email'}))") or "{}")
        check("Flow.createTicket ok", created.get("ok") is True, created)
        check("page state updated", len(state.data["tickets"]) == n_before + 1, len(state.data["tickets"]))
        tok = api_post(base, "/api/login", {"role": "coordinator"})["token"]
        server_ids = [t["id"] for t in api_get(base, "/api/state", token=tok)["tickets"]]
        check("ticket persisted on server", created.get("id") in server_ids, created.get("id"))

        print("api_check: RBAC enforced server-side on technician page")
        ev("try{sessionStorage.clear()}catch(e){}")
        nav(base + "technician.html?role=technician")
        role = ev("window.Store&&Store.db.role")
        check("technician page uses technician role", role == "technician", role)
        blocked = json.loads(ev("JSON.stringify(Flow.requestInfo('IT-2026-000143','x'))") or "{}")
        check("technician blocked from coordinator action", blocked.get("ok") is False, blocked)
        errs = exceptions()
        check("technician page has no JS exceptions", not errs, errs)

        print("api_check: backend pages are live by default")
        nav(base + "dashboard.html")
        check("bare backend page runs in api mode", ev("!!window.ApiMode") is True)
        errs = exceptions()
        check("bare backend page has no JS exceptions", not errs, errs)

        print("api_check: record endpoints")
        tok = api_post(base, "/api/login", {"role": "coordinator"})["token"]
        lst = api_get(base, "/api/tickets?status=open&size=5&sort=id&order=asc", token=tok)
        check("GET /api/tickets filters/paginates server-side",
              lst.get("ok") and lst.get("size") == 5 and len(lst.get("items", [])) == 5
              and lst["counts"].get("closed") is None, lst.get("total"))
        check("list rows are decorated with derived fields",
              all("overdue" in t and "turnaroundHours" in t for t in lst["items"]), lst["items"][:1])
        mine = api_get(base, "/api/tickets", token=api_post(base, "/api/login", {"role": "requester"})["token"])
        check("requester list defaults to their own requests",
              mine.get("total", 0) >= 1 and mine["total"] < lst["total"], mine.get("total"))
        users = api_get(base, "/api/users?role=technician",
                        token=api_post(base, "/api/login", {"role": "management"})["token"])
        check("GET /api/users filters by role",
              users.get("ok") and users["total"] >= 1
              and all(p["role"] == "technician" for p in users["users"]), users.get("total"))
        rep = api_get(base, "/api/reports", token=tok)
        check("GET /api/reports carries the KPI aggregates",
              rep.get("default_sla_days") and "resolved_within_target" in rep
              and "turnaround_avg_hours" in rep, list(rep.keys()))
    finally:
        try:
            ws.close()
        except Exception:
            pass
        chrome.terminate()
        httpd.shutdown()
        httpd.server_close()

    print("\nRESULT: %d passed, %d failed" % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
