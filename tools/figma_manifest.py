"""Build the Figma hand-off from the captured frames.

Reads the role frames in shots/ and writes two artifacts:

  shots/figma-manifest.csv  one row per frame: Figma page, frame name, mode,
                            viewport, pixel size, file and source page
  shots/figma-board.html    the same frames grouped one lane per section, so
                            the import order can be checked before dragging
                            anything into Figma

Frames come from tools/shots.py, which names them
<page>--<viewport>[-full].png. Only the four lane prefixes (or, itc, ic,
mgmt) and the four shared entry screens are listed; older base-page captures
in the same folder are ignored.

Run:  python tools/figma_manifest.py
"""
import csv
import os
import re
import struct

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "shots")

LANES = [
    ("shared", "Shared", "SHARED"),
    ("or", "Office Requester", "OR"),
    ("itc", "IT Technician", "ITC"),
    ("ic", "IT Coordinator", "IC"),
    ("mgmt", "System Administrator", "MGMT"),
]
LANE_BY_PREFIX = {p: (i, name, tag) for i, (p, name, tag) in enumerate(LANES)}

# One workflow order for every lane. A lane simply skips the pages it does not
# hold, so the same sheet reads the same way whichever lane is open.
PAGE_ORDER = [
    "index", "login", "404", "offline",
    "dashboard", "request", "tickets", "ticket", "review", "technician",
    "maintenance", "confirm", "visits", "register", "users", "offices",
    "assets", "settings", "audit", "reports", "notifications", "profile",
    "flow", "roles",
]
PAGE_TITLE = {
    "index": "Gallery",
    "login": "Sign In",
    "404": "Not Found",
    "offline": "Offline",
    "dashboard": "Dashboard",
    "request": "New Request",
    "tickets": "Service Tickets",
    "ticket": "Service Record",
    "review": "Review and Assign",
    "technician": "My Work",
    "maintenance": "Maintenance",
    "confirm": "Confirmation and Closure",
    "visits": "Maintenance Visits",
    "register": "Office Register",
    "users": "Accounts",
    "offices": "Offices",
    "assets": "Assets",
    "settings": "Settings",
    "audit": "Audit Log",
    "reports": "Reports",
    "notifications": "Notifications",
    "profile": "Profile",
    "flow": "Workflow Guide",
    "roles": "Roles and Access",
}
VIEWPORT_WIDTH = {"desktop": 1440, "mobile": 390}
SHARED_PAGES = {"index", "login", "404", "offline"}
FRAME_SLUG = {
    "index": "Gallery", "login": "SignIn", "404": "NotFound", "offline": "Offline",
    "dashboard": "Dashboard", "request": "NewRequest", "tickets": "ServiceTickets",
    "ticket": "ServiceRecord", "review": "ReviewAssign", "technician": "MyWork",
    "maintenance": "Maintenance", "confirm": "ConfirmationClosure",
    "visits": "MaintenanceVisits", "register": "OfficeRegister",
    "users": "Accounts", "offices": "Offices", "assets": "Assets",
    "settings": "Settings", "audit": "AuditLog", "reports": "Reports",
    "notifications": "Notifications", "profile": "Profile", "flow": "WorkflowGuide",
    "roles": "RolesAccess",
}

NAME_RE = re.compile(r"^(?:(or|itc|ic|mgmt)-)?([a-z0-9]+)--(desktop|mobile)(-full)?\.png$")


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return (0, 0)
    return struct.unpack(">II", head[16:24])


def rows():
    out = []
    for fn in sorted(os.listdir(OUT)):
        m = NAME_RE.match(fn)
        if not m:
            continue
        prefix, page, viewport, full = m.groups()
        if prefix is None and page not in SHARED_PAGES:
            continue
        if prefix is None:
            prefix = "shared"
        source = ("%s.html" % page) if prefix == "shared" else ("%s-%s.html" % (prefix, page))
        if not os.path.isfile(os.path.join(ROOT, source)):
            continue  # a frame left behind by an older build of a page that no longer exists
        lane_i, lane_name, tag = LANE_BY_PREFIX[prefix]
        w, h = png_size(os.path.join(OUT, fn))
        title = PAGE_TITLE.get(page, page.replace("-", " ").title())
        slug = FRAME_SLUG.get(page, title.replace(" ", ""))
        frame = "%s-%s-%d%s" % (tag, slug, VIEWPORT_WIDTH[viewport],
                                "-Full" if full else "")
        out.append({
            "lane_order": lane_i,
            "figma_page": lane_name,
            "page_order": PAGE_ORDER.index(page) if page in PAGE_ORDER else 99,
            "frame_order": 0,
            "frame_name": frame,
            "frame_mode": "full-page" if full else "canvas",
            "viewport": viewport,
            "width_px": w,
            "height_px": h,
            "file": fn,
            "source_url": source + "?demo=1",
            "page_title": title,
        })
    order = {"desktop": 0, "mobile": 1}
    mode = {"canvas": 0, "full-page": 1}
    out.sort(key=lambda r: (r["lane_order"], r["page_order"], order[r["viewport"]],
                            mode[r["frame_mode"]]))
    # frame_order is the position inside each Figma page
    seen = {}
    for r in out:
        seen[r["figma_page"]] = seen.get(r["figma_page"], 0) + 1
        r["frame_order"] = seen[r["figma_page"]]
    return out


