"use client";

// VideoSurface (phase 2, [A1]) — the ONE persistent direct-mode player.
//
// It owns a single <video> element created imperatively (never in React's
// reconcile tree) and ADOPTS it into the active mount point — the watch slot
// or the miniplayer frame — via container.appendChild. Because neither the
// element nor this component ever unmounts across route changes, playback
// continuity is free: hls instance, position, MediaSession and all phase-1
// wiring (audio focus, becoming-noisy, keepAwake, seek-drag scrubbing,
// storyboard previews, chapters, captions, long-press 2x, quality prefs)
// survive every navigation. React renders only the chrome around an adoption
// <div>; the chrome is portaled into the watch slot while docked there, and
// the MiniPlayer renders its own chrome around its frame while docked there.
//
// Owner rule ([A2]/[A3]): the surface is the only direct-mode player. Embed
// fallbacks park it; entering the Shorts route pauses + docks it (the store's
// route watcher does that — see yt-playback.ts).

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { fetchVideo, isAudioOnly } from "@/lib/yt-api";
import type { YtVideoFull, YtFormat, SbSegment } from "@/lib/yt-api";
import { absStream, fetchSponsorBlock } from "@/lib/yt-api";
import { formatTime } from "@/lib/yt-format";
import { useYt } from "@/lib/yt-store";
import { usePlayback } from "@/lib/yt-playback";
import { useRouter, useRouterStore } from "@/lib/yt-router";
import {
  addControlListener, nativeBackgroundDisable, nativeBackgroundEnable, nativeBackgroundUpdate, isNativeApp,
  nativeKeepAwake, nativeEnterPip, nativeSetPipOnHome,
  setMediaHandlers, setMediaMetadata, setMediaPlaybackState, setMediaPositionState, clearMediaHandlers,
} from "@/lib/yt-native";
import { CountdownCard } from "./CountdownCard";
import { useBackGuard } from "@/lib/yt-backbutton";
import {
  Play, Pause, SkipForward, Volume2, Volume1, VolumeX, Maximize, Minimize,
  Settings, Subtitles, ArrowLeft, Gauge, Check, ChevronRight, ChevronLeft, PictureInPicture2, Headphones,
  RotateCcw, RotateCw,
} from "lucide-react";

// ---- THE single <video> element ([A1]) ----
// Created once per app session, imperatively — never in React's reconcile
// tree, so React can never remove it. A media element REMOVED from a
// document is paused by the browser (HTML spec), which is why it only ever
// changes parents via appendChild (an atomic in-document move): watch slot ↔
// miniplayer frame ↔ the always-mounted holder below. Every "park" lands in
// the holder (in-document, 1px, invisible), never detached.
let surfaceVideoEl: HTMLVideoElement | null = null;
let surfaceHolderEl: HTMLDivElement | null = null;

function getSurfaceVideo(): HTMLVideoElement {
  if (!surfaceVideoEl) {
    const el = document.createElement("video");
    el.playsInline = true;
    el.muted = true; // autoplay policy: muted start, gesture unmutes
    el.autoplay = true;
    el.setAttribute("data-player-surface", "1");
    // Tailwind's scanner picks these literals up from this file like any other
    el.className = "w-full h-full object-contain bg-black";
    surfaceVideoEl = el;
  }
  return surfaceVideoEl;
}

/** Atomic in-document move. No-op if already there. */
function moveSurfaceVideo(target: HTMLElement) {
  const el = surfaceVideoEl;
  if (!el || el.parentElement === target) return;
  target.appendChild(el);
}

/** Park into the always-mounted holder. Called from host ref-callbacks
 * BEFORE the host's DOM is removed (React nulls refs before running effect
 * cleanups — only a ref callback still sees the element at that point). */
function parkSurfaceVideo() {
  if (surfaceHolderEl) moveSurfaceVideo(surfaceHolderEl);
}

/** Park only when the video currently lives inside `host` — unmounting a
 * host the video is NOT in (e.g. the mini closing while the video already
 * returned to the watch slot) must not yank it out. */
export function parkSurfaceVideoIfInside(host: HTMLElement | null) {
  const el = surfaceVideoEl;
  if (!el || !host) return;
  if (el === host || host.contains(el)) parkSurfaceVideo();
}

