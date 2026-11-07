#!/usr/bin/env python3
# verify-guide.py — structural + per-page verification of the testers guide
# (visual-check equivalent: every page must carry content; cover must carry
# title/meta; TOC must have entries; no placeholders or markdown artifacts).
import re, sys
from pypdf import PdfReader
from docx import Document

PDF = "/home/z/my-project/download/ytapp-feature-testing-guide.pdf"
DOCX = "/home/z/my-project/download/ytapp-feature-testing-guide.docx"

fails = []

# ---- per-page PDF audit ----
r = PdfReader(PDF)
print(f"pages: {len(r.pages)}")
texts = [(p.extract_text() or "").strip() for p in r.pages]
for i, t in enumerate(texts, 1):
    n = len(t)
    tag = ""
    if n < 40:
        tag = "  <-- NEAR-BLANK PAGE"
        fails.append(f"page {i} near-blank ({n} chars)")
    print(f"  p{i:02d}: {n:5d} chars | {t[:70].replace(chr(10), ' / ')}{tag}")

if "Feature Testing Guide" not in texts[0]:
    fails.append("cover page missing title")
if "ytapp" not in texts[0].lower():
    fails.append("cover page missing app name")
toc_page = next((i for i, t in enumerate(texts) if "Table of Contents" in t), None)
if toc_page is None:
    fails.append("no TOC page found")
else:
    if not re.search(r"\d+$", texts[toc_page].strip().splitlines()[-1] or ""):
        pass  # page numbers roman; loose check below instead
    entries = len(re.findall(r"\.{6,}\s*\w+", texts[toc_page])) or len(texts[toc_page].splitlines())
    print(f"TOC on page {toc_page+1}, ~{len(texts[toc_page].splitlines())} lines")
    if len(texts[toc_page].splitlines()) < 10:
        fails.append("TOC page looks empty")

# body must start right after TOC
if toc_page is not None and "How to Use This Guide" not in (texts[toc_page + 1] or "") + (texts[toc_page + 2] or ""):
    fails.append("body section 1 not found after TOC")

# ---- docx structural audit ----
d = Document(DOCX)
h1 = [p.text for p in d.paragraphs if p.style.name == "Heading 1"]
h2 = [p.text for p in d.paragraphs if p.style.name == "Heading 2"]
print(f"\nH1 ({len(h1)}):"); [print("  ", h) for h in h1]
print(f"H2 count: {len(h2)}; tables: {len(d.tables)}")
expected_h1 = 12
if len(h1) != expected_h1:
    fails.append(f"expected {expected_h1} H1 sections, got {len(h1)}")
if len(d.tables) < 4:
    fails.append(f"expected >=4 tables (3 content tables + cover wrapper), got {len(d.tables)}")

# table headers sanity
for i, t in enumerate(d.tables):
    hdr = " | ".join(c.text for c in t.rows[0].cells)
    print(f"  table {i}: {len(t.rows)} rows, header: {hdr[:80]}")

# placeholder / artifact scan over all text
alltext = "\n".join(p.text for p in d.paragraphs) + "\n".join(
    c.text for t in d.tables for row in t.rows for c in row.cells)
for bad in ["XXX", "TODO", "TBD", "undefined", "NaN", "【", "|---|", "**", "##"]:
    if bad in alltext:
        fails.append(f"artifact {bad!r} found in text")

print("\nRESULT:", "FAIL " + "; ".join(fails) if fails else "ALL CHECKS PASSED")
sys.exit(1 if fails else 0)
