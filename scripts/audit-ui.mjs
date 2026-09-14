// ============================================================================
// audit-ui.mjs — measurable UI audit + screenshot evidence.
//
// Why this exists: the old sandbox used a VLM critic (agent-browser + z-ai) to
// judge screenshots. That tooling is not part of this repo, so this harness
// replaces the *measurable* half of the gauntlet loop: it drives a real browser
// at phone / tablet / laptop viewports and reports objective defects —
//   • horizontal page overflow (a section running off the screen)
//   • elements wider/taller than the viewport
//   • content clipped by an ancestor's overflow:hidden (the "cut off" class)
//   • overlapping interactive elements (the "button on top of text" class)
//   • tap targets under 44px (mobile ergonomics)
//   • unexpected horizontal scroll containers
// and writes screenshots for human review plus a JSON + Markdown report.
//
// Usage:
//   node scripts/audit-ui.mjs                      # our app on :3999
//   BASE=http://127.0.0.1:3999 node scripts/audit-ui.mjs
//   REF=1 node scripts/audit-ui.mjs                # also capture m.youtube.com
// ============================================================================
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Seeded so the once-per-version What's-new dialog does not overlay the app
// during measurement. Read from package.json rather than hardcoded: a stale
// literal here makes the tour open on the first run and cover the page, which
// shows up as a bogus layout defect in every profile.
const APP_VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const BASE = process.env.BASE || "http://127.0.0.1:3999";
const OUT = process.env.OUT || "docs/screenshots/audit";
const DO_REF = process.env.REF === "1" || process.argv.includes("--ref");
const ONLY = process.env.ONLY || "";

const PROFILES = [
  { name: "phone", width: 390, height: 844, dpr: 3, mobile: true },
  { name: "tablet", width: 834, height: 1194, dpr: 2, mobile: true },
  // 1024 is a real Mac/iPad window size AND the width where the watch page now
  // switches to two columns, so it is audited on its own.
  { name: "small-laptop", width: 1024, height: 768, dpr: 1, mobile: false },
  { name: "laptop", width: 1280, height: 800, dpr: 1, mobile: false },
];

const PAGES = [
  { name: "home", url: "/" },
  { name: "watch", url: "/?v=dQw4w9WgXcQ" },
  { name: "search", url: "/?q=space%20documentary" },
  { name: "shorts", url: "/?page=shorts" },
  { name: "settings", url: "/?page=settings" },
  { name: "channel", url: "/?channel=UCuAXFkgsw1L7xaCfnd5JJOw" },
];

