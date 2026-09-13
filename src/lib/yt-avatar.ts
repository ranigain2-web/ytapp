// Channel avatar cache — localStorage-backed. Feed/search cards don't carry
// channel avatars in InnerTube responses, but the watch page learns them
// (channel_thumb). Caching here lets feed cards show real avatars once a
// channel has been seen — the YouTube look without extra API calls.
"use client";

const KEY = "yt_avatar_cache";
const MAX = 240;

type Cache = Record<string, string>;

function read(): Cache {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}") as Cache;
  } catch { return {}; }
}

function write(c: Cache) {
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(c);
    if (keys.length > MAX) {
      // drop oldest (insertion order) entries
      for (const k of keys.slice(0, keys.length - MAX)) delete c[k];
    }
    window.localStorage.setItem(KEY, JSON.stringify(c));
  } catch { /* quota — ignore */ }
}

export function rememberAvatar(channelId: string, url: string) {
  if (!channelId || !url || !/^https?:/.test(url)) return;
  const c = read();
  if (c[channelId] === url) return;
  c[channelId] = url;
  write(c);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("yt-avatars"));
  }
}

export function getAvatar(channelId: string): string {
  if (!channelId) return "";
  return read()[channelId] || "";
}
