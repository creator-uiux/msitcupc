"""Generate the PWA icon set from favicon.svg.

Produces the icons the web app manifest needs, including a maskable variant
whose safe zone keeps the mark clear of the platform mask.
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "icons")

NAVY = (30, 58, 95, 255)
ACCENT = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)


def draw_mark(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # background
    if maskable:
        d.rectangle([0, 0, size, size], fill=NAVY)
        inset = int(size * 0.18)          # safe zone for the platform mask
    else:
        radius = int(size * 0.22)
        d.rounded_rectangle([0, 0, size, size], radius=radius, fill=NAVY)
        inset = int(size * 0.16)
    # the mark: a simple ticket + wrench cross in white
    w = size - inset * 2
    x0, y0 = inset, inset
    x1, y1 = size - inset, size - inset
    d.rounded_rectangle([x0, y0 + int(w * 0.06), x1, y1 - int(w * 0.30)],
                        radius=int(w * 0.10), outline=WHITE, width=max(2, int(w * 0.075)))
    # perforation line
    mid = y0 + int(w * 0.62)
    d.line([x0 + int(w * 0.16), mid, x1 - int(w * 0.16), mid],
           fill=WHITE, width=max(1, int(w * 0.055)))
    # cross
    cx, cy = (x0 + x1) // 2, mid + int(w * 0.17)
    arm = int(w * 0.17)
    th = max(2, int(w * 0.085))
    d.rectangle([cx - arm, cy - th // 2, cx + arm, cy + th // 2], fill=WHITE)
    d.rectangle([cx - th // 2, cy - arm, cx + th // 2, cy + arm], fill=WHITE)
    return img


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    made = []
    for size, name in ((192, "icon-192.png"), (512, "icon-512.png")):
        p = os.path.join(ICON_DIR, name)
        draw_mark(size).save(p, "PNG")
        made.append(name)
    for size, name in ((192, "icon-maskable-192.png"), (512, "icon-maskable-512.png")):
        p = os.path.join(ICON_DIR, name)
        draw_mark(size, maskable=True).save(p, "PNG")
        made.append(name)
    # apple touch icon
    p = os.path.join(ICON_DIR, "apple-touch-icon.png")
    draw_mark(180).save(p, "PNG")
    made.append("apple-touch-icon.png")
    print("wrote %d icon(s) to %s" % (len(made), os.path.relpath(ICON_DIR, ROOT)))
    for m in made:
        print("  %s" % m)


if __name__ == "__main__":
    main()