// Runs INSIDE the page. Must stay dependency-free.
function auditInPage() {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const describe = (el) => {
    if (!el || el === document.body) return "body";
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 4) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) s += `#${cur.id}`;
      else if (cur.dataset && cur.dataset.testid) s += `[${cur.dataset.testid}]`;
      else if (cur.className && typeof cur.className === "string") {
        const c = cur.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".");
        if (c) s += `.${c}`;
      }
      parts.unshift(s);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(">");
  };

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // An element inside an intentional horizontal scroller (chip rows, carousels)
  // extends past the viewport BY DESIGN — YouTube does the same. Not a defect.
  const inScroller = (el) => {
    let cur = el.parentElement;
    let d = 0;
    while (cur && cur !== document.body && d < 8) {
      const cs = getComputedStyle(cur);
      if (/auto|scroll/.test(cs.overflowX) && cur.scrollWidth > cur.clientWidth + 2) return true;
      cur = cur.parentElement;
      d++;
    }
    return false;
  };

  // Text clamped to N lines with "…" is YouTube's intended behaviour (titles,
  // collapsed descriptions) — a cut-off there is not a layout bug.
  const clampedByAncestor = (el) => {
    let cur = el;
    let d = 0;
    while (cur && d < 4) {
      const cs = getComputedStyle(cur);
      if (cs.webkitLineClamp && cs.webkitLineClamp !== "none") return true;
      if (/ellipsis/.test(cs.textOverflow)) return true;
      cur = cur.parentElement;
      d++;
    }
    return false;
  };

  // Fixed / sticky chrome (bottom nav, sticky header) is EXPECTED to sit on top
  // of scrolling content — flagging that pair would be pure noise.
  const isOverlay = (el) => {
    let cur = el;
    let d = 0;
    while (cur && cur !== document.body && d < 6) {
      const p = getComputedStyle(cur).position;
      if (p === "fixed" || p === "sticky") return true;
      cur = cur.parentElement;
      d++;
    }
    return false;
  };

  const docOverflow = Math.max(
    0,
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.body.clientWidth
  );

  const all = Array.from(document.querySelectorAll("body *"));
  const wide = [];
  const tooTall = [];
  const clipped = [];
  // Intentional ellipsis: overflow:hidden that a line-clamp explains (card
  // titles, the collapsed video description). Reported separately from real
  // clipping so the counts stay actionable.
  const clamped = [];
  const smallTargets = [];

  for (const el of all) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);

    // 1) element extends past the viewport horizontally
    if (r.right > vw + 1 && r.width > 24 && !inScroller(el)) {
      wide.push({
        sel: describe(el),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        overhang: Math.round(r.right - vw),
        parentOverflowX: cs.overflowX,
      });
    }

    // 2) a CLIPPED box taller than the viewport — content trapped in a
    //    fixed-height overflow:hidden parent and unreachable by scrolling.
    //    (A plain long page is not a defect, so visible-overflow is excluded.)
    if (r.height > vh + 2 && cs.position !== "fixed" && cs.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 2) {
      tooTall.push({
        sel: describe(el),
        height: Math.round(r.height),
        vh,
        hiddenPx: el.scrollHeight - el.clientHeight,
      });
    }

    // 3) content clipped by an ancestor's overflow:hidden without ellipsis
    //    (this is the "text gets cut off" defect)
    const scrollX = el.scrollWidth - el.clientWidth;
    const scrollY = el.scrollHeight - el.clientHeight;
    const clampsText = clampedByAncestor(el);
    const intentionalScroller = /auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY);
    if ((cs.overflow === "hidden" || cs.overflowX === "hidden") && scrollX > 2 && !clampsText && !intentionalScroller && el.children.length === 0) {
      clipped.push({
        sel: describe(el),
        text: (el.textContent || "").trim().slice(0, 48),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        cutPx: scrollX,
      });
    }
    if (cs.overflow === "hidden" && scrollY > 2 && !intentionalScroller && el.children.length === 0 && el.textContent.trim()) {
      const rec = {
        sel: describe(el),
        text: (el.textContent || "").trim().slice(0, 48),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        cutPx: scrollY,
      };
      // A line-clamp explains the hidden lines; without one, text is being cut
      // with no way to reveal it — that is the defect worth fixing.
      (clampsText ? clamped : clipped).push(rec);
    }

    // 4) mobile tap targets
    if (cs.cursor === "pointer" || /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      if (r.height < 44 || r.width < 24) {
        smallTargets.push({ sel: describe(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || "").trim().slice(0, 24) });
      }
    }
  }

  // 5) overlapping interactive elements (button on top of text) — the class of
  //    bug a blind screenshot critic catches late but geometry catches exactly.
  const interactives = Array.from(document.querySelectorAll("a,button,[role=button],[role=switch],input"))
    .filter(visible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < vw * 0.9 && r.height < vh * 0.9;
    });
  const overlaps = [];
  const inter = (a, b) => {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  };
  for (let i = 0; i < interactives.length; i++) {
    for (let j = i + 1; j < interactives.length; j++) {
      const A = interactives[i], B = interactives[j];
      if (A.contains(B) || B.contains(A)) continue;
      if (isOverlay(A) || isOverlay(B)) continue;
      const ra = A.getBoundingClientRect();
      const rb = B.getBoundingClientRect();
      const area = inter(ra, rb);
      const smaller = Math.min(ra.width * ra.height, rb.width * rb.height);
      if (area > 0 && smaller > 0 && area / smaller > 0.35) {
        overlaps.push({
          a: describe(A), b: describe(B),
          aText: (A.textContent || "").trim().slice(0, 28),
          bText: (B.textContent || "").trim().slice(0, 28),
          overlapPct: Math.round((area / smaller) * 100),
        });
      }
    }
  }

  // 6) type + colour samples on key surfaces (bar-comparison tokens)
  const sample = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { sel, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, color: cs.color };
  };
  const tokens = {
    bodyBg: getComputedStyle(document.body).backgroundColor,
    h1Title: sample("h1"),
    videoTitle: sample('[data-testid="video-title"], h1'),
    gridTitle: sample("h3"),
    channel: sample("p"),
  };

  // 7) content permanently hidden behind the fixed bottom nav: scroll to the
  //    very bottom and check nothing interactive is left underneath it.
  let bottomHidden = null;
  (() => {
    const nav = document.querySelector("nav.fixed, nav[aria-label='Mobile navigation']");
    if (!nav) return;
    // The bottom nav is `sm:hidden` by design — on tablet/laptop it is not
    // rendered at all, so a rect of 0 would flag every element on the page.
    if (getComputedStyle(nav).display === "none" || nav.getBoundingClientRect().height === 0) return;
    const navTop = nav.getBoundingClientRect().top;
    const max = document.documentElement.scrollHeight - vh;
    window.scrollTo(0, max);
    const all2 = Array.from(document.querySelectorAll("a,button,h1,h2,h3,p"));
    const hidden = [];
    for (const el of all2) {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.width === 0) continue;
      if (r.bottom > navTop + 4 && r.top < vh) {
        if (isOverlay(el)) continue;
        hidden.push({ sel: describe(el), text: (el.textContent || "").trim().slice(0, 32), bottom: Math.round(r.bottom), navTop: Math.round(navTop) });
      }
    }
    window.scrollTo(0, 0);
    if (hidden.length) bottomHidden = hidden.slice(0, 6);
  })();

  return {
    viewport: { vw, vh },
    docOverflow,
    bottomHidden,
    wide: wide.slice(0, 12),
    tooTall: tooTall.slice(0, 8),
    clipped: clipped.slice(0, 12),
    clamped: clamped.slice(0, 6),
    smallTargets: smallTargets.slice(0, 10),
    overlaps: overlaps.slice(0, 10),
    counts: {
      wide: wide.length,
      tooTall: tooTall.length,
      clipped: clipped.length,
      clamped: clamped.length,
      smallTargets: smallTargets.length,
      overlaps: overlaps.length,
      bottomHidden: bottomHidden ? bottomHidden.length : 0,
    },
    tokens,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureOurApp(browser, profile, page) {
  const ctx = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
    userAgent: profile.mobile
      ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
      : undefined,
  });
  const tab = await ctx.newPage();
  const url = `${BASE}${page.url}`;
  const report = { page: page.name, profile: profile.name, url, errors: [], consoleErrors: [] };
  tab.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(m.text().slice(0, 160)); });
  tab.on("pageerror", (e) => report.consoleErrors.push(String(e).slice(0, 160)));

  try {
    // The tour overlays the app on first run in a fresh profile — it is not a
    // layout defect. Pre-seed it as seen, at the CURRENT version so a bump
    // cannot make it open and cover the page being measured.
    await tab.addInitScript((v) => {
      try { localStorage.setItem("yt_whatsnew_seen", v); } catch { /* ignore */ }
    }, APP_VERSION);
    await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // give the data layer time to paint real content, not skeletons
    await sleep(4500);
    for (const y of [0, 400, 900]) { await tab.evaluate((yy) => window.scrollTo(0, yy), y); await sleep(400); }
    await tab.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
    report.measures = await tab.evaluate(auditInPage);
  } catch (e) {
    report.errors.push(String(e.message || e).slice(0, 200));
  }

  const dir = path.join(OUT, profile.name);
  fs.mkdirSync(dir, { recursive: true });
  const shot = path.join(dir, `${page.name}.png`);
  try {
    await tab.screenshot({ path: shot });
    report.screenshot = shot;
    // full-page for the long feeds, so cut-offs lower down are visible too
    if (page.name === "home" || page.name === "search" || page.name === "settings") {
      const full = path.join(dir, `${page.name}-full.png`);
      await tab.screenshot({ path: full, fullPage: true });
      report.screenshotFull = full;
    }
  } catch (e) {
    report.errors.push("screenshot: " + String(e.message || e).slice(0, 120));
  }
  await ctx.close();
  return report;
}

