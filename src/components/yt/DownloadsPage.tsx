"use client";

// DownloadsPage — the download manager (Phase 3, D-03/D-04).
// Lists the server's yt-dlp jobs with live progress (polls while anything is
// queued/running), and streams finished files back for browser saving.

import { useEffect, useRef, useState } from "react";
import { listDownloads, cancelDownload, removeDownload, downloadFileUrl, type DownloadItem } from "@/lib/yt-api";
import { ytToast } from "@/lib/yt-toast";
import { Download, Music4, Video, X, Trash2, Loader2, CheckCircle2, AlertCircle, Ban } from "lucide-react";

const fmtSize = (n: number) => {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const STATUS_LABEL: Record<DownloadItem["status"], string> = {
  queued: "Queued",
  running: "Downloading",
  cancelling: "Cancelling…",
  done: "Ready",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function DownloadsPage() {
  const [items, setItems] = useState<DownloadItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const list = await listDownloads();
      setItems(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    // deferred past the effect pass (no synchronous setState in effects);
    // the first paint shows the loading state, the fetch lands right after
    const first = setTimeout(refresh, 0);
    // Poll while any job is active; a quiet list stops the poller.
    timer.current = setInterval(() => {
      setItems(cur => {
        const active = cur?.some(x => x.status === "queued" || x.status === "running" || x.status === "cancelling");
        if (active) refresh();
        return cur;
      });
    }, 2000);
    return () => { clearTimeout(first); if (timer.current) clearInterval(timer.current); };
  }, []);

  const act = async (fn: () => Promise<void>, ok: string) => {
    try { await fn(); ytToast(ok); await refresh(); }
    catch (e) { ytToast(`Failed: ${e instanceof Error ? e.message : e}`); }
  };

  return (
    <div className="px-2 sm:px-6 pb-16 pt-2 max-w-[900px]">
      <h1 className="text-[24px] sm:text-[32px] font-bold mb-1">Downloads</h1>
      <p className="text-[13px] text-[var(--yt-text-2)] mb-6">
        Jobs run on your server with yt-dlp. Finished files stay there until you save or remove them.
      </p>

      {err && (
        <div className="rounded-xl bg-[var(--yt-elev2-60)] p-4 mb-4">
          <p className="text-[14px] flex items-center gap-2"><AlertCircle className="w-4 h-4 text-[var(--yt-status-warn)]" /> {err}</p>
          <p className="text-[13px] text-[var(--yt-text-2)] mt-1">The download service needs your yt-api server (Settings → Your server).</p>
        </div>
      )}

      {items !== null && items.length === 0 && !err && (
        <div className="rounded-xl bg-[var(--yt-elev2-60)] p-6 text-center">
          <Download className="w-10 h-10 mx-auto mb-3 text-[var(--yt-text-2)]" />
          <p className="text-[15px] mb-1">No downloads yet</p>
          <p className="text-[13px] text-[var(--yt-text-2)]">Open a video and tap Download.</p>
        </div>
      )}

      {items?.map(d => (
        <div key={d.id} className="flex items-center gap-3 py-3 border-b border-[var(--yt-border)]" data-testid="download-row">
          <div className="w-9 h-9 rounded-full bg-[var(--yt-bg-elev2)] flex items-center justify-center shrink-0">
            {d.mode === "audio" ? <Music4 className="w-4 h-4" /> : <Video className="w-4 h-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] truncate">{d.title || d.videoId}</p>
            <p className="text-[12px] text-[var(--yt-text-2)] flex items-center gap-1.5 flex-wrap">
              <span data-testid={`dl-status-${d.status}`}>{STATUS_LABEL[d.status]}</span>
              {d.size > 0 && <span>· {fmtSize(d.size)}</span>}
              {d.status === "running" && <span>· {Math.round(d.progress)}%</span>}
              {d.status === "failed" && d.error && <span className="text-[var(--yt-status-warn)] truncate max-w-[420px]" title={d.error}>· {d.error}</span>}
            </p>
            {(d.status === "running" || d.status === "queued" || d.status === "cancelling") && (
              <div className="h-1 rounded-full bg-[var(--yt-bg-elev2)] mt-2 overflow-hidden">
                <div className="h-full bg-[var(--yt-blue)] transition-all" style={{ width: `${d.status === "queued" ? 0 : d.progress}%` }} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {d.status === "done" && (
              <a
                href={downloadFileUrl(d.id)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] text-[13px] font-medium"
                data-testid="dl-save"
              >
                <Download className="w-4 h-4" /> Save
              </a>
            )}
            {(d.status === "running" || d.status === "queued") && (
              <button onClick={() => act(() => cancelDownload(d.id), "Cancelling download")} className="p-2 rounded-full hover:bg-[var(--yt-hover)]" title="Cancel" data-testid="dl-cancel">
                <X className="w-4 h-4" />
              </button>
            )}
            {(d.status === "running" || d.status === "queued" || d.status === "cancelling") && <Loader2 className="w-4 h-4 animate-spin text-[var(--yt-text-2)]" />}
            {d.status === "done" && <CheckCircle2 className="w-4 h-4 text-[var(--yt-status-ok)]" />}
            {d.status === "failed" && <AlertCircle className="w-4 h-4 text-[var(--yt-status-warn)]" />}
            {d.status === "cancelled" && <Ban className="w-4 h-4 text-[var(--yt-text-2)]" />}
            {d.status !== "running" && d.status !== "queued" && (
              <button onClick={() => act(() => removeDownload(d.id), "Removed download")} className="p-2 rounded-full hover:bg-[var(--yt-hover)]" title="Remove" data-testid="dl-remove">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
