"use client";

// DownloadSheet — the watch page's download picker (Phase 3, D-02).
// Two honest choices: muxed MP4 (≤720p, needs ffmpeg on the server) or
// audio-only M4A. Starting hands the job to the server's yt-dlp sidecar;
// progress lives on the Downloads page.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/lib/yt-router";
import { startDownload } from "@/lib/yt-api";
import { ytToast } from "@/lib/yt-toast";
import { Download, Music4, Video, X, Loader2 } from "lucide-react";

export default function DownloadSheet({ videoId, title }: { videoId: string; title: string }) {
  const open = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"video" | "audio" | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [expanded]);

  const start = async (mode: "video" | "audio") => {
    setBusy(mode);
    try {
      await startDownload(videoId, mode, title || videoId);
      ytToast(`${mode === "audio" ? "Audio" : "Video"} download started`);
      setExpanded(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ytToast(msg === "Already downloading this video" ? "Already downloading this video" : `Download failed: ${msg}`);
    }
    setBusy(null);
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setExpanded(x => !x)}
        data-testid="download-button"
        className="flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--yt-bg-elev2)] text-[14px] hover:bg-[var(--yt-hover)]"
        title="Download via your server"
      >
        <Download className="w-5 h-5" /> Download
      </button>
      {expanded && (
        <div className="absolute right-0 top-11 z-30 w-[280px] rounded-xl bg-[var(--yt-bg-elev2)] border border-[var(--yt-border)] shadow-2xl p-3" data-testid="download-sheet">
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-[14px] font-medium">Download</p>
            <button onClick={() => setExpanded(false)} aria-label="Close" className="p-1 rounded-full hover:bg-[var(--yt-hover)]"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-[12px] text-[var(--yt-text-2)] px-1 mb-2 leading-snug">
            Saved by your server with yt-dlp (its cookies unlock gated videos). Files land on the server — save them from Downloads.
          </p>
          <button
            onClick={() => start("video")}
            disabled={busy !== null}
            data-testid="download-video"
            className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-[var(--yt-hover)] disabled:opacity-50 text-left"
          >
            {busy === "video" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5" />}
            <span>
              <span className="block text-[14px]">Video · MP4</span>
              <span className="block text-[12px] text-[var(--yt-text-2)]">up to 720p, muxed with audio</span>
            </span>
          </button>
          <button
            onClick={() => start("audio")}
            disabled={busy !== null}
            data-testid="download-audio"
            className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-[var(--yt-hover)] disabled:opacity-50 text-left"
          >
            {busy === "audio" ? <Loader2 className="w-5 h-5 animate-spin" /> : <Music4 className="w-5 h-5" />}
            <span>
              <span className="block text-[14px]">Audio only · M4A</span>
              <span className="block text-[12px] text-[var(--yt-text-2)]">smaller, for offline listening</span>
            </span>
          </button>
          <button
            onClick={() => open.navigate({ name: "downloads" })}
            className="w-full mt-1 px-2 py-1.5 text-[13px] text-[var(--yt-blue)] hover:underline text-left"
          >
            View downloads →
          </button>
        </div>
      )}
    </div>
  );
}
