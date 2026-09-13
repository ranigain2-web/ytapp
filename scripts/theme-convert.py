#!/usr/bin/env python3
"""Theme conversion pass — replaces hardcoded dark-mode colors in the
page-level yt components with CSS variables (see globals.css: :root dark +
html.yt-light overrides). Player-internal surfaces (VideoPlayer, ShortsPage)
stay hardcoded by design: YouTube's player and the Shorts feed are black in
BOTH themes.

Ordered rules: longer/more-specific tokens first so alpha variants and
compound pairs are consumed before the generic ones.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

# Files that get the full conversion (page-level UI)
TARGETS = [
    "components/yt/AppShell.tsx",
    "components/yt/Header.tsx",
    "components/yt/Sidebar.tsx",
    "components/yt/VideoCard.tsx",
    "components/yt/HomePage.tsx",
    "components/yt/ChipsBar.tsx",
    "components/yt/SearchPage.tsx",
    "components/yt/SearchOverlay.tsx",
    "components/yt/WatchPage.tsx",
    "components/yt/ChannelPage.tsx",
    "components/yt/Comments.tsx",
    "components/yt/LibraryPages.tsx",
    "components/yt/SettingsPage.tsx",
    "app/page.tsx",
]

# (old, new) — order matters
RULES = [
    # alpha variants first
    ("bg-[#272727]/60", "bg-[var(--yt-elev2-60)]"),
    ("bg-[#272727]/70", "bg-[var(--yt-elev2-70)]"),
    ("text-[#f1f1f1]/90", "text-[var(--yt-text)]"),
    ("text-[#ddd]/80", "text-[var(--yt-text-2)]"),
    # blue pair (contrast text on blue buttons) before generic #0f0f0f text
    ("bg-[#3ea6ff] text-[#0f0f0f]", "bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)]"),
    # inverted pills: light bg + dark text (Subscribe, active chips, CTAs)
    ("bg-[#f1f1f1] text-[#0f0f0f]", "bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)]"),
    ("hover:bg-[#d9d9d9]", "hover:bg-[var(--yt-invert-hover)]"),
    ("bg-[#d9d9d9]", "bg-[var(--yt-invert-hover)]"),
    # surfaces
    ("bg-[#0f0f0f]", "bg-[var(--yt-bg)]"),
    ("bg-[#0d0d0d]", "bg-[var(--yt-bg)]"),
    ("bg-[#121212]", "bg-[var(--yt-bg-input)]"),
    ("bg-[#1a1a1a]", "bg-[var(--yt-bg-elev)]"),
    ("bg-[#212121]", "bg-[var(--yt-bg-elev)]"),
    ("bg-[#272727]", "bg-[var(--yt-bg-elev2)]"),
    ("bg-[#3f3f3f]", "bg-[var(--yt-hover)]"),
    # borders
    ("border-[#303030]", "border-[var(--yt-border)]"),
    ("border-[#272727]/60", "border-[var(--yt-border)]"),
    ("border-[#272727]", "border-[var(--yt-border)]"),
    ("divide-[#303030]", "divide-[var(--yt-border)]"),
    # text
    ("text-[#f1f1f1]", "text-[var(--yt-text)]"),
    ("text-[#aaaaaa]", "text-[var(--yt-text-2)]"),
    ("text-[#aaa]", "text-[var(--yt-text-2)]"),
    ("text-[#ddd]", "text-[var(--yt-text-2)]"),
    ("text-[#0f0f0f]", "text-[var(--yt-invert-text)]"),
    # accents
    ("bg-[#3ea6ff]", "bg-[var(--yt-blue)]"),
    ("text-[#3ea6ff]", "text-[var(--yt-blue)]"),
    ("border-[#3ea6ff]", "border-[var(--yt-blue)]"),
    ("hover:border-[#3ea6ff]", "hover:border-[var(--yt-blue)]"),
    ("focus:border-[#3ea6ff]", "focus:border-[var(--yt-blue)]"),
]


def main() -> int:
    changed = {}
    for rel in TARGETS:
        p = SRC / rel
        if not p.exists():
            print(f"skip (missing): {rel}")
            continue
        text = p.read_text()
        orig = text
        total = 0
        for old, new in RULES:
            n = text.count(old)
            if n:
                text = text.replace(old, new)
                total += n
        if text != orig:
            p.write_text(text)
            changed[rel] = total
    for rel, n in sorted(changed.items(), key=lambda kv: -kv[1]):
        print(f"{n:4d}  {rel}")
    print(f"TOTAL: {sum(changed.values())} replacements in {len(changed)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
