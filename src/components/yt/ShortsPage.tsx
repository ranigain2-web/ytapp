"use client";

// Shorts — vertical, snap-scrolling feed like YouTube Shorts.
// Each short is a 9:16 player card mounted only when near the viewport.
// Phase 4 "Shorts truth": real channel identity + subscribe (from the fetched
// video — the lockup payload carries no identity in this feed shape), a real
// comments bottom sheet, double-tap-to-like with the heart animation, a
// remembered sound toggle, and a history-back chevron. The like button is
// local-only: real counts aren't public in the lockup data, so none are shown.

import { useEffect, useState, useRef, useCallback } from "react";
import { itShortsFeed, itValidateShorts, type YtShort } from "@/lib/innertube";
import { fetchVideo, type YtVideoFull } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { ThumbsUp, Share2, Music2, MessageCircle, Play, Volume2, VolumeX, Heart } from "lucide-react";
import { useYt } from "@/lib/yt-store";
import { ytToast } from "@/lib/yt-toast";
import SearchOverlay from "./SearchOverlay";
import VideoPlayer from "./VideoPlayer";
import Comments from "./Comments";

const MUTE_KEY = "yt_shorts_muted";

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

function CommentsSheet({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button className="fixed inset-0 z-[80] bg-black/60" onClick={onClose} aria-label="Close comments" />
      <div
        className="fixed left-0 right-0 bottom-0 z-[81] h-[72vh] rounded-t-2xl bg-[var(--yt-bg)] overflow-hidden flex flex-col yt-sheet-up"
        role="dialog"
        aria-label="Short comments"
        data-testid="short-comments-sheet"
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--yt-border)] shrink-0">
          <span className="text-[16px] font-medium text-[var(--yt-text)]">Comments</span>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full hover:bg-[var(--yt-hover)] text-[var(--yt-text)]">✕</button>
        </div>
        <div className="overflow-y-auto px-4 py-4">
          <Comments videoId={videoId} />
        </div>
      </div>
    </>
  );
}

