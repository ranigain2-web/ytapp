"use client";

// Shorts — vertical, snap-scrolling feed like YouTube Shorts.
// Each short is a 9:16 player card (official embed) mounted only when near
// the viewport, with title / views overlay and rail actions.

import { useEffect, useState, useRef, useCallback } from "react";
import { itShortsFeed, type YtShort } from "@/lib/innertube";
import { useRouter } from "@/lib/yt-router";
import { ThumbsUp, ThumbsDown, Share2, MoreHorizontal, Music2 } from "lucide-react";
import { useYt } from "@/lib/yt-store";

function ShortCard({ short, active }: { short: YtShort; active: boolean }) {
  const { navigate } = useRouter();
  const liked = useYt(s => s.liked);
  const toggleLike = useYt(s => s.toggleLike);
  const isLiked = liked.some(l => l.id === short.id);

  return (
    <div className="relative w-full h-full flex items-center justify-center snap-start snap-always" data-testid="short-card">
      {/* the short: 9:16 player, mounted only while near the viewport */}
      <div className="relative h-full aspect-[9/16] bg-black overflow-hidden rounded-lg sm:rounded-xl">
        {active ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${short.id}?autoplay=1&playsinline=1&loop=1&mute=0&modestbranding=1&rel=0`}
            title={short.title}
            className="w-full h-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          // poster while inactive (thumbnail at original aspect ratio)
          <img
            src={`https://i.ytimg.com/vi/${short.id}/oardefault.jpg`}
            alt=""
            className="w-full h-full object-cover opacity-80"
            loading="lazy"
          />
        )}

        {/* gradient + info overlay (bottom) */}
        <div className="absolute inset-x-0 bottom-0 pt-16 pb-4 px-4 yt-scrim-bottom pointer-events-none">
          <p className="text-white text-[14px] font-medium leading-[20px] line-clamp-2">{short.title}</p>
          <p className="text-white/90 text-[13px] mt-2 flex items-center gap-1.5">
            <Music2 className="w-4 h-4" />
            Original audio
            {short.views ? ` · ${short.views} views` : ""}
          </p>
        </div>

        {/* rail actions (right, YouTube Shorts style) */}
        <div className="absolute right-2 bottom-24 flex flex-col items-center gap-5 text-white">
          <button
            onClick={() => short.title && toggleLike({ id: short.id, title: short.title, channel: "", channel_id: "", thumb: `https://i.ytimg.com/vi/${short.id}/mqdefault.jpg`, views: short.views, duration: "", published: "" })}
            aria-label="Like short"
            className="flex flex-col items-center gap-1"
          >
            <span className={`w-11 h-11 rounded-full bg-black/50 flex items-center justify-center ${isLiked ? "text-[#3ea6ff]" : ""}`}>
              <ThumbsUp className="w-6 h-6" fill={isLiked ? "#3ea6ff" : "none"} />
            </span>
          </button>
          <button aria-label="Dislike short" className="w-11 h-11 rounded-full bg-black/50 flex items-center justify-center">
            <ThumbsDown className="w-6 h-6" />
          </button>
          <button aria-label="Share short" className="w-11 h-11 rounded-full bg-black/50 flex items-center justify-center">
            <Share2 className="w-6 h-6" />
          </button>
          <button aria-label="More" className="w-11 h-11 rounded-full bg-black/50 flex items-center justify-center">
            <MoreHorizontal className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* open full watch page on tap of the top area */}
      <button
        onClick={() => navigate({ name: "watch", v: short.id })}
        className="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center"
        aria-label="Open watch page"
        title="Open watch page"
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 17 17 7M7 7h10v10" /></svg>
      </button>
    </div>
  );
}

export default function ShortsPage() {
  const [shorts, setShorts] = useState<YtShort[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await itShortsFeed();
        if (!alive) return;
        setShorts(r.shorts);
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
    <div className="fixed inset-0 top-0 pt-14 bg-[#0f0f0f] z-10">
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
    </div>
  );
}
