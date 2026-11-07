// yt-player.ts — app-side wrapper for the YtPlayer plugin (Phase 4).
//
// The native Media3 engine replaces the WebView <video> ONLY when all of:
// the Android app, the plugin synced into the build, and the user's
// experimental toggle. Everywhere else this module is inert.

"use client";

import { Capacitor } from "@capacitor/core";
import { YtPlayer as YtPlayerNative } from "yt-player";
import type { YtPlayerState } from "yt-player";
import { useYt } from "./yt-store";

export type { YtPlayerState };

export function isNativePlayerAvailable(): boolean {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) return false;
  try {
    return Capacitor.isPluginAvailable("YtPlayer");
  } catch {
    return false;
  }
}

/** The experimental toggle + the plugin's presence decide together. */
export function isNativePlayerActive(): boolean {
  return isNativePlayerAvailable() && useYt.getState().prefs.nativePlayer;
}

export const nativePlayer = {
  prepare: (o: {
    url: string;
    hls?: boolean;
    title?: string;
    artist?: string;
    artwork?: string;
    position?: number;
    autoplay?: boolean;
  }) => YtPlayerNative.prepare(o),
  play: () => YtPlayerNative.play(),
  pause: () => YtPlayerNative.pause(),
  seekTo: (to: number) => YtPlayerNative.seekTo({ to: Math.max(0, Number(to) || 0) }),
  position: () => YtPlayerNative.position(),
  release: () => YtPlayerNative.release().catch(() => {}),
  onState: (cb: (s: YtPlayerState) => void): Promise<{ remove: () => Promise<void> }> =>
    YtPlayerNative.addListener("state", cb),
};
