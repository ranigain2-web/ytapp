// Probe 3: verify ANDROID_VR stream URLs are actually playable cross-origin
// (the direct-stream path in the app relies on this) + check itag inventory.

const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const VR_CTX = { client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US" } };

async function post(ep, body, key) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${ep}?key=${key}&prettyPrint=false`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.json();
}

const j = await post("player", { context: VR_CTX, videoId: "dQw4w9WgXcQ", contentCheckOk: true, racyCheckOk: true }, ANDROID_KEY);
const sd = j.streamingData || {};
const fmts = [...(sd.formats || []), ...(sd.adaptiveFormats || [])].filter((f) => f.url);
console.log(`playability=${j.playabilityStatus?.status} formats=${fmts.length} hls=${!!sd.hlsManifestUrl}`);
const combined = fmts.filter((f) => /video/.test(f.mimeType || "") && /audio/.test(f.mimeType || ""));
console.log(`combined (A+V): ${combined.map((f) => `itag${f.itag}/${f.qualityLabel || f.mimeType.split(";")[0]}`).join(", ")}`);

for (const f of [...combined.slice(0, 2), fmts[0], fmts[fmts.length - 1]]) {
  try {
    const res = await fetch(f.url, { headers: { Origin: "https://example.org", Range: "bytes=0-1023" } });
    const acao = res.headers.get("access-control-allow-origin");
    console.log(`  itag ${String(f.itag).padEnd(3)} ${String(f.qualityLabel || "").padEnd(5)} HTTP ${res.status} type=${res.headers.get("content-type") || "?"} ACAO=${acao || "(none)"} len=${res.headers.get("content-range") || "?"}`);
  } catch (e) { console.log(`  itag ${f.itag} FAIL ${String(e).slice(0, 60)}`); }
}
console.log("DONE");
