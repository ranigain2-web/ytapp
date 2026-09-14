// ============================================================================
// fidelity-bar.mjs — measures REAL m.youtube.com and OUR app in the same
// browser at the same viewports, then prints a side-by-side diff.
//
// Why: "the UI must look like actual YouTube" is only meaningful as a diff
// against the real thing. The VLM critic from the old sandbox is not available
// here, so this harness replaces opinion with numbers: column counts, item
// sizes, gaps, radii, typography, header/sidebar/player geometry — captured
// from YouTube's own DOM as the reference bar for our DOM.
//
// Usage:
//   bash scripts/with-server.sh 'node scripts/fidelity-bar.mjs'
//   REF=https://www.youtube.com/watch?v=dQw4w9WgXcQ node scripts/fidelity-bar.mjs
//   ONLY=home node scripts/fidelity-bar.mjs
// ============================================================================
import { chromium } from "playwright";
import fs from "node:fs";

// Read from package.json, never hardcoded: the once-per-version What's-new
// dialog would otherwise open on the first run and cover the page being
// measured, which reads as a layout difference against YouTube.
const APP_VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const OURS = process.env.BASE || "http://127.0.0.1:3999";
const REF_BASE = process.env.REF_BASE || "https://m.youtube.com";
const OUT = process.env.OUT || "docs/screenshots/fidelity";
const ONLY = process.env.ONLY || "";
const VIDEO = "dQw4w9WgXcQ";

// Reference choice is per profile and must match the SHELL our app renders at
// that size, or the diff compares two different products. Our shell is pinned
// by the platform: no Capacitor bridge here, so tablet-and-up render the
// desktop shell (56px bar + guide rail) and must be compared against
// www.youtube.com with a desktop UA. YouTube picks its chrome from the user
// agent, so pointing m.youtube.com's Android UA at our 834px desktop shell
// reported a phantom "48 vs 56 header" mismatch. Phone keeps the Android UA and
// the mobile reference. (The Android-tablet shell — mobile chrome at any width —
// is asserted directly in scripts/e2e-playback.mjs §5.)
const PROFILES = [
  { name: "phone", width: 390, height: 844, dpr: 3, mobile: true, ref: "https://m.youtube.com" },
  // iPad-size portrait. Wide enough for the guide rail in our shell.
  { name: "tablet", width: 834, height: 1194, dpr: 2, mobile: false, ref: "https://www.youtube.com" },
  // A Mac window that is not maximised — the case where the guide used to
  // disappear entirely (full guide needs xl, and nothing else rendered a rail).
  { name: "laptop", width: 1024, height: 768, dpr: 2, mobile: false, ref: "https://www.youtube.com" },
  { name: "desktop", width: 1440, height: 900, dpr: 1, mobile: false, ref: "https://www.youtube.com" },
];

const CASES = [
  { name: "home", ours: "/", ref: "/" },
  { name: "watch", ours: `/?v=${VIDEO}`, ref: `/watch?v=${VIDEO}` },
  { name: "search", ours: "/?q=space%20documentary", ref: "/results?search_query=space+documentary" },
];

