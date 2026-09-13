// Probe 4: trending matrix, ANDROID_VR player (no-PO-token client), comments
// token via recursive search, lockupViewModel sample dump.

const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };

async function call(endpoint, body, opts = {}) {
  const key = opts.key || WEB_KEY;
  const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`;
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const out = {};

// --- 1. Trending matrix ---
const tVariants = [
  { name: "plain", body: { context: WEB_CTX, browseId: "FEtrending" } },
  { name: "params_wgYFCg", body: { context: WEB_CTX, browseId: "FEtrending", params: "wgYFCg==" } },
  { name: "no_hl_gl", body: { context: { client: { clientName: "WEB", clientVersion: "2.20240726.00.00" } }, browseId: "FEtrending" } },
  { name: "no_key", body: { context: WEB_CTX, browseId: "FEtrending" }, opts: { key: "" } },
  { name: "explore", body: { context: WEB_CTX, browseId: "FEexplore" } },
  { name: "movietrailers", body: { context: WEB_CTX, browseId: "FEmovie_trailers" } },
];
for (const v of tVariants) {
  const url = `https://www.youtube.com/youtubei/v1/browse${v.opts?.key === "" ? "" : `?key=${WEB_KEY}&prettyPrint=false`}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.body) });
  const s = await res.text();
  const vids = (s.match(/"videoRenderer"|"gridVideoRenderer"|"richItemRenderer"/g) || []).length;
  out[`trend_${v.name}`] = { status: res.status, vids, err: res.status !== 200 ? s.slice(0, 130) : undefined };
}

// --- 2. ANDROID_VR player (yt-dlp's current no-PO-token client) ---
{
  const r = await call("player", {
    context: { client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US" } },
    videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true,
  }, { key: ANDROID_KEY });
  const j = r.json || {};
  const f = (j.streamingData?.formats || [])[0] || {};
  out.androidVrPlayer = {
    status: r.status, playability: j.playabilityStatus?.status, reason: j.playabilityStatus?.reason?.slice(0, 80),
    hls: !!j.streamingData?.hlsManifestUrl, formats: (j.streamingData?.formats || []).length,
    adaptive: (j.streamingData?.adaptiveFormats || []).length,
    firstUrl: !!f.url, firstSig: !!f.signatureCipher, itag: f.itag,
  };
  // embed-blocked video test with VR client
  const r2 = await call("player", {
    context: { client: { clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Quest 3", osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US" } },
    videoId: "ktvTqknDobU", contentCheckOk: true, racyCheckOk: true,
  }, { key: ANDROID_KEY });
  const j2 = r2.json || {};
  out.androidVrBlocked = {
    status: r2.status, playability: j2.playabilityStatus?.status, reason: j2.playabilityStatus?.reason?.slice(0, 90),
    hls: !!j2.streamingData?.hlsManifestUrl, formats: (j2.streamingData?.formats || []).length,
  };
}

// --- 3. Comments token: recursive search ---
function findCommentToken(obj, depth = 0) {
  if (!obj || depth > 12 || typeof obj !== "object") return null;
  if (obj.sectionIdentifier === "comment-item-section") return obj;
  for (const k of Object.keys(obj)) {
    const found = findCommentToken(obj[k], depth + 1);
    if (found) return found;
  }
  return null;
}
{
  const r = await call("next", { context: WEB_CTX, videoId: "jNQXAC9IVRw" });
  const j = r.json || {};
  const section = findCommentToken(j);
  let token = null;
  if (section) {
    const s = JSON.stringify(section);
    const m = s.match(/"token":"([^"]{20,})"/);
    token = m ? m[1] : null;
  }
  out.commentSectionFound = !!section;
  out.commentToken = token ? token.slice(0, 40) + "..." : null;
  if (token) {
    const r2 = await call("next", { context: WEB_CTX, continuation: token });
    const s2 = JSON.stringify(r2.json || {});
    out.commentsPage = {
      status: r2.status,
      threads: (s2.match(/"commentThreadRenderer"/g) || []).length,
      entities: (s2.match(/"commentEntityPayload"/g) || []).length,
      keys: Object.keys((r2.json || {}).onResponseReceivedEndpoints?.[0] || {}),
    };
    // sample a commentEntityPayload
    const m2 = s2.match(/"commentEntityPayload":\{[^{]*?"properties":\{"content":\{"content":"((?:[^"\\]|\\.){5,120}?)"/);
    out.commentSample = m2 ? m2[1] : null;
  }
}

// --- 4. lockupViewModel sample (related video shape) ---
{
  const r = await call("next", { context: WEB_CTX, videoId: "jNQXAC9IVRw" });
  const sec = r.json?.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results || [];
  const lv = sec.find(x => x.lockupViewModel);
  if (lv) {
    const l = lv.lockupViewModel;
    out.lockupSample = {
      contentId: l.contentId,
      hasMetadata: !!l.metadata,
      hasThumbnail: !!l.contentImage?.thumbnailViewModel?.image?.sources?.[0]?.url,
      metadataJson: JSON.stringify(l.metadata?.lockupMetadataViewModel?.metadata).slice(0, 400),
    };
  } else out.lockupSample = null;
}

// --- 5. Search response structure: renderer types in contents ---
{
  const r = await call("search", { context: WEB_CTX, query: "lofi hip hop" });
  const items = r.json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const types = [];
  for (const section of items) {
    const sec = section.itemSectionRenderer?.contents || [];
    for (const item of sec) types.push(Object.keys(item)[0]);
  }
  out.searchItemTypes = [...new Set(types)];
}

console.log(JSON.stringify(out, null, 2));
