"""Capture the mockups as PNG frames for Figma  --  one per page per viewport.

Zero dependencies: drives the installed Chrome over the DevTools Protocol
(WebSocket implemented with the stdlib) and captures FULL-PAGE screenshots at
1x device scale so the frames import crisply.

Every capture loads the page with ?demo=1, which (see js/store.js) rebuilds the
canonical seed, freezes the clock and disables the random intake simulation, so
the PNGs are deterministic and identical on every run.

Run:  python tools/shots.py                 # all pages, all 6 viewports
      python tools/shots.py --only dashboard.html reports.html
      python tools/shots.py --viewports desktop mobile
"""
import argparse
import base64
import glob
import json
import os
import socket
import struct
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(ROOT, "shots")

# name, css width, css height  (stable design targets)
# colour theme for the capture ("" = the saved preference)
THEME = ""

VIEWPORTS = [    ("desktop", 1440, 900),
    ("wide", 1280, 800),
    ("laptop", 1024, 768),
    ("tablet", 768, 1024),
    ("mobile", 390, 844),
    ("small", 320, 720),
]
PAGES = ["index.html", "login.html", "roles.html", "dashboard.html", "ticket.html", "request.html",
         "review.html", "technician.html", "maintenance.html", "confirm.html", "reports.html", "flow.html",
         "tickets.html", "register.html", "notifications.html", "audit.html",
         "users.html", "offices.html", "settings.html", "profile.html"]


