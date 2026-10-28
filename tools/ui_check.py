"""UI consistency check.

The house rule of the interface is that every screen is built the same way,
from the same kit, with no one-off inline styles.  That rule is easy to break
by accident, so it is checked here:

  1. every page loads the three stylesheets, in the same order (the sign-in
     page adds its own login.css last)
  2. no page carries an inline style, apart from the handful of values that
     are genuinely computed at run time (a bar width, a row index, a role
     accent colour)
  3. every page that uses the application shell carries the four chrome
     placeholders, so the sidebar, app bar, top bar and bottom bar are
     rendered the same way
  4. every application page opens with the same page head
  5. every class used in the markup is defined in one of the stylesheets,
     so a typo or a removed rule cannot leave a page half styled
  6. no page carries its own <style> block -- that is what css/kit.css is for

Run:  python tools/ui_check.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Pages that are not application screens and therefore have no shell and no
# page head: the landing page, the sign-in page, the 404 page and the
# offline page.
NO_SHELL = {"index.html", "login.html", "404.html", "offline.html"}
NO_HEAD = {"index.html", "login.html", "404.html", "offline.html"}

STYLESHEETS = ["app.css", "green.css", "kit.css"]
APP_STYLESHEETS = STYLESHEETS + ["console.css"]
LOGIN_STYLESHEETS = STYLESHEETS + ["login.css"]

# Inline styles that are computed at run time and therefore allowed.
ALLOWED_INLINE = [
    re.compile(r"^\s*--[a-z0-9-]+\s*:"),              # a CSS custom property
    re.compile(r"^\s*width\s*:\s*[\d.]+%\s*$"),         # a bar / meter width
    re.compile(r"^\s*background\s*:\s*"),               # a role accent colour
    re.compile(r"^\s*--rc\s*:"),                        # a role card accent
    re.compile(r"^\s*--rt\s*:"),
]

TOKEN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
OPERATORS = set("+()?:!")

fail = 0
problems = []


def fail_page(name, message):
    global fail
    fail += 1
    problems.append("%s: %s" % (name, message))


def segments(value):
    """Split a class attribute value into (text, in_literal) segments.

    A class attribute may be built by string concatenation, so the raw value
    looks like:   btn ' + (off ? 'btn-soft' : 'btn-danger-soft') + ' btn-sm
    """
    out, buf, i, literal = [], "", 0, False
    while i < len(value):
        ch = value[i]
        if ch in "\"'":
            if buf:
                out.append((buf, literal))
                buf = ""
            literal = not literal
            i += 1
            continue
        buf += ch
        i += 1
    if buf:
        out.append((buf, literal))
    return out


def class_tokens(value, known):
    """The class names a class attribute value contributes.

    A value that is a plain list is taken at face value.  A value that is
    built by concatenation is split into its literal and non-literal parts,
    and a part only counts as a class list when it holds a dashed name or a
    name the stylesheets already know -- otherwise it is JavaScript code
    that happens to sit inside the attribute.
    """
    plain = not any(c in value for c in "\"'")
    found = []
    for text, in_literal in segments(value):
        tokens = [t for t in text.split() if TOKEN.match(t) and not t.endswith("-")]
        if not tokens:
            continue
        if plain:
            found.extend(tokens)
            continue
        if any(c in OPERATORS for c in text):
            continue
        if any("-" in t for t in tokens) or any(t in known for t in tokens):
            found.extend(tokens)
    return found


def classes_used(src, known):
    used = set()
    for m in re.finditer(r'\bclass="', src):
        start = m.end()
        end = src.find('"', start)
        if end == -1:
            continue
        used.update(class_tokens(src[start:end], known))
    return used


def main():
    global fail
    css = ""
    for name in APP_STYLESHEETS + ["login.css"]:
        path = os.path.join(ROOT, "css", name)
        if not os.path.isfile(path):
            print("!! missing stylesheet: css/%s" % name)
            return 2
        css += open(path, encoding="utf-8").read()
    defined = set(re.findall(r"\.([A-Za-z][A-Za-z0-9_-]*)", css))

    pages = sorted(f for f in os.listdir(ROOT)
                   if f.endswith(".html") and not f.startswith("__"))
    checked = 0

    for name in pages:
        src = open(os.path.join(ROOT, name), encoding="utf-8").read()

        # 1 - the stylesheets, in order
        links = re.findall(r'<link rel="stylesheet" href="([^"]+)">', src)
        got = [l.rsplit("/", 1)[-1] for l in links]
        if name == "login.html":
            expected = LOGIN_STYLESHEETS
        elif name in NO_SHELL:
            expected = STYLESHEETS
        else:
            expected = APP_STYLESHEETS
        if got != expected:
            fail_page(name, "stylesheets are %s, expected %s" % (got, expected))

        # 2 - no inline styles
        for m in re.finditer(r'style="([^"]*)"', src):
            value = m.group(1)
            # a value built by concatenation is computed at run time
            if "+" in value:
                continue
            if any(p.match(value) for p in ALLOWED_INLINE):
                continue
            fail_page(name, "inline style: %s" % value.strip()[:70])

        # 3 - the shell placeholders
        if name not in NO_SHELL:
            for placeholder in ("chromeSide", "chromeAppbar", "chromeTopbar", "chromeBottom"):
                if 'id="%s"' % placeholder not in src:
                    fail_page(name, "missing shell placeholder #%s" % placeholder)

        # 4 - the page head
        if name not in NO_HEAD:
            if not re.search(r'<main class="content">\s*<div class="sec-title[^"]*">\s*<h2', src):
                fail_page(name, "the page does not open with a .sec-title page head")

        # 5 - every class is defined
        for cls in sorted(classes_used(src, defined)):
            if cls not in defined:
                fail_page(name, "class not defined in the stylesheets: .%s" % cls)

        # 6 - no page-local style block
        if re.search(r"<style[\s>]", src):
            fail_page(name, "the page carries its own <style> block")

        checked += 1

    print("checked %d pages" % checked)
    if problems:
        print()
        for p in problems:
            print("  FAIL %s" % p)
    print()
    print("UI CONSISTENCY", "FAILED (%d)" % fail if fail else "PASSED")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
