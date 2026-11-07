// gen-plan.mjs — builds ytapp-master-build-plan.docx (R1 cover, DM-1, 3 sections, TOC)
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, NumberFormat, AlignmentType, HeadingLevel,
  WidthType, BorderStyle, ShadingType, TableOfContents, SectionType, TableLayoutType,
} from "docx";
import fs from "node:fs";
import path from "node:path";
import { META, BLOCKS1 } from "./plan-content1.mjs";
import { BLOCKS2 } from "./plan-content2.mjs";

const OUT = "/home/z/my-project/download/ytapp-master-build-plan.docx";

// ── DM-1 palette (design-system.md) ─────────────────────────────────────────
const DM1 = {
  bg: "162235", accent: "37DCF2",
  cover: { titleColor: "FFFFFF", subtitleColor: "B0B8C0", metaColor: "90989F", footerColor: "687078" },
  table: { headerBg: "1B6B7A", headerText: "FFFFFF", accentLine: "1B6B7A", innerLine: "C8DDE2", surface: "EDF3F5" },
};
const HEADING_INK = "162235";
const TNR = { ascii: "Times New Roman", eastAsia: "SimSun" };

const NB = { style: BorderStyle.NONE, size: 0, color: "auto" };
const noBorders = { top: NB, bottom: NB, left: NB, right: NB };
const allNoBorders = { top: NB, bottom: NB, left: NB, right: NB, insideHorizontal: NB, insideVertical: NB };

