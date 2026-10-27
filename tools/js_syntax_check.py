"""Syntax check for every JavaScript file and every inline script block.

The em dash sweep rewrote many string literals; a single broken quote silently
kills a whole page (js/ui.js did exactly that).  This check parses each file
with node so the defect is caught at build time instead of at runtime.
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "mockups", "shots", "figma-kit", "__pycache__", "docs"}


def js_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if f.endswith(".js"):
                yield os.path.join(dirpath, f)


def html_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if f.endswith(".html"):
                yield os.path.join(dirpath, f)


def node_check(source, label):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as fh:
        fh.write(source)
        tmp = fh.name
    try:
        r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        if r.returncode != 0:
            first = (r.stderr or "").strip().splitlines()
            msg = next((l for l in first if "SyntaxError" in l), first[0] if first else "?")
            return msg
        return None
    finally:
        os.unlink(tmp)


def main():
    problems = []
    n_js = 0
    for p in js_files():
        n_js += 1
        src = open(p, encoding="utf-8", errors="replace").read()
        err = node_check(src, p)
        if err:
            problems.append("%s :: %s" % (os.path.relpath(p, ROOT), err))

    n_inline = 0
    for p in html_files():
        text = open(p, encoding="utf-8", errors="replace").read()
        for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", text, re.S | re.I):
            body = m.group(1)
            if not body.strip():
                continue
            n_inline += 1
            line = text[:m.start()].count("\n") + 1
            err = node_check(body, p)
            if err:
                problems.append("%s (inline script near line %d) :: %s"
                                % (os.path.relpath(p, ROOT), line, err))

    print("js files checked: %d" % n_js)
    print("inline script blocks checked: %d" % n_inline)
    if problems:
        print("\nJS SYNTAX: FAIL")
        for p in problems:
            print("  - %s" % p)
        return 1
    print("\nJS SYNTAX: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
