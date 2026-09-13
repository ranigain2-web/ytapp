// Official YouTube IFrame API loader (used ONLY for embed-fallback videos).
// The API script + postMessage bridge let us observe the embed player's
// state — most importantly ENDED, which drives "Autoplay next video" for
// videos that play through YouTube's own iframe. All failures are silent:
// the embed itself works without the API.

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => {
        destroy: () => void;
        [k: string]: unknown;
      };
      PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; [k: string]: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<NonNullable<Window["YT"]>> | null = null;

export function loadYouTubeIframeAPI(): Promise<NonNullable<Window["YT"]>> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        apiPromise = null;
        reject(new Error("iframe api timeout"));
      }, 8000);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        clearTimeout(timeout);
        if (window.YT) resolve(window.YT);
        else reject(new Error("iframe api missing"));
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = () => {
        clearTimeout(timeout);
        apiPromise = null;
        reject(new Error("iframe api failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}