// ── Skill helpers (verbatim from design-system.md) ──────────────────────────
function splitTitleLines(title, charsPerLine) {
  if (title.length <= charsPerLine) return [title];
  const breakAfter = new Set([..."\uFF0C\u3002\u3001\uFF1B\uFF1A\uFF01\uFF1F", ..."\u7684\u4E0E\u548C\u53CA\u4E4B\u5728\u4E8E\u4E3A", ..."-_\u2014\u2013\u00B7/", ..." \t"]);
  const lines = [];
  let remaining = title;
  while (remaining.length > charsPerLine) {
    let breakAt = -1;
    for (let i = charsPerLine; i >= Math.floor(charsPerLine * 0.6); i--) {
      if (i < remaining.length && breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
    }
    if (breakAt === -1) {
      const limit = Math.min(remaining.length, Math.ceil(charsPerLine * 1.3));
      for (let i = charsPerLine + 1; i < limit; i++) {
        if (breakAfter.has(remaining[i - 1])) { breakAt = i; break; }
      }
    }
    if (breakAt === -1) {
      breakAt = charsPerLine;
      const prevChar = remaining[breakAt - 1], nextChar = remaining[breakAt];
      if (prevChar && nextChar && !breakAfter.has(prevChar) && !breakAfter.has(nextChar) &&
          /[\u4e00-\u9fff]/.test(prevChar) && /[\u4e00-\u9fff]/.test(nextChar)) breakAt -= 1;
    }
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) lines.push(remaining);
  if (lines.length > 1 && lines[lines.length - 1].length <= 2) {
    const last = lines.pop();
    lines[lines.length - 1] += last;
  }
  return lines;
}

function calcTitleLayout(title, maxWidthTwips, preferredPt = 40, minPt = 24) {
  const charWidth = (pt) => pt * 20;
  const charsPerLine = (pt) => Math.floor(maxWidthTwips / charWidth(pt));
  let titlePt = preferredPt, lines;
  while (titlePt >= minPt) {
    const cpl = charsPerLine(titlePt);
    if (cpl < 2) { titlePt -= 2; continue; }
    lines = splitTitleLines(title, cpl);
    if (lines.length <= 3) break;
    titlePt -= 2;
  }
  if (!lines || lines.length > 3) {
    lines = splitTitleLines(title, charsPerLine(minPt));
    titlePt = minPt;
  }
  return { titlePt, titleLines: lines };
}

function calcCoverSpacing(params) {
  const { titleLineCount = 1, titlePt = 36, hasSubtitle = false, hasEnglishLabel = false,
          metaLineCount = 0, fixedHeight = 800, pageHeight = 16838, marginTop = 0, marginBottom = 0 } = params;
  const SAFETY = 1200;
  const usableHeight = pageHeight - marginTop - marginBottom - SAFETY;
  const titleHeight = titleLineCount * (titlePt * 23 + 200);
  const subtitleHeight = hasSubtitle ? (12 * 23 + 600) : 0;
  const englishLabelHeight = hasEnglishLabel ? (9 * 23 + 600) : 0;
  const metaHeight = metaLineCount * (10 * 23 + 100);
  const implicitParaHeight = 3 * 300;
  const contentHeight = titleHeight + subtitleHeight + englishLabelHeight + metaHeight + fixedHeight + implicitParaHeight;
  const safeRemaining = Math.max(usableHeight - contentHeight, 400);
  const FOOTER_MIN = 800;
  const rawTop = Math.floor(safeRemaining * 0.45);
  const rawBottom = Math.floor(safeRemaining * 0.45);
  const bottomSpacing = Math.max(rawBottom, FOOTER_MIN);
  const topSpacing = Math.max(rawTop - Math.max(0, FOOTER_MIN - rawBottom), 400);
  const midSpacing = Math.max(safeRemaining - topSpacing - bottomSpacing, 0);
  return { topSpacing, midSpacing, bottomSpacing };
}

// ── Recipe R1: Pure Paragraph Cover ─────────────────────────────────────────
function buildCoverR1(config) {
  const P = config.palette;
  const padL = 1200, padR = 800;
  const availableWidth = 11906 - padL - padR - 300;
  const { titlePt, titleLines } = calcTitleLayout(config.title, availableWidth, 32, 24);
  const titleSize = titlePt * 2;
  const spacing = calcCoverSpacing({
    titleLineCount: titleLines.length, titlePt,
    hasSubtitle: !!config.subtitle, hasEnglishLabel: !!config.englishLabel,
    metaLineCount: (config.metaLines || []).length, fixedHeight: 400,
  });
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };
  const children = [];
  children.push(new Paragraph({ spacing: { before: spacing.topSpacing } }));
  if (config.englishLabel) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 500 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
      children: [new TextRun({ text: config.englishLabel.split("").join("  "),
        size: 18, color: P.accent, font: { ascii: "Calibri", eastAsia: "SimHei" }, characterSpacing: 40 })],
    }));
  }
  for (let i = 0; i < titleLines.length; i++) {
    children.push(new Paragraph({
      indent: { left: padL },
      spacing: { after: i < titleLines.length - 1 ? 100 : 300, line: Math.ceil(titlePt * 23), lineRule: "atLeast" },
      children: [new TextRun({ text: titleLines[i], size: titleSize, bold: true,
        color: P.titleColor, font: { eastAsia: "SimHei", ascii: "Arial" } })],
    }));
  }
  if (config.subtitle) {
    children.push(new Paragraph({
      indent: { left: padL, right: padR }, spacing: { after: 800 },
      children: [new TextRun({ text: config.subtitle, size: 24, color: P.subtitleColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  for (const line of (config.metaLines || [])) {
    children.push(new Paragraph({
      indent: { left: padL + 200, right: padR }, spacing: { after: 80 },
      border: { left: accentLeft },
      children: [new TextRun({ text: line, size: 24, color: P.metaColor,
        font: { eastAsia: "Microsoft YaHei", ascii: "Arial" } })],
    }));
  }
  children.push(new Paragraph({ spacing: { before: spacing.bottomSpacing } }));
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: config.footerLeft || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
      new TextRun({ text: "                                        " }),
      new TextRun({ text: config.footerRight || "", size: 16, color: P.footerColor, font: { ascii: "Arial" } }),
    ],
  }));
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg }, borders: noBorders,
        children,
      })],
    })],
  })];
}