function ShortCard({ short, active, muted, onToggleMute }: { short: YtShort; active: boolean; muted: boolean; onToggleMute: () => void }) {
  const { navigate } = useRouter();
  const liked = useYt(s => s.liked);
  const toggleLike = useYt(s => s.toggleLike);
  const subs = useYt(s => s.subs);
  const toggleSub = useYt(s => s.toggleSub);
  const isLiked = liked.some(l => l.id === short.id);
  // per-short video resolution: direct googlevideo streams when extractable,
  // official embed otherwise. The fetched video also carries the REAL channel
  // identity the lockup payload lacks.
  const [video, setVideo] = useState<YtVideoFull | null>(null);
  const [forceEmbed, setForceEmbed] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [heart, setHeart] = useState(0);
  const handlePlayerFallback = useCallback(() => setForceEmbed(true), []);
  const triedRef = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || triedRef.current || video) return;
    triedRef.current = true;
    let alive = true;
    fetchVideo(short.id)
      .then(v => { if (alive) { setVideo(v); setForceEmbed(false); } })
      .catch(() => { if (alive) setForceEmbed(true); });
    return () => { alive = false; };
  }, [active, video, short.id]);

  const useDirect = !!video && !video.embed_fallback && !video.unavailable && !forceEmbed;

  // remembered sound: apply to the direct player's element whenever it changes
  useEffect(() => {
    if (!useDirect) return;
    const apply = () => {
      const el = frameRef.current?.querySelector("video");
      if (el) el.muted = muted;
    };
    apply();
    const t = setInterval(apply, 800); // until loadedmetadata settles it
    const stop = setTimeout(() => clearInterval(t), 6000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [useDirect, muted, video]);

  const channel = video?.channel || "";
  const channelId = video?.channel_id || "";
  const isSubbed = channelId && subs.some(s => s.id === channelId);

  const doLike = () => {
    toggleLike({ id: short.id, title: short.title, channel, channel_id: channelId, thumb: `https://i.ytimg.com/vi/${short.id}/mqdefault.jpg`, views: short.views, duration: "", published: "" });
    if (!isLiked) setHeart(k => k + 1); // the heart pops only when the like lands
  };

  const share = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(`https://www.youtube.com/shorts/${short.id}`)
      .then(() => ytToast("Short link copied"))
      .catch(() => ytToast("Copy failed"));
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center snap-start snap-always" data-testid="short-card">
      {/* the short: true 9:16, never clipped — width = min(100%, height*9/16) */}
      <div ref={frameRef} className="yt-short-frame relative bg-black overflow-hidden rounded-lg sm:rounded-xl">
        {useDirect ? (
          // direct ad-free googlevideo playback through our custom player
          <VideoPlayer video={video!} minimal onFallback={handlePlayerFallback} />
        ) : active ? (
          <iframe
            key={muted ? "m" : "u"}
            src={`https://www.youtube-nocookie.com/embed/${short.id}?autoplay=1&playsinline=1&loop=1&mute=${muted ? 1 : 0}&modestbranding=1&rel=0`}
            title={short.title}
            className="w-full h-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          // poster while inactive — blurred fill + sharp centered copy
          <>
            <img
              src={`https://i.ytimg.com/vi/${short.id}/oardefault.jpg`}
              alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-60 blur-[1px]"
              loading="lazy"
            />
            <img
              src={`https://i.ytimg.com/vi/${short.id}/oardefault.jpg`}
              alt=""
              className="relative w-full h-full object-cover"
              loading="lazy"
            />
          </>
        )}

        {/* double-tap-to-like heart (pops on the info zone + like button) */}
        {heart > 0 && (
          <div key={heart} className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
            <Heart className="w-24 h-24 text-[#ff2b55] heart-pop" fill="#ff2b55" />
          </div>
        )}

        {/* gradient + channel/title overlay (bottom-left, YouTube layout) */}
        <div className={`absolute inset-x-0 bottom-0 pt-20 pl-3 pr-16 yt-scrim-bottom pointer-events-none ${useDirect ? "pb-8" : "pb-3"}`}>
          {/* channel row w/ subscribe — real identity once the video loaded;
              no identity → honest placeholder, no fake "Shorts feed" */}
          <div className="flex items-center gap-2 mb-2 pointer-events-auto" onDoubleClick={doLike}>
            {channelId ? (
              <button
                onClick={(e) => { e.stopPropagation(); navigate({ name: "channel", id: channelId }); }}
                className="flex items-center gap-2 min-w-0"
                aria-label={channel}
              >
                {video?.channel_thumb ? (
                  <img src={video.channel_thumb} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-[13px] font-bold flex items-center justify-center shrink-0">
                    {channel[0]?.toUpperCase() || "?"}
                  </span>
                )}
                <span className="text-white text-[13px] font-medium truncate max-w-[140px] drop-shadow">{channel}</span>
              </button>
            ) : (
              <span className="w-8 h-8 rounded-full bg-white/20 animate-pulse shrink-0" aria-label="Loading channel" />
            )}
            {channelId && (
              <button
                data-testid="short-subscribe"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSub({ id: channelId, name: channel, avatar: video?.channel_thumb || "", subscribers: "" });
                  ytToast(isSubbed ? `Unsubscribed from ${channel}` : `Subscribed to ${channel}`);
                }}
                className={`h-7 px-3.5 rounded-full text-white text-[12px] font-medium shrink-0 ${isSubbed ? "bg-white/20" : "bg-[#ff0000]"}`}
              >
                {isSubbed ? "Subscribed" : "Subscribe"}
              </button>
            )}
          </div>
          <p className="text-white text-[14px] font-medium leading-[19px] line-clamp-2 drop-shadow">{short.title}</p>
          <p className="text-white/90 text-[12px] mt-1.5 flex items-center gap-1.5">
            <Music2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Original audio{short.views ? ` · ${short.views} views` : ""}</span>
          </p>
        </div>

        {/* rail actions (right edge): like (local, real state, no fake count),
             comments sheet, sound toggle (remembered), share */}
        <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4 text-white">
          <button onClick={(e) => { e.stopPropagation(); doLike(); }} aria-label="Like short" aria-pressed={isLiked} data-testid="short-like" className="flex flex-col items-center gap-1">
            <span className={`w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center transition-transform ${isLiked ? "text-[#3ea6ff] scale-105" : ""}`}>
              <ThumbsUp className="w-6 h-6" fill={isLiked ? "#3ea6ff" : "none"} />
            </span>
          </button>
          <button
            aria-label="Comments"
            data-testid="short-comments"
            onClick={(e) => { e.stopPropagation(); setCommentsOpen(true); }}
            className="flex flex-col items-center gap-1"
          >
            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <MessageCircle className="w-6 h-6" />
            </span>
          </button>
          <button
            aria-label={muted ? "Unmute" : "Mute"}
            data-testid="short-mute"
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            className="flex flex-col items-center gap-1"
          >
            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
              {muted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
            </span>
          </button>
          <button onClick={share} aria-label="Share short" className="flex flex-col items-center gap-1">
            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <Share2 className="w-6 h-6" />
            </span>
          </button>
        </div>

        {commentsOpen && <CommentsSheet videoId={short.id} onClose={() => setCommentsOpen(false)} />}
      </div>
    </div>
  );
}

