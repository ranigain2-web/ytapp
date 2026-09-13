// Probe YouTube InnerTube API directly — determines what a standalone client
// (Capacitor WebView + CapacitorHttp, or plain browser fetch) can reach.
// Tests: CORS headers, browse (trending + continuation), search, suggestions,
// player (ANDROID client, incl. an embed-restricted video), next (watch page).

const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";

const WEB_CTX = {
  client: {
    clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US",
  },
};
const ANDROID_CTX = {
  client: {
    clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30,
    hl: "en", gl: "US", userAgent: "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
  },
};

async function call(endpoint, body, key = WEB_KEY, checkCors = false) {
  const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`;
  const headers = {
    "Content-Type": "application/json",
    ...(checkCors ? { Origin: "https://example.org" } : {}),
    ...(body.context?.client?.clientName === "ANDROID"
      ? { "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip" }
      : {}),
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const cors = {
    acao: res.headers.get("access-control-allow-origin"),
    // node fetch hides some; check text too
  };
  const json = await res.json().catch(() => null);
  return { status: res.status, ms, cors, json };
}

function countItems(json) {
  // rough count of video renderers in a browse/search response
  const s = JSON.stringify(json || {});
  const vids = (s.match(/"videoRenderer"/g) || []).length;
  const conts = (s.match(/"continuationCommand"/g) || []).length;
  const shorts = (s.match(/"richItemRenderer"/g) || []).length;
  return { vids, conts, shorts, len: s.length };
}

const results = {};

// 1. Trending (home feed) + CORS header check
try {
  const r = await call("browse", { context: WEB_CTX, browseId: "FEtrending" }, WEB_KEY, true);
  results.trending = { status: r.status, ms: r.ms, cors: r.cors, ...countItems(r.json) };
  // extract first continuation token for pagination test
  const s = JSON.stringify(r.json);
  const m = s.match(/"token":"([^"]{50,})"/);
  results.trending.contToken = !!m;
} catch (e) { results.trending = { error: String(e) }; }

// 2. Search + continuation
try {
  const r = await call("search", { context: WEB_CTX, query: "lofi hip hop" });
  results.search = { status: r.status, ms: r.ms, ...countItems(r.json) };
  const s = JSON.stringify(r.json);
  const m = s.match(/"token":"([^"]{50,})"/);
  if (m) {
    const r2 = await call("search", { context: WEB_CTX, continuation: m[1] });
    results.searchContinued = { status: r2.status, ...countItems(r2.json) };
  }
} catch (e) { results.search = { error: String(e) }; }

// 3. Suggestions (new endpoint + legacy)
try {
  const r = await call("search/suggestions", { context: WEB_CTX, input: "lofi" });
  const s = JSON.stringify(r.json);
  results.suggestionsNew = {
    status: r.status, cors: r.cors,
    suggestions: (s.match(/"query"/g) || []).length,
  };
} catch (e) { results.suggestionsNew = { error: String(e) }; }
try {
  const t0 = Date.now();
  const res = await fetch(
    "https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=lofi",
    { headers: { Origin: "https://www.youtube.com" } }
  );
  const text = await res.text();
  results.suggestionsLegacy = {
    status: res.status, ms: Date.now() - t0,
    acao: res.headers.get("access-control-allow-origin"),
    sample: text.slice(0, 120),
  };
} catch (e) { results.suggestionsLegacy = { error: String(e) }; }

// 4. Player — normal video, ANDROID client (direct streams?)
try {
  const r = await call("player", {
    context: ANDROID_CTX, videoId: "jNQXAC9IVRw", // "Me at the zoo" (first YT video, never restricted)
    contentCheckOk: true, racyCheckOk: true,
  }, ANDROID_KEY);
  const j = r.json || {};
  const sd = j.streamingData || {};
  const fmt = (sd.formats || [])[0] || {};
  results.playerAndroid = {
    status: r.status, ms: r.ms,
    playability: j.playabilityStatus?.status,
    hasHls: !!sd.hlsManifestUrl,
    formats: (sd.formats || []).length,
    adaptive: (sd.adaptiveFormats || []).length,
    firstFormat: fmt.itag ? { itag: fmt.itag, hasUrl: !!fmt.url, hasSig: !!fmt.signatureCipher, mime: fmt.mimeType?.slice(0, 40) } : null,
    title: j.videoDetails?.title,
  };
} catch (e) { results.playerAndroid = { error: String(e) }; }

// 5. Player — TV embedded client (what youtube.com/embed itself uses)
try {
  const r = await call("player", {
    context: {
      client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0", hl: "en", gl: "US" },
      thirdParty: { embedUrl: "https://www.youtube.com/" },
    },
    videoId: "jNQXAC9IVRw", contentCheckOk: true, racyCheckOk: true,
  }, WEB_KEY);
  const j = r.json || {};
  const sd = j.streamingData || {};
  results.playerTvEmbed = {
    status: r.status, playability: j.playabilityStatus?.status,
    hasHls: !!sd.hlsManifestUrl, formats: (sd.formats || []).length,
    adaptive: (sd.adaptiveFormats || []).length,
  };
} catch (e) { results.playerTvEmbed = { error: String(e) }; }

// 6. Player — embed-BLOCKED video via ANDROID client (the Seven.One case)
// Known embed-blocked: from user's screenshot — try a music-video VEVO id.
try {
  const r = await call("player", {
    context: ANDROID_CTX, videoId: "ktvTqknDobU", // Imagine Dragons - Radioactive (VEVO, historically embed-blocked)
    contentCheckOk: true, racyCheckOk: true,
  }, ANDROID_KEY);
  const j = r.json || {};
  const sd = j.streamingData || {};
  results.playerBlockedAndroid = {
    status: r.status, playability: j.playabilityStatus?.status,
    reason: j.playabilityStatus?.reason?.slice(0, 90),
    hasHls: !!sd.hlsManifestUrl, formats: (sd.formats || []).length,
  };
} catch (e) { results.playerBlockedAndroid = { error: String(e) }; }

// 7. Next (watch page: related + comments token)
try {
  const r = await call("next", { context: WEB_CTX, videoId: "jNQXAC9IVRw" });
  const s = JSON.stringify(r.json);
  results.next = {
    status: r.status, ms: r.ms,
    related: (s.match(/"compactVideoRenderer"/g) || []).length,
    commentsToken: /"continuationCommand".*"token"/.test(s),
    len: s.length,
  };
} catch (e) { results.next = { error: String(e) }; }

// 8. Channel browse
try {
  const r = await call("browse", { context: WEB_CTX, browseId: "UCX6OQ3DkcsbYNE6H8uQQuVA" }); // MrBeast
  const s = JSON.stringify(r.json);
  results.channel = {
    status: r.status, vids: (s.match(/"videoRenderer"|"gridVideoRenderer"|"richItemRenderer"/g) || []).length,
  };
} catch (e) { results.channel = { error: String(e) }; }

console.log(JSON.stringify(results, null, 2));
