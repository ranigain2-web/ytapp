// ============================================================================
// innertube.ts — STANDALONE YouTube data engine (no external server, no proxy).
//
// Talks DIRECTLY to YouTube's own InnerTube API (youtubei) exactly like the
// official apps do. Transport:
//   - Android (Capacitor): CapacitorHttp — native HTTP layer, CORS-free.
//     This is what makes the app fully standalone on-device: every call goes
//     from the phone itself, on the user's own IP.
//   - Web/dev: tries the ytapp dev relay (/api/ytb-relay) so the exact same
//     parsing code can be exercised in a normal browser. Falls back to a
//     direct fetch attempt (works only if a CORS-open path exists).
//
// Covered endpoints: search (+continuation), browse (channel videos tab),
// next (watch page metadata + related + comments), player (ANDROID_VR client
// for direct streams on-device), legacy suggest (search suggestions).
// ============================================================================

import { formatViews, formatTime } from "./yt-format";
import { rememberAvatar } from "./yt-avatar";
import type { YtVideo, YtVideoFull, YtComment, YtChannel, YtChannelResult, YtCaption } from "./yt-api";

// ---- public constants (well-known public client keys, same ones every
// open-source YouTube client ships) ----
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const IT_HOST = "https://www.youtube.com";
const SUGGEST_URL = "https://suggestqueries-clients6.youtube.com/complete/search";

const WEB_CTX = { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" } };
// ANDROID_VR: the current most-compatible client for direct streams without a
// PO token (same choice yt-dlp/NewPipe-class extractors make).
const VR_CTX = {
  client: {
    clientName: "ANDROID_VR", clientVersion: "1.60.19", deviceModel: "Quest 3",
    osName: "Android", osVersion: "12L", androidSdkVersion: 32, hl: "en", gl: "US",
  },
};
// TVHTML5 smart-TV client with the web session's visitorData — used as a
// best-effort second attempt when ANDROID_VR is bot-gated (LOGIN_REQUIRED).
// On residential IPs this combination recovers direct streams most of the time.
const TV_CTX_VERSION = "7.20260909.12.00"; // current version shipped by youtube.com/tv
const tvCtx = (visitorData?: string) => ({
  client: {
    clientName: "TVHTML5", clientVersion: TV_CTX_VERSION, hl: "en", gl: "US",
    ...(visitorData ? { visitorData } : {}),
  },
});

export class ItError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type AnyObj = Record<string, unknown>;

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

// Relay probe (web only): is the dev relay reachable through the gateway?
let relayAvailable: boolean | null = null;

function relayHref(): string {
  // same pattern as apiHref(): sandbox gateway routes /api to port 3001
  return "/api/ytb-relay?XTransformPort=3001";
}

async function probeRelay(): Promise<boolean> {
  if (relayAvailable !== null) return relayAvailable;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${relayHref()}&e=ping`, { signal: ctrl.signal });
    clearTimeout(timer);
    relayAvailable = res.ok;
  } catch { relayAvailable = false; }
  return relayAvailable;
}

export function resetTransportCache() { relayAvailable = null; }

interface ItResponse { status: number; json: AnyObj | null }

async function relayPost(endpoint: string, body: AnyObj, key: string): Promise<ItResponse> {
  // POST preferred; GET fallback for gateways that only forward GET cleanly
  const tryFetch = async (method: "POST" | "GET"): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      if (method === "POST") {
        return await fetch(`${relayHref()}&e=${encodeURIComponent(endpoint)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint, key, body }),
          signal: ctrl.signal,
        });
      }
      return await fetch(`${relayHref()}&e=${encodeURIComponent(endpoint)}&k=${encodeURIComponent(key)}&b=${encodeURIComponent(JSON.stringify(body))}`, {
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }
  };
  let res: Response;
  try {
    res = await tryFetch("POST");
    if (!res.ok && res.status >= 500) res = await tryFetch("GET");
  } catch {
    res = await tryFetch("GET");
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, json: (json as AnyObj | null) ?? null };
}

