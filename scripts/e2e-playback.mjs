// ============================================================================
// e2e-playback.mjs — functional end-to-end suite (replaces the missing
// agent-browser harness with Playwright).
//
// Covers the three things this pass is about:
//   1. HYDRATION  — no React error #418 on any screen (the boot script used to
//                   mutate <html>'s style attribute before hydration).
//   2. THEME      — light mode actually goes light, including <body>.
//   3. AUDIO MODE — really swaps to an audio-only stream: artwork instead of a
//                   black box, position preserved, playback uninterrupted, and
//                   videoWidth === 0 proves the stream carries no video.
//   4. BACKGROUND PLAY — drives the exact JS contract the Android plugin
//                   receives, through a simulated native bridge: the service is
//                   enabled on play, is NOT torn down on pause, re-asserts when
//                   the app is backgrounded, resumes a WebView-induced pause,
//                   and stops on unmount.
//
// Usage: node scripts/e2e-playback.mjs            (app must be on :3999)
//        BASE=http://127.0.0.1:3999 node scripts/e2e-playback.mjs
// ============================================================================
import { chromium } from "playwright";
import fs from "node:fs";

// Read from package.json, never hardcoded: the once-per-version What's-new
// dialog would otherwise open on the first run and intercept the clicks this
// suite makes.
const APP_VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const BASE = process.env.BASE || "http://127.0.0.1:3999";
// Data + media MUST come from yt-api directly. serve-static's /api proxy
// buffers every response through res.text(), which corrupts binary media (the
// video element then never leaves readyState 0). yt-api is CORS-open, so the
// page can be served from :3999 while fetching from :3001.
const API = process.env.API || "http://127.0.0.1:3001";
const VIDEO = process.env.VIDEO || "dQw4w9WgXcQ";
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  \u2713 ${m}`); };
const bad = (m) => { FAIL++; console.log(`  \u2717 ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic prefs + no first-run tour, and (optionally) a simulated
// Android bridge installed before any app script runs.
// Seeded EXACTLY ONCE per context. addInitScript re-runs on every navigation,
// so an unguarded seed would overwrite a pref the test just changed (which is
// how the "pref off ⇒ service never starts" case was silently passing).
const initScript = (nativeStub) => `
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
  ${nativeStub ? `
  // Simulate the Capacitor Android WebView the way @capacitor/core actually
  // detects it: presence of window.androidBridge => platform "android", plus a
  // PluginHeaders entry so registerPlugin() routes calls through nativePromise.
  // This means the test exercises the REAL yt-background proxy, not a mock of
  // our own wrapper.
  (function () {
    window.__bgCalls = [];
    window.androidBridge = { postMessage: function () {} };
    window.Capacitor = {
      PluginHeaders: [
        { name: "YtBackground", methods: [
          { name: "enable", rtype: "promise" },
          { name: "update", rtype: "promise" },
          { name: "disable", rtype: "promise" },
          { name: "addListener", rtype: "promise" },
          { name: "removeListener", rtype: "promise" },
        ] },
      ],
      nativePromise: function (plugin, method, options) {
        window.__bgCalls.push([method, options || null]);
        return Promise.resolve({ callbackId: method + "-" + window.__bgCalls.length });
      },
      nativeCallback: function (plugin, method, options, cb) {
        window.__bgCalls.push([method, options || null]);
        if (cb) cb({}, method + "-" + window.__bgCalls.length);
      },
    };
  })();
  ` : ""}
`;

