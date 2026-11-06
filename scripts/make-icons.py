# make-icons.py — generate PWA icons (YouTube-style red rounded square + play
# triangle) into public/icons/. Pillow, no external assets.
from PIL import Image, ImageDraw

def make(size: int, maskable: bool = False) -> Image.Image:
    pad = int(size * 0.1) if maskable else 0
    box = size - 2 * pad
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # red rounded square (YouTube red #FF0000), full-bleed safe zone for maskable
    radius = int(box * 0.22)
    d.rounded_rectangle([pad, pad, pad + box, pad + box], radius=radius, fill=(255, 0, 0, 255))
    # white play triangle centered
    cx, cy = size // 2, size // 2
    w, h = int(box * 0.42), int(box * 0.48)
    d.polygon([(cx - w // 2 + int(w * 0.06), cy - h // 2),
               (cx - w // 2 + int(w * 0.06), cy + h // 2),
               (cx + w // 2, cy)], fill=(255, 255, 255, 255))
    return img

import os
os.makedirs("public/icons", exist_ok=True)
for s in (192, 512):
    make(s).save(f"public/icons/icon-{s}.png")
    make(s, maskable=True).save(f"public/icons/icon-{s}-maskable.png")
    # apple-touch-icon wants opaque + square (iOS ignores transparency)
    make(180).save("public/icons/apple-touch-icon.png") if s == 192 else None
print("icons written:", os.listdir("public/icons"))
