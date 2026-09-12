"use client";

import { useEffect, useState } from "react";
import { fetchChannel, type YtChannel } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { formatViews } from "@/lib/yt-format";
import { VideoGrid } from "./VideoCard";
import { Bell, RefreshCw } from "lucide-react";

export default function ChannelPage({ channelId }: { channelId: string }) {
  const [data, setData] = useState<YtChannel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState(0);
  const { navigate } = useRouter();
  const subs = useYt(s => s.subs);
  const toggleSub = useYt(s => s.toggleSub);
  const isSubbed = subs.some(s => s.id === channelId);
  const loading = data === null && err === null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetchChannel(channelId);
        if (alive) setData(d);
      } catch (e) {
        if (alive) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [channelId, retry]);

  if (loading) {
    return (
      <div className="px-2 sm:px-6 pb-16">
        <div className="h-[100px] sm:h-[160px] rounded-xl yt-skeleton mb-6" />
        <div className="flex items-center gap-4 mb-8">
          <div className="w-20 h-20 rounded-full yt-skeleton" />
          <div className="space-y-3"><div className="h-6 yt-skeleton rounded w-48" /><div className="h-4 yt-skeleton rounded w-32" /></div>
        </div>
        <VideoGrid videos={[]} loading skeletonCount={8} />
      </div>
    );
  }

  if (err) {
    return (
      <div className="py-20 text-center">
        <p className="text-[#aaa] mb-2">Couldn&apos;t load this channel</p>
        <p className="text-sm text-[#717171] mb-6">{err}</p>
        <button onClick={() => setRetry(r => r + 1)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-sm">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  const c = data!;
  const tabs = ["Videos", "About"];

  return (
    <div className="px-2 sm:px-6 pb-16">
      {/* banner */}
      {c.banner ? (

        <img src={c.banner} alt="" className="w-full h-[100px] sm:h-[160px] object-cover rounded-xl mb-6" />
      ) : (
        <div className="w-full h-[100px] sm:h-[160px] rounded-xl mb-6 bg-gradient-to-r from-[#1a1a2e] via-[#16213e] to-[#1a1a2e]" />
      )}

      {/* channel header */}
      <div className="flex items-center gap-4 sm:gap-6 mb-8">
        {c.avatar ? (

          <img src={c.avatar} alt={c.name} className="w-20 h-20 sm:w-32 sm:h-32 rounded-full object-cover shrink-0" />
        ) : (
          <span className="w-20 h-20 sm:w-32 sm:h-32 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-4xl font-bold flex items-center justify-center shrink-0">
            {(c.name || "?")[0]?.toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] sm:text-[32px] font-bold truncate">{c.name || "Channel"}</h1>
          <p className="text-[14px] text-[#aaa] mt-1">
            <span className="text-[#f1f1f1] font-medium">@{(c.name || "").toLowerCase().replace(/\s+/g, "")}</span>
            {c.subscribers ? ` · ${c.subscribers}` : ""} · {c.videos.length} videos
          </p>
          <p className="text-[14px] text-[#aaa] clamp-1 mt-1 max-w-[600px]">{c.description?.slice(0, 120)}</p>
          <button
            onClick={() => toggleSub({ id: channelId, name: c.name, avatar: c.avatar, subscribers: c.subscribers })}
            className={`mt-3 inline-flex items-center gap-2 h-10 px-4 rounded-full text-[14px] font-medium ${isSubbed ? "bg-[#272727] hover:bg-[#3f3f3f]" : "bg-[#f1f1f1] text-[#0f0f0f] hover:bg-[#d9d9d9]"}`}
          >
            {isSubbed && <Bell className="w-4 h-4" />}
            {isSubbed ? "Subscribed" : "Subscribe"}
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-8 border-b border-[#272727] mb-6">
        {tabs.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`pb-3 text-[16px] font-medium border-b-2 -mb-px ${i === tab ? "border-[#f1f1f1] text-[#f1f1f1]" : "border-transparent text-[#aaa] hover:text-[#ddd]"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 0 ? (
        c.videos.length ? (
          <VideoGrid videos={c.videos.map(v => ({ ...v, channel: c.name, channel_id: channelId }))} />
        ) : (
          <p className="text-[#aaa] text-sm py-10 text-center">No public videos found.</p>
        )
      ) : (
        <div className="max-w-[720px]">
          <h3 className="text-[16px] font-medium mb-3">Description</h3>
          <p className="text-[14px] leading-[22px] text-[#ddd] whitespace-pre-wrap">{c.description || "No description."}</p>
        </div>
      )}
    </div>
  );
}