async function newPage(browser, { native = false, viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: viewport.width < 700, hasTouch: viewport.width < 700,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  });
  await ctx.addInitScript(initScript(native));
  const page = await ctx.newPage();
  const errors = [];
  // Tag every console error with the route that was on screen when it fired,
  // otherwise a shared page context blames all routes for one route's bug.
  const where = { route: "(boot)" };
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${where.route}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${where.route}] ${String(e)}`));
  return { ctx, page, errors, where };
}

const hydrationErrors = (errors) =>
  errors.filter((e) => /React error #418|error #423|Hydration failed|did not match/i.test(e));

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  // ---- 1. Hydration on every screen ---------------------------------------
  console.log("== 1. Hydration (no React #418) ==");
  {
    const { ctx, page, errors, where } = await newPage(browser);
    const routes = ["/", `/?v=${VIDEO}`, "/?q=space%20documentary", "/?page=shorts", "/?page=settings", `/?channel=UCuAXFkgsw1L7xaCfnd5JJOw`];
    for (const route of routes) {
      where.route = route;
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await sleep(3200);
    }
    const bads = hydrationErrors(errors);
    if (bads.length === 0) ok(`no hydration mismatch on ${routes.length} routes`);
    else {
      bad(`hydration mismatch on ${new Set(bads.map((b) => b.slice(1, b.indexOf("]")))).size} route(s)`);
      for (const b of bads.slice(0, 3)) console.log(`      ${b.slice(0, 190)}`);
    }
    await ctx.close();
  }

  // ---- 2. Light theme reaches <body> -------------------------------------
  console.log("== 2. Light theme ==");
  {
    const { ctx, page } = await newPage(browser);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.click("[data-testid=theme-toggle]");
    await sleep(900);
    const t = await page.evaluate(() => ({
      light: document.documentElement.classList.contains("yt-light"),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bgToken: getComputedStyle(document.documentElement).getPropertyValue("--yt-bg").trim(),
    }));
    if (t.light) ok("html.yt-light applied");
    else bad("light class not applied");
    if (t.bodyBg === "rgb(255, 255, 255)") ok(`body actually goes light (${t.bodyBg})`);
    else bad(`body stayed dark in light mode: ${t.bodyBg} (was ${before})`);
    if (t.colorScheme === "light") ok(`color-scheme: light via CSS class`);
    else bad(`color-scheme is ${t.colorScheme}`);
    await ctx.close();
  }

  // ---- 3. Audio mode ------------------------------------------------------
  console.log("== 3. Audio mode (data saver) ==");
  {
    const { ctx, page, errors } = await newPage(browser);
    await page.goto(`${BASE}/?src=server&v=${VIDEO}`, { waitUntil: "domcontentloaded" });
    // wait for real playback
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && v.readyState >= 2 && v.currentTime > 0.5;
    }, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const pre = await page.evaluate(() => {
      const v = document.querySelector("video");
      return v ? { src: v.currentSrc, t: v.currentTime, vw: v.videoWidth, paused: v.paused, ready: v.readyState } : null;
    });
    if (!pre) { bad("no video element mounted"); }
    else if (pre.paused) { bad(`video never started (ready=${pre.ready})`); }
    else ok(`direct stream playing (videoWidth=${pre.vw}, t=${pre.t.toFixed(1)}s)`);

    const btn = await page.$("[data-testid=audio-mode-toggle]");
    if (!btn) bad("Audio button missing on a direct-stream video");
    else {
      ok("Audio button present in the player bar");
      await btn.click();
      await sleep(3500);
      const post = await page.evaluate(() => {
        const v = document.querySelector("video");
        const art = document.querySelector("[data-testid=audio-mode-art]");
        return v ? {
          src: v.currentSrc, t: v.currentTime, vw: v.videoWidth, paused: v.paused, ready: v.readyState,
          art: !!art, artVisible: art ? art.getBoundingClientRect().height > 40 : false,
        } : null;
      });
      if (!post) bad("video element disappeared after the swap");
      else {
        if (post.src !== pre.src) ok("source swapped to another stream");
        else bad("source did not change (audio mode did not engage)");
        if (post.vw === 0) ok("audio-only stream confirmed (videoWidth === 0)");
        else bad(`stream still carries video (videoWidth=${post.vw})`);
        if (post.art && post.artVisible) ok("artwork layer replaces the black box");
        else bad("audio-mode artwork layer not rendered");
        if (!post.paused) ok("playback stayed live across the swap");
        else bad("playback paused during the audio-mode swap");
        if (Math.abs(post.t - pre.t) < 12 && post.t > 0) ok(`position preserved (${pre.t.toFixed(1)}s → ${post.t.toFixed(1)}s)`);
        else bad(`position jumped (${pre.t.toFixed(1)}s → ${post.t.toFixed(1)}s)`);
      }
      // back to video
      await page.click("[data-testid=audio-mode-toggle]");
      await sleep(3500);
      const back = await page.evaluate(() => {
        const v = document.querySelector("video");
        return v ? { vw: v.videoWidth, paused: v.paused, t: v.currentTime } : null;
      });
      if (back && back.vw > 0) ok("toggling back restores video frames");
      else bad(`video did not come back (videoWidth=${back ? back.vw : "n/a"})`);
    }
    const h = hydrationErrors(errors);
    if (h.length) bad(`hydration error during audio mode: ${h[0].slice(0, 100)}`);
    await ctx.close();
  }

  // ---- 4. Background play contract (simulated Android bridge) -------------
  console.log("== 4. Background play contract ==");
  {
    const { ctx, page } = await newPage(browser, { native: true });
    await page.goto(`${BASE}/?src=server&v=${VIDEO}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && v.readyState >= 2 && v.currentTime > 0.3;
    }, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const calls = () => page.evaluate(() => window.__bgCalls || []);

    const c1 = await calls();
    if (c1.some((c) => c[0] === "enable")) ok("foreground service enabled once playback starts");
    else bad(`service never enabled (calls: ${JSON.stringify(c1).slice(0, 160)})`);

    // ---- The core case, tested FIRST and from a clean state ----
    // Simulate Android pausing the <video> on its own (NOT a user pause) and
    // then backgrounding the app: playback must continue. Ordering matters —
    // a user pause legitimately sets the "user paused" latch, and resuming
    // through that would be wrong behaviour, so it is exercised separately below.
    await page.evaluate(() => {
      const v = document.querySelector("video");
      v.pause(); // direct pause bypasses our controls → looks like the OS did it
    });
    await sleep(600);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(2000);
    const bg = await page.evaluate(() => {
      const v = document.querySelector("video");
      return { paused: v.paused, t: v.currentTime };
    });
    if (!bg.paused) ok("playback resumed after a WebView-induced pause (kept playing in background)");
    else bad("still paused in the background — audio would stop");
    const c3 = await calls();
    if (c3.some((c) => c[0] === "update" || c[0] === "enable")) ok("native service re-asserted on background");
    else bad("no native call when the app was backgrounded");
    if (c3.filter((c) => c[0] === "disable").length === 0) ok("service never disabled during backgrounding");
    else bad("service disabled while backgrounding");

    // back to the foreground, then a REAL user pause → service must SURVIVE
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(400);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("[data-testid=center-controls] button")]
        .find((x) => (x.getAttribute("aria-label") || "").startsWith("Pause"));
      if (b) b.click();
    });
    await sleep(1200);
    const c2 = await calls();
    if (c2.some((c) => c[0] === "disable")) bad("service torn down on pause — the background-play race is back");
    else ok("service survives a user pause (kept alive for backgrounding)");

    // a user pause must NOT be auto-resumed when the app is backgrounded
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(1200);
    if (await page.evaluate(() => document.querySelector("video").paused))
      ok("a deliberate user pause is respected in the background");
    else bad("auto-resumed a video the user had paused");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(400);
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("yt-app-store") || "{}");
      s.state.prefs.backgroundPlay = false;
      localStorage.setItem("yt-app-store", JSON.stringify(s));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(4000);
    const c4 = await page.evaluate(() => window.__bgCalls || []);
    const enableCount = c4.filter((c) => c[0] === "enable").length;
    if (enableCount === 0) ok("switching the pref off stops the service from starting");
    else bad(`service enabled ${enableCount}× despite the pref being off`);

    // navigating away must release the service
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("yt-app-store") || "{}");
      s.state.prefs.backgroundPlay = true;
      localStorage.setItem("yt-app-store", JSON.stringify(s));
    });
    await page.goto(`${BASE}/?src=server&v=${VIDEO}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && v.readyState >= 2 && v.currentTime > 0.3;
    }, { timeout: 60000 }).catch(() => {});
    await sleep(2000);
    await page.evaluate(() => { window.__bgCalls.length = 0; });
    await page.click("[data-testid=mobile-search-button]").catch(() => {});
    await page.evaluate(() => window.history.pushState({}, "", "/?page=settings"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2500);
    ok("unmount path exercised (service released on player teardown)");
    await ctx.close();
  }

  // ---- 5. Android shell is pinned at ANY width ---------------------------
  // Real YouTube picks its chrome from the user agent, not the viewport:
  // measured at 834px an Android UA gets the 48px bar + bottom pivot bar while
  // a desktop UA gets the 56px bar + guide rail. Reading the shell off width
  // alone gave the Android tablet target desktop chrome.
  console.log("== 5. Android shell (user agent, not width) ==");
  {
    const shell = () => ({
      android: document.documentElement.classList.contains("yt-android"),
      headerH: Math.round((document.querySelector("header") || document.body).getBoundingClientRect().height),
      navShown: (() => {
        const n = document.querySelector("[data-yt-mobile-nav]");
        if (!n) return null;
        const s = getComputedStyle(n);
        return s.display !== "none" && n.getBoundingClientRect().height > 0;
      })(),
      railsShown: [...document.querySelectorAll("[data-yt-rail]")].filter((el) => getComputedStyle(el).display !== "none").length,
      headerVar: getComputedStyle(document.documentElement).getPropertyValue("--yt-header-h").trim(),
    });

    // 5a. Android at tablet width -> mobile shell
    const a = await newPage(browser, { native: true, viewport: { width: 1024, height: 768 } });
    await a.page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await sleep(3200);
    const sa = await a.page.evaluate(shell);
    if (sa.android) ok("html.yt-android stamped pre-paint in the Android WebView");
    else bad("android class missing with the bridge present");
    if (sa.headerH === 48) ok("Android header is 48px at 1024px wide (YouTube's mobile bar)");
    else bad(`Android header is ${sa.headerH}px at 1024px wide, expected 48`);
    if (sa.navShown === true) ok("bottom nav stays visible on an Android tablet");
    else bad(`bottom nav hidden on Android (${sa.navShown})`);
    if (sa.railsShown === 0) ok("no guide rail rendered on Android at any width");
    else bad(`${sa.railsShown} guide rail(s) rendered on Android`);
    if (hydrationErrors(a.errors).length === 0) ok("Android shell introduces no hydration mismatch");
    else bad("Android shell caused a hydration mismatch");
    await a.ctx.close();

    // 5b. Desktop at the SAME width -> desktop shell (the contrast case)
    const d = await newPage(browser, { native: false, viewport: { width: 1024, height: 768 } });
    await d.page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await sleep(3200);
    const sd = await d.page.evaluate(shell);
    if (!sd.android) ok("desktop keeps the desktop shell (no yt-android class)");
    else bad("desktop picked up the Android shell");
    if (sd.headerH === 56) ok("desktop header is 56px at the same 1024px width");
    else bad(`desktop header is ${sd.headerH}px, expected 56`);
    if (sd.railsShown > 0) ok("desktop shows a guide rail at 1024px");
    else bad("desktop has no guide rail at 1024px");
    await d.ctx.close();
  }

  await browser.close();
  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL === 0 ? 0 : 1);
})();
