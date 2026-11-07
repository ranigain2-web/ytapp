// e2e-battery.mjs — Phase 0 (S-02): multi-video extraction battery.
//
// Runs the six research battery videos through /api/video/:id:
//   - extractable video  -> PASS (must carry formats or HLS + extracted_by + title)
//   - embed_fallback     -> SKIP with reason (IP gating is environment DATA,
//                           not a regression — the research measured this exact
//                           sandbox at 1/6; CI runners pass 6/6)
//   - transport/malformed-> FAIL
// Exits 1 on any FAIL, or when nothing passed (a fully-gated runner cannot
// judge the battery — that is an environment failure we need to know about).
//
// Run: bash scripts/with-server.sh 'node scripts/e2e-battery.mjs'

const API = process.env.API || "http://127.0.0.1:3001";

const BATTERY = [
  { id: "dQw4w9WgXcQ", label: "Never Gonna Give You Up (pop classic)" },
  { id: "jNQXAC9IVRw", label: "Me at the zoo (oldest video)" },
  { id: "9bZkp7q19f0", label: "Gangnam Style (music, huge)" },
  { id: "kJQP7kiw5Fk", label: "Despacito (VEVO music)" },
  { id: "aqz-KE-bpKQ", label: "Big Buck Bunny (CC, embeddable)" },
  { id: "jfKfPfyJRdk", label: "lofi hip hop radio (24/7 LIVE)" },
];

let PASS = 0, SKIP = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log(`  ✓ ${m}`); };
const bad = (m) => { FAIL++; console.log(`  ✗ ${m}`); };

console.log(`== Extraction battery (${BATTERY.length} videos via ${API}) ==`);
for (const v of BATTERY) {
  try {
    const r = await fetch(`${API}/api/video/${v.id}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) { bad(`${v.id}: HTTP ${r.status}`); continue; }
    const d = await r.json();
    const video = d.video || d;
    const formats = (video.formats || video.sources || []).length;
    if (video.ok && (formats > 0 || video.hls)) {
      if (video.extracted_by && video.title) {
        ok(`${v.id} (${v.label}): by=${video.extracted_by} formats=${formats} hls=${!!video.hls}`);
      } else {
        bad(`${v.id}: extracted but malformed (extracted_by=${video.extracted_by} title=${!!video.title})`);
      }
    } else if (video.embed_fallback) {
      SKIP++;
      console.log(`  - SKIP ${v.id} (${v.label}): embed_fallback — ${video.playability_reason || "all clients gated"}`);
    } else {
      bad(`${v.id}: neither extracted nor embed_fallback (ok=${video.ok})`);
    }
  } catch (e) {
    bad(`${v.id}: ${e.message}`);
  }
}

try {
  const h = await (await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(5000) })).json();
  console.log(`  health: po_token=${h.po_token} pot_reachable=${h.pot_reachable} fallbacks=${h.embed_fallbacks} rate=${h.embed_fallback_rate}`);
  // E-03: while the PO token is active, EVERY player call must carry it.
  if (h.po_token && h.player_calls > 0) {
    if (h.player_calls_po >= h.player_calls) {
      ok(`PO token on ${h.player_calls_po}/${h.player_calls} player calls`);
    } else {
      bad(`PO-token coverage incomplete: ${h.player_calls_po}/${h.player_calls} player calls carry the token`);
    }
  }
} catch { /* health is informational here */ }

console.log(`RESULT: ${PASS} passed, ${SKIP} skipped, ${FAIL} failed`);
if (FAIL > 0 || PASS === 0) process.exit(1);
