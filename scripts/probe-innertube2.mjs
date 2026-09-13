// Probe 2: debug the failures — trending 403, ANDROID player 400, TV embed ERROR,
// channel renderer names, next related renderer names, ANDROID browse/search.

const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";

async function call(endpoint, body, opts = {}) {
  const key = opts.key || WEB_KEY;
  const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`;
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 300) };
}

const out = {};

// A. Trending 403 — check error body; try ANDROID client; try WEB with Origin+ referer
const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };
const ANDROID_CTX = {
  client: {
    clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30,
    osName: "Android", osVersion: "11", hl: "en", gl: "US",
  },
};
out.trendingWebBody = await call("browse", { context: WEB_CTX, browseId: "FEtrending" }).then(r => ({ status: r.status, body: r.text.slice(0, 200) }));
out.trendingAndroid = await call("browse", { context: ANDROID_CTX, browseId: "FEtrending" }, { key: ANDROID_KEY }).then(r => {
  const s = JSON.stringify(r.json || {});
  return { status: r.status, vids: (s.match(/"videoRenderer"/g) || []).length, body: r.text.slice(0, 150) };
});

// B. ANDROID player 400 — error body, and try iOS client too
out.androidPlayerBody = await call("player", { context: ANDROID_CTX, videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true }, { key: ANDROID_KEY }).then(r => ({ status: r.status, body: r.text.slice(0, 300) }));

// iOS client
const IOS_CTX = { client: { clientName: "IOS", clientVersion: "19.09.3", deviceModel: "iPhone14,3", hl: "en", gl: "US" } };
out.iosPlayer = await call("player", { context: IOS_CTX, videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true }, { key: WEB_KEY }).then(r => {
  const j = r.json || {};
  return { status: r.status, body: r.text.slice(0, 200), playability: j.playabilityStatus?.status, hls: !!j.streamingData?.hlsManifestUrl, formats: (j.streamingData?.formats || []).length };
});

// C. TV embed ERROR — try with X-Youtube-Client headers (name=85)
out.tvEmbedHeaders = await call("player", {
  context: { client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" }, thirdParty: { embedUrl: "https://www.youtube.com" } },
  videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true,
}, { headers: { "X-Youtube-Client-Name": "85", "X-Youtube-Client-Version": "2.0", Origin: "https://www.youtube.com" } }).then(r => {
  const j = r.json || {};
  return { status: r.status, playability: j.playabilityStatus?.status, reason: j.playabilityStatus?.reason?.slice(0, 100), hls: !!j.streamingData?.hlsManifestUrl, formats: (j.streamingData?.formats || []).length };
});

// D. WEB player plain (what a no-login web page gets)
out.webPlayer = await call("player", { context: WEB_CTX, videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true }).then(r => {
  const j = r.json || {};
  const f = (j.streamingData?.formats || [])[0] || {};
  return {
    status: r.status, playability: j.playabilityStatus?.status,
    formats: (j.streamingData?.formats || []).length, adaptive: (j.streamingData?.adaptiveFormats || []).length,
    firstFmtUrl: !!f.url, firstFmtSig: !!f.signatureCipher, firstFmtMime: f.mimeType?.slice(0, 30),
  };
});

// E. next renderer names — dump distinct *Renderer names
out.nextRenderers = await call("next", { context: WEB_CTX, videoId: "jNQXAC9IVRw" }).then(r => {
  const names = [...new Set((JSON.stringify(r.json).match(/"\w+Renderer"/g) || []))];
  return { status: r.status, renderers: names.slice(0, 25) };
});

// F. channel renderer names
out.channelRenderers = await call("browse", { context: WEB_CTX, browseId: "UCX6OQ3DkcsbYNE6H8uQQuVA" }).then(r => {
  const names = [...new Set((JSON.stringify(r.json).match(/"\w+Renderer"/g) || []))];
  const s = JSON.stringify(r.json);
  return { status: r.status, renderers: names.slice(0, 25), tabs: (s.match(/"tabRenderer"/g) || []).length };
});

// G. ANDROID search (for search on device)
out.androidSearch = await call("search", { context: ANDROID_CTX, query: "lofi" }, { key: ANDROID_KEY }).then(r => {
  const s = JSON.stringify(r.json || {});
  return { status: r.status, vids: (s.match(/"videoRenderer"/g) || []).length };
});

// H. legacy suggestions — verify format parses; try without Origin (CORS check for CapacitorHttp is moot, but check plain fetch)
try {
  const res = await fetch("https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=techno+gam");
  const text = await res.text();
  out.suggestNoOrigin = { status: res.status, acao: res.headers.get("access-control-allow-origin"), sample: text.slice(0, 150) };
} catch (e) { out.suggestNoOrigin = { error: String(e).slice(0, 100) }; }

// I. ANDROID comments via next + engagement panel
out.androidNext = await call("next", { context: ANDROID_CTX, videoId: "jNQXAC9IVRw" }, { key: ANDROID_KEY }).then(r => {
  const s = JSON.stringify(r.json || {});
  return { status: r.status, len: s.length, hasComments: s.includes("commentCount") || s.includes("engagement-panel-comments-section") };
});

console.log(JSON.stringify(out, null, 2));
