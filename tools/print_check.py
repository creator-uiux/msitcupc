"""Print view audit for the ticket and the report page.

The printed copy is a separate rendering of the same record, so it is checked
as one: Chrome is asked for the print media, the computed styles are measured
in the live page, and the audit fails if any screen control survives on paper
or if the letterhead block stays hidden.

Run:  python tools/print_check.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import shots  # noqa: E402  (WS, wait_endpoint, free_port, CHROME)
from responsive import static_server  # noqa: E402

# What must survive on paper, and what must never appear there.
MUST_SHOW = [".print-only", ".print-head", ".print-brand"]
MUST_HIDE = [".sidebar", ".appbar", ".topbar", ".toolbar", ".filters",
             ".pagination", "#rPagination", ".no-print"]

PROBE = """
(function () {
  function vis(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var cs = getComputedStyle(el);
    return { display: cs.display, opacity: cs.opacity,
             text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60) };
  }
  var shown = {}, hidden = {}, buttons = 0, printable = 0;
  %SHOW%.forEach(function (s) { shown[s] = vis(s); });
  %HIDE%.forEach(function (s) { hidden[s] = vis(s); });
  document.querySelectorAll('button').forEach(function (b) {
    var cs = getComputedStyle(b), el = b, inside = false;
    while (el) {
      if (el.classList && Array.prototype.some.call(el.classList, function (c) {
        return 'no-print'.indexOf(c) > -1;
      })) { inside = true; break; }
      el = el.parentElement;
    }
    if (cs.display !== 'none' && !inside && !b.closest('.print-only')) buttons++;
  });
  document.querySelectorAll('.print-only').forEach(function (p) {
    if (getComputedStyle(p).display !== 'none') printable += p.innerText.trim().length;
  });
  var body = getComputedStyle(document.body);
  return JSON.stringify({ shown: shown, hidden: hidden, looseButtons: buttons,
                          printText: printable, background: body.backgroundColor,
                          color: body.color, title: document.title });
})()
"""


def expr():
    return (PROBE.replace("%SHOW%", json.dumps(MUST_SHOW))
                  .replace("%HIDE%", json.dumps(MUST_HIDE)))


def measure(ws, evaluate, nav, url):
    if not nav(url):
        return None, "page never finished loading: %s" % url
    ws.command("Emulation.setEmulatedMedia", {"media": "print"})
    time.sleep(0.3)
    raw = evaluate(expr())
    ws.command("Emulation.setEmulatedMedia", {"media": "screen"})
    time.sleep(0.3)
    screen = evaluate(expr())
    if not raw:
        return None, "no probe result for %s" % url
    return json.loads(raw), json.loads(screen) if screen else None


def main():
    if not os.path.exists(shots.CHROME):
        print("!! Chrome not found at %s" % shots.CHROME)
        return 2

    ticket = sys.argv[1] if len(sys.argv) > 1 else None
    if not ticket:
        import re
        src = open(os.path.join(ROOT, "js", "store.js"), encoding="utf-8").read()
        m = re.search(r"id:\s*'(IT-\d{4}-\d+)'", src)
        ticket = m.group(1) if m else "IT-2026-000150"

    port = shots.free_port()
    base = "http://127.0.0.1:%d/" % port
    httpd = static_server(ROOT, port)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    dbg = shots.free_port()
    profile = os.path.join(tempfile.gettempdir(), "print-chrome-%d" % dbg)
    if os.path.isdir(profile):
        shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile)
    proc = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--no-first-run", "--no-default-browser-check", "--disable-extensions",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--remote-debugging-port=%d" % dbg, "--user-data-dir=" + profile,
         "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws = shots.WS(shots.wait_endpoint(dbg))
    ws.command("Page.enable")
    ws.command("Runtime.enable")

    def nav(url, timeout=25):
        ws.drain_events()
        ws.command("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                r = ws.command("Runtime.evaluate",
                               {"expression": "document.readyState", "returnByValue": True})
            except Exception:
                time.sleep(0.1)
                continue
            if r.get("result", {}).get("value") == "complete":
                time.sleep(0.6)
                return True
            time.sleep(0.1)
        return False

    def evaluate(expression):
        r = ws.command("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        return r.get("result", {}).get("value")

    problems = []
    pages = [("reports.html", base + "reports.html?demo=1"),
             ("ticket.html", base + "ticket.html?demo=1&id=" + ticket)]
    try:
        for name, url in pages:
            printed, screen = measure(ws, evaluate, nav, url)
            if printed is None:
                problems.append("%s: %s" % (name, screen))
                continue
            print("\n== %s (printed copy) ==" % name, flush=True)
            for sel in MUST_SHOW:
                got = printed["shown"].get(sel)
                if not got:
                    problems.append("%s: %s is not on the page" % (name, sel))
                elif got["display"] == "none":
                    problems.append("%s: %s stays hidden on paper" % (name, sel))
                else:
                    print(" ok  %-14s visible%s" % (sel, " | " + got["text"] if got["text"] else ""))
            hidden_ok = hidden_absent = 0
            for sel in MUST_HIDE:
                got = printed["hidden"].get(sel)
                if not got:
                    hidden_absent += 1
                elif got["display"] != "none":
                    problems.append("%s: %s survives on paper" % (name, sel))
                else:
                    hidden_ok += 1
            if printed["looseButtons"]:
                problems.append("%s: %d control buttons still print" % (name, printed["looseButtons"]))
            if printed["printText"] < 40:
                problems.append("%s: the printed block carries only %d characters"
                                % (name, printed["printText"]))
            if printed["background"] not in ("rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"):
                problems.append("%s: the printed page paints %s" % (name, printed["background"]))
            if screen and screen["shown"].get(".print-only") and \
                    screen["shown"][".print-only"]["display"] != "none":
                problems.append("%s: the printed block is visible on screen too" % name)
            print(" ok  letterhead text %d characters, background %s, ink %s"
                  % (printed["printText"], printed["background"], printed["color"]))
            print(" ok  %d screen controls hidden on paper, %d selectors this page does not use"
                  % (hidden_ok, hidden_absent))
    finally:
        try:
            ws.close()
        except Exception:
            pass
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)
        httpd.shutdown()

    print()
    if problems:
        for p in problems:
            print("FAIL " + p)
        print("\nPRINT VIEW: FAIL (%d)" % len(problems))
        return 1
    print("PRINT VIEW: PASS (%d pages)" % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
