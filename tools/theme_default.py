"""Set the default theme to Light and keep colour-scheme in step.

The pre-paint script on every page decides the theme before the first paint.
It understands two choices:

  light   data-theme="light"   (the default)
  dark    data-theme="dark"

There is no system/OS-driven choice, so the browser `color-scheme` is set at
the same time so form controls and scrollbars match.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {".git", "node_modules", "__pycache__", "shots", "mockups", "figma-kit", "docs"}

NEW = (
    "<script>(function(){try{"
    "var tm=/[?&]theme=(dark|light)\\b/.exec(location.search);"
    "var t=tm?tm[1]:(localStorage.getItem(\"itc_theme\")||\"light\");"
    "if(t!==\"dark\")t=\"light\";"
    "document.documentElement.setAttribute(\"data-theme\",t);"
    "document.documentElement.style.colorScheme=t;"
    "}catch(e){}})();</script>"
)

OLD_RE = re.compile(r"<script>\(function\(\)\{try\{var tm=.*?</script>", re.S)


def main():
    changed = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            if not f.endswith(".html"):
                continue
            p = os.path.join(dirpath, f)
            text = open(p, encoding="utf-8").read()
            m = OLD_RE.search(text)
            if not m:
                continue
            if m.group(0) == NEW:
                continue
            text = text[:m.start()] + NEW + text[m.end():]
            with open(p, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
            changed += 1
    print("theme default set to Light on %d page(s)" % changed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
