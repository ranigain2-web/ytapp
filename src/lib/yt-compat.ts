// yt-compat.ts — app-side wrapper for the YtCompat plugin (Phase 2).
//
// Compat Mode plays a server-gated video inside YouTube's real mobile site in
// a native WebView we control: the injection bundle spoofs visibility, guards
// background playback and strips ads inside YouTube's page; player state
// flows back to the app (and on to the lock-screen service), controls flow
// forward through evaluateJavascript. On web/desktop the plugin is
// unavailable and every entry point hides itself.

"use client";

import { Capacitor } from "@capacitor/core";
// BISECT-TEST: local stub replacing the plugin import
const YtCompatNative = {
  open: async (_o: unknown) => { throw new Error("stub"); },
  execute: async (_o: unknown) => ({ value: null }),
  close: async () => {},
  addListener: async (_e: string, _cb: unknown) => ({ remove: async () => {} }),
  removeAllListeners: async () => {},
} as unknown as typeof import("yt-compat").YtCompat;
import type { YtCompatMessage } from "yt-compat";
import { buildCompatInjection } from "./compat/compat-injection";

export type { YtCompatMessage };

export function isCompatAvailable(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function compatOpen(videoId: string): Promise<void> {
  const url = `https://m.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  return YtCompatNative.open({ url, injection: buildCompatInjection() });
}

export function compatClose(): Promise<void> {
  return YtCompatNative.close();
}

export function compatExecute(js: string): Promise<string> {
  return YtCompatNative.execute({ js }).then(r => String(r?.value ?? ""));
}

export function addCompatListener(cb: (m: YtCompatMessage) => void): Promise<{ remove: () => Promise<void> }> {
  return YtCompatNative.addListener("message", cb);
}

// C-04: the MediaSession / lock-screen notification drives YouTube's own
// player through the bridge. The pause path stamps __ytUserPauseAt so the
// background guard NEVER fights a deliberate pause (user-intent attribution).
export const compatControls = {
  play: () => compatExecute("var p=document.getElementById('movie_player'); if(p&&p.playVideo)p.playVideo(); 'ok'"),
  pause: () => compatExecute("window.__ytUserPauseAt=Date.now(); var p=document.getElementById('movie_player'); if(p&&p.pauseVideo)p.pauseVideo(); 'ok'"),
  seek: (to: number) => compatExecute(`var p=document.getElementById('movie_player'); if(p&&p.seekTo)p.seekTo(${Math.max(0, Number(to) || 0)}, true); 'ok'`),
};
