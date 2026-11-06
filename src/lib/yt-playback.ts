// yt-playback — the persistent playback slice (phase 2).
//
// THE model ([A1]–[A10], docs/designs/2026-11-05-premium-parity-v2.md §6):
// one <video> element lives for the whole app session, owned imperatively by
// the VideoSurface component (never in React's reconcile tree) and ADOPTED
// into whichever mount point is active — the watch slot or the miniplayer
// frame — via appendChild. Everything that must survive a route change lives
// here: the loaded video, the play queue, mini state, the autoplay countdown.
//
// The single-active-audio-owner rule: the store surface is the ONLY
// direct-mode player. Entering Shorts pauses + docks it ([A3]); an embed
// fallback parks it ([A2]); per-card Shorts players stay outside this store.
//
// Not persisted: a fresh app launch starts with no orphaned playback state.

"use client";

import { create } from "zustand";
import type { YtVideo, YtVideoFull } from "@/lib/yt-api";
import { useRouterStore, type Route } from "@/lib/yt-router";

export type SurfaceMode = "direct" | "embed" | "none";
export type DockTarget = "watch" | "mini" | "parked";

/** What the surface can drive on the <video> element. Registered by
 * VideoSurface on mount; every UI (mini, watch chrome, notification) goes
 * through store actions so nothing needs the element itself ([A1]). */
export interface PlaybackEngine {
  togglePlay(): void;
  pause(): void;
  seekTo(seconds: number): void;
  seekBy(delta: number): void;
  restart(): void;
  toggleMute(): void;
  /** Hard stop: pause + tear the background service down (notification Close
   * / PiP dismiss / mini close). */
  stop(): void;
}

/** Autoplay countdown ([A7]): video ended + autoplay on → 5s ring, then
 * related[0]. Cleared by Cancel, a seek, or a route/load change. */
export interface Countdown {
  nextId: string;
  nextTitle: string;
  nextThumb: string;
  nextChannel: string;
  /** epoch ms when the countdown fires */
  until: number;
}

const COUNTDOWN_MS = 5000;
/** [A2] forceEmbed TTL — how long a video that proved unplayable directly
 * stays on the embed path when revisited. */
const FORCE_EMBED_TTL = 15 * 60 * 1000;

interface PlaybackState {
  /** The video the surface holds (full metadata; null before first load). */
  video: YtVideoFull | null;
  videoId: string;
  /** deep-link / resume position for the current load ([A1]: the imperative
   * startAt handle — applied by the surface once metadata is ready). */
  startAt: number;
  mode: SurfaceMode;
  /** where the <video> element is currently adopted */
  docked: DockTarget;
  miniOpen: boolean;
  /** [A3] mini state remembered while on the Shorts route */
  wasMini: boolean;

  // engine-mirrored state (written by VideoSurface, read by the mini + e2e)
  playing: boolean;
  current: number;
  duration: number;
  buffered: number;
  waiting: boolean;
  error: string | null;

  /** [A7] related list of the CURRENT video — one source of truth for the
   * countdown, the notification Next, and the mini's next button. */
  queue: YtVideo[];
  /** play history for notification Prev (queue-1 / restart-current) */
  playedIds: string[];

  countdown: Countdown | null;

  // [A2] direct playback proved unplayable for these ids (TTL'd)
  forceEmbedIds: Record<string, number>;

  // mount-point registration (adoption targets; DOM refs, never persisted)
  watchSlot: HTMLElement | null;
  miniFrame: HTMLElement | null;

  engine: PlaybackEngine | null;

