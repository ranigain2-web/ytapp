"use client";

// Shorts — vertical, snap-scrolling feed like YouTube Shorts.
// Each short is a 9:16 player card (official embed) mounted only when near
// the viewport. The page is fully immersive: no app header, no bottom nav
// (YouTube behavior) — just a back chevron and a search affordance on top.

import { useEffect, useState, useRef, useCallback } from "react";
import { itShortsFeed, itValidateShorts, type YtShort } from "@/lib/innertube";
import { fetchVideo, type YtVideoFull } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { ThumbsUp, ThumbsDown, Share2, MoreHorizontal, Music2, MessageCircle, Play } from "lucide-react";
import { useYt } from "@/lib/yt-store";
import SearchOverlay from "./SearchOverlay";
import VideoPlayer from "./VideoPlayer";

function formatShortCount(n?: string | number): string {
  const v = typeof n === "number" ? n : parseInt(String(n || "").replace(/[^0-9]/g, ""), 10);
  if (!isFinite(v) || isNaN(v)) return "";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(v);
}

function ShortCard({ short, active }: { short: YtShort; active: boolean }) {
  const { navigate } = useRouter();
  const liked = useYt(s => s.liked);
  const toggleLike = useYt(s => s.toggleLike);
  const isLiked = liked.some(l => l.id === short.id);
  // per-short video resolution: direct googlevideo streams when extractable,
  // official embed otherwise. Loaded lazily when the card becomes active.
  const [video, setVideo] = useState<YtVideoFull | null>(null);
  const [forceEmbed, setForceEmbed] = useState(false);
  const handlePlayerFallback = useCallback(() => setForceEmbed(true), []);
  const triedRef = useRef(false);

  useEffect(() => {
    if (!active || triedRef.current || video) return;
    triedRef.current = true;
    let alive = true;
    fetchVideo(short.id)
      .then(v => { if (alive) setVideo(v); })
      .catch(() => { if (alive) setForceEmbed(true); });
    return () => { alive = false; };
  }, [active, video, short.id]);

  const useDirect = !!video && !video.embed_fallback && !video.unavailable && !forceEmbed;

  const like = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (short.title) toggleLike({ id: short.id, title: short.title, channel: "", channel_id: "", thumb: `https://i.ytimg.com/vi/${short.id}/mqdefault.jpg`, views: short.views, duration: "", published: "" });
  };
  const share = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(`https://www.youtube.com/shorts/${short.id}`).catch(() => {});
  };

  const likeCount = formatShortCount(short.views ? Math.max(1, Math.floor((typeof short.views === "number" ? short.views : parseInt(String(short.views).replace(/[^0-9]/g, ""), 10) || 0) / 30)) : "");

  return (
    <div className="relative w-full h-full flex items-center justify-center snap-start snap-always" data-testid="short-card">
      {/* the short: true 9:16, never clipped — width = min(100%, height*9/16) */}
      <div className="yt-short-frame relative bg-black overflow-hidden rounded-lg sm:rounded-xl">
        {useDirect ? (
          // direct ad-free googlevideo playback through our custom player
          <VideoPlayer video={video!} minimal onFallback={handlePlayerFallback} />
        ) : active ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${short.id}?autoplay=1&playsinline=1&loop=1&mute=0&modestbranding=1&rel=0`}
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

        {/* gradient + channel/title overlay (bottom-left, YouTube layout) */}
        <div className={`absolute inset-x-0 bottom-0 pt-20 pl-3 pr-16 yt-scrim-bottom pointer-events-none ${useDirect ? "pb-8" : "pb-3"}`}>
          {/* channel row w/ subscribe — red pill like real Shorts */}
          <div className="flex items-center gap-2 mb-2 pointer-events-auto">
            <button
              onClick={(e) => { e.stopPropagation(); navigate({ name: "watch", v: short.id }); }}
              className="flex items-center gap-2 min-w-0"
              aria-label={short.title}
            >
              <span className="w-8 h-8 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-[13px] font-bold flex items-center justify-center shrink-0">
                {(short.title || "?")[0]?.toUpperCase() || "?"}
              </span>
              <span className="text-white text-[13px] font-medium truncate max-w-[140px] drop-shadow">Shorts feed</span>
            </button>
            <button
              className="h-7 px-3.5 rounded-full bg-[#ff0000] text-white text-[12px] font-medium shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              Subscribe
            </button>
          </div>
          <p className="text-white text-[14px] font-medium leading-[19px] line-clamp-2 drop-shadow">{short.title}</p>
          <p className="text-white/90 text-[12px] mt-1.5 flex items-center gap-1.5">
            <Music2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Original audio{short.views ? ` · ${short.views} views` : ""}</span>
          </p>
        </div>

        {/* rail actions (right edge, YouTube Shorts style: tight grouping, counts not words) */}
        <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4 text-white">
          <button onClick={like} aria-label="Like short" className="flex flex-col items-center gap-1">
            <span className={`w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center transition-colors ${isLiked ? "text-[#3ea6ff]" : ""}`}>
              <ThumbsUp className="w-6 h-6" fill={isLiked ? "#3ea6ff" : "none"} />
            </span>
            {likeCount && <span className="text-[11px] font-medium tabular-nums drop-shadow">{likeCount}</span>}
          </button>
          <button aria-label="Dislike short" className="flex flex-col items-center gap-1">
            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <ThumbsDown className="w-6 h-6" />
            </span>
            <span className="text-[11px] font-medium tabular-nums text-white/80">&nbsp;</span>
          </button>
          <button
            aria-label="Comments"
            onClick={(e) => { e.stopPropagation(); navigate({ name: "watch", v: short.id }); }}
            className="flex flex-col items-center gap-1"
          >
            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <MessageCircle className="w-6 h-6" />
            </span>
            <span className="text-[11px] font-medium tabular-nums text-white/80">{likeCount || ""}</span>
          </button>
          <button onClick={share} aria-label="Share short" className="flex flex-col items-center gap-1">
            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <Share2 className="w-6 h-6" />
            </span>
            <span className="text-[11px] font-medium tabular-nums text-white/80">&nbsp;</span>
          </button>
          <button aria-label="More" className="flex flex-col items-center gap-1">
            <span className="w-11 h-11 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
              <MoreHorizontal className="w-6 h-6" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShortsPage() {
  const [shorts, setShorts] = useState<YtShort[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { navigate } = useRouter();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await itShortsFeed();
        if (!alive) return;
        let list = r.shorts;
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
  }, []);

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
      {/* immersive chrome: back chevron (left) + search (right), floating over the feed */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-2 pt-2 pointer-events-none">
        <button
          onClick={() => navigate({ name: "home" })}
          aria-label="Back to home"
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
              <ShortCard short={s} active={i === activeIdx} />
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
