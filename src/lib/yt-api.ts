// API client — data source layering:
//   1. server     — the yt-api backend (same-origin sandbox, or configured base URL)
//   2. standalone — on-device InnerTube (Android: CapacitorHttp, CORS-free;
//                   web dev: relay through the yt-api server when present)
//   3. community  — public Piped instances (browser fallback)
// Continuation tokens power infinite scroll on home/search/channel pages.
"use client";

let runtimeApiBase: string | null = null;

export function getApiBase(): string {
  if (runtimeApiBase !== null) return runtimeApiBase;
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("yt_api_base");
    if (stored !== null) {
      runtimeApiBase = stored;
      return stored;
    }
  }
  runtimeApiBase = process.env.NEXT_PUBLIC_API_BASE || "";
  return runtimeApiBase;
}

export function setApiBase(base: string) {
  const clean = base.trim().replace(/\/+$/, "");
  runtimeApiBase = clean;
  if (typeof window !== "undefined") {
    window.localStorage.setItem("yt_api_base", clean);
  }
  invalidateDataSource(); // re-resolve on next fetch
}

export function apiHref(path: string): string {
  const base = getApiBase();
  // In sandbox (empty base), route through the gateway with the port hint
  if (!base && path.startsWith("/api/")) {
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}XTransformPort=3001`;
  }
  return `${base}${path}`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts: { timeoutMs?: number } = {}): Promise<T> {
  const url = apiHref(path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let status = 0;
  let text = "";
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    status = res.status;
    text = await res.text();
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    throw new ApiError(timedOut ? "The request timed out" : "Could not reach the server");
  } finally {
    clearTimeout(timer);
  }
  // Guard: the response must actually be JSON — an HTML page here means the
  // backend is absent/misrouted (e.g. Capacitor WebView 404 fallback). Never
  // surface raw parser errors to the user.
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) {
    throw new ApiError(status === 404 ? "No API server at this address" : "The server returned an invalid response", status);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError("The server returned an invalid response", status);
  }
  if (status < 200 || status >= 300) {
    const msg = (data as { error?: string })?.error || `HTTP ${status}`;
    throw new ApiError(msg, status);
  }
  return data as T;
}

// ---- Data source resolution (server > standalone > community) ----

import { probeCommunity, activeCommunityInstance } from "./community";
import { isNativeApp, itSuggest, resetTransportCache, itHome, itSearchRaw, itSearch as itSearchFull, itVideo, itComments as itCommentsFirst, itCommentsContinue, itChannel, itChannelContinue, ItError } from "./innertube";

export type DataSource = "server" | "standalone" | "community";
let activeSource: DataSource | null = null;
let sourceProbe: Promise<DataSource> | null = null;

export function getActiveSource(): DataSource | null {
  return activeSource;
}

export function getActiveSourceLabel(): string {
  if (activeSource === "server") {
    const b = getApiBase();
    return b ? `server · ${b}` : "server · same-origin";
  }
  if (activeSource === "standalone") return "on-device · YouTube direct";
  if (activeSource === "community") return activeCommunityInstance ? `community · ${activeCommunityInstance.replace(/^https?:\/\//, "")}` : "community";
  return "not connected";
}

export function invalidateDataSource() {
  activeSource = null;
  sourceProbe = null;
  resetTransportCache();
}

// Debug/testing override: ?src=standalone forces the standalone source so the
// exact on-device code path can be exercised in a browser through the relay.
let forcedSource: DataSource | null = null;
if (typeof window !== "undefined") {
  const p = new URLSearchParams(window.location.search);
  const v = p.get("src");
  if (v === "standalone" || v === "server" || v === "community") forcedSource = v;
}

export async function resolveDataSource(): Promise<DataSource> {
  if (activeSource) return activeSource;
  if (forcedSource) { activeSource = forcedSource; return forcedSource; }
  if (!sourceProbe) {
    sourceProbe = (async () => {
      // 1) yt-api server — only probe when it could plausibly exist:
      //    configured base URL, or web (sandbox gateway / self-host).
      const base = getApiBase();
      const canBeServer = !!base || !isNativeApp();
      if (canBeServer) {
        try {
          await api<{ ok: boolean }>("/api/health", { timeoutMs: base ? 5000 : 3500 });
          activeSource = "server";
          return "server" as const;
        } catch { /* fall through */ }
      }
      // 2) standalone InnerTube — always available on-device (CapacitorHttp);
      //    on web only when the dev relay is reachable.
      if (isNativeApp()) {
        activeSource = "standalone";
        return "standalone" as const;
      }
      // web: probe relay quickly via suggestions (lightweight GET)
      try {
        const sugg = await itSuggest("a");
        if (sugg.length > 0 || isNativeApp()) {
          activeSource = "standalone";
          return "standalone" as const;
        }
      } catch { /* relay absent */ }
      // 3) community Piped instances
      const ok = await probeCommunity();
      if (ok) {
        activeSource = "community";
        return "community" as const;
      }
      throw new ApiError("No data source reachable");
    })();
    // don't cache a failed resolution — retry next call
    sourceProbe.catch(() => { sourceProbe = null; });
  }
  return sourceProbe;
}

// ---- Types ----
export interface YtVideo {
  id: string;
  title: string;
  channel: string;
  channel_id: string;
  channel_thumb?: string;
  views: string;
  duration: string;
  published: string;
  thumb: string;
  thumb_lg: string;
  is_live?: boolean;
  shorts?: boolean;
}

export interface YtFormat {
  itag: number;
  mime: string;
  codecs: string;
  quality_label: string;
  height: number;
  width: number;
  fps: number;
  bitrate: number;
  has_video: boolean;
  has_audio: boolean;
  url: string;
}

export interface YtCaption {
  lang: string;
  name: string;
  url: string;
}

export interface YtChapter {
  title: string;
  start: number;
}

export interface YtVideoFull extends Partial<YtVideo> {
  id: string;
  ok: boolean;
  embed_fallback: boolean;
  title: string;
  channel: string;
  channel_id: string;
  channel_thumb?: string;
  channel_subs?: string;
  views: number | string;
  likes: number;
  duration: number;
  published: string;
  description: string;
  is_live?: boolean;
  formats: YtFormat[];
  hls: string | null;
  captions: YtCaption[];
  storyboard: { width: number; height: number; columns: number; rows: number; interval: number; template_url: string; templateUrlPattern?: string } | null;
  related: YtVideo[];
  chapters: YtChapter[];
  playability_reason?: string | null;
  embed_blocked?: boolean;
}

export interface YtComment {
  author: string;
  author_id: string;
  author_thumb?: string;
  text: string;
  likes: number;
  time: string;
  replies: number;
  creator_heart?: boolean;
}

export interface YtChannel {
  id: string;
  name: string;
  description: string;
  avatar: string;
  banner: string;
  subscribers: string;
  videos: YtVideo[];
}

export interface SbSegment {
  category: string;
  action: string;
  start: number;
  end: number;
}

// Paged results: every feed call returns a continuation token for infinite scroll
export interface YtFeedPage {
  results: YtVideo[];
  continuation: string | null;
}

// ---- Endpoints ----

export async function fetchHome(category: string): Promise<{ category: string; source: string; results: YtVideo[]; continuation: string | null }> {
  const mode = await resolveDataSource();
  if (mode === "standalone") {
    const page = await itHome(category);
    return { category, source: page.source, results: page.videos, continuation: page.continuation };
  }
  if (mode === "community") {
    const r = await communityHomePaged(category);
    return r;
  }
  return api<{ category: string; source: string; results: YtVideo[] }>(`/api/home?category=${encodeURIComponent(category)}`, { timeoutMs: 60000 });
}

export async function fetchHomeMore(category: string, token: string): Promise<YtFeedPage> {
  const mode = await resolveDataSource();
  if (mode === "standalone") {
    const page = await itHome(category, token);
    return { results: page.videos, continuation: page.continuation };
  }
  if (mode === "community") return communityHomeMore(token);
  throw new ApiError("No more pages in this mode");
}

export interface YtChannelResult {
  id: string;
  name: string;
  avatar: string;
  subscribers: string;
  description: string;
  verified?: boolean;
}

export async function fetchSearch(q: string): Promise<{ query: string; channel?: YtChannelResult | null; results: YtVideo[]; continuation: string | null }> {
  const mode = await resolveDataSource();
  if (mode === "standalone") {
    const r = await itSearchFull(q);
    return { query: q, channel: r.channel, results: r.videos, continuation: r.continuation };
  }
  if (mode === "community") {
    return pipedSearchPaged(q);
  }
  return api<{ query: string; channel?: YtChannelResult | null; results: YtVideo[] }>(`/api/search?q=${encodeURIComponent(q)}&type=video`, { timeoutMs: 60000 });
}

export async function fetchSearchMore(token: string): Promise<YtFeedPage> {
  const mode = await resolveDataSource();
  if (mode === "standalone") {
    const page = await itSearchRaw("", token, "innertube:search");
    return { results: page.videos, continuation: page.continuation };
  }
  if (mode === "community") return communitySearchMore(token);
  throw new ApiError("No more pages in this mode");
}

export async function fetchSuggestions(q: string): Promise<string[]> {
  // Works in standalone (on-device / relay) and server mode (relay endpoint).
  // Community mode: not supported by Piped — returns [].
  try {
    return await itSuggest(q);
  } catch {
    return [];
  }
}

export async function fetchVideo(id: string): Promise<YtVideoFull> {
  const mode = await resolveDataSource();
  if (mode === "standalone") return itVideo(id);
  if (mode === "community") return communityVideo(id);
  return api<YtVideoFull>(`/api/video/${id}`, { timeoutMs: 60000 });
}

export async function fetchComments(id: string, sort: "top" | "new" = "top"): Promise<{ comments: YtComment[]; count: number | null; error?: string; continuation?: string | null }> {
  const mode = await resolveDataSource();
  if (mode === "standalone") {
    try {
      const r = await itCommentsFirst(id, sort);
      return { comments: r.comments, count: r.count, continuation: r.token };
    } catch (e) {
      return { comments: [], count: null, error: e instanceof ItError ? "Comments unavailable" : "Comments unavailable" };
    }
  }
  if (mode === "community") return communityComments(id);
  return api<{ comments: YtComment[]; count: number | null; error?: string }>(`/api/video/${id}/comments?sort=${sort}`, { timeoutMs: 60000 });
}

export async function fetchCommentsMore(token: string): Promise<{ comments: YtComment[]; continuation: string | null }> {
  const mode = await resolveDataSource();
  if (mode === "standalone") {
    const r = await itCommentsContinue(token);
    return { comments: r.comments, continuation: r.token };
  }
  throw new ApiError("No more comments in this mode");
}

export async function fetchChannel(id: string): Promise<YtChannel> {
  const mode = await resolveDataSource();
  if (mode === "standalone") return itChannel(id);
  if (mode === "community") return communityChannel(id);
  return api<YtChannel>(`/api/channel/${id}`, { timeoutMs: 60000 });
}

export async function fetchChannelMore(token: string): Promise<YtFeedPage> {
  const mode = await resolveDataSource();
  if (mode === "standalone") {
    const page = await itChannelContinue(token);
    return { results: page.videos, continuation: page.continuation };
  }
  throw new ApiError("No more pages in this mode");
}

// SponsorBlock — CORS-open public API, callable from any context.
export async function fetchSponsorBlock(id: string): Promise<{ segments: SbSegment[]; source: string | null; unreachable?: boolean }> {
  const mode = await resolveDataSource();
  if (mode === "server") {
    return api<{ segments: SbSegment[]; source: string | null; unreachable?: boolean }>(`/api/sponsorblock/${id}`, { timeoutMs: 12000 });
  }
  // standalone + community: call the public SponsorBlock API directly (CORS-open)
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(id)}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { segments: [], source: null, unreachable: true };
    const data = await res.json() as { category?: string; actionType?: string; segment?: number[] }[];
    const segments = (Array.isArray(data) ? data : []).map(s => ({
      category: s.category || "sponsor",
      action: s.actionType === "skip" ? "skip" : s.actionType || "skip",
      start: (s.segment && s.segment[0]) || 0,
      end: (s.segment && s.segment[1]) || 0,
    })).filter(s => s.end > s.start);
    return { segments, source: "sponsor.ajay.app" };
  } catch {
    return { segments: [], source: null, unreachable: true };
  }
}

