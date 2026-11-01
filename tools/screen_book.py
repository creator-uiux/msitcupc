"""Build the printable screen book from the Figma atlas.

The book is generated, not hand-written. It reads the frames through
tools/figma_manifest.py and takes each screen's what, what for and how from
docs/SCREEN_GUIDE.md, so the PDF cannot drift from the atlas or hide an
unexplained screen.

Layout: A4 landscape, one fixed page per screen. A page carries the lane and
screen title, the three explanations, the desktop and phone design canvases at
their captured sizes, the Figma frame names, the full-page archive names and
the source URL. The full-page PNGs stay in shots/ because the workflow guide is
tens of thousands of pixels tall and would be unreadable on paper.

The development Gallery (index.html) is not a product screen and is omitted.

Run:  python tools/screen_book.py
Writes: shots/screen-book.html and shots/screen-book.pdf
"""
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.join(ROOT, "shots")
GUIDE = os.path.join(ROOT, "docs", "SCREEN_GUIDE.md")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

sys.path.insert(0, HERE)
import figma_manifest  # noqa: E402


def guide_entries():
    """Map a source file to its what, what for and how to use it text."""
    text = open(GUIDE, encoding="utf-8").read()
    out = {}
    for block in re.finditer(r"^## ([a-z0-9-]+\.html)\n(.*?)(?=^## |\Z)",
                             text, re.M | re.S):
        source, body = block.group(1), block.group(2)
        parts = re.split(r"\*\*(What it is|What it is for|How to use it)\.\*\*", body)
        fields = {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}
        how = []
        for item in re.split(r"\n(?=\d+\.\s)", fields.get("How to use it", "").strip()):
            item = re.sub(r"^\d+\.\s+", "", item.strip())
            item = " ".join(item.split())
            if item:
                how.append(item)
        out[source] = {
            "what": " ".join(fields.get("What it is", "").split()),
            "why": " ".join(fields.get("What it is for", "").split()),
            "how": how,
        }
    return out


def inline(text):
    esc = html.escape(text)
    esc = re.sub(r"`([^`]+)`", r"<code>\1</code>", esc)
    return esc


def screens():
    """Group the manifest rows into one record per screen, in atlas order."""
    groups, order = {}, []
    for row in figma_manifest.rows():
        source = row["source_url"].split("?", 1)[0]
        key = (row["figma_page"], source)
        if key not in groups:
            groups[key] = {
                "lane": row["figma_page"],
                "source": source,
                "stem": source[:-5],
                "title": row["page_title"],
                "frames": {},
            }
            order.append(key)
        groups[key]["frames"][(row["viewport"], row["frame_mode"])] = row
    return [groups[key] for key in order]


def read_book():
    guides = guide_entries()
    records = screens()
    missing = []
    for record in records:
        guide = guides.get(record["source"])
        if not guide or not guide["what"] or not guide["why"] or len(guide["how"]) < 2:
            missing.append("%s (missing what, what for or how)" % record["source"])
        record["guide"] = guide
        for needed in (("desktop", "canvas"), ("mobile", "canvas"),
                       ("desktop", "full-page"), ("mobile", "full-page")):
            if needed not in record["frames"]:
                missing.append("%s frame %s-%s" % (record["source"], needed[0], needed[1]))
    return records, missing


def figure(record, viewport, cls):
    row = record["frames"][(viewport, "canvas")]
    return (
        '<figure class="%s"><img src="%s" alt="%s %s">'
        '<figcaption><b>%s canvas</b><span>%d x %d | %s</span></figcaption></figure>'
        % (cls, html.escape(row["file"]), html.escape(record["title"]),
           "desktop" if viewport == "desktop" else "phone",
           "Desktop" if viewport == "desktop" else "Phone",
           row["width_px"], row["height_px"], html.escape(row["frame_name"]))
    )