// Runs inside the page. Dependency-free.
function probe() {
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
  };
  const R = (el) => el.getBoundingClientRect();
  const isVisible = (el) => {
    const r = R(el);
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  };

  // ---- feed grid: the container whose element children are uniform tiles ----
  // Comment threads look exactly like a uniform grid (same width, same height,
  // 6+ of them), so on watch pages they used to win the "most children" tie and
  // the table silently compared comment rows instead of the related list.
  const inComments = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      const id = n.id || "";
      const label = n.getAttribute?.("aria-label") || "";
      if (/comment/i.test(tag) || /comment/i.test(id) || /comment/i.test(label)) return true;
    }
    return false;
  };
  let gridEl = null, best = 0;
  for (const el of document.querySelectorAll("div, ytd-rich-grid-renderer, ytd-rich-grid-media, ul")) {
    if (inComments(el)) continue;
    const kids = [...el.children].filter((c) => isVisible(c) && R(c).width > 90 && R(c).height > 70);
    if (kids.length < 6) continue;
    const ws = kids.map((c) => R(c).width);
    const spread = Math.max(...ws) - Math.min(...ws);
    if (spread > 6) continue;
    if (kids.length > best) { best = kids.length; gridEl = el; }
  }

  let grid = null;
  if (gridEl) {
    const kids = [...gridEl.children].filter((c) => isVisible(c) && R(c).width > 90 && R(c).height > 70);
    const xs = [...new Set(kids.map((c) => Math.round(R(c).left)))].sort((a, b) => a - b);
    const ys = [...new Set(kids.map((c) => Math.round(R(c).top)))].sort((a, b) => a - b);
    const first = kids[0];
    const cs = getComputedStyle(gridEl);
    grid = {
      // Which element was measured. Without this the table reports numbers
      // from an unknown container and you cannot tell a real mismatch from
      // the probe picking a different node on each site.
      el: `${gridEl.tagName.toLowerCase()}.${String(gridEl.className || "").slice(0, 46)}`,
      columns: xs.length,
      rows: ys.length,
      itemW: Math.round(R(first).width),
      itemH: Math.round(R(first).height),
      gapX: xs.length > 1 ? Math.round(xs[1] - xs[0] - R(first).width) : null,
      gapY: ys.length > 1 ? Math.round(ys[1] - ys[0] - R(first).height) : null,
      padLeft: Math.round(R(gridEl).left),
      padTop: Math.round(R(gridEl).top),
      gridTemplate: cs.gridTemplateColumns,
    };

    // thumbnail geometry + radius inside the first tile
    const thumb = [...first.querySelectorAll("*")].find((el) => {
      const r = R(el);
      return r.width > 90 && r.height > 40 && Math.abs(r.width / r.height - 16 / 9) < 0.35;
    });
    if (thumb) {
      const tcs = getComputedStyle(thumb);
      grid.thumbW = Math.round(R(thumb).width);
      grid.thumbH = Math.round(R(thumb).height);
      grid.thumbRadius = px(tcs.borderRadius);
      grid.thumbOverflow = tcs.overflow;
    }
  }

  // ---- leaf-text samples (typography bar): biggest text first ----
  const leafTexts = [];
  const scope = gridEl || document.body;
  for (const el of scope.querySelectorAll("*")) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || "").trim();
    if (!t || t.length < 2) continue;
    const r = R(el);
    if (r.width < 20 || r.height < 6) continue;
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    leafTexts.push({
      text: t.slice(0, 34),
      fs: px(cs.fontSize),
      lh: px(cs.lineHeight),
      w: px(cs.fontWeight),
      color: cs.color,
      h: Math.round(r.height),
      clamp: cs.webkitLineClamp !== "none" ? cs.webkitLineClamp : null,
    });
  }
  leafTexts.sort((a, b) => b.fs - a.fs);

  // ---- chrome geometry ----
  const chrome = {};
  const pick = (sel) => { const el = document.querySelector(sel); return el && isVisible(el) ? el : null; };
  const header = pick("header") || pick("#masthead-container") || pick("ytm-header-bar");
  if (header) { chrome.headerH = Math.round(R(header).height); }
  // Report EVERY on-screen guide/pivot element instead of guessing one: the
  // mobile drawer sits at translate(-100%), so a naive querySelector("nav")
  // reported the off-screen drawer (240×full-height) and hid whether a real
  // rail was rendered.
  const vh0 = document.documentElement.clientHeight;
  chrome.navs = [...document.querySelectorAll("nav, aside, ytm-pivot-bar-renderer")]
    .filter(isVisible)
    .map((el) => {
      const r = R(el);
      const label = el.getAttribute("aria-label") || el.tagName.toLowerCase();
      return { label: label.slice(0, 16), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((n) => n.x > -30 && n.y < vh0 && n.w <= 900)
    .slice(0, 3)
    .map((n) => `${n.label}@${n.x},${n.y} ${n.w}×${n.h}`);
  const video = document.querySelector("video");
  if (video) {
    const v = R(video);
    chrome.playerW = Math.round(v.width);
    chrome.playerH = Math.round(v.height);
    chrome.playerRadius = px(getComputedStyle(video.closest("div") || video).borderRadius);
  }
  // widest page-level horizontal scroller (the "cut off section" smell)
  let scroll = 0;
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollWidth - el.clientWidth > scroll) scroll = el.scrollWidth - el.clientWidth;
  }
  chrome.maxInnerScrollX = scroll;

  return {
    viewport: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    docScrollW: document.documentElement.scrollWidth,
    bodyW: Math.round(document.body.getBoundingClientRect().width),
    grid, chrome,
    texts: leafTexts.slice(0, 7),
    counts: {
      imgs: document.images.length,
      videos: document.querySelectorAll("video").length,
      buttons: document.querySelectorAll("button").length,
      links: document.querySelectorAll("a").length,
    },
  };
}

async function settle(page, ms) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(ms);
  // nudge lazy content + let layout stabilise
  await page.evaluate(() => window.scrollTo(0, 400)).catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(700);
}

async function dismissConsent(page) {
  for (const label of ["Accept all", "I agree", "Reject all", "Accept the use of cookies", "Got it"]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count().catch(() => 0)) {
      await b.first().click().catch(() => {});
      await page.waitForTimeout(1200);
      return label;
    }
  }
  return null;
}

const fmt = (v) => (v === null || v === undefined ? "—" : String(v));

