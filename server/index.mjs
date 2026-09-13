// ============================================================================
// yt-api — Ad-free YouTube API Gateway
// Architecture: youtubei.js v18 + bgutil PO tokens + HLS/stream proxy
//   - Metadata: WEB client (richest: related, chapters, storyboards, captions)
//   - Streams:  IOS client (direct URLs up to 4K + HLS manifest)
//   - Playback: all bytes proxied through /api/segment (CORS-free, IP-lock-free)
// ============================================================================
import express from 'express';
import path from 'node:path';
import { Innertube } from 'youtubei.js';

const PORT = process.env.PORT || 3001;
const BGUTIL_URL = process.env.BGUTIL_URL || 'http://127.0.0.1:4416';
const PUBLIC_URL = process.env.PUBLIC_URL || ''; // e.g. https://api.example.com (for absolute URLs; empty = relative)
const YOUTUBE_COOKIE = process.env.YOUTUBE_COOKIE || '';
// Optional: serve a static frontend build (Electron desktop app mode).
// When set (e.g. STATIC_DIR=../out), yt-api also hosts the web UI on its own port,
// making the desktop app fully self-contained on http://127.0.0.1:<PORT>.
const STATIC_DIR = process.env.STATIC_DIR || '';
// Suffix appended to every proxied URL.
// Default "&XTransformPort=3001" routes through the sandbox gateway (Caddy) to this service.
// In production set URL_SUFFIX="" (empty) when serving from a real domain, or PUBLIC_URL=https://api.example.com
const URL_SUFFIX = process.env.URL_SUFFIX !== undefined ? process.env.URL_SUFFIX : '&XTransformPort=3001';
const REQUEST_TIMEOUT_MS = 15000;

const log = (...a) => console.log(`[yt-api]`, ...a);
const warn = (...a) => console.warn(`[yt-api]`, ...a);

// ----------------------------------------------------------------------------
// TTL cache with request coalescing
// ----------------------------------------------------------------------------
class TTLCache {
  constructor() { this.map = new Map(); this.inflight = new Map(); }
  get(key) { const e = this.map.get(key); if (e && e.exp > Date.now()) return e.val; this.map.delete(key); return undefined; }
  set(key, val, ttlMs) { this.map.set(key, { val, exp: Date.now() + ttlMs }); }
  async wrap(key, ttlMs, fn) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try {
        const val = await fn();
        this.set(key, val, ttlMs);
        return val;
      } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }
  get size() { return this.map.size; }
}
const cache = new TTLCache();

// ----------------------------------------------------------------------------
// PO token manager (bgutil v2: POST /get_pot -> {contentBinding, poToken, expiresAt})
// ----------------------------------------------------------------------------
const tokenState = { visitorData: null, poToken: null, expiresAt: 0 };

async function refreshToken() {
  if (tokenState.poToken && tokenState.expiresAt - Date.now() > 30 * 60 * 1000) return tokenState;
  try {
    const r = await fetch(`${BGUTIL_URL}/get_pot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(30000)
    });
    if (!r.ok) throw new Error(`bgutil responded ${r.status}`);
    const sd = await r.json();
    if (!sd.poToken || !sd.contentBinding) throw new Error('bgutil returned incomplete session data');
    tokenState.visitorData = sd.contentBinding;
    tokenState.poToken = sd.poToken;
    tokenState.expiresAt = new Date(sd.expiresAt || (Date.now() + 5 * 3600 * 1000)).getTime();
    log('PO token refreshed; expires', new Date(tokenState.expiresAt).toISOString());
  } catch (e) {
    warn('PO token refresh failed:', e.message, '— continuing without token');
    tokenState.visitorData = null; tokenState.poToken = null; tokenState.expiresAt = Date.now() + 60_000;
  }
  return tokenState;
}

// ----------------------------------------------------------------------------
// Innertube session pool with rotation
// ----------------------------------------------------------------------------
class SessionPool {
  constructor() { this.sessions = []; this.lock = null; }
  async get(index = 0) {
    while (this.sessions.length <= index) {
      await this._create();
    }
    return this.sessions[index];
  }
  async _create() {
    await refreshToken();
    const opts = {
      visitor_data: tokenState.visitorData || undefined,
      po_token: tokenState.poToken || undefined,
      retrieve_player: true,
      generate_session_locally: false,
    };
    if (YOUTUBE_COOKIE) opts.cookie = YOUTUBE_COOKIE;
    const yt = await Innertube.create(opts);
    this.sessions.push(yt);
    log(`session #${this.sessions.length - 1} created (visitor ${String(tokenState.visitorData || '').slice(0, 16)}...)`);
    return yt;
  }
  async rotate() {
    // drop the oldest session; a fresh one is created on next get()
    this.sessions.shift();
    log('session rotated; pool size now', this.sessions.length);
  }
  async withRetry(fn, { attempts = 3, label = 'call' } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      let yt;
      try { yt = await this.get(0); } catch (e) { lastErr = e; warn(`${label}: session create failed:`, e.message); await new Promise(r => setTimeout(r, 800)); continue; }
      try {
        return await fn(yt);
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || e);
        const retryable = /403|429|Sign in to confirm|LOGIN_REQUIRED|detected odd traffic|Too many requests|fetch failed|ECONNRESET|ETIMEDOUT|502|503/i.test(msg);
        warn(`${label}: attempt ${i + 1} failed: ${msg.slice(0, 140)}${retryable ? ' (retrying with rotated session)' : ' (not retryable)'}`);
        if (!retryable) throw e;
        await this.rotate();
        await new Promise(r => setTimeout(r, 600 + i * 700));
      }
    }
    throw lastErr || new Error('all attempts failed');
  }
}
const pool = new SessionPool();

