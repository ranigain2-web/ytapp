"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { fetchVideo, fetchComments, getActiveSource, type YtVideoFull, type YtComment } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { usePlayback } from "@/lib/yt-playback";
import { formatViews, formatCount, timeAgo, fullDate } from "@/lib/yt-format";
import { loadYouTubeIframeAPI } from "@/lib/yt-embed-api";
import { VideoCard } from "./VideoCard";
import Comments from "./Comments";
import { CountdownCard } from "./CountdownCard";
import { parkSurfaceVideoIfInside } from "./VideoSurface";
import { ytToast } from "@/lib/yt-toast";
import { isNativeApp } from "@/lib/yt-native";
import { ThumbsUp, ThumbsDown, Share2, BookmarkPlus, Scissors, Bell, AlertTriangle, SkipForward, Headphones, Play, RotateCcw } from "lucide-react";

export default function WatchPage({ videoId, startAt }: { videoId: string; startAt?: number }) {
  const { navigate } = useRouter();
  const [data, setData] = useState<YtVideoFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);

  // ---- phase-2 playback store ----
  // The persistent VideoSurface owns the player; this page only registers the
  // watch-slot mount point and pushes metadata + the related queue into the
  // store ([A1]/[A7]). forceEmbed moved into the store ([A2]).
  const load = usePlayback(s => s.load);
  const setQueue = usePlayback(s => s.setQueue);
  const setEmbed = usePlayback(s => s.setEmbed);
  const nextTrack = usePlayback(s => s.nextTrack);
  const seekTo = usePlayback(s => s.seekTo);
  const autoplay = useYt(s => s.prefs.autoplay);
  const compatEnabled = useYt(s => s.prefs.compatEnabled);
  const forcedEmbed = usePlayback(s => !!s.forceEmbedIds[videoId]);
  // true when the surface already holds THIS video: render the slot
  // immediately — returning to a video resumes with zero skeleton flash
  const instantPlayer = usePlayback(s =>
    s.videoId === videoId && s.mode === "direct" && !(videoId in s.forceEmbedIds));
  const storeVideo = usePlayback(s => (s.videoId === videoId ? s.video : null));

  // local store
  const subs = useYt(s => s.subs);
  const toggleSub = useYt(s => s.toggleSub);
  const liked = useYt(s => s.liked);
  const toggleLike = useYt(s => s.toggleLike);
  const disliked = useYt(s => s.disliked);
  const toggleDislike = useYt(s => s.toggleDislike);
  const later = useYt(s => s.later);
  const toggleLater = useYt(s => s.toggleLater);
  const addHistory = useYt(s => s.addHistory);
  const audioOnly = useYt(s => s.prefs.audioOnly);
  const setPrefs = useYt(s => s.setPrefs);

  const isSubbed = subs.some(s => s.id === (data?.channel_id || ""));
  const isLiked = liked.some(l => l.id === videoId);
  const isDisliked = disliked.includes(videoId);
  const isLater = later.some(l => l.id === videoId);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let v = await fetchVideo(videoId);
        // phase 7: a cached server-side extraction failure (embed_fallback)
        // must not hand the video to the ad-bearing official player without
        // ONE cache-busted retry — the failure TTL is short and a fresh
        // fetch usually recovers (e.g. the server's PO token came online)
        if (v.embed_fallback && !usePlayback.getState().isForcedEmbed(v.id)) {
          const fresh = await fetchVideo(videoId, { fresh: true }).catch(() => null);
          if (alive && fresh && !fresh.embed_fallback) v = fresh;
        }
        if (!alive) return;
        setData(v);
        if (v.title) {
          addHistory({
            id: v.id, title: v.title, channel: v.channel, channel_id: v.channel_id,
            thumb: v.thumb_lg || v.thumb || "", views: String(v.views ?? ""), duration: v.duration ? `${v.duration}` : "",
            published: v.published || "", length: v.duration || 0,
          });
        }
        // [A2]/[A7]: hand the video + its related queue to the persistent
        // surface; embed-fallback videos park it (the iframe is the player)
        const mode = (v.embed_fallback || usePlayback.getState().isForcedEmbed(v.id)) ? "embed" : "direct";
        load(v, { startAt, mode });
        setQueue(v.related || []);
      } catch (e) {
        if (alive) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [videoId, addHistory, load, setQueue, startAt]);

  const goNext = useCallback(() => nextTrack(), [nextTrack]);

  // ---- derived player state (before all effects that need it; `v` may come
  // from the store during instant resume, before the fetch lands) ----
  const v = data || (instantPlayer && storeVideo ? storeVideo : null);
  const blockedMessage = v ? blocked(v) : null;
  // store mode wins once the surface owns this video (phase-8 handoff:
  // after embed→direct the local `data` still says embed_fallback — the
  // iframe MUST unmount or both players would be live at once)
  const surfaceMode = usePlayback(s => s.mode);
  const surfaceVideoId = usePlayback(s => s.videoId);
  const storeOwnsEmbed = surfaceMode === "embed" && surfaceVideoId === v?.id;
  const embedActive = !!(v
    && (v.embed_fallback || forcedEmbed)
    && !(v.embed_fallback && v.playability_reason && (v.embed_blocked || v.unavailable)))
    ? (surfaceMode === "none" ? true : storeOwnsEmbed)
    : false;
  const directPlayer = !!v && !err && !blockedMessage && !embedActive;
  const loading = data === null && err === null && !instantPlayer;

  // ---- Embed player: YouTube IFrame API wiring ----
  // Embed-fallback videos play inside YouTube's own iframe; the IFrame API
  // lets us observe its state so the autoplay countdown also works there, AND
  // when a video ends without autoplay we drop our own overlay on top of the
  // iframe — YouTube's end screen deep-links into the YouTube app.
  const embedIframeRef = useRef<HTMLIFrameElement | null>(null);
  const autoplayRef = useRef(autoplay);
  useEffect(() => { autoplayRef.current = autoplay; }, [autoplay]);
  const [embedEnded, setEmbedEnded] = useState(false);
  const countdown = usePlayback(s => s.countdown);
  const embedPlayerRef = useRef<{
    seekTo?: (s: number, allowSeekAhead: boolean) => void;
    playVideo?: () => void;
    pauseVideo?: () => void;
    getCurrentTime?: () => number;
    getDuration?: () => number;
    getPlayerState?: () => number;
    destroy: () => void;
  } | null>(null);
  useEffect(() => {
    if (!embedActive || !embedIframeRef.current) return;
    let player: NonNullable<typeof embedPlayerRef.current> | null = null;
    let dead = false;
    loadYouTubeIframeAPI()
      .then(YT => {
        if (dead || !embedIframeRef.current) return;
        try {
          player = new YT.Player(embedIframeRef.current, {
            events: {
              onStateChange: (e: { data: number }) => {
                if (e.data === 0) { // ENDED → [A7] countdown (autoplay) or overlay
                  if (autoplayRef.current) usePlayback.getState().advance();
                  setEmbedEnded(true);
                } else {
                  setEmbedEnded(false);
                }
              },
            },
          });
          embedPlayerRef.current = player;
          // phase 8: the store owns mode, so it must own the only handle that
          // can stop the iframe's audio (embed→direct handoff). Replaces the
          // window.__ytEmbedPlayer global (stale across remounts).
          usePlayback.getState().registerEmbedController({
            getPosition: () => { try { return player?.getCurrentTime?.() ?? 0; } catch { return 0; } },
            getDuration: () => { try { return player?.getDuration?.() ?? 0; } catch { return 0; } },
            getPlayerState: () => { try { return player?.getPlayerState?.() ?? -1; } catch { return -1; } },
            pause: () => { try { player?.pauseVideo?.(); } catch { /* iframe gone */ } },
          });
        } catch { /* API attach failed — embed still plays */ }
      })
      .catch(() => { /* script blocked — embed still plays */ });
    return () => {
      dead = true;
      embedPlayerRef.current = null;
      usePlayback.getState().registerEmbedController(null);
      try { player?.destroy(); } catch { /* iframe already gone */ }
    };
  }, [embedActive, data?.id]);

  const replayEmbed = useCallback(() => {
    embedPlayerRef.current?.seekTo?.(0, true);
    embedPlayerRef.current?.playVideo?.();
    setEmbedEnded(false);
  }, []);

  // register the watch-slot mount point for the persistent surface ([A1]).
  // REF CALLBACK, not an effect: React nulls refs before running unmount
  // cleanups, so an effect could never unregister (a stale watchSlot kept the
  // portal rendering into a detached node — and the video inside it got
  // browser-paused). The callback also parks the video into the holder
  // BEFORE this slot leaves the document.
  const slotRefCb = useCallback((el: HTMLDivElement | null) => {
    const pb = usePlayback.getState();
    if (el) {
      pb.registerWatchSlot(el);
    } else {
      parkSurfaceVideoIfInside(pb.watchSlot);
      pb.registerWatchSlot(null);
    }
  }, []);

  if (loading) {
    return (
      <div className="max-w-[1280px] mx-auto px-2 sm:px-6 pt-4 pb-10">
        <div className="aspect-video rounded-xl yt-skeleton mb-4" />
        <div className="h-6 yt-skeleton rounded w-3/4 mb-4" />
        <div className="flex gap-4 mb-6">
          <div className="w-10 h-10 rounded-full yt-skeleton" />
          <div className="flex-1 space-y-2"><div className="h-4 yt-skeleton rounded w-1/3" /><div className="h-3 yt-skeleton rounded w-1/4" /></div>
        </div>
        <div className="h-24 yt-skeleton rounded-xl mb-6" />
        <div className="h-6 yt-skeleton rounded w-40 mb-4" />
        <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="flex gap-4"><div className="w-10 h-10 rounded-full yt-skeleton" /><div className="flex-1 space-y-2"><div className="h-3 yt-skeleton rounded w-1/4" /><div className="h-4 yt-skeleton rounded" /><div className="h-3 yt-skeleton rounded w-1/2" /></div></div>)}</div>
      </div>
    );
  }

  if (err || (data && data.ok === false && !data.title)) {
    const reason = err || data?.playability_reason || "This video is unavailable";
    return (
      <div className="max-w-[560px] mx-auto px-6 pt-20 pb-10 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[var(--yt-bg-elev2)] flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-[var(--yt-text-2)]" />
        </div>

      {(v as { is_premiere?: boolean }).is_premiere && (
        <div className="mb-3 rounded-xl bg-[var(--yt-bg-elev)] border border-[var(--yt-border)] px-4 py-3 flex items-center gap-3" data-testid="premiere-banner">
          <span className="w-2 h-2 rounded-full bg-[var(--yt-red)] animate-pulse shrink-0" aria-hidden />
          <p className="text-[14px] text-[var(--yt-text)]">
            <span className="font-medium">Premiere</span>
            <span className="text-[var(--yt-text-2)]"> — {(v as { playability_reason?: string }).playability_reason || "starts soon"}. The player below shows YouTube&apos;s own countdown.</span>
          </p>
        </div>
      )}

        <h1 className="text-[20px] font-bold text-[var(--yt-text)] mb-3">Video unavailable</h1>
        <p className="text-[14px] leading-[20px] text-[var(--yt-text-2)] mb-8">{reason}</p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate({ name: "home" })} className="px-5 py-2.5 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[14px]">Go to home</button>
          {data?.id && (
            <a href={`https://www.youtube.com/watch?v=${data.id}`} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 rounded-full bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)] text-[14px] font-medium">
              Watch on YouTube
            </a>
          )}
        </div>
      </div>
    );
  }

  // returning to a video the surface already holds: resume without the fetch
  if (!v) {
    return (
      <div className="max-w-[560px] mx-auto px-6 pt-20 pb-10 text-center">
        <h1 className="text-[20px] font-bold text-[var(--yt-text)] mb-3">Video unavailable</h1>
        <button onClick={() => navigate({ name: "home" })} className="px-5 py-2.5 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[14px]">Go to home</button>
      </div>
    );
  }

  const likeCount = v.likes ? formatCount(v.likes) : "";
  const source = getActiveSource();
  const communityMode = source === "community";
  const standaloneMode = source === "standalone";
  const hasAudioStream = !embedActive && (v.formats || []).some(f => f.has_audio && !f.has_video);

  return (
    // Two measured layout facts drive these breakpoints:
    //  • below lg the player is edge-to-edge (YouTube's tablet player is the
    //    full 834px; ours was inset to 802px by a sm:px-6 override),
    //  • YouTube goes TWO-COLUMN on watch from 1000px, not 1280px.
    <div className="yt-watch-outer max-w-[1754px] mx-auto px-0 lg:px-4 xl:px-6 pt-0 lg:pt-4 xl:pt-6 pb-16 flex flex-col lg:flex-row gap-0 lg:gap-4 xl:gap-6">
      {/* main column */}
      <div className="yt-player-col flex-1 min-w-0 max-w-[1280px] mx-auto w-full">
        {/* PLAYER — phase 2: the persistent VideoSurface adopts its <video>
            into this slot; the poster shows through while the mini has it */}
        {blockedMessage ? (
          <div
            className="w-full aspect-video bg-black rounded-none lg:rounded-xl flex flex-col items-center justify-center px-6 text-center bg-cover bg-center"
            style={v.thumb_lg || v.thumb ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0.72)), url(${v.thumb_lg || v.thumb})` } : undefined}
            data-testid="blocked-video"
          >
            <AlertTriangle className="w-10 h-10 text-[var(--yt-text-2)] mb-4" />
            <h2 className="text-white text-[17px] font-medium mb-2">Video unavailable</h2>
            <p className="text-[var(--yt-text-2)] text-[13px] leading-[18px] max-w-[480px]">{blockedMessage}</p>
            <a
              href={`https://www.youtube.com/watch?v=${v.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 px-5 py-2.5 rounded-full bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)] text-[14px] font-medium"
            >
              Watch on YouTube
            </a>
          </div>
        ) : embedActive ? (
          <div
            className="yt-player-shell relative w-full aspect-video bg-black rounded-none lg:rounded-xl overflow-hidden"
            style={{ backgroundImage: v.thumb_lg || v.thumb ? `url(${v.thumb_lg || v.thumb})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}
          >
            <iframe
              key={v.id}
              ref={embedIframeRef}
              src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1${startAt ? `&start=${Math.floor(startAt)}` : ""}`}
              title={v.title}
              className="w-full h-full border-0 relative z-10"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
            {/* ENDED overlay — sits ON TOP of YouTube's end screen so its
                "More videos" grid (which deep-links into the YouTube app)
                never kicks the user out of ytapp. Phase 2: gains the same
                autoplay countdown card as the direct player ([A7]). */}
            {embedEnded && (
              <div className="absolute inset-0 z-20 bg-black/95 flex flex-col items-center justify-center gap-5 px-4" data-testid="embed-ended-overlay">
                <CountdownCard />
                {/* no countdown (autoplay off, or nothing up next) → the
                    static up-next + replay, exactly the phase-1 overlay */}
                {!countdown && (
                  <>
                    <p className="text-white/60 text-[12px] font-medium uppercase tracking-[0.12em]">Up next</p>
                    {v.related?.[0] && (
                      <button
                        onClick={goNext}
                        className="w-full max-w-[420px] flex items-center gap-3 text-left rounded-xl hover:bg-white/10 p-2 transition-colors"
                        data-testid="embed-ended-next"
                      >
                        {v.related[0].thumb && <img src={v.related[0].thumb} alt="" className="w-[120px] aspect-video rounded-lg object-cover shrink-0" />}
                        <span className="min-w-0">
                          <span className="block text-white text-[14px] font-medium leading-[18px] line-clamp-2">{v.related[0].title}</span>
                          <span className="block text-white/60 text-[12px] mt-1">{v.related[0].channel} · {v.related[0].views}</span>
                        </span>
                      </button>
                    )}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={replayEmbed}
                        className="flex items-center gap-2 h-10 px-5 rounded-full bg-[var(--yt-bg-elev2)] text-[var(--yt-text)] text-[14px] font-medium hover:bg-[var(--yt-hover)]"
                      >
                        <RotateCcw className="w-5 h-5" /> Replay
                      </button>
                      {v.related?.[0] && (
                        <button
                          onClick={goNext}
                          className="flex items-center gap-2 h-10 px-5 rounded-full bg-white text-black text-[14px] font-medium hover:bg-white/90"
                        >
                          <Play className="w-5 h-5" fill="black" /> Next video
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="sm:hidden absolute bottom-0 inset-x-0 h-1 bg-transparent" />
          </div>
        ) : (
          <div
            ref={slotRefCb}
            className="yt-player-shell relative w-full aspect-video bg-black rounded-none lg:rounded-xl overflow-hidden bg-cover bg-center"
            style={v.thumb_lg || v.thumb ? { backgroundImage: `url(${v.thumb_lg || v.thumb})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            data-testid="player-slot"
          />
        )}
        {embedActive && !blockedMessage && (
          <p className="px-4 sm:px-0 py-2 text-[12px] text-[var(--yt-text-2)] bg-[var(--yt-bg-elev)] sm:rounded-lg sm:mt-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--yt-status-warn)] shrink-0" />
            {standaloneMode
              ? "Playing via the official YouTube player — ads may appear on monetized videos. Use Skip video below to jump to the next one. Background play works when a video streams directly."
              : communityMode
              ? "Community mode — playing via the official embed (ads may appear on monetized videos). Use Skip video below to jump to the next one. Background play works when a video streams directly."
              : "Playing via the official YouTube player — ads may appear on monetized videos. Use Skip video below to jump to the next one. Background play works when a video streams directly."}
            {v.gate_reason === "bot_gate" && " The server's IP is bot-gated by YouTube — setting server cookies (Settings → Server cookies) may restore direct, ad-free playback."}
          </p>
        )}
        {/* C-05: the Compat Mode entry — native only (a browser cannot script
            YouTube's page), killed by the Settings toggle */}
        {embedActive && !blockedMessage && isNativeApp() && compatEnabled && (
          <button
            onClick={() => navigate({ name: "compat", id: v.id })}
            data-testid="compat-entry"
            className="flex items-center gap-2 h-9 px-4 ml-4 mb-2 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[13px] font-medium shrink-0"
          >
            <Play className="w-4 h-4" /> Play in Compat Mode
          </button>
        )}

        {/* PLAYER BAR — always visible in BOTH player modes so playback
            controls (autoplay + audio mode + skip-entire-video) are always
            discoverable, even inside YouTube's own embed iframe. */}
        {!blockedMessage && (
          <div className="flex items-center justify-between gap-3 px-3 lg:px-0 py-2 mt-1 border-b border-[var(--yt-border)] overflow-x-auto no-scrollbar">
            <button
              onClick={() => setPrefs({ autoplay: !autoplay })}
              role="switch"
              aria-checked={autoplay}
              aria-label="Autoplay next video"
              className="flex items-center gap-2.5 py-1 shrink-0"
            >
              <span className="text-[13px] font-medium text-[var(--yt-text)]">Autoplay</span>
              <span className={`relative w-10 h-5 rounded-full transition-colors ${autoplay ? "bg-[var(--yt-blue)]" : "bg-[var(--yt-switch)]"}`}>
                <span className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white transition-all ${autoplay ? "left-[22px]" : "left-[3px]"}`} />
              </span>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              {hasAudioStream && (
                <button
                  onClick={() => setPrefs({ audioOnly: !audioOnly })}
                  role="switch"
                  aria-checked={audioOnly}
                  aria-label="Audio mode (data saver)"
                  title="Audio mode — play sound only, save data"
                  data-testid="audio-mode-toggle"
                  className={`flex items-center gap-2 h-8 px-3.5 rounded-full text-[13px] font-medium transition-colors ${audioOnly ? "bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)]" : "bg-[var(--yt-bg-elev2)] text-[var(--yt-text)] hover:bg-[var(--yt-hover)]"}`}
                >
                  <Headphones className="w-4 h-4" /> Audio
                </button>
              )}
              <button
                onClick={goNext}
                disabled={!v.related?.[0]}
                className={`flex items-center gap-2 h-8 px-3.5 rounded-full text-[13px] font-medium shrink-0 ${v.related?.[0] ? "bg-[var(--yt-bg-elev2)] text-[var(--yt-text)] hover:bg-[var(--yt-hover)]" : "opacity-40 pointer-events-none"}`}
                title="Skip to the next video"
              >
                <SkipForward className="w-4 h-4" /> Skip video
              </button>
            </div>
          </div>
        )}

        {/* title */}
        <h1 className="px-3 lg:px-0 mt-2 text-[18px] sm:text-[20px] font-medium leading-[26px] text-[var(--yt-text)]">{v.title || "Untitled"}</h1>

        {/* channel + actions row */}
        <div className="px-3 lg:px-0 mt-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              onClick={() => v.channel_id && navigate({ name: "channel", id: v.channel_id })}
              className="shrink-0"
              aria-label={v.channel}
            >
              {v.channel_thumb ? (
                <img src={v.channel_thumb} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] font-bold text-lg flex items-center justify-center">
                  {(v.channel || "?")[0]?.toUpperCase()}
                </span>
              )}
            </button>
            <div className="min-w-0">
              <button onClick={() => v.channel_id && navigate({ name: "channel", id: v.channel_id })} className="block text-[16px] font-medium truncate hover:text-[var(--yt-text)]">
                {v.channel || "Unknown"}
              </button>
              <p className="text-[12px] text-[var(--yt-text-2)] truncate">{v.channel_subs || `${formatViews(v.views)} subscribers`}</p>
            </div>
            <button
              onClick={() => {
                toggleSub({ id: v.channel_id || v.channel, name: v.channel, avatar: v.channel_thumb || "", subscribers: v.channel_subs || "" });
                ytToast(isSubbed ? `Unsubscribed from ${v.channel || "channel"}` : `Subscribed to ${v.channel || "channel"}`);
              }}
              data-testid="subscribe-button"
              className={`ml-2 shrink-0 h-9 px-4 rounded-full text-[14px] font-medium flex items-center gap-2 transition-colors ${isSubbed ? "bg-[var(--yt-bg-elev2)] text-[var(--yt-text)] hover:bg-[var(--yt-hover)]" : "bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)] hover:bg-[var(--yt-invert-hover)]"}`}
            >
              {isSubbed && <Bell className="w-4 h-4" />}
              {isSubbed ? "Subscribed" : "Subscribe"}
            </button>
          </div>

          {/* actions — YouTube mobile pattern: pill row, horizontally scrollable */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
            <div className="flex bg-[var(--yt-bg-elev2)] rounded-full h-9 shrink-0">
              <button
                onClick={() => v.title && toggleLike({ id: v.id, title: v.title, channel: v.channel, channel_id: v.channel_id, thumb: v.thumb_lg || "", views: String(v.views ?? ""), duration: "", published: "" })}
                className={`flex items-center gap-2 px-4 rounded-l-full text-[14px] hover:bg-[var(--yt-hover)] ${isLiked ? "text-[var(--yt-blue)]" : "text-[var(--yt-text)]"}`}
                aria-pressed={isLiked}
              >
                <ThumbsUp className="w-5 h-5" style={isLiked ? { fill: "var(--yt-blue)" } : undefined} />
                {likeCount && <span className="tabular-nums">{likeCount}</span>}
              </button>
              <div className="w-px bg-white/15 my-2" />
              <button
                onClick={() => toggleDislike(v.id)}
                className={`px-4 rounded-r-full hover:bg-[var(--yt-hover)] ${isDisliked ? "text-[var(--yt-blue)]" : "text-[var(--yt-text)]"}`}
                aria-label="Dislike"
              >
                <ThumbsDown className="w-5 h-5" style={isDisliked ? { fill: "var(--yt-blue)" } : undefined} />
              </button>
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(`https://youtu.be/${v.id}`)
                  .then(() => ytToast("Link copied to clipboard"))
                  .catch(() => ytToast("Copy failed — long-press the address instead"));
              }}
              data-testid="share-button"
              className="flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--yt-bg-elev2)] text-[14px] hover:bg-[var(--yt-hover)] shrink-0"
              title="Copy video link"
            >
              <Share2 className="w-5 h-5" /> Share
            </button>
            <button
              onClick={() => {
                const t = Math.floor(usePlayback.getState().current || 0);
                navigator.clipboard?.writeText(`https://www.youtube.com/watch?v=${v.id}${t ? `&t=${t}` : ""}`)
                  .then(() => ytToast(`Link copied at ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`))
                  .catch(() => ytToast("Copy failed"));
              }}
              data-testid="clip-button"
              className="hidden sm:flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--yt-bg-elev2)] text-[14px] hover:bg-[var(--yt-hover)] shrink-0"
              title="Copy link with timestamp"
            >
              <Scissors className="w-5 h-5" /> Clip
            </button>
            <button
              onClick={() => {
                if (!v.title) return;
                toggleLater({ id: v.id, title: v.title, channel: v.channel, channel_id: v.channel_id, thumb: v.thumb_lg || "", views: String(v.views ?? ""), duration: "", published: "" });
                ytToast(isLater ? "Removed from Watch later" : "Saved to Watch later");
              }}
              data-testid="save-button"
              className={`flex items-center gap-2 h-9 px-4 rounded-full text-[14px] shrink-0 ${isLater ? "bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)]" : "bg-[var(--yt-bg-elev2)] text-[var(--yt-text)] hover:bg-[var(--yt-hover)]"}`}
            >
              <BookmarkPlus className="w-5 h-5" /> {isLater ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        {/* description */}
        <div
          className="px-3 lg:px-0 mt-3 rounded-xl bg-[var(--yt-elev2-70)] p-3 cursor-pointer hover:bg-[var(--yt-bg-elev2)]"
          onClick={() => setDescOpen(o => !o)}
        >
          <p className="text-[14px] font-medium">
            {typeof v.views === "number" ? `${v.views.toLocaleString()} views` : formatViews(v.views) + (formatViews(v.views) ? " views" : "")}
            {v.published ? ` · ${fullDate(v.published)}` : ""}
            {embedActive ? "" : " · streaming ad-free"}
          </p>
          {v.description && (
            <p className={`mt-2 text-[14px] leading-[22px] whitespace-pre-wrap text-[var(--yt-text-2)] ${descOpen ? "" : "clamp-2"}`}>
              {v.description}
            </p>
          )}
          {(v.chapters?.length || 0) > 0 && descOpen && (
            <div className="mt-3 space-y-1">
              {v.chapters.map((c, i) => (
                <button
                  key={i}
                  className="block text-[13px] text-[var(--yt-blue)] hover:underline"
                  data-testid="desc-chapter"
                  onClick={(e) => {
                    e.stopPropagation();
                    // [A1] chapter chips seek through the store action
                    seekTo(c.start);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  {Math.floor(c.start / 60)}:{String(Math.floor(c.start % 60)).padStart(2, "0")} — {c.title}
                </button>
              ))}
            </div>
          )}
          <button className="mt-1 text-[14px] font-medium text-[var(--yt-text)]">{descOpen ? "Show less" : "…more"}</button>
        </div>

        {/* comments */}
        <div className="mt-6 px-3 lg:px-0">
          <Comments videoId={v.id} />
        </div>
      </div>

      {/* related sidebar */}
      <aside className="w-full lg:w-[320px] xl:w-[402px] shrink-0 px-3 lg:px-0 mt-6 lg:mt-0">
        <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
          {["All", "From this channel", "Related", "Recently uploaded", "Watched"].map((chip, i) => (
            <span key={chip} className={`shrink-0 h-8 px-3 rounded-lg text-[13px] font-medium flex items-center ${i === 0 ? "bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)]" : "bg-[var(--yt-bg-elev2)] text-[var(--yt-text)]"}`}>{chip}</span>
          ))}
        </div>
        <div className="space-y-2 sm:max-lg:grid sm:max-lg:grid-cols-2 sm:max-lg:gap-x-4 sm:max-lg:gap-y-6 sm:max-lg:space-y-0">
          {(v.related || []).map(r => <VideoCard key={r.id} video={r} compact responsive />)}
        </div>
      </aside>
    </div>
  );
}

// Hard-blocked = embed_fallback AND a playability reason AND embed-blocked or
// unavailable — the iframe can't play it either, so show OUR clean state.
function blocked(v: YtVideoFull): string | null {
  return v.embed_fallback && v.playability_reason && (v.embed_blocked || v.unavailable)
    ? v.playability_reason
    : null;
}
