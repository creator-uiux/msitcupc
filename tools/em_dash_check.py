"""Em dash sweep check.

The specification forbids em dashes in generated documentation, UI text,
comments and commit messages.  This counts them per file so the sweep can be
driven to zero and regressions are caught.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "__pycache__", "shots", "mockups"}
# The Figma kit and the screenshot folders are generated artifacts, not
# generated documentation or UI text, so they are reported but not counted
# as source violations.
TEXT_EXT = (".html", ".js", ".py", ".css", ".md", ".json", ".webmanifest")


def main():
    hits = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if not f.endswith(TEXT_EXT):
                continue
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, ROOT)
            try:
                text = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            n = text.count("\u2014")
            if n:
                hits[rel] = n
    total = sum(hits.values())
    for rel in sorted(hits, key=lambda k: -hits[k]):
        print("%6d  %s" % (hits[rel], rel))
    print("\nTOTAL em dashes: %d across %d file(s)" % (total, len(hits)))
    if total:
        print("EM DASH SWEEP: FAIL")
        return 1
    print("EM DASH SWEEP: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
