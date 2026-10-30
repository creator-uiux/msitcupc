"""Runtime role walkthrough for the completeness audit.

Drives a real headless Chrome over the DevTools Protocol against a running
backend with the demo gate on. For each role it signs in through /api/login,
records the visible navigation, the dashboard panels, the ticket action card
per status, the forbidden-URL panel, and the result of direct API attempts.

Read-only apart from one deliberate /api/state probe (documented in the audit
report) that runs against the throwaway database passed on the command line.

Run:  python tests/audit/role_walkthrough.py --base http://127.0.0.1:8899
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import shots  # noqa: E402

CHROME = shots.CHROME
OUT = os.path.join(ROOT, "docs", "audit-screenshots")

ROLE_PAGES = {
    "requester": {"prefix": "or", "landing": "or-dashboard.html",
                  "forbidden": "mgmt-users.html", "ticket_page": "or-ticket.html"},
    "technician": {"prefix": "itc", "landing": "itc-dashboard.html",
                   "forbidden": "ic-review.html", "ticket_page": "itc-ticket.html"},
    "coordinator": {"prefix": "ic", "landing": "ic-dashboard.html",
                    "forbidden": "mgmt-users.html", "ticket_page": "ic-ticket.html"},
    # Role scope 5: the administrator lane holds Administration and the audit
    # viewer only, so it has no dashboard and no ticket page to walk.
    "management": {"prefix": "mgmt", "landing": "mgmt-users.html",
                   "forbidden": "or-request.html", "ticket_page": None},
}


def post_json(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def get_json(url, token):
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def get_json_allowed(url, token):
    """A 403 is the documented answer for a route the lane does not serve."""
    try:
        return get_json(url, token)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            return {"items": []}
        raise


def wait_ready(ws, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = ws.command("Runtime.evaluate",
                       {"expression": "document.readyState", "returnByValue": True})
        if r.get("result", {}).get("value") == "complete":
            time.sleep(0.45)
            return
        time.sleep(0.1)


def js(ws, expression, await_promise=False):
    r = ws.command("Runtime.evaluate", {
        "expression": expression, "returnByValue": True,
        "awaitPromise": await_promise})
    return r.get("result", {}).get("value")


def goto(ws, url):
    ws.command("Page.navigate", {"url": url})
    wait_ready(ws)


def sign_in_js(token, user, page):
    return ("(function(){sessionStorage.setItem('itc_session', JSON.stringify(%s));"
            "location.href='%s';return true;})()"
            % (json.dumps({"token": token, "user": user}), page))


def visible_text(ws, selector):
    return js(ws, "(function(){var e=document.querySelector(%s);"
                  "return e?e.innerText.replace(/\\s+/g,' ').trim():null;})()"
              % json.dumps(selector))


def visible_links(ws, selector):
    return js(ws, "(function(){return Array.prototype.slice.call("
                  "document.querySelectorAll(%s)).filter(function(a){"
                  "return a.offsetParent!==null;}).map(function(a){"
                  "return {text:a.innerText.replace(/\\s+/g,' ').trim(),href:a.getAttribute('href')};});})()"
              % json.dumps(selector))


def headings(ws):
    return js(ws, "(function(){return Array.prototype.slice.call("
                  "document.querySelectorAll('main h1,main h2,main h3,.card-title')).filter("
                  "function(e){return e.offsetParent!==null;}).map(function(e){"
                  "return e.innerText.replace(/\\s+/g,' ').trim();})"
                  ".filter(function(t){return t;}).slice(0,16);})()")


def capture(ws, path, w, h):
    ws.command("Emulation.setDeviceMetricsOverride",
               {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": w <= 480})
    time.sleep(0.4)
    shot = ws.command("Page.captureScreenshot",
                      {"format": "png", "fromSurface": True, "captureBeyondViewport": False},
                      timeout=60)
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(shot["data"]))


def api_probe(ws, method, args):
    expr = ("(async function(){var s=JSON.parse(sessionStorage.getItem('itc_session')||'null');"
            "var r=await fetch('/api/call',{method:'POST',headers:{'Content-Type':'application/json',"
            "'Authorization':'Bearer '+(s?s.token:'')},body:JSON.stringify({method:%s,args:%s})});"
            "var b=await r.json();return {status:r.status,ok:b.ok,msg:b.msg};})()"
            % (json.dumps(method), json.dumps(args)))
    return js(ws, expr, await_promise=True)


def state_probe(ws, payload):
    expr = ("(async function(){var s=JSON.parse(sessionStorage.getItem('itc_session')||'null');"
            "var r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json',"
            "'Authorization':'Bearer '+(s?s.token:'')},body:JSON.stringify({state:%s})});"
            "var b=await r.json();return {status:r.status,ok:b.ok,msg:b.msg};})()"
            % json.dumps(payload))
    return js(ws, expr, await_promise=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8899")
    args = ap.parse_args()
    base = args.base.rstrip("/")
    os.makedirs(OUT, exist_ok=True)

    dbg = shots.free_port()
    udd = tempfile.mkdtemp(prefix="audit_chrome_")
    chrome = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--remote-debugging-port=%d" % dbg, "--user-data-dir=" + udd, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    report = {}
    try:
        ws = shots.WS(shots.wait_endpoint(dbg))
        ws.command("Page.enable")
        ws.command("Runtime.enable")
        ws.command("Emulation.setDeviceMetricsOverride",
                   {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})

        for role, cfg in ROLE_PAGES.items():
            login = post_json(base + "/api/login", {"role": role})
            token, user = login["token"], login["user"]
            state = get_json(base + "/api/state", token)
            tickets = get_json_allowed(base + "/api/tickets?size=100", token)["items"]

            # sign in on the real login page so sessionStorage matches the app
            goto(ws, base + "/login.html")
            js(ws, sign_in_js(token, user, "/%s" % cfg["landing"]))
            wait_ready(ws)

            nav = visible_links(ws, ".side-link[href], .bottomnav a[href], .top-tab[href]")
            dash = headings(ws)
            capture(ws, os.path.join(OUT, "%s-landing-1440.png" % role), 1440, 900)
            ws.command("Emulation.setDeviceMetricsOverride",
                       {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
            time.sleep(0.4)
            capture(ws, os.path.join(OUT, "%s-landing-390.png" % role), 390, 844)
            ws.command("Emulation.setDeviceMetricsOverride",
                       {"width": 1440, "height": 900, "deviceScaleFactor": 1, "mobile": False})

            actions = {}
            for t in (tickets if cfg["ticket_page"] else []):
                st = t["status"]
                if st in actions:
                    continue
                goto(ws, base + "/%s?id=%s" % (cfg["ticket_page"], urllib.parse.quote(t["id"])))
                actions[st] = {
                    "ticket": t["id"],
                    "actionCard": visible_text(ws, "#tActions"),
                    "transitions": js(ws, "(function(){var s=document.getElementById('tMove');"
                                           "return s?Array.prototype.slice.call(s.options).map("
                                           "function(o){return o.text;}).filter(function(x){return x&&x.indexOf("
                                           "'Choose')===-1;}):[];})()"),
                }
            if tickets and cfg["ticket_page"]:
                goto(ws, base + "/%s?id=%s" % (cfg["ticket_page"], urllib.parse.quote(tickets[0]["id"])))
                capture(ws, os.path.join(OUT, "%s-ticket-1440.png" % role), 1440, 900)

            goto(ws, base + "/" + cfg["forbidden"])
            forbidden = {
                "url": cfg["forbidden"],
                "heading": js(ws, "(function(){var h=document.querySelector('main h2');"
                                  "return h?h.innerText.trim():null;})()"),
                "bodyHasNeutral": js(ws, "document.body.innerText.indexOf('This page is not available')>-1"),
            }

            probes = {
                "assign": api_probe(ws, "assign", ["IT-2026-000143", "J. Tan"]),
                "officeDecision": api_probe(ws, "officeDecision",
                                            ["IT-2026-000141", "accepted", {"person": "K. Ramos"}]),
                "diagnose": api_probe(ws, "diagnose", ["IT-2026-000142", {"findings": "probe"}]),
                "saveSettings": api_probe(ws, "saveSettings", [{"reminderBusinessDays": 3}]),
            }

            report[role] = {
                "user": user,
                "scopeTickets": len(tickets),
                "nav": nav,
                "dashboardHeadings": dash,
                "ticketActions": actions,
                "forbidden": forbidden,
                "apiProbes": probes,
            }
            print("[%s] nav=%d tickets=%d statuses=%s" %
                  (role, len(nav), len(tickets), ",".join(sorted(actions))))

        # Deliberate write probe: can a coordinator create a ticket that is
        # already Resolved through the state-merge endpoint?
        login = post_json(base + "/api/login", {"role": "coordinator"})
        goto(ws, base + "/login.html")
        js(ws, sign_in_js(login["token"], login["user"], "/ic-dashboard.html"))
        wait_ready(ws)
        probe = state_probe(ws, {"tickets": [{
            "id": "IT-9999-000001", "office": "Library", "requester": "Audit Probe",
            "category": "Hardware Repair", "source": "email", "issue": "audit probe",
            "status": "resolved", "history": [], "comments": [], "createdAt": "2026-01-01T00:00:00Z",
            "dateReported": "2026-01-01T00:00:00Z"}]})
        report["stateMergeProbe"] = probe
        print("[probe] state merge create resolved ->", probe)

        with open(os.path.join(OUT, "role-walkthrough.json"), "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        print("wrote", os.path.join(OUT, "role-walkthrough.json"))
    finally:
        try:
            ws.close()
        except Exception:
            pass
        chrome.terminate()


if __name__ == "__main__":
    main()