  // ---- actions ----
  /** WatchPage, once fetch resolves. mode tells the surface whether to load
   * the stream (direct) or park (embed — the iframe is the audio source). */
  load: (video: YtVideoFull, opts?: { startAt?: number; mode?: SurfaceMode }) => void;
  /** [A2] direct playback failed → remember embed-ness, park the surface. */
  setEmbed: (id: string) => void;
  isForcedEmbed: (id: string) => boolean;
  /** [A7] related list arrives with the metadata. */
  setQueue: (related: YtVideo[]) => void;
  setEngineMirror: (m: Partial<Pick<PlaybackState, "playing" | "current" | "duration" | "buffered" | "waiting" | "error">>) => void;
  setDocked: (d: DockTarget) => void;
  registerEngine: (e: PlaybackEngine | null) => void;
  registerWatchSlot: (el: HTMLElement | null) => void;
  registerMiniFrame: (el: HTMLElement | null) => void;
  /** [A4] scroll-past dock (IO ratio < 0.15). */
  dockMini: () => void;
  /** [A4] scroll-back restore (IO ratio ≥ 0.15) — only on the watch route. */
  undockMini: () => void;
  /** mini ✕ — playback stops ([A1] "close (stops playback)"). */
  closeMini: () => void;
  /** mini tap — expand back to the watch route ([A10] position survives). */
  expandMini: () => void;
  /** [A3] entering Shorts: pause, close mini, remember. */
  pauseAndDock: () => void;
  /** [A3] leaving Shorts: reopen only if it was open. */
  reopenIfWasMini: () => void;
  /** [A7] ENDED: autoplay on → countdown; off → nothing (video just ended). */
  advance: () => void;
  cancelCountdown: () => void;
  /** notification/player Next — related[0] of the current queue. */
  nextTrack: () => void;
  /** notification Prev — queue-1, or restart current when history is empty. */
  prevTrack: () => void;
  navigateWatch: (id: string) => void;
  /** [A1] store-action seek — the replacement for the old imperative
   * VideoPlayerHandle; chapter chips / description links call this. */
  seekTo: (seconds: number) => void;
}

