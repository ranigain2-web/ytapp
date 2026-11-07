// yt-native-engine.ts — bridges the native Media3 engine into the playback
// store (Phase 4, N-02 routing).
//
// When active, the native player IS the media engine: this module feeds its
// state events into the store (playing/current/duration/ended) so every piece
// of UI that reads the store — seek bar, mini player, autoplay countdown —
// keeps working unchanged, and forwards the store's engine controls (the same
// object the WebView path registers) to the native player.

"use client";

import { nativePlayer, isNativePlayerActive, type YtPlayerState } from "./yt-player";
export { isNativePlayerActive };
import { usePlayback } from "./yt-playback";
import type { YtVideoFull, YtFormat } from "./yt-api";
import { absStream } from "./yt-api";

export interface NativeUrlChoice {
  url: string;
  hls: boolean;
  kind: "audio" | "hls" | "progressive" | "none";
}

/**
 * Mirror of the WebView engine's source selection (VideoSurface load
 * effect): audio-only > HLS manifest > combined progressive > none.
 * Pure on purpose — unit-testable without a player.
 */
export function selectNativeUrl(
  video: Pick<YtVideoFull, "hls" | "formats"> | null,
  opts: { audioOnly?: boolean; audioRescue?: boolean; fallbackFormat?: YtFormat | null; audioFormat?: YtFormat | null },
): NativeUrlChoice {
  const audio = opts.audioOnly || opts.audioRescue ? opts.audioFormat : null;
  if (audio?.url) return { url: absStream(audio.url), hls: false, kind: "audio" };
  if (video?.hls) return { url: absStream(video.hls), hls: true, kind: "hls" };
  if (opts.fallbackFormat?.url) return { url: absStream(opts.fallbackFormat.url), hls: false, kind: "progressive" };
  return { url: "", hls: false, kind: "none" };
}

let stateHandle: { remove: () => Promise<void> } | null = null;
let activeVideoId: string | null = null;

/** Prepare the native engine and wire its state into the store. */
export async function startNativeEngine(
  video: YtVideoFull,
  choice: NativeUrlChoice,
  opts: { position?: number; autoplay?: boolean; onUIState?: (s: YtPlayerState) => void },
): Promise<boolean> {
  if (!isNativePlayerActive() || !choice.url) return false;
  await stopNativeEngine();
  activeVideoId = video.id;

  stateHandle = await nativePlayer.onState((s: YtPlayerState) => {
    // a stale engine's events must never touch the store
    if (activeVideoId !== video.id) return;
    const st = usePlayback.getState();
    if (st.mode !== "direct") return;
    usePlayback.setState({
      playing: s.state === "playing",
      current: s.position || 0,
      duration: s.duration || st.duration,
    });
    // The player UI reads the SURFACE's local state (element-event driven on
    // the WebView path) — mirror there too when a sink is provided.
    if (opts.onUIState) opts.onUIState(s);
    if (s.state === "ended") {
      st.advance();
    }
    if (s.state === "error") {
      usePlayback.setState({ playing: false });
    }
  });

  await nativePlayer.prepare({
    url: choice.url,
    hls: choice.hls,
    title: video.title,
    artist: video.channel,
    artwork: video.thumb_lg || video.thumb,
    position: opts.position || 0,
    autoplay: opts.autoplay !== false,
  });
  return true;
}

export async function stopNativeEngine(): Promise<void> {
  activeVideoId = null;
  if (stateHandle) {
    try { await stateHandle.remove(); } catch { /* already gone */ }
    stateHandle = null;
  }
  nativePlayer.release();
}

/** True while this module owns playback (controls must route to native). */
export function nativeEngineRunning(): boolean {
  return activeVideoId !== null;
}

/**
 * Engine-control overrides for the store's engine object: when the native
 * engine runs, its methods win over the WebView element's.
 */
export const nativeEngineControls = {
  togglePlay: () => {
    const st = usePlayback.getState();
    if (st.playing) nativePlayer.pause().catch(() => {});
    else nativePlayer.play().catch(() => {});
  },
  pause: () => nativePlayer.pause().catch(() => {}),
  seekTo: (to: number) => nativePlayer.seekTo(to).catch(() => {}),
  seekBy: (d: number) => {
    const st = usePlayback.getState();
    nativePlayer.seekTo(Math.max(0, (st.current || 0) + d)).catch(() => {});
  },
  restart: () => nativePlayer.seekTo(0).catch(() => {}),
};
