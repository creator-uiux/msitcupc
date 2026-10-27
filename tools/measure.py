"""Measure one element in a real browser at a given viewport width.

    python tools/measure.py <url> <width> <selector> [selector ...]
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import shots  # noqa: E402


def main():
    if len(sys.argv) < 4:
        print("usage: measure.py <url> <width> <selector> [selector ...]")
        return 2
    url = sys.argv[1]
    width = int(sys.argv[2])
    sels = sys.argv[3:]
    port = shots.free_port()
    chrome = subprocess.Popen(
        [shots.CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
         "--hide-scrollbars", "--force-device-scale-factor=1",
         "--remote-debugging-port=%d" % port,
         "--user-data-dir=%s" % os.path.join(os.environ.get("TEMP", "."),
                                            "itc-measure-%d" % port),
         "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws = shots.WS(shots.wait_endpoint(port))
        try:
            ws.command("Page.enable")
            ws.command("Runtime.enable")
            ws.command("Emulation.setDeviceMetricsOverride",
                       {"width": width, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            ws.command("Page.navigate", {"url": url})
            time.sleep(3.5)
            js = """
              (function () {
                var out = { vw: document.documentElement.clientWidth,
                            docW: Math.max(document.documentElement.scrollWidth,
                                           document.body.scrollWidth), items: [] };
                %s
                return JSON.stringify(out);
              })()
            """ % "".join(
                "['%s'].forEach(function (s) { var e = document.querySelector(s);"
                " if (e) { var b = e.getBoundingClientRect();"
                " out.items.push({ sel: s, l: Math.round(b.left), r: Math.round(b.right),"
                " w: Math.round(b.width) }); } });" % sel for sel in sels)
            res = ws.command("Runtime.evaluate", {"expression": js, "returnByValue": True})
            print((res.get("result") or {}).get("value"))
        finally:
            ws.close()
    finally:
        chrome.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
