"""Build the frontend feature mirror from features.json.

features.json is the single switchboard for presentation capabilities that
are not required by the source PDF, the owner's reference pictures or the
owner's explicit requests. Each entry has an `enabled` boolean. The browser
reads the generated js/features.js, so a page never hard-codes a decision.

Run:    python tools/build_features.py
Check:  python tools/feature_parity_check.py
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "features.json")
MIRROR = os.path.join(ROOT, "js", "features.js")
NAME_RE = re.compile(r"^[a-z][a-zA-Z0-9]*$")


def read_source():
    with open(SOURCE, encoding="utf-8") as fh:
        data = json.load(fh)
    features = data.get("features")
    if not isinstance(features, dict) or not features:
        raise SystemExit("features.json has no 'features' object")
    flags = {}
    for name, entry in features.items():
        if not NAME_RE.match(name):
            raise SystemExit("feature name is not camelCase: %s" % name)
        if not isinstance(entry, dict) or not isinstance(entry.get("enabled"), bool):
            raise SystemExit("feature %s needs a boolean 'enabled' field" % name)
        flags[name] = entry["enabled"]
    return data, flags


def mirror_text(flags):
    lines = [
        "/* features.js -- GENERATED FILE, do not edit by hand.",
        " *",
        " * Source of truth: features.json at the repository root.",
        " * Rebuild with: python tools/build_features.py",
        " * Verify with:   python tools/feature_parity_check.py",
        " *",
        " * Every flag is OFF unless the owner asks for the capability. A flag",
        " * only hides presentation; permissions and the backend stay the",
        " * authority for what a role may do.",
        " */",
        "(function (global) {",
        "  'use strict';",
        "  var FLAGS = " + json.dumps(flags, indent=2, sort_keys=True) + ";",
        "  function on(name) { return FLAGS[name] === true; }",
        "  global.Features = {",
        "    flags: FLAGS,",
        "    on: on,",
        "    off: function (name) { return !on(name); },",
        "    all: function () {",
        "      var out = {};",
        "      for (var k in FLAGS) {",
        "        if (Object.prototype.hasOwnProperty.call(FLAGS, k)) out[k] = FLAGS[k];",
        "      }",
        "      return out;",
        "    }",
        "  };",
        "})(window);",
        "",
    ]
    return "\n".join(lines)


def main():
    data, flags = read_source()
    text = mirror_text(flags)
    if "--check" in sys.argv:
        if not os.path.isfile(MIRROR):
            print("FEATURES BUILD: FAIL (js/features.js is missing)")
            return 1
        have = open(MIRROR, encoding="utf-8").read()
        if have != text:
            print("FEATURES BUILD: FAIL (js/features.js is stale)")
            return 1
        print("FEATURES BUILD: PASS (%d flags)" % len(flags))
        return 0
    with open(MIRROR, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    enabled = sorted(k for k, v in flags.items() if v)
    print("wrote %s" % os.path.relpath(MIRROR, ROOT))
    print("  flags: %d" % len(flags))
    print("  enabled: %s" % (", ".join(enabled) if enabled else "none"))
    print("  off: %s" % ", ".join(sorted(k for k, v in flags.items() if not v)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
