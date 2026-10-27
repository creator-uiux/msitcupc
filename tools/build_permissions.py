"""Build permissions.json: the single permission map for the whole system.

The map has three parts:

  pages       which role may open which screen
  actions     which role may invoke which backend action
  transitions which role may move a ticket from one status to another

It is generated from the current sources so the committed file always matches
the code, and `tools/permission_parity_check.py` fails if any of the three
copies (permissions.json, the backend, the frontend mirror) drift apart.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "permissions.json")
ENGINE = os.path.join(ROOT, "server", "engine.py")
UI = os.path.join(ROOT, "js", "ui.js")

ROLES = ["requester", "technician", "coordinator", "management"]


def extract_pages():
    """The page map.

    permissions.json is the source of truth for pages, so an existing map is
    preserved.  The ACCESS literal in js/ui.js is only the offline fallback
    and is parsed as a cross-check: a page present in one and missing from the
    other is reported so the drift is visible.
    """
    existing = {}
    if os.path.isfile(OUT):
        try:
            with open(OUT, encoding="utf-8") as fh:
                existing = (json.load(fh) or {}).get("pages") or {}
        except (OSError, ValueError):
            existing = {}

    text = open(UI, encoding="utf-8").read()
    block = re.search(r"var ACCESS = \{(.*?)\n  \};", text, re.S)
    fallback = {}
    if block:
        body = block.group(1)
        for m in re.finditer(r"'([\w.\-]+\.html)':\s*(\[[^\]]*\]|ALL)", body):
            page = m.group(1)
            raw = m.group(2)
            fallback[page] = list(ROLES) if raw == "ALL" else [
                r.strip().strip("'") for r in raw[1:-1].split(",") if r.strip()]

    pages = dict(existing) if existing else dict(fallback)
    if not pages:
        raise SystemExit("no page permissions found in permissions.json or js/ui.js")
    missing = sorted(set(fallback) - set(pages))
    if missing:
        print("  note: pages in the js/ui.js fallback but not in the map: %s"
              % ", ".join(missing))
    return pages


def extract_actions():
    text = open(ENGINE, encoding="utf-8").read()
    out = {}
    current = None
    for line in text.splitlines():
        m = re.match(r"\s*def ([a-z_][a-z0-9_]*)\(", line)
        if m:
            current = m.group(1)
            continue
        m = re.search(r"_guard\(state,\s*\[([^\]]*)\]\)", line)
        if m and current and current not in out:
            roles = [r.strip().strip("\"'") for r in m.group(1).split(",") if r.strip()]
            out[current] = roles
    return out


def extract_transitions():
    text = open(ENGINE, encoding="utf-8").read()
    block = re.search(r"TRANSITIONS_FALLBACK = \{(.*?)\n\}", text, re.S)
    if not block:
        raise SystemExit("could not find the transition whitelist in server/engine.py")
    body = block.group(1)
    out = {}
    for m in re.finditer(
            r"\"([a-z_]+)\":\s*\{(.*?)\}", body, re.S):
        frm = m.group(1)
        inner = {}
        for e in re.finditer(r"\"([a-z_]+)\":\s*\(([^)]*)\)", m.group(2)):
            roles = [r.strip().strip("\"'") for r in e.group(2).split(",") if r.strip()]
            inner[e.group(1)] = roles
        out[frm] = inner
    return out


def write_frontend_mirror(data):
    """Emit js/permissions.js for the frontend.

    The frontend cannot read a JSON file synchronously in the offline demo, so
    the mirror is generated.  tools/permission_parity_check.py compares the
    mirror against permissions.json and fails on any difference.
    """
    path = os.path.join(ROOT, "js", "permissions.js")
    lines = [
        "/* permissions.js -- GENERATED FILE, do not edit by hand.",
        " *",
        " * Source of truth: permissions.json at the repository root.",
        " * Rebuild with: python tools/build_permissions.py",
        " * Verify with:   python tools/permission_parity_check.py",
        " *",
        " * The backend reads permissions.json directly for its action guards and",
        " * its transition matrix, so the frontend and the backend are driven by",
        " * one map (specification 4A.1).",
        " */",
        "(function (global) {",
        "  'use strict';",
        "  var P = " + json.dumps(data, indent=2, sort_keys=False) + ";",
        "  global.Permissions = P;",
        "  global.PermissionMap = {",
        "    pages: P.pages,",
        "    actions: P.actions,",
        "    transitions: P.transitions,",
        "    roles: P.roles,",
        "    /* role -> pages it may open */",
        "    pagesForRole: function (role) {",
        "      var out = [];",
        "      for (var k in P.pages) {",
        "        if (P.pages[k].indexOf(role) > -1) out.push(k);",
        "      }",
        "      return out;",
        "    },",
        "    /* role -> actions it may invoke */",
        "    actionsForRole: function (role) {",
        "      var out = [];",
        "      for (var k in P.actions) {",
        "        if (P.actions[k].indexOf(role) > -1) out.push(k);",
        "      }",
        "      return out;",
        "    },",
        "    /* status transition whitelist, same shape as the backend table */",
        "    canTransition: function (from, to, role) {",
        "      var row = P.transitions[from] || {};",
        "      return (row[to] || []).indexOf(role) > -1;",
        "    },",
        "    /* may this role invoke this backend action?  The UI gates every",
        "       button with the same map the backend enforces, so the screen",
        "       can never offer a control the server would refuse. */",
        "    can: function (role, action) {",
        "      return (P.actions[action] || []).indexOf(role) > -1;",
        "    },",
        "    /* the same question, asked with the camelCase method name the",
        "       browser code uses (recordOutcome -> record_outcome). */",
        "    canMethod: function (role, method) {",
        "      var key = String(method || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();",
        "      return (P.actions[key] || []).indexOf(role) > -1;",
        "    }",
        "  };",
        "})(window);",
        "",
    ]
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    return path


def main():
    data = {
        "_comment": "Single permission map for the IT Service and Maintenance "
                    "Management System. The backend reads it for action guards "
                    "and the transition matrix; js/permissions.js is generated "
                    "from it for the frontend. tools/permission_parity_check.py "
                    "verifies the three never drift apart.",
        "roles": ROLES,
        "pages": extract_pages(),
        "actions": extract_actions(),
        "transitions": extract_transitions(),
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(data, fh, indent=2, sort_keys=False)
        fh.write("\n")
    mirror = write_frontend_mirror(data)
    print("wrote %s" % os.path.relpath(OUT, ROOT))
    print("wrote %s" % os.path.relpath(mirror, ROOT))
    print("  pages: %d" % len(data["pages"]))
    print("  actions: %d" % len(data["actions"]))
    print("  transition sources: %d" % len(data["transitions"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
