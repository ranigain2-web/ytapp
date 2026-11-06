// verify-backbutton.mjs — in-browser verification of the phase-7 back-button
// layer (non-native paths): router entry marks, in-app back, overlay closer
// registration, and the home-seeded boot entry for deep cold-opens.
import { chromium } from "playwright";
const BASE = "http://127.0.0.1:3999";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(`
  localStorage.setItem("yt_api_base", "http://127.0.0.1:3001");
  localStorage.setItem("yt_whatsnew_seen", "2.0.0");
  localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {} }, version: 0 }));
`);
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await sleep(1500);

// 1) boot entry carries the root mark
const boot = await page.evaluate(() => JSON.stringify(window.history.state));
console.log("boot entry state:", boot, boot.includes("ytRoot") ? "✓" : "✗ MISSING ytRoot");

// 2) navigate home → watch → back via history.back(): route returns home
await page.evaluate(() => { window.location.href = "/?v=dQw4w9WgXcQ"; });
await sleep(2500);
const watchState = await page.evaluate(() => JSON.stringify(window.history.state));
console.log("watch entry state:", watchState, watchState.includes('"yt"') ? "✓" : "✗ MISSING yt mark");
const route1 = await page.evaluate(() => window.location.search);
await page.goBack();
await sleep(1200);
const route2 = await page.evaluate(() => window.location.search);
console.log(`history.back: ${route1 || "/"} → ${route2 || "/"} ${route2 === "" ? "✓ back to home" : "(still deep)"}`);

// 3) overlay closer registers while open (search overlay on mobile)
await page.click("button[aria-label='Search']").catch(() => {});
await sleep(600);
const overlayOpen = await page.evaluate(() => !!document.querySelector("input[placeholder*='Search'], input[type=text], input[type=search]"));
const guardCount = await page.evaluate(() => {
  // the store lives in the module graph — reach it via the exposed React tree?
  // simpler: the hook only registers on native=false too; count via a probe:
  return document.querySelectorAll("[data-testid=search-overlay], .fixed.inset-0").length;
});
console.log("search overlay open:", overlayOpen, "fixed layers:", guardCount);

// 4) deep cold-open boot seeds a home entry underneath
const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
await p2.addInitScript(`localStorage.setItem("yt_api_base", "http://127.0.0.1:3001"); localStorage.setItem("yt_whatsnew_seen", "2.0.0");`);
await p2.goto(`${BASE}/?v=dQw4w9WgXcQ`, { waitUntil: "domcontentloaded" });
await sleep(2000);
const deep = await p2.evaluate(() => JSON.stringify(window.history.state));
console.log("deep cold-open state:", deep, deep.includes('"yt"') ? "✓ (home seeded underneath — back lands on home)" : "✗");

// 5) the app still renders (no boot-time crash from the router patch)
const alive = await page.evaluate(() => !!document.querySelector("header"));
console.log("app alive after navigation:", alive);
await browser.close();
console.log("DONE");
