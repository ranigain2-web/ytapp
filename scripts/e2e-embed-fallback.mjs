// e2e-embed-fallback.mjs — Phase 0 (S-04): the embed-fallback journey against
// a MOCKED gated API (deterministic — no live YouTube, works on any IP).
//
// Scenario A — gated-but-embeddable video (?v=gatedtest01):
//   honest "ads may appear" notice, YouTube iframe mounted, metadata rendered,
//   and the one-shot fresh=1 rescue retry must have fired (v2.1.0 behavior).
// Scenario B — hard-blocked video (?v=blockedtest):
//   embed_fallback + playability_reason + embed_blocked → OUR clean
//   "Video unavailable" state with a "Watch on YouTube" hatch, NO iframe.
//
// Run: bash scripts/with-server.sh 'node scripts/e2e-embed-fallback.mjs'

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE || "http://127.0.0.1:3999";
let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };

const gatedVideo = (id, extra = {}) => ({
  id, ok: false, embed_fallback: true,
  extracted_by: "", audio_only: false, extract_ms: 5,
  title: "Gated Test Video", channel: "Test Channel", channel_id: "",
  views: "1M", duration: 60, published: "today", description: "",
  formats: [], hls: null, captions: [], storyboard: null, related: [], chapters: [],
  ...extra,
});

const browser = await chromium.launch();
const page = await browser.newPage();

// Force server data mode: the app resolves its source once at boot; a set
// apiBase short-circuits the standalone/community probes.
await page.addInitScript(() => {
  window.localStorage.setItem("yt_api_base", window.location.origin);
});

const calls = { plain: 0, fresh: 0 };
await page.route("**/api/video/**", (route) => {
  const url = route.request().url();
  if (url.includes("/comments")) {
    return route.fulfill({ json: { comments: [], count: 0, continuation: null } });
  }
  const id = (url.match(/video\/([\w-]+)/) || [])[1] || "gatedtest01";
  if (url.includes("fresh=1")) calls.fresh++; else calls.plain++;
  if (id === "blockedtest") {
    return route.fulfill({ json: gatedVideo("blockedtest", {
      title: "Blocked Test Video",
      playability_reason: "This video is unavailable in your country",
      embed_blocked: true,
    }) });
  }
  return route.fulfill({ json: gatedVideo(id) });
});
await page.route("**/api/health*", (route) => route.fulfill({ json: { ok: true, po_token: true, uptime: 1 } }));
await page.route("**/api/home**", (route) => route.fulfill({ json: { category: "all", source: "search", results: [] } }));
await page.route("**/api/sponsorblock/**", (route) => route.fulfill({ json: { segments: [] } }));

console.log("== Scenario A: gated-but-embeddable video ==");
await page.goto(`${BASE}/?v=gatedtest01`, { waitUntil: "domcontentloaded" });

const iframe = page.locator("iframe[src*='youtube-nocookie.com/embed/gatedtest01']");
try {
  await iframe.waitFor({ state: "visible", timeout: 15_000 });
  ok("YouTube embed iframe mounted");
} catch {
  bad("YouTube embed iframe never appeared");
}

if (await page.getByText("ads may appear", { exact: false }).first().isVisible().catch(() => false)) {
  ok("honest 'ads may appear' notice shown");
} else {
  bad("honest notice missing");
}

if (await page.getByText("Gated Test Video", { exact: false }).first().isVisible().catch(() => false)) {
  ok("video metadata still rendered (title)");
} else {
  bad("video metadata missing");
}

await page.waitForTimeout(1200); // let the one-shot rescue retry fire
if (calls.fresh >= 1) {
  ok(`one-shot fresh=1 rescue retry fired (plain=${calls.plain}, fresh=${calls.fresh})`);
} else {
  bad(`no fresh=1 rescue retry (plain=${calls.plain}, fresh=${calls.fresh})`);
}

console.log("== Scenario B: hard-blocked video ==");
await page.goto(`${BASE}/?v=blockedtest`, { waitUntil: "domcontentloaded" });

try {
  await page.locator("[data-testid='blocked-video']").waitFor({ state: "visible", timeout: 15_000 });
  ok("clean 'Video unavailable' state (no embed)");
} catch {
  bad("blocked state never appeared");
}

if ((await page.locator("iframe[src*='blockedtest']").count()) === 0) {
  ok("no iframe mounted for the hard-blocked video");
} else {
  bad("iframe mounted for the hard-blocked video");
}

if (await page.getByText("Watch on YouTube", { exact: false }).first().isVisible().catch(() => false)) {
  ok("'Watch on YouTube' escape hatch offered");
} else {
  bad("escape hatch missing");
}

console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
await browser.close();
if (FAIL > 0) process.exit(1);
