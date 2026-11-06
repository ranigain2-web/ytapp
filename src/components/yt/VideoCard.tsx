"use client";

import { useState, useEffect, useRef } from "react";
import type { YtVideo } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { formatViews, timeAgo } from "@/lib/yt-format";
import { BookmarkPlus, MoreVertical, Share2, Ban, EyeOff } from "lucide-react";
import { useYt } from "@/lib/yt-store";
import { ytToast } from "@/lib/yt-toast";
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

/**
 * `compact` = the horizontal row used inside the watch page's related rail
 * (>lg) and other side lists.
 *
 * `responsive` lets that same compact card reflow when it is NOT in a rail.
 * Measured against real YouTube:
 *   • phone      → compact rows, 168px thumbnail (unchanged)
 *   • sm … lg    → 2-up grid of stacked cards; YouTube renders 393×229
 *                  thumbnails in two columns at 834px while we rendered
 *                  full-width 810px rows
 *   • lg+        → back to the compact rail row
 * Rendering one element that reflows is cheaper than mounting both variants
 * and hiding one, and it keeps a single source of truth for the card.
 */
/**
 * Phase 3: the card 3-dot menu — save/share/not-interested/don't-recommend.
 * A deliberately small inline dropdown (no sheet infra): closes on any action,
 * outside click, or Esc.
 */
function CardMenu({ video, onClose }: { video: YtVideo; onClose: () => void }) {
  const toggleLater = useYt(s => s.toggleLater);
  const hideVideo = useYt(s => s.hideVideo);
  const hideChannel = useYt(s => s.hideChannel);
  const isLater = useYt(s => s.later.some(l => l.id === video.id));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const item = "w-full flex items-center gap-3 px-4 py-2.5 text-left text-[14px] text-[var(--yt-text)] hover:bg-[var(--yt-hover)]";

  return (
    <div
      ref={ref}
      className="absolute top-9 right-0 z-30 min-w-[220px] rounded-xl bg-[var(--yt-bg-elev)] shadow-2xl border border-[var(--yt-border)] py-2 yt-pop"
      role="menu"
      data-testid="card-menu"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        role="menuitem"
        className={item}
        data-testid="card-menu-save"
        onClick={() => {
          toggleLater({ id: video.id, title: video.title, channel: video.channel, channel_id: video.channel_id, thumb: video.thumb, views: video.views, duration: video.duration, published: video.published });
          ytToast(isLater ? "Removed from Watch later" : "Saved to Watch later");
          onClose();
        }}
      >
        <BookmarkPlus className="w-[18px] h-[18px] text-[var(--yt-text-2)]" />
        {isLater ? "Remove from Watch later" : "Save to Watch later"}
      </button>
      <button
        role="menuitem"
        className={item}
        data-testid="card-menu-share"
        onClick={() => {
          navigator.clipboard?.writeText(`https://youtu.be/${video.id}`)
            .then(() => ytToast("Link copied to clipboard"))
            .catch(() => ytToast("Copy failed"));
          onClose();
        }}
      >
        <Share2 className="w-[18px] h-[18px] text-[var(--yt-text-2)]" /> Share
      </button>
      <button
        role="menuitem"
        className={item}
        data-testid="card-menu-notinterested"
        onClick={() => {
          hideVideo(video.id);
          ytToast("Video removed — you won't see it again");
          onClose();
        }}
      >
        <EyeOff className="w-[18px] h-[18px] text-[var(--yt-text-2)]" /> Not interested
      </button>
      {video.channel_id && (
        <button
          role="menuitem"
          className={item}
          data-testid="card-menu-banchannel"
          onClick={() => {
            hideChannel(video.channel_id!);
            ytToast(`You won't see ${video.channel || "this channel"} again`);
            onClose();
          }}
        >
          <Ban className="w-[18px] h-[18px] text-[var(--yt-text-2)]" /> Don't recommend channel
        </button>
      )}
    </div>
  );
}

