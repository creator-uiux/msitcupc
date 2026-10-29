"""Throwaway viewport screenshot with a real demo session.

    python tools/_shot.py <page> <width> <height> <out.png> [scrollY] [role]
"""
import base64
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


def role_of(page, fallback="technician"):
    prefix = page.split("-")[0] if "-" in page else ""
    return ROLE_FOR_PREFIX.get(prefix, fallback)


def main():
    page, width, height, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    scroll = int(sys.argv[5]) if len(sys.argv) > 5 else 0
    role = sys.argv[6] if len(sys.argv) > 6 else role_of(page)
    sess = login(role)
    port = shots.free_port()
    chrome = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--remote-debugging-port=%d" % port,
         "--user-data-dir=%s" % os.path.join(os.environ.get("TEMP", "."),
                                            "itc-shot-%d" % port),
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
            time.sleep(1.5)
            ws.command("Runtime.evaluate", {"expression": "sessionStorage.setItem('itc_session', %s)" % json.dumps(sess)})
            ws.command("Page.navigate", {"url": "http://127.0.0.1:8787/%s?demo=1" % page})
            time.sleep(5.0)
            if scroll:
                ws.command("Runtime.evaluate", {"expression": "window.scrollTo(0,%d)" % scroll})
                time.sleep(0.5)
            res = ws.command("Page.captureScreenshot",
                             {"format": "png", "captureBeyondViewport": False}, timeout=60)
            with open(out, "wb") as f:
                f.write(base64.b64decode(res["data"]))
            print("saved", out)
        finally:
            ws.close()
    finally:
        chrome.terminate()


if __name__ == "__main__":
    main()