// ── Body block builders ──────────────────────────────────────────────────────
const TABLE_WIDTHS = [
  [30, 70],                 // T1 current state
  [38, 62],                 // T2 global bars
  [10, 30, 30, 12, 18],     // T3 phase map (5 cols)
  [8, 30, 36, 26],          // T4 P0 items
  [8, 30, 36, 26],          // T5 P1 items
  [8, 30, 36, 26],          // T6 P2 items
  [8, 30, 36, 26],          // T7 P3 items
  [8, 30, 36, 26],          // T8 P4 items
  [8, 30, 36, 26],          // T9 P5 items
  [26, 10, 10, 54],         // T10 risks
];
let tableIdx = 0;

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER,
    spacing: { before: 400, after: 200, line: 312 },
    children: [new TextRun({ text, bold: true, size: 32, color: HEADING_INK, font: TNR })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140, line: 312 },
    children: [new TextRun({ text, bold: true, size: 30, color: HEADING_INK, font: TNR })],
  });
}
function para(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 312 },
    children: [new TextRun({ text, size: 24, color: "000000", font: TNR })],
  });
}
function quote(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    indent: { left: 400, right: 200 },
    spacing: { before: 120, after: 200, line: 288 },
    border: { left: { style: BorderStyle.SINGLE, size: 12, color: DM1.table.accentLine, space: 12 } },
    shading: { type: ShadingType.CLEAR, fill: "F4F7F9" },
    children: [new TextRun({ text, italics: true, size: 21, color: "333333", font: TNR })],
  });
}
function tbl(spec) {
  const widths = TABLE_WIDTHS[tableIdx++] || spec.headers.map(() => Math.floor(100 / spec.headers.length));
  const out = [];
  out.push(new Paragraph({
    keepNext: true, spacing: { before: 220, after: 100 },
    children: [new TextRun({ text: spec.title, bold: true, size: 21, color: HEADING_INK, font: TNR })],
  }));
  const headerRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: spec.headers.map((h, i) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: DM1.table.headerBg },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      children: [new Paragraph({ spacing: { line: 240 },
        children: [new TextRun({ text: h, bold: true, size: 18, color: DM1.table.headerText, font: TNR })] })],
    })),
  });
  const rows = spec.rows.map((r, ri) => new TableRow({
    cantSplit: true,
    children: r.map((c, i) => new TableCell({
      shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: DM1.table.surface } : undefined,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      width: { size: widths[i], type: WidthType.PERCENTAGE },
      children: [new Paragraph({ spacing: { line: 240 },
        children: [new TextRun({ text: c, size: 18, color: "000000", font: TNR })] })],
    })),
  }));
  out.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: DM1.table.accentLine },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: DM1.table.accentLine },
      left: NB, right: NB,
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: DM1.table.innerLine },
      insideVertical: NB,
    },
    rows: [headerRow, ...rows],
  }));
  out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  return out;
}

function renderBlocks(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.h1) out.push(h1(b.h1));
    else if (b.h2) out.push(h2(b.h2));
    else if (b.p) out.push(para(b.p));
    else if (b.q) out.push(quote(b.q));
    else if (b.t) out.push(...tbl(b.t));
  }
  return out;
}

// ── Sections ─────────────────────────────────────────────────────────────────
const pageA4 = { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 } };
const footer = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "666666", font: TNR })],
  })],
});
const runningHeader = new Header({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: META.title, size: 18, color: "888888", font: TNR })],
  })],
});

const frontMatter = [
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 480, after: 360 },
    children: [new TextRun({ text: "Table of Contents", bold: true, size: 32, font: TNR, color: HEADING_INK })],
  }),
  new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
  new Paragraph({
    spacing: { before: 200 },
    children: [new TextRun({
      text: "Note: This Table of Contents is generated via field codes. To ensure page number accuracy after editing, please right-click the TOC and select \"Update Field.\"",
      italics: true, size: 18, color: "888888", font: TNR })],
  }),
  // no trailing PageBreak: the body is its own NEXT_PAGE section (postcheck-verified)
];

const doc = new Document({
  styles: { default: { document: { run: { font: TNR, size: 24 } } } },
  sections: [
    { // Section 1: cover
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: META.title, subtitle: META.subtitle, englishLabel: META.englishLabel,
        metaLines: META.metaLines, footerLeft: META.footerLeft, footerRight: META.footerRight,
        palette: { bg: DM1.bg, accent: DM1.accent, ...DM1.cover },
      }),
    },
    { // Section 2: front matter — Roman numerals
      properties: { type: SectionType.NEXT_PAGE, page: { ...pageA4, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } } },
      footers: { default: footer() },
      children: frontMatter,
    },
    { // Section 3: body — Arabic from 1
      properties: { type: SectionType.NEXT_PAGE, page: { ...pageA4, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
      headers: { default: runningHeader },
      footers: { default: footer() },
      children: renderBlocks([...BLOCKS1, ...BLOCKS2]),
    },
  ],
});

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buffer);
console.log("wrote", OUT, buffer.length, "bytes;", "tables:", tableIdx);