export function VideoCard({ video, compact = false, responsive = false }: { video: YtVideo; compact?: boolean; responsive?: boolean }) {
  const { navigate } = useRouter();
  const later = useYt(s => s.later);
  const toggleLater = useYt(s => s.toggleLater);
  // phase 3: not-interested memory — hidden cards render nothing, everywhere
  const hidden = useYt(s => s.hiddenVideos.includes(video.id) || (!!video.channel_id && s.hiddenChannels.includes(video.channel_id!)));
  const isLater = later.some(l => l.id === video.id);
  const [hover, setHover] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const open = () => navigate({ name: "watch", v: video.id });
  const openChannel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (video.channel_id) navigate({ name: "channel", id: video.channel_id });
  };

  const saveLater = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleLater({ id: video.id, title: video.title, channel: video.channel, channel_id: video.channel_id, thumb: video.thumb, views: video.views, duration: video.duration, published: video.published });
    ytToast(isLater ? "Removed from Watch later" : "Saved to Watch later");
  };

  if (hidden) return null;

  if (compact) {
    // Horizontal row at lg+; full-width grid card below lg when `responsive`
    // (the two class sets below are the only difference between the modes).
    // `sm:max-lg:` = the tablet band only, so the phone keeps YouTube's compact
    // row. At lg+ the max-lg condition stops matching, so the base row wins
    // again without needing an extra lg: rule.
    // Phase 3: the root is a div (role=button) — a <button> root made the
    // 3-dot menu's own buttons invalid nested interactive HTML.
    const rootCls = responsive
      ? "relative group flex w-full gap-2 text-left sm:max-lg:flex-col sm:max-lg:gap-3"
      : "relative flex gap-2 w-full text-left group";
    // In the rail the thumbnail is a share of the column, not a fixed 168px:
    // YouTube measures 208px in a 320px rail (65%) and 256px in a 402px rail
    // (64%). A fixed 168px left the text column far wider than YouTube's and
    // made every rail card ~20% shorter than the real one.
    const thumbCls = responsive
      ? "relative w-[168px] shrink-0 aspect-video rounded-lg overflow-hidden bg-[var(--yt-bg-elev)] sm:max-lg:w-full sm:max-lg:rounded-xl lg:w-[65%] xl:w-[64%]"
      : "relative w-[168px] shrink-0 aspect-video rounded-lg overflow-hidden bg-[var(--yt-bg-elev)]";
    return (
      <div
        className={rootCls}
        role="button"
        tabIndex={0}
        aria-label={video.title}
        onClick={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      >
        <div className={thumbCls}>
          {!imgFailed ? (

            <img src={video.thumb} alt={video.title} loading="lazy" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
          ) : <div className="w-full h-full" />}
          {video.duration && !video.is_live && (
            <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[11px] font-medium px-[3px] rounded-[3px]">{video.duration}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {/* Weight 500 matches real YouTube watch-page related cards, which the
              fidelity harness measured at 14px/20 —500 (ours was 400). */}
          <h3 className="text-[14px] font-medium leading-[20px] clamp-2 text-[var(--yt-text)]">{video.title}</h3>
          {/* Grid mode gets the avatar row (YouTube's feed-card structure); the
              rail keeps the flat channel line the sidebar side. */}
          {responsive && (
            <div className="hidden sm:max-lg:flex items-center gap-2 mt-1.5">
              <ChannelAvatar name={video.channel || "?"} channelId={video.channel_id} size={24} />
              <span className="text-[12px] text-[var(--yt-text-2)] truncate">{video.channel || "Unknown channel"}</span>
            </div>
          )}
          <p className={`text-[12px] text-[var(--yt-text-2)] mt-1 truncate${responsive ? " sm:max-lg:hidden" : ""}`}>{video.channel || "Unknown channel"}</p>
          <p className="text-[12px] text-[var(--yt-text-2)] truncate">
            {[viewsText(video), timeAgo(video.published)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
          aria-label="More actions"
          data-testid="card-dots"
          className="w-8 h-8 -mr-1.5 shrink-0 rounded-full flex items-center justify-center hover:bg-[var(--yt-hover)] text-[var(--yt-text-2)] self-start"
        >
          <MoreVertical className="w-5 h-5" />
        </button>
        {menuOpen && <CardMenu video={video} onClose={() => setMenuOpen(false)} />}
      </div>
    );
  }

  return (
    // Phase 3: outer <a> became a div — buttons inside an anchor are invalid
    // nested interactive HTML. A real inner link keeps middle-click/new-tab.
    <div
      className="group relative cursor-pointer"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid="video-card"
    >
      <a
        href={href({ name: "watch", v: video.id })}
        onClick={(e) => { e.preventDefault(); open(); }}
        aria-label={video.title}
        className="block no-underline"
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
        </div>
      </a>
      {/* hover actions live OUTSIDE the inner link (valid nesting) */}
      {hover && (
        <>
          <button
            onClick={saveLater}
            aria-label="Save to Watch later"
            title="Save to Watch later"
            className="absolute top-2 right-12 w-8 h-8 rounded-lg bg-black/80 hover:bg-black flex items-center justify-center z-10"
          >
            <BookmarkPlus className={`w-5 h-5 ${isLater ? "text-[var(--yt-blue)]" : "text-white"}`} fill={isLater ? "#3ea6ff" : "none"} />
          </button>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="More actions"
            data-testid="card-dots"
            className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/80 hover:bg-black flex items-center justify-center z-10"
          >
            <MoreVertical className="w-5 h-5 text-white" />
          </button>
        </>
      )}
      {menuOpen && <CardMenu video={video} onClose={() => setMenuOpen(false)} />}
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
    </div>
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
