"""Permission map parity check (specification 4A.1 and test 72).

The permission map must be the single source of truth.  This proves the three
copies agree:

  1. permissions.json          the source of truth
  2. server/engine.py          the backend guard lists and transition matrix
  3. js/permissions.js         the generated frontend mirror

It also proves that every action in the backend has an entry in the map, and
that no role can reach an action the map does not grant it.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERM = os.path.join(ROOT, "permissions.json")
MIRROR = os.path.join(ROOT, "js", "permissions.js")
ENGINE = os.path.join(ROOT, "server", "engine.py")
UI = os.path.join(ROOT, "js", "ui.js")

ROLES = ["requester", "technician", "coordinator", "management"]
# `system` is the automated actor (the background worker), not a human role.
# It may appear in an action's role list for worker-triggered actions.
KNOWN_ACTORS = ROLES + ["system"]

problems = []


def norm_roles(seq):
    return sorted(str(r) for r in seq)


def read_perm():
    with open(PERM, encoding="utf-8") as fh:
        return json.load(fh)


def read_mirror():
    text = open(MIRROR, encoding="utf-8").read()
    start = text.find("var P = ")
    if start < 0:
        problems.append("could not find 'var P =' in js/permissions.js")
        return None
    start = text.index("{", start)
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start:i + 1])
    problems.append("could not parse js/permissions.js")
    return None


def engine_actions():
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
            out[current] = [r.strip().strip("\"'") for r in m.group(1).split(",") if r.strip()]
    return out


def engine_transitions():
    text = open(ENGINE, encoding="utf-8").read()
    m = re.search(r"TRANSITIONS_FALLBACK = \{(.*?)\n\}", text, re.S)
    if not m:
        problems.append("could not find the transition whitelist in server/engine.py")
        return {}
    out = {}
    for frm in re.finditer(r"\"([a-z_]+)\":\s*\{(.*?)\}", m.group(1), re.S):
        inner = {}
        for e in re.finditer(r"\"([a-z_]+)\":\s*\(([^)]*)\)", frm.group(2)):
            inner[e.group(1)] = [r.strip().strip("\"'") for r in e.group(2).split(",") if r.strip()]
        out[frm.group(1)] = inner
    return out


def main():
    perm = read_perm()
    mirror = read_mirror()
    if mirror is None:
        print("PERMISSION PARITY: FAIL")
        return 1

    # 1. map vs frontend mirror
    for key in ("pages", "actions", "transitions", "roles"):
        if perm.get(key) != mirror.get(key):
            problems.append("permissions.json and js/permissions.js differ on '%s'" % key)

    # 2. map vs backend action guards
    eng_actions = engine_actions()
    for action, roles in sorted(perm.get("actions", {}).items()):
        if action not in eng_actions:
            problems.append("backend action '%s' is missing from the map" % action)
            continue
        if norm_roles(eng_actions[action]) != norm_roles(roles):
            problems.append("action '%s': backend %s vs map %s"
                            % (action, norm_roles(eng_actions[action]), norm_roles(roles)))
    for action in sorted(eng_actions):
        if action not in perm.get("actions", {}):
            problems.append("backend action '%s' has no entry in the map" % action)

    # 3. map vs backend transition matrix
    eng_tr = engine_transitions()
    for frm, targets in sorted(perm.get("transitions", {}).items()):
        if frm not in eng_tr:
            problems.append("transition source '%s' missing from the backend" % frm)
            continue
        for to, roles in sorted(targets.items()):
            back = eng_tr[frm].get(to)
            if back is None:
                problems.append("backend has no transition %s -> %s" % (frm, to))
            elif norm_roles(back) != norm_roles(roles):
                problems.append("transition %s -> %s: backend %s vs map %s"
                                % (frm, to, norm_roles(back), norm_roles(roles)))
    for frm in sorted(eng_tr):
        if frm not in perm.get("transitions", {}):
            problems.append("backend transition source '%s' has no map entry" % frm)

    # 4. every role in the map is a real role
    for action, roles in perm.get("actions", {}).items():
        for r in roles:
            if r not in KNOWN_ACTORS:
                problems.append("action '%s' lists unknown role '%s'" % (action, r))

    # 5. the frontend must consume the mirror, not a private copy
    ui_text = open(UI, encoding="utf-8").read()
    if "window.PermissionMap" not in ui_text:
        problems.append("js/ui.js does not read the shared permission map")

    pages = perm.get("pages", {})
    actions = perm.get("actions", {})
    tr = perm.get("transitions", {})
    print("pages: %d   actions: %d   transition sources: %d"
          % (len(pages), len(actions), len(tr)))
    for role in ROLES:
        pg = sorted(p for p, r in pages.items() if role in r)
        ac = sorted(a for a, r in actions.items() if role in r)
        print("  %-12s pages=%-2d actions=%-2d" % (role, len(pg), len(ac)))

    if problems:
        print("\nPERMISSION PARITY: FAIL")
        for p in problems:
            print("  - %s" % p)
        return 1
    print("\nPERMISSION PARITY: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
