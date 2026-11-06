"use client";

// Phase 4: playlist route — queue-style watch. The plan's contract: play
// index 0 on open, prev/next through the list, autoplay-all (each video's
// end advances the index), honest fallback if the playlist is unavailable.

import { useEffect, useState } from "react";
import { fetchPlaylist, type YtPlaylist } from "@/lib/yt-api";
import { useRouter } from "@/lib/yt-router";
import { VideoCard } from "./VideoCard";
import { RefreshCw, SkipBack, SkipForward, ListVideo } from "lucide-react";
import { ytToast } from "@/lib/yt-toast";
import { usePlayback } from "@/lib/yt-playback";

export default function PlaylistPage({ playlistId }: { playlistId: string }) {
  const [data, setData] = useState<YtPlaylist | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [index, setIndex] = useState(0);
  const { navigate } = useRouter();
  const loading = data === null && err === null;
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetchPlaylist(playlistId);
        if (alive) setData(d);
      } catch (e) {
        if (alive) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [playlistId, retry]);

  const playIndex = (i: number) => {
    if (!data || i < 0 || i >= data.videos.length) return;
    setIndex(i);
    const target = data.videos[i];
    navigate({ name: "watch", v: target.id });
    // autoplay-all: once the watch surface loaded this video (and set its
    // related-based queue), swap in the playlist order so the up-next
    // countdown and notification Next/Prev walk the playlist
    const unsub = usePlayback.subscribe(st => {
      if (st.videoId === target.id && st.queue.length > 0) {
        usePlayback.getState().setQueue([...data.videos.slice(i), ...data.videos.slice(0, i)]);
        unsub();
      }
    });
  };

  if (loading) {
    return (
      <div className="px-2 sm:px-6 pb-16 pt-4">
        <div className="h-8 w-64 yt-skeleton rounded mb-6" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-video rounded-xl yt-skeleton" />)}
        </div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="py-20 text-center">
        <p className="text-[var(--yt-text-2)] mb-2">Couldn&apos;t load this playlist</p>
        <p className="text-sm text-[var(--yt-text-2)] mb-6">{err}</p>
        <button onClick={() => setRetry(r => r + 1)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-sm">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  const v = data.videos[index];

  return (
    <div className="px-2 sm:px-6 pb-16 pt-4" data-testid="playlist-page">
      <div className="flex items-center gap-3 mb-6">
        <ListVideo className="w-6 h-6 text-[var(--yt-text-2)] shrink-0" />
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-[var(--yt-text)] truncate">{data.title || "Playlist"}</h1>
          <p className="text-[13px] text-[var(--yt-text-2)]">
            {data.channel || "Unknown channel"}{data.count ? ` · ${data.count}` : ""} · {index + 1} of {data.videos.length}
          </p>
        </div>
      </div>

      {/* queue controls */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => playIndex(index - 1)}
          disabled={index === 0}
          data-testid="playlist-prev"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[14px] text-[var(--yt-text)] disabled:opacity-40"
        >
          <SkipBack className="w-4 h-4" /> Prev
        </button>
        <button
          onClick={() => {
            if (v) { ytToast(`Playing ${index + 1} of ${data.videos.length}`); navigate({ name: "watch", v: v.id }); }
          }}
          data-testid="playlist-play"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)] hover:bg-[var(--yt-invert-hover)] text-[14px] font-medium"
        >
          Play from here
        </button>
        <button
          onClick={() => playIndex(index + 1)}
          disabled={index >= data.videos.length - 1}
          data-testid="playlist-next"
          className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[14px] text-[var(--yt-text)] disabled:opacity-40"
        >
          Next <SkipForward className="w-4 h-4" />
        </button>
        <span className="text-[12px] text-[var(--yt-text-2)] ml-1" data-testid="playlist-autoplay-note" title="Autoplay continues the queue when a video ends">
          Autoplay walks the playlist
        </span>
      </div>

      {/* the queue */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {data.videos.map((item, i) => (
          <div key={item.id} className="relative">
            {i === index && (
              <span className="absolute -left-1 top-2 z-10 bg-[var(--yt-blue)] text-white text-[11px] font-medium px-2 py-0.5 rounded-r" data-testid="playlist-now">Playing</span>
            )}
            <VideoCard video={{ ...item, channel: item.channel || data.channel, channel_id: item.channel_id || data.channel_id }} compact responsive />
            <button
              onClick={() => playIndex(i)}
              className="mt-1 text-[13px] text-[var(--yt-blue)] hover:underline"
              data-testid={`playlist-play-${i}`}
            >
              Play this
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
