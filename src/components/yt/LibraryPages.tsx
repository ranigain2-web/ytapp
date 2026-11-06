"use client";

import { useState, useEffect } from "react";
import { useYt, type HistoryEntry } from "@/lib/yt-store";
import { useSubsFeed } from "@/lib/yt-subs-feed";
import { ytToast } from "@/lib/yt-toast";
import { useRouter } from "@/lib/yt-router";
import { formatTime } from "@/lib/yt-format";
import { VideoGrid } from "./VideoCard";
import { Trash2, Play, ListPlus, X } from "lucide-react";

function PageTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 mb-6 flex-wrap">
      <h1 className="text-[24px] sm:text-[36px] font-bold text-[var(--yt-text)]">{children}</h1>
      <div className="flex-1" />
      {actions}
    </div>
  );
}

function EmptyState({ title, sub, cta }: { title: string; sub: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div className="py-24 text-center">
      <p className="text-[var(--yt-text)] text-lg mb-2">{title}</p>
      <p className="text-[var(--yt-text-2)] text-sm mb-6">{sub}</p>
      {cta && <button onClick={cta.onClick} className="px-6 py-2.5 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-sm">{cta.label}</button>}
    </div>
  );
}

function HistoryRow({ e, onRemove }: { e: HistoryEntry; onRemove: () => void }) {
  const { navigate } = useRouter();
  const pct = e.length ? Math.min(100, ((e.progress || 0) / e.length) * 100) : 0;
  return (
    <div className="group cursor-pointer" onClick={() => navigate({ name: "watch", v: e.id, t: e.progress && e.progress > 5 ? e.progress : 0 })}>
      <div className="relative aspect-video rounded-xl overflow-hidden bg-[var(--yt-bg-elev)] mb-3">
        { }
        <img src={e.thumb} alt={e.title} className="w-full h-full object-cover" loading="lazy" />
        {e.duration && <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[12px] font-medium px-1 rounded">{formatTime(e.length || 0) || e.duration}</span>}
        {pct > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/30">
            <div className="h-full bg-[#ff0000]" style={{ width: `${pct}%` }} />
          </div>
        )}
        <button
          onClick={(ev) => { ev.stopPropagation(); onRemove(); }}
          className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/80 hover:bg-black items-center justify-center hidden group-hover:flex"
          aria-label="Remove from history"
        >
          <X className="w-4 h-4 text-white" />
        </button>
      </div>
      <h3 className="text-[15px] font-medium clamp-2 text-[var(--yt-text)]">{e.title}</h3>
      <p className="text-[13px] text-[var(--yt-text-2)] mt-1 truncate">{e.channel}</p>
    </div>
  );
}

export function HistoryPage() {
  const history = useYt(s => s.history);
  const removeHistory = useYt(s => s.removeHistory);
  const clearHistory = useYt(s => s.clearHistory);
  const { navigate } = useRouter();

  return (
    <div className="px-2 sm:px-6 pb-16 pt-2">
      <PageTitle actions={history.length > 0 ? (
        <button onClick={() => { clearHistory(); ytToast("Watch history cleared"); }} data-testid="clear-history" className="flex items-center gap-2 px-4 h-9 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[14px]">
          <Trash2 className="w-4 h-4" /> Clear all
        </button>
      ) : undefined}>
        Watch history
      </PageTitle>
      {history.length === 0 ? (
        <EmptyState
          title="No watch history"
          sub="Videos you watch will show up here."
          cta={{ label: "Browse videos", onClick: () => navigate({ name: "home" }) }}
        />
      ) : (
        <div className="grid gap-x-4 gap-y-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {history.map(e => <HistoryRow key={e.id} e={e} onRemove={() => { removeHistory(e.id); ytToast("Removed from watch history"); }} />)}
        </div>
      )}
    </div>
  );
}

