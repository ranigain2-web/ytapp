#!/usr/bin/env node
// ytapi-battery.mjs — real-extraction baseline through OUR yt-api server
// Runs the video battery through /api/video/:id and records per-video results.
const BASE = "http://127.0.0.1:3001";
const BATTERY = [
  { id: "dQw4w9WgXcQ", label: "Never Gonna Give You Up (pop classic)" },
  { id: "jNQXAC9IVRw", label: "Me at the zoo (oldest video)" },
  { id: "9bZkp7q19f0", label: "Gangnam Style (music, huge)" },
  { id: "kJQP7kiw5Fk", label: "Despacito (VEVO music)" },
  { id: "aqz-KE-bpKQ", label: "Big Buck Bunny (CC, embeddable)" },
  { id: "jfKfPfyJRdk", label: "lofi hip hop radio (24/7 LIVE)" },
];

const rows = [];
for (const v of BATTERY) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/video/${v.id}`);
    const d = await r.json();
    const video = d.video || d;
    rows.push({
      id: v.id, label: v.label,
      http: r.status,
      extracted_by: video.extracted_by || null,
      audio_only: !!video.audio_only,
      embed_fallback: video.embed_fallback === undefined ? (d.embed_fallback ?? null) : video.embed_fallback,
      formats: (video.sources || video.formats || []).length,
      hls: !!(video.hls || d.hls),
      duration: video.duration || null,
      live: video.live || video.isLive || null,
      title: (video.title || "").slice(0, 40),
      elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    rows.push({ id: v.id, label: v.label, error: String(e.message).slice(0, 80) });
  }
  process.stdout.write(".");
}
const health = await (await fetch(`${BASE}/api/health`)).json();
const out = { when: new Date().toISOString(), server_health: health, results: rows };
await import("node:fs").then(fs => fs.writeFileSync("research/results/ytapi-battery.json", JSON.stringify(out, null, 2)));
console.log("\n== OUR yt-api extraction battery (sandbox = worst-case datacenter IP) ==");
for (const r of rows) {
  console.log(`${r.id} | ${r.label.slice(0, 34).padEnd(34)} | ${r.error ? "ERR " + r.error : `by=${r.extracted_by || "none"} audio_only=${r.audio_only} embed=${r.embed_fallback} fmts=${r.formats} hls=${r.hls} ${r.elapsed_ms}ms`}`);
}
console.log("server extract_stats:", JSON.stringify(health.extract_stats), "po_token:", health.po_token);
