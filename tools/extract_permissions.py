"""Extract the backend action guard matrix from server/engine.py.

Prints a JSON object of method name -> allowed roles, read straight from the
`_guard(state, [...])` call that opens each action.  Used to build
permissions.json, which is then the single source of truth for both the
backend and the frontend mirror.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, "server", "engine.py")


def main():
    text = open(ENGINE, encoding="utf-8").read()
    # Walk the file, tracking the most recent `def name(` and the first
    # `_guard(state, [...])` inside it.
    out = {}
    current = None
    for line in text.splitlines():
        m = re.match(r"\s*def ([a-z_][a-z0-9_]*)\(", line)
        if m:
            current = m.group(1)
            continue
        m = re.search(r"_guard\(state,\s*\[([^\]]*)\]\)", line)
        if m and current and current not in out:
            roles = [r.strip().strip('"\'') for r in m.group(1).split(",") if r.strip()]
            out[current] = roles
    print(json.dumps(out, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
