"""Probe the forbidden-URL behavior through the real demo sign-in click path.

Navigates to the login page, clicks a demo account (as a person would), then
opens a page the signed-in role must not use, and records what is rendered,
what Store believes, and what the backend answers.

Run: python tests/audit/forbidden_probe.py --base http://127.0.0.1:8899
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import shots  # noqa: E402


def wait_ready(ws, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = ws.command("Runtime.evaluate",
                       {"expression": "document.readyState", "returnByValue": True})
        if r.get("result", {}).get("value") == "complete":
            time.sleep(0.8)
            return
        time.sleep(0.1)


def js(ws, expression, await_promise=False):
    r = ws.command("Runtime.evaluate", {"expression": expression, "returnByValue": True,
                                        "awaitPromise": await_promise})
    return r.get("result", {}).get("value")


def goto(ws, url):
    ws.command("Page.navigate", {"url": url})
    wait_ready(ws)


CASES = [
    ("requester", "mgmt-users.html", "users.html"),
    ("technician", "ic-review.html", "review.html"),
    ("coordinator", "mgmt-settings.html", "settings.html"),
    ("management", "or-request.html", "request.html"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8899")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    dbg = shots.free_port()
    udd = tempfile.mkdtemp(prefix="audit_probe_")
    chrome = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--hide-scrollbars", "--remote-debugging-port=%d" % dbg,
         "--user-data-dir=" + udd, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = {}
    try:
        ws = shots.WS(shots.wait_endpoint(dbg))
        ws.command("Page.enable")
        ws.command("Runtime.enable")
        for role, forbidden, bare in CASES:
            goto(ws, base + "/login.html")
            js(ws, "document.querySelector('[data-acct=\"%s\"]').click()" % role)
            # wait for the redirect to the role dashboard
            deadline = time.time() + 15
            while time.time() < deadline:
                if "/login.html" not in (js(ws, "location.pathname") or ""):
                    break
                time.sleep(0.2)
            time.sleep(1.0)
            signed = {
                "landed": js(ws, "location.pathname"),
                "auth": js(ws, "(function(){var a=window.Store&&Store.db.auth;return a?{name:a.name,role:a.role}:null;})()"),
                "storeRole": js(ws, "window.Store&&Store.db.role"),
                "hasToken": js(ws, "(function(){try{return !!(JSON.parse(sessionStorage.getItem('itc_session')||'null')||{}).token;}catch(e){return false;}})()"),
            }
            goto(ws, base + "/" + forbidden)
            time.sleep(1.0)
            forbidden_view = {
                "landed": js(ws, "location.pathname"),
                "heading": js(ws, "(function(){var h=document.querySelector('main h2');return h?h.innerText.trim():null;})()"),
                "neutral": js(ws, "document.body.innerText.indexOf('This page is not available')>-1"),
                "storeRole": js(ws, "window.Store&&Store.db.role"),
                "rows": js(ws, "(function(){return document.querySelectorAll('main table tbody tr').length;})()"),
                "body": js(ws, "(function(){var m=document.querySelector('main');return m?m.innerText.replace(/\\s+/g,' ').slice(0,300):null;})()"),
                "apiUsers": js(ws, "(async function(){var s=JSON.parse(sessionStorage.getItem('itc_session')||'null');"
                                  "var r=await fetch('/api/users',{headers:{'Authorization':'Bearer '+(s?s.token:'')}});"
                                  "return {status:r.status,body:(await r.text()).slice(0,160)};})()",
                                  await_promise=True),
            }
            goto(ws, base + "/" + bare)
            time.sleep(1.0)
            bare_view = {
                "landed": js(ws, "location.pathname"),
                "heading": js(ws, "(function(){var h=document.querySelector('main h2');return h?h.innerText.trim():null;})()"),
                "neutral": js(ws, "document.body.innerText.indexOf('This page is not available')>-1"),
                "storeRole": js(ws, "window.Store&&Store.db.role"),
                "rows": js(ws, "(function(){return document.querySelectorAll('main table tbody tr').length;})()"),
            }
            out[role] = {"signedIn": signed, "forbidden": forbidden_view, "bare": bare_view}
            print(role, json.dumps(out[role], ensure_ascii=False)[:600])
        with open(os.path.join(ROOT, "docs", "audit-screenshots", "forbidden-probe.json"),
                  "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=2)
    finally:
        try:
            ws.close()
        except Exception:
            pass
        chrome.terminate()


if __name__ == "__main__":
    main()