// ----------------------------------------------------------------------------
// Helpers: normalize video objects from various youtubei.js shapes
// ----------------------------------------------------------------------------
function normalizeVideo(v) {
  if (!v) return null;
  // Standard video node (search/feed results)
  const id = v.id || v.video_id || v.videoId;
  if (id) {
    const title = v.title?.text ?? v.title?.toString?.() ?? (typeof v.title === 'string' ? v.title : '');
    const author = v.author?.name ?? v.author?.text ?? v.author?.toString?.() ?? (typeof v.author === 'string' ? v.author : '');
    const views = (v.view_count?.text ?? v.short_view_count?.text ?? (typeof v.view_count === 'string' ? v.view_count : '')) || '';
    const lengthText = (v.length_text?.text ?? v.duration?.text ?? '') || '';
    const published = (v.published?.text ?? v.published_time?.text ?? (typeof v.published === 'string' ? v.published : '')) || '';
    return {
      id,
      title: String(title).trim(),
      channel: String(author).trim(),
      channel_id: v.author?.id || v.channel_id || v.channelId || '',
      views: String(views),
      duration: String(lengthText),
      published: String(published),
      thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      thumb_lg: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      is_live: !!(v.is_live || /watching now/i.test(String(views))),
      shorts: !!(v.is_short),
    };
  }
  // LockupView (channel grid / new layouts)
  if (v.content_id && v.content_type === 'VIDEO') {
    const md = v.metadata;
    let views = '', published = '', extra = '';
    try {
      const rows = md?.metadata?.metadata_rows || [];
      const parts = rows.flatMap(r => (r.metadata_parts || []).map(p => String(p?.text?.text || p?.text || ''))).filter(Boolean);
      views = parts.find(p => /view|watching/i.test(p)) || '';
      published = parts.find(p => /ago|hour|minute|day|week|month|year|streamed|premiere/i.test(p)) || '';
      extra = parts.filter(p => p !== views && p !== published).join(' · ');
    } catch { /* noop */ }
    let thumb = '';
    try { thumb = v.content_image?.image?.[0]?.url || ''; } catch { /* noop */ }
    return {
      id: v.content_id,
      title: String(md?.title?.text || md?.title || '').trim(),
      channel: '',
      channel_id: '',
      views: String(views),
      duration: String(extra && /^\d/.test(extra) ? extra : ''),
      published: String(published),
      thumb: thumb || `https://i.ytimg.com/vi/${v.content_id}/mqdefault.jpg`,
      thumb_lg: `https://i.ytimg.com/vi/${v.content_id}/hqdefault.jpg`,
      is_live: /watching now/i.test(views),
      shorts: false,
    };
  }
  return null;
}

function parseDuration(text) {
  if (!text) return 0;
  if (/^\d+$/.test(String(text))) return parseInt(text);
  const m = String(text).match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return (parseInt(m[1] || '0')) * 3600 + parseInt(m[2] || '0') * 60 + parseInt(m[3] || '0');
}

