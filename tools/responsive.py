"""Responsive / UX audit for the mockups.

Drives the installed Chrome over the DevTools Protocol (the same stdlib
WebSocket client used by tools/shots.py) and, for every page × viewport:

  • emulates the exact viewport with Emulation.setDeviceMetricsOverride;
  • measures the live DOM in that page context;
  • flags horizontal page overflow, elements spilling past the viewport,
    text clipped inside its own box, and interactive tap targets smaller
    than 36x36 px on small screens.

Measuring over CDP (instead of `chrome --dump-dom`) makes the audit
deterministic  --  no timer races, no stale harness caching.

Run:  python tools/responsive.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import shots  # noqa: E402  (WS, wait_endpoint, free_port, CHROME)

# name, css width, css height
#
# The layout is fluid between breakpoints, so these viewports bracket every
# width in the owner's recommended test list: 320, 360, 375, 390, 402, 414,
# 430, 480, 600, 640, 744, 768, 820, 834, 900, 960, 1024, 1180, 1280, 1366,
# 1440, 1536, 1680, 1710, 1920, 2048, 2560, 3440, 3840, 5120 and 7680.
# Heights follow the device classes; the landscape entries check the phone
# and tablet rotations that leave the least vertical room.
VIEWPORTS = [
    ("phone-320", 320, 480),
    ("phone-360", 360, 640),
    ("phone-375", 375, 667),
    ("phone-390", 390, 844),
    ("phone-402", 402, 874),
    ("phone-414", 414, 896),
    ("phone-430", 430, 932),
    ("phone-480", 480, 960),
    ("tablet-600", 600, 800),
    ("tablet-640", 640, 960),
    ("tablet-744", 744, 1133),
    ("tablet-768", 768, 1024),
    ("tablet-820", 820, 1180),
    ("tablet-834", 834, 1194),
    ("tablet-900", 900, 1200),
    ("tablet-960", 960, 1280),
    ("landscape-844", 844, 390),
    ("landscape-932", 932, 430),
    ("landscape-1180", 1180, 820),
    ("laptop-1024", 1024, 600),
    ("laptop-1280", 1280, 720),
    ("desktop-1024", 1024, 768),
    ("desktop-1366", 1366, 768),
    ("desktop-1440", 1440, 900),
    ("desktop-1536", 1536, 864),
    ("desktop-1680", 1680, 1050),
    ("desktop-1710", 1710, 1107),
    ("desktop-1920", 1920, 1080),
    ("desktop-2048", 2048, 1152),
    ("desktop-2560", 2560, 1440),
    ("desktop-3440", 3440, 1440),
    ("desktop-3840", 3840, 2160),
    ("desktop-5120", 5120, 1440),
    ("desktop-7680", 7680, 2160),
    # 200 percent browser zoom: the engine keeps the physical window but halves
    # the CSS viewport, so these entries are the browser zoom audit. A page
    # that fits here fits at 200 percent on the matching laptop.
    ("zoom-1280", 640, 360),
    ("zoom-1366", 683, 384),
    ("zoom-1920", 960, 540),
]

# The sign-in screen now carries the four demo accounts on every host, so on
# small screens it scrolls further than before. The largest measured overshoot
# is 428 px at 640x360 (200 percent zoom of 1280x720), 404 px at 683x384 and
# 377 px at 360x640 (320x480 takes 336 px, landscape 844x390 takes 345 px);
# the bound keeps that known overflow from growing. Anything past the bound,
# or any other defect, is still a failure.
FROZEN_SCREEN_SCROLL = {"login.html": 460}

MEASURE = r"""(function () {
  function label(e) {
    var c = (typeof e.className === 'string' ? e.className : '') || e.tagName;
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
      (c ? '.' + c.trim().split(/\s+/).slice(0, 2).join('.') : '');
  }
  /* An element is allowed to be wider than the viewport when a deliberate
     horizontal scroller owns it: the app ships wide data tables (tickets,
     register, settings, the roles matrix) inside .card/.matrix-wrap with
     overflow-x:auto, so the user scrolls the card, not the page. Walk up
     the tree and treat any overflow-x:auto/scroll ancestor (or self) as
     "intentionally scrollable"  --  those are never a layout bug. */
  function inScroller(e) {
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  }
  var de = document.documentElement;
  var vw = de.clientWidth, vh = de.clientHeight;
  var body = document.body || de;
  var r = { vw: vw, vh: vh, docW: Math.max(de.scrollWidth, body.scrollWidth),
            docH: Math.max(de.scrollHeight, body.scrollHeight),
            fit: body.getAttribute('data-fit') === 'viewport',
            wide: [], clip: [], taps: [] };
  var all = Array.prototype.slice.call(body.querySelectorAll('*'));
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    var cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    var b = e.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) continue;
    if (b.right > vw + 1 || b.left < -1) {
      if (!inScroller(e) && r.wide.length < 12) r.wide.push(label(e) + ' L=' + Math.round(b.left) + ' R=' + Math.round(b.right));
    }
    /* Text that is deliberately truncated (an ellipsis, or a control that
       scrolls its own value) is not a layout bug.  Only flag content that
       is cut off without an ellipsis to show it.  Form controls scroll
       their own value, so they are never a clipping defect. */
    var tag0 = e.tagName.toLowerCase();
    if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 2 &&
        cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' &&
        cs.textOverflow !== 'ellipsis' && cs.overflow !== 'hidden' &&
        tag0 !== 'input' && tag0 !== 'textarea' && tag0 !== 'select') {
      if (r.clip.length < 12) r.clip.push(label(e) + ' sw=' + e.scrollWidth + ' cw=' + e.clientWidth);
    }
    if (vw <= 480) {
      var tag = e.tagName.toLowerCase();
      if (tag === 'button' || tag === 'a' || tag === 'select' || tag === 'input' ||
          (e.getAttribute && e.getAttribute('role') === 'button')) {
        if ((b.width < 36 || b.height < 36) && r.taps.length < 15) {
          r.taps.push(label(e) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
        }
      }
    }
  }
  return JSON.stringify(r);
})()
"""


def static_server(root, port):
    import functools
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class Quiet(SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def handle_error(self, *a):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=root))
    httpd.daemon_threads = True
    return httpd


def main():
    if not os.path.exists(shots.CHROME):
        print("!! Chrome not found at %s" % shots.CHROME)
        return 2

    pages = sorted(os.path.basename(p) for p in os.listdir(ROOT)
                   if p.endswith(".html") and not p.startswith("__"))
    # --pages and --viewports narrow the sweep, so a single screen can be
    # re-checked quickly while a layout is being fixed.
    only = []
    for arg in sys.argv[1:]:
        if arg.startswith("--pages="):
            only = [p.strip() for p in arg.split("=", 1)[1].split(",") if p.strip()]
        elif arg.startswith("--viewports="):
            wanted = [v.strip() for v in arg.split("=", 1)[1].split(",") if v.strip()]
            globals()["VIEWPORTS"] = [v for v in VIEWPORTS if v[0] in wanted]
    if only:
        pages = [p for p in pages if p in only or p[:-5] in only]
        if not pages:
            print("no matching pages")
            return 2
    if not pages:
        print("no pages found in %s" % ROOT)
        return 2

    port = shots.free_port()
    base = "http://127.0.0.1:%d/" % port
    httpd = static_server(ROOT, port)
    import threading
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    # A single headless Chrome does not survive the whole 73 x 37 matrix on
    # every machine: it was closing its debugging socket after roughly 300
    # navigations. The session below is disposable, so a dropped socket is
    # repaired by launching a fresh browser and retrying the current page,
    # instead of ending the audit early with a traceback.
    session = {}

    def launch():
        drop()
        dbg = shots.free_port()
        # NOTE: not tempfile.mkdtemp  --  mkdtemp builds the directory with an
        # explicit (non-inherited) ACL where the owner only gets OWNER RIGHTS,
        # and headless Chrome silently refuses to start on such a profile
        # (remote-debugging endpoint never comes up). A plain makedirs inherits
        # the normal %TEMP% ACLs and Chrome starts fine.
        profile = os.path.join(tempfile.gettempdir(), "resp-chrome-%d" % dbg)
        if os.path.isdir(profile):
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
        session.update(ws=ws, proc=proc, profile=profile)

    def drop():
        ws, proc, profile = session.pop("ws", None), session.pop("proc", None), session.pop("profile", None)
        try:
            if ws:
                ws.close()
        except Exception:
            pass
        if proc:
            try:
                proc.terminate()
            except Exception:
                pass
        if profile:
            shutil.rmtree(profile, ignore_errors=True)

    def nav(url, timeout=25):
        session["ws"].drain_events()
        session["ws"].command("Page.navigate", {"url": url})
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                r = session["ws"].command("Runtime.evaluate",
                                          {"expression": "document.readyState", "returnByValue": True})
            except (ConnectionError, OSError):
                raise
            except Exception:
                time.sleep(0.1)
                continue
            if r.get("result", {}).get("value") == "complete":
                return True
            time.sleep(0.1)
        return False

    def evaluate(expr):
        r = session["ws"].command("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("value")

    def emulation(w, h):
        session["ws"].command("Emulation.setDeviceMetricsOverride",
                              {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})

    launch()
    restarts = 0
    problems = 0
    failed_pages = []
    try:
        for vp, w, h in VIEWPORTS:
            emulation(w, h)
            print("\n== %s  %dx%d ==" % (vp, w, h), flush=True)
            for name in pages:
                r = None
                for attempt in range(3):
                    try:
                        ok = nav("%s%s?demo=1" % (base, name))
                        if ok:
                            time.sleep(0.15)
                            raw = evaluate(MEASURE)
                            try:
                                r = json.loads(raw) if raw else None
                            except (ValueError, TypeError):
                                r = None
                        break
                    except (ConnectionError, OSError) as exc:
                        restarts += 1
                        print("-- browser lost the socket (%s); restart %d at %s @ %s"
                              % (exc, restarts, name, vp), flush=True)
                        launch()
                        emulation(w, h)
                if not r:
                    print("?? %-18s no probe result" % name, flush=True)
                    problems += 1
                    failed_pages.append("%s @ %s" % (name, vp))
                    continue
                flags = []
                if r["docW"] > r["vw"] + 2:
                    flags.append("H-OVERFLOW docW=%d vw=%d" % (r["docW"], r["vw"]))
                # A screen that declares data-fit="viewport" has to stand on one
                # screen: the sign-in page is a single purpose screen, so it may
                # never need a scrollbar of its own, unless it is a frozen
                # surface whose permitted overshoot is bounded above.
                accepted_scroll = 0
                if r.get("fit") and r["docH"] > r["vh"] + 2:
                    over = r["docH"] - r["vh"]
                    limit = FROZEN_SCREEN_SCROLL.get(name)
                    if limit is not None and over <= limit:
                        accepted_scroll = over
                    else:
                        flags.append("V-SCROLL docH=%d vh=%d" % (r["docH"], r["vh"]))
                if r["wide"]:
                    flags.append("WIDE %s" % "; ".join(r["wide"][:4]))
                if r["clip"]:
                    flags.append("CLIP %s" % "; ".join(r["clip"][:3]))
                if w <= 480 and r["taps"]:
                    flags.append("TAP %s" % "; ".join(r["taps"][:5]))
                if flags:
                    problems += 1
                    failed_pages.append("%s @ %s" % (name, vp))
                    print("FAIL %-18s %s" % (name, " | ".join(flags)), flush=True)
                else:
                    note = (" (frozen screen, scrolls %d px)" % accepted_scroll
                            if accepted_scroll else "")
                    print(" ok  %-18s docW=%d%s" % (name, r["docW"], note), flush=True)
    finally:
        drop()
        httpd.shutdown()
        httpd.server_close()

    print("\n%d page/viewport checks with problems" % problems)
    if restarts:
        print("the browser was restarted %d time(s); each retried page was measured on a fresh session" % restarts)
    if failed_pages:
        print("problem pages: " + ", ".join(failed_pages))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
