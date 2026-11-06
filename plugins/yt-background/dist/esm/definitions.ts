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

export interface YtBackgroundKeepAwakeOptions {
  /** true = keep the screen on while the video plays (foreground). */
  enable?: boolean;
}

export interface YtBackgroundPipOnHomeOptions {
  /** true = pressing Home while a video plays shrinks into PiP. */
  enable?: boolean;
}

export interface YtBackgroundControlEvent {
  action: "play" | "pause" | "next" | "prev" | "stop" | "seek" | "duck" | "unduck";
  /** Target position in seconds (only for action === "seek"). */
  seekTo?: number;
}

export interface YtBackgroundPlugin {
  enable(options: YtBackgroundEnableOptions): Promise<void>;
  update(options: YtBackgroundUpdateOptions): Promise<void>;
  disable(): Promise<void>;
  /** Android: setKeepScreenOn on the WebView — no-op on web. */
  keepAwake(options: YtBackgroundKeepAwakeOptions): Promise<void>;
  /** Phase 2 (PiP): shrink the activity into a floating ~16:9 window.
   *  Android 8+; silently resolves elsewhere. Leaving PiP is user-driven —
   *  dismissing the window arrives as the existing "stop" control event. */
  enterPip(): Promise<void>;
  /** Phase 2 (PiP): whether a Home-press while playing enters PiP (the
   *  MainActivity's onUserLeaveHint sets a flag the plugin polls on
   *  activity-pause; this is the JS-side toggle for it). Default: enabled. */
  setPipOnHome(options: YtBackgroundPipOnHomeOptions): Promise<void>;
  addListener(
    eventName: "control",
    listenerFunc: (event: YtBackgroundControlEvent) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
