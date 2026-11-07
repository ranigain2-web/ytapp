import type { PluginListenerHandle } from "@capacitor/core";

export interface YtCompatOpenOptions {
  /** Full watch URL to load (https://m.youtube.com/watch?v=…). */
  url: string;
  /** JS source injected at document start on every page load. */
  injection: string;
}

export interface YtCompatExecuteOptions {
  /** JS to evaluate inside the compat WebView (e.g. player controls). */
  js: string;
}

/** Message from the injected bundle: media state, cookies, hook failures. */
export interface YtCompatMessage {
  type: "media" | "cookies" | "hookfail" | "close" | "log";
  playing?: boolean;
  position?: number;
  duration?: number;
  title?: string;
  /** cookies messages: document.cookie of the compat session */
  value?: string;
  /** hookfail messages: which injected hook failed (kill-switch telemetry) */
  hook?: string;
  detail?: string;
}

export interface YtCompatPlugin {
  /** Open the fullscreen compat WebView and load `url` with the injection. */
  open(options: YtCompatOpenOptions): Promise<void>;
  /** Evaluate JS inside the compat WebView (controls from the MediaSession). */
  execute(options: YtCompatExecuteOptions): Promise<{ value: string | null }>;
  /** Close and destroy the compat WebView. */
  close(): Promise<void>;
  addListener(
    eventName: "message",
    listenerFunc: (message: YtCompatMessage) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