export default function VideoSurface() {
  // ---- playback store (the phase-2 slice) ----
  const video = usePlayback(s => s.video);
  const videoId = usePlayback(s => s.videoId);
  const startAt = usePlayback(s => s.startAt);
  const mode = usePlayback(s => s.mode);
  const miniOpen = usePlayback(s => s.miniOpen);
  const watchSlot = usePlayback(s => s.watchSlot);
  const miniFrame = usePlayback(s => s.miniFrame);
  const docked = usePlayback(s => s.docked);
  const queueLen = usePlayback(s => s.queue.length);
  const nextTrack = usePlayback(s => s.nextTrack);
  const setDocked = usePlayback(s => s.setDocked);
  const registerEngine = usePlayback(s => s.registerEngine);
  const setEngineMirror = usePlayback(s => s.setEngineMirror);
  const { route: { name: routeName } } = useRouter();

  // ---- preferences ----
  const autoplay = useYt(s => s.prefs.autoplay);
  const setAutoplay = useYt(s => s.setPrefs);
  const backgroundPlay = useYt(s => s.prefs.backgroundPlay);
  const audioOnly = useYt(s => s.prefs.audioOnly);
  const dataSaver = useYt(s => !!s.prefs.dataSaver);
  const defaultQuality = useYt(s => s.prefs.defaultQuality || "auto");
  const pipOnHome = useYt(s => s.prefs.pipOnHome !== false);

  // ---- THE video element: created once, adopted, never re-parented by React ----
  const videoRef = useRef<HTMLVideoElement | null>(null);
  if (typeof document !== "undefined" && !videoRef.current) {
    videoRef.current = getSurfaceVideo();
  }

  // the always-mounted in-document holder (the park target)
  const holderRefCb = useCallback((el: HTMLDivElement | null) => {
    surfaceHolderEl = el;
    if (el && surfaceVideoEl && !surfaceVideoEl.isConnected) el.appendChild(surfaceVideoEl);
  }, []);

  // the adoption div inside the portaled chrome (the watch mount point)
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manifestOkRef = useRef(false);

  // ---- local chrome state (store mirrors only what other components read) ----
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<null | "main" | "speed" | "quality" | "captions">(null);
  useBackGuard("player-menu", menu !== null, () => setMenu(null));
  const [levels, setLevels] = useState<{ index: number; label: string; height: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState<YtVideoFull["captions"]>([]);
  const [activeCaption, setActiveCaption] = useState<string>("");
  const [sbSegments, setSbSegments] = useState<SbSegment[]>([]);
  const [sbToast, setSbToast] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [ripple, setRipple] = useState<{ dir: "fwd" | "back"; key: number } | null>(null);
  const rippleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapRef = useRef<{ t: number; zone: "left" | "right" | "mid" } | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [longPress2x, setLongPress2x] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedRef = useRef(1);
  const preDuckVolRef = useRef<number | null>(null);
  const pickCaptionRef = useRef<(lang: string) => void>(() => {});
  const captionsRef = useRef<YtVideoFull["captions"]>([]);
  const activeCaptionRef = useRef("");

  // refs mirroring reactive values for stable event listeners
  const autoplayRef = useRef(autoplay);
  const routeRef = useRef(routeName);
  const dockedRef = useRef(docked);
  const startedRef = useRef(started);
  useEffect(() => { autoplayRef.current = autoplay; routeRef.current = routeName; dockedRef.current = docked; startedRef.current = started; });

  const bgActiveRef = useRef(false);
  const userPausedRef = useRef(false);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastSyncRef = useRef(0);
  const loadedVideoRef = useRef<string>("");

  // ---- format pickers (lifted unchanged) ----
  const fallbackFormat = useMemo(() => {
    if (!video?.formats) return null;
    const combined = video.formats.filter(f => f.has_video && f.has_audio && /mp4/.test(f.mime));
    return combined.sort((a, b) => (b.height || 0) - (a.height || 0)).find(f => (f.height || 0) <= 720) || combined[0] || video.formats.find(f => f.has_video && f.has_audio);
  }, [video?.formats]);
  const audioFormat = useMemo(() => {
    if (!video?.formats) return null;
    const audio = video.formats.filter(f => f.has_audio && !f.has_video && !!f.url);
    const rank = (f: YtFormat) => (/mp4|m4a/.test(f.mime) ? 0 : /webm/.test(f.mime) ? 1 : 2);
    return audio.sort((a, b) => rank(a) - rank(b) || (b.bitrate || 0) - (a.bitrate || 0))[0] || null;
  }, [video?.formats]);
  // audio-only rescue: when only audio formats exist, play them (poster +
  // audio) even when the audioOnly PREF is off — an un-backgroundable embed
  // is strictly worse. effectiveAudio = user pref OR derived audio_only.
  const audioRescue = !!(video && !audioOnly && isAudioOnly(video) && audioFormat?.url);
  const noSource = !!video && mode === "direct" && !video.hls && !fallbackFormat?.url && !( (audioOnly || audioRescue) && audioFormat?.url);

  // no directly-playable stream → ONE cache-busted retry, then the embed ([A2]).
  // Covers direct-mode loads whose formats went stale between fetch and play,
  // and cached server failures older than the short failure TTL.
  const freshRetriedRef = useRef<string>("");
  useEffect(() => {
    if (!noSource || !video) return;
    if (freshRetriedRef.current === video.id) {
      usePlayback.getState().setEmbed(video.id);
      return;
    }
    freshRetriedRef.current = video.id;
    let alive = true;
    (async () => {
      try {
        const v = await fetchVideo(video.id, { fresh: true });
        if (!alive) return;
        if (v && (v.hls || (v.formats || []).some(f => f.url))) {
          usePlayback.getState().load(v, { mode: "direct" });
        } else {
          usePlayback.getState().setEmbed(video.id);
        }
      } catch {
        if (alive) usePlayback.getState().setEmbed(video.id);
      }
    })();
    return () => { alive = false; };
  }, [noSource, video]);

  // poster + captions list follow the store's video
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.poster = video?.thumb_lg || video?.thumb || "";
    setCaptions(video?.captions || []);
    setDuration(video?.duration || 0);
  }, [videoId]);

  // ---- Load source (lifted from VideoPlayer, store-driven, mode-gated) ----
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video || mode !== "direct") return;
    let hls: Hls | null = null;
    manifestOkRef.current = false;

    // same-video toggle (audio mode) keeps position + playing state.
    // NOTE: positionRef/`playing` are captured instead of reading the element
    // — by the time this body runs, the cleanup's hls.destroy() has already
    // reset the element (readyState 0, paused), which used to zero keepPos
    // and kill wasPlaying on every audio-mode swap.
    const sw = usePlayback.getState().modeSwitch;
    const isModeSwitch = !!sw && sw.id === video.id && sw.from === "embed";
    const isToggle = !isModeSwitch && loadedVideoRef.current === video.id;
    loadedVideoRef.current = video.id;
    const keepPos = isToggle ? positionRef.current : 0;
    const wasPlaying = isToggle ? playing : true;
    const resumeAfterLoad = () => {
      const apply = () => {
        if (keepPos > 0.5) {
          try { el.currentTime = keepPos; } catch { /* not seekable yet */ }
        }
        if (wasPlaying) el.play().catch(() => {});
      };
      // ALWAYS defer: a fresh load is in flight (we just set src), and an
      // immediate apply races the load algorithm — which pauses the element
      // and rejects pending play promises, losing both seek and play.
      el.addEventListener("loadedmetadata", apply, { once: true });
    };

    const switchToProgressive = () => {
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      if (fallbackFormat?.url) {
        el.src = absStream(fallbackFormat.url);
        el.play().catch(() => {});
      } else if (audioFormat?.url) {
        // no combined format left, but audio exists — audio beats the embed
        el.src = absStream(audioFormat.url);
        el.play().catch(() => {});
      } else {
        usePlayback.getState().setEmbed(video.id);
      }
    };

    const useAudio = (audioOnly || audioRescue) && audioFormat?.url;
    if (useAudio) {
      const src = absStream(audioFormat!.url!);
      el.src = `${src}${src.includes("?") ? "&" : "?"}_=${Date.now()}`;
      resumeAfterLoad();
    } else if (video.hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        backBufferLength: 30,
        capLevelToPlayerSize: false,
      });
      hlsRef.current = hls;
      const src = absStream(video.hls);
      hls.loadSource(`${src}${src.includes("?") ? "&" : "?"}_=${Date.now()}`);
      hls.attachMedia(el);
      // position restore applies to the hls path too — a same-video reload
      // (returning to a video, prefs change) must not restart from 0
      resumeAfterLoad();
      // Phase-1 quality prefs, applied where the level list actually exists.
      // (Fixed a latent phase-1 bug here: this used to reference the manifest
      // callback's `data` from OUTSIDE the callback — a ReferenceError that
      // killed quality capping AND every hls error listener below it.)
      const applyQualityPrefs = (h: Hls, levels: { height?: number; frameRate?: number; name?: string }[]) => {
        const target = dataSaver ? 360 : (typeof defaultQuality === "number" ? defaultQuality : 0);
        if (!target) { h.autoLevelCapping = -1; return; }
        let cap = -1;
        levels.forEach((l, i) => {
          const h60 = (l.frameRate || 0) > 50 || /60/.test(l.name || "");
          if (l.height && l.height <= target && !(dataSaver && h60)) cap = i;
        });
        h.autoLevelCapping = cap;
      };
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        manifestOkRef.current = true;
        const lv = data.levels
          .map((l, i) => ({ index: i, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)}kbps`, height: l.height || 0 }))
          .sort((a, b) => b.height - a.height);
        setLevels(lv);
        const h2 = hlsRef.current;
        if (h2) {
          h2.startLoad(-1);
          applyQualityPrefs(h2, data.levels);
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setCurrentLevel(hlsRef.current?.autoLevelEnabled ? -1 : data.level));
      let netErrors = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          netErrors++;
          if (!manifestOkRef.current) {
            if (netErrors >= 2 || data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
              switchToProgressive();
              return;
            }
            hls?.startLoad();
            return;
          }
          if (netErrors <= 2) { hls?.startLoad(); return; }
          switchToProgressive();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls?.recoverMediaError();
        } else {
          usePlayback.getState().setEmbed(video.id);
        }
      });
    } else if (video.hls && el.canPlayType("application/vnd.apple.mpegurl")) {
      const src2 = absStream(video.hls);
      el.src = `${src2}${src2.includes("?") ? "&" : "?"}_=${Date.now()}`;
      resumeAfterLoad();
    } else if (fallbackFormat?.url) {
      el.src = absStream(fallbackFormat.url);
      resumeAfterLoad();
    }

    return () => {
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
    // PRIMITIVE deps on purpose: a refetch of the SAME video produces new
    // formats arrays (new memo identities) but identical URLs — reloading the
    // stream then would reset position on every return visit, which is the
    // exact continuity this phase exists to protect.
  }, [videoId, video?.hls, mode, fallbackFormat?.url, audioOnly, audioRescue, audioFormat?.url, dataSaver, defaultQuality]);

  // ---- startAt: applied once the NEW source has metadata ----
  useEffect(() => {
    const el = videoRef.current;
    if (!el || mode !== "direct" || !startAt) return;
    let applied = false;
    const apply = () => { if (applied) return; applied = true; if (el.currentTime < 0.1) el.currentTime = startAt; };
    if (el.readyState >= 1) apply();
    else el.addEventListener("loadedmetadata", apply, { once: true });
    return () => el.removeEventListener("loadedmetadata", apply);
  }, [videoId, startAt, mode]);

  // ---- Captions tracks (children of the video element — survive adoption) ----
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video?.captions?.length) return;
    video.captions.forEach(c => {
      const t = document.createElement("track");
      t.kind = "subtitles";
      t.label = c.name || c.lang;
      t.srclang = c.lang;
      t.src = absStream(c.url);
      el.appendChild(t);
    });
    return () => {
      el.querySelectorAll("track").forEach(t => t.remove());
    };
  }, [videoId, video?.captions]);

  // ---- SponsorBlock ----
  useEffect(() => {
    if (!videoId) return;
    let alive = true;
    fetchSponsorBlock(videoId)
      .then(r => { if (alive && r.segments?.length) setSbSegments(r.segments); })
      .catch(() => {});
    return () => { alive = false; };
  }, [videoId]);

  // ---- Big-tap to start (unmute + play) — the gesture that may go audible ----
  const ensureBgEnabled = useCallback(() => {
    if (!backgroundPlay || bgActiveRef.current) return;
    bgActiveRef.current = true;
    nativeBackgroundEnable({
      title: video?.title || "YouTube",
      artist: video?.channel || "",
      artwork: video?.thumb_lg || video?.thumb || "",
      duration: durationRef.current || video?.duration || 0,
    });
  }, [backgroundPlay, video?.title, video?.channel, video?.thumb_lg, video?.thumb, video?.duration]);

  const userStart = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    setMuted(false);
    el.volume = volume;
    el.play().catch(() => {});
    setStarted(true);
    ensureBgEnabled();
    nativeKeepAwake(true);
  }, [volume, ensureBgEnabled]);

  // ---- Media events (mirrors playing/current/… into the store) ----
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const mirror = (m: Parameters<typeof setEngineMirror>[0]) => setEngineMirror(m);
    const onTime = () => {
      setCurrent(el.currentTime);
      positionRef.current = el.currentTime;
      durationRef.current = el.duration || durationRef.current;
      if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
      // history progress (WatchPage's old onProgress contract)
      if (el.duration > 0 && Math.floor(el.currentTime) % 5 === 0) {
        useYt.getState().setProgress(usePlayback.getState().videoId, el.currentTime, el.duration);
      }
      if (Math.abs(el.currentTime - lastSyncRef.current) > 5) {
        lastSyncRef.current = el.currentTime;
        if (bgActiveRef.current) {
          nativeBackgroundUpdate({ playing: !el.paused, position: el.currentTime, duration: el.duration || 0 });
        }
        setMediaPositionState(el.currentTime, el.duration || 0, el.playbackRate);
      }
      if (sbSegments.length) {
        for (const s of sbSegments) {
          if (s.action === "skip" && el.currentTime >= s.start && el.currentTime < s.end - 0.2) {
            el.currentTime = s.end;
            setSbToast(`Skipped ${s.category.replace(/_/g, " ")}`);
            setTimeout(() => setSbToast(null), 2200);
          }
        }
      }
    };
    const onDur = () => { if (el.duration && isFinite(el.duration)) { setDuration(el.duration); mirror({ duration: el.duration }); } };
    const onPlay = () => {
      setPlaying(true);
      setWaiting(false);
      mirror({ playing: true, waiting: false });
      // the autoplay attribute was only needed for the muted boot play; from
      // here every play is explicit. Left in place it would re-trigger and
      // unpause a user-paused video whenever it is re-adopted.
      if (el.hasAttribute("autoplay")) el.removeAttribute("autoplay");
    };
    const onPause = () => { setPlaying(false); mirror({ playing: false }); };
    const onWait = () => { setWaiting(true); mirror({ waiting: true }); };
    const onPlaying = () => { setWaiting(false); mirror({ waiting: false }); };
    const onEnd = () => {
      setPlaying(false);
      mirror({ playing: false });
      // [A7] countdown ownership lives in the store; the surface just reports
      const st = usePlayback.getState();
      if (autoplayRef.current && st.mode === "direct") st.advance();
    };
    const onVol = () => { setVolume(el.volume); setMuted(el.muted); };
    const onErr = () => { setError("Stream error — try reloading"); setWaiting(false); mirror({ error: "Stream error" }); };
    const onProg = () => setBuffered(el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("progress", onProg);
    el.addEventListener("loadedmetadata", onDur);
    el.addEventListener("durationchange", onDur);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("waiting", onWait);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("ended", onEnd);
    el.addEventListener("volumechange", onVol);
    el.addEventListener("error", onErr);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("progress", onProg);
      el.removeEventListener("loadedmetadata", onDur);
      el.removeEventListener("durationchange", onDur);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("waiting", onWait);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("volumechange", onVol);
      el.removeEventListener("error", onErr);
    };
  }, [sbSegments, setEngineMirror]);

  // ---- MediaSession metadata ([A2]: cleared while embed is the player) ----
  useEffect(() => {
    if (mode === "direct" && video) {
      setMediaMetadata({
        title: video.title || "YouTube",
        artist: video.channel || "",
        artwork: video.thumb_lg || video.thumb || "",
        duration: duration || video.duration || 0,
      });
    } else if (mode !== "direct") {
      setMediaMetadata({ title: "", artist: "", artwork: "" });
    }
  }, [videoId, mode, video?.title, video?.channel, video?.thumb_lg, video?.thumb, video?.duration, duration]);

  // playback state + notification sync + keepAwake (lifted)
  useEffect(() => {
    if (mode !== "direct") return;
    setMediaPlaybackState(playing);
    if (bgActiveRef.current) {
      nativeBackgroundUpdate({ playing, position: positionRef.current, duration: durationRef.current, title: video?.title, artist: video?.channel });
    }
    nativeKeepAwake(playing);
  }, [playing, mode, video?.title, video?.channel]);

  // the service keeps in sync with an active session (never enables alone)
  useEffect(() => {
    if (!backgroundPlay || mode !== "direct") {
      if (bgActiveRef.current) {
        bgActiveRef.current = false;
        nativeBackgroundDisable();
      }
      return;
    }
    if (!bgActiveRef.current) return;
    nativeBackgroundUpdate({
      playing,
      position: positionRef.current,
      duration: durationRef.current || video?.duration || 0,
      title: video?.title || "YouTube",
      artist: video?.channel || "",
    });
  }, [playing, started, backgroundPlay, mode, videoId, video?.title, video?.channel, video?.duration]);

  // backgrounding: resume a WebView-induced pause + re-assert the service
  // ([A3] gated: never while the Shorts feed owns the audio)
  useEffect(() => {
    if (!isNativeApp()) return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" || !backgroundPlay) return;
      if (routeRef.current === "shorts") return;
      const st = usePlayback.getState();
      // embed mode: one handoff attempt to move the video onto the direct
      // player (the iframe cannot background). Capped by handoffAttempts
      // (once per id per TTL) + the server's fresh=1 cooldown.
      if (st.mode === "embed") {
        const id = st.videoId;
        const att = st.handoffAttempts[id];
        if (!id || (att && att.outcome !== "pending")) return;
        if (st.embedController && st.embedController.getPlayerState() === 0) return; // ENDED
        void (async () => {
          try {
            const v = await fetchVideo(id, { fresh: true });
            usePlayback.getState().handoffEmbedToDirect(v, {
              onStarted: () => {
                const el = videoRef.current;
                if (!el) return;
                // the user was watching the embed AUDIBLY — continue unmuted
                el.muted = false;
                setMuted(false);
                setStarted(true);
                el.play().catch(() => { /* autoplay policy: notification Play starts it */ });
                ensureBgEnabled();
              },
            });
          } catch { /* fetch failed — embed stays, nothing to do */ }
        })();
        return;
      }
      if (st.mode !== "direct") return;
      const el = videoRef.current;
      if (!el) return;
      if (el.paused && !userPausedRef.current && !el.ended) {
        el.play().catch(() => { /* autoplay policy — notification Play still works */ });
      }
      if (!bgActiveRef.current) {
        bgActiveRef.current = true;
        nativeBackgroundEnable({
          title: video?.title || "YouTube",
          artist: video?.channel || "",
          artwork: video?.thumb_lg || video?.thumb || "",
          duration: el.duration || durationRef.current || video?.duration || 0,
        });
      } else {
        nativeBackgroundUpdate({
          playing: !el.paused,
          position: el.currentTime || 0,
          duration: el.duration || durationRef.current || video?.duration || 0,
          title: video?.title || "YouTube",
          artist: video?.channel || "",
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [backgroundPlay, mode, videoId, video?.title, video?.channel, video?.thumb_lg, video?.thumb, video?.duration]);

  // ---- Controls auto-hide ----
  const poke = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !menu) setControlsVisible(false);
    }, 2800);
  }, [menu]);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  // ---- Fullscreen ----
  useEffect(() => {
    const onFs = () => {
      setFullscreen(!!document.fullscreenElement);
      if (!document.fullscreenElement) document.documentElement.classList.remove("yt-lands");
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // landscape → fullscreen (Android)
  useEffect(() => {
    if (!isNativeApp()) return;
    const onOrient = () => {
      const type = (screen.orientation?.type as string) || "";
      const angle = screen.orientation?.angle ?? 0;
      const landscape = /landscape/.test(type) || angle === 90 || angle === 270
        || (type === "" && window.innerWidth > window.innerHeight * 1.2);
      if (landscape && !document.fullscreenElement) {
        document.documentElement.classList.add("yt-lands");
        containerRef.current?.requestFullscreen?.().catch(() => {});
      } else if (!landscape && document.fullscreenElement) {
        document.documentElement.classList.remove("yt-lands");
        document.exitFullscreen().catch(() => {});
      }
    };
    screen.orientation?.addEventListener?.("change", onOrient);
    return () => screen.orientation?.removeEventListener?.("change", onOrient);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen?.();
  }, []);

  // ---- Actions ----
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      userPausedRef.current = false;
      if (!started) userStart();
      else { el.play().catch(() => {}); ensureBgEnabled(); }
    } else { userPausedRef.current = true; el.pause(); }
  }, [started, userStart, ensureBgEnabled]);

  const pause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    userPausedRef.current = true;
    el.pause();
    // mirror directly: an internal reset (e.g. hls destroy on an embed
    // handoff) can leave the element paused WITHOUT a 'pause' event, and a
    // stale playing=true would keep the mini showing a play/pause lie
    setPlaying(false);
    setEngineMirror({ playing: false });
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const el = videoRef.current;
    if (!el || !isFinite(seconds)) return;
    usePlayback.getState().cancelCountdown(); // [A7] a manual seek clears it
    el.currentTime = Math.max(0, Math.min((el.duration || duration) - 0.2, seconds));
    poke();
  }, [duration, poke]);

  const seekBy = useCallback((d: number) => {
    const el = videoRef.current;
    if (!el) return;
    usePlayback.getState().cancelCountdown();
    el.currentTime = Math.max(0, Math.min((el.duration || duration) - 0.2, el.currentTime + d));
    poke();
  }, [duration, poke]);

  const restart = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    usePlayback.getState().cancelCountdown();
    el.currentTime = 0;
    userPausedRef.current = false;
    if (!started) userStart();
    else { el.play().catch(() => {}); ensureBgEnabled(); }
  }, [started, userStart, ensureBgEnabled]);

  const stop = useCallback(() => {
    const el = videoRef.current;
    userPausedRef.current = true;
    el?.pause();
    nativeKeepAwake(false);
    if (bgActiveRef.current) {
      bgActiveRef.current = false;
      nativeBackgroundDisable();
    }
    setPlaying(false);
    setEngineMirror({ playing: false });
  }, [setEngineMirror]);

  const setVol = useCallback((v: number) => {
    const el = videoRef.current;
    if (el) { el.muted = false; el.volume = v; setMuted(false); setVolume(v); }
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (el) {
      el.muted = !el.muted;
      setMuted(el.muted);
      if (!el.muted) {
        ensureBgEnabled();
        if (el.volume === 0) setVol(0.5);
      }
    }
  }, [setVol, ensureBgEnabled]);

  // ---- Engine registration: every UI goes through store actions ([A1]) ----
  useEffect(() => {
    const engine = { togglePlay, pause, seekTo, seekBy, restart, toggleMute, stop };
    registerEngine(engine);
    return () => {
      if (usePlayback.getState().engine === engine) registerEngine(null);
    };
  }, [togglePlay, pause, seekTo, seekBy, restart, toggleMute, stop, registerEngine]);

  // ---- Double-tap seek + tap semantics (lifted) ----
  const showRipple = useCallback((dir: "fwd" | "back") => {
    const key = Date.now();
    setRipple({ dir, key });
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
    rippleTimer.current = setTimeout(() => setRipple(null), 700);
  }, []);

  const zoneAt = useCallback((clientX: number): "left" | "right" | "mid" => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return "mid";
    return clientX < rect.left + rect.width * 0.4 ? "left" : clientX > rect.right - rect.width * 0.4 ? "right" : "mid";
  }, []);

  const singleTapAction = useCallback(() => {
    if (!controlsVisible) { poke(); return; }
    togglePlay();
  }, [controlsVisible, poke, togglePlay]);

  const onSurfaceTap = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).dataset.playerSurface) return;
    singleTapAction();
  }, [singleTapAction]);

  const onSurfaceTouch = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length > 0 || !(e.target as HTMLElement).dataset.playerSurface) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const zone = zoneAt(t.clientX);
    const now = Date.now();
    const last = tapRef.current;
    if (last && now - last.t < 320 && zone !== "mid" && last.zone === zone) {
      e.preventDefault();
      tapRef.current = null;
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      seekBy(zone === "left" ? -10 : 10);
      showRipple(zone === "left" ? "back" : "fwd");
      return;
    }
    tapRef.current = { t: now, zone };
    e.preventDefault();
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(singleTapAction, 260);
  }, [zoneAt, seekBy, showRipple, singleTapAction]);

  // long-press 2× (lifted)
  const onSurfaceTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).dataset.playerSurface) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      const el = videoRef.current;
      if (!el || el.paused) return;
      speedRef.current = el.playbackRate;
      el.playbackRate = 2;
      setLongPress2x(true);
    }, 500);
  }, []);
  const endLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (longPress2x) {
      const el = videoRef.current;
      if (el) el.playbackRate = speedRef.current || 1;
      setLongPress2x(false);
    }
  }, [longPress2x]);
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
  }, []);

  // ---- Keyboard (gated: nothing while parked — Shorts owns its keys) ----
  useEffect(() => {
    if (docked === "parked") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      switch (e.key) {
        case " ": case "k": e.preventDefault(); togglePlay(); break;
        case "ArrowRight": e.preventDefault(); seekBy(5); break;
        case "ArrowLeft": e.preventDefault(); seekBy(-5); break;
        case "j": seekBy(-10); break;
        case "l": seekBy(10); break;
        case "f": e.preventDefault(); toggleFullscreen(); break;
        case "m": toggleMute(); break;
        case "c": {
          const caps = captionsRef.current;
          pickCaptionRef.current(activeCaptionRef.current ? "" : (caps?.[0]?.lang || ""));
          break;
        }
        case "ArrowUp": e.preventDefault(); setVol(Math.min(1, volume + 0.1)); break;
        case "ArrowDown": e.preventDefault(); setVol(Math.max(0, volume - 0.1)); break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            const el = videoRef.current;
            if (el && el.duration) el.currentTime = (parseInt(e.key) / 10) * el.duration;
          }
      }
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docked, togglePlay, seekBy, toggleFullscreen, toggleMute, setVol, volume, poke]);

  // ---- Lock-screen / notification / headset controls ([A3]-gated) ----
  // Handlers are bound persistently but no-op while the Shorts feed is the
  // active player; VideoSurface mounts before page content in AppShell, so
  // Shorts' own (ungated) bindings overwrite these while it is on screen and
  // this effect rebinds when the route leaves Shorts.
  useEffect(() => {
    const resume = () => {
      const el = videoRef.current;
      userPausedRef.current = false;
      if (el && el.paused) { if (!startedRef.current) userStart(); else { el.play().catch(() => {}); ensureBgEnabled(); } }
    };
    const notShorts = () => routeRef.current !== "shorts" && usePlayback.getState().mode === "direct";
    setMediaHandlers({
      play: () => { if (notShorts()) resume(); },
      pause: () => { if (notShorts()) pause(); },
      next: () => { if (notShorts()) usePlayback.getState().nextTrack(); },
      prev: () => { if (notShorts()) usePlayback.getState().prevTrack(); },
      seek: (to) => { if (notShorts()) seekTo(to); },
      seekBy: (d) => { if (notShorts()) seekBy(d); },
    });
    const off = addControlListener((e) => {
      if (!notShorts()) return;
      const el = videoRef.current;
      if (e.action === "play") resume();
      else if (e.action === "pause") pause();
      else if (e.action === "next") usePlayback.getState().nextTrack();
      else if (e.action === "prev") usePlayback.getState().prevTrack();
      else if (e.action === "stop") usePlayback.getState().closeMini(); // stop = pause + service teardown + mini closed
      else if (e.action === "duck") {
        if (el && preDuckVolRef.current == null) { preDuckVolRef.current = el.volume; el.volume = 0.2; }
      } else if (e.action === "unduck") {
        if (el && preDuckVolRef.current != null) { el.volume = preDuckVolRef.current; preDuckVolRef.current = null; }
      } else if (e.action === "seek" && e.seekTo != null && el) {
        usePlayback.getState().cancelCountdown();
        el.currentTime = Math.max(0, Math.min((el.duration || 0) - 0.2, e.seekTo));
        poke();
      }
    });
    return () => { off(); clearMediaHandlers(); };
  }, [started, userStart, ensureBgEnabled, pause, seekTo, seekBy, poke, routeName]);

  // ---- [A4] scroll-past dock: IO on the watch slot, owned here (persistent) ----
  useEffect(() => {
    if (!watchSlot) return;
    const io = new IntersectionObserver(entries => {
      const st = usePlayback.getState();
      const r = useRouterStore.getState().route;
      // the IO also fires when the slot is REMOVED (navigation) with ratio 0 —
      // that is not a scroll. Dock/undock only while this slot's video is the
      // one on the watch route.
      if (r.name !== "watch" || r.v !== st.videoId) return;
      for (const e of entries) {
        if (e.intersectionRatio < 0.15) st.dockMini();
        else st.undockMini();
      }
    }, { threshold: [0, 0.15] });
    io.observe(watchSlot);
    return () => io.disconnect();
  }, [watchSlot]);

  // ---- [A1] adoption: appendChild the video element into the active mount ----
  // Targets are the REAL host elements (the watch slot div rendered by
  // WatchPage, the mini frame rendered by MiniPlayer) — never anything inside
  // a portal React could unmount out from under the video.
  const portalVisible = !!(watchSlot && !miniOpen && mode === "direct" && videoId);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let target: HTMLElement | null = null;
    if (mode === "direct" && routeName !== "shorts") {
      if (miniOpen && miniFrame) target = miniFrame;
      else if (portalVisible && watchSlot) target = watchSlot;
    }
    if (target) {
      moveSurfaceVideo(target);
      setDocked(miniOpen ? "mini" : "watch");
    } else if (!el.isConnected && surfaceHolderEl) {
      // detached (only at creation) → into the holder; never a document exit
      surfaceHolderEl.appendChild(el);
      setDocked("parked");
    } else {
      // still inside a live host that is about to unregister (its ref
      // callback parks the video before the host leaves the document)
      setDocked("parked");
    }
  }, [mode, routeName, miniOpen, miniFrame, watchSlot, portalVisible, setDocked]);

  // ---- [A7] countdown timer: fires the up-next navigation ----
  const countdown = usePlayback(s => s.countdown);
  useEffect(() => {
    if (!countdown) return;
    const t = setTimeout(() => usePlayback.getState().nextTrack(), Math.max(0, countdown.until - Date.now()) + 30);
    return () => clearTimeout(t);
  }, [countdown?.until, countdown?.nextId, countdown]);

  // ---- PiP: pref push + Android home-press is native-only ([A5]) ----
  useEffect(() => {
    if (isNativeApp()) nativeSetPipOnHome(pipOnHome);
  }, [pipOnHome]);

  // ---- seek bar (lifted) ----
  const displayTime = scrubbing ? scrubTime : current;
  const pct = duration > 0 ? (displayTime / duration) * 100 : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  const sbPreview = useMemo(() => {
    const sb = video?.storyboard;
    if (!sb || hoverTime == null || !duration) return null;
    const idx = Math.max(0, Math.floor(hoverTime / sb.interval));
    const perSheet = sb.columns * sb.rows;
    const sheet = Math.floor(idx / perSheet);
    const inSheet = idx % perSheet;
    const col = inSheet % sb.columns;
    const row = Math.floor(inSheet / sb.columns);
    const pattern = sb.templateUrlPattern || sb.template_url || "";
    if (!pattern.includes("$M$")) return null;
    return { url: pattern.replace("$M$", String(sheet)), col, row, cols: sb.columns, rows: sb.rows };
  }, [video?.storyboard, hoverTime, duration]);

  const activeChapter = useMemo(() => {
    const ch = video?.chapters || [];
    if (ch.length < 2) return null;
    let cur = ch[0];
    for (const c of ch) if (displayTime >= c.start) cur = c;
    return cur;
  }, [video?.chapters, displayTime]);

  const scrubAt = useCallback((clientX: number, bar: HTMLElement) => {
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const t = ratio * (duration || 0);
    setScrubTime(t);
    setHoverTime(t);
  }, [duration]);

  const onSeekPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    scrubAt(e.clientX, e.currentTarget);
    poke();
  }, [scrubAt, poke]);

  const onSeekPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing) scrubAt(e.clientX, e.currentTarget);
    else {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      setHoverTime(ratio * (duration || 0));
    }
  }, [scrubbing, scrubAt, duration]);

  const commitScrub = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const el = videoRef.current;
    usePlayback.getState().cancelCountdown();
    if (el && duration) el.currentTime = ratio * duration;
    setScrubbing(false);
    poke();
  }, [scrubbing, duration, poke]);

  // ---- quality / speed / captions (lifted) ----
  const pickLevel = (index: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
      setCurrentLevel(index);
    }
    setMenu(null);
  };
  const pickSpeed = (s: number) => {
    const el = videoRef.current;
    if (el) el.playbackRate = s;
    speedRef.current = s;
    setSpeed(s);
    setMenu(null);
  };
  const pickCaption = useCallback((lang: string) => {
    const el = videoRef.current;
    if (el) {
      Array.from(el.textTracks).forEach(t => t.mode = "disabled");
      if (lang) {
        const track = Array.from(el.textTracks).find(t => t.language === lang);
        if (track) track.mode = "showing";
      }
    }
    setActiveCaption(lang);
    setMenu(null);
  }, []);
  pickCaptionRef.current = pickCaption;
  captionsRef.current = captions;
  activeCaptionRef.current = activeCaption;

  // ---- debug surface (?debug=1) ----
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("debug") !== "1") return;
      (window as unknown as { __ytDebug?: Record<string, unknown> }).__ytDebug = {
        videoId,
        mode: (audioOnly || audioRescue) && audioFormat ? "audio" : (video?.hls ? "hls" : (fallbackFormat ? "progressive" : "none")),
        formatCount: video?.formats?.length || 0,
        hasStoryboard: !!video?.storyboard,
        chapters: video?.chapters?.length || 0,
        levels: levels.map(l => l.label),
        dataSaver, defaultQuality,
        docked, miniOpen,
      };
    } catch { /* not in a browser */ }
  }, [video, videoId, audioOnly, audioFormat, fallbackFormat, levels, dataSaver, defaultQuality, docked, miniOpen]);

  // ---- E2E hook: drive the persistent surface from tests ----
  useEffect(() => {
    (window as unknown as { __ytPlayback?: typeof usePlayback }).__ytPlayback = usePlayback;
  }, []);

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // ---- THE PORTALED CHROME (renders only while docked to the watch slot) ----
  if (!video) {
    return (
      // the holder must exist before any video loads — it is the park target
      <div ref={holderRefCb} className="fixed top-0 left-0 w-px h-px overflow-hidden opacity-0 pointer-events-none" aria-hidden="true" />
    );
  }
  if (!portalVisible) {
    return (
      <div ref={holderRefCb} className="fixed top-0 left-0 w-px h-px overflow-hidden opacity-0 pointer-events-none" aria-hidden="true" />
    );
  }

  return (
    <>
      <div ref={holderRefCb} className="fixed top-0 left-0 w-px h-px overflow-hidden opacity-0 pointer-events-none" aria-hidden="true" />
      {createPortal(
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden group/player select-none"
      onMouseMove={poke}
      onMouseLeave={() => { if (playing && !menu) setControlsVisible(false); }}
      onClick={onSurfaceTap}
      onTouchEnd={(e) => { endLongPress(); onSurfaceTouch(e); }}
      onTouchStart={onSurfaceTouchStart}
      onTouchMove={endLongPress}
      onTouchCancel={endLongPress}
      onDoubleClick={(e) => { if ((e.target as HTMLElement).dataset.playerSurface) toggleFullscreen(); }}
      data-player-surface="1"
      data-testid="video-surface"
    >
      {/* NOTE: no adoption div — the persistent <video> is appended directly
          into the WATCH SLOT (the portal's parent). This chrome root is
          positioned (absolute) so it paints above the static video while
          staying click-transparent where overlays are absent. */}

      {/* error (no-source hands off to the embed instead — [A2]) */}
      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/90" data-player-surface="1">
          <p className="text-[var(--yt-text-2)] text-sm">{error}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-full bg-[var(--yt-bg-elev2)] text-sm hover:bg-[var(--yt-hover)]">Reload</button>
        </div>
      )}

      {/* double-tap seek ripple */}
      {ripple && (
        <div key={ripple.key} className={`absolute inset-y-0 ${ripple.dir === "fwd" ? "right-0" : "left-0"} w-2/5 z-10 flex items-center justify-center pointer-events-none overflow-hidden`}>
          <div className="absolute w-[130px] h-[130px] rounded-full bg-white/20 yt-seek-ring" />
          <div className="relative flex flex-col items-center gap-1 text-white yt-seek-pop">
            {ripple.dir === "fwd"
              ? <ChevronRight className="w-11 h-11" strokeWidth={2.4} />
              : <ChevronLeft className="w-11 h-11" strokeWidth={2.4} />}
            <span className="text-[13px] font-medium">10 seconds</span>
          </div>
        </div>
      )}

      {/* AUDIO MODE ARTWORK */}
      {(audioOnly || audioRescue) && audioFormat && !error && (
        <div className="absolute inset-0 z-[5] overflow-hidden bg-black" data-player-surface="1" data-testid="audio-mode-art">
          {(video.thumb_lg || video.thumb) && (
            <img src={video.thumb_lg || video.thumb} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40" />
          )}
          <div className="relative h-full flex items-center justify-center gap-4 sm:gap-7 px-5 sm:px-10">
            {(video.thumb_lg || video.thumb) && (
              <img src={video.thumb_lg || video.thumb} alt="" className="w-[42%] max-w-[260px] aspect-video object-cover rounded-lg sm:rounded-xl shadow-2xl shrink-0" />
            )}
            <div className="min-w-0 hidden xs:block max-w-[46%]">
              <p className="text-white text-[15px] sm:text-[17px] font-medium leading-[22px] clamp-2">{video.title}</p>
              {video.channel && <p className="text-white/75 text-[13px] mt-1.5 truncate">{video.channel}</p>}
              <p className="mt-3 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-white/10 text-white text-[12px] font-medium">
                <Headphones className="w-3.5 h-3.5" />{" "}
                {audioOnly ? "Audio mode — data saver" : "Audio only — video stream unavailable from your server"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* waiting spinner */}
      {waiting && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" data-player-surface="1">
          <div className="w-12 h-12 rounded-full border-[3px] border-white/25 border-t-white animate-spin" role="status" aria-label="Loading" />
        </div>
      )}

      {/* unmute nudge */}
      {!error && muted && playing && (
        <button
          onClick={() => toggleMute()}
          className="absolute top-3 left-3 z-20 flex items-center gap-2 px-3 h-9 rounded-lg bg-black/80 text-white text-[13px] hover:bg-black"
        >
          <VolumeX className="w-5 h-5" /> Tap to unmute
        </button>
      )}

      {/* audio-mode indicator */}
      {(audioOnly || audioRescue) && audioFormat && !error && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-black/80 text-white text-[12px] font-medium pointer-events-none">
          <Headphones className="w-4 h-4" /> Audio mode
        </div>
      )}

      {/* long-press 2× chip */}
      {longPress2x && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 h-8 rounded-full bg-black/85 text-white text-[13px] font-medium flex items-center gap-1.5 pointer-events-none" data-testid="longpress-2x">
          <Gauge className="w-4 h-4" /> 2× speed
        </div>
      )}

      {/* sponsorblock toast */}
      {sbToast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-black/85 text-white text-[13px]">
          {sbToast}
        </div>
      )}

      {/* CENTER CONTROLS */}
      {!waiting && !error && (controlsVisible || !playing) && !countdown && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-7 sm:gap-10 pointer-events-none" data-testid="center-controls">
          <button onClick={() => { seekBy(-10); showRipple("back"); }} aria-label="Rewind 10 seconds" title="Rewind 10 seconds" className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform">
            <span className="relative flex items-center justify-center">
              <RotateCcw className="w-12 h-12 sm:w-[52px] sm:h-[52px]" strokeWidth={1.6} />
              <span className="absolute text-[13px] font-semibold pt-1.5">10</span>
            </span>
          </button>
          <button onClick={togglePlay} aria-label={playing ? "Pause (k)" : "Play (k)"} className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform">
            {playing
              ? <Pause className="w-12 h-12 sm:w-[52px] sm:h-[52px]" fill="white" strokeWidth={1} />
              : <Play className="w-12 h-12 sm:w-[52px] sm:h-[52px] ml-1" fill="white" strokeWidth={1} />}
          </button>
          <button onClick={() => { seekBy(10); showRipple("fwd"); }} aria-label="Forward 10 seconds" title="Forward 10 seconds" className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform">
            <span className="relative flex items-center justify-center">
              <RotateCw className="w-12 h-12 sm:w-[52px] sm:h-[52px]" strokeWidth={1.6} />
              <span className="absolute text-[13px] font-semibold pt-1.5">10</span>
            </span>
          </button>
          {queueLen > 0 && (
            <button onClick={() => nextTrack()} aria-label="Next video" title="Next video" className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform">
              <SkipForward className="w-11 h-11 sm:w-12 sm:h-12" fill="white" strokeWidth={1.4} />
            </button>
          )}
        </div>
      )}

      {/* CONTROLS BAR */}
      <div className={`yt-controls absolute left-0 right-0 bottom-0 z-20 yt-scrim-bottom pt-10 pb-1 px-2 sm:px-4 ${(controlsVisible || !playing) && !countdown ? "" : "yt-controls-hidden"}`}>
        {/* chapters row */}
        {activeChapter && (controlsVisible || !playing) && !scrubbing && (
          <div className="flex items-baseline gap-2 px-1 pb-0.5 text-white" data-testid="chapter-row">
            <span className="text-[13px] font-medium truncate max-w-[62%]">{activeChapter.title}</span>
            <span className="text-[12px] text-white/60 tabular-nums">{formatTime(activeChapter.start)}</span>
          </div>
        )}

        {/* seek bar */}
        <div
          className="relative flex items-center cursor-pointer group/seek py-[13px] -my-[6px]"
          style={{ touchAction: "none" }}
          data-testid="seek-bar"
          onPointerDown={onSeekPointerDown}
          onPointerMove={onSeekPointerMove}
          onPointerUp={commitScrub}
          onPointerCancel={commitScrub}
          onMouseLeave={() => { if (!scrubbing) setHoverTime(null); }}
        >
          {hoverTime !== null && (
            <div
              className="absolute z-30 pointer-events-none flex flex-col items-center gap-1"
              style={{ left: `calc(${duration ? (hoverTime / duration) * 100 : 0}% - 40px)`, top: scrubbing ? -64 : -58 }}
              data-testid="seek-bubble"
            >
              {sbPreview ? (
                <div
                  className="w-[80px] h-[45px] rounded-md border border-white/30 bg-black shadow-lg overflow-hidden"
                  style={{
                    backgroundImage: `url(${sbPreview.url})`,
                    backgroundSize: `${sbPreview.cols * 100}% ${sbPreview.rows * 100}%`,
                    backgroundPosition: `${sbPreview.cols > 1 ? (sbPreview.col / (sbPreview.cols - 1)) * 100 : 0}% ${sbPreview.rows > 1 ? (sbPreview.row / (sbPreview.rows - 1)) * 100 : 0}%`,
                  }}
                />
              ) : null}
              <div className="px-1.5 py-0.5 rounded bg-black/90 text-white text-[12px] tabular-nums">{formatTime(hoverTime)}</div>
            </div>
          )}
          <div className={`relative w-full transition-all rounded-full bg-white/25 ${scrubbing ? "h-[5px]" : "h-[3px] group-hover/seek:h-[5px]"}`}>
            <div className="absolute left-0 top-0 h-full bg-white/40 rounded-full" style={{ width: `${bufPct}%` }} />
            <div className="absolute left-0 top-0 h-full yt-progress-played rounded-full" style={{ width: `${pct}%` }} />
            {sbSegments.map((s, i) => (
              <div key={i} className="absolute top-0 h-full bg-[#ffe14d]/70" style={{ left: `${(s.start / duration) * 100}%`, width: `${Math.max(0.5, ((s.end - s.start) / duration) * 100)}%` }} title={`SponsorBlock: ${s.category}`} />
            ))}
            {(video.chapters || []).map((c, i) => (
              <div key={`c${i}`} className="absolute top-0 h-full w-[2px] bg-white/60" style={{ left: `${(c.start / duration) * 100}%` }} title={c.title} />
            ))}
            <div
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-[#ff0000] yt-progress-glow transition-transform ${scrubbing ? "w-[19px] h-[19px]" : "w-[13px] h-[13px]"} ${controlsVisible || scrubbing ? "scale-100" : "scale-0"}`}
              style={{ left: `${pct}%` }}
              data-testid="seek-thumb"
            />
          </div>
        </div>

        {/* buttons row */}
        <div className="flex items-center gap-1 sm:gap-2 text-white">
          <button onClick={togglePlay} aria-label={playing ? "Pause (k)" : "Play (k)"} className="w-10 h-10 flex items-center justify-center hover:opacity-80">
            {playing ? <Pause className="w-7 h-7" fill="white" /> : <Play className="w-7 h-7" fill="white" />}
          </button>
          <button onClick={() => nextTrack()} aria-label="Next video" title="Next video" className={`w-10 h-10 flex items-center justify-center hover:opacity-80 ${queueLen > 0 ? "" : "opacity-40 pointer-events-none"}`}>
            <SkipForward className="w-6 h-6" fill="white" />
          </button>

          <div className="flex items-center group/vol">
            <button onClick={toggleMute} aria-label="Mute (m)" className="w-10 h-10 flex items-center justify-center hover:opacity-80">
              <VolIcon className="w-6 h-6" fill="white" />
            </button>
            <input
              type="range" min={0} max={1} step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => setVol(parseFloat(e.target.value))}
              className="yt-vol w-0 group-hover/vol:w-16 md:w-16 md:group-hover/vol:w-20 transition-all h-[3px] bg-white/30 rounded"
              style={{ background: `linear-gradient(to right, #fff ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.3) ${(muted ? 0 : volume) * 100}%)` }}
              aria-label="Volume"
            />
          </div>

          <span className="text-[13px] tabular-nums ml-1 text-white/95" data-testid="time-display">
            {formatTime(displayTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {captions && captions.length > 0 && (
            <button
              onClick={() => pickCaption(activeCaption ? "" : captions[0].lang)}
              aria-label="Toggle subtitles (c)"
              className={`w-10 h-10 flex items-center justify-center hover:opacity-80 ${activeCaption ? "opacity-100" : "opacity-70"}`}
            >
              <Subtitles className="w-6 h-6" />
            </button>
          )}

          {/* settings menu */}
          <div className="relative">
            <button
              onClick={() => setMenu(menu ? null : "main")}
              aria-label="Settings"
              className={`w-10 h-10 flex items-center justify-center hover:opacity-80 ${menu ? "rotate-45" : ""} transition-transform`}
            >
              <Settings className="w-6 h-6" />
            </button>

            {menu && (
              <div className="absolute bottom-12 right-0 min-w-[220px] rounded-lg bg-[#282828]/95 backdrop-blur text-[#f1f1f1] text-[14px] py-2 shadow-xl border border-white/10">
                {menu === "main" && (
                  <>
                    {levels.length > 1 && (
                      <button onClick={() => setMenu("quality")} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10">
                        <span className="flex items-center gap-3"><Gauge className="w-4 h-4" /> Quality</span>
                        <span className="flex items-center gap-1 text-[#aaa] text-[13px]">{currentLevel === -1 ? "Auto" : levels.find(l => l.index === currentLevel)?.label || "Auto"}<ChevronRight className="w-3.5 h-3.5" /></span>
                      </button>
                    )}
                    <button onClick={() => setMenu("speed")} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10">
                      <span>Playback speed</span>
                      <span className="flex items-center gap-1 text-[#aaa] text-[13px]">{speed === 1 ? "Normal" : `${speed}x`}<ChevronRight className="w-3.5 h-3.5" /></span>
                    </button>
                    {captions && captions.length > 0 && (
                      <button onClick={() => setMenu("captions")} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10">
                        <span className="flex items-center gap-3"><Subtitles className="w-4 h-4" /> Subtitles</span>
                        <span className="flex items-center gap-1 text-[#aaa] text-[13px]">{captions.find(c => c.lang === activeCaption)?.name || "Off"}<ChevronRight className="w-3.5 h-3.5" /></span>
                      </button>
                    )}
                    <button onClick={() => setAutoplay({ autoplay: !autoplay })} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10" role="switch" aria-checked={autoplay}>
                      <span>Autoplay next video</span>
                      <span className={`relative w-10 h-5 rounded-full transition-colors ${autoplay ? "bg-[#3ea6ff]" : "bg-white/25"}`}>
                        <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white transition-all ${autoplay ? "left-[22px]" : "left-[3px]"}`} />
                      </span>
                    </button>
                    {isNativeApp() && (
                      <button onClick={() => setAutoplay({ backgroundPlay: !backgroundPlay })} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10" role="switch" aria-checked={backgroundPlay} title="Keep playing when you switch apps or turn the screen off">
                        <span>Background play</span>
                        <span className={`relative w-10 h-5 rounded-full transition-colors ${backgroundPlay ? "bg-[#3ea6ff]" : "bg-white/25"}`}>
                          <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white transition-all ${backgroundPlay ? "left-[22px]" : "left-[3px]"}`} />
                        </span>
                      </button>
                    )}
                    {audioFormat && (
                      <button onClick={() => setAutoplay({ audioOnly: !audioOnly })} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10" role="switch" aria-checked={audioOnly} title="Play the audio-only stream and show the thumbnail — saves data">
                        <span className="flex items-center gap-3"><Headphones className="w-4 h-4" /> Audio mode</span>
                        <span className={`relative w-10 h-5 rounded-full transition-colors ${audioOnly ? "bg-[#3ea6ff]" : "bg-white/25"}`}>
                          <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white transition-all ${audioOnly ? "left-[22px]" : "left-[3px]"}`} />
                        </span>
                      </button>
                    )}
                  </>
                )}
                {menu === "quality" && (
                  <>
                    <button onClick={() => setMenu("main")} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/10 border-b border-white/10 mb-1">
                      <ArrowLeft className="w-4 h-4" /> Quality
                    </button>
                    <button onClick={() => pickLevel(-1)} className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10">
                      Auto {currentLevel === -1 && <Check className="w-4 h-4 text-[#3ea6ff]" />}
                    </button>
                    {levels.map(l => (
                      <button key={l.index} onClick={() => pickLevel(l.index)} className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10">
                        {l.label}
                        {currentLevel === l.index && <Check className="w-4 h-4 text-[#3ea6ff]" />}
                      </button>
                    ))}
                  </>
                )}
                {menu === "speed" && (
                  <>
                    <button onClick={() => setMenu("main")} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/10 border-b border-white/10 mb-1">
                      <ArrowLeft className="w-4 h-4" /> Playback speed
                    </button>
                    {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                      <button key={s} onClick={() => pickSpeed(s)} className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10">
                        {s === 1 ? "Normal" : `${s}x`}
                        {speed === s && <Check className="w-4 h-4 text-[#3ea6ff]" />}
                      </button>
                    ))}
                  </>
                )}
                {menu === "captions" && (
                  <>
                    <button onClick={() => setMenu("main")} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/10 border-b border-white/10 mb-1">
                      <ArrowLeft className="w-4 h-4" /> Subtitles
                    </button>
                    <button onClick={() => pickCaption("")} className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10">
                      Off {!activeCaption && <Check className="w-4 h-4 text-[#3ea6ff]" />}
                    </button>
                    {(captions || []).map(c => (
                      <button key={c.lang} onClick={() => pickCaption(c.lang)} className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/10">
                        {c.name || c.lang}
                        {activeCaption === c.lang && <Check className="w-4 h-4 text-[#3ea6ff]" />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* PiP: Android = the plugin ([A5]); desktop = the W3C button */}
          {isNativeApp() ? (
            <button onClick={() => nativeEnterPip()} aria-label="Picture-in-picture" title="Picture-in-picture" data-testid="pip-button" className="flex w-10 h-10 items-center justify-center hover:opacity-80">
              <PictureInPicture2 className="w-6 h-6" />
            </button>
          ) : (
            <button
              onClick={() => {
                const el = videoRef.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
                if (document.pictureInPictureElement) document.exitPictureInPicture?.();
                else el?.requestPictureInPicture?.().catch(() => {});
              }}
              aria-label="Picture-in-picture"
              className="hidden md:flex w-10 h-10 items-center justify-center hover:opacity-80"
            >
              <PictureInPicture2 className="w-6 h-6" />
            </button>
          )}

          <button onClick={toggleFullscreen} aria-label="Fullscreen (f)" className="w-10 h-10 flex items-center justify-center hover:opacity-80">
            {fullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* [A7] autoplay countdown — renders wherever the surface is docked */}
      <CountdownCard />
    </div>,
    watchSlot!
      )}
    </>
  );
}