export async function fetchHealth(): Promise<{ ok: boolean; po_token: boolean; uptime: number }> {
  return api<{ ok: boolean; po_token: boolean; uptime: number }>(`/api/health`, { timeoutMs: 8000 });
}

// Absolute URL resolver for streams (HLS/captions/storyboard paths are relative)
export function absStream(url: string | null | undefined): string {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  const base = getApiBase();
  if (base) return `${base}${url}`;
  // sandbox gateway (skip if the URL already carries the port hint)
  if (url.includes("XTransformPort=")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}XTransformPort=3001`;
}

// ---- community mode wrappers with pagination where Piped supports it ----

import {
  communityHome, communitySearch as pipedSearch, communityVideo,
  communityComments, communityChannel, mapPipedItem, activeCommunityInstance as pipedActiveInstance,
} from "./community";

async function communityHomePaged(category: string): Promise<{ category: string; source: string; results: YtVideo[]; continuation: string | null }> {
  const r = await communityHome(category);
  return { category: r.category, source: r.source, results: r.results, continuation: null };
}

// Piped search carries a nextpage handler for infinite scroll
async function pipedSearchPaged(q: string): Promise<{ query: string; channel?: YtChannelResult | null; results: YtVideo[]; continuation: string | null }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const url = `${pipedActiveInstance}/search?q=${encodeURIComponent(q)}&filter=videos`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok || text.trimStart().startsWith("<")) throw new Error("bad response");
    const d = JSON.parse(text) as { items?: unknown[]; nextpage?: string | null };
    const videos = (d.items || []).map(mapPipedItem).filter(Boolean) as YtVideo[];
    // channel info via the original adapter (it does its own requests)
    const base = await pipedSearch(q).catch(() => null);
    return { query: q, channel: base?.channel || null, results: videos, continuation: d.nextpage || null };
  } catch {
    const r = await pipedSearch(q);
    return { query: q, channel: r.channel, results: r.results, continuation: null };
  }
}

async function communityHomeMore(_token: string): Promise<YtFeedPage> {
  return { results: [], continuation: null };
}

async function communitySearchMore(token: string): Promise<YtFeedPage> {
  try {
    const url = /^https?:\/\//.test(token) ? token : `${pipedActiveInstance}${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok || text.trimStart().startsWith("<")) throw new Error("bad response");
    const d = JSON.parse(text) as { items?: unknown[]; nextpage?: string | null };
    const videos = (d.items || []).map(mapPipedItem).filter(Boolean) as YtVideo[];
    return { results: videos, continuation: d.nextpage || null };
  } catch {
    return { results: [], continuation: null };
  }
}