function safeVideos(feed, limit = 40) {
  let raw = [];
  try {
    if (Array.isArray(feed?.videos)) raw = feed.videos;
    else if (Array.isArray(feed)) raw = feed;
    else if (feed?.contents) raw = feed.contents;
  } catch { /* noop */ }
  const seen = new Set();
  return raw.map(normalizeVideo).filter(Boolean)
    .filter(v => !v.shorts)
    .filter(v => { if (seen.has(v.id)) return false; seen.add(v.id); return true; })
    .slice(0, limit);
}

// ----------------------------------------------------------------------------
// Data access layer
// ----------------------------------------------------------------------------
const CATEGORY_QUERIES = {
  all: 'trending videos',
  music: 'popular music videos',
  gaming: 'gaming videos',
  news: 'breaking news today',
  movies: 'full movies',
  live: 'live stream',
  tech: 'technology',
  sports: 'sports highlights',
  learning: 'educational videos',
  comedy: 'comedy videos',
  podcasts: 'podcast full episodes',
  cooking: 'cooking recipes',
  trailers: 'movie trailers',
};

async function doSearch(query, { type = 'video', limit = 30, duration, uploadDate } = {}) {
  // NOTE: we intentionally do NOT filter by type — an unfiltered search returns
  // videos AND channel/shorts nodes, letting us render YouTube's channel result card.
  const filters = {};
  if (duration && duration !== 'all') filters.duration = duration;
  if (uploadDate && uploadDate !== 'all') filters.upload_date = uploadDate;
  const key = `search:${query}:${duration || ''}:${uploadDate || ''}`;
  return cache.wrap(key, 30 * 60 * 1000, async () => {
    const res = await pool.withRetry(async yt => {
      const r = await yt.search(query, Object.keys(filters).length ? filters : undefined);
      return r;
    }, { label: `search "${query}"` });
    let vids = safeVideos(res, limit);
    // search sometimes returns shorts/other nodes in .videos; also grab shorts if user asked
    if (vids.length === 0 && res?.contents) {
      vids = safeVideos(res.contents, limit);
    }
    // channel result card (YouTube shows the matching channel at top)
    let channel = null;
    try {
      const ch = (res.channels || [])[0];
      if (ch) {
        channel = {
          id: ch.id,
          name: String(ch.author?.name || ch.author?.text || ch.title || ''),
          avatar: (c0 => c0 ? (c0.startsWith('//') ? 'https:' + c0 : c0) : '')(ch.author?.best_thumbnail?.url || ch.author?.thumbnails?.[0]?.url || ''),
          subscribers: String(ch.subscriber_count?.text || ''),
          description: String(ch.description_snippet?.text || ch.description_snippet || '').slice(0, 160),
          verified: !!ch.verified,
        };
      }
    } catch { /* noop */ }
    return { query, channel, results: vids };
  });
}

async function getHome(category = 'all') {
  const key = `home:${category}`;
  return cache.wrap(key, 30 * 60 * 1000, async () => {
    // Primary: real home feed
    if (category === 'all') {
      try {
        const hf = await pool.withRetry(async yt => await yt.getHomeFeed(), { label: 'homeFeed' });
        const vids = safeVideos(hf, 40);
        if (vids.length >= 8) return { category, source: 'homefeed', results: vids };
      } catch (e) { warn('homeFeed failed, using category search fallback:', e.message); }
    }
    const q = CATEGORY_QUERIES[category] || category;
    const { results } = await doSearch(q, { limit: 32 });
    return { category, source: 'search', results };
  });
}

// oEmbed fallback (always keyless, no gating)
async function getOEmbed(id) {
  return cache.wrap(`oembed:${id}`, 6 * 3600 * 1000, async () => {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { title: j.title, author: j.author_name, author_url: j.author_url, thumb: j.thumbnail_url };
  });
}

function proxied(url) {
  if (!url) return null;
  const b64 = Buffer.from(String(url)).toString('base64url');
  return `${PUBLIC_URL}/api/segment?u=${b64}${URL_SUFFIX}`;
}

function normalizeFormats(streamingData) {
  const out = [];
  const all = [...(streamingData?.adaptive_formats || []), ...(streamingData?.formats || [])];
  for (const f of all) {
    if (!f.url) continue;
    out.push({
      itag: f.itag,
      mime: (f.mime_type || '').split(';')[0],
      codecs: (f.mime_type || '').split('codecs="')[1]?.split('"')[0] || '',
      quality_label: f.quality_label || f.quality || '',
      height: f.height || 0,
      width: f.width || 0,
      fps: f.fps || 0,
      bitrate: f.bitrate || f.average_bitrate || 0,
      has_video: !!f.has_video,
      has_audio: !!f.has_audio,
      duration: f.duration_ms ? Math.round(f.duration_ms / 1000) : 0,
      url: proxied(f.url),
    });
  }
  return out;
}

