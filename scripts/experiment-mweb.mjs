// experiment-mweb.mjs — phase A2: verify the MWEB breakthrough.
// On this bot-gated datacenter IP, MWEB returned OK where IOS/ANDROID/WEB/
// TV/ANDROID_VR were LOGIN_REQUIRED. Now test: (a) does it hold WITH a PO
// token from bgutil, (b) across more videos, (c) are the stream URLs real
// (HTTP 200 on a ranged GET, not 403 shells), (d) do audio-only itags exist
// (audio-only rescue), (e) consistency across repeated calls.
import Innertube from "youtubei.js";

const VIDEOS = ["jNQXAC9IVRw", "aqz-KE-bpKQ", "9bZkp7q19f0", "dQw4w9WgXcQ", "2Vv-BfVoq4g", "kJQP7kiw5Fk"];

// POT provider may be down (earlier experiments killed it); try to use it,
// fall back to a token-less session so the test still runs.
let token = null, visitor = null;
try {
  const r = await fetch("http://127.0.0.1:4416/get_pot", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  const sd = await r.json();
  if (sd.poToken && sd.contentBinding) { token = sd.poToken; visitor = sd.contentBinding; }
} catch { /* token-less run */ }
console.log(`PO token: ${token ? "YES" : "no (token-less run)"}`);

const yt = await Innertube.create({
  retrieve_player: true, generate_session_locally: false,
  visitor_data: visitor || undefined, po_token: token || undefined,
});

async function probe(url) {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-1023" }, signal: AbortSignal.timeout(12000) });
    const len = r.headers.get("content-length") || r.headers.get("content-range") || "?";
    return `HTTP ${r.status} len=${len} ct=${(r.headers.get("content-type") || "?").slice(0, 24)}`;
  } catch (e) { return `probe-fail ${String(e.message).slice(0, 50)}`; }
}

for (const id of VIDEOS) {
  try {
    const info = await yt.getInfo(id, { client: "MWEB" });
    const status = info.playability_status?.status;
    const sd = info.streaming_data;
    const fmts = [...(sd?.formats || []), ...(sd?.adaptive_formats || [])];
    const audioOnly = fmts.filter(f => f.has_audio && !f.has_video);
    const videoOnly = fmts.filter(f => f.has_video && !f.has_audio);
    const combined = fmts.filter(f => f.has_video && f.has_audio);
    console.log(`${id}: status=${status} combined=${combined.length} videoOnly=${videoOnly.length} audioOnly=${audioOnly.length} hls=${!!sd?.hls_manifest_url}`);
    // probe one audio-only + one combined URL (decipher() is async in this version)
    const pick = audioOnly[0] || combined[0] || videoOnly[0];
    if (pick) {
      try {
        const url = await pick.decipher(yt.actions.session.player);
        console.log(`   ${pick.mime_type || pick.mime} → ${await probe(url)}`);
      } catch (e) { console.log(`   decipher fail: ${String(e.message).slice(0, 60)}`); }
    }
    if (sd?.hls_manifest_url) console.log(`   hls: ${await probe(sd.hls_manifest_url)}`);
  } catch (e) {
    console.log(`${id}: ERROR ${String(e.message).slice(0, 90)}`);
  }
}

// consistency: same video twice more
console.log("\n-- consistency (dQw4w9WgXcQ ×2 more) --");
for (let i = 0; i < 2; i++) {
  try {
    const info = await yt.getInfo("dQw4w9WgXcQ", { client: "MWEB" });
    const sd = info.streaming_data;
    console.log(`run${i + 1}: ${info.playability_status?.status} fmts=${(sd?.formats?.length || 0)}+${(sd?.adaptive_formats?.length || 0)}`);
  } catch (e) { console.log(`run${i + 1}: ERROR ${String(e.message).slice(0, 70)}`); }
}
process.exit(0);
