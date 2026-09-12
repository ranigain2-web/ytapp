"use client";

import { useState } from "react";
import { useYt, type HistoryEntry } from "@/lib/yt-store";
import { useRouter } from "@/lib/yt-router";
import { formatTime } from "@/lib/yt-format";
import { VideoGrid } from "./VideoCard";
import { Trash2, Play, ListPlus, X } from "lucide-react";

function PageTitle({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 mb-6 flex-wrap">
      <h1 className="text-[24px] sm:text-[36px] font-bold text-[#f1f1f1]">{children}</h1>
      <div className="flex-1" />
      {actions}
    </div>
  );
}

function EmptyState({ title, sub, cta }: { title: string; sub: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div className="py-24 text-center">
      <p className="text-[#f1f1f1] text-lg mb-2">{title}</p>
      <p className="text-[#aaa] text-sm mb-6">{sub}</p>
      {cta && <button onClick={cta.onClick} className="px-6 py-2.5 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-sm">{cta.label}</button>}
    </div>
  );
}

function HistoryRow({ e, onRemove }: { e: HistoryEntry; onRemove: () => void }) {
  const { navigate } = useRouter();
  const pct = e.length ? Math.min(100, ((e.progress || 0) / e.length) * 100) : 0;
  return (
    <div className="group cursor-pointer" onClick={() => navigate({ name: "watch", v: e.id, t: e.progress && e.progress > 5 ? e.progress : 0 })}>
      <div className="relative aspect-video rounded-xl overflow-hidden bg-[#212121] mb-3">
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
      <h3 className="text-[15px] font-medium clamp-2 text-[#f1f1f1]">{e.title}</h3>
      <p className="text-[13px] text-[#aaa] mt-1 truncate">{e.channel}</p>
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
        <button onClick={clearHistory} className="flex items-center gap-2 px-4 h-9 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-[14px]">
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
          {history.map(e => <HistoryRow key={e.id} e={e} onRemove={() => removeHistory(e.id)} />)}
        </div>
      )}
    </div>
  );
}

export function SubscriptionsPage() {
  const subs = useYt(s => s.subs);
  const { navigate } = useRouter();

  return (
    <div className="px-2 sm:px-6 pb-16 pt-2">
      <PageTitle>Subscriptions</PageTitle>
      {subs.length === 0 ? (
        <EmptyState
          title="No subscriptions yet"
          sub="Subscribe to channels and their latest videos will appear here."
          cta={{ label: "Find channels", onClick: () => navigate({ name: "home" }) }}
        />
      ) : (
        <>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-6 mb-2">
            {subs.map(ch => (
              <button
                key={ch.id}
                onClick={() => navigate({ name: "channel", id: ch.id })}
                className="shrink-0 w-[120px] flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-[#272727]/60"
              >
                {ch.avatar ? (

                  <img src={ch.avatar} alt="" className="w-16 h-16 rounded-full object-cover" />
                ) : (
                  <span className="w-16 h-16 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-2xl font-bold flex items-center justify-center">
                    {(ch.name || "?")[0]?.toUpperCase()}
                  </span>
                )}
                <span className="text-[13px] text-[#f1f1f1] truncate w-full text-center">{ch.name}</span>
              </button>
            ))}
          </div>
          <p className="text-[#aaa] text-sm mb-6">Open a channel to browse its videos.</p>
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
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) { createPlaylist(name.trim()); setName(""); } }}
        className="flex gap-2 mb-8 max-w-md"
      >
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New playlist name"
          className="flex-1 h-10 px-4 rounded-lg bg-[#121212] border border-[#303030] text-[14px] outline-none focus:border-[#3ea6ff]"
        />
        <button type="submit" className="h-10 px-5 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-[14px] font-medium flex items-center gap-2">
          <ListPlus className="w-4 h-4" /> Create
        </button>
      </form>
      {playlists.length === 0 ? (
        <EmptyState title="No playlists" sub="Create playlists to organize your videos." />
      ) : (
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {playlists.map(p => (
            <div key={p.id} className="group cursor-pointer" onClick={() => navigate({ name: "later" })}>
              <div className="aspect-video rounded-xl bg-[#272727] flex flex-col items-center justify-center gap-2 mb-3 relative">
                <Play className="w-10 h-10 text-[#aaa]" fill="#aaa" />
                <span className="text-[13px] text-[#aaa]">{p.videoIds.length} videos</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deletePlaylist(p.id); }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/70 hover:bg-black hidden group-hover:flex items-center justify-center"
                  aria-label="Delete playlist"
                >
                  <Trash2 className="w-4 h-4 text-white" />
                </button>
              </div>
              <h3 className="text-[15px] font-medium truncate">{p.name}</h3>
              <p className="text-[13px] text-[#aaa]">Created {new Date(p.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
