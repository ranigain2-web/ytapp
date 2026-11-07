// test-guard-core.ts — Phase 2 (C-02/C-03/C-07) unit lock.
// Runs the pure guard logic AND proves the composed injection bundle is
// syntactically valid JS with the logic embedded.
// Run: bun scripts/test-guard-core.ts

import { shouldAutoResume, isContinueWatchingDialog, stripAdPayload, toNetscapeCookieFile } from "../src/lib/compat/guard-core";
import { buildCompatInjection } from "../src/lib/compat/compat-injection";

let PASS = 0, FAIL = 0;
const check = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); }
};

// ---- shouldAutoResume (attribution) ----
check("auto-resumes a background pause", shouldAutoResume({ isUserPause: false, attempts: 0, ended: false, adPlaying: false }), true);
check("never fights a user pause", shouldAutoResume({ isUserPause: true, attempts: 0, ended: false, adPlaying: false }), false);
check("never fights an ad", shouldAutoResume({ isUserPause: false, attempts: 0, ended: false, adPlaying: true }), false);
check("gives up after 3 attempts", shouldAutoResume({ isUserPause: false, attempts: 3, ended: false, adPlaying: false }), false);
check("never resumes an ended video", shouldAutoResume({ isUserPause: false, attempts: 0, ended: true, adPlaying: false }), false);

// ---- isContinueWatchingDialog ----
check("recognizes the 1-button dialog", isContinueWatchingDialog({ text: "Video paused. Continue watching?", buttonCount: 1 }), true);
check("2-button dialog is a different question", isContinueWatchingDialog({ text: "Video paused. Continue watching? Cancel", buttonCount: 2 }), false);
check("unrelated dialog", isContinueWatchingDialog({ text: "Are you sure?", buttonCount: 1 }), false);

// ---- stripAdPayload ----
const stats = { stripped: 0 };
const cleaned = stripAdPayload({
  videoDetails: { title: "kept" },
  playerAds: [{ x: 1 }],
  adPlacements: [{}, {}],
  streamingData: { formats: [{ itag: 18, url: "u" }] },
}, stats) as Record<string, unknown>;
check("ad keys removed", Object.keys(cleaned).sort(), ["streamingData", "videoDetails"]);
check("clean subtrees survive", (cleaned.streamingData as Record<string, unknown[]>).formats.length, 1);
check("strip count", stats.stripped, 2);
const nested = stripAdPayload({ a: { b: { adSlots: [1], c: "keep" } } }) as { a: { b: Record<string, unknown> } };
check("nested ad keys removed", Object.keys(nested.a.b), ["c"]);
const cyclic: Record<string, unknown> = { t: "x" };
cyclic.self = cyclic;
check("cycles cut, not crashed", (stripAdPayload(cyclic) as Record<string, unknown>).t, "x");
check("non-objects pass through", stripAdPayload("raw"), "raw");

// ---- toNetscapeCookieFile (C-07) ----
const netscape = toNetscapeCookieFile("VISITOR_INFO1_LIVE=abc; SID=def; broken", "https://m.youtube.com/watch?v=x");
const lines = netscape.trim().split("\n");
check("header present", lines[0], "# Netscape HTTP Cookie File");
check("broken pair dropped, 2 cookies", lines.length, 4);
check("cookie line shape", lines[2].split("\t").length, 7);
check("domain format", lines[2].split("\t")[0], ".youtube.com");
check("SID value kept", lines[3].endsWith("\tSID\tdef"), true);

// ---- the composed injection is valid JS and embeds the logic ----
const injection = buildCompatInjection();
let syntacticError: string | null = null;
try {
  // Parse WITHOUT executing: a syntax error throws here.
  new Function(injection);
} catch (e) {
  syntacticError = String((e as Error).message);
}
check("injection parses as valid JS", syntacticError, null);
check("embeds shouldAutoResume", injection.includes("shouldAutoResume"), true);
check("embeds the visibility spoof", injection.includes("visibilitychange"), true);
check("embeds the ad strip", injection.includes("adPlacements"), true);
check("embeds the cookie share", injection.includes("type: 'cookies'"), true);
check("no template literals (mobile webview safety)", injection.includes("`"), false);

console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
if (FAIL > 0) process.exit(1);
