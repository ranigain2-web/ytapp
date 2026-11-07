// e2e-compat.mjs — Phase 2: the Compat Mode journey with a MOCKED native
// layer (fake Capacitor + fake YtCompat/YtBackground plugins injected before
// the app boots). No Android device needed — this locks the app-side wiring;
// the native WebView itself needs a device build (documented honestly in the
// phase gate).
//
// Journey: gated video (mocked API) shows the Compat entry (native mocked) →
// click → compat route → YtCompat.open called with the m.youtube.com URL and
// an injection carrying the guard → media message reaches the background
// service → notification pause executes a user-attributed pause inside the
// WebView → the close message tears down and returns to the video → the
// Settings kill-switch hides the entry.
// Run: bash scripts/with-server.sh 'node scripts/e2e-compat.mjs'

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3999";
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };

const browser = await chromium.launch();
const page = await browser.newPage();

// Fake native layer: emulates what the Android WebView bridge injects —
// androidBridge (platform detection), PluginHeaders + nativePromise/
// nativeCallback (registerPlugin's proxy dispatches through them), and the
// two local plugins as recorders. Everything the app wires is observable.
await page.addInitScript(() => {
  window.__compatLog = { opens: [], execs: [], bgUpdates: [], bgEnabled: 0, cookiePosts: [], closed: 0 };
  const log = window.__compatLog;
  const listeners = {};
  const promiseMethods = (names) => names.map(n => ({ name: n, rtype: "promise" }));
  window.androidBridge = {};
  window.Capacitor = {
    PluginHeaders: [
      { name: "YtCompat", methods: [...promiseMethods(["open", "execute", "close", "removeAllListeners"]), { name: "addListener", rtype: "callback" }] },
      { name: "YtBackground", methods: [...promiseMethods(["enable", "update", "disable", "keepAwake", "enterPip", "setPipOnHome", "removeAllListeners"]), { name: "addListener", rtype: "callback" }] },
    ],
    nativePromise: (plugin, method, options) => window.Capacitor.Plugins[plugin][method](options),
    nativeCallback: (plugin, method, options, cb) => {
      if (method === "addListener") {
        const key = plugin + ":" + (options && options.eventName);
        (listeners[key] = listeners[key] || []).push(cb);
        return { remove: () => {} };
      }
      return { remove: () => {} };
    },
    Plugins: {
      YtCompat: {
        open: (o) => { log.opens.push(o); return Promise.resolve(); },
        execute: (o) => { log.execs.push(o.js); return Promise.resolve({ value: "ok" }); },
        close: () => { log.closed++; return Promise.resolve(); },
        removeAllListeners: () => Promise.resolve(),
      },
      YtBackground: {
        enable: () => { log.bgEnabled++; return Promise.resolve(); },
        update: (o) => { log.bgUpdates.push(o); return Promise.resolve(); },
        disable: () => Promise.resolve(),
        removeAllListeners: () => Promise.resolve(),
      },
    },
  };
  window.__fireCompat = (m) => (listeners["YtCompat:message"] || []).forEach(cb => cb(m));
  window.__fireControl = (e) => (listeners["YtBackground:control"] || []).forEach(cb => cb(e));
  window.localStorage.setItem("yt_api_base", window.location.origin);
});

await page.route("**/api/video/**", (route) => {
  const url = route.request().url();
  if (url.includes("/comments")) return route.fulfill({ json: { comments: [], count: 0, continuation: null } });
  return route.fulfill({ json: {
    id: "gatedtest01", ok: false, embed_fallback: true, gate_reason: "bot_gate",
    playability_reason: "IOS=LOGIN_REQUIRED", title: "Gated Test Video", channel: "Test Channel",
    channel_id: "", views: "1M", duration: 60, published: "today", description: "",
    formats: [], hls: null, captions: [], storyboard: null, related: [], chapters: [],
  } });
});
await page.route("**/api/health*", (r) => r.fulfill({ json: { ok: true, po_token: true, uptime: 1 } }));
await page.route("**/api/home**", (r) => r.fulfill({ json: { category: "all", source: "search", results: [] } }));
await page.route("**/api/sponsorblock/**", (r) => r.fulfill({ json: { segments: [] } }));
await page.route("**/api/cookie", (route) => {
  if (route.request().method() === "POST") {
    return route.fulfill({ json: { ok: true, present: true, length: 40 } });
  }
  return route.fulfill({ json: { present: false, source: "none", length: 0, masked: null } });
});