def screen_page(record, number, total):
    desktop = record["frames"][("desktop", "canvas")]
    phone = record["frames"][("mobile", "canvas")]
    full_d = record["frames"][("desktop", "full-page")]
    full_m = record["frames"][("mobile", "full-page")]
    files = [record["frames"][k]["file"] for k in
             (("desktop", "canvas"), ("mobile", "canvas"),
              ("desktop", "full-page"), ("mobile", "full-page"))]
    kv = [
        ("Figma page", html.escape(record["lane"])),
        ("Source URL", "<code>%s</code>" % html.escape(record["source"] + "?demo=1")),
        ("Desktop frame", "<code>%s</code> %d x %d" %
         (html.escape(desktop["frame_name"]), desktop["width_px"], desktop["height_px"])),
        ("Phone frame", "<code>%s</code> %d x %d" %
         (html.escape(phone["frame_name"]), phone["width_px"], phone["height_px"])),
        ("Full-page archive",
         "<code>%s</code> %d x %d<br><code>%s</code> %d x %d" %
         (html.escape(full_d["frame_name"]), full_d["width_px"], full_d["height_px"],
          html.escape(full_m["frame_name"]), full_m["width_px"], full_m["height_px"])),
        ("PNG files", "<br>".join("<code>%s</code>" % html.escape(f) for f in files)),
    ]
    meta = "".join('<div class="kv"><span>%s</span><div>%s</div></div>' % (k, v) for k, v in kv)
    guide = record["guide"]
    steps = "".join("<li>%s</li>" % inline(step) for step in guide["how"])
    guide_html = (
        '<aside class="guide">'
        '<h3>What it is</h3><p>%s</p>'
        '<h3>What it is for</h3><p>%s</p>'
        '<h3>How to use it</h3><ol>%s</ol>'
        '</aside>' % (inline(guide["what"]), inline(guide["why"]), steps))
    return """<section class="page screen">
  <div class="head">
    <div class="eyebrow">%s <em>/</em> Screen %02d</div>
    <h2>%s</h2>
  </div>
  <div class="body">%s%s%s</div>
  <div class="meta">%s</div>
  <div class="foot"><span>ITC Maintenance System | Screen atlas</span><span>%d / %d</span></div>
</section>""" % (html.escape(record["lane"]), number, html.escape(record["title"]),
                 figure(record, "desktop", "desktop"),
                 figure(record, "mobile", "phone"), guide_html, meta, number, total)


def cover_page(records, total):
    lanes = len({record["lane"] for record in records})
    frames = sum(len(record["frames"]) for record in records)
    return """<section class="page cover">
  <div class="mark">ITC MAINTENANCE SYSTEM</div>
  <h1>Screen atlas<br><span>and Figma hand-off</span></h1>
  <p class="lead">Every product screen with what it is, what it is for and how to use it, captured from the working app.</p>
  <div class="stats">
    <div><b>%d</b><span>screens</span></div>
    <div><b>%d</b><span>lanes</span></div>
    <div><b>%d</b><span>PNG frames</span></div>
    <div><b>2</b><span>viewports</span></div>
  </div>
  <div class="cover-note">
    <p>Each screen page states what the screen is, what it is for and how to use it, beside the desktop and phone design canvases.</p>
    <p>Desktop is captured at 1440 x 900 and phone at 390 x 844, each as a design canvas and as a full scroll height. Every frame loads <code>?demo=1</code>, so the seed and the clock are frozen and the images are identical on every run.</p>
    <p>The PDF is a readable archive and print copy. Figma still receives the flat PNG frames through <code>shots/figma-manifest.csv</code>; this file does not become editable Figma layers.</p>
  </div>
  <div class="foot"><span>Book generated %s</span><span>1 / %d</span></div>
</section>""" % (len(records), lanes, frames, date.today().strftime("%d %B %Y"), total)


def contents_page(records, start_page, total):
    columns = []
    for prefix, lane_name, _tag in figma_manifest.LANES:
        lane_records = [r for r in records if r["lane"] == lane_name]
        if not lane_records:
            continue
        rows = "".join(
            '<div class="toc-row"><span>%s</span><b>%d</b></div>'
            % (html.escape(r["title"]), start_page + records.index(r))
            for r in lane_records)
        columns.append('<div class="toc-col"><h3>%s <em>%d</em></h3>%s</div>'
                       % (html.escape(lane_name), len(lane_records), rows))
    return """<section class="page contents">
  <div class="eyebrow">Contents</div>
  <h2>Five lanes, one workflow</h2>
  <p class="lead">Each screen has one page: what it is, what it is for, how to use it, both design canvases and the source page.</p>
  <div class="toc">%s</div>
  <div class="foot"><span>ITC Maintenance System | Screen atlas</span><span>2 / %d</span></div>
</section>""" % ("".join(columns), total)


