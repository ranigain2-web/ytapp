// audit-density.mjs — objective clutter signals on the phone surfaces:
// horizontal overflow, cramped interactive rows (<32px), wrapped action rows,
// elements overlapping, and touch targets under 40px. Produces a facts list,
// not vibes — each finding names the element chain.
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3999";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function audit(name, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(`
    localStorage.setItem("yt_api_base", "http://127.0.0.1:3001");
    localStorage.setItem("yt_whatsnew_seen", "2.0.0");
    localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {} }, version: 0 }));
  `);
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await sleep(5000);
  const findings = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
    const chain = el => { const parts = []; let n = el; for (let i = 0; i < 3 && n; i++) { parts.push(n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.split(" ").slice(0, 2).join(".") : "")); n = n.parentElement; } return parts.join(" < "); };

    // 1) horizontal overflow (the classic "feels off" signal on phones)
    if (document.documentElement.scrollWidth > vw + 2) {
      let worst = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 2 && r.width > 40 && vis(el)) { if (!worst || r.right > worst.r) worst = { el, r }; }
      }
      out.push(`H-OVERFLOW doc=${document.documentElement.scrollWidth}px vw=${vw}px worst=${worst ? chain(worst.el) + " right=" + Math.round(worst.r.right) : "?"}`);
    }
    // 2) cramped rows: consecutive siblings whose rects overlap vertically
    for (const row of document.querySelectorAll("div, section, header")) {
      if (!vis(row)) continue;
      const kids = [...row.children].filter(vis);
      if (kids.length < 3) continue;
      const rects = kids.map(k => k.getBoundingClientRect());
      let overlapPairs = 0;
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = rects[i], b = rects[j];
        const ov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ov > 4 && Math.min(a.height, b.height) > 8) overlapPairs++;
      }
      if (overlapPairs >= 2 && kids.length >= 4) { out.push(`OVERLAP ${chain(row)} (${overlapPairs}/${kids.length} kids)`); break; }
    }
    // 3) tiny touch targets (buttons/icons under 36px on a touch screen)
    const tiny = [];
    for (const el of document.querySelectorAll("button, [role=button], a")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 30 && r.width < 30) tiny.push(`${chain(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (tiny.length >= 5) break;
    }
    if (tiny.length) out.push("SMALL-TOUCH " + tiny.join(" | "));
    for (const el of document.querySelectorAll("header button")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 32 || r.width < 32) out.push(`HEADER-BTN ${el.getAttribute("aria-label") || el.textContent?.slice(0, 12) || "?"} ${Math.round(r.width)}x${Math.round(r.height)} cls=${String(el.className).slice(0, 60)}`);
    }
    // 4) text truncated mid-word inside buttons (wrap breaks)
    for (const b of document.querySelectorAll("button")) {
      if (!vis(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.height > 56 && b.textContent && b.textContent.trim().split(/\s+/).length <= 3 && !b.querySelector("svg,img")) out.push(`TALL-BTN ${chain(b)} h=${Math.round(r.height)}`);
    }
    return out;
  });
  console.log(`== ${name} ==`);
  console.log(findings.length ? findings.map(f => "  " + f).join("\n") : "  clean");
  await ctx.close();
}

await audit("home-phone", "/");
await audit("watch-phone", "/?v=dQw4w9WgXcQ");
await audit("search-phone", "/?q=music");
await browser.close();
console.log("DONE");
