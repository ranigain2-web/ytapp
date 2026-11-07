#!/usr/bin/env python3
# patch-guide-footers.py — post-process the testers guide docx:
# 1) footer PAGE fields get explicit format switches (WPS ignores pgNumType fmt):
#    roman footer -> PAGE \* ROMAN, arabic footer -> PAGE \* arabic
# 2) strip empty <w:pgNumType/> (docx-js emits it on sections without pageNumbers)
# Footer identification: the roman footer belongs to section 2 (TOC), the
# arabic one to section 3 (body). docx-js writes footers in order, so we map
# footer files via their relationship order in document.xml sectPr order.
import re, shutil, sys, zipfile, os

path = "/home/z/my-project/download/ytapp-feature-testing-guide.docx"
tmp = path + ".tmp"

with zipfile.ZipFile(path, "r") as zin:
    names = zin.namelist()
    files = {n: zin.read(n) for n in names}

doc = files["word/document.xml"].decode("utf-8")

# strip empty pgNumType (cover section)
doc = doc.replace("<w:pgNumType/>", "")

# find footer reference ids per sectPr, in order
sect_footer_ids = []
for sect in re.finditer(r"<w:sectPr[^>]*>.*?</w:sectPr>", doc, re.S):
    m = re.search(r'<w:footerReference w:type="default" r:id="(rId\d+)"', sect.group(0))
    sect_footer_ids.append(m.group(1) if m else None)
print("sectPr footer ids in order:", sect_footer_ids)

# resolve rIds to footer files
rels = files["word/_rels/document.xml.rels"].decode("utf-8")
id2file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(footer\d+\.xml)"', rels))
print("rel map:", id2file)

# section order in this doc: 1=cover(no footer), 2=TOC(roman), 3=body(arabic)
with_footer = [fid for fid in sect_footer_ids if fid]
if len(with_footer) != 2:
    print("FATAL: expected exactly 2 footered sections, got", with_footer)
    sys.exit(1)

roman_file = "word/" + id2file[with_footer[0]]
arabic_file = "word/" + id2file[with_footer[1]]

for fname, fmt in ((roman_file, "ROMAN"), (arabic_file, "arabic")):
    xml = files[fname].decode("utf-8")
    xml2, n = re.subn(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        rf"\1 PAGE \\* {fmt} \\* MERGEFORMAT \2",
        xml,
    )
    print(f"{fname}: patched {n} PAGE fields -> {fmt}")
    files[fname] = xml2.encode("utf-8")

files["word/document.xml"] = doc.encode("utf-8")

with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in names:
        zout.writestr(n, files[n])
shutil.move(tmp, path)
print("OK footers patched")
