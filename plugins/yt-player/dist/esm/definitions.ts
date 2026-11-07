import type { PluginListenerHandle } from "@capacitor/core";

export interface YtPlayerPrepareOptions {
  /** Direct stream URL (progressive format) or an HLS manifest URL. */
  url: string;
  /** true when `url` is an HLS manifest (m3u8). */
  hls?: boolean;
  title?: string;
  artist?: string;
  artwork?: string;
  /** Resume position in seconds. */
  position?: number;
  /** Play immediately after preparing. */
  autoplay?: boolean;
}

export interface YtPlayerSeekOptions {
  /** Target position in seconds. */
  to: number;
}

/** Native engine state — mirrors the fields the app's playback store tracks. */
export interface YtPlayerState {
  /** ready | playing | paused | ended | error */
  state: "ready" | "playing" | "paused" | "ended" | "error";
  position: number;
  duration: number;
  error?: string;
}

export interface YtPlayerPlugin {
  /** Create the player, attach the media session, and load the stream. */
  prepare(options: YtPlayerPrepareOptions): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(options: YtPlayerSeekOptions): Promise<void>;
  /** One-shot position probe (the app also receives periodic state events). */
  position(): Promise<YtPlayerState>;
  /** Stop playback, release the player, drop the notification. */
  release(): Promise<void>;
  addListener(
    eventName: "state",
    listenerFunc: (state: YtPlayerState) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
