"use client";

import { useEffect, useState } from "react";
import { fetchSearch, fetchChannel, type YtVideo, type YtChannelResult, type YtChannel } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { formatViews, timeAgo } from "@/lib/yt-format";
import { VideoGrid } from "./VideoCard";
import { RefreshCw, SearchX, Bell, ChevronRight } from "lucide-react";

export default function SearchPage({ query }: { query: string }) {
  const [videos, setVideos] = useState<YtVideo[] | null>(null);
  const [channel, setChannel] = useState<YtChannelResult | null>(null);
  const [channelDetail, setChannelDetail] = useState<YtChannel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { navigate } = useRouter();
  const subs = useYt(s => s.subs);
  const toggleSub = useYt(s => s.toggleSub);
  const isSubbed = subs.some(s2 => s2.id === (channel?.id || ""));
  const loading = videos === null && err === null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetchSearch(query);
        if (!alive) return;
        setVideos(d.results || []);
        setChannel(d.channel || null);
        // fetch channel details for the "Latest from" shelf
        if (d.channel?.id) {
          try {
            const cd = await fetchChannel(d.channel.id);
            if (alive) setChannelDetail(cd);
          } catch { /* shelf is optional */ }
        }
      } catch (e) {
        if (alive) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [query, retry]);

  const filters = ["All", "Unwatched", "Recently uploaded", "Live", "Related to your search"];
  const [filter, setFilter] = useState(0);

  return (
    <div className="px-2 sm:px-6 pb-16">
      {/* search filter row */}
      <div className="flex gap-3 py-3 overflow-x-auto no-scrollbar border-b border-[#272727] items-center">
        {filters.map((f, i) => (
          <button
            key={f}
            onClick={() => setFilter(i)}
            className={`shrink-0 h-8 px-3 rounded-lg text-[14px] font-medium ${i === filter ? "bg-[#f1f1f1] text-[#0f0f0f]" : "bg-[#272727] text-[#f1f1f1] hover:bg-[#3f3f3f]"}`}
          >
            {f}
          </button>
        ))}
        <div className="flex-1" />
        <button className="shrink-0 flex items-center gap-2 h-8 px-3 rounded-lg border border-[#303030] text-[14px] text-[#f1f1f1] hover:bg-[#272727]">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
          Filters
        </button>
      </div>

      {loading ? (
        <div className="mt-6 space-y-6 max-w-[900px]">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex gap-4">
              <div className="w-[246px] sm:w-[360px] aspect-video rounded-xl yt-skeleton shrink-0" />
              <div className="flex-1 space-y-3 pt-1">
                <div className="h-5 yt-skeleton rounded w-full" />
                <div className="h-5 yt-skeleton rounded w-2/3" />
                <div className="flex gap-3 items-center">
                  <div className="w-9 h-9 rounded-full yt-skeleton" />
                  <div className="h-3 yt-skeleton rounded w-32" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : err ? (
        <div className="py-20 text-center">
          <SearchX className="w-12 h-12 text-[#717171] mx-auto mb-4" />
          <p className="text-[#aaa] mb-2">Search failed</p>
          <p className="text-sm text-[#717171] mb-6">{err}</p>
          <button onClick={() => setRetry(r => r + 1)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-sm">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : !videos || videos.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-lg text-[#f1f1f1] mb-2">No results found</p>
          <p className="text-sm text-[#aaa]">Try different keywords or remove search filters</p>
        </div>
      ) : (
        <div className="mt-6 max-w-[1096px]">
          {channel && (
            <div className="relative border-b border-[#303030]/70 pb-6 mb-6">
            <button
              onClick={() => navigate({ name: "channel", id: channel.id })}
              className="w-full flex items-center gap-6 py-4 text-left group"
            >
              {channel.avatar ? (
                 
                <img src={channel.avatar} alt="" className="w-[118px] h-[118px] rounded-full object-cover shrink-0" />
              ) : (
                <span className="w-[118px] h-[118px] rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-4xl font-bold flex items-center justify-center shrink-0">
                  {(channel.name || "?")[0]?.toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[18px] font-medium text-[#f1f1f1] flex items-center gap-2">
                  {channel.name}
                  {channel.verified && (
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#aaa]" fill="currentColor"><path d="M12 2 9.8 4.2 6.7 4l-.5 3.1L3.5 8.5l1.4 2.8-1.4 2.8 2.7 1.4.5 3.1 3.1-.2L12 22l2.2-2.2 3.1.2.5-3.1 2.7-1.4-1.4-2.8 1.4-2.8-2.7-1.4-.5-3.1-3.1.2L12 2zm-1.6 13.4-3-3 1.4-1.4 1.6 1.6 3.6-3.6 1.4 1.4-5 5z" /></svg>
                  )}
                </p>
                <p className="text-[12px] text-[#aaa] mt-0.5">@{channel.name.toLowerCase().replace(/\s+/g, "")}{channelDetail?.subscribers && channelDetail.subscribers !== channel.subscribers ? ` · ${channelDetail.subscribers}` : channel.subscribers ? ` · ${channel.subscribers}` : ""}</p>
                <p className="text-[12px] text-[#aaa] mt-2 clamp-2">{channel.description || channelDetail?.description?.slice(0, 160)}</p>
              </div>
            </button>
            <button
              onClick={() => toggleSub({ id: channel.id, name: channel.name, avatar: channel.avatar, subscribers: channelDetail?.subscribers || channel.subscribers || "" })}
              className={`absolute top-6 right-6 h-9 px-4 rounded-full text-[14px] font-medium flex items-center gap-2 ${isSubbed ? "bg-[#272727] hover:bg-[#3f3f3f]" : "bg-[#f1f1f1] text-[#0f0f0f] hover:bg-[#d9d9d9]"}`}
            >
              {isSubbed && <Bell className="w-4 h-4" />}
              {isSubbed ? "Subscribed" : "Subscribe"}
            </button>
            </div>
          )}

          {channelDetail && channelDetail.videos.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-[16px] font-medium text-[#f1f1f1]">Latest from {channelDetail.name}</h2>
                <ChevronRight className="w-5 h-5 text-[#aaa]" />
              </div>
              <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                {channelDetail.videos.slice(0, 6).map(v => (
                  <button
                    key={v.id}
                    onClick={() => navigate({ name: "watch", v: v.id })}
                    className="w-[210px] shrink-0 text-left"
                  >
                    <div className="relative aspect-video rounded-lg overflow-hidden bg-[#212121] mb-2">
                      { }
                      <img src={v.thumb} alt={v.title} loading="lazy" className="w-full h-full object-cover" />
                      {v.duration && <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[11px] font-medium px-1 rounded">{v.duration}</span>}
                    </div>
                    <p className="text-[13px] font-medium clamp-2 text-[#f1f1f1]">{v.title}</p>
                    <p className="text-[12px] text-[#aaa] mt-1">{v.views} · {v.published}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* desktop: horizontal result cards like YouTube search */}
          <div className="hidden sm:block sm:space-y-4">
            {videos?.map(v => <ResultRow key={v.id} video={v} />)}
          </div>
          {/* mobile: grid */}
          <div className="sm:hidden">
            <VideoGrid videos={videos} />
          </div>
        </div>
      )}
    </div>
  );
}

function ResultRow({ video }: { video: YtVideo }) {
  const { navigate } = useRouter();
  const open = () => navigate({ name: "watch", v: video.id });
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="flex gap-4 cursor-pointer group" onClick={open} role="link" tabIndex={0} onKeyDown={e => e.key === "Enter" && open()}>
      <div className="relative w-[246px] lg:w-[360px] aspect-video rounded-xl overflow-hidden bg-[#212121] shrink-0">
        {!imgFailed ? (

          <img src={video.thumb_lg || video.thumb} alt={video.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" onError={() => setImgFailed(true)} />
        ) : <div className="w-full h-full" />}
        {video.duration && (
          <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[12px] font-medium px-1 rounded">{video.duration}</span>
        )}
        <span className="absolute bottom-1 left-1 bg-black/80 text-white text-[10px] font-medium px-1 rounded hidden">4K</span>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[18px] leading-[26px] clamp-2 text-[#f1f1f1]">{video.title}</h3>
        <p className="text-[12px] text-[#aaa] mt-1">
          {formatViews(video.views) ? `${formatViews(video.views)} views` : ""}
          {formatViews(video.views) && timeAgo(video.published) ? " · " : ""}
          {timeAgo(video.published)}
        </p>
        {video.views && (
          <p className="text-[12px] text-[#aaa] mt-1 clamp-1 hidden lg:block">
            {video.channel ? `${video.channel} · ` : ""}Watch this video about {String(video.title).split(/\s+/).slice(0, 6).join(" ").toLowerCase()}…
          </p>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); if (video.channel_id) navigate({ name: "channel", id: video.channel_id }); }}
          className="flex items-center gap-2 mt-3 text-[13px] text-[#aaa] hover:text-[#f1f1f1]"
        >
          <span className="w-6 h-6 rounded-full bg-[#3ea6ff]/25 text-[#3ea6ff] text-xs font-bold flex items-center justify-center">
            {(video.channel || "?")[0]?.toUpperCase()}
          </span>
          <span className="truncate">{video.channel || "Unknown channel"}</span>
        </button>
      </div>
    </div>
  );
}
