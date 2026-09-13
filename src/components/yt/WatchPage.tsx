"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchVideo, fetchComments, getActiveSource, type YtVideoFull, type YtComment } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { formatViews, formatCount, timeAgo, fullDate } from "@/lib/yt-format";
import VideoPlayer from "./VideoPlayer";
import { VideoCard } from "./VideoCard";
import Comments from "./Comments";
import { ThumbsUp, ThumbsDown, Share2, BookmarkPlus, Download, Scissors, Bell, AlertTriangle } from "lucide-react";

export default function WatchPage({ videoId, startAt }: { videoId: string; startAt?: number }) {
  const { navigate } = useRouter();
  const [data, setData] = useState<YtVideoFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  // set when the direct-stream player proves unplayable (bot-gated HLS, dead
  // CDN URLs, …): swaps in the official embed player, which always plays —
  // the same mechanism the Shorts feed uses. Stable identity on purpose.
  const [forceEmbed, setForceEmbed] = useState(false);
  const handlePlayerFallback = useCallback(() => setForceEmbed(true), []);
  const loading = data === null && err === null;

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
  const setProgress = useYt(s => s.setProgress);
  const autoplay = useYt(s => s.prefs.autoplay);

  const isSubbed = subs.some(s => s.id === (data?.channel_id || ""));
  const isLiked = liked.some(l => l.id === videoId);
  const isDisliked = disliked.includes(videoId);
  const isLater = later.some(l => l.id === videoId);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await fetchVideo(videoId);
        if (!alive) return;
        setData(v);
        // add to history
        if (v.title) {
          addHistory({
            id: v.id, title: v.title, channel: v.channel, channel_id: v.channel_id,
            thumb: v.thumb_lg || v.thumb || "", views: String(v.views ?? ""), duration: v.duration ? `${v.duration}` : "",
            published: v.published || "", length: v.duration || 0,
          });
        }
      } catch (e) {
        if (alive) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [videoId, addHistory]);

  const onProgress = useCallback((cur: number, dur: number) => {
    if (dur > 0 && Math.floor(cur) % 5 === 0) setProgress(videoId, cur, dur);
  }, [videoId, setProgress]);

  const goNext = useCallback(() => {
    if (data?.related?.[0]) navigate({ name: "watch", v: data.related[0].id });
  }, [data, navigate]);

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
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-[#272727] flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-[#aaa]" />
        </div>
        <h1 className="text-[20px] font-bold text-[#f1f1f1] mb-3">Video unavailable</h1>
        <p className="text-[14px] leading-[20px] text-[#aaa] mb-8">{reason}</p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate({ name: "home" })} className="px-5 py-2.5 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-[14px]">Go to home</button>
          {data?.id && (
            <a href={`https://www.youtube.com/watch?v=${data.id}`} target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 rounded-full bg-[#f1f1f1] text-[#0f0f0f] text-[14px] font-medium">
              Watch on YouTube
            </a>
          )}
        </div>
      </div>
    );
  }

  const v = data!;
  const likeCount = v.likes ? formatCount(v.likes) : "";
  const source = getActiveSource();
  const communityMode = source === "community";
  const standaloneMode = source === "standalone";
  // Hard-blocked video (copyright/geo/embed-blocked with no playable stream)
  // → OUR clean state, because the embed player can't play it either.
  // Bot-gated videos (LOGIN_REQUIRED "confirm you're not a bot") are NOT here:
  // the official embed still plays them (the Shorts feed proves it), so they
  // fall through to the embed player below.
  const blockedMessage = v.embed_fallback && v.playability_reason && (v.embed_blocked || v.unavailable)
    ? v.playability_reason
    : null;

  return (
    <div className="yt-watch-outer max-w-[1754px] mx-auto px-0 sm:px-6 pt-0 sm:pt-6 pb-16 flex flex-col xl:flex-row gap-0 sm:gap-6">
      {/* main column */}
      <div className="yt-player-col flex-1 min-w-0 max-w-[1280px] mx-auto w-full">
        {/* PLAYER */}
        {blockedMessage ? (
          <div
            className="w-full aspect-video bg-black rounded-none sm:rounded-xl flex flex-col items-center justify-center px-6 text-center bg-cover bg-center"
            style={v.thumb_lg || v.thumb ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0.72)), url(${v.thumb_lg || v.thumb})` } : undefined}
            data-testid="blocked-video"
          >
            <AlertTriangle className="w-10 h-10 text-[#ddd] mb-4" />
            <h2 className="text-white text-[17px] font-medium mb-2">Video unavailable</h2>
            <p className="text-[#ddd]/80 text-[13px] leading-[18px] max-w-[480px]">{blockedMessage}</p>
            <a
              href={`https://www.youtube.com/watch?v=${v.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 px-5 py-2.5 rounded-full bg-[#f1f1f1] text-[#0f0f0f] text-[14px] font-medium"
            >
              Watch on YouTube
            </a>
          </div>
        ) : v.embed_fallback || forceEmbed ? (
          <div
            className="yt-player-shell relative w-full aspect-video bg-black rounded-none sm:rounded-xl overflow-hidden"
            style={{ backgroundImage: v.thumb_lg || v.thumb ? `url(${v.thumb_lg || v.thumb})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}
          >
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1${startAt ? `&start=${Math.floor(startAt)}` : ""}`}
              title={v.title}
              className="w-full h-full border-0 relative z-10"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
            <div className="sm:hidden absolute bottom-0 inset-x-0 h-1 bg-transparent" />
          </div>
        ) : (
          <VideoPlayer video={v} startAt={startAt} onEnded={autoplay ? goNext : undefined} onNext={goNext} onProgress={onProgress} onFallback={handlePlayerFallback} />
        )}
        {(v.embed_fallback || forceEmbed) && !blockedMessage && (
          <p className="px-4 sm:px-0 py-2 text-[12px] text-[#aaa] bg-[#1a1a1a] sm:rounded-lg sm:mt-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ffb13b]" />
            {standaloneMode
              ? "Playing via the official YouTube player — ads may appear on monetized videos."
              : communityMode
              ? "Community mode — playing via the official embed (ads may appear on monetized videos)."
              : "Playing via the official YouTube player — ads may appear on monetized videos."}
          </p>
        )}

        {/* title */}
        <h1 className="px-3 sm:px-0 mt-3 text-[18px] sm:text-[20px] font-medium leading-[26px] text-[#f1f1f1]">{v.title || "Untitled"}</h1>

        {/* channel + actions row */}
        <div className="px-3 sm:px-0 mt-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              onClick={() => v.channel_id && navigate({ name: "channel", id: v.channel_id })}
              className="shrink-0"
              aria-label={v.channel}
            >
              {v.channel_thumb ? (

                <img src={v.channel_thumb} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-[#3ea6ff] text-[#0f0f0f] font-bold text-lg flex items-center justify-center">
                  {(v.channel || "?")[0]?.toUpperCase()}
                </span>
              )}
            </button>
            <div className="min-w-0">
              <button onClick={() => v.channel_id && navigate({ name: "channel", id: v.channel_id })} className="block text-[16px] font-medium truncate hover:text-[#f1f1f1]/90">
                {v.channel || "Unknown"}
              </button>
              <p className="text-[12px] text-[#aaa] truncate">{v.channel_subs || `${formatViews(v.views)} subscribers`}</p>
            </div>
            <button
              onClick={() => toggleSub({ id: v.channel_id || v.channel, name: v.channel, avatar: v.channel_thumb || "", subscribers: v.channel_subs || "" })}
              className={`ml-2 shrink-0 h-9 px-4 rounded-full text-[14px] font-medium flex items-center gap-2 transition-colors ${isSubbed ? "bg-[#272727] text-[#f1f1f1] hover:bg-[#3f3f3f]" : "bg-[#f1f1f1] text-[#0f0f0f] hover:bg-[#d9d9d9]"}`}
            >
              {isSubbed && <Bell className="w-4 h-4" />}
              {isSubbed ? "Subscribed" : "Subscribe"}
            </button>
          </div>

          {/* actions — YouTube mobile pattern: pill row, horizontally scrollable */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
            <div className="flex bg-[#272727] rounded-full h-9 shrink-0">
              <button
                onClick={() => v.title && toggleLike({ id: v.id, title: v.title, channel: v.channel, channel_id: v.channel_id, thumb: v.thumb_lg || "", views: String(v.views ?? ""), duration: "", published: "" })}
                className={`flex items-center gap-2 px-4 rounded-l-full text-[14px] hover:bg-[#3f3f3f] ${isLiked ? "text-[#3ea6ff]" : "text-[#f1f1f1]"}`}
                aria-pressed={isLiked}
              >
                <ThumbsUp className="w-5 h-5" fill={isLiked ? "#3ea6ff" : "none"} />
                {likeCount && <span className="tabular-nums">{likeCount}</span>}
              </button>
              <div className="w-px bg-white/15 my-2" />
              <button
                onClick={() => toggleDislike(v.id)}
                className={`px-4 rounded-r-full hover:bg-[#3f3f3f] ${isDisliked ? "text-[#3ea6ff]" : "text-[#f1f1f1]"}`}
                aria-label="Dislike"
              >
                <ThumbsDown className="w-5 h-5" fill={isDisliked ? "#3ea6ff" : "none"} />
              </button>
            </div>
            <button
              onClick={() => { navigator.clipboard?.writeText(`${location.origin}/?v=${v.id}`).catch(() => {}); }}
              className="flex items-center gap-2 h-9 px-4 rounded-full bg-[#272727] text-[14px] hover:bg-[#3f3f3f] shrink-0"
            >
              <Share2 className="w-5 h-5" /> Share
            </button>
            <button
              onClick={() => { window.open(`https://www.youtube.com/watch?v=${v.id}`, "_blank", "noopener"); }}
              className="hidden sm:flex items-center gap-2 h-9 px-4 rounded-full bg-[#272727] text-[14px] hover:bg-[#3f3f3f] shrink-0"
              title="Open on YouTube"
            >
              <Download className="w-5 h-5" /> Download
            </button>
            <button
              className="flex sm:hidden items-center gap-2 h-9 px-4 rounded-full bg-[#272727] text-[14px] hover:bg-[#3f3f3f] shrink-0"
              onClick={() => { navigator.clipboard?.writeText(`https://www.youtube.com/watch?v=${v.id}`).catch(() => {}); }}
              title="Copy video link"
            >
              <Scissors className="w-5 h-5" /> Clip
            </button>
            <button
              onClick={() => v.title && toggleLater({ id: v.id, title: v.title, channel: v.channel, channel_id: v.channel_id, thumb: v.thumb_lg || "", views: String(v.views ?? ""), duration: "", published: "" })}
              className={`flex items-center gap-2 h-9 px-4 rounded-full text-[14px] shrink-0 ${isLater ? "bg-[#f1f1f1] text-[#0f0f0f]" : "bg-[#272727] text-[#f1f1f1] hover:bg-[#3f3f3f]"}`}
            >
              <BookmarkPlus className="w-5 h-5" /> {isLater ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        {/* description */}
        <div
          className="px-3 sm:px-0 mt-3 rounded-xl bg-[#272727]/70 p-3 cursor-pointer hover:bg-[#272727]"
          onClick={() => setDescOpen(o => !o)}
        >
          <p className="text-[14px] font-medium">
            {typeof v.views === "number" ? `${v.views.toLocaleString()} views` : formatViews(v.views) + (formatViews(v.views) ? " views" : "")}
            {v.published ? ` · ${fullDate(v.published)}` : ""}
            {v.embed_fallback ? "" : " · streaming ad-free"}
          </p>
          {v.description && (
            <p className={`mt-2 text-[14px] leading-[22px] whitespace-pre-wrap text-[#ddd] ${descOpen ? "" : "clamp-2"}`}>
              {v.description}
            </p>
          )}
          {(v.chapters?.length || 0) > 0 && descOpen && (
            <div className="mt-3 space-y-1">
              {v.chapters.map((c, i) => (
                <button key={i} className="block text-[13px] text-[#3ea6ff] hover:underline" onClick={(e) => e.stopPropagation()}>
                  {Math.floor(c.start / 60)}:{String(Math.floor(c.start % 60)).padStart(2, "0")} — {c.title}
                </button>
              ))}
            </div>
          )}
          <button className="mt-1 text-[14px] font-medium text-[#f1f1f1]">{descOpen ? "Show less" : "…more"}</button>
        </div>

        {/* comments */}
        <div className="mt-6 px-3 sm:px-0">
          <Comments videoId={v.id} />
        </div>
      </div>

      {/* related sidebar */}
      <aside className="w-full xl:w-[402px] shrink-0 px-3 sm:px-0 mt-6 xl:mt-0">
        <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar">
          {["All", "From this channel", "Related", "Recently uploaded", "Watched"].map((chip, i) => (
            <span key={chip} className={`shrink-0 h-8 px-3 rounded-lg text-[13px] font-medium flex items-center ${i === 0 ? "bg-[#f1f1f1] text-[#0f0f0f]" : "bg-[#272727] text-[#f1f1f1]"}`}>{chip}</span>
          ))}
        </div>
        <div className="space-y-2">
          {(v.related || []).map(r => <VideoCard key={r.id} video={r} compact />)}
        </div>
      </aside>
    </div>
  );
}
