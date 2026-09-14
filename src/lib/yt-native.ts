// Native media bridge — the YouTube-Premium-style background playback layer.
//
// Android: the local `yt-background` Capacitor plugin runs a mediaPlayback
// foreground service (keeps the WebView streaming while backgrounded/screen
// off) + a MediaSession (lock-screen metadata, headset buttons) + a
// MediaStyle notification with Play/Pause/Next/Close. Control events from
// the notification/lock screen/headset arrive through addControlListener.
//
// Web/desktop: everything degrades to the W3C MediaSession API (lock-screen /
// media keys where the browser supports them) and silent no-ops elsewhere.

"use client";

import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
import { YtBackground as YtBackgroundNative } from "yt-background";
import type {
  YtBackgroundPlugin,
  YtBackgroundControlEvent,
  YtBackgroundEnableOptions,
  YtBackgroundUpdateOptions,
} from "yt-background";

let nativePlugin: YtBackgroundPlugin | null = null;

function getNative(): YtBackgroundPlugin | null {
  if (typeof window === "undefined") return null;
  if (nativePlugin !== null) return nativePlugin;
  if (!Capacitor.isNativePlatform()) return null;
  nativePlugin = YtBackgroundNative;
  return nativePlugin;
}

export function isNativeApp(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

/**
 * True inside the Capacitor Android WebView.
 *
 * This decides the app CHROME, not just the native plugin path. Real YouTube
 * chooses its shell from the user agent, not the viewport: measured at 834px,
 * an Android UA gets the 48px app bar + bottom pivot bar, a desktop UA gets the
 * 56px app bar + guide rail. Our shell used to be width-only, so the Android
 * tablet target rendered desktop chrome. Width still decides layout INSIDE the
 * mobile shell (grid columns, gutters).
 */
export function isAndroidApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    androidBridge?: unknown;
    Capacitor?: { getPlatform?: () => string };
  };
  if (w.androidBridge) return true;
  try {
    return w.Capacitor?.getPlatform?.() === "android";
  } catch {
    return false;
  }
}

/**
 * Stamp the platform class on <html> so CSS can pin the shell.
 *
 * The boot script in yt-theme.ts already does this before first paint (no
 * flash of desktop chrome on an Android tablet). This is the client-side
 * re-assert for the case where the bridge shows up after the document booted.
 * It only touches classList, and <html> carries suppressHydrationWarning, so
 * it can never desync hydration.
 */
export function applyPlatformClass() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("yt-android", isAndroidApp());
}

export function nativeBackgroundEnable(opts: YtBackgroundEnableOptions) {
  getNative()?.enable(opts).catch(() => {});
}

export function nativeBackgroundUpdate(opts: YtBackgroundUpdateOptions) {
  getNative()?.update(opts).catch(() => {});
}

export function nativeBackgroundDisable() {
  getNative()?.disable().catch(() => {});
}

export function addControlListener(
  cb: (e: YtBackgroundControlEvent) => void,
): () => void {
  const p = getNative();
  if (!p) return () => {};
  let handle: PluginListenerHandle | null = null;
  let disposed = false;
  p.addListener("control", cb)
    .then((h) => {
      if (disposed) h.remove().catch(() => {});
      else handle = h;
    })
    .catch(() => {});
  return () => {
    disposed = true;
    handle?.remove().catch(() => {});
  };
}

// ---- W3C MediaSession (web + Android WebView where available) ----

type MsHandlers = {
  play?: () => void;
  pause?: () => void;
  next?: () => void;
  prev?: () => void;
  seek?: (to: number) => void;
  seekBy?: (d: number) => void;
};

export function setMediaMetadata(meta: { title?: string; artist?: string; artwork?: string; duration?: number }) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: meta.title || "YouTube",
      artist: meta.artist || "",
      artwork: meta.artwork ? [{ src: meta.artwork, sizes: "480x360", type: "image/jpeg" }] : [],
    });
  } catch {
    /* unsupported */
  }
}

export function setMediaPlaybackState(playing: boolean) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  } catch {
    /* unsupported */
  }
}

export function setMediaPositionState(position: number, duration: number, rate = 1) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (!isFinite(position) || !isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState?.({ position: Math.max(0, Math.min(duration, position)), duration, playbackRate: rate || 1 });
  } catch {
    /* invalid state — ignore */
  }
}

export function setMediaHandlers(h: MsHandlers) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action: MediaSessionAction, fn: ((d?: MediaSessionActionDetails) => void) | null) => {
    try {
      ms.setActionHandler(action, fn as ((d: MediaSessionActionDetails) => void) | null);
    } catch {
      /* action unsupported on this platform */
    }
  };
  set("play", h.play ? () => h.play?.() : null);
  set("pause", h.pause ? () => h.pause?.() : null);
  set("nexttrack", h.next ? () => h.next?.() : null);
  set("previoustrack", h.prev ? () => h.prev?.() : null);
  set("seekto", h.seek ? (d) => d?.seekTime != null && h.seek?.(d.seekTime) : null);
  set("seekbackward", h.seekBy ? (d) => h.seekBy?.(-(d?.seekOffset || 10)) : null);
  set("seekforward", h.seekBy ? (d) => h.seekBy?.(d?.seekOffset || 10) : null);
}

export function clearMediaHandlers() {
  setMediaHandlers({});
}
