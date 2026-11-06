"use client";

import { useEffect, useState } from "react";
import { fetchChannel, fetchChannelTab, type YtChannel, type YtChannelTab, type YtPlaylistCard } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { formatViews } from "@/lib/yt-format";
import { VideoGrid } from "./VideoCard";
import { Bell, RefreshCw, CheckCircle2, Link2 } from "lucide-react";
import { ytToast } from "@/lib/yt-toast";

type Tab = "home" | "videos" | "shorts" | "playlists" | "about";

function ShortCard({ id, title, views, onOpen }: { id: string; title: string; views: string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group text-left w-full" data-testid="short-card">
      <div className="relative aspect-[9/16] rounded-xl overflow-hidden bg-[var(--yt-bg-elev)] mb-2">
        <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt={title} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
        <span className="absolute bottom-1.5 left-1.5 bg-black/80 text-white text-[11px] font-medium px-1.5 py-0.5 rounded">{views}</span>
      </div>
      <p className="text-[14px] leading-[20px] clamp-2 text-[var(--yt-text)]">{title}</p>
    </button>
  );
}

function PlaylistCard({ p, onOpen }: { p: YtPlaylistCard; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group text-left w-full" data-testid="playlist-card">
      <div className="relative aspect-video rounded-xl overflow-hidden bg-[var(--yt-bg-elev)] mb-2">
        {p.thumb ? (
          <img src={p.thumb} alt={p.title} loading="lazy" className="w-full h-full object-cover" />
        ) : (
          <img src={`https://i.ytimg.com/vi/${p.id}/mqdefault.jpg`} alt={p.title} loading="lazy" className="w-full h-full object-cover" />
        )}
        {p.count && (
          <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[11px] font-medium px-1.5 py-0.5 rounded">{p.count}</span>
        )}
      </div>
      <p className="text-[14px] leading-[20px] clamp-2 text-[var(--yt-text)] font-medium">{p.title}</p>
    </button>
  );
}

