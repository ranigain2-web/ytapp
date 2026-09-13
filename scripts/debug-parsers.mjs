// Debug dump: exact response structures for parser fixes
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };

async function call(endpoint, body, key = WEB_KEY) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const out = {};

// 1. Which channel-videos params is right?
for (const params of ["EgZ2aWRlb3MyBgQKAjoA", "EgZ2aWRlb3NyBgQKAjoA", "EgZ2aWRlb3PyBgQKAjoA", "EgZ2aWRlb3nyBgQKAjoA"]) {
  const r = await call("browse", { context: WEB_CTX, browseId: "UCX6OQ3DkcsbYNE6H8uQQuVA", params });
  const s = JSON.stringify(r.json || {});
  out[`ch_${params.slice(-14)}`] = { status: r.status, rich: (s.match(/"richItemRenderer"/g) || []).length };
}

// 2. Channel header structure (avatar/banner/subs/name)
{
  const r = await call("browse", { context: WEB_CTX, browseId: "UCX6OQ3DkcsbYNE6H8uQQuVA", params: "EgZ2aWRlb3MyBgQKAjoA" });
  const j = r.json || {};
  out.headerKeys = Object.keys(j.header || {});
  const hv = j.header?.pageHeaderViewModel;
  if (hv) {
    out.headerViewModel = {
      title: hv.content?.title?.dynamicTextViewModel?.text?.content,
      avatarSample: JSON.stringify(hv.content?.avatar?.avatarViewModel?.image?.sources?.[0] || {}).slice(0, 200),
      metadataRowsSample: JSON.stringify(hv.content?.metadata?.contentMetadataViewModel?.metadataRows?.[0] || {}).slice(0, 250),
    };
  }
  const s2 = JSON.stringify(j.banner || {});
  out.bannerSample = s2.slice(0, 300);
}

// 3. next() — videoSecondaryInfoRenderer for owner + description
{
  const r = await call("next", { context: WEB_CTX, videoId: "jNQXAC9IVRw" });
  const j = r.json || {};
  const contents = j.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
  out.nextSectionKeys = contents.map(c => Object.keys(c)[0]);
  const sec = contents.find(c => c.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
  if (sec) {
    out.secondaryKeys = Object.keys(sec);
    out.owner = JSON.stringify(sec.owner || sec.videoOwnerRenderer || {}).slice(0, 400);
    out.description = JSON.stringify(sec.attributedDescription || {}).slice(0, 200);
  }
  const prim = contents.find(c => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
  if (prim) out.primaryKeys = Object.keys(prim);
}

// 4. Search: where's the channel renderer for "lofi girl"?
{
  const r = await call("search", { context: WEB_CTX, query: "lofi girl" });
  const j = r.json || {};
  const sections = j.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const types = [];
  for (const section of sections) {
    for (const item of (section.itemSectionRenderer?.contents || [])) types.push(Object.keys(item)[0]);
  }
  out.searchTypesLofi = [...new Set(types)];
  // find the channel-ish item and dump it
  for (const section of sections) {
    for (const item of (section.itemSectionRenderer?.contents || [])) {
      const k = Object.keys(item)[0];
      if (/channel/i.test(k)) out.searchChannelSample = JSON.stringify(item).slice(0, 500);
      if (k === "lockupViewModel" && /channel/i.test(JSON.stringify(item))) out.searchLockupChannelSample = JSON.stringify(item).slice(0, 600);
    }
  }
}

// 5. Home feed: the "full playlist" views bug — dump a videoRenderer's metadata parts
{
  const r = await call("search", { context: WEB_CTX, query: "trending" });
  const j = r.json || {};
  const sections = j.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  let dumped = 0;
  for (const section of sections) {
    for (const item of (section.itemSectionRenderer?.contents || [])) {
      if (item.videoRenderer && dumped < 2) {
        const vr = item.videoRenderer;
        out[`vrSample${dumped}`] = {
          videoId: vr.videoId,
          title: vr.title?.runs?.[0]?.text?.slice(0, 30),
          viewCountText: vr.viewCountText?.simpleText,
          shortViewCount: vr.shortViewCountText?.simpleText,
          lengthText: vr.lengthText?.simpleText,
          published: vr.publishedTimeText?.simpleText,
          ownerText: vr.ownerText?.runs?.[0]?.text,
        };
        dumped++;
      }
      // playlist-ish renderer?
      const k = Object.keys(item)[0];
      if (/playlist/i.test(k) && !out.playlistSample) out.playlistSample = k;
    }
  }
}

console.log(JSON.stringify(out, null, 2));
