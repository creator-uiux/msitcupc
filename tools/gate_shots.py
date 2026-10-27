"""Visual quality gate (specification 14.11).

Captures the required pages in BOTH light and dark mode at 390, 768 and
1440 px into docs/screenshots/, then checks each capture for the problems the
gate calls out: horizontal overflow and clipped text.

    python tools/gate_shots.py

The images are the evidence for the visual review; the machine checks below
are the first pass, and the captures are then read for the rest.
"""
import base64
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import shots  # the DevTools websocket client, port helpers and Chrome launcher

OUT = os.path.join(ROOT, "docs", "screenshots")

# The pages the specification names for the visual review.
PAGES = [
    ("login", "login.html"),
    ("dashboard", "dashboard.html"),
    ("tickets", "tickets.html"),
    ("ticket", "ticket.html?id=IT-2026-000141"),
    ("request", "request.html"),
    ("maintenance", "maintenance.html"),
    ("register", "register.html"),
    ("reports", "reports.html"),
    ("administration", "users.html"),
    ("workflow-guide", "flow.html"),
]

WIDTHS = [("390", 390, 844), ("768", 768, 1024), ("1440", 1440, 900)]
THEMES = ["light", "dark"]

# A page is read in the role that can actually use it, so the capture shows the
# real interface rather than an access panel.
ROLE = {
    "dashboard": "coordinator",
    "tickets": "coordinator",
    "ticket": "coordinator",
    "request": "requester",
    "maintenance": "coordinator",
    "register": "coordinator",
    "reports": "coordinator",
    "administration": "management",
    "workflow-guide": "coordinator",
    "login": None,
}

OVERFLOW_JS = """(function(){
  var de = document.documentElement;
  var clipped = [];
  var all = document.querySelectorAll('h1,h2,h3,.t-title,.t-sub,.btn,.chip,.badge,.kpi-value,.kpi .label');
  for (var i = 0; i < all.length && clipped.length < 10; i++) {
    var e = all[i];
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 2) {
      var t = (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
      if (t) clipped.push(t);
    }
  }
  return JSON.stringify({over: de.scrollWidth - de.clientWidth, clipped: clipped});
})()"""

FREEZE_JS = ("(function(){var s=document.createElement('style');"
             "s.textContent='*,*::before,*::after{animation:none!important;"
             "transition:none!important;caret-color:transparent!important}';"
             "document.head.appendChild(s);"
             # the demo tick raises transient toasts; clear them so the capture
             # shows the page rather than a stack of notifications
             "var tb=document.querySelector('.toast-box');if(tb)tb.innerHTML='';"
             "window.scrollTo(0,0);"
             "void document.body.offsetHeight;})()")


def main():
    os.makedirs(OUT, exist_ok=True)
    if not os.path.exists(shots.CHROME):
        print("!! Chrome not found at %s" % shots.CHROME)
        return 2

    shots.PORT = shots.free_port()
    dbg = shots.free_port()
    shots.BASE = "http://127.0.0.1:%d/" % shots.PORT

    server = subprocess.Popen([sys.executable, "-m", "http.server", str(shots.PORT),
                               "--bind", "127.0.0.1"], cwd=ROOT,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import urllib.request
    for _ in range(40):
        try:
            urllib.request.urlopen(shots.BASE + "index.html", timeout=1).read(1)
            break
        except Exception:
            time.sleep(0.2)

    udd = os.path.join(os.environ.get("TEMP", ROOT), "gate_chrome_%d" % dbg)
    chrome = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--force-color-profile=srgb", "--disable-lcd-text",
         "--remote-debugging-port=%d" % dbg,
         "--user-data-dir=" + udd, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ws = None
    written = []
    problems = []
    try:
        ws = shots.WS(shots.wait_endpoint(dbg))
        ws.command("Page.enable")
        ws.command("Runtime.enable")

        for theme in THEMES:
            for wlabel, w, h in WIDTHS:
                for label, page in PAGES:
                    name = "%s-%s-%s" % (label, wlabel, theme)
                    url = shots.BASE + page
                    url += ("&" if "?" in page else "?") + "theme=%s" % theme
                    url += "&demo=1"
                    if ROLE.get(label):
                        url += "&role=%s" % ROLE[label]
                    ws.drain_events()
                    ws.command("Emulation.setDeviceMetricsOverride",
                               {"width": w, "height": h, "deviceScaleFactor": 1,
                                "mobile": w <= 480})
                    ws.command("Page.navigate", {"url": url})
                    deadline = time.time() + 20
                    while time.time() < deadline:
                        r = ws.command("Runtime.evaluate",
                                       {"expression": "document.readyState",
                                        "returnByValue": True})
                        if r.get("result", {}).get("value") == "complete":
                            break
                        time.sleep(0.1)
                    ws.command("Runtime.evaluate", {"expression": FREEZE_JS})
                    time.sleep(0.4)
                    shot = ws.command("Page.captureScreenshot",
                                      {"format": "png", "fromSurface": True}, timeout=60)
                    png = base64.b64decode(shot["data"])
                    with open(os.path.join(OUT, name + ".png"), "wb") as fh:
                        fh.write(png)
                    written.append(name)
                    r = ws.command("Runtime.evaluate",
                                    {"expression": OVERFLOW_JS, "returnByValue": True})
                    try:
                        res = json.loads(r.get("result", {}).get("value") or "{}")
                    except ValueError:
                        res = {}
                    if res.get("over", 0) > 2:
                        problems.append("%s: horizontal overflow %spx" % (name, res["over"]))
                    if res.get("clipped"):
                        problems.append("%s: clipped text: %s"
                                        % (name, "; ".join(res["clipped"][:4])))
                    print("  %-44s %s" % (name, "ok" if not res.get("over") else "OVERFLOW"))
    finally:
        if ws:
            try:
                ws.sock.close()
            except Exception:
                pass
        chrome.terminate()
        server.terminate()

    print("\ncaptured %d screenshot(s) into %s"
          % (len(written), os.path.relpath(OUT, ROOT)))
    if problems:
        print("\nVISUAL GATE MACHINE CHECK: %d issue(s)" % len(problems))
        for p in problems:
            print("  - %s" % p)
        return 1
    print("\nVISUAL GATE MACHINE CHECK: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
