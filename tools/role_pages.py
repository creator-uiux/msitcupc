"""Generate the real, role-named pages for the live app.

Every page in this system shares ONE file across all roles: the role lives
only in JS state (Store.db.role), never in the URL.  This tool emits a real
standalone file per (page x role) so /or-dashboard.html is a genuine Office
Requester dashboard, /itc-dashboard.html a genuine IT Technician one, etc.

Ground truth for which roles may open which page is the ACCESS map in
js/ui.js - the same map the client guard already enforces.  We never invent
a route the app forbids (a requester has no review.html, so there is no
or-review.html).

Each generated file is the source page verbatim plus exactly two things:
  1. a role-specific <title>            (OR - Dashboard - ITC Maintenance System)
  2. an injected boot script that pins the session role to the URL prefix
     and redirects when the prefix disagrees with the signed-in role.

The redirect itself lives in js/ui.js (bindUrlRole) so the logic stays in one
place and the generated pages stay thin.

Naming: url prefix is lower-case (or-, itc-, ic-, mgmt-) because URLs are
case-insensitive; the Figma frame prefixes stay upper-case (OR-, ITC- ...).

Run:    python tools/role_pages.py            # write the role-named pages
        python tools/role_pages.py --check    # verify names, titles, content
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

UI_JS = os.path.join(ROOT, "js", "ui.js")

# url prefix (lower-case) -> internal role key
URL_PREFIX = {"or": "requester", "itc": "technician",
              "ic": "coordinator", "mgmt": "management"}
# internal role key -> short label for <title>
ROLE_LABEL = {"requester": "OR", "technician": "ITC",
              "coordinator": "IC", "management": "MGMT"}
# internal role key -> url prefix
PREFIX_FOR_ROLE = {v: k for k, v in URL_PREFIX.items()}
PREFIX_ORDER = ["or", "itc", "ic", "mgmt"]

# Where each lane lands.  The System Administrator has no dashboard: its lane
# is Administration, so the users directory is its home.  Keep in step with
# HOME_PAGE in js/ui.js; tools/rolepages_test.js proves the two agree.
HOME_FOR_ROLE = {"requester": "dashboard.html", "technician": "dashboard.html",
                 "coordinator": "dashboard.html", "management": "users.html"}
# the same map as generated file names, baked into every pre-paint guard
HOME_URLS = {r: "%s-%s" % (PREFIX_FOR_ROLE[r], HOME_FOR_ROLE[r])
             for r in HOME_FOR_ROLE}

# Pages that never get a role prefix (public chrome + entry points).
NO_ROLE_PAGES = {"login.html", "404.html", "index.html"}

# A generated page pins its url-role before anything paints.  The inline guard
# runs in <head> (no dependency on Store); the authoritative check lives in
# ui.js bindUrlRole().
#
# A SIGNED-IN visitor whose role disagrees with the prefix is redirected
# pre-paint, so they never see a flash of another role's lane.  A SESSIONLESS
# visitor (no localStorage - a cold browser, an importer like Codia, a link
# preview) is NOT redirected: the page renders the URL's role as a signed-out
# preview, which is what makes /or-dashboard.html importable and shareable.
BOOT = (
    '<script>(function(){'
    'var P="%s",R="%s",F="%s";'
    'var OWN={requester:"or",technician:"itc",coordinator:"ic",management:"mgmt"};'
    'var ALLOW=%s;var HOME=%s;'
    # theme first, so a dark import never flashes the light palette
    # default to light unless explicitly dark (no auto-OS-dark)
    'try{var tm=/[?&]theme=(dark|light)\\b/.exec(location.search);'
    'var t=tm?tm[1]:(localStorage.getItem("itc_theme")||"light");'
    'if(t==="dark")document.documentElement.setAttribute("data-theme","dark");'
    'else document.documentElement.setAttribute("data-theme","light");'
    '}catch(e){}'
    'var d=null;try{d=JSON.parse(localStorage.getItem("itc_db_v3"));}catch(e){}'
    'var a=d&&d.auth&&d.auth.role;'
    'if(a&&a!==R){var o=OWN[a]||"or";'
    'location.replace(ALLOW.indexOf(o)>-1?(o+"-"+F):(HOME[a]||("or-"+F)));return;}'
    'window.ITC_URL_ROLE=P;'
    '})();</script>'
)


def ui_source():
    with open(UI_JS, encoding="utf-8") as fh:
        return fh.read()


def read_access(src):
    """The page permission map, read from the single permission map file.

    permissions.json is the source of truth for pages, actions and
    transitions (specification 4A.1).  The frontend mirror js/permissions.js
    is generated from it, and tools/permission_parity_check.py proves the
    three agree.
    """
    import json
    with open(os.path.join(ROOT, "permissions.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    pages = data.get("pages") or {}
    all_roles = data.get("roles") or []
    out = {}
    for page, roles in pages.items():
        out[page] = None if sorted(roles) == sorted(all_roles) else list(roles)
    return out


def roles_for(page, access, all_roles):
    if page not in access:
        return []
    allowed = access[page]
    return list(all_roles) if allowed is None else list(allowed)


def role_label(page, role):
    pretty = page[:-5].replace("-", " ").title()
    return "%s - %s - ITC Maintenance System" % (ROLE_LABEL[role], pretty)


def transform(src, page, role, prefix, allowed_prefixes):
    """Source page -> role-named page: new title + pre-paint url-role guard."""
    out = re.sub(r"<title>.*?</title>",
                 "<title>%s</title>" % role_label(page, role), src,
                 count=1, flags=re.S)
    # The guard goes in <head> so it runs before the document paints - a
    # wrong-role or signed-out visitor never sees a flash of the page.
    boot = BOOT % (prefix, role, page, json.dumps(allowed_prefixes),
                   json.dumps(HOME_URLS))
    if "</head>" in out:
        out = out.replace("</head>", boot + "\n</head>", 1)
    else:
        raise SystemExit("%s has no </head> tag" % page)
    return out


def plan():
    src = ui_source()
    access = read_access(src)
    all_roles = re.findall(r"var ROLE_ORDER = \[(.*?)\];", src, re.S)[0]
    all_roles = re.findall(r"'([^']+)'", all_roles)
    jobs = []
    for page in sorted(access):
        if page in NO_ROLE_PAGES:
            continue
        roles = roles_for(page, access, all_roles)
        prefixes = [PREFIX_FOR_ROLE[r] for r in roles]
        for role in roles:
            prefix = PREFIX_FOR_ROLE[role]
            jobs.append((page, role, prefix,
                         "%s-%s" % (prefix, page), prefixes))
    return jobs


def build(check=False):
    jobs = plan()
    src_cache = {}
    problems = []
    written = []
    for page, role, prefix, name, allowed in jobs:
        if page not in src_cache:
            src_cache[page] = open(os.path.join(ROOT, page), encoding="utf-8").read()
        out = transform(src_cache[page], page, role, prefix, allowed)
        dest = os.path.join(ROOT, name)
        if check:
            if not os.path.isfile(dest):
                problems.append("missing: %s" % name)
                continue
            have = open(dest, encoding="utf-8").read()
            if have != out:
                problems.append("stale: %s" % name)
            continue
        with open(dest, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(out)
        written.append(name)

    # ---- checks ----
    print("role pages: %d" % len(jobs))
    by_prefix = {}
    for page, role, prefix, name, _allowed in jobs:
        by_prefix.setdefault(prefix, []).append(page)
    for p in PREFIX_ORDER:
        if p in by_prefix:
            print("  %-5s %2d pages" % (p, len(by_prefix[p])))

    if check:
        # every generated page present and byte-current
        extra = []
        for f in sorted(os.listdir(ROOT)):
            m = re.match(r"^(or|itc|ic|mgmt)-(.+)\.html$", f)
            if m and not any(j[3] == f for j in jobs):
                extra.append(f)
        if extra:
            problems.append("unexpected role pages: %s" % ", ".join(extra))
        # titles unique across generated set
        titles = {}
        for page, role, prefix, name, _allowed in jobs:
            t = role_label(page, role)
            titles.setdefault(t, []).append(name)
        dupes = {t: n for t, n in titles.items() if len(n) > 1}
        if dupes:
            problems.append("duplicate titles: %s" % dupes)
        print()
        if problems:
            print("PROBLEMS:")
            for p in problems:
                print("  " + p)
            print("\nROLE PAGES CHECK: FAIL")
            return 1
        print("ROLE PAGES CHECK: PASS  (%d files, %d unique titles)"
              % (len(jobs), len(titles)))
        return 0

    print("wrote %d role pages" % len(written))
    return 0


if __name__ == "__main__":
    sys.exit(build("--check" in sys.argv))