function normalizeCaptions(info) {
  try {
    const tracks = info.captions?.caption_tracks || [];
    return tracks.map(t => ({
      lang: t.language_code || t.lang_code || 'en',
      name: t.name?.toString?.() || t.name || t.language_code || '',
      url: proxied(`${String(t.base_url || '')}&fmt=vtt`),
    })).filter(t => t.url);
  } catch { return []; }
}

function normalizeStoryboard(info) {
  try {
    const specs = info.storyboards?.boards || [];
    if (!specs.length) return null;
    // prefer a medium-detail board (like YouTube's seek preview)
    const b = specs[Math.min(2, specs.length - 1)] || specs[specs.length - 1];
    return {
      width: b.width, height: b.height,
      columns: b.columns, rows: b.rows,
      interval: b.interval,
      template_url: proxied(b.template_url?.replace('$M$', '0')),
      templateUrlPattern: b.template_url,
    };
  } catch { return null; }
}

async function getVideoFull(id) {
  return cache.wrap(`video:${id}`, 60 * 60 * 1000, async () => {
    const result = {
      id,
      ok: false, embed_fallback: false,
      title: '', channel: '', channel_id: '', channel_thumb: '',
      views: 0, likes: 0, duration: 0, published: '', description: '',
      formats: [], hls: null, captions: [], storyboard: null, related: [],
      chapters: [], keywords: [],
    };

    let webInfo = null;
    try {
      webInfo = await pool.withRetry(async yt => await yt.getInfo(id, { client: 'WEB' }), { label: `getInfo WEB ${id}` });
    } catch (e) { warn(`WEB getInfo failed for ${id}:`, String(e.message).slice(0, 120)); }

    const playable = webInfo && webInfo.playability_status?.status === 'OK';

    // --- metadata: primary_info/secondary_info (from watch page; works even when player is gated) ---
    const pi = webInfo?.primary_info, si = webInfo?.secondary_info;
    if (pi?.title?.text) result.title = String(pi.title.text).trim();
    try {
      const vc = pi?.view_count;
      const viewsText = vc?.short_view_count?.text || vc?.view_count?.text || '';
      const viewsNum = vc?.original_view_count;
      if (viewsNum) result.views = viewsNum;
      else if (viewsText) result.views = String(viewsText).replace(/ views/i, '');
      if (vc?.is_live) result.is_live = true;
    } catch { /* noop */ }
    if (pi?.published?.text) result.published = String(pi.published.text).trim();
    const owner = si?.owner?.author;
    if (owner?.name) result.channel = String(owner.name).trim();
    if (owner?.id) result.channel_id = String(owner.id);
    result.channel_thumb = owner?.best_thumbnail?.url || owner?.thumbnails?.[0]?.url || result.channel_thumb || '';
    if (si?.owner?.subscriber_count?.text) result.channel_subs = String(si.owner.subscriber_count.text);
    if (si?.description?.text) result.description = String(si.description.text);
    else if (si?.description_placeholder?.text) result.description = String(si.description_placeholder.text);
    if (webInfo?.basic_info?.duration) result.duration = webInfo.basic_info.duration;
    if (!result.duration && pi?.length_text?.text) result.duration = parseDuration(String(pi.length_text.text));
    try { result.likes = webInfo?.likes ?? pi?.like_count ?? 0; } catch { result.likes = 0; }
    if (playable) {
      try {
        result.chapters = (webInfo.chapters || []).map(c => ({ title: String(c.title || ''), start: c.start || c.start_seconds || 0 }));
      } catch {}
      try {
        result.captions = normalizeCaptions(webInfo);
        result.storyboard = normalizeStoryboard(webInfo);
      } catch {}
    } else {
      // walled video — oEmbed metadata fallback
      if (!result.title || !result.channel) {
        const oe = await getOEmbed(id);
        if (oe) {
          result.title = oe.title || result.title;
          result.channel = oe.author || result.channel;
          result.author_url = oe.author_url || '';
        }
      }
    }

    // --- related (watch-next; available even for gated videos) ---
    if (webInfo) {
      try {
        const wn = webInfo.watch_next_feed;
        if (Array.isArray(wn)) result.related = wn.map(normalizeVideo).filter(Boolean).slice(0, 20);
      } catch (e) { warn('watch_next_feed failed:', String(e.message).slice(0, 100)); }
    }
    if (result.related.length === 0 && result.title) {
      try {
        const seed = result.title.split(/\s+/).slice(0, 4).join(' ');
        const { results } = await doSearch(seed || 'recommended videos', { limit: 20 });
        result.related = results.filter(v => v.id !== id);
      } catch { /* keep empty */ }
    }

    // --- streams: IOS client (direct URLs + HLS) ---
    let iosInfo = null;
    try {
      iosInfo = await pool.withRetry(async yt => await yt.getInfo(id, { client: 'IOS' }), { label: `getInfo IOS ${id}`, attempts: 2 });
    } catch (e) { warn(`IOS getInfo failed for ${id}:`, String(e.message).slice(0, 120)); }

    const iosPlayable = iosInfo && iosInfo.playability_status?.status === 'OK' && iosInfo.streaming_data;
    if (iosPlayable) {
      result.formats = normalizeFormats(iosInfo.streaming_data);
      const hlsUrl = iosInfo.streaming_data.hls_manifest_url;
      if (hlsUrl) result.hls = `${PUBLIC_URL}/api/hls/${id}`;
      result.ok = true;
      if (!result.title) result.title = String(iosInfo.basic_info?.title || '').trim();
      if (!result.duration) result.duration = iosInfo.basic_info?.duration || 0;
    } else {
      // ANDROID combined fallback (360p)
      try {
        const andInfo = await pool.withRetry(async yt => await yt.getInfo(id, { client: 'ANDROID' }), { label: `getInfo ANDROID ${id}`, attempts: 2 });
        if (andInfo?.playability_status?.status === 'OK' && andInfo.streaming_data) {
          result.formats = normalizeFormats(andInfo.streaming_data);
          result.ok = result.formats.length > 0;
        }
      } catch { /* noop */ }
    }

    if (!result.ok) result.embed_fallback = true; // frontend will use IFrame embed
    return result;
  });
}

