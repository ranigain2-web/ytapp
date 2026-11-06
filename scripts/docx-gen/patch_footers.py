#!/usr/bin/env python3
"""patch_footers.py — WPS-compat page numbers: patch each section's footer PAGE
field with an explicit \\* ROMAN / \\* arabic format switch (MS Office already
respects w:pgNumType; WPS needs the instrText switch). Idempotent."""
import re, shutil, sys, zipfile

DOCX = "/home/z/my-project/download/ytapp-deep-research-report.docx"

def main():
    with zipfile.ZipFile(DOCX) as z:
        files = {n: z.read(n) for n in z.namelist()}
    doc = files["word/document.xml"].decode("utf-8")
    rels = files["word/_rels/document.xml.rels"].decode("utf-8")

    # rel id -> footer target file
    rid_target = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="(footer\d+\.xml)"', rels))
    rid_target.update({rid: t for t, rid in re.findall(r'<Relationship[^>]*Target="(footer\d+\.xml)"[^>]*Id="([^"]+)"', rels)})

    patched = []
    for m in re.finditer(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, re.S):
        s = m.group(0)
        fmt = re.search(r'w:pgNumType[^>]*w:fmt="(\w+)"', s)
        if not fmt:
            continue
        switch = "ROMAN" if fmt.group(1) == "upperRoman" else ("roman" if fmt.group(1) == "lowerRoman" else "arabic")
        for rid in re.findall(r'<w:footerReference[^>]*r:id="([^"]+)"', s):
            target = rid_target.get(rid)
            if not target:
                continue
            key = "word/" + target
            xml = files[key].decode("utf-8")
            new = re.sub(r'(<w:instrText xml:space="preserve">)PAGE(</w:instrText>)',
                         r"\g<1>PAGE \\* " + switch + r"\g<2>", xml)
            if new != xml:
                files[key] = new.encode("utf-8")
                patched.append(f"{target} -> PAGE \\* {switch}")

    # strip empty pgNumType (cover section emits one; some engines dislike it)
    doc2 = doc.replace("<w:pgNumType/>", "")
    if doc2 != doc:
        files["word/document.xml"] = doc2.encode("utf-8")
        patched.append("stripped empty <w:pgNumType/> from cover sectPr")

    tmp = DOCX + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            z.writestr(n, b)
    shutil.move(tmp, DOCX)
    print("patched:", patched if patched else "nothing (already ok)")

if __name__ == "__main__":
    main()