console.log("== Scenario A: entry → open → bridge → teardown ==");
await page.goto(`${BASE}/?v=gatedtest01`, { waitUntil: "domcontentloaded" });
try {
  await page.locator("[data-testid='whats-new-got-it']").waitFor({ state: "visible", timeout: 6000 });
  await page.locator("[data-testid='whats-new-got-it']").click();
} catch { /* dialog not shown */ }

const entry = page.locator("[data-testid='compat-entry']");
try {
  await entry.waitFor({ state: "visible", timeout: 15_000 });
  ok("Compat entry shown on the embed fallback (native)");
} catch {
  bad("Compat entry missing on the embed fallback");
}

await entry.click();
await page.waitForTimeout(800);
const log1 = await page.evaluate(() => window.__compatLog);
if (log1.opens.length === 1 && log1.opens[0].url.includes("m.youtube.com/watch?v=gatedtest01")) {
  ok("open() called once with the mobile watch URL");
} else {
  bad(`open() wrong: ${JSON.stringify(log1.opens.map(o => o.url))}`);
}
const inj = log1.opens[0]?.injection || "";
if (inj.includes("visibilitychange") && inj.includes("shouldAutoResume") && inj.includes("ytCompatNative")) {
  ok("injection carries the spoof, the guard, and the bridge");
} else {
  bad("injection incomplete");
}
if (log1.bgEnabled >= 1) {
  ok("background service enabled for the compat session");
} else {
  bad("background service not enabled");
}

await page.evaluate(() => window.__fireCompat({ type: "media", playing: true, position: 12, duration: 200 }));
await page.waitForTimeout(400);
const log2 = await page.evaluate(() => window.__compatLog);
const upd = log2.bgUpdates[log2.bgUpdates.length - 1];
if (upd && upd.playing === true && upd.position === 12 && upd.duration === 200) {
  ok("media state relayed to the background service (lock-screen position)");
} else {
  bad(`bg update wrong: ${JSON.stringify(upd)}`);
}

await page.evaluate(() => window.__fireControl({ action: "pause" }));
await page.waitForTimeout(400);
const log3 = await page.evaluate(() => window.__compatLog);
const pauseJs = log3.execs[log3.execs.length - 1] || "";
if (pauseJs.includes("__ytUserPauseAt") && pauseJs.includes("pauseVideo")) {
  ok("notification pause executes a user-attributed pause (guard-safe)");
} else {
  bad(`pause execution wrong: ${pauseJs.slice(0, 60)}`);
}

await page.evaluate(() => window.__fireCompat({ type: "close" }));
await page.waitForTimeout(600);
const url = page.url();
if (url.includes("v=gatedtest01")) {
  ok("close message tears down compat and returns to the video");
} else {
  bad(`close did not navigate back: ${url}`);
}

console.log("== Scenario B: the Settings kill-switch ==");
await page.goto(`${BASE}/?page=settings`, { waitUntil: "domcontentloaded" });
const compatToggle = page.locator("[role='switch'][aria-label='Compat Mode']");
await compatToggle.waitFor({ state: "visible", timeout: 15_000 });
await compatToggle.click();
await page.goto(`${BASE}/?v=gatedtest01`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
if ((await page.locator("[data-testid='compat-entry']").count()) === 0) {
  ok("kill-switch hides the Compat entry");
} else {
  bad("kill-switch did not hide the entry");
}
// restore for other runs
await page.goto(`${BASE}/?page=settings`, { waitUntil: "domcontentloaded" });
await compatToggle.waitFor({ state: "visible", timeout: 10_000 });
await compatToggle.click();

console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
await browser.close();
if (FAIL > 0) process.exit(1);
