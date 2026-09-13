// Quick engine test via bun (node-fetch semantics = no CORS, like CapacitorHttp)
import { itSearch, itHome, itVideo, itComments, itChannel, itSuggest, extractVideosAndToken } from "../src/lib/innertube";

const out: Record<string, unknown> = {};

// 1. home feed + pagination depth
const home = await itHome("all");
out.home1 = { count: home.videos.length, first: home.videos[0] ? { t: home.videos[0].title.slice(0, 40), ch: home.videos[0].channel, v: home.videos[0].views, d: home.videos[0].duration, p: home.videos[0].published } : null, hasToken: !!home.continuation };
if (home.continuation) {
  const home2 = await itHome("all", home.continuation);
  out.home2 = { count: home2.videos.length, hasToken: !!home2.continuation, overlap: home2.videos.filter(v => home.videos.some(w => w.id === v.id)).length };
}

// 2. search + suggestions
const sugg = await itSuggest("techno gam");
out.suggest = sugg;
const search = await itSearch("lofi hip hop radio");
out.search = {
  count: search.videos.length,
  channel: search.channel ? { name: search.channel.name, subs: search.channel.subscribers } : null,
  hasToken: !!search.continuation,
  first: search.videos[0] ? { t: search.videos[0].title.slice(0, 40), ch: search.videos[0].channel, v: search.videos[0].views, d: search.videos[0].duration } : null,
};

// 3. video page (next + ANDROID_VR player)
const video = await itVideo("jNQXAC9IVRw");
out.video = {
  title: video.title, channel: video.channel, channel_id: video.channel_id,
  views: video.views, published: video.published, likes: video.likes,
  related: video.related.length, embed_fallback: video.embed_fallback,
  hls: !!video.hls, formats: video.formats.length, captions: video.captions.length,
  reason: video.playability_reason, desc: (video.description || "").slice(0, 60),
};

// 4. comments
const comments = await itComments("jNQXAC9IVRw");
out.comments = {
  count: comments.comments.length,
  hasToken: !!comments.token,
  total: comments.count,
  first: comments.comments[0] ? { a: comments.comments[0].author, t: (comments.comments[0].text || "").slice(0, 50), likes: comments.comments[0].likes } : null,
};

// 5. channel
const channel = await itChannel("UCX6OQ3DkcsbYNE6H8uQQuVA");
out.channel = {
  name: channel.name, subs: channel.subscribers, avatar: channel.avatar.slice(0, 50),
  banner: channel.banner.slice(0, 50), videos: channel.videos.length, hasToken: !!channel.continuation,
  firstVideo: channel.videos[0] ? { t: channel.videos[0].title.slice(0, 40), d: channel.videos[0].duration, v: channel.videos[0].views } : null,
};

// 6. live category
const live = await itHome("live");
out.liveFeed = { count: live.videos.length, liveCount: live.videos.filter(v => v.is_live).length };

console.log(JSON.stringify(out, null, 2));
