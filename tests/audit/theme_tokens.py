"""Compare the effective theme tokens with docs/THEME_SNAPSHOT.md (audit only).

Loads dashboard.html from a static copy in light and dark, reads every token
listed in the snapshot through getComputedStyle, and reports mismatches.

Run:  python tests/audit/theme_tokens.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import shots  # noqa: E402


def snapshot_tokens():
    rows = {}
    text = open(os.path.join(ROOT, "docs", "THEME_SNAPSHOT.md"), encoding="utf-8").read()
    for line in text.splitlines():
        m = re.match(r"\|\s*`(--[a-z0-9-]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*[^|]+\|", line)
        if m:
            light, dark = m.group(2).strip(), m.group(3).strip()
            if not (light.startswith("#") or light.startswith("rgba") or light.startswith("rgb")):
                continue
            rows[m.group(1)] = {"light": light.lower().replace(" ", ""),
                                "dark": dark.lower().replace(" ", "")}
    return rows


def launch():
    dbg = shots.free_port()
    profile = os.path.join(tempfile.gettempdir(), "theme-chrome-%d" % dbg)
    shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile)
    proc = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--no-first-run", "--no-default-browser-check", "--disable-extensions",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--remote-debugging-port=%d" % dbg, "--user-data-dir=" + profile, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws = shots.WS(shots.wait_endpoint(dbg))
    ws.command("Page.enable")
    ws.command("Runtime.enable")
    return ws, proc, profile


def read_tokens(ws, base, theme, names):
    ws.command("Page.navigate", {"url": base + "dashboard.html?demo=1&theme=" + theme})
    deadline = time.time() + 20
    while time.time() < deadline:
        r = ws.command("Runtime.evaluate",
                       {"expression": "document.readyState", "returnByValue": True})
        if r.get("result", {}).get("value") == "complete":
            break
        time.sleep(0.1)
    time.sleep(0.3)
    expr = ("(function(){var s=getComputedStyle(document.documentElement);var o={};"
            + "".join("o[%s]=s.getPropertyValue(%s).trim();" % (json.dumps(n), json.dumps(n)) for n in names)
            + "return JSON.stringify(o);})()")
    r = ws.command("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return json.loads(r["result"]["value"])


def main():
    want = snapshot_tokens()
    port = shots.free_port()

    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=ROOT, **k)

        def log_message(self, *a):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d/" % port
    ws, proc, profile = launch()
    try:
        got = {"light": read_tokens(ws, base, "light", list(want)),
               "dark": read_tokens(ws, base, "dark", list(want))}
    finally:
        try:
            ws.close()
        except Exception:
            pass
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)
    mismatches = []
    for name, row in want.items():
        for mode in ("light", "dark"):
            actual = (got[mode].get(name) or "").strip().lower().replace(" ", "")
            expected = row[mode]
            if actual != expected:
                mismatches.append({"token": name, "mode": mode,
                                   "snapshot": expected, "actual": actual})
    out = {"tokens": len(want), "mismatches": mismatches}
    with open(os.path.join(ROOT, "tests", "audit", "results", "theme_tokens.json"),
              "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
