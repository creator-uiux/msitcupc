"""Replace em dashes with the double hyphen used everywhere else in the app.

Run with --check to report only, or with no argument to rewrite in place.
Generated artifact folders (figma-kit, shots, mockups) are included because
they are served as part of the site.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
TEXT_EXT = (".html", ".js", ".py", ".css", ".md", ".json", ".webmanifest", ".txt")


def main():
    check = "--check" in sys.argv
    total = 0
    changed = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if not f.endswith(TEXT_EXT):
                continue
            p = os.path.join(dirpath, f)
            rel = os.path.relpath(p, ROOT)
            try:
                text = open(p, encoding="utf-8").read()
            except (OSError, UnicodeDecodeError):
                continue
            n = text.count("\u2014")
            if not n:
                continue
            total += n
            if not check:
                out = text.replace("\u2014", "--")
                with open(p, "w", encoding="utf-8", newline="") as fh:
                    fh.write(out)
            changed.append((rel, n))
    for rel, n in sorted(changed, key=lambda x: -x[1]):
        print("%6d  %s" % (n, rel))
    print("\n%s %d em dash(es) in %d file(s)"
          % ("would replace" if check else "replaced", total, len(changed)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