# ------------------------------------------------------------------ websocket
class WS:
    """Minimal RFC6455 client  --  only what the DevTools endpoint needs."""

    def __init__(self, url):
        from urllib.parse import urlparse
        u = urlparse(url)
        self.sock = socket.create_connection((u.hostname, u.port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path + ("?" + u.query if u.query else "")
        req = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n" % (path, u.hostname, u.port, key))
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.events = []          # queued notifications (id-less messages)

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("socket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _recv_frame(self):
        b1, b2 = self._recv_exact(2)
        fin, opcode = b1 & 0x80, b1 & 0x0F
        masked, length = b2 & 0x80, b2 & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else None
        data = self._recv_exact(length)
        if mask:
            data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
        if opcode == 0x9:            # ping -> pong
            self._send_frame(0xA, data)
            return self._recv_frame()
        if opcode == 0x8:
            raise ConnectionError("websocket closed by peer")
        return data

    def _send_frame(self, opcode, payload):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def send(self, obj):
        self._send_frame(0x1, json.dumps(obj).encode())

    def recv(self):
        data = self._recv_frame()
        if data == b"":
            return self.recv()
        return json.loads(data)

    def command(self, method, params=None, timeout=30):
        """Send a command and pump the socket until its response arrives."""
        self._id = getattr(self, "_id", 0) + 1
        mid = self._id
        self.send({"id": mid, "method": method, "params": params or {}})
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self.recv()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s -> %s" % (method, msg["error"]))
                return msg.get("result", {})
            if "method" in msg:
                self.events.append(msg)
        raise TimeoutError(method)

    def drain_events(self, method=None):
        out = []
        for e in self.events:
            if method is None or e.get("method") == method:
                out.append(e)
        self.events = []
        return out

    def close(self):
        try:
            self._send_frame(0x8, b"")
            self.sock.close()
        except Exception:
            pass


# ------------------------------------------------------------------ chrome
def wait_endpoint(port, timeout=20):
    """Return the webSocketDebuggerUrl of a *page* target (not the browser)."""
    list_url = "http://127.0.0.1:%d/json/list" % port
    ver_url = "http://127.0.0.1:%d/json/version" % port
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(ver_url, timeout=1).read()
        except Exception:
            time.sleep(0.25)
            continue
        try:
            with urllib.request.urlopen(list_url, timeout=1) as r:
                targets = json.loads(r.read())
            for t in targets:
                if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                    return t["webSocketDebuggerUrl"]
            # no page yet  --  open one
            urllib.request.urlopen("http://127.0.0.1:%d/json/new?about:blank" % port,
                                   timeout=2).read()
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError("Chrome DevTools endpoint never came up on :%d" % port)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ------------------------------------------------------------------ capture
def capture(ws, name, w, h, full=False):
    """Navigate the current tab to :name at w*h and return (png, css_height).

    By default the frame is exactly the design canvas (w*h)  --  the size the
    README targets for Figma. With full=True the whole scroll height is
    captured instead.
    """
    url = BASE + name + ("&" if "?" in name else "?") + "demo=1"
    if THEME:
        url += "&theme=" + THEME
    ws.drain_events()
    ws.command("Emulation.setDeviceMetricsOverride",
               {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": w <= 480})
    ws.command("Page.navigate", {"url": url})

    # wait for load + settle (live.js renders synchronously on load)
    deadline = time.time() + 20
    while time.time() < deadline:
        r = ws.command("Runtime.evaluate",
                       {"expression": "document.readyState", "returnByValue": True})
        if r.get("result", {}).get("value") == "complete":
            break
        time.sleep(0.1)
    # freeze CSS animations/transitions so the pulsing live-dot etc. render at a
    # deterministic frame (otherwise captures differ by a few anti-aliased px)
    ws.command("Runtime.evaluate", {
        "expression": ("(function(){var s=document.createElement('style');"
                       "s.textContent='*,*::before,*::after{animation:none!important;"
                       "transition:none!important;caret-color:transparent!important}"
                       ".live-dot{box-shadow:none!important;animation:none!important}';"
                       "document.head.appendChild(s);"
                       "window.scrollTo(0,0);void document.body.offsetHeight;})()")})
    time.sleep(0.7)

    errors = []
    for e in ws.drain_events("Runtime.exceptionThrown"):
        d = e["params"].get("exceptionDetails", {})
        errors.append(d.get("exception", {}).get("description") or d.get("text", "error"))

    r = ws.command("Runtime.evaluate", {
        "expression": "Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)",
        "returnByValue": True})
    css_h = int(r.get("result", {}).get("value") or h)

    shot = ws.command("Page.captureScreenshot",
                      {"format": "png", "fromSurface": True,
                       "captureBeyondViewport": bool(full)}, timeout=60)
    png = base64.b64decode(shot["data"])

    if os.environ.get("SHOTS_DEBUG"):
        dom = ws.command("Runtime.evaluate",
                         {"expression": "document.documentElement.outerHTML",
                          "returnByValue": True})
        dh = __import__("hashlib").sha256(dom["result"]["value"].encode("utf-8")).hexdigest()
        sys.stderr.write("[debug] %s %s domsha=%s\n" % (name, w, dh[:16]))
    return png, css_h, errors


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return (0, 0)
    w, h = struct.unpack(">II", data[16:24])
    return (w, h)


def contact_sheet(entries):
    """Build shots/index.html  --  a simple review gallery."""
    def card(e):
        tag = "full" if e["file"].endswith("-full.png") else "canvas"
        return ('  <figure><img src="%s" loading="lazy" alt="%s">'
                '<figcaption>%s <span>%s</span></figcaption></figure>'
                % (e["file"], e["label"], e["label"], tag))
    cards = "\n".join(card(e) for e in entries)
    html = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>ITC Maintenance System  --  exported frames</title>
<style>
body{font-family:Inter,'Segoe UI',system-ui,sans-serif;background:#eef1f7;margin:0;padding:32px;color:#0f172a}
h1{font-size:24px;margin:0 0 4px}p.lead{color:#64748b;margin:0 0 26px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
figure{background:#fff;border:1px solid #e5e9f2;border-radius:14px;overflow:hidden;margin:0;box-shadow:0 1px 3px rgba(15,23,42,.07)}
figure img{display:block;width:100%;background:#f8fafc;border-bottom:1px solid #eef1f7}
figcaption{padding:9px 12px;font-size:12.5px;font-weight:650;color:#475569;display:flex;justify-content:space-between;gap:8px}
figcaption span{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#014421}
</style></head><body>
<h1>ITC Maintenance System  --  exported frames</h1>
<p class="lead">__N__ PNG frames · deterministic demo data (?demo=1) · 1x scale  --  ready for Figma</p>
<div class="grid">
__CARDS__
</div></body></html>"""
    html = html.replace("__N__", str(len(entries))).replace("__CARDS__", cards)
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)


BASE = None
PORT = None
DBG_PORT = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=PAGES)
    ap.add_argument("--viewports", nargs="*", default=[v[0] for v in VIEWPORTS])
    ap.add_argument("--theme", default="", choices=["", "light", "dark"],
                    help="capture in a specific colour theme (default: the saved one)")
    ap.add_argument("--full", action="store_true",
                    help="capture the whole scroll height instead of the design canvas")
    ap.add_argument("--both", action="store_true",
                    help="emit both the design canvas and the full-page frame")
    args = ap.parse_args()

    global BASE, PORT, DBG_PORT
    global THEME
    THEME = args.theme
    os.makedirs(OUT, exist_ok=True)
    PORT = free_port()
    DBG_PORT = free_port()
    BASE = "http://127.0.0.1:%d/" % PORT

    if not os.path.exists(CHROME):
        print("!! Chrome not found at %s" % CHROME)
        return 2

    # --only accepts any page file in the repository, so a role page
    # (or-dashboard.html, mgmt-users.html ...) can be captured too.
    if args.only:
        pages = [p if p.endswith(".html") else p + ".html" for p in args.only]
        missing = [p for p in pages if not os.path.isfile(os.path.join(ROOT, p))]
        if missing:
            print("!! no such page: %s" % ", ".join(missing))
            return 2
    else:
        pages = list(PAGES)
    vps = [v for v in VIEWPORTS if v[0] in args.viewports]

    # The threaded, no-store server from tools/serve.py.  The single threaded
    # http.server queues the parallel script requests, and it lets the
    # browser cache a stylesheet, so a capture could show a page that is not
    # the one on disk.
    server = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "serve.py"),
                                str(PORT), ROOT], cwd=ROOT,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # wait for the server
    for _ in range(40):
        try:
            urllib.request.urlopen(BASE + "index.html", timeout=1).read(1)
            break
        except Exception:
            time.sleep(0.2)

    udd = os.path.join(os.environ.get("TEMP", ROOT), "shots_chrome_%d" % DBG_PORT)
    chrome = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--force-color-profile=srgb", "--disable-lcd-text",
         "--disable-gpu-compositing", "--disable-partial-raster",
         "--disable-skia-runtime-opts", "--disable-features=PaintHolding",
         "--remote-debugging-port=%d" % DBG_PORT,
         "--user-data-dir=" + udd, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    ws_url = wait_endpoint(DBG_PORT)
    ws = WS(ws_url)
    ws.command("Page.enable")
    ws.command("Runtime.enable")

    entries, problems = [], 0
    modes = []
    if args.both:
        modes = [(False, ""), (True, "-full")]
    else:
        modes = [(args.full, "-full" if args.full else "")]
    try:
        for page in pages:
            for vp, w, h in vps:
                for full, suffix in modes:
                    stem = "%s--%s%s" % (page.rsplit(".", 1)[0], vp, suffix)
                    try:
                        png, css_h, errors = capture(ws, page, w, h, full=full)
                    except Exception as exc:
                        print("FAIL %-26s %s" % (stem, exc))
                        problems += 1
                        continue
                    with open(os.path.join(OUT, stem + ".png"), "wb") as f:
                        f.write(png)
                    iw, ih = png_size(png)
                    note = ""
                    if iw != w or (not full and ih != h):
                        note += " size=%dx%d(!=%dx%d)" % (iw, ih, w, h)
                        problems += 1
                    if errors:
                        note += " JS-ERRORS=%d" % len(errors)
                        problems += 1
                    canvas = "canvas" if not full else "full-page"
                    clipped = ""
                    if not full and css_h > h:
                        clipped = " | page is %dpx (clipped)" % css_h
                    print(" ok  %-30s %4dx%-6d %s%s%s"
                          % (stem, iw, ih, canvas, clipped, note))
                    entries.append({"file": stem + ".png", "label": stem,
                                    "page": page, "vp": vp})
    finally:
        ws.close()
        try:
            chrome.terminate()
        except Exception:
            pass
        server.terminate()

    contact_sheet(entries)
    print("\n%d frames -> shots/  (%d problems)" % (len(entries), problems))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
