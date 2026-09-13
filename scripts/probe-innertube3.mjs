// Probe 3: fix trending (client variants), channel videos tab (params),
// next secondaryResults structure, modern tv_embedded, ANDROID player w/ headers,
// and the full comments continuation flow.

const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";

async function call(endpoint, body, opts = {}) {
  const host = opts.host || "www.youtube.com";
  const key = opts.key || WEB_KEY;
  const url = `https://${host}/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`;
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const out = {};

// 1. Trending variants
const variants = [
  { name: "mweb", ctx: { client: { clientName: "MWEB", clientVersion: "2.20240726.01.00", hl: "en", gl: "US" } }, key: WEB_KEY },
  { name: "tvhtml5", ctx: { client: { clientName: "TVHTML5", clientVersion: "7.20240703.00.00", hl: "en", gl: "US" } }, key: WEB_KEY },
  { name: "android_headers", ctx: { client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" } }, key: ANDROID_KEY, headers: { "X-YouTube-Client-Name": "3", "X-YouTube-Client-Version": "19.09.37", "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip" } },
  { name: "web_apis_host", ctx: { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } }, key: WEB_KEY, host: "youtubei.googleapis.com" },
];
for (const v of variants) {
  const r = await call("browse", { context: v.ctx, browseId: "FEtrending" }, { key: v.key, headers: v.headers, host: v.host });
  const s = JSON.stringify(r.json || {});
  out[`trending_${v.name}`] = {
    status: r.status,
    vids: (s.match(/"videoRenderer"|"gridVideoRenderer"|"richItemRenderer"/g) || []).length,
    err: r.status !== 200 ? r.text.slice(0, 120) : undefined,
  };
}

// 2. Channel videos tab with params (well-known base64: videos tab, sorted recent)
const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };
{
  const r = await call("browse", { context: WEB_CTX, browseId: "UCX6OQ3DkcsbYNE6H8uQQuVA", params: "EgZ2aWRlb3PyBgQKAjoA" });
  const s = JSON.stringify(r.json || {});
  out.channelVideosTab = {
    status: r.status,
    richItems: (s.match(/"richItemRenderer"/g) || []).length,
    gridVideos: (s.match(/"gridVideoRenderer"/g) || []).length,
    cont: s.includes("continuationCommand"),
  };
}

// 3. next: secondaryResults structure
{
  const r = await call("next", { context: WEB_CTX, videoId: "jNQXAC9IVRw" });
  const j = r.json || {};
  const tc = j.contents?.twoColumnWatchNextResults;
  const sec = tc?.secondaryResults?.secondaryResults?.results;
  const types = Array.isArray(sec) ? [...new Set(sec.map(x => Object.keys(x)[0]))] : null;
  // also check results.contents for comments continuation
  const results = tc?.results?.results?.contents;
  const sections = Array.isArray(results) ? results.map(x => {
    const k = Object.keys(x)[0];
    return k + (x[k]?.itemSectionRenderer?.sectionIdentifier ? `:${x[k].itemSectionRenderer.sectionIdentifier}` : "");
  }) : null;
  out.nextStructure = { status: r.status, secondaryTypes: types, contentSections: sections };
}

// 4. tv_embedded modern version
{
  const r = await call("player", {
    context: { client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "7.20240703.00.00", hl: "en", gl: "US" }, thirdParty: { embedUrl: "https://www.youtube.com" } },
    videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true,
  }, { headers: { "X-YouTube-Client-Name": "85", "X-YouTube-Client-Version": "7.20240703.00.00" } });
  const j = r.json || {};
  out.tvEmbedModern = {
    status: r.status, playability: j.playabilityStatus?.status, reason: j.playabilityStatus?.reason?.slice(0, 80),
    hls: !!j.streamingData?.hlsManifestUrl, formats: (j.streamingData?.formats || []).length, adaptive: (j.streamingData?.adaptiveFormats || []).length,
  };
}

// 5. ANDROID player with full headers
{
  const r = await call("player", {
    context: { client: { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30, osName: "Android", osVersion: "11", hl: "en", gl: "US" } },
    videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true,
  }, { key: ANDROID_KEY, headers: { "X-YouTube-Client-Name": "3", "X-YouTube-Client-Version": "19.09.37", "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip", Origin: "https://www.youtube.com" } });
  const j = r.json || {};
  const f = (j.streamingData?.formats || [])[0] || {};
  out.androidPlayerFixed = {
    status: r.status, playability: j.playabilityStatus?.status,
    hls: !!j.streamingData?.hlsManifestUrl, formats: (j.streamingData?.formats || []).length,
    firstUrl: !!f.url, firstSig: !!f.signatureCipher,
  };
}

// 6. Comments flow: next -> find comment continuation token -> next w/ token
{
  const r = await call("next", { context: WEB_CTX, videoId: "jNQXAC9IVRw" });
  const s = JSON.stringify(r.json || {});
  // comment continuation tokens appear in itemSectionRenderer with sectionIdentifier comment-item-section
  const j = r.json || {};
  const contents = j.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
  let commentToken = null;
  for (const c of contents) {
    const isr = c.itemSectionRenderer;
    if (isr && (isr.sectionIdentifier === "comment-item-section" || JSON.stringify(isr).includes("commentCount"))) {
      const conts = JSON.stringify(isr).match(/"token":"([^"]{80,})"/);
      if (conts) commentToken = conts[1];
    }
  }
  out.commentsTokenFound = !!commentToken;
  if (commentToken) {
    const r2 = await call("next", { context: WEB_CTX, continuation: commentToken });
    const s2 = JSON.stringify(r2.json || {});
    out.commentsPage = {
      status: r2.status,
      threads: (s2.match(/"commentThreadRenderer"/g) || []).length,
      entities: (s2.match(/"commentEntityPayload"/g) || []).length,
      moreCont: s2.includes("continuationCommand"),
    };
  }
}

// 7. Search with WEB client — check filters for live-only (for Live chip) and sort
{
  const r = await call("search", { context: WEB_CTX, query: "news", params: "EgJAAQ%3D%3D" });
  out.searchLiveFilter = { status: r.status };
}

// 8. WEB search CORS re-check (browser fetch viability)
{
  const r = await fetch("https://www.youtube.com/youtubei/v1/search?key=" + WEB_KEY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.example.com" },
    body: JSON.stringify({ context: WEB_CTX, query: "test" }),
  });
  out.searchCors = { status: r.status, acao: r.headers.get("access-control-allow-origin") };
}

console.log(JSON.stringify(out, null, 2));
