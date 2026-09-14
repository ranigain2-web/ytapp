"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";
import type { YtVideoFull, YtFormat, YtCaption, SbSegment } from "@/lib/yt-api";
import { absStream, fetchSponsorBlock } from "@/lib/yt-api";
import { formatTime } from "@/lib/yt-format";
import { useYt } from "@/lib/yt-store";
import {
  addControlListener, nativeBackgroundDisable, nativeBackgroundEnable, nativeBackgroundUpdate, isNativeApp,
  setMediaHandlers, setMediaMetadata, setMediaPlaybackState, setMediaPositionState, clearMediaHandlers,
} from "@/lib/yt-native";
import {
  Play, Pause, SkipForward, Volume2, Volume1, VolumeX, Maximize, Minimize,
  Settings, Subtitles, ArrowLeft, Gauge, Check, ChevronRight, ChevronLeft, PictureInPicture2, Headphones,
  RotateCcw, RotateCw,
} from "lucide-react";

interface Props {
  video: YtVideoFull;
  startAt?: number;
  /** Video finished playing (fires the autoplay-next chain when enabled). */
  onEnded?: () => void;
  /** Next-video button — always active, like YouTube's "Skip this video". */
  onNext?: () => void;
  onProgress?: (current: number, duration: number) => void;
  /** Called when no direct stream is loadable (e.g. bot-gated HLS) — lets the
   *  host swap in the official embed player instead of showing an error. */
  onFallback?: () => void;
  /** Shorts mode: fills its container (no 16:9 lock), loops, no control
   *  buttons — just a thin progress bar, tap-to-pause and double-tap seek. */
  minimal?: boolean;
}

