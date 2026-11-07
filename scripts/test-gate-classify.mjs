// test-gate-classify.mjs — Phase 1 (E-04): classifyGate unit lock.
// The classifier turns the chain's playability map into an actionable
// failure class; the UI and diagnostics depend on the exact strings.
// Run: node scripts/test-gate-classify.mjs

import { classifyGate } from "../server/gate-classify.mjs";

const CASES = [
  { name: "bot gate (classic)", map: { IOS: "LOGIN_REQUIRED", ANDROID: "LOGIN_REQUIRED" }, reason: "Sign in to confirm you're not a bot", want: "bot_gate" },
  { name: "age gate", map: { WEB: "LOGIN_REQUIRED" }, reason: "Sorry, this content is age-restricted", want: "age_gate" },
  { name: "members only", map: { IOS: "MEMBERS_ONLY" }, reason: null, want: "members_only" },
  { name: "drm", map: { WEB: "UNPLAYABLE" }, reason: "This video requires DRM protection", want: "drm" },
  { name: "live ended", map: { IOS: "UNPLAYABLE" }, reason: "This live event has ended", want: "live_ended" },
  { name: "unavailable", map: { MWEB: "UNPLAYABLE" }, reason: "Video unavailable", want: "unavailable" },
  { name: "hollow chain errors", map: { IOS: "ERROR hollow extraction (probe HTTP 403)" }, reason: null, want: "bot_gate" },
  { name: "empty map", map: {}, reason: null, want: "unknown" },
];

let failed = 0;
for (const c of CASES) {
  const got = classifyGate(c.map, c.reason);
  if (got === c.want) {
    console.log(`  ✓ ${c.name} -> ${got}`);
  } else {
    failed++;
    console.log(`  ✗ ${c.name}: want ${c.want}, got ${got}`);
  }
}
console.log(`RESULT: ${CASES.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
