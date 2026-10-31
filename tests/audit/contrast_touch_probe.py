"""Contrast and touch-target probe (audit only).

Renders the primary screens from a static copy (no server data) in light and
dark at 1440 and 390 px, then evaluates:

  * text contrast for every visible element with direct text (WCAG 2.x ratio),
    skipping elements whose effective background is an image or gradient;
  * touch targets smaller than 44 x 44 CSS px at 390 px.

The phone views are measured with touch emulation switched on, because
`pointer:coarse` is what the sheets key the enlarged tap targets on and a
desktop pointer at 390 px would measure a device nobody holds. The 1440 views
stay on the fine pointer.

Prints a JSON summary and writes tests/audit/results/contrast_touch.json.

Run:  python tests/audit/contrast_touch_probe.py
"""
import json
import os
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

PAGES = [
    "or-dashboard.html", "or-tickets.html", "or-ticket.html?id=IT-2026-000142",
    "itc-dashboard.html", "itc-technician.html", "itc-ticket.html?id=IT-2026-000142",
    "ic-dashboard.html", "ic-tickets.html", "ic-ticket.html?id=IT-2026-000142",
    "mgmt-users.html", "mgmt-offices.html", "mgmt-audit.html",
    "login.html",
]
VIEWS = [("1440-light", 1440, 900, "light"), ("1440-dark", 1440, 900, "dark"),
         ("390-light", 390, 844, "light"), ("390-dark", 390, 844, "dark")]

CONTRAST_JS = r"""
(function(){
  function parse(c){
    var m=/rgba?\(([^)]+)\)/.exec(c||''); if(!m) return null;
    var p=m[1].split(',').map(function(x){return parseFloat(x);});
    return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};
  }
  function blend(fg,bg){
    var a=fg.a; return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a),a:1};
  }
  function lum(c){
    function f(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);
  }
  function ratio(a,b){var l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
  function bgOf(el){
    var cur=el, layers=[];
    while(cur && cur.nodeType===1){
      var cs=getComputedStyle(cur);
      if(cs.backgroundImage && cs.backgroundImage!=='none') return {unknown:true};
      var c=parse(cs.backgroundColor);
      if(c && c.a>0){
        layers.push(c);
        if(c.a>=0.999) break;
      }
      cur=cur.parentElement;
    }
    var base={r:255,g:255,b:255,a:1};
    for(var i=layers.length-1;i>=0;i--) base=blend(layers[i],base);
    return base;
  }
  function visible(el){
    var cs=getComputedStyle(el); var r=el.getBoundingClientRect();
    if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) return false;
    if(r.width<1||r.height<1) return false;
    return true;
  }
  var out={min:99,checked:0,unknown:0,worst:[]};
  var els=document.body.querySelectorAll('*');
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(/^(SCRIPT|STYLE|NOSCRIPT|SVG|PATH|OPTION|TITLE|META|LINK)$/.test(el.tagName)) continue;
    var own='';
    for(var n=0;n<el.childNodes.length;n++){
      var cn=el.childNodes[n];
      if(cn.nodeType===3) own+=cn.nodeValue;
    }
    if(!own.trim()) continue;
    if(!visible(el)) continue;
    var cs=getComputedStyle(el);
    var fg=parse(cs.color); if(!fg) continue;
    var bg=bgOf(el);
    if(bg.unknown){out.unknown++;continue;}
    if(fg.a<1) fg=blend(fg,bg);
    var cr=ratio(fg,bg);
    var size=parseFloat(cs.fontSize)||16; var weight=parseInt(cs.fontWeight,10)||400;
    var large=size>=24 || (size>=18.66 && weight>=700);
    var need=large?3:4.5;
    out.checked++;
    if(cr<out.min) out.min=cr;
    if(cr<need && out.worst.length<25){
      out.worst.push({tag:el.tagName.toLowerCase(),cls:(el.className||'').toString().slice(0,60),
        text:own.trim().replace(/\s+/g,' ').slice(0,60),ratio:Math.round(cr*100)/100,need:need,
        color:cs.color,bg:'rgb('+Math.round(bg.r)+','+Math.round(bg.g)+','+Math.round(bg.b)+')'});
    }
  }
  out.min=Math.round(out.min*100)/100;
  return JSON.stringify(out);
})()
"""

TOUCH_JS = r"""
(function(){
  var out={checked:0,small:[]};
  var els=document.body.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[data-theme-set]');
  for(var i=0;i<els.length;i++){
    var el=els[i]; var cs=getComputedStyle(el); var r=el.getBoundingClientRect();
    if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) continue;
    if(r.width<1||r.height<1) continue;
    if(el.closest('.side-link')||el.closest('.bottomnav')||el.closest('main')||el.closest('.topbar')||el.closest('.appbar')){
      out.checked++;
      if((r.width<44||r.height<44) && out.small.length<25){
        out.small.push({tag:el.tagName.toLowerCase(),cls:(el.className||'').toString().slice(0,50),
          text:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,40),
          w:Math.round(r.width),h:Math.round(r.height)});
      }
    }
  }
  return JSON.stringify(out);
})()
"""


def make_server(port):
    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=ROOT, **k)

        def log_message(self, *a):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    port = shots.free_port()
    make_server(port)
    base = "http://127.0.0.1:%d/" % port
    dbg = shots.free_port()
    profile = os.path.join(tempfile.gettempdir(), "contrast-chrome-%d" % dbg)
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
    results = {}
    try:
        for name, w, h, theme in VIEWS:
            ws.command("Emulation.setDeviceMetricsOverride",
                       {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": w <= 480})
            ws.command("Emulation.setTouchEmulationEnabled",
                       {"enabled": w <= 480, "maxTouchPoints": 5 if w <= 480 else 1})
            for page in PAGES:
                url = "%s%s?demo=1&theme=%s" % (base, page, theme)
                ws.command("Page.navigate", {"url": url})
                deadline = time.time() + 20
                while time.time() < deadline:
                    r = ws.command("Runtime.evaluate",
                                   {"expression": "document.readyState", "returnByValue": True})
                    if r.get("result", {}).get("value") == "complete":
                        break
                    time.sleep(0.1)
                time.sleep(0.5)
                key = "%s|%s" % (name, page.split("?")[0])
                try:
                    c = ws.command("Runtime.evaluate",
                                   {"expression": CONTRAST_JS, "returnByValue": True})
                    t = ws.command("Runtime.evaluate",
                                   {"expression": TOUCH_JS, "returnByValue": True})
                    results[key] = {"contrast": json.loads(c["result"]["value"]),
                                    "touch": json.loads(t["result"]["value"])}
                except Exception as exc:  # noqa: BLE001
                    results[key] = {"error": str(exc)}
    finally:
        try:
            ws.close()
        except Exception:
            pass
        proc.terminate()
        shutil.rmtree(profile, ignore_errors=True)
    out = os.path.join(ROOT, "tests", "audit", "results", "contrast_touch.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=1)
    bad = {k: v for k, v in results.items()
           if v.get("contrast", {}).get("worst") or (v.get("touch", {}).get("small") and "390" in k)}
    print(json.dumps({"screens": len(results), "with_findings": len(bad),
                      "findings": bad}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
