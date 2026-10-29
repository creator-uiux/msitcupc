"""Feature registry parity and wiring check.

Proves that:

  1. js/features.js matches features.json exactly
  2. every flag referenced by a page or script exists in the registry
  3. every registered flag is referenced at least once
  4. every workspace page loads js/features.js before js/ui.js, except the
     frozen sign-in page, which never mounts the workspace chrome

Run: python tools/feature_parity_check.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "features.json")
MIRROR = os.path.join(ROOT, "js", "features.js")
FROZEN = {"login.html", "404.html", "offline.html"}
REF_RE = re.compile(r"\b(?:UI\.feature|Features\.(?:on|off)|feature)\(\s*['\"]([a-zA-Z0-9]+)['\"]\s*\)")

problems = []


def registered():
    with open(SOURCE, encoding="utf-8") as fh:
        data = json.load(fh)
    return {k: v.get("enabled") for k, v in (data.get("features") or {}).items()}


def mirror_flags():
    text = open(MIRROR, encoding="utf-8").read()
    m = re.search(r"var FLAGS = (\{.*?\n\});", text, re.S)
    if not m:
        problems.append("could not find the FLAGS object in js/features.js")
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        problems.append("could not parse the FLAGS object in js/features.js")
        return None


def walk_sources():
    for name in sorted(os.listdir(ROOT)):
        if name.endswith(".html"):
            yield name, open(os.path.join(ROOT, name), encoding="utf-8").read()
    js_dir = os.path.join(ROOT, "js")
    for name in sorted(os.listdir(js_dir)):
        if name.endswith(".js"):
            yield "js/" + name, open(os.path.join(js_dir, name), encoding="utf-8").read()


def main():
    flags = registered()
    mirror = mirror_flags()
    if mirror is not None and mirror != flags:
        only_src = sorted(set(flags) - set(mirror))
        only_mirror = sorted(set(mirror) - set(flags))
        if only_src:
            problems.append("missing from js/features.js: %s" % ", ".join(only_src))
        if only_mirror:
            problems.append("not in features.json: %s" % ", ".join(only_mirror))
        for name in sorted(set(flags) & set(mirror)):
            if flags[name] != mirror[name]:
                problems.append("flag %s differs: json=%s mirror=%s"
                                % (name, flags[name], mirror[name]))

    referenced = {}
    pages = []
    for name, text in walk_sources():
        for m in REF_RE.finditer(text):
            referenced.setdefault(m.group(1), set()).add(name)
        if not name.endswith(".html") or name in FROZEN:
            continue
        pages.append(name)
        if "js/ui.js" in text or name == "index.html":
            if "js/features.js" not in text:
                problems.append("%s does not load js/features.js" % name)
            elif "js/ui.js" in text and text.index("js/features.js") > text.index("js/ui.js"):
                problems.append("%s loads js/features.js after js/ui.js" % name)
        else:
            problems.append("%s is a workspace page without the workspace shell" % name)

    for name, files in sorted(referenced.items()):
        if name not in flags:
            problems.append("unknown feature '%s' referenced by %s"
                            % (name, ", ".join(sorted(files))))
    for name in sorted(flags):
        if name not in referenced:
            problems.append("registered feature '%s' is not referenced anywhere" % name)

    print("flags: %d   workspace pages checked: %d" % (len(flags), len(pages)))
    for name in sorted(flags):
        state = "on" if flags[name] else "off"
        uses = ", ".join(sorted(referenced.get(name, []))) or "unused"
        print("  %-26s %-3s  %s" % (name, state, uses))

    if problems:
        print("\nFEATURE PARITY: FAIL")
        for p in problems:
            print("  - %s" % p)
        return 1
    print("\nFEATURE PARITY: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
