"use client";

import { useState, useEffect } from "react";
import type { YtVideo } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { formatViews, timeAgo } from "@/lib/yt-format";
import { BookmarkPlus } from "lucide-react";
import { useYt } from "@/lib/yt-store";
import { getAvatar } from "@/lib/yt-avatar";
import { href } from "@/lib/yt-router";

// "1.2M views" / "131 watching" — never "131 watching views"
export function viewsText(video: { views?: string | number; is_live?: boolean }): string {
  const v = video.views;
  if (v === undefined || v === null || v === "") return "";
  const s = String(v);
  if (/watching/i.test(s)) return s.replace(/^\s*/, "");
  const f = formatViews(s);
  return f ? `${f} views` : "";
}

function ChannelAvatar({ name, channelId, url, size = 36 }: { name: string; channelId?: string; url?: string; size?: number }) {
  const real = url || (channelId ? getAvatar(channelId) : "");
  const [, bump] = useState(0);
  useEffect(() => {
    if (real || !channelId) return;
    const onAvatars = () => bump(v => v + 1);
    window.addEventListener("yt-avatars", onAvatars);
    return () => window.removeEventListener("yt-avatars", onAvatars);
  }, [real, channelId]);
  if (real) {
    return <img src={real} alt="" className="rounded-full object-cover shrink-0 select-none" style={{ width: size, height: size }} loading="lazy" />;
  }
  const colors = ["#3ea6ff", "#ff4e45", "#ffb13b", "#2ba640", "#9c4dcc", "#e91e63", "#00bcd4"];
  const c = colors[(name.charCodeAt(0) || 0) % colors.length];
  return (
    <span
      className="rounded-full flex items-center justify-center font-medium text-white shrink-0 select-none"
      style={{ width: size, height: size, background: c, fontSize: size * 0.42 }}
      aria-hidden
    >
      {(name || "?").trim()[0]?.toUpperCase() || "?"}
    </span>
  );
}

export function VideoCard({ video, compact = false }: { video: YtVideo; compact?: boolean }) {
  const { navigate } = useRouter();
  const later = useYt(s => s.later);
  const toggleLater = useYt(s => s.toggleLater);
  const isLater = later.some(l => l.id === video.id);
  const [hover, setHover] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const open = () => navigate({ name: "watch", v: video.id });
  const openChannel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (video.channel_id) navigate({ name: "channel", id: video.channel_id });
  };

  const saveLater = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleLater({ id: video.id, title: video.title, channel: video.channel, channel_id: video.channel_id, thumb: video.thumb, views: video.views, duration: video.duration, published: video.published });
  };

  if (compact) {
    // sidebar-related video card (horizontal)
    return (
      <button onClick={open} className="flex gap-2 w-full text-left group">
        <div className="relative w-[168px] shrink-0 aspect-video rounded-lg overflow-hidden bg-[var(--yt-bg-elev)]">
          {!imgFailed ? (

            <img src={video.thumb} alt={video.title} loading="lazy" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
          ) : <div className="w-full h-full" />}
          {video.duration && !video.is_live && (
            <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[11px] font-medium px-[3px] rounded-[3px]">{video.duration}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-normal leading-[20px] clamp-2 text-[var(--yt-text)]">{video.title}</h3>
          <p className="text-[12px] text-[var(--yt-text-2)] mt-1 truncate">{video.channel || "Unknown channel"}</p>
          <p className="text-[12px] text-[var(--yt-text-2)] truncate">
            {[viewsText(video), timeAgo(video.published)].filter(Boolean).join(" · ")}
          </p>
        </div>
      </button>
    );
  }

  return (
    <a
      href={href({ name: "watch", v: video.id })}
      onClick={(e) => { e.preventDefault(); open(); }}
      className="group cursor-pointer no-underline"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={video.title}
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-[var(--yt-bg-elev)] mb-3">
        {!imgFailed ? (

          <img
            src={hover && video.thumb_lg ? video.thumb_lg : video.thumb}
            alt={video.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#717171] text-sm">no preview</div>
        )}
        {video.duration && !video.is_live && (
          <span className="absolute bottom-[4px] right-[4px] bg-black/80 text-white text-[12px] font-medium px-1 rounded-[4px] tracking-[0.2px]">
            {video.duration}
          </span>
        )}
        {video.is_live && (
          <span className="absolute bottom-[4px] right-[4px] bg-[#ff0000] text-white text-[11px] font-semibold px-1.5 py-[1px] rounded-[3px] flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-white rounded-full" />LIVE
          </span>
        )}
        {hover && (
          <button
            onClick={saveLater}
            aria-label="Save to Watch later"
            title="Save to Watch later"
            className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/80 hover:bg-black flex items-center justify-center"
          >
            <BookmarkPlus className={`w-5 h-5 ${isLater ? "text-[var(--yt-blue)]" : "text-white"}`} fill={isLater ? "#3ea6ff" : "none"} />
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <button onClick={openChannel} className="shrink-0 mt-0.5" aria-label={video.channel} type="button">
          <ChannelAvatar name={video.channel} channelId={video.channel_id} url={video.channel_thumb} />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-normal leading-[20px] clamp-2 text-[var(--yt-text)] min-h-[40px]">{video.title}</h3>
          <button onClick={openChannel} className="block mt-1 text-[12px] leading-[18px] text-[var(--yt-text-2)] hover:text-[var(--yt-text)] truncate max-w-full">{video.channel || "Unknown channel"}</button>
          <p className="text-[12px] leading-[18px] text-[var(--yt-text-2)] truncate">
            {[viewsText(video), timeAgo(video.published)].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
    </a>
  );
}

export function VideoGrid({ videos, loading = false, skeletonCount = 12 }: { videos: YtVideo[]; loading?: boolean; skeletonCount?: number }) {
  if (loading) {
    return (
      <div className="grid gap-x-4 gap-y-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6">
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i}>
            <div className="aspect-video rounded-xl yt-skeleton mb-3" />
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-full yt-skeleton shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 yt-skeleton rounded w-full" />
                <div className="h-3 yt-skeleton rounded w-2/3" />
                <div className="h-3 yt-skeleton rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!videos.length) return null;
  return (
    <div className="grid gap-x-4 gap-y-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {videos.map((v) => <VideoCard key={v.id} video={v} />)}
    </div>
  );
}
