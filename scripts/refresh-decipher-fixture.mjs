// refresh-decipher-fixture.mjs — regenerate the checked-in decipher fixture.
// Run (bun, network needed): bun scripts/refresh-decipher-fixture.mjs
// Records: the CURRENT player's slice + a transform vector produced by the
// REAL player code. When YouTube rotates the player, test-decipher fails →
// run this to update. On-device, real ciphered vectors can be appended
// (see the note field).
import { buildSlice, evalSlice } from "../src/lib/yt-decipher.ts";
import fs from "node:fs";

const html = await (await fetch("https://www.youtube.com/", {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36" },
})).text();
const m = /jsUrl":"([^"]+base\.js)"/.exec(html) || /["']([^"']*\/s\/player\/[^"']*base\.js)["']/.exec(html);
if (!m) { console.error("no player jsUrl found"); process.exit(1); }
const url = m[1].startsWith("http") ? m[1] : `https://www.youtube.com${m[1]}`;
const version = /\/s\/player\/([\w.-]+)\//.exec(url)?.[1] || "unknown";
console.log("player:", version);

const js = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/131.0" } })).text();
console.log("base.js:", (js.length / 1024).toFixed(0), "KB");

const slice = buildSlice(js);
console.log("slice defs:", slice.defs.size, "| root:", slice.rootName);
const apply = evalSlice(slice);
console.log("slice evals + callable ✓");

// synthetic-but-real vector: the REAL transform on a fixed input (validates
// extraction + eval + determinism end-to-end; the s value is synthetic since
// real ciphered responses are only obtainable on residential networks)
const vectorUrl = "https://rr4---sn-fixture.googlevideo.com/videoplayback?clen=123&expire=9999999999&ei=FIXTURE&ip=1.2.3.4&id=o-FIXTURE&c=WEB&fexp=x";
const sIn = "FIXTURE-SIG-INPUT-0123456789abcdef";
const out = apply(vectorUrl, "sig", sIn);
let origUrl = null, params = null;
for (const v of Object.values(out)) {
  if (typeof v === "string" && /^https?:\/\//.test(v) && !origUrl) origUrl = v;
  if (v && typeof v === "object" && !Array.isArray(v) && !params) {
    const entries = Object.entries(v);
    if (entries.length && entries.every(([, x]) => typeof x === "string")) params = v;
  }
}
if (!origUrl || !params || !params.sig) { console.error("vector extraction failed:", { origUrl, params }); process.exit(1); }

const fixture = {
  player_version: version,
  basejs_url: url,
  root: slice.rootName,
  defs: [...slice.defs.entries()],
  vector: { url: vectorUrl, sp: "sig", s: sIn, expected_sig: params.sig, expected_alr: params.alr },
  generated_at: new Date().toISOString(),
  note: "Slice + vector produced by the REAL current player code. s is synthetic (real ciphered responses need a residential IP — append them from a device run). If test-decipher fails after a YouTube player rotation, re-run this script.",
};
fs.writeFileSync("scripts/fixtures/decipher-fixture.json", JSON.stringify(fixture, null, 1));
console.log("fixture written. transform sample:", sIn.slice(0, 12), "→", String(params.sig).slice(0, 24), "| alr:", params.alr);
