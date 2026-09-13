import type { PluginListenerHandle } from "@capacitor/core";

export interface YtBackgroundEnableOptions {
  /** Video title shown on the lock-screen notification. */
  title?: string;
  /** Channel name shown as the artist line. */
  artist?: string;
  /** Thumbnail URL loaded into the notification + metadata (best-effort). */
  artwork?: string;
  /** Total duration in seconds. */
  duration?: number;
}

export interface YtBackgroundUpdateOptions {
  playing?: boolean;
  /** Current playback position in seconds. */
  position?: number;
  /** Total duration in seconds. */
  duration?: number;
  title?: string;
  artist?: string;
}

export interface YtBackgroundControlEvent {
  action: "play" | "pause" | "next" | "stop" | "seek";
  /** Target position in seconds (only for action === "seek"). */
  seekTo?: number;
}

export interface YtBackgroundPlugin {
  enable(options: YtBackgroundEnableOptions): Promise<void>;
  update(options: YtBackgroundUpdateOptions): Promise<void>;
  disable(): Promise<void>;
  addListener(
    eventName: "control",
    listenerFunc: (event: YtBackgroundControlEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
