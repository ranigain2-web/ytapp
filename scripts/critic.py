#!/usr/bin/env python3
"""critic.py — gauntlet critic: VLM blind A/B judgment of our app vs real YouTube.
Sends OUR screenshot and the REAL YouTube screenshot (labels stripped, order
randomized) and asks a harsh critic: which is better, and the single biggest
remaining gap in the loser. Usage: python3 critic.py <ours.png> <ref.png> <label>
"""
import json, random, subprocess, sys, os

ours, ref, label = sys.argv[1], sys.argv[2], sys.argv[3]
seed = random.Random()
flip = seed.random() < 0.5
a, b = (ours, ref) if not flip else (ref, ours)

prompt = f"""You are a harsh, blind UI critic comparing two MOBILE APP screenshots for "{label}" quality.
Image 1 and Image 2 are the same screen type from two different apps. One is the REAL YouTube app, one is a clone. You do NOT know which is which.
Judge ONLY on visual design quality: typography hierarchy, spacing/layout rhythm, alignment, component polish (chips, cards, nav bars, buttons), icon quality, color discipline, overall premium feel.
Reply in EXACTLY this format:
WINNER: Image 1 or Image 2
REASON: one sentence
BIGGEST_GAP_IN_LOSER: the single most impactful visual defect in the losing image, one sentence"""

out = f"/tmp/critic-{os.path.basename(ours)}.json"
cmd = ["z-ai", "vision", "-p", prompt, "-i", a, "-i", b, "-o", out]
subprocess.run(cmd, check=True, capture_output=True)
content = json.load(open(out))["choices"][0]["message"]["content"]
winner_img = "1" if "Image 1" in content.split("\n")[0] else "2"
ours_won = (winner_img == "1") != flip  # if flipped, ours is Image 2
print(f"=== {label} ===")
print(f"flip={flip} (ours={'Image 2' if flip else 'Image 1'})")
print(content)
print(f"VERDICT: {'OURS WINS' if ours_won else 'YOUTUBE WINS'}")
print()
