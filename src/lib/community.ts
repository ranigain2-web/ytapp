// Community data source — public Piped API instances with health probing.
// Used automatically when no ytapp backend is reachable (e.g. the Android APK
// on first run, before the user connects a server). CORS is open (*), so this
// works from the Capacitor WebView and any browser.
// Playback in community mode always uses the official embed (plays from the
// USER's IP — no datacenter gating); direct stream URLs from public instances
// are IP-bound to the instance and unreliable, so they are intentionally not
// consumed.

import type { YtVideo, YtVideoFull, YtComment, YtChannel, YtChannelResult } from "./yt-api";
import { formatViews, formatTime } from "./yt-format";

export const COMMUNITY_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.drgns.space",
  "https://pipedapi.phoenixthrush.com",
];

export let activeCommunityInstance: string | null = null;

export class CommunityError extends Error {}

// ---------- low-level fetch with guards ----------

async function getText(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) throw new CommunityError(`HTTP ${res.status}`);
    const t = text.trimStart();
    if (t.startsWith("<")) throw new CommunityError("non-JSON response");
    return text;
  } catch (e) {
    if (e instanceof CommunityError) throw e;
    const msg = e instanceof Error && e.name === "AbortError" ? "timed out" : "unreachable";
    throw new CommunityError(msg);
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(path: string, timeoutMs = 20000, base?: string): Promise<T> {
  const url = /^https?:\/\//.test(path)
    ? path // absolute URL (e.g. noembed) — use as-is
    : `${base || activeCommunityInstance}${path}`;
  if (!/^https?:\/\//.test(url)) throw new CommunityError("no community instance");
  return JSON.parse(await getText(url, timeoutMs)) as T;
}

// ---------- health probing ----------

interface PipedItemLite { url?: string; title?: string }

export async function probeCommunity(timeoutMs = 8000): Promise<string | null> {
  const ordered = activeCommunityInstance
    ? [activeCommunityInstance, ...COMMUNITY_INSTANCES.filter(i => i !== activeCommunityInstance)]
    : COMMUNITY_INSTANCES;
  for (const base of ordered) {
    try {
      const d = await getJson<PipedItemLite[]>("/trending?region=US", timeoutMs, base);
      if (Array.isArray(d) && d.length > 0) {
        activeCommunityInstance = base;
        return base;
      }
    } catch { /* try next */ }
  }
  activeCommunityInstance = null;
  return null;
}

// ---------- mapping ----------

interface PipedItem {
  url?: string;
  type?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  uploaderUrl?: string;
  uploaderAvatar?: string;
  uploaderVerified?: boolean;
  views?: number;
  duration?: number;
  uploadedDate?: string;
  isShort?: boolean;
  shortDescription?: string;
}

function videoIdOf(item: PipedItem): string {
  const m = /(?:\?v=|\/watch\/)([\w-]{6,})/.exec(item.url || "");
  return m ? m[1] : "";
}

function channelIdOf(item: PipedItem): string {
  const m = /\/channel\/(UC[\w-]+)/.exec(item.uploaderUrl || "");
  return m ? m[1] : "";
}

export function mapPipedItem(item: PipedItem): YtVideo | null {
  const id = videoIdOf(item);
  if (!id || (item.type && item.type !== "stream")) return null;
  const dur = typeof item.duration === "number" && item.duration > 0 ? item.duration : 0;
  return {
    id,
    title: item.title || "",
    channel: item.uploaderName || "",
    channel_id: channelIdOf(item),
    views: typeof item.views === "number" && item.views >= 0 ? formatViews(item.views) : "",
    duration: dur ? formatTime(dur) : "",
    published: item.uploadedDate || "",
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    thumb_lg: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    is_live: typeof item.duration === "number" && item.duration < 0,
    shorts: !!item.isShort,
  };
}

// ---------- endpoints ----------

const CATEGORY_QUERIES: Record<string, string> = {
  music: "music", gaming: "gaming", news: "news", movies: "movie trailer",
  live: "live stream", tech: "technology", sports: "sports", learning: "learning",
  comedy: "comedy", podcasts: "podcast", cooking: "cooking", trailers: "movie trailer",
};

export async function communityHome(category: string): Promise<{ category: string; source: string; results: YtVideo[] }> {
  if (!category || category === "all") {
    const d = await getJson<PipedItem[]>("/trending?region=US");
    return { category, source: "community:trending", results: d.map(mapPipedItem).filter(Boolean) as YtVideo[] };
  }
  const q = CATEGORY_QUERIES[category] || category;
  const d = await getJson<{ items?: PipedItem[] }>(`/search?q=${encodeURIComponent(q)}&filter=videos`);
  return { category, source: "community:search", results: (d.items || []).map(mapPipedItem).filter(Boolean) as YtVideo[] };
}

interface PipedChannelSearchItem { uploaderName?: string; uploaderUrl?: string; uploaderAvatar?: string; uploaderVerified?: boolean; description?: string; subscribers?: number; type?: string; url?: string }

export async function communitySearch(q: string): Promise<{ query: string; channel?: YtChannelResult | null; results: YtVideo[] }> {
  const [vids, chans] = await Promise.all([
    getJson<{ items?: PipedItem[] }>(`/search?q=${encodeURIComponent(q)}&filter=videos`),
    getJson<{ items?: PipedChannelSearchItem[] }>(`/search?q=${encodeURIComponent(q)}&filter=channels`).catch(() => ({ items: [] as PipedChannelSearchItem[] })),
  ]);
  let channel: YtChannelResult | null = null;
  const cl = (chans.items || []).find(c => (c.type === "channel" || /\/channel\//.test(c.uploaderUrl || "")));
  if (cl) {
    const id = channelIdOf({ uploaderUrl: cl.uploaderUrl } as PipedItem);
    if (id) {
      channel = {
        id,
        name: cl.uploaderName || "",
        avatar: cl.uploaderAvatar || "",
        subscribers: typeof cl.subscribers === "number" ? `${formatViews(cl.subscribers)} subscribers` : "",
        description: cl.description || "",
        verified: !!cl.uploaderVerified,
      };
    }
  }
  return { query: q, channel, results: (vids.items || []).map(mapPipedItem).filter(Boolean) as YtVideo[] };
}

interface NoembedResp { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string; error?: string }

interface PipedStreams {
  title?: string; description?: string; uploadDate?: string;
  uploader?: string; uploaderUrl?: string; uploaderAvatar?: string;
  subscriberCount?: number; views?: number; likes?: number;
  duration?: number; livestream?: boolean; relatedStreams?: PipedItem[];
  error?: string;
}

export async function communityVideo(id: string): Promise<YtVideoFull> {
  const empty: YtVideoFull = {
    id, ok: true, embed_fallback: true,
    title: "", channel: "", channel_id: "", channel_thumb: "",
    views: 0, likes: 0, duration: 0, published: "", description: "",
    formats: [], hls: null, captions: [], storyboard: null, related: [], chapters: [],
  };

  // Primary: instance /streams (full metadata + related)
  try {
    const d = await getJson<PipedStreams>(`/streams/${id}`);
    if (!d.error && (d.title || d.uploader)) {
      const cid = channelIdOf({ uploaderUrl: d.uploaderUrl } as PipedItem);
      return {
        ...empty,
        title: d.title || "",
        channel: d.uploader || "",
        channel_id: cid,
        channel_thumb: d.uploaderAvatar || "",
        channel_subs: typeof d.subscriberCount === "number" ? `${formatViews(d.subscriberCount)} subscribers` : "",
        views: typeof d.views === "number" ? formatViews(d.views) : 0,
        likes: typeof d.likes === "number" ? d.likes : 0,
        duration: typeof d.duration === "number" && d.duration > 0 ? d.duration : 0,
        published: d.uploadDate || "",
        description: d.description || "",
        is_live: !!d.livestream,
        related: (d.relatedStreams || []).map(mapPipedItem).filter(Boolean).slice(0, 20) as YtVideo[],
      };
    }
  } catch { /* fall through to noembed */ }

  // Fallback: noembed (title/author) + search-seeded related
  let title = "", author = "", authorUrl = "", thumb = "";
  try {
    const ne = await getJson<NoembedResp>(`https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, 10000, "");
    if (!ne.error) {
      title = ne.title || "";
      author = ne.author_name || "";
      authorUrl = ne.author_url || "";
      thumb = (ne.thumbnail_url || "").replace("/hqdefault", "/mqdefault");
    }
  } catch { /* keep empty */ }
  const cid = /\/channel\/(UC[\w-]+)/.exec(authorUrl || "")?.[1] || "";
  const related = title
    ? await communitySearch(title.split(/\s+/).slice(0, 4).join(" "))
        .then(r => r.results.filter(v => v.id !== id).slice(0, 20))
        .catch(() => [] as YtVideo[])
    : ([] as YtVideo[]);
  return { ...empty, title, channel: author, channel_id: cid, thumb_lg: thumb || undefined, related };
}

interface PipedComment { author?: string; thumbnail?: string; commentText?: string; commentedTime?: string; likeCount?: number; pinned?: boolean; replyCount?: number; creatorReplied?: boolean }

export async function communityComments(id: string): Promise<{ comments: YtComment[]; count: number | null }> {
  const d = await getJson<{ comments?: PipedComment[]; commentCount?: number; disabled?: boolean }>(`/comments/${id}`);
  if (d.disabled) return { comments: [], count: 0 };
  return {
    comments: (d.comments || []).map((c, i) => ({
      author: c.author || "",
      author_id: "",
      author_thumb: c.thumbnail,
      text: c.commentText || "",
      likes: c.likeCount || 0,
      time: (c.commentedTime || "").replace(/^.*?on /, ""),
      replies: c.replyCount || 0,
      creator_heart: !!c.creatorReplied,
    })),
    count: typeof d.commentCount === "number" ? d.commentCount : null,
  };
}

interface PipedChannel { id?: string; name?: string; avatarUrl?: string; bannerUrl?: string; description?: string; subscriberCount?: number; verified?: boolean; relatedStreams?: PipedItem[] }

export async function communityChannel(id: string): Promise<YtChannel> {
  const d = await getJson<PipedChannel>(`/channel/${id}`);
  let videos = (d.relatedStreams || []).map(mapPipedItem).filter(Boolean) as YtVideo[];
  // Many instances leave relatedStreams empty — fall back to a channel-scoped
  // search (search results carry uploaderUrl, so we can filter to this channel).
  if (videos.length === 0 && d.name) {
    try {
      const s = await getJson<{ items?: PipedItem[] }>(`/search?q=${encodeURIComponent(d.name)}&filter=videos`);
      videos = (s.items || [])
        .filter(i => channelIdOf(i) === id)
        .map(mapPipedItem)
        .filter(Boolean) as YtVideo[];
    } catch { /* keep empty */ }
  }
  return {
    id,
    name: d.name || "",
    description: d.description || "",
    avatar: d.avatarUrl || "",
    banner: d.bannerUrl || "",
    subscribers: typeof d.subscriberCount === "number" ? `${formatViews(d.subscriberCount)} subscribers` : "",
    videos,
  };
}
