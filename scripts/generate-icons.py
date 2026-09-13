#!/usr/bin/env python3
"""generate-icons.py — premium app icon set for ytapp (v3)

Design (modern YouTube app-icon direction):
  - White rounded tile (master / electron / web)
  - Flat pure-red play button (#FF0000) — flat is the premium look here,
    matching the real YouTube icon exactly
  - White play triangle, optically centered
  - Android adaptive: white background + same button as foreground
    (66% safe zone), so themed/round masks crop cleanly

Outputs:
  electron/build/icon.png                      (1024 — electron-builder converts to .icns)
  icons/android/res/mipmap-*/ic_launcher.png   (legacy raster launcher icons)
  icons/android/res/mipmap-*/ic_launcher_round.png
  icons/android/res/mipmap-*/ic_launcher_foreground.png  (adaptive foreground, transparent)
  icons/android/res/values/ic_launcher_background.xml   (adaptive background = white)
  icons/png/icon-{512,256,192,180,48,32,16}.png (web/misc)
"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RED = (255, 0, 0, 255)
WHITE = (255, 255, 255, 255)
TILE = (255, 255, 255, 255)


def vertical_gradient(size, box, top, bottom):
    """RGBA gradient image filling `box`=(x0,y0,x1,y1) with rounded corners."""
    x0, y0, x1, y1 = [int(v) for v in box]
    w, h = x1 - x0, y1 - y0
    grad = Image.new("RGBA", (w, h))
    px = grad.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b, 255)
    # round the corners of the gradient
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(h * 0.28), fill=255)
    grad.putalpha(mask)
    return grad, box


def draw_button(img, cx, cy, button_w, scale=1.0):
    """Draw the flat red play button + white triangle centered at (cx, cy).
    Deliberately FLAT (like the real YouTube icon) — no gradients, no faux 3D."""
    d = ImageDraw.Draw(img)
    bw = button_w
    bh = int(bw * 0.705)
    x0, y0 = int(cx - bw / 2), int(cy - bh / 2)
    # flat red, rounded corners matching YouTube's button radius
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=int(bh * 0.28), fill=(255, 0, 0, 255))
    # white triangle — optical centering (triangles read left-heavy)
    tw = int(bw * 0.36)
    th = int(bh * 0.50)
    tx0 = cx - tw * 0.44
    pts = [(tx0, cy - th / 2), (tx0, cy + th / 2), (tx0 + tw, cy)]
    d.polygon(pts, fill=WHITE)


def master(size=1024):
    """White rounded tile + red gradient play button (YouTube app-icon style)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.225)  # squircle-ish
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=TILE)
    draw_button(img, size * 0.5, size * 0.5, size * 0.62)
    return img


def foreground(size):
    """Adaptive-icon foreground: red button + white triangle inside the 66% safe zone."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    safe = size * 0.66
    draw_button(img, size * 0.5, size * 0.5, safe * 0.78)
    return img


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(f"  {path} ({img.width}x{img.height})")


if __name__ == "__main__":
    print("Generating icons (v2 — premium)…")

    # Electron / web master
    m = master(1024)
    save(m, os.path.join(ROOT, "electron", "build", "icon.png"))
    for s in (512, 256, 192, 180, 48, 32, 16):
        save(m.resize((s, s), Image.LANCZOS), os.path.join(ROOT, "icons", "png", f"icon-{s}.png"))

    # Android raster launchers (legacy, pre-8.0)
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for name, px in densities.items():
        save(m.resize((px, px), Image.LANCZOS),
             os.path.join(ROOT, "icons", "android", "res", f"mipmap-{name}", "ic_launcher.png"))
        # round variant: circle-cropped master
        r = m.resize((px, px), Image.LANCZOS)
        mask = Image.new("L", (px, px), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, px - 1, px - 1], fill=255)
        round_img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        round_img.paste(r, (0, 0), mask)
        save(round_img,
             os.path.join(ROOT, "icons", "android", "res", f"mipmap-{name}", "ic_launcher_round.png"))

    # Android adaptive foregrounds (108dp base: mdpi=108 … xxxhdpi=432)
    fg_densities = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
    for name, px in fg_densities.items():
        save(foreground(px),
             os.path.join(ROOT, "icons", "android", "res", f"mipmap-{name}", "ic_launcher_foreground.png"))

    # Adaptive background color resource — white, like the real YouTube icon
    bg_xml = os.path.join(ROOT, "icons", "android", "res", "values", "ic_launcher_background.xml")
    os.makedirs(os.path.dirname(bg_xml), exist_ok=True)
    with open(bg_xml, "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<resources>\n'
                '    <color name="ic_launcher_background">#FFFFFF</color>\n'
                '</resources>\n')
    print(f"  {bg_xml}")

    print("Done.")
