// e2e-native-player.mjs — Phase 4 (N-02): the native-engine routing against
// a MOCKED native bridge (the Media3 Java side needs an Android build —
// documented as UNVERIFIED; this locks everything app-side).
//
// Journey (fake YtPlayer plugin + native-player pref forced on): watch page
// with a direct-stream video → prepare() called with the selected stream URL
// and metadata → native state events drive the store (position/playing) →
// the engine's togglePlay routes to the native player, not the element →
// teardown on navigation releases the engine.
// Run: bash scripts/with-server.sh 'node scripts/e2e-native-player.mjs'

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3999";
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };

const browser = await chromium.launch();
const page = await browser.newPage();

await page.addInitScript(() => {
  const listeners = {};
  window.__playerLog = { prepares: [], plays: 0, pauses: 0, seeks: [], releases: 0 };
  const log = window.__playerLog;
  const promiseMethods = (names) => names.map(n => ({ name: n, rtype: "promise" }));
  window.androidBridge = {};
  window.__impls = {
    YtPlayer: {
      prepare: (o) => { log.prepares.push(o); return Promise.resolve(); },
      play: () => { log.plays++; return Promise.resolve(); },
      pause: () => { log.pauses++; return Promise.resolve(); },
      seekTo: (o) => { log.seeks.push(o.to); return Promise.resolve(); },
      position: () => Promise.resolve({ state: "playing", position: 10, duration: 213 }),
      release: () => { log.releases++; return Promise.resolve(); },
      removeAllListeners: () => Promise.resolve(),
    },
  };
  window.Capacitor = {
    PluginHeaders: [
      { name: "YtPlayer", methods: [...promiseMethods(["prepare", "play", "pause", "seekTo", "position", "release", "removeAllListeners"]), { name: "addListener", rtype: "callback" }] },
    ],
    nativePromise: (plugin, method, options) => {
      const impl = window.__impls[plugin] && window.__impls[plugin][method];
      return impl ? impl(options) : Promise.reject(new Error("not faked: " + plugin + "." + method));
    },
    nativeCallback: (plugin, method, options, cb) => {
      if (method === "addListener") {
        const key = plugin + ":" + (options && options.eventName);
        (listeners[key] = listeners[key] || []).push(cb);
      }
      return { remove: () => {} };
    },
    Plugins: {},
  };
  window.__firePlayerState = (s) => (listeners["YtPlayer:state"] || []).forEach(cb => cb(s));
  window.localStorage.setItem("yt_api_base", window.location.origin);
  // force the experimental pref on (zustand persist shape: {state:{prefs:…}})
  try {
    const raw = window.localStorage.getItem("yt-app-store");
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state || {};
    parsed.state.prefs = { ...(parsed.state.prefs || {}), nativePlayer: true };
    window.localStorage.setItem("yt-app-store", JSON.stringify(parsed));
  } catch { /* best effort — the Settings toggle also works */ }
});

await page.route("**/api/video/**", (route) => {
  const url = route.request().url();
  if (url.includes("/comments")) return route.fulfill({ json: { comments: [], count: 0, continuation: null } });
  return route.fulfill({ json: {
    id: "directtest01", ok: true, embed_fallback: false, extracted_by: "IOS",
    title: "Direct Test Video", channel: "Test Channel", channel_id: "",
    views: "1M", duration: 213, published: "today", description: "",
    formats: [
      { itag: 18, mime: "video/mp4", codecs: "avc1.42E01E, mp4a.40.2", quality_label: "360p", height: 360, width: 640, fps: 30, bitrate: 500000, has_video: true, has_audio: true, url: "/api/segment/PROGRESSIVE_TOKEN" },
      { itag: 140, mime: "audio/mp4", codecs: "mp4a.40.2", quality_label: "tiny", height: 0, width: 0, fps: 0, bitrate: 130000, has_video: false, has_audio: true, url: "/api/segment/AUDIO_TOKEN" },
    ],
    hls: "/api/hls/directtest01", captions: [], storyboard: null, related: [], chapters: [],
  } });
});
await page.route("**/api/hls/**", (r) => r.fulfill({ content_type: "application/vnd.apple.mpegurl", body: "#EXTM3U\n" }));
await page.route("**/api/segment/**", (r) => r.fulfill({ status: 200, body: "x".repeat(1024) }));
await page.route("**/api/health*", (r) => r.fulfill({ json: { ok: true, po_token: true, uptime: 1 } }));
await page.route("**/api/home**", (r) => r.fulfill({ json: { category: "all", source: "search", results: [] } }));
await page.route("**/api/sponsorblock/**", (r) => r.fulfill({ json: { segments: [] } }));

await page.goto(`${BASE}/?v=directtest01`, { waitUntil: "domcontentloaded" });
try {
  await page.locator("[data-testid='whats-new-got-it']").waitFor({ state: "visible", timeout: 6000 });
  await page.locator("[data-testid='whats-new-got-it']").click();
} catch { /* dialog not shown */ }
await page.waitForTimeout(1500);

const log1 = await page.evaluate(() => window.__playerLog);
const prep = log1.prepares[0];
if (prep && prep.url && prep.url.includes("/api/hls/directtest01") && prep.hls === true && prep.title === "Direct Test Video") {
  ok(`prepare() called with the HLS source + metadata (hls=true)`);
} else {
  bad(`prepare wrong: ${JSON.stringify(prep)}`);
}

// native state events must drive the store (the seek bar reads store.current)
await page.evaluate(() => window.__firePlayerState({ state: "playing", position: 42, duration: 213 }));
await page.waitForTimeout(600);
const pos = await page.evaluate(() => {
  const el = document.querySelector("[data-testid='seek-current'], .yt-seek-current");
  return el ? el.textContent : null;
});
const bar = await page.evaluate(() => {
  // the store is the source of truth — read it through the app's exposed window state if present
  return null;
});
void pos; void bar;
// The store's current value is best observed via the time label the player renders
const timeText = await page.locator("[data-testid='time-display']").first().textContent().catch(() => null);
if (timeText && timeText.includes("0:42")) {
  ok(`native position reached the player UI through the store (${timeText.trim()})`);
} else {
  bad(`native position not visible in the time display (got: ${timeText})`);
}

// engine control routing: the forward-10 center button must seek NATIVELY
await page.evaluate(() => { window.__playerLog.seeks = []; });
await page.locator("[aria-label='Forward 10 seconds']").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(500);
const log2 = await page.evaluate(() => window.__playerLog);
if (log2.seeks.length > 0) {
  ok(`engine transport routed to the native player (seekTo ${log2.seeks[log2.seeks.length - 1]}s)`);
} else {
  bad("transport controls never reached the native player");
}

// teardown: the surface is persistent (background play is the point), so the
// observable release is the engine SWAP when a different video loads.
await page.evaluate(() => { window.__playerLog.releases = 0; window.__playerLog.prepares = []; });
await page.goto(`${BASE}/?v=othervid01`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const log3 = await page.evaluate(() => window.__playerLog);
if (log3.releases > 0 && log3.prepares.length > 0) {
  ok("loading another video releases the old engine and prepares the new one");
} else {
  bad(`engine swap wrong (releases=${log3.releases}, prepares=${log3.prepares.length})`);
}

console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
await browser.close();
if (FAIL > 0) process.exit(1);