export default function VideoPlayer({ video, startAt = 0, onEnded, onNext, onProgress, onFallback, minimal = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekHoverRef = useRef<HTMLDivElement>(null);
  const manifestOkRef = useRef(false);
  // keep the fallback callback out of the load-effect deps — an inline arrow
  // from the host would otherwise re-run the whole loader on every re-render
  const onFallbackRef = useRef(onFallback);
  useEffect(() => { onFallbackRef.current = onFallback; }, [onFallback]);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(video.duration || 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(true); // autoplay needs muted start
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [menu, setMenu] = useState<null | "main" | "speed" | "quality" | "captions">(null);
  const [levels, setLevels] = useState<{ index: number; label: string; height: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState<YtCaption[]>(video.captions || []);
  const [activeCaption, setActiveCaption] = useState<string>("");
  const [sbSegments, setSbSegments] = useState<SbSegment[]>([]);
  const [sbToast, setSbToast] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  // double-tap seek ripple: {dir, key} — key re-triggers the CSS animation
  const [ripple, setRipple] = useState<{ dir: "fwd" | "back"; key: number } | null>(null);
  const rippleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // single vs double tap discrimination on the video surface
  const tapRef = useRef<{ t: number; zone: "left" | "right" | "mid" } | null>(null);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // autoplay preference (also switchable from the settings menu, like YouTube)
  const autoplay = useYt(s => s.prefs.autoplay);
  const setAutoplay = useYt(s => s.setPrefs);
  // Premium-style preferences: background playback + audio-only mode
  const backgroundPlay = useYt(s => s.prefs.backgroundPlay);
  const audioOnly = useYt(s => s.prefs.audioOnly);

  // stable next-video handle for media-session / notification actions
  const onNextRef = useRef(onNext);
  useEffect(() => { onNextRef.current = onNext; }, [onNext]);
  // native background service bookkeeping
  const bgActiveRef = useRef(false);
  // Did the USER deliberately pause? Backgrounding an Android WebView can fire
  // a pause event all by itself; we must not treat that as "the user wants it
  // stopped", or background playback is impossible.
  const userPausedRef = useRef(false);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const lastSyncRef = useRef(0);
  // last video id seen by the load effect — distinguishes "new video" from
  // "same video, source toggled (audio mode)" so playback position survives
  const loadedVideoRef = useRef<string>("");

  const fallbackFormat = useMemo(() => {
    // progressive fallback: pick best combined mp4 up to 720p
    const combined = video.formats.filter(f => f.has_video && f.has_audio && /mp4/.test(f.mime));
    return combined.sort((a, b) => (b.height || 0) - (a.height || 0)).find(f => (f.height || 0) <= 720) || combined[0] || video.formats.find(f => f.has_video && f.has_audio);
  }, [video.formats]);
  // Premium "audio mode": best audio-only stream — saves data and is the
  // source used for pure listening / background audio. Prefer m4a (universally
  // hardware-decoded, incl. Safari/WKWebView on macOS), then webm/opus.
  const audioFormat = useMemo(() => {
    const audio = video.formats.filter(f => f.has_audio && !f.has_video && !!f.url);
    const rank = (f: YtFormat) => (/mp4|m4a/.test(f.mime) ? 0 : /webm/.test(f.mime) ? 1 : 2);
    return audio.sort((a, b) => rank(a) - rank(b) || (b.bitrate || 0) - (a.bitrate || 0))[0] || null;
  }, [video.formats]);
  const noSource = !video.hls && !fallbackFormat?.url && !(audioOnly && audioFormat?.url);

  // no directly-playable stream at all → hand off to the embed player
  useEffect(() => {
    if (noSource) onFallbackRef.current?.();
  }, [noSource]);

  // --- Load source ---
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let hls: Hls | null = null;
    manifestOkRef.current = false;

    // audio-mode toggle for the SAME video: keep position + playing state
    const isToggle = loadedVideoRef.current === video.id;
    loadedVideoRef.current = video.id;
    const keepPos = isToggle && el.readyState >= 1 ? el.currentTime : 0;
    const wasPlaying = isToggle ? !el.paused : true;
    const resumeAfterLoad = () => {
      if (keepPos > 0.5) {
        const apply = () => {
          try { el.currentTime = keepPos; } catch { /* not seekable yet */ }
          if (wasPlaying) el.play().catch(() => {});
        };
        if (el.readyState >= 1) apply();
        else el.addEventListener("loadedmetadata", apply, { once: true });
      } else if (wasPlaying) {
        el.play().catch(() => {});
      }
    };

    // progressive fallback switcher: used when HLS dies before levels load
    // (CORS-blocked manifests, gated IPs, …)
    const switchToProgressive = () => {
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      if (fallbackFormat?.url) {
        el.src = absStream(fallbackFormat.url);
        el.play().catch(() => {});
      } else {
        onFallbackRef.current?.();
      }
    };

    const useAudio = audioOnly && audioFormat?.url;
    if (useAudio) {
      // Premium audio mode: audio-only stream + poster art — saves data
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
      // cache-bust: manifest embeds expiring stream URLs, never serve a stale one
      const src = absStream(video.hls);
      hls.loadSource(`${src}${src.includes("?") ? "&" : "?"}_=${Date.now()}`);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        manifestOkRef.current = true;
        const lv = data.levels
          .map((l, i) => ({ index: i, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)}kbps`, height: l.height || 0 }))
          .sort((a, b) => b.height - a.height);
        setLevels(lv);
        hlsRef.current?.startLoad(-1);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setCurrentLevel(hlsRef.current?.autoLevelEnabled ? -1 : data.level));
      let netErrors = 0;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          netErrors++;
          // manifest/playlist load failed and never produced levels → the
          // stream is unusable in this context (usually CORS): switch to the
          // progressive file instead of retrying forever.
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
          if (onFallbackRef.current) onFallbackRef.current();
          else { setError("Playback error — try reloading"); setWaiting(false); }
        }
      });
    } else if (video.hls && el.canPlayType("application/vnd.apple.mpegurl")) {
      const src2 = absStream(video.hls);
      el.src = `${src2}${src2.includes("?") ? "&" : "?"}_=${Date.now()}`; // Safari native HLS
      resumeAfterLoad();
    } else if (fallbackFormat?.url) {
      el.src = absStream(fallbackFormat.url);
      resumeAfterLoad();
    }
    // no-source case is handled in render via derived noSource flag

    return () => {
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [video.id, video.hls, fallbackFormat, audioOnly, audioFormat]);

  // --- Captions tracks (native <track>) ---
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video.captions?.length) return;
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
  }, [video.id, video.captions]);

  // --- SponsorBlock ---
  useEffect(() => {
    if (!video.id) return;
    let alive = true;
    fetchSponsorBlock(video.id)
      .then(r => { if (alive && r.segments?.length) setSbSegments(r.segments); })
      .catch(() => {});
    return () => { alive = false; };
  }, [video.id]);

  // --- Big-tap to start (unmute + play) ---
  const userStart = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    setMuted(false);
    el.volume = volume;
    el.play().catch(() => {});
    setStarted(true);
  }, [volume]);

  // --- Media events ---
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => {
      setCurrent(el.currentTime);
      positionRef.current = el.currentTime;
      durationRef.current = el.duration || durationRef.current;
      if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
      onProgress?.(el.currentTime, el.duration || 0);
      // Premium sync: lock-screen position + native notification (throttled ~5s)
      if (Math.abs(el.currentTime - lastSyncRef.current) > 5) {
        lastSyncRef.current = el.currentTime;
        if (bgActiveRef.current) {
          nativeBackgroundUpdate({ playing: !el.paused, position: el.currentTime, duration: el.duration || 0 });
        }
        setMediaPositionState(el.currentTime, el.duration || 0, el.playbackRate);
      }
      // SponsorBlock auto-skip
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
    const onDur = () => { if (el.duration && isFinite(el.duration)) setDuration(el.duration); };
    const onPlay = () => { setPlaying(true); setWaiting(false); };
    const onPause = () => setPlaying(false);
    const onWait = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    const onEnd = () => {
      setPlaying(false);
      if (minimal && !onEnded) {
        // Shorts loop: replay from the top
        const el = videoRef.current;
        if (el) { el.currentTime = 0; el.play().catch(() => {}); }
        return;
      }
      onEnded?.();
    };
    const onVol = () => { setVolume(el.volume); setMuted(el.muted); };
    const onErr = () => { setError("Stream error — try reloading"); setWaiting(false); };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("progress", () => setBuffered(el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0));
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
  }, [sbSegments, onEnded, onProgress, minimal]);

  // seek to startAt
  useEffect(() => {
    const el = videoRef.current;
    if (el && startAt > 0) {
      const apply = () => { if (el.currentTime < 0.1) el.currentTime = startAt; };
      if (el.readyState >= 1) apply();
      else el.addEventListener("loadedmetadata", apply, { once: true });
    }
  }, [startAt]);

  // --- Premium: MediaSession metadata / state / handlers + native controls ---
  // Lock screen (web + Android WebView via W3C API) and the yt-background
  // notification / headset buttons both land here.
  useEffect(() => {
    setMediaMetadata({
      title: video.title || "YouTube",
      artist: video.channel || "",
      artwork: video.thumb_lg || video.thumb || "",
      duration: duration || video.duration || 0,
    });
  }, [video.id, video.title, video.channel, video.thumb_lg, video.thumb, video.duration, duration]);

  useEffect(() => {
    setMediaPlaybackState(playing);
    if (bgActiveRef.current) {
      nativeBackgroundUpdate({ playing, position: positionRef.current, duration: durationRef.current, title: video.title, artist: video.channel });
    }
  }, [playing, video.title, video.channel]);

  // --- Premium: native foreground service (Android) ---
  // This service is what keeps the app process — and therefore the stream —
  // alive once the activity leaves the foreground.
  //
  // It is deliberately NOT torn down when playback pauses. Android can pause a
  // WebView's <video> the moment the activity is backgrounded, and tearing the
  // service down at exactly that moment removes the only thing keeping the
  // process alive. That race is how "background play is not working" happens.
  // The service stops only when the pref is switched off, the player unmounts,
  // or the video is replaced.
  useEffect(() => {
    if (!backgroundPlay) {
      if (bgActiveRef.current) {
        bgActiveRef.current = false;
        nativeBackgroundDisable();
      }
      return;
    }
    if (!playing && !started) return; // nothing has started yet — stay idle
    const payload = {
      title: video.title || "YouTube",
      artist: video.channel || "",
      artwork: video.thumb_lg || video.thumb || "",
      duration: durationRef.current || video.duration || 0,
    };
    if (!bgActiveRef.current) {
      bgActiveRef.current = true;
      nativeBackgroundEnable(payload);
    } else {
      // keeps the lock-screen / notification state in sync with the player
      nativeBackgroundUpdate({
        playing,
        position: positionRef.current,
        duration: payload.duration,
        title: payload.title,
        artist: payload.artist,
      });
    }
  }, [playing, started, backgroundPlay, video.id, video.title, video.channel, video.thumb_lg, video.thumb, video.duration]);

  // The moment the app leaves the foreground is the moment this feature exists
  // for. Two jobs:
  //   1. if the WebView paused playback on its own (not the user), resume it —
  //      a foreground service alone cannot restart a paused <video>;
  //   2. make sure the foreground service is actually running, which also
  //      covers "user hits play then instantly switches apps".
  useEffect(() => {
    if (!isNativeApp()) return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden" || !backgroundPlay) return;
      const el = videoRef.current;
      if (!el) return;
      if (el.paused && !userPausedRef.current && !el.ended) {
        el.play().catch(() => { /* autoplay policy — notification Play still works */ });
      }
      const payload = {
        title: video.title || "YouTube",
        artist: video.channel || "",
        artwork: video.thumb_lg || video.thumb || "",
        duration: el.duration || durationRef.current || video.duration || 0,
      };
      if (!bgActiveRef.current) {
        bgActiveRef.current = true;
        nativeBackgroundEnable(payload);
      } else {
        nativeBackgroundUpdate({
          playing: !el.paused,
          position: el.currentTime || 0,
          duration: payload.duration,
          title: payload.title,
          artist: payload.artist,
        });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [backgroundPlay, video.id, video.title, video.channel, video.thumb_lg, video.thumb, video.duration]);

  useEffect(() => () => {
    if (bgActiveRef.current) {
      bgActiveRef.current = false;
      nativeBackgroundDisable();
    }
  }, []);

  // --- Controls auto-hide ---
  const poke = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused && !menu) setControlsVisible(false);
    }, 2800);
  }, [menu]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  // --- Fullscreen ---
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen?.();
  }, []);

  // --- Actions ---
  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { userPausedRef.current = false; if (!started) userStart(); else el.play().catch(() => {}); }
    else { userPausedRef.current = true; el.pause(); }
  }, [started, userStart]);

  const seekBy = useCallback((d: number) => {
    const el = videoRef.current;
    if (el) { el.currentTime = Math.max(0, Math.min((el.duration || duration) - 0.2, el.currentTime + d)); poke(); }
  }, [duration, poke]);

  // --- Double-tap seek (YouTube signature interaction) ---
  // Left/right zones: double-tap seeks ±10s with an expanding ripple.
  // Single tap: reveals hidden controls, or toggles play when visible.
  // Touch events drive the seek gesture (preventDefault suppresses the
  // synthesized click/dblclick so mobile never accidentally fullscreens);
  // mouse clicks keep desktop semantics (click = pause, dblclick = fullscreen).
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
    if (minimal) { togglePlay(); return; } // Shorts: tap = pause/play directly
    if (!controlsVisible) { poke(); return; }
    togglePlay();
  }, [controlsVisible, poke, togglePlay, minimal]);

  const onSurfaceTap = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).dataset.playerSurface) return;
    // mouse: immediate semantics (dblclick → fullscreen is separate)
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
      // double tap → seek ±10s, suppress synthetic click/dblclick
      e.preventDefault();
      tapRef.current = null;
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      seekBy(zone === "left" ? -10 : 10);
      showRipple(zone === "left" ? "back" : "fwd");
      return;
    }
    tapRef.current = { t: now, zone };
    // single tap → wait to see if a second tap follows
    e.preventDefault();
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    singleTapTimer.current = setTimeout(singleTapAction, 260);
  }, [zoneAt, seekBy, showRipple, singleTapAction]);

  useEffect(() => () => {
    if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
  }, []);

  const setVol = useCallback((v: number) => {
    const el = videoRef.current;
    if (el) { el.muted = false; el.volume = v; setMuted(false); setVolume(v); }
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (el) { el.muted = !el.muted; setMuted(el.muted); if (!el.muted && el.volume === 0) setVol(0.5); }
  }, [setVol]);

  // --- Keyboard ---
  useEffect(() => {
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
  }, [togglePlay, seekBy, toggleFullscreen, toggleMute, setVol, volume, poke]);

  // --- Premium: lock-screen / notification / headset control handlers ---
  // W3C MediaSession (browser lock screens + media keys) AND the yt-background
  // notification / MediaSession buttons land here.
  useEffect(() => {
    setMediaHandlers({
      play: () => { const el = videoRef.current; userPausedRef.current = false; if (el && el.paused) { if (!started) userStart(); else el.play().catch(() => {}); } },
      pause: () => { userPausedRef.current = true; videoRef.current?.pause(); },
      next: () => onNextRef.current?.(),
      seek: (to) => { const el = videoRef.current; if (el && isFinite(to)) { el.currentTime = Math.max(0, Math.min((el.duration || 0) - 0.2, to)); poke(); } },
      seekBy: (d) => seekBy(d),
    });
    const off = addControlListener((e) => {
      const el = videoRef.current;
      if (e.action === "play") { userPausedRef.current = false; if (el) { if (!started) userStart(); else el.play().catch(() => {}); } }
      else if (e.action === "pause") { userPausedRef.current = true; el?.pause(); }
      else if (e.action === "next") onNextRef.current?.();
      else if (e.action === "stop") { userPausedRef.current = true; el?.pause(); }
      else if (e.action === "seek" && e.seekTo != null && el) { el.currentTime = Math.max(0, Math.min((el.duration || 0) - 0.2, e.seekTo)); poke(); }
    });
    return () => { off(); clearMediaHandlers(); };
  }, [started, userStart, seekBy, poke]);

  // --- Seek bar ---
  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  const seekTo = (clientX: number, bar: HTMLElement) => {
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const el = videoRef.current;
    if (el && duration) el.currentTime = ratio * duration;
  };

  const onSeekHover = (clientX: number, bar: HTMLElement) => {
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverTime(ratio * duration);
  };

  // --- Quality switch ---
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
    setSpeed(s);
    setMenu(null);
  };

  const pickCaption = (lang: string) => {
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
  };

  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const playRatio = duration ? current / duration : 0;

  return (
    <div
      ref={containerRef}
      className={`${minimal ? "relative w-full h-full" : "yt-player-shell relative w-full aspect-video"} bg-black ${minimal ? "rounded-lg sm:rounded-xl" : "rounded-xl"} overflow-hidden group/player select-none`}
      onMouseMove={poke}
      onMouseLeave={() => { if (playing && !menu && !minimal) setControlsVisible(false); }}
      onClick={onSurfaceTap}
      onTouchEnd={onSurfaceTouch}
      onDoubleClick={(e) => { if (!minimal && (e.target as HTMLElement).dataset.playerSurface) toggleFullscreen(); }}
    >
      {/* error / no stream */}
      {(error || noSource) && !onFallback && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/90" data-player-surface="1">
          <p className="text-[#aaa] text-sm">{error || "No playable stream found"}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-full bg-[#272727] text-sm hover:bg-[#3f3f3f]">Reload</button>
        </div>
      )}

      {/* the video */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        playsInline
        autoPlay
        muted
        poster={video.thumb_lg || video.thumb}
        data-player-surface="1"
      />

      {/* double-tap seek ripple — YouTube signature */}
      {ripple && (
        <div
          key={ripple.key}
          className={`absolute inset-y-0 ${ripple.dir === "fwd" ? "right-0" : "left-0"} w-2/5 z-10 flex items-center justify-center pointer-events-none overflow-hidden`}
        >
          <div className="absolute w-[130px] h-[130px] rounded-full bg-white/20 yt-seek-ring" />
          <div className="relative flex flex-col items-center gap-1 text-white yt-seek-pop">
            {ripple.dir === "fwd"
              ? <ChevronRight className="w-11 h-11" strokeWidth={2.4} />
              : <ChevronLeft className="w-11 h-11" strokeWidth={2.4} />}
            <span className="text-[13px] font-medium">10 seconds</span>
          </div>
        </div>
      )}

      {/* AUDIO MODE ARTWORK — an audio-only stream renders no frames, so the
          video element would sit there as a black rectangle and the feature
          reads as "broken" instead of intentional. Show the video's artwork
          (YouTube Premium does the same) with the title/channel, and pass taps
          through to the player surface so play/pause and double-tap seek still
          work. */}
      {audioOnly && audioFormat && !error && (
        <div
          className="absolute inset-0 z-[5] overflow-hidden bg-black"
          data-player-surface="1"
          data-testid="audio-mode-art"
        >
          {(video.thumb_lg || video.thumb) && (
            <img
              src={video.thumb_lg || video.thumb}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-40"
            />
          )}
          <div className="relative h-full flex items-center justify-center gap-4 sm:gap-7 px-5 sm:px-10">
            {(video.thumb_lg || video.thumb) && (
              <img
                src={video.thumb_lg || video.thumb}
                alt=""
                className="w-[42%] max-w-[260px] aspect-video object-cover rounded-lg sm:rounded-xl shadow-2xl shrink-0"
              />
            )}
            <div className="min-w-0 hidden xs:block max-w-[46%]">
              <p className="text-white text-[15px] sm:text-[17px] font-medium leading-[22px] clamp-2">{video.title}</p>
              {video.channel && <p className="text-white/75 text-[13px] mt-1.5 truncate">{video.channel}</p>}
              <p className="mt-3 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-white/10 text-white text-[12px] font-medium">
                <Headphones className="w-3.5 h-3.5" /> Audio mode — data saver
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

      {/* unmute nudge (autoplay started muted) */}
      {!error && muted && playing && started !== false && (
        <button
          onClick={() => toggleMute()}
          className="absolute top-3 left-3 z-20 flex items-center gap-2 px-3 h-9 rounded-lg bg-black/80 text-white text-[13px] hover:bg-black"
        >
          <VolumeX className="w-5 h-5" /> Tap to unmute
        </button>
      )}

      {/* audio-mode indicator (Premium audio mode active) */}
      {audioOnly && audioFormat && !error && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-black/80 text-white text-[12px] font-medium pointer-events-none">
          <Headphones className="w-4 h-4" /> Audio mode
        </div>
      )}

      {/* sponsorblock toast */}
      {sbToast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-black/85 text-white text-[13px]">
          {sbToast}
        </div>
      )}

      {/* CENTER CONTROLS — the YouTube mobile signature: rewind 10s · pause ·
          forward 10s (+ next video). Always present while the controls are
          visible, so skip/pause is impossible to miss. */}
      {!minimal && !waiting && !error && (controlsVisible || !playing) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-7 sm:gap-10 pointer-events-none" data-testid="center-controls">
          <button
            onClick={() => { seekBy(-10); showRipple("back"); }}
            aria-label="Rewind 10 seconds"
            title="Rewind 10 seconds"
            className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            <span className="relative flex items-center justify-center">
              <RotateCcw className="w-12 h-12 sm:w-[52px] sm:h-[52px]" strokeWidth={1.6} />
              <span className="absolute text-[13px] font-semibold pt-1.5">10</span>
            </span>
          </button>
          <button
            onClick={togglePlay}
            aria-label={playing ? "Pause (k)" : "Play (k)"}
            className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            {playing
              ? <Pause className="w-12 h-12 sm:w-[52px] sm:h-[52px]" fill="white" strokeWidth={1} />
              : <Play className="w-12 h-12 sm:w-[52px] sm:h-[52px] ml-1" fill="white" strokeWidth={1} />}
          </button>
          <button
            onClick={() => { seekBy(10); showRipple("fwd"); }}
            aria-label="Forward 10 seconds"
            title="Forward 10 seconds"
            className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform"
          >
            <span className="relative flex items-center justify-center">
              <RotateCw className="w-12 h-12 sm:w-[52px] sm:h-[52px]" strokeWidth={1.6} />
              <span className="absolute text-[13px] font-semibold pt-1.5">10</span>
            </span>
          </button>
          {onNext && (
            <button
              onClick={() => onNext()}
              aria-label="Next video"
              title="Next video"
              className="pointer-events-auto w-14 h-14 flex items-center justify-center text-white active:scale-90 transition-transform"
            >
              <SkipForward className="w-11 h-11 sm:w-12 sm:h-12" fill="white" strokeWidth={1.4} />
            </button>
          )}
        </div>
      )}

      {/* CONTROLS — in minimal (Shorts) mode: thin progress bar only, always visible */}
      <div
        className={`yt-controls absolute left-0 right-0 bottom-0 z-20 ${minimal ? "pt-6 pb-2 px-3" : "yt-scrim-bottom pt-10 pb-1 px-2 sm:px-4"} ${minimal ? "" : (controlsVisible || !playing) ? "" : "yt-controls-hidden"}`}
      >
        {/* seek bar */}
        <div
          ref={seekHoverRef}
          className="relative h-[18px] flex items-center cursor-pointer group/seek mb-[2px]"
          onMouseMove={(e) => onSeekHover(e.clientX, e.currentTarget)}
          onMouseLeave={() => setHoverTime(null)}
          onClick={(e) => { seekTo(e.clientX, e.currentTarget); poke(); }}
        >
          {/* hover time bubble */}
          {hoverTime !== null && (
            <div
              className="absolute -top-8 px-1.5 py-0.5 rounded bg-black/90 text-white text-[12px] pointer-events-none"
              style={{ left: `calc(${duration ? (hoverTime / duration) * 100 : 0}% - 20px)` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
          <div className="relative w-full h-[3px] group-hover/seek:h-[5px] transition-all rounded-full bg-white/25">
            {/* buffered */}
            <div className="absolute left-0 top-0 h-full bg-white/40 rounded-full" style={{ width: `${bufPct}%` }} />
            {/* played */}
            <div className="absolute left-0 top-0 h-full yt-progress-played rounded-full" style={{ width: `${pct}%` }} />
            {/* sponsorblock markers */}
            {sbSegments.map((s, i) => (
              <div key={i} className="absolute top-0 h-full bg-[#ffe14d]/70" style={{ left: `${(s.start / duration) * 100}%`, width: `${Math.max(0.5, ((s.end - s.start) / duration) * 100)}%` }} title={`SponsorBlock: ${s.category}`} />
            ))}
            {/* chapters */}
            {(video.chapters || []).map((c, i) => (
              <div key={`c${i}`} className="absolute top-0 h-full w-[2px] bg-white/60" style={{ left: `${(c.start / duration) * 100}%` }} title={c.title} />
            ))}
            {/* thumb */}
            <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[13px] h-[13px] rounded-full bg-[#ff0000] yt-progress-glow ${controlsVisible ? "scale-100" : "scale-0"} transition-transform`} style={{ left: `${pct}%` }} />
          </div>
        </div>

        {/* buttons row — hidden entirely in Shorts (minimal) mode */}
        {!minimal && (
        <div className="flex items-center gap-1 sm:gap-2 text-white">
          <button onClick={togglePlay} aria-label={playing ? "Pause (k)" : "Play (k)"} className="w-10 h-10 flex items-center justify-center hover:opacity-80">
            {playing ? <Pause className="w-7 h-7" fill="white" /> : <Play className="w-7 h-7" fill="white" />}
          </button>
          <button onClick={() => onNext?.()} aria-label="Next video" title="Next video" className={`w-10 h-10 flex items-center justify-center hover:opacity-80 ${onNext ? "" : "opacity-40 pointer-events-none"}`}>
            <SkipForward className="w-6 h-6" fill="white" />
          </button>

          {/* volume */}
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

          <span className="text-[13px] tabular-nums ml-1 text-white/95">
            {formatTime(current)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {/* captions quick toggle */}
          {captions.length > 0 && (
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
                    {captions.length > 0 && (
                      <button onClick={() => setMenu("captions")} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10">
                        <span className="flex items-center gap-3"><Subtitles className="w-4 h-4" /> Subtitles</span>
                        <span className="flex items-center gap-1 text-[#aaa] text-[13px]">{captions.find(c => c.lang === activeCaption)?.name || "Off"}<ChevronRight className="w-3.5 h-3.5" /></span>
                      </button>
                    )}
                    <button
                      onClick={() => { setAutoplay({ autoplay: !autoplay }); }}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10"
                      role="switch"
                      aria-checked={autoplay}
                    >
                      <span>Autoplay next video</span>
                      {/* YouTube-style switch */}
                      <span className={`relative w-10 h-5 rounded-full transition-colors ${autoplay ? "bg-[#3ea6ff]" : "bg-white/25"}`}>
                        <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white transition-all ${autoplay ? "left-[22px]" : "left-[3px]"}`} />
                      </span>
                    </button>
                    {isNativeApp() && (
                      <button
                        onClick={() => { setAutoplay({ backgroundPlay: !backgroundPlay }); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10"
                        role="switch"
                        aria-checked={backgroundPlay}
                        title="Keep playing when you switch apps or turn the screen off"
                      >
                        <span>Background play</span>
                        <span className={`relative w-10 h-5 rounded-full transition-colors ${backgroundPlay ? "bg-[#3ea6ff]" : "bg-white/25"}`}>
                          <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white transition-all ${backgroundPlay ? "left-[22px]" : "left-[3px]"}`} />
                        </span>
                      </button>
                    )}
                    {audioFormat && (
                      <button
                        onClick={() => { setAutoplay({ audioOnly: !audioOnly }); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10"
                        role="switch"
                        aria-checked={audioOnly}
                        title="Play the audio-only stream and show the thumbnail — saves data"
                      >
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
                        {l.label}{l.height >= 1080 && <span className="text-[10px] ml-1 text-white/60">{l.index % 2 === 0 ? "" : ""}</span>}
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
                    {captions.map(c => (
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

          <button onClick={toggleFullscreen} aria-label="Fullscreen (f)" className="w-10 h-10 flex items-center justify-center hover:opacity-80">
            {fullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
