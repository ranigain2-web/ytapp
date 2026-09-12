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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetch(apiHref(path), { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch { /* ignore */ }
      throw new ApiError(msg, res.status);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
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

// ---- Endpoints ----
export const fetchHome = (category: string) =>
  api<{ category: string; source: string; results: YtVideo[] }>(`/api/home?category=${encodeURIComponent(category)}`, { timeoutMs: 60000 });

export interface YtChannelResult {
  id: string;
  name: string;
  avatar: string;
  subscribers: string;
  description: string;
  verified?: boolean;
}

export const fetchSearch = (q: string) =>
  api<{ query: string; channel?: YtChannelResult | null; results: YtVideo[] }>(`/api/search?q=${encodeURIComponent(q)}&type=video`, { timeoutMs: 60000 });

export const fetchVideo = (id: string) =>
  api<YtVideoFull>(`/api/video/${id}`, { timeoutMs: 60000 });

export const fetchComments = (id: string, sort: "top" | "new" = "top") =>
  api<{ comments: YtComment[]; count: number | null; error?: string }>(`/api/video/${id}/comments?sort=${sort}`, { timeoutMs: 60000 });

export const fetchChannel = (id: string) =>
  api<YtChannel>(`/api/channel/${id}`, { timeoutMs: 60000 });

export const fetchSponsorBlock = (id: string) =>
  api<{ segments: SbSegment[]; source: string | null; unreachable?: boolean }>(`/api/sponsorblock/${id}`, { timeoutMs: 12000 });

export const fetchHealth = () =>
  api<{ ok: boolean; po_token: boolean; uptime: number }>(`/api/health`, { timeoutMs: 8000 });

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