export default function ChannelPage({ channelId }: { channelId: string }) {
  const [data, setData] = useState<YtChannel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<Tab>("home");
  // per-tab cache: only fetched tabs hit the API
  const [tabData, setTabData] = useState<Partial<Record<Tab, YtChannelTab>>>({});
  const [tabErr, setTabErr] = useState<Partial<Record<Tab, string>>>({});
  const [tabLoading, setTabLoading] = useState<Tab | null>(null);
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

  const loadTab = async (t: Tab) => {
    if (t === "home" || tabData[t] || tabErr[t]) return;
    setTabLoading(t);
    try {
      const d = await fetchChannelTab(channelId, t);
      setTabData(prev => ({ ...prev, [t]: d }));
    } catch (e) {
      setTabErr(prev => ({ ...prev, [t]: String(e instanceof Error ? e.message : e) }));
    } finally {
      setTabLoading(null);
    }
  };

  useEffect(() => { if (tab !== "home") loadTab(tab); }, [tab, channelId]); // loadTab is per-tab cached

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
        <p className="text-[var(--yt-text-2)] mb-2">Couldn&apos;t load this channel</p>
        <p className="text-sm text-[#717171] mb-6">{err}</p>
        <button onClick={() => setRetry(r => r + 1)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-sm">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  const c = data!;
  const tabs: { key: Tab; label: string }[] = [
    { key: "home", label: "Home" },
    { key: "videos", label: "Videos" },
    { key: "shorts", label: "Shorts" },
    { key: "playlists", label: "Playlists" },
    { key: "about", label: "About" },
  ];

  const shorts = tabData.shorts?.shorts || [];
  const playlists = tabData.playlists?.playlists || [];
  const about = tabData.about?.about;

  return (
    <div className="px-2 sm:px-6 pb-16" data-testid="channel-page">
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
          <span className="w-20 h-20 sm:w-32 sm:h-32 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] text-4xl font-bold flex items-center justify-center shrink-0">
            {(c.name || "?")[0]?.toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] sm:text-[32px] font-bold truncate flex items-center gap-2">
            {c.name || "Channel"}
            <CheckCircle2 className="w-4 h-4 text-[var(--yt-text-2)] shrink-0" aria-label="Verified" />
          </h1>
          <p className="text-[14px] text-[var(--yt-text-2)] mt-1">
            <span className="text-[var(--yt-text)] font-medium">@{(c.name || "").toLowerCase().replace(/\s+/g, "")}</span>
            {c.subscribers ? ` · ${c.subscribers}` : ""} · {c.videos.length} videos
          </p>
          <p className="text-[14px] text-[var(--yt-text-2)] clamp-1 mt-1 max-w-[600px]">{c.description?.slice(0, 120)}</p>
          <button
            onClick={() => {
              toggleSub({ id: channelId, name: c.name, avatar: c.avatar, subscribers: c.subscribers });
              ytToast(isSubbed ? `Unsubscribed from ${c.name}` : `Subscribed to ${c.name}`);
            }}
            data-testid="channel-subscribe"
            className={`mt-3 inline-flex items-center gap-2 h-10 px-4 rounded-full text-[14px] font-medium ${isSubbed ? "bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)]" : "bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)] hover:bg-[var(--yt-invert-hover)]"}`}
          >
            {isSubbed && <Bell className="w-4 h-4" />}
            {isSubbed ? "Subscribed" : "Subscribe"}
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-6 sm:gap-8 border-b border-[var(--yt-border)] mb-6 overflow-x-auto no-scrollbar" role="tablist" aria-label="Channel sections">
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`channel-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`shrink-0 pb-3 text-[16px] font-medium border-b-2 -mb-px ${tab === t.key ? "border-[var(--yt-text)] text-[var(--yt-text)]" : "border-transparent text-[var(--yt-text-2)] hover:text-[var(--yt-text-2)]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "home" && (
        c.videos.length ? (
          <VideoGrid videos={c.videos.map(v => ({ ...v, channel: c.name, channel_id: channelId }))} />
        ) : (
          <p className="text-[var(--yt-text-2)] text-sm py-10 text-center">No public videos found.</p>
        )
      )}

      {tab === "videos" && (tabLoading === "videos" && !tabData.videos ? (
        <VideoGrid videos={[]} loading skeletonCount={8} />
      ) : tabData.videos?.videos?.length ? (
        <VideoGrid videos={(tabData.videos!.videos || []).map(v => ({ ...v, channel: c.name, channel_id: channelId }))} />
      ) : (
        <p className="text-[var(--yt-text-2)] text-sm py-10 text-center" data-testid="channel-videos-empty">{tabErr.videos || "No videos."}</p>
      ))}

      {tab === "shorts" && (tabLoading === "shorts" && !tabData.shorts ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-[9/16] rounded-xl yt-skeleton" />)}
        </div>
      ) : shorts.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4" data-testid="channel-shorts-grid">
          {shorts.map(s => (
            <ShortCard key={s.id} id={s.id} title={s.title} views={s.views} onOpen={() => navigate({ name: "shorts", id: s.id })} />
          ))}
        </div>
      ) : (
        <p className="text-[var(--yt-text-2)] text-sm py-10 text-center" data-testid="channel-shorts-empty">{tabErr.shorts || "This channel has no shorts."}</p>
      ))}

      {tab === "playlists" && (tabLoading === "playlists" && !tabData.playlists ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-video rounded-xl yt-skeleton" />)}
        </div>
      ) : playlists.length ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="channel-playlists-grid">
          {playlists.map(p => (
            <PlaylistCard key={p.id} p={p} onOpen={() => navigate({ name: "playlist", id: p.id })} />
          ))}
        </div>
      ) : (
        <p className="text-[var(--yt-text-2)] text-sm py-10 text-center" data-testid="channel-playlists-empty">{tabErr.playlists || "This channel has no public playlists."}</p>
      ))}

      {tab === "about" && (
        <div className="max-w-[720px]" data-testid="channel-about">
          <h3 className="text-[16px] font-medium mb-3">Description</h3>
          <p className="text-[14px] leading-[22px] text-[var(--yt-text-2)] whitespace-pre-wrap mb-6">{c.description || about?.description || "No description."}</p>
          {(about || c.subscribers) && (
            <div className="grid gap-3 text-[14px] text-[var(--yt-text-2)]">
              {about?.joined && <p><span className="text-[var(--yt-text)] font-medium">{about.joined}</span></p>}
              {about?.total_views && <p><span className="text-[var(--yt-text)] font-medium">{about.total_views}</span> in total</p>}
              {about?.video_count && <p><span className="text-[var(--yt-text)] font-medium">{about.video_count}</span></p>}
              {about?.country && <p><span className="text-[var(--yt-text)] font-medium">{about.country}</span></p>}
            </div>
          )}
          {about?.links && about.links.length > 0 && (
            <div className="mt-6">
              <h3 className="text-[16px] font-medium mb-2">Links</h3>
              <div className="flex flex-wrap gap-2">
                {about.links.map((l, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-[var(--yt-bg-elev2)] text-[13px] text-[var(--yt-text)]">
                    <Link2 className="w-4 h-4 text-[var(--yt-text-2)]" /> {l}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
