// API client — talks to the yt-api backend.
// Sandbox/dev: relative paths through the gateway (XTransformPort=3001).
// Production/Capacitor: absolute base URL from settings or NEXT_PUBLIC_API_BASE.
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
  invalidateDataSource(); // re-resolve server vs community on next fetch
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

// ---- Data source resolution (server vs community) ----
// The app prefers the yt-api backend (same-origin in the sandbox, or the
// configured base URL). If that is unreachable — e.g. the Android APK before
// any server is configured — it automatically falls back to public community
// instances (Piped API, CORS-open). Both being down surfaces a friendly setup
// state in the UI.

import { probeCommunity, activeCommunityInstance } from "./community";

export type DataSource = "server" | "community";
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
  if (activeSource === "community") return activeCommunityInstance ? `community · ${activeCommunityInstance.replace(/^https?:\/\//, "")}` : "community";
  return "not connected";
}

export function invalidateDataSource() {
  activeSource = null;
  sourceProbe = null;
}

export async function resolveDataSource(): Promise<DataSource> {
  if (activeSource) return activeSource;
  if (!sourceProbe) {
    sourceProbe = (async () => {
      try {
        await api<{ ok: boolean }>("/api/health", { timeoutMs: 8000 });
        activeSource = "server";
        return "server" as const;
      } catch {
        const ok = await probeCommunity();
        if (ok) {
          activeSource = "community";
          return "community" as const;
        }
        throw new ApiError("No data source reachable");
      }
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

// ---- Endpoints (routed: ytapp server when reachable, community otherwise) ----
import {
  communityHome, communitySearch, communityVideo,
  communityComments, communityChannel,
} from "./community";

export async function fetchHome(category: string): Promise<{ category: string; source: string; results: YtVideo[] }> {
  const mode = await resolveDataSource();
  if (mode === "community") return communityHome(category);
  return api<{ category: string; source: string; results: YtVideo[] }>(`/api/home?category=${encodeURIComponent(category)}`, { timeoutMs: 60000 });
}

export interface YtChannelResult {
  id: string;
  name: string;
  avatar: string;
  subscribers: string;
  description: string;
  verified?: boolean;
}

export async function fetchSearch(q: string): Promise<{ query: string; channel?: YtChannelResult | null; results: YtVideo[] }> {
  const mode = await resolveDataSource();
  if (mode === "community") return communitySearch(q);
  return api<{ query: string; channel?: YtChannelResult | null; results: YtVideo[] }>(`/api/search?q=${encodeURIComponent(q)}&type=video`, { timeoutMs: 60000 });
}

export async function fetchVideo(id: string): Promise<YtVideoFull> {
  const mode = await resolveDataSource();
  if (mode === "community") return communityVideo(id);
  return api<YtVideoFull>(`/api/video/${id}`, { timeoutMs: 60000 });
}

export async function fetchComments(id: string, sort: "top" | "new" = "top"): Promise<{ comments: YtComment[]; count: number | null; error?: string }> {
  const mode = await resolveDataSource();
  if (mode === "community") return communityComments(id);
  return api<{ comments: YtComment[]; count: number | null; error?: string }>(`/api/video/${id}/comments?sort=${sort}`, { timeoutMs: 60000 });
}

export async function fetchChannel(id: string): Promise<YtChannel> {
  const mode = await resolveDataSource();
  if (mode === "community") return communityChannel(id);
  return api<YtChannel>(`/api/channel/${id}`, { timeoutMs: 60000 });
}

export async function fetchSponsorBlock(id: string): Promise<{ segments: SbSegment[]; source: string | null; unreachable?: boolean }> {
  const mode = await resolveDataSource();
  if (mode === "community") return { segments: [], source: null, unreachable: true };
  return api<{ segments: SbSegment[]; source: string | null; unreachable?: boolean }>(`/api/sponsorblock/${id}`, { timeoutMs: 12000 });
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
