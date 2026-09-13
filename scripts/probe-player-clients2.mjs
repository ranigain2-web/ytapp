// Probe 2:
//  A) scrape live INNERTUBE_CONTEXT from youtube.com/tv and /embed pages
//     (gives CURRENT client versions + api keys YouTube itself ships)
//  B) ANDROID_VR with visitorData attached + retry pattern on a gated video
//  C) ANDROID production client with recent version
//  D) TVHTML5 with live version from the /tv scrape + visitorData

const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const HOST = "https://www.youtube.com";
const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };
const VR_CTX = { client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US" } };

const UA_TV = "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version";

async function post(ep, body, key, extraHeaders = {}) {
  const res = await fetch(`${HOST}/youtubei/v1/${ep}?key=${key}&prettyPrint=false`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function summarize(json) {
  const ps = json.playabilityStatus || {};
  const sd = json.streamingData || {};
  const fmts = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
  const withUrl = fmts.filter((f) => f.url);
  return `playability=${String(ps.status).padEnd(15)} hls=${sd.hlsManifestUrl ? "Y" : "n"} urls=${withUrl.length}/${fmts.length}${ps.reason ? "  reason: " + String(ps.reason).slice(0, 70) : ""}`;
}

// ---- A) scrape live contexts ----
function extractYtcfg(html) {
  // ytcfg.set({INNERTUBE_CONTEXT: {...}}) — grab a few fields of interest
  const out = {};
  const m = html.match(/"INNERTUBE_CONTEXT":\s*(\{.+?\})\s*,\s*"INNERTUBE_CONTEXT_CLIENT_NAME"/s);
  if (m) {
    try { out.context = JSON.parse(m[1].replace(/,(\s*[}\]])/g, "$1")); } catch { out.contextParseFail = true; }
  }
  const k = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/); if (k) out.key = k[1];
  const v = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/); if (v) out.version = v[1];
  const cn = html.match(/"INNERTUBE_CONTEXT_CLIENT_NAME":"?([^,"}]+)"?/); if (cn) out.clientName = cn[1];
  const vd = html.match(/"visitorData":"([^"]+)"/); if (vd) out.visitorData = vd[1];
  return out;
}

console.log("=== A) live page scrapes ===");
const pages = [
  ["tv", "https://www.youtube.com/tv", UA_TV],
  ["embed", `https://www.youtube.com/embed/aqz-KE-bpKQ`, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
  ["watch", `https://www.youtube.com/watch?v=aqz-KE-bpKQ`, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"],
];
const scraped = {};
for (const [name, url, ua] of pages) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "en-US,en;q=0.9" } });
    const html = await res.text();
    const cfg = extractYtcfg(html);
    scraped[name] = cfg;
    const c = cfg.context?.client || {};
    console.log(`  /${name}: HTTP ${res.status}  clientName=${cfg.clientName || c.clientName} version=${cfg.version || c.clientVersion} key=${cfg.key ? cfg.key.slice(0, 12) + "…" : "?"} visitor=${cfg.visitorData ? "Y" : "n"} thirdParty=${cfg.context?.thirdParty ? JSON.stringify(cfg.context.thirdParty).slice(0, 60) : "n"}`);
  } catch (e) {
    console.log(`  /${name}: FETCH FAIL ${String(e).slice(0, 80)}`);
  }
}

// ---- B) ANDROID_VR with visitorData + retries on the gated video ----
console.log("\n=== B) ANDROID_VR variants on gated video aqz-KE-bpKQ ===");
const nxt = await post("next", { context: WEB_CTX, videoId: "aqz-KE-bpKQ" }, "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8");
const vd = nxt.json?.responseContext?.visitorData;
console.log(`  visitorData from next: ${vd ? "Y" : "n"}`);

const vrWithVd = { client: { ...VR_CTX.client, ...(vd ? { visitorData: vd } : {}) } };
for (const [label, ctx] of [["VR plain (retry1)", VR_CTX], ["VR plain (retry2)", VR_CTX], ["VR +visitorData", vrWithVd]]) {
  const r = await post("player", { context: ctx, videoId: "aqz-KE-bpKQ", contentCheckOk: true, racyCheckOk: true }, ANDROID_KEY);
  console.log(`  ${label.padEnd(20)} HTTP ${r.status} ${summarize(r.json)}`);
}

// ---- C) ANDROID production ----
console.log("\n=== C) ANDROID production client ===");
const AND_PROD = { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 36, osName: "Android", osVersion: "16", hl: "en", gl: "US" } };
for (const ver of ["20.10.38", "19.44.38"]) {
  const r = await post("player", { context: { ...AND_PROD, client: { ...AND_PROD.client, clientVersion: ver } }, videoId: "aqz-KE-bpKQ", contentCheckOk: true, racyCheckOk: true }, ANDROID_KEY);
  console.log(`  ANDROID ${ver.padEnd(10)} HTTP ${r.status} ${summarize(r.json)}`);
}

// ---- D) TVHTML5 with live version from /tv scrape ----
console.log("\n=== D) live-context players ===");
if (scraped.tv?.context?.client) {
  const tvClient = scraped.tv.context.client;
  const key = scraped.tv.key || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const r1 = await post("player", { context: { client: tvClient }, videoId: "aqz-KE-bpKQ", contentCheckOk: true, racyCheckOk: true }, key, { "User-Agent": UA_TV });
  console.log(`  TV(live /tv ctx)         HTTP ${r1.status} ${summarize(r1.json)}`);
  const r1b = await post("player", { context: { client: { ...tvClient, visitorData: scraped.tv.visitorData } }, videoId: "aqz-KE-bpKQ", contentCheckOk: true, racyCheckOk: true }, key, { "User-Agent": UA_TV });
  console.log(`  TV(live ctx +page vd)    HTTP ${r1b.status} ${summarize(r1b.json)}`);
}
if (scraped.embed?.context?.client) {
  const embClient = scraped.embed.context.client;
  const key = scraped.embed.key || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const ctx = { client: embClient, ...(scraped.embed.context.thirdParty ? { thirdParty: scraped.embed.context.thirdParty } : { thirdParty: { embedUrl: "https://www.youtube.com/" } }) };
  const r2 = await post("player", { context: ctx, videoId: "aqz-KE-bpKQ", contentCheckOk: true, racyCheckOk: true }, key);
  console.log(`  EMBED(live /embed ctx)   HTTP ${r2.status} ${summarize(r2.json)}`);
  console.log(`    embed ctx: ${JSON.stringify(ctx).slice(0, 220)}`);
}
console.log("\nDONE");
