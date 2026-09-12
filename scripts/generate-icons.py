#!/usr/bin/env python3
"""generate-icons.py — app icon set for ytapp (YouTube-style: red squircle + white play triangle)

Outputs:
  electron/build/icon.png                      (1024 — electron-builder converts to .icns)
  icons/android/res/mipmap-*/ic_launcher.png   (legacy raster launcher icons)
  icons/android/res/mipmap-*/ic_launcher_round.png
  icons/android/res/mipmap-*/ic_launcher_foreground.png  (adaptive foreground, transparent)
  icons/android/res/values/ic_launcher_background.xml   (adaptive background = solid red)
  icons/png/icon-{512,256,192,180,48,32,16}.png (web/misc)
"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RED = (255, 0, 0, 255)
WHITE = (255, 255, 255, 255)

def master(size=1024):
    """Red rounded square + centered white play triangle (YouTube app-icon style)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.22)  # squircle-ish corner radius
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=RED)
    # play triangle: centered, width ~46% of canvas, classic YouTube proportions
    cx, cy = size * 0.5, size * 0.5
    w = size * 0.46      # triangle width
    h = size * 0.325     # triangle height
    x0 = cx - w * 0.44   # optical centering (triangles look left-heavy otherwise)
    pts = [(x0, cy - h / 2), (x0, cy + h / 2), (x0 + w, cy)]
    d.polygon(pts, fill=WHITE)
    return img

def foreground(size):
    """Adaptive-icon foreground: white play triangle only, transparent background,
    sized inside the 66% safe zone (mask shapes crop the rest)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = size * 0.5, size * 0.5
    w = size * 0.30      # ~30% of canvas ≈ 46% of the 66% safe zone
    h = w * 0.706
    x0 = cx - w * 0.44
    pts = [(x0, cy - h / 2), (x0, cy + h / 2), (x0 + w, cy)]
    d.polygon(pts, fill=WHITE)
    return img

def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(f"  {path} ({img.width}x{img.height})")

if __name__ == "__main__":
    print("Generating icons…")

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

    # Adaptive background color resource
    bg_xml = os.path.join(ROOT, "icons", "android", "res", "values", "ic_launcher_background.xml")
    os.makedirs(os.path.dirname(bg_xml), exist_ok=True)
    with open(bg_xml, "w") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<resources>\n'
                '    <color name="ic_launcher_background">#FF0000</color>\n'
                '</resources>\n')
    print(f"  {bg_xml}")

    print("Done.")
