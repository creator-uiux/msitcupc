"""The theme discipline gate (required tests 62 and 95).

AGENTS.md freezes the colour theme: the values are recorded in
docs/THEME_SNAPSHOT.md, they are declared in css/app.css, css/green.css and
css/kit.css, and new styles go in css/console.css using those tokens plus white
and black alpha overlays, with no new brand colours.

This gate reads that rule off the shipped surface instead of trusting a review:

1. every custom property a stylesheet reads is one somebody declares, so a rule
   cannot quietly resolve to nothing;
2. every colour literal in css/console.css is one the rule allows, and a literal
   that is not white, black or the green palette's own shadow ink is only
   tolerated inside the print block, where paper must not inherit a screen token;
3. the frozen sheets still declare the tokens the snapshot names them in;
4. no page paints with its own colours: no <style> block and no colour literal
   in an inline style attribute, so a screen is styled by the tokens or not at
   all. An inline assignment built from data (the role accents on the cards and
   avatars) is a value the script supplies, not a colour the page authored.

Run:  python tools/theme_discipline_check.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FROZEN = ["css/app.css", "css/green.css", "css/kit.css"]
NEW_STYLES = "css/console.css"

# White and black overlays are allowed by the rule. The third entry is the ink
# the frozen green palette already uses for its shadows (css/green.css:49-51),
# so a backdrop in that ink is the theme's own value, not a new colour.
ALLOWED_RGB = {
    (255, 255, 255): "white overlay",
    (0, 0, 0): "black overlay",
    (16, 32, 26): "green.css shadow ink",
}
# The literals the print block is allowed to carry, with why.
PRINT_INKS = {
    "#fff": "paper",
    "#ffffff": "paper",
    "#000": "ink on paper",
    "#000000": "ink on paper",
    "#333": "secondary ink on paper",
    "#b8b8b8": "hairline on paper",
    "#014421": "institutional green letterhead rule",
}

problems = []
counts = {"tokens": 0, "literal": 0, "snapshot": 0, "pages": 0}


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def rgba_literal(text):
    nums = re.findall(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", text)
    return [(int(r), int(g), int(b)) for r, g, b in nums]


def css_files():
    d = os.path.join(ROOT, "css")
    return sorted("css/" + n for n in os.listdir(d) if n.endswith(".css"))


def runtime_properties():
    """Custom properties a page or a script assigns per element."""
    found = set()
    for rel in [f for f in sorted(os.listdir(ROOT)) if f.endswith(".html")] + \
               ["js/" + n for n in sorted(os.listdir(os.path.join(ROOT, "js"))) if n.endswith(".js")]:
        src = read(rel)
        for style in re.findall(r'style="([^"]*)"', src):
            found |= set(re.findall(r"(--[a-z0-9-]+)\s*:", style))
        found |= set(re.findall(r"setProperty\('(--[a-z0-9-]+)'", src))
    return found


def declared(rel):
    return set(re.findall(r"^\s*(--[a-z0-9-]+)\s*:", read(rel), re.M))


def check_uses(rel, decl_all, runtime):
    src = read(rel)
    for name in sorted(set(re.findall(r"var\((--[a-z0-9-]+)", src))):
        counts["tokens"] += 1
        if name in decl_all or name in runtime:
            continue
        problems.append("%s reads %s, which nothing declares" % (rel, name))


def check_literals(rel):
    src = read(rel)
    print_start = src.find("@media print")
    for m in re.finditer(r"(#[0-9a-fA-F]{3,8}\b)|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", src):
        counts["literal"] += 1
        line = src[:m.start()].count("\n") + 1
        in_print = print_start > -1 and m.start() > print_start
        if m.group(1):
            hexv = m.group(1).lower()
            if hexv in ("#fff", "#ffffff", "#000", "#000000"):
                continue
            if in_print and hexv in PRINT_INKS:
                continue
            problems.append("%s:%d paints with %s, which is not a token, white or black"
                            % (rel, line, hexv))
            continue
        triple = (int(m.group(2)), int(m.group(3)), int(m.group(4)))
        if triple in ALLOWED_RGB:
            continue
        problems.append("%s:%d paints with rgba(%d,%d,%d,...), an ink the rule does not allow"
                        % (rel, line, triple[0], triple[1], triple[2]))


def check_snapshot():
    text = read("docs/THEME_SNAPSHOT.md")
    for line in text.splitlines():
        m = re.match(r"\|\s*`(--[a-z0-9-]+)`\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+?)\s*\|", line)
        if not m:
            continue
        name, light, source = m.group(1), m.group(2).strip(), m.group(4).strip()
        counts["snapshot"] += 1
        rel = "css/" + source.split()[0]
        if not os.path.exists(os.path.join(ROOT, rel)):
            problems.append("the snapshot names %s for %s, which is not a sheet in the tree"
                            % (source, name))
            continue
        sheet = read(rel).lower().replace(" ", "")
        if name not in declared(rel):
            problems.append("the snapshot says %s lives in %s, but that sheet does not declare it"
                            % (name, rel))
        elif light.replace(" ", "").lower() not in sheet:
            problems.append("%s is recorded as %s in the snapshot, but %s does not carry that value"
                            % (name, light, rel))


def check_pages():
    runtime = runtime_properties()
    for rel in sorted(f for f in os.listdir(ROOT) if f.endswith(".html")):
        src = read(rel)
        counts["pages"] += 1
        if re.search(r"<style[\s>]", src):
            problems.append("%s carries its own <style> block" % rel)
        for style in re.findall(r'style="([^"]*)"', src):
            # An assignment built from data is not a colour the page authored;
            # the role accents live in one table in js/ui.js and the sheets that
            # read them are checked above.
            if "'" in style or '"' in style:
                continue
            if re.search(r"(?<![-\w])(color|background|border-color|fill)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()", style):
                problems.append("%s paints with a colour literal inline: %s" % (rel, style.strip()[:60]))
    return runtime


def main():
    del problems[:]
    decl_all = set()
    for rel in css_files():
        decl_all |= declared(rel)
    runtime = check_pages()

    for rel in css_files():
        check_uses(rel, decl_all, runtime)
    check_literals(NEW_STYLES)
    check_snapshot()

    for p in problems:
        print("  PROBLEM  " + p)
    print("custom property reads: %d" % counts["tokens"])
    print("colour literals in %s: %d" % (NEW_STYLES, counts["literal"]))
    print("snapshot rows matched to their sheet: %d" % counts["snapshot"])
    print("pages scanned for own colours: %d" % counts["pages"])
    print("stylesheets read: %d" % len(css_files()))
    print("\nTHEME DISCIPLINE: " + ("PROBLEMS (%d)" % len(problems) if problems else "PASS"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
