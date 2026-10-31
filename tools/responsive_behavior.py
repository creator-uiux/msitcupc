"""Row 58: the primary screens driven in a real browser at three widths.

tools/responsive.py measures every page at 37 widths and reports overflow,
clipped text and small tap targets.  Measurement is not behavior, so this tool
drives the screens a person actually works on in headless Chrome at the three
classes the owner tests (phone 390, tablet 768, desktop 1440) and asks whether
the controls still answer:

  - does the register pick the layout its width asks for, does a search cut it,
    does a header sort it, does the column picker really take a column out of
    the laid-out table;
  - does a record link move the reader into the record of the same lane;
  - does a record tab switch, does choosing a next step open the screen that
    records it, does that screen's control open a dialog that takes the entry
    and close it again without saving, does an attachment open in place and
    close again;
  - does the intake form take what is typed and reach its success panel;
  - does the activity chart draw, and on a phone does the tab bar answer.

The clicks go through the elements themselves, so the audit exercises the same
handlers a finger or a mouse meets.  The cascade is read back with
getComputedStyle, which is what a jsdom harness cannot do.

Run:  python tools/responsive_behavior.py
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

import shots                 # noqa: E402  (WS, wait_endpoint, free_port, CHROME)
from responsive import static_server  # noqa: E402

# Width, height and the tap floor this width is held to with the pointer the
# emulation actually uses (a fine pointer, not a finger).  css/app.css:1927
# raises targets to 36 px at or below 480 px; above that the documented floor is
# WCAG 2.5.8's 24 px, because desktop density is deliberately unchanged.  The 44
# px touch minimum is measured under real touch emulation by
# tests/audit/contrast_touch_probe.py, not here.
WIDTHS = [("phone-390", 390, 844, 36), ("tablet-768", 768, 1024, 24),
          ("desktop-1440", 1440, 900, 24)]

# Every template takes a JSON-quoted selector, so a caller passes a plain Python
# string and cannot leave a quote half written.
BOX = ("(function(){var e=document.querySelector(%s);if(!e)return JSON.stringify(__GONE__);"
       "var b=e.getBoundingClientRect(),c=getComputedStyle(e);"
       "return JSON.stringify({missing:0,x:b.x,y:b.y,w:b.width,h:b.height,r:b.right,"
       "bottom:b.bottom,display:c.display,visibility:c.visibility,"
       "text:(e.innerText||'').trim().slice(0,46)});})()")
COUNT = "(function(){return document.querySelectorAll(%s).length;})()"
CLICK = ("(function(){var e=document.querySelector(%s);if(!e)return 'missing';"
         "e.click();return 'clicked';})()")
TYPE = ("(function(){var e=document.querySelector(%s);if(!e)return 'missing';"
        "e.focus();e.value=%s;e.dispatchEvent(new Event('input',{bubbles:true}));"
        "e.dispatchEvent(new Event('change',{bubbles:true}));return 'typed';})()")
READ = "(function(){var e=document.querySelector(%s);return e?String(e.value):'missing';})()"
TEXT = ("(function(){var e=document.querySelector(%s);return e?"
        "(e.innerText||e.textContent||'').trim().slice(0,60):'missing';})()")
ATTR = "(function(){var e=document.querySelector(%s);return e?String(e.getAttribute(%s)):'missing';})()"
OVERFLOW = ("(function(){return JSON.stringify({scroll:document.documentElement.scrollWidth,"
            "view:window.innerWidth});})()")
# The shape a caller gets when a selector matches nothing, so asking for a size
# or a display never raises: an absent control measures as zero.
GONE = {"missing": 1, "x": -1, "y": -1, "w": 0, "h": 0, "r": -1, "bottom": -1,
        "display": "none", "visibility": "hidden", "text": ""}


def main():
    if not os.path.exists(shots.CHROME):
        print("!! Chrome not found at %s" % shots.CHROME)
        return 2

    port = shots.free_port()
    base = "http://127.0.0.1:%d/" % port
    httpd = static_server(ROOT, port)
    import threading
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    dbg = shots.free_port()
    profile = os.path.join(tempfile.gettempdir(), "behave-chrome-%d" % dbg)
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

    state = {"view": (0, 0)}

    def size(w, h):
        state["view"] = (w, h)
        ws.command("Emulation.setDeviceMetricsOverride",
                   {"width": w, "height": h, "deviceScaleFactor": 1, "mobile": False})

    def ev(expr):
        r = ws.command("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return r.get("result", {}).get("value")

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

    problems = []
    checks = []

    def check(label, cond, detail=""):
        checks.append(label)
        if cond:
            print(" ok  %-58s %s" % (label, detail), flush=True)
        else:
            problems.append(label + (" -> " + detail if detail else ""))
            print(" FAIL %-57s %s" % (label, detail), flush=True)

    def box(sel):
        raw = ev(BOX.replace("__GONE__", json.dumps(GONE)) % json.dumps(sel))
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return dict(GONE)

    def count(sel):
        return ev(COUNT % json.dumps(sel)) or 0

    def click(sel):
        return ev(CLICK % json.dumps(sel))

    def type_in(sel, value):
        return ev(TYPE % (json.dumps(sel), json.dumps(value)))

    def read(sel):
        return ev(READ % json.dumps(sel))

    def text(sel):
        return ev(TEXT % json.dumps(sel))

    def attr(sel, name):
        return ev(ATTR % (json.dumps(sel), json.dumps(name)))

    def fits(b):
        w, _h = state["view"]
        return not b.get("missing") and b["x"] >= -1 and b["r"] <= w + 1 and \
            b["w"] > 0 and b["h"] > 0

    def tap_ok(b, floor):
        return not b.get("missing") and b["h"] >= floor

    def no_overflow(label):
        try:
            o = json.loads(ev(OVERFLOW))
        except (TypeError, ValueError):
            o = {"scroll": 99999, "view": 0}
        check(label + ": no horizontal overflow",
              o["scroll"] <= o["view"] + 1,
              "scroll %s in %s" % (o["scroll"], o["view"]))

    for name, w, h, floor in WIDTHS:
        print("\n== %s (%d x %d, tap floor %d px) ==" % (name, w, h, floor), flush=True)
        size(w, h)
        layout = "cards" if w < 600 else "list"

        # A signed-in session, written the way the app writes it.  The frozen
        # sign-in page carries no app shell, so the session is opened from a
        # screen that does and then navigated, as a link into that screen would
        # be.  No demo flag: the storage write is what makes the session real.
        nav(base + "ic-dashboard.html")
        ev("UI.signIn('coordinator')")
        role = ev("UI.roleKey()")
        check("%s: the coordinator session opens" % name, role == "coordinator", str(role))

        # ---------------- the register ----------------
        # The register chooses its layout from the width it is drawn in: cards on
        # a phone, the laid-out table from a tablet up.  Nothing is asked for in
        # the address, so this measures the choice the app makes for itself.
        nav(base + "ic-tickets.html?queue=all")
        row_sel = "#tkBody tr" if layout == "list" else "#tkCards .wo-card"
        rows = count(row_sel)
        shown = json.loads(ev("(function(){return JSON.stringify({"
                              "table:!document.getElementById('tkTable').hidden,"
                              "cards:!document.getElementById('tkCards').hidden});})()"))
        check("%s: the register puts its width's own layout in front" % name,
              rows > 0 and shown["table"] == (layout == "list") and
              shown["cards"] == (layout == "cards"),
              "%s records in the %s layout" % (rows, layout))
        total = text("#tkTotal")
        check("%s: the register counts what it holds" % name,
              total != "missing" and " of " in total, repr(total))

        before = rows
        type_in("#tkQ", "printer")
        time.sleep(0.9)
        after = count(row_sel)
        check("%s: a search cuts the register" % name, after < before or after == 0,
              "%s rows for 'printer', was %s" % (after, before))
        type_in("#tkQ", "")
        time.sleep(0.9)

        link = attr("#tkBody .t-link" if layout == "list" else "#tkCards .wo-card", "href")
        check("%s: a record link is offered and stays in this lane" % name,
              link != "missing" and str(link).startswith("ic-ticket.html?id="), str(link))
        no_overflow("%s register" % name)

        if layout == "list":
            check("%s: the table is the laid-out list" % name,
                  box("#tkTable")["display"] != "none", box("#tkTable")["display"])

            # the headers sort, measured on the laid-out table
            head = '#tkTable th[data-sort-key="id"]'
            ids_of = ("(function(){return JSON.stringify(Array.prototype.slice.call("
                      "document.querySelectorAll('#tkBody .t-id')).map(function(c){"
                      "return c.innerText.trim();}));})()")
            click(head)
            first = attr(head, "aria-sort")
            down = json.loads(ev(ids_of))
            click(head)
            second = attr(head, "aria-sort")
            up = json.loads(ev(ids_of))
            check("%s: a header click sorts and turns around" % name,
                  first == "descending" and second == "ascending", "%s then %s" % (first, second))
            check("%s: the rows come back in the order the header states" % name,
                  up == sorted(up) and down == sorted(down, reverse=True),
                  " ".join(up[:3]))

            # the column picker, measured against the laid-out table
            ev("document.getElementById('tkCols').open=true")
            panel = box("#tkColsList")
            check("%s: the column picker opens inside the viewport" % name,
                  panel["w"] > 0 and panel["r"] <= w + 1,
                  "%dx%d at x=%s" % (panel["w"], panel["h"], panel["x"]))
            click('#tkColsList [data-col="target"]')
            time.sleep(0.3)
            gone = box("#tkTable td.col-target")
            check("%s: turning a column off takes it out of the laid-out table" % name,
                  gone["display"] == "none", gone["display"])
            click('#tkColsList [data-col="target"]')
            time.sleep(0.3)
            back = box("#tkTable td.col-target")
            check("%s: turning it back on returns the column" % name,
                  back["display"] != "none", back["display"])
            prio = box("#tkTable th.col-priority")
            check("%s: the coordinator lays out the priority column" % name,
                  prio["display"] != "none", prio["display"])
            ev("document.getElementById('tkCols').open=false")

            # the bulk toolbar and its dialog
            click("#tkBody [data-sel]")
            time.sleep(0.3)
            bulk = box("#tkBulk")
            check("%s: a selection reveals the bulk toolbar" % name,
                  bulk["display"] != "none", bulk["display"])
            assign = box("#tkBulkAssign")
            check("%s: the assign control is large enough to press" % name,
                  tap_ok(assign, floor), "h=%s" % assign["h"])
            click("#tkBulkAssign")
            time.sleep(0.4)
            card = box(".modal-card")
            check("%s: the assign dialog opens inside the viewport" % name,
                  fits(card), "%dx%d at x=%s y=%s in %d" % (card["w"], card["h"],
                                                             card["x"], card["y"], w))
            field = box(".modal-card select, .modal-card input")
            check("%s: the dialog field can be tapped" % name,
                  tap_ok(field, floor), "h=%s" % field["h"])
            click(".modal-card [data-close]")
            time.sleep(0.3)
            check("%s: Cancel leaves no dialog behind" % name,
                  box(".modal-card")["missing"], str(box(".modal-card")["display"]))

        # ---------------- the record ----------------
        if link and link != "missing":
            nav(base + link)
            tabs = count(".tabs .tab")
            check("%s: the record offers its tabs" % name, tabs >= 2, "%s tabs" % tabs)
            if tabs:
                ev("document.querySelectorAll('.tabs .tab')[1].click()")
                time.sleep(0.4)
                on = json.loads(ev("(function(){var t=document.querySelectorAll('.tabs .tab')[1];"
                                   "return JSON.stringify({sel:t.getAttribute('aria-selected'),"
                                   "panel:t.getAttribute('aria-controls')});})()"))
                panel = box("#" + str(on["panel"])) if on["panel"] else dict(GONE)
                check("%s: a tab switch shows its panel" % name,
                      on["sel"] == "true" and not panel["missing"] and
                      panel["display"] != "none",
                      "aria-selected=%s panel display=%s" % (on["sel"], panel["display"]))
                no_overflow("%s record tab" % name)

            # The move selector only exists while this lane has a step to take.
            # A settled record is asked instead to name who acts next.
            acts = box("#tMove")
            opts = count('#tMove option:not([value=""])')
            if acts["missing"]:
                waiting = text("#tActions")
                check("%s: a record with no move here says who must act" % name,
                      waiting != "missing" and len(waiting) > 20, repr(waiting[:46]))
            elif opts:
                check("%s: the record offers this lane its next steps" % name,
                      opts >= 1, "%s moves in the selector" % opts)
                check("%s: the move selector is large enough to open" % name,
                      tap_ok(acts, floor), "h=%s" % acts["h"])
                move = ev("(function(){var s=document.getElementById('tMove');"
                          "return s.options[1].value;})()")
                ev("(function(){var s=document.getElementById('tMove');"
                   "s.selectedIndex=1;s.focus();"
                   "s.dispatchEvent(new Event('change',{bubbles:true}));return 'moved';})()")
                time.sleep(0.8)
                here = str(ev("location.pathname")).rsplit("/", 1)[-1]
                check("%s: choosing a move opens the screen that records it" % name,
                      str(move).split("?")[0] == here, "%s landed on %s" % (move, here))
                nav(str(ev("location.href")))
                no_overflow("%s move screen" % name)
                # The destination carries the recording, and its fields are not
                # laid out on the page: review.html paints the coordinator
                # worklist plus the panel for the ticket named in the address
                # (review.html:123-191), and the panel's controls open the modal
                # that takes the entry (js/actions.js:21-27).  So the driver
                # presses the first control the panel offers and measures the
                # dialog it opens, the way a coordinator works the step.
                waiting = count("#rvBody tr[data-id]")
                check("%s: the move screen paints its worklist" % name,
                      waiting >= 1, "%s tickets waiting" % waiting)
                panel = box("#rvPanel .card")
                subject = text("#rvPanel .record-subject")
                # review.html keeps the ticket named in the address while it is
                # still one of the statuses in the worklist (review.html:135), so
                # the panel heading is the proof the step is being worked on the
                # record the reader was sent for, not on whatever the list opens
                # with.
                shown = text("#rvPanel .t-id")
                asked = str(ev("UI.qs('id')"))
                check("%s: the move screen carries the record it was opened for" % name,
                      fits(panel) and shown == asked and subject != "missing" and
                      len(subject) > 3,
                      "%s shown as %s, card %dx%d at x=%s" % (asked, shown, panel["w"],
                                                              panel["h"], panel["x"]))
                first_act = box("#rvPanel [data-act]")
                check("%s: the panel's first control can be pressed" % name,
                      tap_ok(first_act, floor), "h=%s" % first_act["h"])
                click("#rvPanel [data-act]")
                time.sleep(0.5)
                opened = box(".modal-card")
                taking = count(".modal-card input, .modal-card select, "
                               ".modal-card textarea")
                check("%s: pressing it opens the dialog that records the step" % name,
                      fits(opened) and taking >= 1,
                      "%s fields, %dx%d at x=%s in %d" % (taking, opened["w"],
                                                          opened["h"], opened["x"], w))
                entry = box(".modal-card input, .modal-card select, .modal-card textarea")
                check("%s: that entry field is large enough to tap" % name,
                      tap_ok(entry, floor), "h=%s" % entry["h"])
                click(".modal-card [data-close]")
                time.sleep(0.4)
                check("%s: cancelling the step leaves no dialog behind" % name,
                      box(".modal-card")["missing"], str(box(".modal-card")["display"]))
                nav(base + link)

            # The attachment viewer is the record's own dialog.  The register is
            # small, so the driver asks the store for a record that really
            # carries a file instead of assuming the first row does.
            filing = ev("(function(){var ts=Store.db.tickets.filter(function(t){"
                        "return (t.attachments||[]).length;});"
                        "return ts.length? UI.urlFor('ticket.html','coordinator')+"
                        "'?id='+encodeURIComponent(ts[0].id):'none';})()")
            if filing and filing != "missing":
                nav(base + str(filing))
                chip = box("#tAttachmentList [data-att]")
                check("%s: a record that carries a file paints its chip" % name,
                      not chip["missing"], "h=%s" % chip["h"])
                if not chip["missing"]:
                    check("%s: the attachment chip is large enough to open" % name,
                          tap_ok(chip, floor), "h=%s" % chip["h"])
                    click("#tAttachmentList [data-att]")
                    time.sleep(0.5)
                    dlg = box(".viewer-card")
                    check("%s: an attachment opens in place, inside the viewport" % name,
                          fits(dlg), "%dx%d at x=%s r=%s in %d" % (dlg["w"], dlg["h"],
                                                                   dlg["x"], dlg["r"], w))
                    close_btn = box(".viewer-card [data-close], .viewer-card .viewer-close")
                    check("%s: the dialog's close control can be pressed" % name,
                          tap_ok(close_btn, floor), "h=%s" % close_btn["h"])
                    ev("var c=document.querySelector('.viewer-card [data-close]')"
                       "||document.querySelector('.viewer-card .viewer-close');"
                       "c && c.click()")
                    time.sleep(0.4)
                    check("%s: the dialog closes again" % name,
                          box(".viewer-card")["missing"], str(box(".viewer-card")["display"]))

        # ---------------- the office form ----------------
        ev("UI.signIn('requester')")
        nav(base + "or-request.html")
        role = ev("UI.roleKey()")
        check("%s: the office form opens for the requester lane" % name,
              role == "requester", str(role))
        subject = box("#fIssue")
        check("%s: the form field can be tapped" % name,
              tap_ok(subject, floor), "h=%s" % subject["h"])
        type_in("#fIssue", "Projector cable will not seat")
        check("%s: the form keeps what is typed" % name,
              read("#fIssue") == "Projector cable will not seat", repr(read("#fIssue")))
        no_overflow("%s request form" % name)
        fields = count("#reqForm input:not([type=hidden]), #reqForm select, #reqForm textarea")
        check("%s: the form exposes its fields" % name, fields >= 3, "%s fields" % fields)
        ev("""(function(){
          function set(el,v){ if(!el) return;
            el.value=v; el.dispatchEvent(new Event('input',{bubbles:true}));
            el.dispatchEvent(new Event('change',{bubbles:true})); }
          function pick(el){ if(!el || el.value) return;
            if(el.options && el.options.length>1) set(el, el.options[1].value); }
          set(document.getElementById('fIssue'),
              'Projector cable will not seat. Room 204, needed before Monday.');
          set(document.getElementById('fReq'), 'A. Delos Reyes');
          pick(document.getElementById('fOffice'));
          pick(document.getElementById('fCategory'));
          pick(document.getElementById('fSource'));
          var go=document.querySelector('#reqForm button[type=submit]');
          if(go) go.click();
          return 'sent';
        })()""")
        time.sleep(0.8)
        suc = text("#sucNext")
        check("%s: the form reaches its success panel" % name,
              suc != "missing" and len(suc) > 10, repr(suc))

        # ---------------- the dashboard chart and the phone menu ----------------
        ev("UI.signIn('coordinator')")
        nav(base + "ic-dashboard.html")
        drawn = json.loads(ev("""(function(){
          var bars=0,tallest=0;
          document.querySelectorAll('#actChart .col-day span.col').forEach(function(s){
            var b=s.getBoundingClientRect();
            if(b.height>1){bars++; if(b.height>tallest) tallest=b.height;}});
          return JSON.stringify({bars:bars,tallest:Math.round(tallest)});})()"""))
        check("%s: the activity chart draws its bars" % name,
              drawn["bars"] >= 3 and drawn["tallest"] > 1,
              "%s bars, tallest %s px" % (drawn["bars"], drawn["tallest"]))
        tiles = count(".kpi")
        vis = ev("""(function(){var n=0;document.querySelectorAll('.kpi').forEach(function(k){
          var b=k.getBoundingClientRect(); if(b.width>0&&b.height>0&&b.right<=window.innerWidth+1) n++;});
          return n;})()""")
        check("%s: every focused tile is laid out on the screen" % name,
              (vis or 0) >= 3 and tiles >= 3, "%s of %s tiles" % (vis, tiles))
        no_overflow("%s dashboard" % name)
        if w < 600:
            items = json.loads(ev("""(function(){var out=[];
              document.querySelectorAll('#chromeBottom a, #chromeBottom button').forEach(function(a){
                var b=a.getBoundingClientRect();
                if(getComputedStyle(a).display!=='none'&&b.width>0)
                  out.push({h:Math.round(b.height),t:(a.innerText||'').trim(),
                            tag:a.tagName.toLowerCase()});});
              return JSON.stringify(out);})()"""))
            stops = [i for i in items if i["tag"] == "a"]
            check("%s: the phone tab bar paints four destinations plus More" % name,
                  len(stops) >= 4, "%s destinations" % len(stops))
            check("%s: every tab bar destination is a 44 px target" % name,
                  bool(items) and all(i["h"] >= 44 for i in items),
                  "heights " + " ".join(str(i["h"]) for i in items))
            from_before = str(ev("location.pathname"))
            ev("(function(){var a=document.querySelectorAll('#chromeBottom a');"
               "if(a.length>1) a[1].click();})()")
            time.sleep(1.2)
            after_path = str(ev("location.pathname"))
            check("%s: a tab bar tap moves the reader on, inside this lane" % name,
                  after_path != from_before and "ic-" in after_path,
                  "%s to %s" % (from_before.rsplit("/", 1)[-1],
                                after_path.rsplit("/", 1)[-1]))

    try:
        ws.close()
        proc.terminate()
    except Exception:
        pass
    shutil.rmtree(profile, ignore_errors=True)
    httpd.shutdown()

    print("\n%d checks run, %d with problems" % (len(checks), len(problems)))
    for p in problems:
        print("   ?? %s" % p)
    print("RESPONSIVE BEHAVIOR: %s" % ("PASS" if not problems else "FAIL"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
