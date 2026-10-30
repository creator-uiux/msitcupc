"""Session expiry audit: an expired token returns the user to sign-in.

The backend drops a session that has been idle for 30 minutes or is older than
24 hours (decision D22).  A browser must notice that and go back to the sign-in
screen; it must not quietly keep the page open on the bundled seed dataset,
because that would show demo records as if they were the live register.  A page
with no backend at all still has to fall back to the local prototype.

Run:  python tools/session_check.py
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

import app as appmod  # noqa: E402
import shots  # noqa: E402
from responsive import static_server  # noqa: E402

PASSED = []
PROBLEMS = []


def ok(name, detail=""):
    PASSED.append(name)
    print(" ok  %s%s" % (name, (" | " + str(detail)) if detail else ""), flush=True)


def bad(name, detail=""):
    PROBLEMS.append("%s%s" % (name, (" :: " + str(detail)) if detail else ""))
    print(" FAIL %s%s" % (name, (" | " + str(detail)) if detail else ""), flush=True)


def check(label, name, cond, detail=""):
    print("\n== %s ==" % label, flush=True)
    (ok if cond else bad)(name, detail)


def wait_for_health(port, timeout=20):
    """Poll the application server's own health endpoint.

    shots.wait_endpoint() polls the Chrome DevTools endpoint, so it cannot be
    used for the API server on the same machine.
    """
    import json
    import urllib.error
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port,
                                        timeout=2) as r:
                if json.loads(r.read().decode("utf-8")).get("ok"):
                    return True
        except (urllib.error.URLError, OSError, ValueError):
            time.sleep(0.1)
    return False


def main():
    tmp = tempfile.mkdtemp(prefix="session-check-")
    api_port = shots.free_port()
    httpd, state, _worker = appmod.build_server(
        host="127.0.0.1", port=api_port, db_path=os.path.join(tmp, "session.sqlite3"),
        start_worker=False, demo=True)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    if not wait_for_health(api_port):
        print("the API server never answered /api/health")
        return 1
    api_base = "http://127.0.0.1:%d/" % api_port

    static_port = shots.free_port()
    shttpd = static_server(ROOT, static_port)
    threading.Thread(target=shttpd.serve_forever, daemon=True).start()
    static_base = "http://127.0.0.1:%d/" % static_port

    dbg = shots.free_port()
    profile = os.path.join(tempfile.gettempdir(), "session-chrome-%d" % dbg)
    shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile)
    proc = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--no-first-run", "--no-default-browser-check", "--disable-extensions",
         "--hide-scrollbars", "--remote-debugging-port=%d" % dbg,
         "--user-data-dir=" + profile, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = shots.WS(shots.wait_endpoint(dbg))
        ws.command("Page.enable")
        ws.command("Runtime.enable")

        def evaluate(expression):
            r = ws.command("Runtime.evaluate", {"expression": expression, "returnByValue": True})
            return r.get("result", {}).get("value")

        def goto(url, timeout=30):
            ws.drain_events()
            ws.command("Page.navigate", {"url": url})
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    if evaluate("document.readyState") == "complete":
                        time.sleep(0.8)
                        return True
                except Exception:
                    pass
                time.sleep(0.1)
            return False

        def wait_for(predicate, timeout=20):
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    if evaluate(predicate):
                        time.sleep(0.4)
                        return evaluate("location.href")
                except Exception:
                    pass
                time.sleep(0.2)
            return evaluate("location.href")

        # 1. a live page signs the role in and reads the server dataset
        goto(api_base + "dashboard.html")
        api_live = evaluate("window.ApiMode === true")
        tickets = evaluate("(window.Store && Store.db.tickets || []).length")
        check("live backend", "the page runs against the API server", bool(api_live), api_live)
        check("live backend", "the register came from the server", bool(tickets), tickets)
        signed = evaluate("(function(){var s=sessionStorage.getItem('itc_session');"
                          "return s && JSON.parse(s).token ? 'token held' : 'no token';})()")
        check("live backend", "the browser holds a session token", signed == "token held", signed)

        # 2. the server expires it (the same delete resolve() performs on an
        #    idle or over-age token), and the browser asks for the register again
        with state.lock:
            state.conn.execute("DELETE FROM sessions")
            state.conn.commit()
        goto(api_base + "reports.html")
        landed = wait_for("/login\\.html/.test(location.href)")
        check("expired session", "an expired token lands on the sign-in screen",
              "login.html" in (landed or ""), landed)
        check("expired session", "the screen knows where to send the user back",
              "next=" in (landed or ""), landed)
        left = evaluate("sessionStorage.getItem('itc_session')")
        check("expired session", "the stale token is gone from storage", left is None, left)

        # 3. signing in again from that screen brings the user back to the page
        #    they were working on, so the bounce is a round trip, not a dead end
        clicked = evaluate("(function (){"
                           "var b=[].slice.call(document.querySelectorAll('[data-acct]'));"
                           "var pick=b.filter(function (x){return x.getAttribute('data-acct')==='coordinator';})[0]||b[0];"
                           "if(!pick)return 'no demo control';pick.click();return 'clicked';})()")
        back = wait_for("/reports\\.html/.test(location.href)") if clicked == "clicked" else None
        check("signing in again", "the demo sign-in is offered on the way back in",
              clicked == "clicked", clicked)
        check("signing in again", "the user returns to the page they left",
              "reports.html" in (back or ""), back)
        refetched = evaluate("(window.Store && Store.db.tickets || []).length")
        check("signing in again", "the register is the server's again",
              bool(refetched), refetched)

        # 4. an offline draft pushed through the state merge: the server mints
        #    the ticket number, the browser takes the answer, and the read state
        #    the engine already holds survives the round trip
        probe = evaluate("(function (){"
                         "if(!window.Admin || !Admin.markNotificationsRead) return 'no admin mirror';"
                         "var notices=(window.Store.db.notifications||[]).length;"
                         "Admin.markNotificationsRead([]);"
                         "var fake='IT-1999-000001';"
                         "Store.update(function (d) { d.tickets.push({id: fake, office: 'Records Office',"
                         " requester: 'A. Delos Reyes', category: 'Hardware Repair',"
                         " issue: 'offline draft for the read mark check', status: 'submitted'}); });"
                         "var t=window.Store.db.tickets;"
                         "var mine=t.filter(function (x){return x.issue==='offline draft for the read mark check';});"
                         "return JSON.stringify({notices:notices,"
                         " readMarks:window.Store.db.notifications.filter(function (x){return (x.readBy||[]).length;}).length,"
                         " found:mine.length, id:mine.length?mine[0].id:'', status:mine.length?mine[0].status:'',"
                         " invented:t.some(function (x){return x.id===fake;})});})()")
        import json
        got = {}
        try:
            got = json.loads(probe) if isinstance(probe, str) and probe.startswith("{") else {}
        except ValueError:
            got = {}
        check("state merge create", "the draft reaches the register once", got.get("found") == 1, probe)
        check("state merge create", "the register carries the number the server minted",
              re.match(r"^IT-\d{4}-\d{6}$", got.get("id", "")) is not None
              and got.get("id") != "IT-1999-000001", got.get("id"))
        check("state merge create", "the number the browser invented is gone",
              got.get("invented") is False, got.get("invented"))
        check("state merge create", "the minted record entered as Submitted",
              got.get("status") == "submitted", got.get("status"))
        check("state merge create", "the adopted snapshot still carries the read state",
              got.get("notices", 0) > 0 and got.get("readMarks") == got.get("notices"),
              (got.get("readMarks"), got.get("notices")))

        # 5. control: a static copy with no backend keeps the local prototype
        goto(static_base + "dashboard.html")
        stayed = wait_for("/dashboard\\.html/.test(location.href)", timeout=12)
        offline_api = evaluate("window.ApiMode === true")
        check("no backend", "a static copy stays on the page it was asked for",
              "dashboard.html" in (stayed or ""), stayed)
        check("no backend", "the local prototype keeps running without a server",
              not offline_api, offline_api)
    finally:
        try:
            proc.terminate()
        except OSError:
            pass
        httpd.shutdown()
        httpd.server_close()
        shttpd.shutdown()
        shttpd.server_close()
        shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(profile, ignore_errors=True)

    print()
    if PROBLEMS:
        print("SESSION EXPIRY: FAIL")
        for p in PROBLEMS:
            print("  - " + p)
        return 1
    print("SESSION EXPIRY: PASS (%d checks)" % len(PASSED))
    return 0


if __name__ == "__main__":
    sys.exit(main())
