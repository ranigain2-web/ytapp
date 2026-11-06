// probe-testset.mjs — classify candidate videos through the REAL standalone
// pipeline (itVideo) and measure the embed-fallback baseline for phase 5.
// Run: bun scripts/probe-testset.mjs
import { itVideo } from "../src/lib/innertube.ts";
import fs from "node:fs";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const CANDIDATES = [
  // classics (combined-codec era)
  "dQw4w9WgXcQ", "9bZkp7q19f0", "kJQP7kiw5Fk", "JGwWNGJdvx8", "OPf0YbXqDm0", "fJ9rUzIMcZQ",
  "RgKAFK5djSk", "CevxZvSJLk8", "YQHsXMglC9A", "lp-EO5I60KA",
  // higher-res / adaptive-era music + popular
  "3JZ_D3ELwOQ", "60ItHLz5WEA", "hT_nvWreIhg", "2Vv-BfVoq4g", "e-ORhEE9VVg",
  // 4K-class (verify heights at runtime)
  "LXb3EKWsInQ", "1La4QzGeaaQ", "_aM_nrijYCU",
  // live 24/7 streams (long-lived)
  "jfKfPfyJRdk", "4xDzrJKXOOY", "S_MOd40zlYU", "5qap5aO4i9A",
  // shorts-era / recent uploads
  "ZbZSe6N_BXs", "FLG2TxJMjOo", "BxuY9mMFN5k", "3AtDnEC4zak",
  // older archival (potential combined + gating mix)
  "M7lc1UVf-VE", "aqz-KE-bpKQ", "jNQXAC9IVRw",
];

const results = [];
for (const id of CANDIDATES) {
  await sleep(4000); // pacing: real users don't fire 30 player calls back-to-back; gating kicks in otherwise and the baseline lies
  try {
    const v = await itVideo(id);
    const r = {
      id,
      title: (v.title || "").slice(0, 48),
      embed_fallback: !!v.embed_fallback,
      formats: (v.formats || []).length,
      combined: (v.formats || []).filter(f => f.has_video && f.has_audio).length,
      maxHeight: Math.max(0, ...(v.formats || []).map(f => f.height || 0)),
      hls: !!v.hls,
      is_live: !!v.is_live,
      is_premiere: !!v.is_premiere,
      unavailable: !!v.unavailable,
      reason: v.playability_reason ? String(v.playability_reason).slice(0, 60) : null,
    };
    results.push(r);
    console.log(`${id} | fb=${r.embed_fallback ? 1 : 0} fmt=${r.formats} comb=${r.combined} h=${r.maxHeight} hls=${r.hls ? 1 : 0} live=${r.is_live ? 1 : 0} prem=${r.is_premiere ? 1 : 0} unav=${r.unavailable ? 1 : 0} | ${r.title}`);
  } catch (e) {
    results.push({ id, error: String(e).slice(0, 80) });
    console.log(`${id} | ERROR ${String(e).slice(0, 60)}`);
  }
}
fs.writeFileSync("/tmp/testset-probe.json", JSON.stringify(results, null, 1));
const fb = results.filter(r => r.embed_fallback).length;
console.log(`\nTOTAL: ${results.length} | embed_fallback: ${fb} (${(100 * fb / results.length).toFixed(0)}%)`);
