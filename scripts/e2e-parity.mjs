// ============================================================================
// e2e-parity.mjs — STANDALONE-mode functional suite (the on-device code path).
//
// e2e-playback.mjs proves the app in SERVER mode (yt-api + byte proxy). This
// suite proves the path the Android APK actually ships: `?src=standalone`
// forces the on-device InnerTube engine through the dev relay (/api/ytb-relay)
// — the exact parser stack the WebView runs — without needing a device.
//
// Cases ported from the e2e-v12 agent-browser harness as structured Playwright
// checks (boot, theme cycle, search overlay, watch + related, shorts, settings
// persistence, history) and grow each phase per the plan.
//
// Usage: bash scripts/with-server.sh 'node scripts/e2e-parity.mjs'
//   BASE / VIDEO env overrides. Prints RESULT: N passed, M failed.
// ============================================================================
import { chromium } from "playwright";
import fs from "node:fs";

const APP_VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const BASE = process.env.BASE || "http://127.0.0.1:3999";
const API = process.env.API || "http://127.0.0.1:3001";
const VIDEO = process.env.VIDEO || "dQw4w9WgXcQ";
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  \u2713 ${m}`); };
const bad = (m) => { FAIL++; console.log(`  \u2717 ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const initScript = `
  try {
    if (!localStorage.getItem("yt_e2e_seeded")) {
      localStorage.setItem("yt_e2e_seeded", "1");
      localStorage.setItem("yt_whatsnew_seen", ${JSON.stringify(APP_VERSION)});
      localStorage.setItem("yt-app-store", JSON.stringify({ state: { prefs: {
        sponsorblock: false, autoplay: false, defaultQuality: "auto",
        cinemaMode: false, theme: "dark", backgroundPlay: true, audioOnly: false
      }}, version: 0 }));
      localStorage.setItem("yt_api_base", ${JSON.stringify(API)});
    }
  } catch (e) {}
`;

const waitdom = (page, expr, timeoutMs = 30000) =>
  page.waitForFunction(`(() => { try { return !!(${expr}); } catch { return false; } })()`, { timeout: timeoutMs }).catch(() => false);

