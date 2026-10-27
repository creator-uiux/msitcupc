"""Build the public site folder for Firebase Hosting.

The repository root is the working tree, so pointing Firebase Hosting at it
would publish everything: the backend source, the developer documentation,
the screenshot captures and the local scratch files.  The ignore globs in
firebase.json are not applied reliably when the public directory is the
project root, so the published set is assembled here instead, from an
explicit allow list.

    python tools/build_public.py          # rebuild public/
    python tools/build_public.py --check  # report what would be published

The result is written to public/, which is git-ignored.  Only public/ is
deployed.
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public")

# The folders that make up the site.
DIRS = ["css", "js", "img", "icons"]

# The files at the root of the site.
ROOT_FILES = [
    "404.html",
    "audit.html",
    "confirm.html",
    "dashboard.html",
    "favicon.svg",
    "flow.html",
    "ic-confirm.html",
    "ic-dashboard.html",
    "ic-flow.html",
    "ic-maintenance.html",
    "ic-notifications.html",
    "ic-profile.html",
    "ic-register.html",
    "ic-reports.html",
    "ic-request.html",
    "ic-review.html",
    "ic-roles.html",
    "ic-ticket.html",
    "ic-tickets.html",
    "index.html",
    "itc-dashboard.html",
    "itc-flow.html",
    "itc-maintenance.html",
    "itc-notifications.html",
    "itc-profile.html",
    "itc-register.html",
    "itc-reports.html",
    "itc-roles.html",
    "itc-technician.html",
    "itc-ticket.html",
    "itc-tickets.html",
    "login.html",
    "maintenance.html",
    "manifest.webmanifest",
    "mgmt-audit.html",
    "mgmt-dashboard.html",
    "mgmt-flow.html",
    "mgmt-maintenance.html",
    "mgmt-notifications.html",
    "mgmt-offices.html",
    "mgmt-profile.html",
    "mgmt-register.html",
    "mgmt-reports.html",
    "mgmt-roles.html",
    "mgmt-settings.html",
    "mgmt-ticket.html",
    "mgmt-tickets.html",
    "mgmt-users.html",
    "notifications.html",
    "offices.html",
    "offline.html",
    "or-confirm.html",
    "or-dashboard.html",
    "or-flow.html",
    "or-notifications.html",
    "or-profile.html",
    "or-register.html",
    "or-reports.html",
    "or-request.html",
    "or-roles.html",
    "or-ticket.html",
    "or-tickets.html",
    "permissions.json",
    "profile.html",
    "README.md",
    "register.html",
    "reports.html",
    "request.html",
    "review.html",
    "roles.html",
    "settings.html",
    "sw.js",
    "technician.html",
    "ticket.html",
    "tickets.html",
    "users.html",
]

# Never publish these, whatever their folder.
SKIP_SUFFIX = (".bak", ".py", ".md", ".webp", ".pdf", ".sqlite3", ".sqlite3-shm",
                ".sqlite3-wal")


def wanted_files():
    """The exact set of files the site is made of."""
    out = []
    for name in ROOT_FILES:
        path = os.path.join(ROOT, name)
        if os.path.isfile(path):
            out.append((path, name))
    for d in DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            path = os.path.join(base, name)
            if not os.path.isfile(path):
                continue
            if name.lower().endswith(SKIP_SUFFIX) and name.lower() != "readme.md":
                continue
            out.append((path, d + "/" + name))
    return out


def main():
    check = "--check" in sys.argv
    files = wanted_files()
    total = sum(os.path.getsize(p) for p, _ in files)
    print("public set: %d file(s), %.2f MB" % (len(files), total / 1048576.0))
    for _, rel in files:
        print("  " + rel)
    if check:
        return 0

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    for src, rel in files:
        dst = os.path.join(OUT, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
    print("wrote %s" % os.path.relpath(OUT, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
