"""Throwaway audit: page height and card geometry per page / viewport.

    python tools/_space_audit.py <width> <height> <page> [...] [--role ROLE]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import shots  # noqa: E402

ROLE_FOR_PREFIX = {"itc": "technician", "ic": "coordinator", "mgmt": "management", "or": "requester"}


def login(role):
    req = urllib.request.Request(
        "http://127.0.0.1:8787/api/login",
        data=json.dumps({"role": role}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        res = json.loads(r.read().decode())
    return json.dumps({"token": res["token"], "user": res["user"]})


def role_of(page, fallback="coordinator"):
    prefix = page.split("-")[0] if "-" in page else ""
    return ROLE_FOR_PREFIX.get(prefix, fallback)


def measure(page, width, height, role):
    port = shots.free_port()
    chrome = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--remote-debugging-port=%d" % port,
         "--user-data-dir=%s" % os.path.join(os.environ.get("TEMP", "."),
                                            "itc-audit-%d" % port),
         "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = shots.WS(shots.wait_endpoint(port))
        try:
            ws.command("Page.enable")
            ws.command("Runtime.enable")
            ws.command("Emulation.setDeviceMetricsOverride",
                       {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
            ws.command("Page.navigate", {"url": "http://127.0.0.1:8787/404.html"})
            time.sleep(1.2)
            ws.command("Runtime.evaluate", {"expression": "sessionStorage.setItem('itc_session', %s)" % json.dumps(login(role))})
            ws.command("Page.navigate", {"url": "http://127.0.0.1:8787/%s?demo=1" % page})
            time.sleep(5.0)
            js = """
              (function () {
                var vh = window.innerHeight, vw = window.innerWidth;
                var out = { page: %s, vw: vw, vh: vh,
                            docH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                            docW: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
                            jobs: [], jobItems: [], cards: [] };
                var jc = document.querySelectorAll('.job-card');
                for (var k = 0; k < jc.length; k++) {
                  var b = jc[k].getBoundingClientRect();
                  out.jobs.push({ h: Math.round(b.height), w: Math.round(b.width) });
                  if (k === 0) {
                    var it = jc[k].querySelectorAll('.chk-card');
                    for (var m = 0; m < it.length && m < 6; m++) {
                      out.jobItems.push(Math.round(it[m].getBoundingClientRect().height));
                    }
                  }
                }
                var all = document.querySelectorAll('.content .card');
                for (var i = 0; i < all.length && i < 80; i++) {
                  var c = all[i];
                  var r = c.getBoundingClientRect();
                  var h = c.querySelector('h3, h2');
                  out.cards.push({ t: h ? h.textContent.trim().slice(0, 30) : '',
                                   top: Math.round(r.top + window.scrollY),
                                   h: Math.round(r.height),
                                   w: Math.round(r.width),
                                   sw: c.scrollWidth, cw: c.clientWidth,
                                   sh: c.scrollHeight, ch: c.clientHeight });
                }
                return JSON.stringify(out);
              })()
            """ % json.dumps(page)
            res = ws.command("Runtime.evaluate", {"expression": js, "returnByValue": True})
            return json.loads((res.get("result") or {}).get("value") or "{}")
        finally:
            ws.close()
    finally:
        chrome.terminate()


if __name__ == "__main__":
    args = sys.argv[1:]
    role_arg = None
    if "--role" in args:
        i = args.index("--role")
        role_arg = args[i + 1]
        args = args[:i] + args[i + 2:]
    width, height = int(args[0]), int(args[1])
    for page in args[2:]:
        role = role_arg or role_of(page)
        d = measure(page, width, height, role)
        print("== %s  docH=%s vh=%s (scroll %+d) docW=%s" % (
            page, d.get("docH"), d.get("vh"), (d.get("docH") or 0) - (d.get("vh") or 0), d.get("docW")))
        print("   jobs=%d  sample=%s  items=%s" % (
            len(d.get("jobs", [])), d.get("jobs", [])[:3], d.get("jobItems")))
        for c in d.get("cards", []):
            flag = "  OVERFLOW" if c["sw"] > c["cw"] or c["sh"] > c["ch"] + 1 else ""
            print("   card %-30s top=%-5s h=%-4s w=%-4s sh/ch=%s/%s sw/cw=%s/%s%s" % (
                c["t"], c["top"], c["h"], c["w"], c["sh"], c["ch"], c["sw"], c["cw"], flag))