async function captureReference(browser, profile, page) {
  const ctx = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
    userAgent: profile.mobile
      ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
      : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const tab = await ctx.newPage();
  const mapping = {
    home: "https://m.youtube.com/",
    watch: "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    search: "https://m.youtube.com/results?search_query=space+documentary",
    shorts: "https://m.youtube.com/shorts",
    settings: "https://m.youtube.com/",
    channel: "https://m.youtube.com/@RickAstleyYT",
  };
  const url = profile.mobile ? mapping[page.name] : mapping[page.name].replace("m.youtube.com", "www.youtube.com");
  const report = { page: page.name, profile: profile.name, url, isReference: true, errors: [] };
  try {
    await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    // dismiss consent if present
    for (const sel of ['button:has-text("Accept all")', 'button:has-text("Reject all")', 'button:has-text("I agree")']) {
      try { await tab.click(sel, { timeout: 2500 }); break; } catch { /* not present */ }
    }
    await sleep(5000);
    report.measures = await tab.evaluate(auditInPage);
    report.title = await tab.title();
  } catch (e) {
    report.errors.push(String(e.message || e).slice(0, 200));
  }
  const dir = path.join(OUT, "reference", profile.name);
  fs.mkdirSync(dir, { recursive: true });
  try {
    await tab.screenshot({ path: path.join(dir, `${page.name}.png`) });
    report.screenshot = path.join(dir, `${page.name}.png`);
  } catch { /* ignore */ }
  await ctx.close();
  return report;
}