export const usePlayback = create<PlaybackState>()((set, get) => ({
  video: null,
  videoId: "",
  startAt: 0,
  mode: "none",
  docked: "parked",
  miniOpen: false,
  wasMini: false,
  playing: false,
  current: 0,
  duration: 0,
  buffered: 0,
  waiting: false,
  error: null,
  queue: [],
  playedIds: [],
  countdown: null,
  forceEmbedIds: {},
  watchSlot: null,
  miniFrame: null,
  engine: null,

  load: (video, opts) => {
    const prev = get();
    const mode = opts?.mode ?? "direct";
    const sameVideo = prev.videoId === video.id;
    set({
      video,
      videoId: video.id,
      startAt: opts?.startAt || 0,
      mode,
      // [A10] the mini never survives a watch-page load — neither for a new
      // video nor when expanding back to the same one
      miniOpen: false,
      countdown: null,
      queue: mode === "direct" && sameVideo ? prev.queue : [],
      playedIds:
        mode === "direct" && !sameVideo && video.id
          ? [...prev.playedIds.filter(id => id !== video.id), video.id].slice(-50)
          : prev.playedIds,
      error: null,
    });
    // embed = a second audio source: the owner rule pauses + parks us ([A2])
    if (mode !== "direct" && prev.mode === "direct" && prev.playing) {
      prev.engine?.stop();
    }
  },

  setEmbed: (id) => {
    const st = get();
    // [A2] the iframe is a second audio source: pause + park the surface and
    // remember embed-ness so the mini never docks for this video
    if (st.videoId === id && st.mode === "direct") {
      st.engine?.stop();
      set({ mode: "embed", miniOpen: false, countdown: null });
    }
    set(s => ({ forceEmbedIds: { ...s.forceEmbedIds, [id]: Date.now() } }));
  },

  isForcedEmbed: (id) => {
    const at = get().forceEmbedIds[id];
    return !!at && Date.now() - at < FORCE_EMBED_TTL;
  },

  setQueue: (related) => set({ queue: (related || []).filter(r => !!r.id) }),

  setEngineMirror: (m) => set(m),

  setDocked: (d) => set({ docked: d }),

  registerEngine: (e) => set({ engine: e }),

  registerWatchSlot: (el) => set({ watchSlot: el }),

  registerMiniFrame: (el) => set({ miniFrame: el }),

  dockMini: () => {
    if (get().mode === "direct") set({ miniOpen: true });
  },

  undockMini: () => set({ miniOpen: false }),

  closeMini: () => {
    get().engine?.stop();
    set({ miniOpen: false });
  },

  expandMini: () => {
    const { videoId, miniOpen } = get();
    if (!videoId || !miniOpen) return;
    const r = useRouterStore.getState().route;
    if (r.name === "watch" && r.v === videoId) {
      // scroll-past case: the watch page is already there — just undock and
      // scroll the player back into view (no duplicate history entry)
      set({ miniOpen: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      get().navigateWatch(videoId);
    }
  },

  pauseAndDock: () => {
    const { engine, miniOpen } = get();
    engine?.pause();
    set({ wasMini: miniOpen, miniOpen: false });
  },

  reopenIfWasMini: () => {
    if (get().wasMini) set({ wasMini: false, miniOpen: true });
    else set({ wasMini: false });
  },

  advance: () => {
    const { queue, playedIds } = get();
    // [A7] only with an up-next; WatchPage gates this on the autoplay pref
    const next = queue.find(q => !playedIds.includes(q.id)) || queue[0];
    if (!next) return;
    set({
      countdown: {
        nextId: next.id,
        nextTitle: next.title || "",
        nextThumb: next.thumb || "",
        nextChannel: next.channel || "",
        until: Date.now() + COUNTDOWN_MS,
      },
    });
  },

  cancelCountdown: () => set({ countdown: null }),

  nextTrack: () => {
    const { queue, countdown, playedIds } = get();
    set({ countdown: null });
    const next = (countdown?.nextId && queue.find(q => q.id === countdown.nextId)) || queue[0];
    if (next && next.id !== get().videoId) get().navigateWatch(next.id);
    else if (next?.id === get().videoId) get().engine?.restart();
  },

  prevTrack: () => {
    const { playedIds, videoId } = get();
    set({ countdown: null });
    // queue-1: the most recent OTHER video; empty history → restart current
    const prev = [...playedIds].reverse().find(id => id !== videoId);
    if (prev) get().navigateWatch(prev);
    else get().engine?.restart();
  },

  navigateWatch: (id) => {
    if (typeof window === "undefined") return;
    const route: Route = { name: "watch", v: id };
    const url = `/?v=${encodeURIComponent(id)}`;
    window.history.pushState({}, "", url);
    useRouterStore.getState().setRoute(route);
    window.scrollTo({ top: 0 });
  },

  seekTo: (seconds) => {
    get().engine?.seekTo(seconds);
  },
}));

// ---- [A3] route-based Shorts enforcement + navigation mini-dock ----
// The store (not the components) watches the router: entering the shorts
// route pauses + docks the surface; leaving reopens the mini only if it was
// open. Navigating from watch to any other normal page docks the mini while
// playback is running (the original plan's navigation-continuity rule).
let lastRoute: Route | null = null;
export function initPlaybackRouting() {
  if (typeof window === "undefined") return;
  if (lastRoute) return; // idempotent per app session
  lastRoute = useRouterStore.getState().route;
  useRouterStore.subscribe(s => {
    const prev = lastRoute;
    lastRoute = s.route;
    if (!prev) return;
    if (prev.name === s.route.name) return; // same-page nav: load() handles it
    const st = usePlayback.getState();
    if (s.route.name === "shorts" && prev.name !== "shorts") {
      st.pauseAndDock();
      return;
    }
    if (prev.name === "shorts" && s.route.name !== "shorts") {
      st.reopenIfWasMini();
      return;
    }
    if (prev.name === "watch" && s.route.name !== "watch" && s.route.name !== "shorts") {
      // leaving watch for a normal page: keep playback via the mini; a paused
      // video parks silently instead (desktop-YouTube behavior)
      if (st.mode === "direct" && st.playing && st.videoId) st.dockMini();
    }
  });
}
