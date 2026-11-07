// test-native-url.mjs — Phase 4 (N-02): selectNativeUrl unit lock.
// Run: bun scripts/test-native-url.mjs
import { selectNativeUrl } from "../src/lib/yt-native-engine";

let PASS = 0, FAIL = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { PASS++; console.log(`  ✓ ${name}`); }
  else { FAIL++; console.log(`  ✗ ${name}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); }
};

const V = { hls: "/api/hls/x", formats: [] };
const F = { url: "/api/segment/prog" };
const A = { url: "/api/segment/audio" };

// NOTE: without an apiBase, absStream() resolves relative URLs through the
// sandbox gateway suffix (?XTransformPort=3001) — that is the real contract.
const GW = (u) => u + "?XTransformPort=3001";
check("hls chosen by default", selectNativeUrl(V, { fallbackFormat: F, audioFormat: A }), { url: GW("/api/hls/x"), hls: true, kind: "hls" });
check("audio-only pref wins", selectNativeUrl(V, { audioOnly: true, audioFormat: A, fallbackFormat: F }), { url: GW("/api/segment/audio"), hls: false, kind: "audio" });
check("audio rescue wins", selectNativeUrl(V, { audioRescue: true, audioFormat: A }), { url: GW("/api/segment/audio"), hls: false, kind: "audio" });
check("progressive when no hls", selectNativeUrl({ hls: null, formats: [] }, { fallbackFormat: F }), { url: GW("/api/segment/prog"), hls: false, kind: "progressive" });
check("none when empty", selectNativeUrl({ hls: null, formats: [] }, {}), { url: "", hls: false, kind: "none" });
check("audio pref without an audio format falls to hls", selectNativeUrl(V, { audioOnly: true }), { url: GW("/api/hls/x"), hls: true, kind: "hls" });

console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
if (FAIL) process.exit(1);