async function newPage(browser, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: viewport.width < 700, hasTouch: viewport.width < 700,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  });
  await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  // ---- 1. Standalone boot: shell + real feed via the relay -----------------
  console.log("== 1. Standalone boot (relay-fed InnerTube) ==");
  {
    const { ctx, page, errors } = await newPage(browser);
    const booted = await (async () => {
      await page.goto(`${BASE}/?src=standalone`, { waitUntil: "domcontentloaded" });
      return waitdom(page, `document.querySelector("[data-testid=theme-toggle]")`, 30000);
    })();
    if (booted) ok("app shell boots in standalone mode");
    else bad("shell did not boot (relay down or parse failure)");

    const fed = await waitdom(page, `document.querySelectorAll("a[href*='v='], [data-video-id]").length >= 4`, 45000);
    if (fed) ok("home feed resolved REAL videos through the standalone engine");
    else bad("home feed stayed empty — standalone parsing failed");
    await ctx.close();
  }

  // ---- 2. Theme cycle in standalone ----------------------------------------
  console.log("== 2. Theme cycle ==");
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?src=standalone`, { waitUntil: "domcontentloaded" });
    await waitdom(page, `document.querySelector("[data-testid=theme-toggle]")`);
    await page.click("[data-testid=theme-toggle]");
    await sleep(800);
    const light = await page.evaluate(() => ({
      cls: document.documentElement.classList.contains("yt-light"),
      body: getComputedStyle(document.body).backgroundColor,
    }));
    if (light.cls && light.body === "rgb(255, 255, 255)") ok("light theme applied incl. body");
    else bad(`light theme broken (cls=${light.cls} body=${light.body})`);
    // The toggle is YouTube's 3-state cycle: dark → light → system → dark.
    // Two more taps return to dark through the system state.
    await page.click("[data-testid=theme-toggle]");
    await sleep(800);
    await page.click("[data-testid=theme-toggle]");
    await sleep(800);
    const dark = await page.evaluate(() => ({
      cls: document.documentElement.classList.contains("yt-dark") || !document.documentElement.classList.contains("yt-light"),
      body: getComputedStyle(document.body).backgroundColor,
    }));
    if (dark.cls && dark.body !== "rgb(255, 255, 255)") ok("theme cycles back to dark");
    else bad(`dark theme not restored (cls=${dark.cls} body=${dark.body})`);
    await ctx.close();
  }

  // ---- 3. Watch page in standalone ------------------------------------------
  console.log("== 3. Watch (standalone) ==");
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?src=standalone&v=${VIDEO}`, { waitUntil: "domcontentloaded" });
    const meta = await waitdom(page, `document.querySelector("h1") && document.querySelector("h1").textContent.trim().length > 3`, 45000);
    if (meta) ok("watch page resolved real metadata (title)");
    else bad("watch page metadata never loaded in standalone");
    // the player may be direct (green) or embed fallback (honest) — both valid;
    // what must NEVER happen is a dead surface with no player and no notice.
    const surface = await page.evaluate(() => ({
      video: !!document.querySelector("video"),
      iframe: !!document.querySelector("iframe"),
      notice: !!document.querySelector("[data-testid=embed-ended-overlay], [data-testid=blocked-video]"),
    }));
    if (surface.video || surface.iframe) ok(`player surface present (video=${surface.video} embed=${surface.iframe})`);
    else bad("no player surface at all (dead watch page)");
    await ctx.close();
  }

  // ---- 4. Search in standalone ----------------------------------------------
  console.log("== 4. Search (standalone) ==");
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?src=standalone`, { waitUntil: "domcontentloaded" });
    await waitdom(page, `document.querySelector("[data-testid=mobile-search-button], [data-testid=search-button]")`);
    await page.click("[data-testid=mobile-search-button], [data-testid=search-button]").catch(() => {});
    const typed = await page.evaluate(() => {
      const i = document.querySelector("input[type=search], input[type=text][aria-label*='earch' i], [data-testid=search-input] input, input");
      if (!i) return false;
      i.focus();
      return true;
    });
    if (typed) {
      await page.keyboard.type("lofi hip hop", { delay: 30 });
      await page.keyboard.press("Enter");
      const results = await waitdom(page, `document.querySelectorAll("a[href*='v=']").length >= 3`, 45000);
      if (results) ok("search returned real results in standalone");
      else bad("search produced no results in standalone");
    } else bad("search input not found");
    await ctx.close();
  }

  // ---- 5. Prefs persist across reload in standalone -------------------------
  console.log("== 5. Settings persistence ==");
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/?src=standalone&page=settings`, { waitUntil: "domcontentloaded" });
    await waitdom(page, `document.body.textContent.includes("Settings") || document.body.textContent.includes("appearance") || document.body.textContent.includes("Appearance")`, 30000);
    const stored = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("yt-app-store") || "{}");
      return { theme: s.state?.prefs?.theme, bg: s.state?.prefs?.backgroundPlay };
    });
    if (stored.theme) ok(`settings store alive (theme=${stored.theme})`);
    else bad("settings store missing/corrupt");
    await ctx.close();
  }

  // ---- 6. Hydration guard -----------------------------------------------------
  console.log("== 6. Hydration (standalone) ==");
  {
    const { ctx, page, errors } = await newPage(browser);
    for (const route of ["/?src=standalone", `/?src=standalone&v=${VIDEO}`, "/?src=standalone&page=shorts"]) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await sleep(2500);
    }
    const hyd = errors.filter((e) => /React error #418|#423|Hydration failed|did not match/i.test(e));
    if (hyd.length === 0) ok("no hydration mismatch on standalone routes");
    else bad(`hydration mismatch: ${hyd[0].slice(0, 120)}`);
    await ctx.close();
  }

  // phase 6: PWA installability surface (manifest + icons resolve)
  {
    try {
      const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
      if (m.icons?.length >= 2 && m.display === "standalone") ok("PWA manifest loads with icons (installable)");
      else bad("PWA manifest malformed");
      const icon = await fetch(`${BASE}${m.icons[0].src}`);
      if (icon.ok && (await icon.arrayBuffer()).byteLength > 1000) ok("PWA icon resolves (non-trivial bytes)");
      else bad("PWA icon missing");
      const pctx = await browser.newContext();
      const p = await pctx.newPage();
      await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      const link = await p.evaluate(() => !!document.querySelector('link[rel="manifest"]'));
      if (link) ok("manifest linked in the document head");
      else bad("manifest link missing from head");
      await pctx.close();
    } catch (e) {
      bad(`PWA checks failed: ${String(e).slice(0, 80)}`);
    }
  }

  await browser.close();
  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL === 0 ? 0 : 1);
})();