async function getComments(id, { sort = 'top' } = {}) {
  return cache.wrap(`comments:${id}:${sort}`, 30 * 60 * 1000, async () => {
    try {
      const c = await pool.withRetry(async yt => await yt.getComments(id, sort === 'new' ? 'NEWEST_FIRST' : 'TOP_COMMENTS'), { label: `comments ${id}` });
      const items = (c.contents || []).map(t => t.comment || t).filter(Boolean);
      return {
        comments: items.map(cm => ({
          author: String(cm.author?.name || cm.author?.text || 'User'),
          author_id: cm.author?.id || '',
          author_thumb: cm.author?.best_thumbnail?.url || '',
          text: typeof cm.content === 'string' ? cm.content : String(cm.content?.text || ''),
          likes: cm.like_count || 0,
          time: String(cm.published_time?.text || cm.published_time || ''),
          replies: (cm.reply_count || 0),
          creator_heart: !!cm.creator_heart,
        })).filter(c2 => c2.text),
        count: c.comment_count || null,
      };
    } catch (e) {
      warn(`comments failed for ${id}:`, String(e.message).slice(0, 100));
      return { comments: [], count: null, error: 'Comments unavailable' };
    }
  });
}

async function getChannelInfo(channelIdOrName) {
  return cache.wrap(`channel:${channelIdOrName}`, 60 * 60 * 1000, async () => {
    return pool.withRetry(async yt => {
      const ch = await yt.getChannel(channelIdOrName);
      const meta = ch.metadata || {};
      // v18: ch.videos is a direct array (LockupView nodes)
      let videos = [];
      try {
        videos = (ch.videos || []).map(normalizeVideo).filter(Boolean).slice(0, 36);
      } catch (e) { warn('channel videos parse failed:', String(e.message).slice(0, 100)); }
      let avatar = '';
      try {
        avatar = meta.avatar?.[0]?.url || ch.header?.avatar?.[0]?.url || '';
      } catch {}
      let banner = '';
      try { banner = ch.header?.banner?.[0]?.url || ''; } catch {}
      let subscribers = '';
      try { subscribers = String(ch.header?.subscribers?.text || meta.subscribers || ''); } catch {}
      return {
        id: ch.id || channelIdOrName,
        name: String(meta.title || ch.header?.title?.text || ''),
        description: String(meta.description || ''),
        avatar, banner, subscribers,
        videos,
      };
    }, { label: `channel ${channelIdOrName}` });
  });
}

