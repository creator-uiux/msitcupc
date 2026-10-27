"""Appendix C coverage check for the Workflow Guide data.

Verifies js/flowdata.js against the Appendix C node and edge lists from the
master specification:

  * every node N00..N80 is present exactly once
  * only N75 (the PDF legend artifact) is ignored
  * every edge source and target resolves to a real node
  * the lane names are the PDF lane names, in PDF order
  * no edge targets the legend node
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "js", "flowdata.js")

EXPECTED_NODES = ["N%02d" % i for i in range(0, 81)]
EXPECTED_LANES = [
    "Office Requester or Office Representative",
    "IT Coordinator",
    "IT Technician",
    "System",
]

problems = []


def read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def main():
    src = read_text(SRC)

    lanes = re.findall(r"name:\s*'([^']+)',\s*role:", src)
    if lanes != EXPECTED_LANES:
        problems.append("lane names/order mismatch: %r" % (lanes,))

    node_block = src[src.index("var NODES = ["):src.index("/* Connectors")]
    ids = re.findall(r"\{ id: '(N\d\d)'", node_block)
    if ids != EXPECTED_NODES:
        missing = sorted(set(EXPECTED_NODES) - set(ids))
        extra = sorted(set(ids) - set(EXPECTED_NODES))
        problems.append("node ids mismatch (missing=%s extra=%s order_ok=%s)"
                        % (missing, extra, ids == EXPECTED_NODES))
    if len(ids) != len(set(ids)):
        problems.append("duplicate node ids")

    ignored = re.findall(r"\{ id: '(N\d\d)'[^}]*ignore:\s*true", node_block)
    if ignored != ["N75"]:
        problems.append("only N75 may be ignored, got %r" % (ignored,))

    edge_block = src[src.index("var EDGES = ["):src.index("var byId = {}")]
    edges = re.findall(r"\['(N\d\d)',\s*'(N\d\d)'", edge_block)
    if not edges:
        problems.append("no edges parsed")
    for a, b in edges:
        if a not in EXPECTED_NODES or b not in EXPECTED_NODES:
            problems.append("edge references unknown node: %s -> %s" % (a, b))
        if a == "N75" or b == "N75":
            problems.append("legend edge must not be implemented: %s -> %s" % (a, b))

    # duplicate connectors (same source and target) are not in the PDF
    seen = {}
    for a, b in edges:
        seen.setdefault((a, b), 0)
        seen[(a, b)] += 1
    for k, v in seen.items():
        if v > 1:
            problems.append("duplicate connector %s -> %s x%d" % (k[0], k[1], v))

    print("nodes: %d (expected %d, %d implemented)" % (
        len(ids), len(EXPECTED_NODES), len(ids) - len(ignored)))
    print("edges: %d implemented" % len(edges))
    print("lanes: %s" % " | ".join(lanes))

    if problems:
        print("\nAPPENDIX C COVERAGE: FAIL")
        for p in problems:
            print("  - %s" % p)
        return 1
    print("\nAPPENDIX C COVERAGE: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