COLUMNS = ["figma_page", "frame_order", "frame_name", "page_title", "frame_mode",
           "viewport", "width_px", "height_px", "file", "source_url"]


def write_csv(records):
    path = os.path.join(OUT, "figma-manifest.csv")
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)
    return path


def write_board(records):
    """One section per lane, one card per screen, desktop beside phone."""
    by_page = {}
    for r in records:
        key = (r["lane_order"], r["page_order"], r["page_title"])
        by_page.setdefault(key, {})[(r["viewport"], r["frame_mode"])] = r

    sections = []
    for lane_order, (prefix, lane_name, _tag) in enumerate(LANES):
        cards = []
        for (lo, _po, title), frames in by_page.items():
            if lo != lane_order:
                continue
            desktop = frames.get(("desktop", "full-page"))
            mobile = frames.get(("mobile", "full-page"))
            if not desktop and not mobile:
                continue
            imgs = []
            if desktop:
                imgs.append(
                    '<figure class="shot"><img src="%s" loading="lazy" alt="%s">'
                    '<figcaption><b>%s</b><span>%s</span></figcaption></figure>'
                    % (desktop["file"], desktop["frame_name"], title,
                       desktop["frame_name"]))
            if mobile:
                imgs.append(
                    '<figure class="shot phone"><img src="%s" loading="lazy" alt="%s">'
                    '<figcaption><b>%s</b><span>%s</span></figcaption></figure>'
                    % (mobile["file"], mobile["frame_name"], title,
                       mobile["frame_name"]))
            cards.append('<div class="row">%s</div>' % "".join(imgs))
        if cards:
            sections.append('<h2>%s</h2>%s' % (lane_name, "\n".join(cards)))

    html = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>ITC Maintenance System - screen atlas</title>
<style>
body{font-family:Inter,'Segoe UI',system-ui,sans-serif;background:#eef1f7;margin:0;padding:32px;color:#0f172a}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:34px 0 12px;color:#014421}
p.lead{color:#64748b;margin:0 0 22px;font-size:14px}
.row{display:flex;align-items:flex-start;gap:20px;margin:0 0 20px;flex-wrap:wrap}
figure{background:#fff;border:1px solid #e5e9f2;border-radius:14px;overflow:hidden;margin:0;box-shadow:0 1px 3px rgba(15,23,42,.07)}
figure img{display:block;width:100%;background:#f8fafc;border-bottom:1px solid #eef1f7}
figure.shot{width:min(660px,100%)}
figure.phone{width:196px}
figcaption{padding:9px 12px;font-size:12px;color:#475569;display:flex;flex-direction:column;gap:2px}
figcaption b{font-weight:650}figcaption span{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#014421}
</style></head><body>
<h1>ITC Maintenance System - screen atlas</h1>
<p class="lead">__N__ frames in __L__ lanes - deterministic demo data (?demo=1) - 1440 px desktop, 390 px phone - the board draws the full-page frame of each screen; frame names match shots/figma-manifest.csv</p>
__SECTIONS__
</body></html>"""
    html = (html.replace("__N__", str(len(records)))
                .replace("__L__", str(len(LANES)))
                .replace("__SECTIONS__", "\n".join(sections)))
    path = os.path.join(OUT, "figma-board.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


def main():
    records = rows()
    if not records:
        print("!! no frames in shots/; run python tools/shots.py first")
        return 2
    csv_path = write_csv(records)
    board_path = write_board(records)
    lanes = {}
    for r in records:
        lanes[r["figma_page"]] = lanes.get(r["figma_page"], 0) + 1
    print("%d frames" % len(records))
    for name, n in lanes.items():
        print("  %-22s %3d" % (name, n))
    print("wrote %s" % os.path.relpath(csv_path, ROOT))
    print("wrote %s" % os.path.relpath(board_path, ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
