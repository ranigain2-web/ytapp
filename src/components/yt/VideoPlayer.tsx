"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Hls from "hls.js";
import type { YtVideoFull, YtCaption, SbSegment } from "@/lib/yt-api";
import { absStream, fetchSponsorBlock } from "@/lib/yt-api";
import { formatTime } from "@/lib/yt-format";
import {
  Play, Pause, SkipForward, Volume2, Volume1, VolumeX, Maximize, Minimize,
  Settings, Subtitles, ArrowLeft, Gauge, Check,
} from "lucide-react";

interface Props {
  video: YtVideoFull;
  startAt?: number;
  onEnded?: () => void;
  onProgress?: (current: number, duration: number) => void;
  /** Called when no direct stream is loadable (e.g. bot-gated HLS) — lets the
   *  host swap in the official embed player instead of showing an error. */
  onFallback?: () => void;
}

export default function VideoPlayer({ video, startAt = 0, onEnded, onProgress, onFallback }: Props) {
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

  const fallbackFormat = useMemo(() => {
    // progressive fallback: pick best combined mp4 up to 720p
    const combined = video.formats.filter(f => f.has_video && f.has_audio && /mp4/.test(f.mime));
    return combined.sort((a, b) => (b.height || 0) - (a.height || 0)).find(f => (f.height || 0) <= 720) || combined[0] || video.formats.find(f => f.has_video && f.has_audio);
  }, [video.formats]);
  const noSource = !video.hls && !fallbackFormat?.url;

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

    // progressive fallback switcher: used when HLS dies before levels load
    // (CORS-blocked manifests, gated IPs, …)
    const useProgressive = () => {
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
      if (fallbackFormat?.url) {
        el.src = absStream(fallbackFormat.url);
        el.play().catch(() => {});
      } else {
        onFallbackRef.current?.();
      }
    };

    if (video.hls && Hls.isSupported()) {
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
              useProgressive();
              return;
            }
            hls?.startLoad();
            return;
          }
          if (netErrors <= 2) { hls?.startLoad(); return; }
          useProgressive();
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
    } else if (fallbackFormat?.url) {
      el.src = absStream(fallbackFormat.url);
    }
    // no-source case is handled in render via derived noSource flag

    return () => {
      hls?.destroy();
      if (hlsRef.current === hls) hlsRef.current = null;
    };
  }, [video.id, video.hls, fallbackFormat]);

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
      if (el.buffered.length) setBuffered(el.buffered.end(el.buffered.length - 1));
      onProgress?.(el.currentTime, el.duration || 0);
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
    const onEnd = () => { setPlaying(false); onEnded?.(); };
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
  }, [sbSegments, onEnded, onProgress]);

  // seek to startAt
  useEffect(() => {
    const el = videoRef.current;
    if (el && startAt > 0) {
      const apply = () => { if (el.currentTime < 0.1) el.currentTime = startAt; };
      if (el.readyState >= 1) apply();
      else el.addEventListener("loadedmetadata", apply, { once: true });
    }
  }, [startAt]);

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
    if (el.paused) { if (!started) userStart(); else el.play().catch(() => {}); }
    else el.pause();
  }, [started, userStart]);

  const seekBy = useCallback((d: number) => {
    const el = videoRef.current;
    if (el) { el.currentTime = Math.max(0, Math.min((el.duration || duration) - 0.2, el.currentTime + d)); poke(); }
  }, [duration, poke]);

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
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group/player select-none"
      onMouseMove={poke}
      onMouseLeave={() => { if (playing && !menu) setControlsVisible(false); }}
      onClick={(e) => { if ((e.target as HTMLElement).dataset.playerSurface) togglePlay(); }}
      onDoubleClick={(e) => { if ((e.target as HTMLElement).dataset.playerSurface) toggleFullscreen(); }}
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
      />

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

      {/* sponsorblock toast */}
      {sbToast && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-black/85 text-white text-[13px]">
          {sbToast}
        </div>
      )}

      {/* CENTER big play */}
      {!playing && !waiting && !error && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 z-20 flex items-center justify-center"
          data-player-surface="1"
        >
          <span className="w-[68px] h-[68px] rounded-full bg-[#ff0000] flex items-center justify-center shadow-[0_4px_24px_rgba(255,0,0,0.45)]">
            <Play className="w-9 h-9 text-white ml-1" fill="white" />
          </span>
        </button>
      )}

      {/* CONTROLS */}
      <div
        className={`yt-controls absolute left-0 right-0 bottom-0 z-20 yt-scrim-bottom pt-10 pb-1 px-2 sm:px-4 ${controlsVisible || !playing ? "" : "yt-controls-hidden"}`}
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

        {/* buttons row */}
        <div className="flex items-center gap-1 sm:gap-2 text-white">
          <button onClick={togglePlay} aria-label={playing ? "Pause (k)" : "Play (k)"} className="w-10 h-10 flex items-center justify-center hover:opacity-80">
            {playing ? <Pause className="w-7 h-7" fill="white" /> : <Play className="w-7 h-7" fill="white" />}
          </button>
          <button onClick={() => onEnded?.()} aria-label="Next video" className="w-10 h-10 flex items-center justify-center hover:opacity-80">
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
                        <span className="text-[#aaa] text-[13px]">{currentLevel === -1 ? "Auto" : levels.find(l => l.index === currentLevel)?.label || "Auto"}</span>
                      </button>
                    )}
                    <button onClick={() => setMenu("speed")} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10">
                      <span>Playback speed</span>
                      <span className="text-[#aaa] text-[13px]">{speed === 1 ? "Normal" : `${speed}x`}</span>
                    </button>
                    {captions.length > 0 && (
                      <button onClick={() => setMenu("captions")} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/10">
                        <span className="flex items-center gap-3"><Subtitles className="w-4 h-4" /> Subtitles</span>
                        <span className="text-[#aaa] text-[13px]">{captions.find(c => c.lang === activeCaption)?.name || "Off"}</span>
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

          <button onClick={toggleFullscreen} aria-label="Fullscreen (f)" className="w-10 h-10 flex items-center justify-center hover:opacity-80">
            {fullscreen ? <Minimize className="w-6 h-6" /> : <Maximize className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  );
}
