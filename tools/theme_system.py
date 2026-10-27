"""Retired: the System (prefers-color-scheme) option no longer exists.

The theme picker offers Light and Dark only, and the dark theme is applied
solely through `html[data-theme="dark"]`, so there is no OS-driven variant to
map.  This script is kept only so that running it does not re-introduce a
system theme; it changes nothing.

Use tools/theme_default.py to refresh the pre-paint script on every page.
"""
import sys


def main():
    print("the System theme was removed; the picker is Light / Dark only")
    print("  nothing to do (css/app.css left untouched)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