export function SubscriptionsPage() {
  const subs = useYt(s => s.subs);
  const history = useYt(s => s.history);
  const { navigate } = useRouter();
  // the shared single-flight feed (also feeds the notification badge)
  const items = useSubsFeed(s => s.items);
  const errors = useSubsFeed(s => s.errors);
  const loading = useSubsFeed(s => s.loading);
  const ensure = useSubsFeed(s => s.ensure);
  const [chip, setChip] = useState<"all" | "today" | "continue" | "unwatched">("all");

  useEffect(() => { if (subs.length) ensure(); }, [subs.length, ensure]);

  const chips: { key: typeof chip; label: string }[] = [
    { key: "all", label: "All" },
    { key: "today", label: "Today" },
    { key: "continue", label: "Continue watching" },
    { key: "unwatched", label: "Unwatched" },
  ];

  const watchedIds = new Set(history.map(h => h.id));
  const filtered = items.filter(it => {
    if (chip === "today") return it.ageDays === 0;
    if (chip === "continue") {
      const h = history.find(x => x.id === it.video.id);
      const prog = h?.progress || 0;
      const len = h?.length || 0;
      return !!h && prog > 10 && len > 0 && prog / len < 0.95;
    }
    if (chip === "unwatched") return !watchedIds.has(it.video.id);
    return true;
  });

  return (
    <div className="px-2 sm:px-6 pb-16 pt-2" data-testid="subscriptions-page">
      <PageTitle>Subscriptions</PageTitle>
      {subs.length === 0 ? (
        <EmptyState
          title="No subscriptions yet"
          sub="Subscribe to channels and their latest videos will appear here."
          cta={{ label: "Find channels", onClick: () => navigate({ name: "home" }) }}
        />
      ) : (
        <>
          {/* avatar strip — demoted to a horizontal row */}
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-4 mb-2">
            {subs.map(ch => (
              <button
                key={ch.id}
                onClick={() => navigate({ name: "channel", id: ch.id })}
                className="shrink-0 flex items-center gap-2 pr-3 py-1.5 rounded-full hover:bg-[var(--yt-elev2-60)]"
              >
                {ch.avatar ? (
                  <img src={ch.avatar} alt="" className="w-8 h-8 rounded-full object-cover" loading="lazy" />
                ) : (
                  <span className="w-8 h-8 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] text-sm font-bold flex items-center justify-center">
                    {(ch.name || "?")[0]?.toUpperCase()}
                  </span>
                )}
                <span className="text-[13px] text-[var(--yt-text)] whitespace-nowrap">{ch.name}</span>
              </button>
            ))}
          </div>

          {/* filter chips */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar py-2 mb-4" role="tablist" aria-label="Subscriptions filters">
            {chips.map(c => (
              <button
                key={c.key}
                role="tab"
                aria-selected={chip === c.key}
                data-testid={`subs-chip-${c.key}`}
                onClick={() => setChip(c.key)}
                className={`shrink-0 px-3 h-8 rounded-lg text-[14px] ${chip === c.key ? "bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)]" : "bg-[var(--yt-bg-elev2)] text-[var(--yt-text)] hover:bg-[var(--yt-hover)]"}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {errors.length > 0 && (
            <div className="mb-4 rounded-xl bg-[var(--yt-elev2-70)] px-3 py-2 text-[13px] text-[var(--yt-text-2)]" data-testid="subs-errors">
              {errors.map(e => (
                <div key={e.channelId}>⚠ {e.channelName}: unavailable right now — other channels kept loading.</div>
              ))}
            </div>
          )}

          {filtered.length > 0 ? (
            <VideoGrid videos={filtered.map(i => ({ ...i.video, channel: i.channelName, channel_id: i.channelId }))} />
          ) : loading ? (
            <VideoGrid videos={[]} loading skeletonCount={8} />
          ) : (
            <EmptyState
              title={chip === "all" ? "Nothing here yet" : `No ${chips.find(c => c.key === chip)?.label.toLowerCase()} videos`}
              sub={chip === "continue" ? "Half-watched videos from your subscriptions appear here." : "New uploads from your channels appear here."}
            />
          )}
          {loading && filtered.length > 0 && (
            <p className="mt-4 text-[13px] text-[var(--yt-text-2)]" data-testid="subs-loading">Loading more channels…</p>
          )}
        </>
      )}
    </div>
  );
}

export function LikedPage() {
  const liked = useYt(s => s.liked);
  const { navigate } = useRouter();
  return (
    <div className="px-2 sm:px-6 pb-16 pt-2">
      <PageTitle>Liked videos</PageTitle>
      {liked.length === 0 ? (
        <EmptyState title="No liked videos" sub="Videos you like will appear here." cta={{ label: "Browse videos", onClick: () => navigate({ name: "home" }) }} />
      ) : (
        <VideoGrid videos={liked.map(e => ({ id: e.id, title: e.title, channel: e.channel, channel_id: e.channel_id, views: e.views, duration: e.duration, published: e.published, thumb: e.thumb, thumb_lg: e.thumb }))} />
      )}
    </div>
  );
}

export function LaterPage() {
  const later = useYt(s => s.later);
  const { navigate } = useRouter();
  return (
    <div className="px-2 sm:px-6 pb-16 pt-2">
      <PageTitle>Watch later</PageTitle>
      {later.length === 0 ? (
        <EmptyState title="Nothing saved" sub="Save videos with the bookmark button to watch them later." cta={{ label: "Browse videos", onClick: () => navigate({ name: "home" }) }} />
      ) : (
        <VideoGrid videos={later.map(e => ({ id: e.id, title: e.title, channel: e.channel, channel_id: e.channel_id, views: e.views, duration: e.duration, published: e.published, thumb: e.thumb, thumb_lg: e.thumb }))} />
      )}
    </div>
  );
}

export function PlaylistsPage() {
  const playlists = useYt(s => s.playlists);
  const createPlaylist = useYt(s => s.createPlaylist);
  const deletePlaylist = useYt(s => s.deletePlaylist);
  const [name, setName] = useState("");
  const { navigate } = useRouter();

  return (
    <div className="px-2 sm:px-6 pb-16 pt-2">
      <PageTitle>Playlists</PageTitle>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) { createPlaylist(name.trim()); setName(""); ytToast(`Playlist "${name.trim()}" created`); } }}
        className="flex gap-2 mb-8 max-w-md"
      >
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New playlist name"
          className="flex-1 h-10 px-4 rounded-lg bg-[var(--yt-bg-input)] border border-[var(--yt-border)] text-[14px] outline-none focus:border-[var(--yt-blue)]"
        />
        <button type="submit" className="h-10 px-5 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] text-[14px] font-medium flex items-center gap-2">
          <ListPlus className="w-4 h-4" /> Create
        </button>
      </form>
      {playlists.length === 0 ? (
        <EmptyState title="No playlists" sub="Create playlists to organize your videos." />
      ) : (
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {playlists.map(p => (
            <div key={p.id} className="group cursor-pointer" onClick={() => navigate({ name: "later" })}>
              <div className="aspect-video rounded-xl bg-[var(--yt-bg-elev2)] flex flex-col items-center justify-center gap-2 mb-3 relative">
                <Play className="w-10 h-10 text-[var(--yt-text-2)]" fill="#aaa" />
                <span className="text-[13px] text-[var(--yt-text-2)]">{p.videoIds.length} videos</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePlaylist(p.id); ytToast(`Playlist "${p.name}" deleted`); }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/70 hover:bg-black hidden group-hover:flex items-center justify-center"
                  aria-label="Delete playlist"
                >
                  <Trash2 className="w-4 h-4 text-white" />
                </button>
              </div>
              <h3 className="text-[15px] font-medium truncate">{p.name}</h3>
              <p className="text-[13px] text-[var(--yt-text-2)]">Created {new Date(p.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
