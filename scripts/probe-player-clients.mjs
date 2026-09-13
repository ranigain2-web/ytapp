// Probe: which InnerTube player clients survive the bot-check (LOGIN_REQUIRED)
// from this (datacenter) IP? Validates the multi-client chain fix.
//   1. ANDROID_VR                 — current app client (known gated on DC IPs)
//   2. TVHTML5_SIMPLY_EMBEDDED_PLAYER + visitorData + thirdParty.embedUrl
//   3. TVHTML5 (plain smart-TV)   + visitorData
//   4. IOS                        — control
// Also checks CORS (access-control-allow-origin) on returned stream URLs,
// because hls.js / <video> must fetch them cross-origin in the WebView.

const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const IOS_KEY = "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc";
const HOST = "https://www.youtube.com";

const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };
const VR_CTX = { client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US" } };
const tvEmbedCtx = (vd) => ({ client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US", ...(vd ? { visitorData: vd } : {}) }, thirdParty: { embedUrl: "https://www.youtube.com/" } });
const tvCtx = (vd) => ({ client: { clientName: "TVHTML5", clientVersion: "7.20250312.16.00", hl: "en", gl: "US", ...(vd ? { visitorData: vd } : {}) } });
const IOS_CTX = { client: { clientName: "IOS", clientVersion: "19.29.1", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "17.5.1.21F90", hl: "en", gl: "US" } };

async function post(ep, body, key) {
  const res = await fetch(`${HOST}/youtubei/v1/${ep}?key=${key}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function corsCheck(url) {
  try {
    const res = await fetch(url, { headers: { Origin: "https://example.org" }, redirect: "follow" });
    return { ok: res.ok, status: res.status, acao: res.headers.get("access-control-allow-origin") || "(none)" };
  } catch (e) {
    return { ok: false, status: 0, acao: String(e).slice(0, 60) };
  }
}

function summarizePlayer(json) {
  const ps = json.playabilityStatus || {};
  const sd = json.streamingData || {};
  const fmts = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
  const withUrl = fmts.filter((f) => f.url);
  return {
    playability: ps.status,
    reason: (ps.reason || "").slice(0, 80),
    playableInEmbed: ps.playableInEmbed,
    hls: !!sd.hlsManifestUrl,
    formats: fmts.length,
    formatsWithUrl: withUrl.length,
    sampleHls: sd.hlsManifestUrl ? sd.hlsManifestUrl.slice(0, 70) + "…" : null,
  };
}

const VIDEOS = [
  ["dQw4w9WgXcQ", "Rick Astley (embeddable)"],
  ["aqz-KE-bpKQ", "Big Buck Bunny 60fps (CC)"],
];

for (const [vid, label] of VIDEOS) {
  console.log(`\n=================== ${vid} — ${label} ===================`);

  // visitorData from next() — same thing the app does for metadata
  const nxt = await post("next", { context: WEB_CTX, videoId: vid }, WEB_KEY);
  const vd = nxt.json?.responseContext?.visitorData;
  console.log(`next(): HTTP ${nxt.status}, visitorData: ${vd ? vd.slice(0, 26) + "…" : "MISSING"}`);

  const clients = [
    ["ANDROID_VR", VR_CTX, ANDROID_KEY],
    ["TV_SIMPLY_EMBEDDED(+vd)", tvEmbedCtx(vd), WEB_KEY],
    ["TV_SIMPLY_EMBEDDED(novd)", tvEmbedCtx(null), WEB_KEY],
    ["TVHTML5(+vd)", tvCtx(vd), WEB_KEY],
    ["IOS", IOS_CTX, IOS_KEY],
  ];

  for (const [name, ctx, key] of clients) {
    const r = await post("player", { context: ctx, videoId: vid, contentCheckOk: true, racyCheckOk: true }, key);
    const s = summarizePlayer(r.json || {});
    console.log(
      `  ${name.padEnd(26)} HTTP ${r.status}  playability=${String(s.playability).padEnd(15)} hls=${s.hls ? "Y" : "n"} urls=${s.formatsWithUrl}/${s.formats}${s.reason ? "  reason: " + s.reason : ""}`
    );
    // for the first successful non-VR client, check stream CORS
    if (s.playability === "OK" && name.startsWith("TV_SIMPLY_EMBEDDED(+vd)")) {
      if (s.hls) {
        const c = await corsCheck(r.json.streamingData.hlsManifestUrl);
        console.log(`      ↳ HLS manifest CORS: HTTP ${c.status} ACAO=${c.acao}`);
      }
      const prog = (r.json.streamingData.formats || []).find((f) => f.url && /mp4/.test(f.mimeType || ""));
      if (prog) {
        const c = await corsCheck(prog.url);
        console.log(`      ↳ progressive ${prog.itag} CORS: HTTP ${c.status} ACAO=${c.acao}`);
      }
    }
  }
}
console.log("\nDONE");
