"use client";

import { useEffect, useState } from "react";
import { fetchHome, type YtVideo } from "@/lib/yt-api";
import { VideoGrid } from "./VideoCard";
import ChipsBar from "./ChipsBar";
import { useRouter } from "@/lib/yt-router";
import { RefreshCw } from "lucide-react";

export default function HomePage({ category = "all" }: { category?: string }) {
  const [videos, setVideos] = useState<YtVideo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { navigate } = useRouter();
  const loading = videos === null && err === null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetchHome(category);
        if (alive) setVideos(d.results || []);
      } catch (e) {
        if (alive) setErr(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [category, retry]);

  return (
    <div>
      <ChipsBar active={category} onSelect={() => {}} />
      <div className="px-2 sm:px-6 pb-16">
        {loading ? (
          <VideoGrid videos={[]} loading skeletonCount={12} />
        ) : err ? (
          <div className="py-20 text-center">
            <p className="text-[#aaa] mb-2">Couldn&apos;t load the feed</p>
            <p className="text-sm text-[#717171] mb-6">{err}</p>
            <button onClick={() => setRetry(r => r + 1)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-sm">
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </div>
        ) : !videos || videos.length === 0 ? (
          <div className="py-20 text-center text-[#aaa]">
            <p className="text-lg mb-2">Nothing here yet</p>
            <button onClick={() => navigate({ name: "search", q: "trending" })} className="text-[#3ea6ff] text-sm hover:underline">Try a search</button>
          </div>
        ) : (
          <VideoGrid videos={videos} />
        )}
      </div>
    </div>
  );
}