function diffTable(ours, ref) {
  const rows = [];
  const push = (k, a, b) => rows.push([k, fmt(a), fmt(b)]);
  push("viewport", `${ours.viewport.w}×${ours.viewport.h}`, `${ref.viewport.w}×${ref.viewport.h}`);
  push("grid el", ours.grid?.el, ref.grid?.el);
  push("grid columns", ours.grid?.columns, ref.grid?.columns);
  push("item W×H", ours.grid ? `${ours.grid.itemW}×${ours.grid.itemH}` : null, ref.grid ? `${ref.grid.itemW}×${ref.grid.itemH}` : null);
  push("gap X / Y", ours.grid ? `${fmt(ours.grid.gapX)}/${fmt(ours.grid.gapY)}` : null, ref.grid ? `${fmt(ref.grid.gapX)}/${fmt(ref.grid.gapY)}` : null);
  push("grid padLeft", ours.grid?.padLeft, ref.grid?.padLeft);
  push("thumb W×H", ours.grid ? `${fmt(ours.grid.thumbW)}×${fmt(ours.grid.thumbH)}` : null, ref.grid ? `${fmt(ref.grid.thumbW)}×${fmt(ref.grid.thumbH)}` : null);
  push("thumb radius", ours.grid?.thumbRadius, ref.grid?.thumbRadius);
  push("header height", ours.chrome.headerH, ref.chrome.headerH);
  push("navs", ours.chrome.navs?.join(" | "), ref.chrome.navs?.join(" | "));
  push("player W×H", ours.chrome.playerW ? `${ours.chrome.playerW}×${ours.chrome.playerH}` : null, ref.chrome.playerW ? `${ref.chrome.playerW}×${ref.chrome.playerH}` : null);
  push("max inner scrollX", ours.chrome.maxInnerScrollX, ref.chrome.maxInnerScrollX);
  const w = [12, 44, 44];
  const line = (c) => c.map((s, i) => String(s).padEnd(w[i])).join(" | ");
  return [line(["metric", "OURS", "YOUTUBE"]), line(["-".repeat(12), "-".repeat(26), "-".repeat(26)]), ...rows.map(line)].join("\n");
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=en-US"] });
  const report = {};

  for (const prof of PROFILES) {
    for (const c of CASES) {
      if (ONLY && ONLY !== c.name) continue;
      const key = `${prof.name}/${c.name}`;
      report[key] = {};
      for (const side of ["ours", "ref"]) {
        const ctx = await browser.newContext({
          viewport: { width: prof.width, height: prof.height },
          deviceScaleFactor: prof.dpr,
          isMobile: prof.mobile,
          hasTouch: prof.mobile,
          locale: "en-US",
          extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
          userAgent: prof.mobile
            ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
            : undefined,
        });
        if (side === "ours") {
          await ctx.addInitScript((v) => {
            try {
              localStorage.setItem("yt_whatsnew_seen", v);
              localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {
                sponsorblock: false, autoplay: false, defaultQuality: "auto",
                cinemaMode: false, theme: "dark", backgroundPlay: true, audioOnly: false } }, version: 0 }));
            } catch { /* ignore */ }
          }, APP_VERSION);
        }
        const page = await ctx.newPage();
        const url = side === "ours" ? OURS + c.ours : (prof.ref || REF_BASE) + c.ref;
        let err = null;
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
          if (side === "ref") await dismissConsent(page);
          await settle(page, side === "ref" ? 6500 : 4200);
          const data = await page.evaluate(probe);
          report[key][side] = data;
          fs.mkdirSync(`${OUT}/${prof.name}`, { recursive: true });
          await page.screenshot({ path: `${OUT}/${prof.name}/${c.name}-${side}.png`, fullPage: side === "ours" }).catch(() => {});
        } catch (e) {
          err = String(e).slice(0, 120);
          report[key][side] = { error: err };
        }
        await ctx.close();
      }
      const a = report[key].ours, b = report[key].ref;
      console.log(`\n${"=".repeat(72)}\n${key}\n${"=".repeat(72)}`);
      if (a?.error) console.log(`  OURS failed: ${a.error}`);
      if (b?.error) console.log(`  YOUTUBE failed: ${b.error}`);
      if (a && !a.error && b && !b.error) {
        console.log(diffTable(a, b));
        console.log("\n  typography (ours):");
        for (const t of a.texts) console.log(`    ${String(t.fs).padStart(5)}px/${String(t.lh).padStart(5)}  w${t.w} h${t.h} clamp=${fmt(t.clamp)}  ${JSON.stringify(t.text)}`);
        console.log("  typography (youtube):");
        for (const t of b.texts) console.log(`    ${String(t.fs).padStart(5)}px/${String(t.lh).padStart(5)}  w${t.w} h${t.h} clamp=${fmt(t.clamp)}  ${JSON.stringify(t.text)}`);
      }
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/fidelity.json`, JSON.stringify(report, null, 2));
  console.log(`\nJSON → ${OUT}/fidelity.json   screenshots → ${OUT}/`);
  await browser.close();
})();