CSS = """
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif;
  color: #0f172a; background: #ffffff; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.page {
  width: 297mm; height: 210mm; padding: 12mm 14mm; position: relative;
  page-break-after: always; break-after: page; overflow: hidden; background: #ffffff;
}
.page:last-child { page-break-after: auto; break-after: auto; }
.eyebrow { font-size: 7.5pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #014421; }
.eyebrow em { font-style: normal; color: #94a3b8; }
h2 { font-size: 21pt; line-height: 1.05; margin: 1.5mm 0 2mm; letter-spacing: -.01em; }
.lead { color: #475569; font-size: 10pt; margin: 0 0 6mm; }
code { font-family: Consolas, "SFMono-Regular", monospace; font-size: .92em; color: #1e3a5f; }
.foot {
  position: absolute; left: 14mm; right: 14mm; bottom: 6mm; display: flex;
  justify-content: space-between; border-top: .25mm solid #e2e8f0; padding-top: 2mm;
  font-size: 7.5pt; color: #64748b;
}

.cover { background: #0f172a; color: #ffffff; }
.cover .mark { font-size: 8pt; font-weight: 800; letter-spacing: .22em; color: #9dd6b7; }
.cover h1 { font-size: 40pt; line-height: .98; margin: 12mm 0 4mm; letter-spacing: -.02em; }
.cover h1 span { color: #b6c2d2; }
.cover .lead { color: #cbd5e1; font-size: 12pt; margin-bottom: 12mm; }
.cover .stats { display: flex; gap: 10mm; margin-bottom: 12mm; }
.cover .stats div { border-left: .8mm solid #2f6f55; padding-left: 4mm; }
.cover .stats b { display: block; font-size: 24pt; line-height: 1; }
.cover .stats span { font-size: 8pt; color: #9fb0c4; text-transform: uppercase; letter-spacing: .1em; }
.cover-note { max-width: 190mm; color: #cbd5e1; font-size: 9pt; line-height: 1.55; }
.cover-note p { margin: 0 0 3mm; }
.cover-note code { color: #9dd6b7; }
.cover .foot { border-color: #334155; color: #94a3b8; }

.contents h2 { margin-bottom: 1mm; }
.toc { display: flex; gap: 6mm; margin-top: 6mm; align-items: flex-start; }
.toc-col { flex: 1; min-width: 0; }
.toc-col h3 { font-size: 10pt; margin: 0 0 2mm; color: #014421; display: flex; justify-content: space-between; }
.toc-col h3 em { font-style: normal; color: #64748b; font-weight: 600; }
.toc-row { display: flex; justify-content: space-between; gap: 2mm; font-size: 8.5pt; padding: 1.2mm 0; border-bottom: .2mm dotted #cbd5e1; }
.toc-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toc-row b { font-weight: 600; color: #64748b; }

.screen .head { height: 20mm; }
.screen h2 { margin-bottom: 0; }
.body { display: flex; gap: 4mm; align-items: flex-start; height: 103mm; }
.body figure { margin: 0; display: flex; flex-direction: column; min-width: 0; }
.body img { display: block; height: auto; width: auto; max-height: 96mm; border: .25mm solid #dbe3ee; border-radius: 1.5mm; }
.body .desktop img { max-width: 154mm; }
.body .phone img { max-width: 45mm; }
.body figcaption { padding-top: 2mm; display: flex; flex-direction: column; gap: .6mm; font-size: 7.5pt; color: #64748b; }
.body figcaption b { color: #334155; font-weight: 700; }
.guide { flex: 1; min-width: 0; height: 103mm; border-left: .3mm solid #e2e8f0; padding-left: 4mm; overflow: hidden; }
.guide h3 { font-size: 6.6pt; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: #014421; margin: 2.6mm 0 1mm; }
.guide h3:first-child { margin-top: 0; }
.guide p, .guide li { font-size: 7.1pt; line-height: 1.36; color: #334155; margin: 0; }
.guide ol { margin: 0; padding-left: 4mm; }
.guide li { margin-bottom: 1.1mm; }
.guide code { font-size: .92em; }
.meta { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 2mm 6mm; margin-top: 3mm; }
.kv { border-top: .25mm solid #e2e8f0; padding-top: 1.4mm; min-width: 0; }
.kv > span { display: block; font-size: 6.8pt; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: #64748b; margin-bottom: .8mm; }
.kv > div { font-size: 7.5pt; line-height: 1.45; color: #334155; overflow-wrap: anywhere; }
"""


def build_html(records, path):
    total = len(records) + 2
    pages = [cover_page(records, total), contents_page(records, 3, total)]
    pages += [screen_page(r, 3 + i, total) for i, r in enumerate(records)]
    doc = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>ITC Maintenance System - Screen atlas</title>
<style>%s</style></head><body>
%s
</body></html>""" % (CSS, "\n".join(pages))
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc)
    return len(pages)


def print_pdf(html_path, pdf_path):
    udd = tempfile.mkdtemp(prefix="screen_book_chrome_")
    try:
        subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
             "--hide-scrollbars", "--allow-file-access-from-files",
             "--no-pdf-header-footer", "--run-all-compositor-stages-before-draw",
             "--virtual-time-budget=20000", "--user-data-dir=" + udd,
             "--print-to-pdf=" + pdf_path, Path(html_path).as_uri()],
            check=True, timeout=180,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    finally:
        shutil.rmtree(udd, ignore_errors=True)


def main():
    if not os.path.exists(CHROME):
        print("!! Chrome not found at %s" % CHROME)
        return 2
    records, missing = read_book()
    if missing:
        print("!! the screen book would be incomplete:")
        for item in missing:
            print("   " + item)
        return 2
    os.makedirs(OUT, exist_ok=True)
    html_path = os.path.join(OUT, "screen-book.html")
    pdf_path = os.path.join(OUT, "screen-book.pdf")
    sections = build_html(records, html_path)
    print("wrote %s" % os.path.relpath(html_path, ROOT))
    print_html = "%d sections: cover, contents, %d screens" % (sections, len(records))
    print("  " + print_html)
    print_pdf(html_path, pdf_path)
    size = os.path.getsize(pdf_path)
    print("wrote %s (%.1f MB)" % (os.path.relpath(pdf_path, ROOT), size / 1048576.0))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