export default function ShortsPage({ startId }: { startId?: string }) {
  const [shorts, setShorts] = useState<YtShort[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [muted, setMuted] = useState(() => (typeof window === "undefined" ? false : readMuted()));
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { navigate } = useRouter();
  const toggleMute = useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // route entry (?page=shorts&id=): lead with THAT short — identity
        // details come from its video fetch inside the card
        let entry: YtShort | null = null;
        if (startId) {
          try {
            const v = await fetchVideo(startId);
            if (v && !v.unavailable) entry = { id: startId, title: v.title || "", views: "" };
          } catch { /* entry stays null; the feed still loads */ }
        }
        const r = await itShortsFeed();
        if (!alive) return;
        let list = r.shorts;
        if (entry) list = [entry, ...list.filter(s => s.id !== entry!.id)];
        // Never open on a dead card: oEmbed-validate the first 6 and drop
        // unavailable ones (best-effort; transport failure keeps them).
        if (list.length > 1) {
          const valid = await itValidateShorts(list.slice(0, 6).map(s => s.id));
          list = list.filter((s, i) => i >= 6 || valid.has(s.id));
        }
        if (!alive) return;
        setShorts(list);
        setContinuation(r.continuation);
      } catch (e) {
        if (alive) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [startId]);

  // track the visible card (autoplay only for it)
  useEffect(() => {
    if (!shorts?.length) return;
    const ios: IntersectionObserver[] = [];
    shorts.forEach((_, i) => {
      const el = cardRefs.current[i];
      if (!el) return;
      const io = new IntersectionObserver(entries => {
        if (entries.some(e => e.intersectionRatio > 0.6)) setActiveIdx(i);
      }, { threshold: [0.6] });
      io.observe(el);
      ios.push(io);
    });
    return () => ios.forEach(io => io.disconnect());
  }, [shorts]);

  // infinite scroll: last card visible → load more
  const loadMore = useCallback(async () => {
    if (!continuation || !shorts) return;
    try {
      const r = await itShortsFeed(continuation);
      const seen = new Set(shorts.map(s => s.id));
      setShorts(prev => [...(prev || []), ...r.shorts.filter(s => !seen.has(s.id))]);
      setContinuation(r.continuation || null);
    } catch { /* stop */ }
  }, [continuation, shorts]);

  useEffect(() => {
    if (!shorts?.length || !continuation) return;
    const el = cardRefs.current[shorts.length - 3];
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore();
    }, { root: containerRef.current, rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shorts, continuation, loadMore]);

  const loading = shorts === null && err === null;

  return (
    <div className="fixed inset-0 top-0 bg-[#0f0f0f] z-10">
      {/* immersive chrome: back chevron (history-back like YouTube) + search */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-2 pt-2 pointer-events-none">
        <button
          onClick={() => { if (window.history.length > 1) window.history.back(); else navigate({ name: "home" }); }}
          aria-label="Back"
          className="pointer-events-auto w-10 h-10 rounded-full flex items-center justify-center text-white/95 hover:bg-black/40 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search"
          className="pointer-events-auto w-10 h-10 rounded-full flex items-center justify-center text-white/95 hover:bg-black/40 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </button>
      </div>

      <div
        ref={containerRef}
        className="h-full overflow-y-auto snap-y snap-mandatory overscroll-contain no-scrollbar"
        data-testid="shorts-feed"
      >
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-12 h-12 rounded-full border-[3px] border-white/25 border-t-white animate-spin" role="status" aria-label="Loading Shorts" />
          </div>
        ) : err ? (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <p className="text-[#f1f1f1] text-[16px] font-medium mb-2">Shorts unavailable</p>
            <p className="text-[#aaa] text-[13px]">{err}</p>
          </div>
        ) : !shorts || shorts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center px-8 text-center">
            <Play className="w-12 h-12 text-[#3f3f3f] mb-3" />
            <p className="text-[#f1f1f1] text-[16px] font-medium mb-1">No Shorts right now</p>
            <p className="text-[#aaa] text-[13px]">Swipe down to refresh later</p>
          </div>
        ) : (
          shorts.map((s, i) => (
            <div
              key={s.id}
              ref={el => { cardRefs.current[i] = el; }}
              className="h-full"
            >
              <ShortCard short={s} active={i === activeIdx} muted={muted} onToggleMute={toggleMute} />
            </div>
          ))
        )}
      </div>

      {/* search overlay reachable from the immersive feed */}
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSearch={(q) => { setSearchOpen(false); navigate({ name: "search", q }); }}
        initialQuery=""
      />
    </div>
  );
}
