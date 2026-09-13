import { itVideo } from "../src/lib/innertube";
// invalid/dead video
const v = await itVideo("aaaaaaaaaaa");
console.log(JSON.stringify({
  title: v.title, channel: v.channel, ok: v.ok,
  embed_fallback: v.embed_fallback, unavailable: v.unavailable,
  embed_blocked: v.embed_blocked, reason: v.playability_reason?.slice(0, 80),
  related: v.related.length,
}, null, 2));