function toMarkdown(reports) {
  const lines = ["# UI audit", "", `Generated ${new Date().toISOString()}`, ""];
  for (const r of reports) {
    const m = r.measures;
    const tag = r.isReference ? "REF" : "OURS";
    lines.push(`## ${tag} · ${r.profile} · ${r.page}`);
    lines.push("");
    if (r.errors?.length) { lines.push(`- ⚠️ errors: ${r.errors.join("; ")}`); }
    if (!m) { lines.push("- no measurements"); lines.push(""); continue; }
    lines.push(`- viewport: ${m.viewport.vw}×${m.viewport.vh}`);
    lines.push(`- horizontal page overflow: **${m.docOverflow}px**`);
    lines.push(`- counts: wide=${m.counts.wide} tooTall=${m.counts.tooTall} clipped=${m.counts.clipped} (intentional ellipsis: ${m.counts.clamped}) smallTargets=${m.counts.smallTargets} overlaps=${m.counts.overlaps}`);
    if (m.wide.length) { lines.push(""); lines.push("**Elements past the right edge**"); for (const w of m.wide.slice(0, 6)) lines.push(`- \`${w.sel}\` right=${w.right} overhang=${w.overhang}px`); }
    if (m.overlaps.length) { lines.push(""); lines.push("**Overlapping interactive elements**"); for (const o of m.overlaps.slice(0, 6)) lines.push(`- \`${o.a}\` ↔ \`${o.b}\` (${o.overlapPct}%) "${o.aText}" / "${o.bText}"`); }
    if (m.clipped.length) { lines.push(""); lines.push("**Clipped text (no line-clamp — a real cut-off)**"); for (const c of m.clipped.slice(0, 6)) lines.push(`- \`${c.sel}\` cut ${c.cutPx}px — "${c.text}"`); }
    if (m.tooTall.length) { lines.push(""); lines.push("**Taller than viewport**"); for (const t of m.tooTall.slice(0, 5)) lines.push(`- \`${t.sel}\` h=${t.height} (vh=${t.vh}) parentOverflowY=${t.parentOverflowY}`); }
    if (r.screenshot) { lines.push(""); lines.push(`![${tag} ${r.profile} ${r.page}](${path.relative("docs", r.screenshot)})`); }
    lines.push("");
  }
  return lines.join("\n");
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const reports = [];
  const pages = ONLY ? PAGES.filter((p) => p.name === ONLY) : PAGES;
  for (const profile of PROFILES) {
    for (const page of pages) {
      process.stdout.write(`[ours] ${profile.name}/${page.name} … `);
      const r = await captureOurApp(browser, profile, page);
      reports.push(r);
      const m = r.measures;
      console.log(m ? `overflow=${m.docOverflow}px wide=${m.counts.wide} clip=${m.counts.clipped} ellipsis=${m.counts.clamped} overlap=${m.counts.overlaps} small=${m.counts.smallTargets}` : `FAILED (${r.errors[0] || "?"})`);
    }
  }
  if (DO_REF) {
    for (const profile of PROFILES) {
      for (const page of pages) {
        process.stdout.write(`[ref]  ${profile.name}/${page.name} … `);
        const r = await captureReference(browser, profile, page);
        reports.push(r);
        console.log(r.measures ? `ok (${r.title || ""})` : `FAILED (${r.errors[0] || "?"})`);
      }
    }
  }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(reports, null, 2));
  fs.writeFileSync(path.join(OUT, "REPORT.md"), toMarkdown(reports));
  console.log(`\nReport → ${OUT}/REPORT.md  (screenshots in ${OUT}/)`);
})();