async function ytPost(endpoint: string, body: AnyObj, key = WEB_KEY): Promise<AnyObj> {
  // 1) Native Android: CapacitorHttp (native socket, no CORS)
  if (isNativeApp()) {
    try {
      const { CapacitorHttp } = await import("@capacitor/core");
      const res = await CapacitorHttp.post({
        url: `${IT_HOST}/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`,
        headers: { "Content-Type": "application/json" },
        data: body,
        connectTimeout: 15000,
        readTimeout: 20000,
      });
      if (res.status >= 200 && res.status < 300 && res.data) return res.data as AnyObj;
      const errMsg = (res.data as AnyObj | null)?.error as { message?: string } | undefined;
      throw new ItError(errMsg?.message || `YouTube API error (HTTP ${res.status})`, res.status);
    } catch (e) {
      if (e instanceof ItError) throw e;
      throw new ItError("Could not reach YouTube", 0);
    }
  }
  // 2) Web: relay (dev) → direct (rare)
  if (await probeRelay()) {
    const r = await relayPost(endpoint, body, key);
    if (r.json && (r.json as { error?: { message?: string } }).error) {
      throw new ItError((r.json as { error: { message?: string } }).error.message || "YouTube API error", r.status);
    }
    if (r.json) return r.json;
    throw new ItError("Relay returned an invalid response", r.status);
  }
  // 3) Direct attempt (works only where CORS permits; final fallback)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${IT_HOST}/youtubei/v1/${endpoint}?key=${key}&prettyPrint=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) throw new ItError("Could not reach YouTube directly", res.status);
    return json as AnyObj;
  } catch (e) {
    if (e instanceof ItError) throw e;
    throw new ItError("Could not reach YouTube", 0);
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------------------
// Suggestions (legacy suggest endpoint — the one youtube.com itself uses)
// ---------------------------------------------------------------------------

export async function itSuggest(q: string): Promise<string[]> {
  const query = q.trim();
  if (!query) return [];
  const url = `${SUGGEST_URL}?client=youtube&ds=yt&q=${encodeURIComponent(query)}`;
  let text = "";
  if (isNativeApp()) {
    try {
      const { CapacitorHttp } = await import("@capacitor/core");
      const res = await CapacitorHttp.get({ url, readTimeout: 8000 });
      text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    } catch { return []; }
  } else if (await probeRelay()) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`/api/ytb-suggest?XTransformPort=3001&q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const j = await res.json() as { suggestions?: string[] };
        return j.suggestions || [];
      }
    } catch { return []; }
  } else {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      text = await res.text();
    } catch { return []; }
  }
  // JSONP parse: window.google.ac.h(["query",[["sugg",0,[...]],[...]]])
  return parseSuggestJsonp(text);
}

export function parseSuggestJsonp(text: string): string[] {
  try {
    const start = text.indexOf("(");
    const end = text.lastIndexOf(")");
    if (start < 0 || end <= start) return [];
    const data = JSON.parse(text.slice(start + 1, end)) as unknown[];
    const arr = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    return arr
      .map((item: unknown) => (Array.isArray(item) ? String(item[0] || "") : ""))
      .filter((s: string) => s.length > 0)
      .slice(0, 12);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Parsers — renderer → YtVideo
// ---------------------------------------------------------------------------

function runsText(x: unknown): string {
  const r = (x as { runs?: { text?: string }[] })?.runs;
  return r ? r.map(t => t.text || "").join("") : "";
}

function parseThumb(list: unknown): string {
  const arr = (list as { url?: string; width?: number }[]) || [];
  let best = "";
  let w = 0;
  for (const t of arr) { if ((t.width || 0) >= w) { w = t.width || 0; best = t.url || ""; } }
  return best;
}

function parseVideoRenderer(vr: AnyObj): YtVideo | null {
  const id = vr.videoId as string;
  if (!id) return null;
  const title = runsText(vr.title) || (vr.title as { simpleText?: string })?.simpleText || "";
  const ownerRuns = (vr.ownerText as { runs?: { text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] })?.runs;
  const channel = ownerRuns?.[0]?.text || runsText(vr.longBylineText) || "";
  const channel_id = ownerRuns?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    || (vr.longBylineText as { runs?: { navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] })?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
    || "";
  const views = ((vr.shortViewCountText as { simpleText?: string })?.simpleText)
    || ((vr.viewCountText as { simpleText?: string })?.simpleText)
    || runsText(vr.shortViewCountText) || "";
  const published = ((vr.publishedTimeText as { simpleText?: string })?.simpleText || "");
  let duration = ((vr.lengthText as { simpleText?: string })?.simpleText || "");
  let is_live = false;
  const badges = JSON.stringify(vr.thumbnailOverlays || "");
  if (/BADGE_STYLE_TYPE_LIVE/.test(badges) || /LIVE/i.test(duration) || /watching/i.test(views)) { is_live = true; duration = "LIVE"; }
  const thumb = parseThumb((vr.thumbnail as { thumbnails?: unknown })?.thumbnails) || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  return {
    id, title, channel, channel_id,
    views: formatViews(views.replace(/ views/i, "")),
    duration: is_live ? "LIVE" : duration,
    published,
    thumb, thumb_lg: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    is_live, shorts: false,
  };
}

// lockupViewModel — the current renderer for related videos & new search results.
// Playlist/mix lockups (collectionThumbnailViewModel, "N videos" badges) are skipped.
// Related lockups show bare compact counts ("3.9M") and durations via
// thumbnailBottomOverlayViewModel; search lockups show "1.2M views" text and
// channel avatars in attachmentRuns — all handled here.
function parseLockup(lv: AnyObj): YtVideo | null {
  const id = lv.contentId as string;
  if (!id) return null;
  // skip playlists/mixes/radios — they are not watchable videos
  const img = (lv.contentImage as AnyObj | undefined) || {};
  if (img.collectionThumbnailViewModel) return null;
  if (/^(RD|PL|VL|UU|OL)/.test(id)) return null;
  const meta = (lv.metadata as { lockupMetadataViewModel?: {
    title?: { content?: string };
    metadata?: { contentMetadataViewModel?: { metadataRows?: unknown[] } };
    image?: { sources?: { url?: string }[] };
  } })?.lockupMetadataViewModel;
  const title = meta?.title?.content || "";
  if (!title) return null;
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows as
    { metadataParts?: { text?: { content?: string }; avatar?: { image?: { sources?: { url?: string }[] } } }[] }[] | undefined;
  const parts: { text: string; avatar: string }[] = [];
  for (const row of rows || []) {
    for (const p of row.metadataParts || []) {
      const t = p.text?.content || "";
      const av = p.avatar?.image?.sources?.[0]?.url || "";
      if (t) parts.push({ text: t, avatar: av });
    }
  }
  const isTime = (t: string) => /ago|streamed|premiere|hour|day|week|month|year|minute|second/i.test(t);
  const isViewsWord = (t: string) => /views|watching/i.test(t);
  const isCompactCount = (t: string) => /^[\d.,]+\s*[KM]?$/.test(t.trim());
  // channel: first non-numeric, non-time part (skip playlist markers)
  const cleaned = parts.filter(p => !/full playlist|^\d+ videos?$/i.test(p.text));
  const channelPart = cleaned.find(p => !isTime(p.text) && !isViewsWord(p.text) && !isCompactCount(p.text));
  const channel = channelPart?.text && !/video|playlist|mix/i.test(channelPart.text) ? channelPart.text : "";
  const channelAvatar = channelPart?.avatar || "";
  const viewsPart = cleaned.find(p => isViewsWord(p.text))?.text
    || cleaned.find(p => !isTime(p.text) && isCompactCount(p.text))?.text
    || "";
  const timePart = cleaned.find(p => isTime(p.text))?.text || "";
  const tv = img.thumbnailViewModel;
  const thumb = tv?.image?.sources?.[0]?.url || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  let duration = "";
  let is_live = false;
  const readBadge = (b: AnyObj) => {
    const t = (b.thumbnailBadgeViewModel?.text as string) || "";
    if (!t) return;
    if (/^\d+(:\d+)+/.test(t)) duration = t;
    else if (/live/i.test(t)) { is_live = true; duration = "LIVE"; }
  };
  for (const o of tv?.overlays || []) {
    for (const b of (o.thumbnailOverlayBadgeViewModel?.badges as AnyObj[] | undefined) || []) readBadge(b);
    for (const b of ((o.thumbnailBottomOverlayViewModel as AnyObj)?.badges as AnyObj[] | undefined) || []) readBadge(b);
  }
  if (isViewsWord(viewsPart) && /watching/i.test(viewsPart)) is_live = true;
  return {
    id, title, channel, channel_id: "",
    channel_thumb: channelAvatar || undefined,
    views: formatViews(viewsPart.replace(/ views| watching/i, "")),
    duration: is_live ? "LIVE" : duration,
    published: timePart,
    thumb, thumb_lg: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    is_live, shorts: false,
  };
}

function parseRichItem(ri: AnyObj): YtVideo | null {
  const content = (ri.content as AnyObj | undefined);
  if (!content) return null;
  const vr = content.videoRenderer;
  if (vr) return parseVideoRenderer(vr);
  const lv = content.lockupViewModel;
  if (lv) return parseLockup(lv);
  const gvr = content.gridVideoRenderer;
  if (gvr) return parseVideoRenderer(gvr);
  return null;
}

// Walk any section-list structure collecting videos + the continuation token.
// Token priority: the top-level sectionListRenderer continuations (the REAL
// next-page token for search/browse feeds) beats continuationItemRenderer
// tokens inside shelves (those paginate a single shelf, not the feed).
export function extractVideosAndToken(node: unknown, depth = 0): { videos: YtVideo[]; token: string | null } {
  const videos: YtVideo[] = [];
  let token: string | null = null;
  let sectionToken: string | null = null;
  const visit = (n: unknown, d: number) => {
    if (!n || typeof n !== "object" || d > 14) return;
    if (Array.isArray(n)) { for (const item of n) visit(item, d + 1); return; }
    const obj = n as AnyObj;
    if (obj.videoRenderer) { const v = parseVideoRenderer(obj.videoRenderer as AnyObj); if (v) videos.push(v); }
    else if (obj.lockupViewModel) {
      const v = parseLockup(obj.lockupViewModel as AnyObj);
      if (v) videos.push(v);
    } else if (obj.richItemRenderer) {
      const v = parseRichItem(obj.richItemRenderer as AnyObj);
      if (v) videos.push(v);
    } else if (obj.gridVideoRenderer) {
      const v = parseVideoRenderer(obj.gridVideoRenderer as AnyObj);
      if (v) videos.push(v);
    } else if (obj.continuationItemRenderer) {
      const tok = ((obj.continuationItemRenderer as AnyObj).continuationEndpoint as { continuationCommand?: { token?: string } })?.continuationCommand?.token;
      if (tok) token = tok;
    } else if (obj.sectionListRenderer) {
      // search feeds: primaryContents.sectionListRenderer.continuations
      const conts = (obj.sectionListRenderer as AnyObj).continuations as { nextContinuationData?: { continuation?: string } }[] | undefined;
      const tok = conts?.[0]?.nextContinuationData?.continuation;
      if (tok && !sectionToken) sectionToken = tok;
    } else if (obj.richGridRenderer) {
      // channel grids: richGridRenderer.continuations
      const conts = (obj.richGridRenderer as AnyObj).continuations as { nextContinuationData?: { continuation?: string } }[] | undefined;
      const tok = conts?.[0]?.nextContinuationData?.continuation;
      if (tok && !sectionToken) sectionToken = tok;
    }
    for (const k of Object.keys(obj)) {
      if (k === "videoRenderer" || k === "lockupViewModel" || k === "richItemRenderer" || k === "gridVideoRenderer" || k === "continuationItemRenderer") continue;
      visit(obj[k], d + 1);
    }
  };
  visit(node, depth);
  return { videos, token: sectionToken || token };
}

function dedupe(videos: YtVideo[]): YtVideo[] {
  const seen = new Set<string>();
  const out: YtVideo[] = [];
  for (const v of videos) {
    if (!v.id || seen.has(v.id) || !v.title) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feeds: home (search-seeded — trending browseId is dead for anonymous WEB)
// ---------------------------------------------------------------------------

const CATEGORY_QUERIES: Record<string, string> = {
  all: "trending",
  music: "popular music",
  gaming: "gaming",
  news: "breaking news today",
  movies: "full movies",
  live: "live stream",
  tech: "technology",
  sports: "sports highlights",
  learning: "learning",
  comedy: "comedy",
  podcasts: "podcast",
  cooking: "cooking",
  trailers: "movie trailer",
};

export interface ItFeedPage { videos: YtVideo[]; continuation: string | null; source: string }

const HOME_SEED_QUERIES = ["trending", "most viewed this month", "viral this week", "popular this week"];

// Home continuation tokens encode seed-chain rotation so the feed effectively
// never stalls: when one seed's results chain thins out, we rotate to the next
// seed automatically. Format: "rot:<seedIndex>:<innerToken>".
function homeCont(seedIdx: number, token: string | null | undefined): string | null {
  return token ? `rot:${seedIdx}:${token}` : null;
}
function parseHomeCont(c: string): { seedIdx: number; token: string } | null {
  const m = /^rot:(\d+):(.+)$/.exec(c);
  if (!m) return null;
  return { seedIdx: parseInt(m[1], 10), token: m[2] };
}

export async function itHome(category: string, continuation?: string): Promise<ItFeedPage> {
  const isLive = category === "live";
  const seeds = category === "all"
    ? HOME_SEED_QUERIES
    : [CATEGORY_QUERIES[category] || category || "trending"];

  // continued page: follow the active seed chain, rotate when it thins out
  if (continuation) {
    const parsed = parseHomeCont(continuation);
    if (parsed) {
      const page = await itSearchRaw(seeds[Math.min(parsed.seedIdx, seeds.length - 1)], parsed.token, "innertube:home", isLive);
      // chain still healthy? keep it
      if (page.videos.length >= 3 && page.continuation) {
        return { videos: page.videos, continuation: homeCont(parsed.seedIdx, page.continuation), source: "innertube:home" };
      }
      // chain thinned: rotate to the next seed with a fresh page
      const nextIdx = parsed.seedIdx + 1;
      if (nextIdx < seeds.length && category === "all") {
        const fresh = await itSearchRaw(seeds[nextIdx], undefined, "innertube:home", isLive);
        return {
          videos: [...page.videos, ...fresh.videos],
          continuation: homeCont(nextIdx, fresh.continuation),
          source: "innertube:home",
        };
      }
      return { videos: page.videos, continuation: homeCont(parsed.seedIdx, page.continuation), source: "innertube:home" };
    }
    // bare token (non-rot format) — direct continuation
    return itSearchRaw(seeds[0], continuation, "innertube:home", isLive);
  }

  // first page: merge several seeds so the feed feels like YouTube's mixed home
  const pages = await Promise.all(
    seeds.map(query => itSearchRaw(query, undefined, "innertube:home", isLive))
  );
  const merged: YtVideo[] = [];
  const seen = new Set<string>();
  const maxLen = Math.max(...pages.map(p => p.videos.length));
  for (let i = 0; i < maxLen; i++) {
    for (const page of pages) {
      const v = page.videos[i];
      if (v && !seen.has(v.id) && v.title) { seen.add(v.id); merged.push(v); }
    }
  }
  // continue down the FIRST seed's chain (rotation handles the rest)
  const firstCont = pages.find(p => p.continuation)?.continuation || null;
  const cont = category === "all" ? homeCont(0, firstCont) : firstCont;
  return { videos: merged, continuation: cont, source: "innertube:home" };
}

// The search pagination token: the continuationItemRenderer at the END of the
// main results section (shelves have their own tokens that paginate only that
// shelf — picking those makes feeds stall after a few thin pages).
function searchContinuationToken(json: AnyObj): string | null {
  // continued responses: appendContinuationItemsCommand.continuationItems[last]
  const cmds = (json.onResponseReceivedCommands as AnyObj[]) || [];
  for (const cmd of cmds) {
    const app = (cmd.appendContinuationItemsCommand as { continuationItems?: AnyObj[] } | undefined);
    if (app?.continuationItems?.length) {
      const last = app.continuationItems[app.continuationItems.length - 1];
      const tok = ((last?.continuationItemRenderer as AnyObj)?.continuationEndpoint as { continuationCommand?: { token?: string } })?.continuationCommand?.token;
      if (tok) return tok;
    }
  }
  // initial response: the itemSectionRenderer holding videoRenderer results
  const slr = ((json.contents as AnyObj)?.twoColumnSearchResultsRenderer as AnyObj)?.primaryContents?.sectionListRenderer as AnyObj | undefined;
  const sections = (slr?.contents as AnyObj[]) || [];
  let best: string | null = null;
  for (const sec of sections) {
    const isr = sec.itemSectionRenderer as AnyObj | undefined;
    if (!isr) continue;
    const items = (isr.contents as AnyObj[]) || [];
    const hasVideos = items.some(it => it.videoRenderer);
    const last = items[items.length - 1];
    const tok = ((last?.continuationItemRenderer as AnyObj)?.continuationEndpoint as { continuationCommand?: { token?: string } })?.continuationCommand?.token;
    if (tok && hasVideos) best = tok;
  }
  return best;
}

export async function itSearchRaw(q: string, continuation: string | null | undefined, source = "innertube:search", liveOnly = false): Promise<ItFeedPage> {
  const body: AnyObj = continuation
    ? { context: WEB_CTX, continuation }
    : { context: WEB_CTX, query: q, ...(liveOnly ? { params: "EgJAAQ==" } : {}) };
  const json = await ytPost("search", body);
  const { videos, token } = extractVideosAndToken(json);
  const better = searchContinuationToken(json);
  // YouTube sometimes "helpfully" returns an unrelated live-shelf for gibberish
  // queries — honor its own estimatedResults count for the true empty state.
  const estimated = parseInt((json.estimatedResults as string) || "", 10);
  const honest = !isNaN(estimated) && estimated === 0 ? [] : dedupe(videos);
  return { videos: honest, continuation: estimated === 0 ? null : (better || token), source };
}

// channel result from search: parse channelRenderer / lockup with channel type
function parseChannelFromSearch(json: AnyObj): YtChannelResult | null {
  let found: YtChannelResult | null = null;
  const visit = (n: unknown, d: number) => {
    if (found || !n || typeof n !== "object" || d > 14) return;
    if (Array.isArray(n)) { for (const item of n) visit(item, d + 1); return; }
    const obj = n as AnyObj;
    const cr = obj.channelRenderer as AnyObj | undefined;
    if (cr) {
      const id = cr.channelId as string;
      const name = ((cr.title as { simpleText?: string })?.simpleText) || runsText(cr.title) || "";
      if (id && name && /^UC/.test(id)) {
        found = {
          id, name,
          avatar: parseThumb((cr.thumbnail as { thumbnails?: unknown })?.thumbnails),
          subscribers: ((cr.subscriberCountText as { simpleText?: string })?.simpleText || "").replace(/subscribers?/i, "subscribers"),
          description: runsText(cr.descriptionSnippet).slice(0, 160),
          verified: /verified/i.test(JSON.stringify(cr.ownerBadges || "")),
        };
        return;
      }
    }
    for (const k of Object.keys(obj)) visit(obj[k], d + 1);
  };
  visit(json, 0);
  return found;
}

export interface ItSearchPage { videos: YtVideo[]; channel: YtChannelResult | null; continuation: string | null }

export async function itSearch(q: string): Promise<ItSearchPage> {
  const json = await ytPost("search", { context: WEB_CTX, query: q });
  const { videos, token } = extractVideosAndToken(json);
  const results = dedupe(videos);
  let channel = parseChannelFromSearch(json);
  // New search responses hide channelRenderer — derive from the first result
  if (!channel) {
    const withCh = results.find(v => v.channel_id && v.channel);
    if (withCh) channel = { id: withCh.channel_id, name: withCh.channel, avatar: "", subscribers: "", description: "", verified: false };
  }
  return { videos: results, channel, continuation: token };
}

// ---------------------------------------------------------------------------
// Watch page: next (metadata + related + comments token) + player (streams)
// ---------------------------------------------------------------------------

function parseNextMetadata(json: AnyObj): Partial<YtVideoFull> & { commentsToken?: string | null; relatedToken?: string | null } {
  const tc = (json.contents as AnyObj | undefined)?.twoColumnWatchNextResults as AnyObj | undefined;
  const results = (tc?.results as { results?: { contents?: unknown[] } } | undefined)?.results?.contents as AnyObj[] | undefined;
  let primary: AnyObj | undefined;
  let secondary: AnyObj | undefined;
  let commentsToken: string | null = null;
  for (const c of results || []) {
    if (c.videoPrimaryInfoRenderer) primary = c.videoPrimaryInfoRenderer as AnyObj;
    if (c.videoSecondaryInfoRenderer) secondary = c.videoSecondaryInfoRenderer as AnyObj;
    if (c.itemSectionRenderer) {
      const isr = c.itemSectionRenderer as AnyObj;
      if ((isr.sectionIdentifier as string) === "comment-item-section" || JSON.stringify(isr).includes("commentCount")) {
        const m = JSON.stringify(isr).match(/"token":"([^"]{20,})"/);
        if (m) commentsToken = m[1];
      }
    }
  }
  const title = runsText(primary?.title) || "";
  const vc = (primary?.viewCount as { videoViewCountRenderer?: { viewCount?: { simpleText?: string }; extraShortViewCount?: { simpleText?: string } } })?.videoViewCountRenderer;
  const viewsText = vc?.extraShortViewCount?.simpleText
    || vc?.viewCount?.simpleText
    || ((primary?.viewCountText as { simpleText?: string })?.simpleText) || runsText(primary?.viewCountText) || "";
  const dateText = ((primary?.dateText as { simpleText?: string })?.simpleText) || "";
  const likeA11y = (primary?.videoActions as unknown) || primary || {};
  let likes = 0;
  const likeMatch = /(\d[\d,.]*)\s+(?:other )?people/i.exec(JSON.stringify(likeA11y));
  if (likeMatch) {
    const num = likeMatch[1].replace(/,/g, "");
    const n = parseFloat(num);
    likes = isNaN(n) ? 0 : (num.endsWith("M") ? Math.round(n * 1e6) : num.endsWith("K") ? Math.round(n * 1e3) : Math.round(n));
  }
  const owner = (secondary?.owner as { videoOwnerRenderer?: AnyObj } | undefined)?.videoOwnerRenderer as AnyObj | undefined;
  const ownerRuns = (owner?.title as { runs?: { text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] })?.runs;
  const channel = ownerRuns?.[0]?.text || "";
  const channel_id = ownerRuns?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || "";
  const channel_thumb = parseThumb((owner?.thumbnail as { thumbnails?: unknown })?.thumbnails);
  const subs = ((owner?.subscriberCountText as { simpleText?: string })?.simpleText || runsText(owner?.subscriberCountText) || "");
  const description = ((secondary?.attributedDescription as { content?: string })?.content) || "";

  // related videos (lockupViewModel) + related continuation
  const sec = (tc?.secondaryResults as { secondaryResults?: { results?: unknown[] } } | undefined)?.secondaryResults?.results;
  const { videos: related, token: relatedToken } = extractVideosAndToken({ list: sec });

  // chapters from engagement panels (macroMarkersListItemRenderer)
  const chapters: { title: string; start: number }[] = [];
  const visitChapters = (n: unknown, d: number) => {
    if (!n || typeof n !== "object" || d > 12) return;
    if (Array.isArray(n)) { for (const item of n) visitChapters(item, d + 1); return; }
    const obj = n as AnyObj;
    if (obj.macroMarkersListItemRenderer) {
      const m = obj.macroMarkersListItemRenderer as AnyObj;
      const t = runsText(m.title);
      const timeStr = ((m.timeDescription as { simpleText?: string })?.simpleText) || "";
      const parts = timeStr.split(":").map(Number);
      let start = 0;
      if (parts.length && parts.every(p => !isNaN(p))) {
        start = parts.reduce((acc, p) => acc * 60 + p, 0);
      }
      if (t && timeStr) chapters.push({ title: t, start });
      return;
    }
    for (const k of Object.keys(obj)) visitChapters(obj[k], d + 1);
  };
  visitChapters(json.engagementPanels, 0);

  return {
    title, channel, channel_id, channel_thumb,
    channel_subs: subs.replace(/subscribers?/i, m => (m === "subscriber" ? "subscriber" : "subscribers")),
    views: formatViews(viewsText.replace(/ views|watching/i, "")),
    likes, published: dateText, description,
    related: related.slice(0, 24),
    relatedToken: relatedToken || undefined,
    commentsToken,
  } as Partial<YtVideoFull> & { commentsToken?: string | null };
}

function parsePlayerStreams(json: AnyObj): {
  ok: boolean; playability: string; reason?: string;
  formats: YtVideoFull["formats"]; hls: string | null; captions: YtCaption[];
  duration: number; views: number; title: string;
} {
  const ps = (json.playabilityStatus as { status?: string; reason?: string }) || {};
  const sd = (json.streamingData as { formats?: unknown[]; adaptiveFormats?: unknown[]; hlsManifestUrl?: string }) || {};
  const vd = (json.videoDetails as { lengthSeconds?: string; viewCount?: string; title?: string; isLiveContent?: boolean }) || {};
  const formats: YtVideoFull["formats"] = [];
  // combined (A+V in one file) detection: itag 18/22 mimes are
  // `video/mp4; codecs="avc1…, mp4a…"` — the mime says "video" only, so the
  // audio track must be sniffed from the codecs list, not the container type.
  const AUDIO_CODEC = /mp4a|opus|ac-3|ec-3|vorbis|flac/i;
  const VIDEO_CODEC = /avc1|avc3|vp9|vp09|vp8|av01|hev1|hvc1|mp4v|theora/i;
  const toFmt = (f: AnyObj) => {
    const mime = (f.mimeType as string) || "";
    const itag = (f.itag as number) || 0;
    const url = (f.url as string) || "";
    // signatureCipher URLs need deciphering we can't do on-device yet — skip
    if (!url) return;
    const codecs = /codecs="?([^"]+)"?/.exec(mime)?.[1] || "";
    formats.push({
      itag, mime, codecs,
      quality_label: (f.qualityLabel as string) || "",
      height: (f.height as number) || 0, width: (f.width as number) || 0,
      fps: (f.fps as number) || 0, bitrate: (f.bitrate as number) || 0,
      has_video: VIDEO_CODEC.test(codecs) || /video/.test(mime),
      has_audio: AUDIO_CODEC.test(codecs) || /audio/.test(mime),
      url,
    });
  };
  (sd.formats as AnyObj[] || []).forEach(toFmt);
  (sd.adaptiveFormats as AnyObj[] || []).forEach(toFmt);
  const captions: YtCaption[] = [];
  const tracks = ((json.captions as { playerCaptionsTracklistRenderer?: { captionTracks?: AnyObj[] } })?.playerCaptionsTracklistRenderer?.captionTracks) || [];
  for (const t of tracks) {
    const url = (t.baseUrl as string) || "";
    if (url) captions.push({
      lang: (t.languageCode as string) || "",
      name: ((t.name as { simpleText?: string })?.simpleText) || runsText(t.name) || (t.languageCode as string) || "",
      url: url.startsWith("http") ? url : `${IT_HOST}${url}`,
    });
  }
  return {
    ok: ps.status === "OK" && (!!sd.hlsManifestUrl || formats.length > 0),
    playability: ps.status || "UNKNOWN",
    reason: ps.reason,
    formats, hls: sd.hlsManifestUrl || null, captions,
    duration: parseInt(vd.lengthSeconds || "0", 10) || 0,
    views: parseInt(vd.viewCount || "0", 10) || 0,
    title: vd.title || "",
  };
}

export interface ItVideoResult extends YtVideoFull {
  playability_reason?: string | null;
  embed_blocked?: boolean;
  unavailable?: boolean;
  relatedToken?: string | null;
  commentsToken?: string | null;
}

export async function itVideo(id: string): Promise<ItVideoResult> {
  const base: ItVideoResult = {
    id, ok: true, embed_fallback: true,
    title: "", channel: "", channel_id: "", channel_thumb: "",
    views: 0, likes: 0, duration: 0, published: "", description: "",
    formats: [], hls: null, captions: [], storyboard: null, related: [], chapters: [],
  };
  // next() first — always works, gives metadata + related even when gated.
  // The response also carries the session's visitorData, which we reuse for
  // the TV player attempt (session continuity defeats a chunk of the
  // "confirm you're not a bot" gating).
  let nextMeta: ReturnType<typeof parseNextMetadata> = {};
  let visitorData: string | undefined;
  try {
    const nextJson = await ytPost("next", { context: WEB_CTX, videoId: id });
    nextMeta = parseNextMetadata(nextJson);
    visitorData = (nextJson.responseContext as { visitorData?: string } | undefined)?.visitorData || undefined;
  } catch { /* metadata optional */ }

  if (nextMeta.channel_id && nextMeta.channel_thumb) {
    rememberAvatar(nextMeta.channel_id as string, nextMeta.channel_thumb as string);
  }

  // --- player attempt 1: ANDROID_VR (direct streams, no PO token needed).
  // Its playability verdict is the source of truth for flags (blocked /
  // unavailable / bot-gated) — later attempts only try to *recover* streams.
  let streams: ReturnType<typeof parsePlayerStreams> | null = null;
  let playability_reason: string | null = null;
  let embed_blocked = false;
  let unavailable = false;
  try {
    const playerJson = await ytPost("player", { context: VR_CTX, videoId: id, contentCheckOk: true, racyCheckOk: true }, ANDROID_KEY);
    streams = parsePlayerStreams(playerJson);
    playability_reason = streams.reason || null;
    if (streams.playability === "ERROR" && /blocked it from display on this website|embed/i.test(streams.reason || "")) embed_blocked = true;
    if (streams.playability === "ERROR" || streams.playability === "UNPLAYABLE") unavailable = true;
    if (streams.playability === "LIVE_STREAM_OFFLINE") unavailable = true;
  } catch { /* try TV below */ }

  // --- player attempt 2 (recovery, only when gated / no streams):
  // TVHTML5 + visitorData. On gated IPs this often still returns streams;
  // when it succeeds we keep attempt 1's flags but use its streams.
  if (!streams?.ok) {
    try {
      const tvJson = await ytPost("player", { context: tvCtx(visitorData), videoId: id, contentCheckOk: true, racyCheckOk: true }, WEB_KEY);
      const tvStreams = parsePlayerStreams(tvJson);
      if (tvStreams.ok && (tvStreams.hls || tvStreams.formats.length > 0)) {
        streams = {
          ...tvStreams,
          // prefer whichever attempt produced captions/duration/views
          captions: tvStreams.captions.length ? tvStreams.captions : (streams?.captions || []),
          duration: tvStreams.duration || streams?.duration || 0,
          views: tvStreams.views || streams?.views || 0,
        };
        playability_reason = null; // recovered: the video IS playable
        unavailable = false;
      }
    } catch { /* embed fallback */ }
  }

  const title = nextMeta.title || streams?.title || "";
  const views = nextMeta.views || (streams && streams.views ? formatViews(streams.views) : 0);

  // A direct stream is only actually playable by our <video>/hls.js stack if
  // there is an HLS manifest or at least one combined (A+V) format. Anything
  // else (adaptive-only, ciphered-only) degrades to the official embed player,
  // which always plays — same mechanism the Shorts feed uses.
  const directPlayable = !!streams?.ok && (!!streams.hls || streams.formats.some(f => f.has_video && f.has_audio));

  const result: ItVideoResult = {
    ...base,
    ...nextMeta,
    thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    thumb_lg: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    title,
    channel: nextMeta.channel || "",
    channel_id: nextMeta.channel_id || "",
    channel_thumb: nextMeta.channel_thumb || "",
    channel_subs: nextMeta.channel_subs || "",
    views,
    likes: nextMeta.likes || 0,
    duration: streams?.duration || 0,
    published: nextMeta.published || "",
    description: nextMeta.description || "",
    formats: streams?.formats || [],
    hls: streams?.hls || null,
    captions: streams?.captions || [],
    related: nextMeta.related || [],
    chapters: (nextMeta.chapters as never[]) || [],
    relatedToken: nextMeta.relatedToken ?? null,
    commentsToken: nextMeta.commentsToken ?? null,
    embed_fallback: !directPlayable, // no directly playable stream → embed plays it
    playability_reason,
    embed_blocked,
    unavailable: unavailable && !title,
    is_live: streams?.formats.some(f => /live/i.test(f.quality_label)) || undefined,
  };
  // unavailable = hard error even with no metadata
  if (unavailable && !title && !streams?.title) {
    return { ...result, ok: false, playability_reason: playability_reason || "This video is unavailable" };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function itComments(id: string, sort: "top" | "new" = "top"): Promise<{ comments: YtComment[]; count: number | null; token: string | null }> {
  // get token from next()
  const nextJson = await ytPost("next", { context: WEB_CTX, videoId: id });
  let token: string | null = null;
  let count: number | null = null;
  const visit = (n: unknown, d: number) => {
    if (!n || typeof n !== "object" || d > 14) return;
    if (Array.isArray(n)) { for (const item of n) visit(item, d + 1); return; }
    const obj = n as AnyObj;
    if (obj.commentCount && !count) count = parseCountLike(obj.commentCount);
    const isr = obj.itemSectionRenderer as AnyObj | undefined;
    if (isr && isr.sectionIdentifier === "comment-item-section") {
      const m = JSON.stringify(isr).match(/"token":"([^"]{20,})"/);
      if (m) token = m[1];
    }
    for (const k of Object.keys(obj)) visit(obj[k], d + 1);
  };
  visit(nextJson, 0);
  if (!token) return { comments: [], count, token: null };
  return itCommentsContinue(token, sort);
}

function parseCountLike(x: unknown): number | null {
  const s = typeof x === "string" ? x : ((x as { text?: string })?.text) || "";
  const m = /([\d,.]+)\s*(K|M|B|million|billion|thousand)?/i.exec(s.replace(/,/g, ","));
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return null;
  const suffix = (m[2] || "").toLowerCase();
  if (/k|thousand/.test(suffix)) return Math.round(n * 1e3);
  if (/m|million/.test(suffix)) return Math.round(n * 1e6);
  if (/b|billion/.test(suffix)) return Math.round(n * 1e9);
  return Math.round(n);
}

export async function itCommentsContinue(token: string, _sort: "top" | "new" = "top"): Promise<{ comments: YtComment[]; count: number | null; token: string | null }> {
  const json = await ytPost("next", { context: WEB_CTX, continuation: token });
  const s = JSON.stringify(json);
  const comments: YtComment[] = [];

  // New format: commentEntityPayload keyed by id in frameworkUpdates
  const fu = (json.frameworkUpdates as { entityBatchUpdate?: { mutations?: { payload?: { commentEntityPayload?: AnyObj } }[] } } | undefined);
  const mutations = fu?.entityBatchUpdate?.mutations || [];
  const payloads = mutations.map(m => (m.payload as { commentEntityPayload?: AnyObj } | undefined)?.commentEntityPayload).filter(Boolean) as AnyObj[];

  // Old format: commentThreadRenderer / commentRenderer
  const legacyComments: YtComment[] = [];
  const visitLegacy = (n: unknown, d: number) => {
    if (!n || typeof n !== "object" || d > 14) return;
    if (Array.isArray(n)) { for (const item of n) visitLegacy(item, d + 1); return; }
    const obj = n as AnyObj;
    if (obj.commentRenderer) {
      const cr = obj.commentRenderer as AnyObj;
      legacyComments.push({
        author: runsText(cr.authorText) || ((cr.authorText as { simpleText?: string })?.simpleText) || "",
        author_id: "",
        author_thumb: parseThumb((cr.authorThumbnail as { thumbnails?: unknown })?.thumbnails),
        text: ((cr.contentText as unknown) && runsText(cr.contentText)) || "",
        likes: parseInt(((cr.voteCount as { simpleText?: string })?.simpleText || "0").replace(/[,.]/g, ""), 10) || parseCountLike(cr.voteCount) || 0,
        time: ((cr.publishedTimeText as { simpleText?: string })?.simpleText) || runsText(cr.publishedTimeText) || "",
        replies: parseInt(((cr.replyCount as number) || 0).toString(), 10) || 0,
        creator_heart: !!cr.creatorHeart,
      });
      return;
    }
    for (const k of Object.keys(obj)) visitLegacy(obj[k], d + 1);
  };
  visitLegacy(json, 0);

  if (payloads.length > 0) {
    for (const p of payloads) {
      const author = (p.author as { displayName?: string } | undefined)?.displayName || "";
      const avatar = (p.author as AnyObj | undefined)?.avatarImageUrl as string | undefined;
      const text = ((p.properties as { content?: { content?: string } })?.content?.content) || "";
      const time = ((p.properties as { publishedTime?: string })?.publishedTime) || "";
      const toolbar = JSON.stringify(p.toolbar || {});
      const likes = parseCountLike((JSON.parse(toolbar) as { likeCountNotliked?: string })?.likeCountNotliked) || 0;
      const replies = parseCountLike((JSON.parse(toolbar) as { replyCount?: string })?.replyCount) || 0;
      comments.push({
        author, author_id: "", author_thumb: avatar || "",
        text, likes, time, replies,
        creator_heart: false,
      });
    }
  }
  const final = comments.length ? comments : legacyComments;

  // next continuation token (append/load more)
  let nextToken: string | null = null;
  const m = s.match(/"continuationCommand":\{"token":"([^"]{20,})"[^}]*\}/g);
  const lastCont = m && m.length ? m[m.length - 1] : null;
  if (lastCont) {
    const tok = /"token":"([^"]{20,})"/.exec(lastCont)?.[1];
    if (tok) nextToken = tok;
  }
  return { comments: final, count: null, token: nextToken };
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------


export async function itChannel(id: string): Promise<YtChannel & { continuation: string | null }> {
  const json = await ytPost("browse", { context: WEB_CTX, browseId: id, params: "EgZ2aWRlb3nyBgQKAjoA" });
  const metadata = ((json.metadata as { channelMetadataRenderer?: AnyObj })?.channelMetadataRenderer) || {};
  const headerJson = JSON.stringify(json.header || {});
  const fullJson = JSON.stringify(json);
  const amp = String.fromCharCode(38); // "&" — avoids backslash-escape soup
  const avatarUrl = (() => {
    const t = parseThumb((metadata.avatar as { thumbnails?: unknown })?.thumbnails);
    if (t) return t;
    const m = /https:\/\/yt3\.ggpht\.com\/[^"\s]+/.exec(headerJson);
    return m ? m[0].split(String.fromCharCode(92) + "u0026").join(amp) : "";
  })();
  const name = (metadata.title as string) || (() => {
    const m = /"title":\{"content":"([^"]+)"\}/.exec(headerJson) || /"pageTitle":"([^"]+)"/.exec(headerJson);
    return m ? m[1] : "";
  })();
  const description = (metadata.description as string) || "";
  const bannerUrl = (() => {
    const og = (metadata.ogImage as string) || "";
    if (/yt3\.(?:ggpht|googleusercontent)\.com/.test(og)) return og;
    const m = /https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\/[^"\s]*(?:banner|fxj|fJ|w1067|w1707|fcrop)[^"\s]*/.exec(fullJson);
    return m ? m[0].split(String.fromCharCode(92) + "u0026").join(amp) : "";
  })();
  const subs = (() => {
    const m = /"content":"([\d.,]+[KM]?) subscribers"/.exec(headerJson) ||
      /"subscriberCountText":\{[^}]*"simpleText":"([^"]+)"/.exec(fullJson);
    return m ? `${m[1]} subscribers` : "";
  })();
  const { videos, token } = extractVideosAndToken(json);
  if (id && avatarUrl) rememberAvatar(id, avatarUrl);
  return {
    id, name, description, avatar: avatarUrl, banner: bannerUrl, subscribers: subs,
    videos: dedupe(videos).slice(0, 60),
    continuation: token,
  };
}

export async function itChannelContinue(token: string): Promise<ItFeedPage> {
  const json = await ytPost("browse", { context: WEB_CTX, continuation: token });
  const { videos, token: nextToken } = extractVideosAndToken(json);
  return { videos: dedupe(videos), continuation: nextToken, source: "innertube:channel" };
}

// ---------------------------------------------------------------------------
// Shorts feed — search-seeded shortsLockupViewModel parsing (vertical feed)
// ---------------------------------------------------------------------------

export interface YtShort {
  id: string;
  title: string;
  views: string;
}

function parseShortsLockup(sl: AnyObj): YtShort | null {
  const reel = (sl.onTap as { innertubeCommand?: { reelWatchEndpoint?: { videoId?: string } } })?.innertubeCommand?.reelWatchEndpoint;
  const id = (reel?.videoId as string) || (sl.contentId as string) || "";
  if (!id) return null;
  // accessibilityText: "Title, 4.1 million views - play Short"
  const a11y = (sl.accessibilityText as string) || "";
  let title = a11y;
  let views = "";
  const m = /^(.*),\s*([\d.,]+\s*(?:million|billion|thousand|[KM])?\s*views?)\s*-\s*play Short$/i.exec(a11y);
  if (m) {
    title = m[1].trim();
    views = formatViews(m[2].replace(/views?/i, "").replace(/\s+/g, "").replace(/million/i, "M").replace(/billion/i, "B").replace(/thousand/i, "K"));
  }
  return { id, title, views };
}

const SHORTS_SEEDS = ["funny shorts", "shorts", "viral shorts", "amazing shorts", "comedy shorts"];

function extractShorts(node: unknown): { shorts: YtShort[]; token: string | null } {
  const shorts: YtShort[] = [];
  let token: string | null = null;
  const visit = (n: unknown, d: number) => {
    if (!n || typeof n !== "object" || d > 14) return;
    if (Array.isArray(n)) { for (const item of n) visit(item, d + 1); return; }
    const obj = n as AnyObj;
    if (obj.shortsLockupViewModel) {
      const s = parseShortsLockup(obj.shortsLockupViewModel as AnyObj);
      if (s) shorts.push(s);
      return;
    } else if (obj.continuationItemRenderer) {
      const tok = ((obj.continuationItemRenderer as AnyObj).continuationEndpoint as { continuationCommand?: { token?: string } })?.continuationCommand?.token;
      if (tok) token = tok;
    } else if (obj.sectionListRenderer) {
      const conts = (obj.sectionListRenderer as AnyObj).continuations as { nextContinuationData?: { continuation?: string } }[] | undefined;
      const tok = conts?.[0]?.nextContinuationData?.continuation;
      if (tok) token = tok;
    }
    for (const k of Object.keys(obj)) visit(obj[k], d + 1);
  };
  visit(node, 0);
  return { shorts, token };
}

export async function itShortsFeed(continuation?: string): Promise<{ shorts: YtShort[]; continuation: string | null }> {
  // continued: follow whichever seed the token belongs to (bare token)
  if (continuation) {
    const json = await ytPost("search", { context: WEB_CTX, continuation });
    const { shorts, token } = extractShorts(json);
    const better = searchContinuationToken(json);
    return { shorts, continuation: better || token };
  }
  const pages = await Promise.all(
    SHORTS_SEEDS.slice(0, 3).map(q => ytPost("search", { context: WEB_CTX, query: q }))
  );
  const merged: YtShort[] = [];
  const seen = new Set<string>();
  let token: string | null = null;
  for (const json of pages) {
    const { shorts, token: t } = extractShorts(json);
    const better = searchContinuationToken(json);
    if (!token && (better || t)) token = better || t;
    for (const s of shorts) {
      if (!seen.has(s.id) && s.title) { seen.add(s.id); merged.push(s); }
    }
  }
  return { shorts: merged, continuation: token };
}

/**
 * Validate short IDs via YouTube oEmbed (returns the set of PLAYABLE ids).
 * Dead/private/embed-blocked videos return non-200 → they get dropped so the
 * feed never opens on an "unavailable" card. Native: CapacitorHttp direct
 * (no CORS). Web/dev: relayed through /api/ytb-oembed.
 * Best-effort: on any transport failure the id is assumed valid.
 */
export async function itValidateShorts(ids: string[]): Promise<Set<string>> {
  const valid = new Set(ids);
  await Promise.all(ids.map(async id => {
    try {
      if (isNativeApp()) {
        const { CapacitorHttp } = await import("@capacitor/core");
        const res = await CapacitorHttp.get({
          url: `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
          connectTimeout: 6000,
          readTimeout: 8000,
        });
        if (res.status < 200 || res.status >= 300) valid.delete(id);
      } else {
        if (!(await probeRelay())) return;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(`/api/ytb-oembed?XTransformPort=3001&id=${encodeURIComponent(id)}`, { signal: ctrl.signal });
          const json = await res.json().catch(() => null) as { ok?: boolean } | null;
          if (json && json.ok === false) valid.delete(id);
        } finally { clearTimeout(timer); }
      }
    } catch { /* assume valid */ }
  }));
  return valid;
}