// ----------------------------------------------------------------------------
// HLS manifest proxy: fetch YouTube HLS manifest, rewrite every URL to /api/segment
// ----------------------------------------------------------------------------
const hlsManifestCache = new Map(); // id -> { text, exp }

function rewriteHlsUrls(text, baseUrl) {
  // Rewrite absolute http(s) URLs and relative .m3u8/.ts paths to our proxy
  const toProxy = (rawUrl) => {
    const trimmed = rawUrl.replace(/[,;]+$/, ''); // HLS attrs sometimes glue separators
    const abs = trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).toString();
    return proxied(abs);
  };
  let out = text;
  // absolute URLs (inside URI="..." attributes or standalone lines)
  out = out.replace(/https?:\/\/[^\s"'<>\\]+/g, m => {
    if (m.includes('/api/segment')) return m; // already proxied
    return toProxy(m);
  });
  // relative segment/playlist paths on their own lines (some sub-playlists use them)
  out = out.replace(/^([^#\s][^\s]*\.(?:m3u8|ts|mp4)[^\s]*)$/gm, m => toProxy(m));
  return out;
}

async function getHlsManifest(id) {
  const cached = hlsManifestCache.get(id);
  if (cached && cached.exp > Date.now()) return cached.text;
  // fetch fresh IOS info (bypass video cache to get fresh URLs)
  const info = await pool.withRetry(async yt => await yt.getInfo(id, { client: 'IOS' }), { label: `hls ${id}`, attempts: 2 });
  const hlsUrl = info.streaming_data?.hls_manifest_url;
  if (!hlsUrl) throw new Error('No HLS manifest for this video');
  const r = await fetch(hlsUrl, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HLS manifest fetch failed: ${r.status}`);
  const text = await r.text();
  const rewritten = rewriteHlsUrls(text, hlsUrl);
  hlsManifestCache.set(id, { text: rewritten, exp: Date.now() + 2 * 3600 * 1000 });
  return rewritten;
}

// ----------------------------------------------------------------------------
// SponsorBlock (multi-instance, graceful degradation)
// ----------------------------------------------------------------------------
const SB_INSTANCES = (process.env.SB_INSTANCES || 'https://sponsor.ajay.app,https://sb.eouter.net,https://sb.linuxfan1024.com').split(',').filter(Boolean);

async function getSponsorBlock(id) {
  return cache.wrap(`sb:${id}`, 6 * 3600 * 1000, async () => {
    for (const inst of SB_INSTANCES) {
      try {
        const r = await fetch(`${inst}/api/skipSegments?videoID=${id}`, { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'yt-api/1.0' } });
        if (r.status === 404) return { segments: [], source: inst }; // video not in DB = no segments
        if (!r.ok) continue;
        const j = await r.json();
        const segs = (Array.isArray(j) ? j : []).flatMap(entry =>
          (entry.segments || []).map(s => ({
            category: s.category, action: s.action,
            start: s.segment?.[0] ?? 0, end: s.segment?.[1] ?? 0,
          }))
        );
        return { segments: segs, source: inst };
      } catch { /* try next instance */ }
    }
    return { segments: [], source: null, unreachable: true };
  });
}

// ----------------------------------------------------------------------------
// Express app
// ----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

// CORS (needed for Capacitor origin + deployed frontends)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ----------------------------------------------------------------------------
// InnerTube relay — lets the web build exercise the app's own standalone
// (on-device InnerTube) code path in a normal browser. The Android APK does
// NOT use this (CapacitorHttp talks to YouTube directly); this exists for
// development/E2E and self-hosted web deployments that want it.
// ----------------------------------------------------------------------------
const IT_RELAY_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const IT_RELAY_ALLOWED = new Set(['search', 'browse', 'next', 'player']);
const IT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function itRelay(endpoint, body, key) {
  if (!IT_RELAY_ALLOWED.has(endpoint)) throw new Error('endpoint not allowed');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${key || IT_RELAY_KEY}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': IT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const text = await r.text();
    return { status: r.status, text };
  } finally { clearTimeout(timer); }
}

app.get('/api/ytb-relay', (req, res) => {
  const e = String(req.query.e || '');
  if (e === 'ping') return res.json({ ok: true });
  if (!IT_RELAY_ALLOWED.has(e)) return res.status(400).json({ error: 'endpoint not allowed' });
  let body = {};
  try { body = JSON.parse(String(req.query.b || '{}')); } catch { return res.status(400).json({ error: 'bad body' }); }
  itRelay(e, body, String(req.query.k || ''))
    .then(({ status, text }) => { res.status(status).type('application/json').send(text); })
    .catch(err => { warn('relay error', e, String(err.message || err).slice(0, 120)); res.status(502).json({ error: String(err.message || err).slice(0, 160) }); });
});

app.post('/api/ytb-relay', express.json({ limit: '256kb' }), (req, res) => {
  const { endpoint, body, key } = req.body || {};
  if (!IT_RELAY_ALLOWED.has(endpoint)) return res.status(400).json({ error: 'endpoint not allowed' });
  itRelay(endpoint, body, key)
    .then(({ status, text }) => { res.status(status).type('application/json').send(text); })
    .catch(err => { warn('relay error', endpoint, String(err.message || err).slice(0, 120)); res.status(502).json({ error: String(err.message || err).slice(0, 160) }); });
});

// Search suggestions relay (legacy suggest endpoint returns JSONP)
app.get('/api/ytb-suggest', (req, res) => {
  const q = String(req.query.q || '').slice(0, 120);
  if (!q) return res.json({ suggestions: [] });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  fetch(`https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}`, {
    headers: { 'User-Agent': IT_UA },
    signal: ctrl.signal,
  })
    .then(r => r.text())
    .then(text => {
      const start = text.indexOf('(');
      const end = text.lastIndexOf(')');
      let suggestions = [];
      if (start >= 0 && end > start) {
        try {
          const data = JSON.parse(text.slice(start + 1, end));
          if (Array.isArray(data) && Array.isArray(data[1])) {
            suggestions = data[1].map(item => String((Array.isArray(item) && item[0]) || '')).filter(s => s).slice(0, 12);
          }
        } catch { /* empty */ }
      }
      res.json({ suggestions });
    })
    .catch(() => res.json({ suggestions: [] }))
    .finally(() => clearTimeout(timer));
});

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  warn('route error', req.path, String(e.message || e).slice(0, 200));
  res.status(502).json({ error: String(e.message || e).slice(0, 200) });
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    po_token: !!tokenState.poToken,
    token_expires: tokenState.expiresAt ? new Date(tokenState.expiresAt).toISOString() : null,
    sessions: pool.sessions.length,
    cache_size: cache.size,
    hls_cache: hlsManifestCache.size,
    uptime: process.uptime(),
  });
});

app.get('/api/home', wrap(async (req, res) => {
  const category = String(req.query.category || 'all').toLowerCase();
  res.json(await getHome(category));
}));

app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  res.json(await doSearch(q, {
    type: String(req.query.type || 'video'),
    duration: req.query.duration,
    uploadDate: req.query.upload_date,
    limit: Math.min(parseInt(req.query.limit) || 30, 48),
  }));
}));

app.get('/api/video/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{6,15}$/.test(id)) return res.status(400).json({ error: 'Bad video id' });
  res.json(await getVideoFull(id));
}));

app.get('/api/video/:id/comments', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{6,15}$/.test(id)) return res.status(400).json({ error: 'Bad video id' });
  res.json(await getComments(id, { sort: String(req.query.sort || 'top') }));
}));

app.get('/api/channel/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{2,60}$/.test(id)) return res.status(400).json({ error: 'Bad channel id' });
  res.json(await getChannelInfo(id));
}));

app.get('/api/oembed/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const oe = await getOEmbed(id);
  if (!oe) return res.status(404).json({ error: 'Not found' });
  res.json(oe);
}));

app.get('/api/sponsorblock/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{6,15}$/.test(id)) return res.status(400).json({ error: 'Bad video id' });
  res.json(await getSponsorBlock(id));
}));

// --- HLS manifest (rewritten) ---
app.get('/api/hls/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{6,15}$/.test(id)) return res.status(400).json({ error: 'Bad video id' });
  try {
    const manifest = await getHlsManifest(id);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(manifest);
  } catch (e) {
    warn(`hls failed for ${id}:`, String(e.message).slice(0, 120));
    res.status(502).json({ error: 'HLS manifest unavailable' });
  }
}));

// --- Byte proxy: /api/segment?u=<base64url> — Range passthrough, streaming ---
app.get('/api/segment', wrap(async (req, res) => {
  const u = String(req.query.u || '');
  let target;
  try { target = Buffer.from(u, 'base64url').toString('utf8'); } catch { return res.status(400).json({ error: 'Bad u' }); }
  if (!/^https:\/\/([\w-]+\.googlevideo\.com|i\.ytimg\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com|www\.youtube\.com|manifest\.googlevideo\.com)\//.test(target)) {
    return res.status(403).json({ error: 'Blocked host' });
  }
  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;
  let upstream;
  try {
    upstream = await fetch(target, { headers, signal: AbortSignal.timeout(30000), redirect: 'follow' });
  } catch (e) {
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }
  const status = upstream.status; // 200 or 206
  if (status >= 400) return res.status(status).json({ error: `Upstream ${status}` });
  // Recursively rewrite sub-playlists (variant manifests fetched through the proxy)
  const ctype = upstream.headers.get('content-type') || '';
  const isPlaylist = /mpegurl|m3u8/i.test(ctype) || /\.m3u8(\?|$)/i.test(target);
  if (isPlaylist) {
    const text = await upstream.text();
    const rewritten = rewriteHlsUrls(text, target);
    res.status(200);
    res.set('content-type', 'application/vnd.apple.mpegurl');
    res.set('cache-control', 'public, max-age=600');
    return res.send(rewritten);
  }
  const h = {};
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(k);
    if (v) h[k] = v;
  }
  res.writeHead(status, h);
  // stream body
  if (upstream.body) {
    const reader = upstream.body.getReader();
    const push = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(Buffer.from(value))) {
            await new Promise(resolve => res.once('drain', resolve));
          }
        }
      } catch { /* client disconnect */ }
      res.end();
    };
    push();
    req.on('close', () => { try { reader.cancel(); } catch {} });
  } else {
    res.end();
  }
}));

// --- Progressive stream: /api/stream/:id?itag=X (finds format, pipes bytes) ---
app.get('/api/stream/:id', wrap(async (req, res) => {
  const id = String(req.params.id || '');
  const itag = parseInt(req.query.itag) || 18;
  if (!/^[\w-]{6,15}$/.test(id)) return res.status(400).json({ error: 'Bad video id' });
  const v = await getVideoFull(id);
  const fmt = (v.formats || []).find(f => f.itag === itag);
  if (!fmt || !fmt.url) return res.status(404).json({ error: 'Format not found' });
  const target = Buffer.from(new URL(fmt.url, 'http://x').searchParams.get('u'), 'base64url').toString('utf8');
  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;
  const upstream = await fetch(target, { headers, signal: AbortSignal.timeout(30000) });
  if (upstream.status >= 400) return res.status(upstream.status).json({ error: `Upstream ${upstream.status}` });
  const h = {};
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const val = upstream.headers.get(k);
    if (val) h[k] = val;
  }
  res.writeHead(upstream.status, h);
  if (upstream.body) {
    const reader = upstream.body.getReader();
    const push = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(Buffer.from(value))) await new Promise(r2 => res.once('drain', r2));
        }
      } catch { /* noop */ }
      res.end();
    };
    push();
    req.on('close', () => { try { reader.cancel(); } catch {} });
  } else res.end();
}));

// ----------------------------------------------------------------------------
// Static frontend hosting (Electron desktop app mode)
// ----------------------------------------------------------------------------
if (STATIC_DIR) {
  const staticDir = path.resolve(STATIC_DIR);
  log(`serving static frontend from ${staticDir}`);
  app.use(express.static(staticDir, {
    setHeaders: (res, p) => { if (p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  // SPA safety net: any non-API GET that fell through serves the app shell
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(staticDir, 'index.html'));
    }
    next();
  });
}

// ----------------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', async () => {
  log(`yt-api listening on :${PORT}`);
  log(`bgutil: ${BGUTIL_URL}`);
  log(`public URL prefix: "${PUBLIC_URL}" (empty = same-origin relative)`);
  await refreshToken();
  try {
    const yt = await pool.get(0);
    log('warm-up session created OK');
  } catch (e) { warn('warm-up failed (will retry on first request):', e.message); }
});

process.on('unhandledRejection', (e) => warn('unhandledRejection:', String(e?.message || e).slice(0, 150)));
