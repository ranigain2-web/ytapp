"use client";

import { useEffect, useState } from "react";
import { fetchHome, getActiveSource, setApiBase, type YtVideo } from "@/lib/yt-api";
import { VideoGrid } from "./VideoCard";
import ChipsBar from "./ChipsBar";
import { useRouter } from "@/lib/yt-router";
import { RefreshCw, Server, ChevronDown } from "lucide-react";

function SetupPanel({ onRetry }: { onRetry: () => void }) {
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);
  const { navigate } = useRouter();

  const connect = async () => {
    const clean = url.trim().replace(/\/+$/, "");
    if (!clean) { setHint("Enter your server address first"); return; }
    setConnecting(true); setHint(null);
    setApiBase(clean);
    try {
      const res = await fetch(`${clean}/api/health`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) { onRetry(); return; }
      setHint(`Server responded with HTTP ${res.status}`);
    } catch {
      setHint("Could not reach that address");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="max-w-[560px] mx-auto px-4 pt-10 pb-16">
      <div className="rounded-2xl bg-[#212121] p-6 sm:p-8">
        <div className="w-14 h-14 rounded-full bg-[#3ea6ff]/15 flex items-center justify-center mb-5">
          <Server className="w-7 h-7 text-[#3ea6ff]" />
        </div>
        <h2 className="text-[22px] font-bold text-[#f1f1f1] mb-2">Can&apos;t reach YouTube</h2>
        <p className="text-[14px] leading-[21px] text-[#aaa] mb-6">
          The app couldn&apos;t connect to any video source. This usually fixes itself — tap Retry below.
          If it keeps happening, connect the app to your own server.
        </p>

        <label htmlFor="server-url" className="block text-[13px] text-[#aaa] mb-2 font-medium">
          Server address (optional)</label>
        <div className="flex gap-2 mb-2">
          <input
            id="server-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            placeholder="http://192.168.1.20:3001"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            className="flex-1 h-11 px-4 rounded-xl bg-[#121212] border border-[#303030] text-[14px] text-[#f1f1f1] outline-none focus:border-[#3ea6ff]"
          />
          <button
            onClick={connect}
            disabled={connecting}
            className="h-11 px-5 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-[14px] font-medium shrink-0 disabled:opacity-60"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
        {hint && <p className="text-[13px] text-[#ff4e45] mb-2">{hint}</p>}

        <div className="flex items-center gap-3 mt-5">
          <button onClick={onRetry} className="flex items-center gap-2 h-10 px-4 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-[14px] font-medium">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
          <button onClick={() => navigate({ name: "settings" })} className="h-10 px-4 rounded-full text-[14px] text-[#3ea6ff] hover:bg-[#3ea6ff]/10">
            More options
          </button>
        </div>

        <button onClick={() => setShowHow(s => !s)} className="flex items-center gap-1.5 mt-6 text-[13px] text-[#aaa] hover:text-[#f1f1f1]">
          <ChevronDown className={`w-4 h-4 transition-transform ${showHow ? "rotate-180" : ""}`} />
          Advanced: run your own server
        </button>
        {showHow && (
          <div className="mt-3 rounded-xl bg-[#121212] border border-[#303030] p-4 text-[13px] leading-[20px] text-[#aaa]">
            <p className="mb-3">The ytapp server ships with this project — one command on any machine with Docker:</p>
            <code className="block bg-[#0f0f0f] rounded-lg p-3 text-[12px] text-[#3ea6ff] break-all">git clone https://github.com/ranigain2-web/ytapp && cd ytapp && bash deploy/start-stack-docker.sh</code>
            <p className="mt-3">Then enter the machine&apos;s address above (e.g. <span className="text-[#f1f1f1]">http://192.168.1.20:3001</span>). The macOS app from the releases runs its own server automatically — no setup needed there.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage({ category = "all" }: { category?: string }) {
  const [videos, setVideos] = useState<YtVideo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noSource, setNoSource] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const { navigate } = useRouter();
  const loading = videos === null && err === null && !noSource;

  const load = () => {
    setVideos(null); setErr(null); setNoSource(false); setSourceLabel(null);
    setRetry(r => r + 1);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetchHome(category);
        if (!alive) return;
        setVideos(d.results || []);
        setSourceLabel(getActiveSource() === "community" ? "Community servers" : null);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (/No data source/i.test(msg)) setNoSource(true);
        else setErr(msg);
      }
    })();
    return () => { alive = false; };
  }, [category, retry]);

  return (
    <div>
      <ChipsBar active={category} onSelect={() => {}} />
      <div className="px-2 sm:px-6 pb-16">
        {sourceLabel && (
          <div className="flex items-center gap-2 mb-4 text-[12px] text-[#aaa]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#ffb13b]" />
            {sourceLabel} — playing via official embed.{" "}
            <button onClick={() => navigate({ name: "settings" })} className="text-[#3ea6ff] hover:underline">Use your own server</button>
          </div>
        )}
        {loading ? (
          <VideoGrid videos={[]} loading skeletonCount={12} />
        ) : noSource ? (
          <SetupPanel onRetry={load} />
        ) : err ? (
          <div className="py-20 text-center">
            <p className="text-[#aaa] mb-2">Couldn&apos;t load the feed</p>
            <p className="text-sm text-[#717171] mb-6">{err}</p>
            <button onClick={load} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#272727] hover:bg-[#3f3f3f] text-sm">
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
