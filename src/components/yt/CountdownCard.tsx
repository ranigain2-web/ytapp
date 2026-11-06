"use client";

// Autoplay countdown ([A7], phase 2) — the surface calls playback.advance()
// when a direct video ends with autoplay on; the store holds the countdown;
// THIS card renders wherever the surface is currently docked (watch chrome or
// mini) and the VideoSurface's timer navigates to the up-next when it hits 0.
// Cancel, a manual seek, or a route change clears it.

import { useEffect, useRef, useState } from "react";
import { usePlayback } from "@/lib/yt-playback";
import { X, SkipForward } from "lucide-react";

/** Live 5→0s countdown + ring. Reads store state; no props beyond layout. */
export function CountdownCard({ compact = false }: { compact?: boolean }) {
  const countdown = usePlayback(s => s.countdown);
  const cancelCountdown = usePlayback(s => s.cancelCountdown);
  const nextTrack = usePlayback(s => s.nextTrack);
  const [remaining, setRemaining] = useState(() =>
    countdown ? Math.max(0, Math.ceil((countdown.until - Date.now()) / 1000)) : 0);

  useEffect(() => {
    if (!countdown) return;
    const tick = () => {
      const ms = countdown.until - Date.now();
      setRemaining(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const iv = setInterval(tick, 200);
    return () => clearInterval(iv);
  }, [countdown?.until, countdown?.nextId, countdown]);

  if (!countdown) return null;

  const pct = Math.max(0, Math.min(1, (countdown.until - Date.now()) / 5000));

  // SVG ring: circumference r=10 → 62.8; dashoffset shrinks with time left
  const C = 2 * Math.PI * 10;

  if (compact) {
    return (
      <div className="flex items-center gap-2 min-w-0" data-testid="mini-countdown">
        <span className="shrink-0 text-[11px] font-medium text-[var(--yt-text-2)] tabular-nums" data-remaining={remaining}>
          Up next {remaining}s
        </span>
        <button
          onClick={cancelCountdown}
          aria-label="Cancel autoplay"
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center hover:bg-[var(--yt-hover)] text-[var(--yt-text-2)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-30 bg-black/85 flex items-center justify-center px-4"
      data-testid="countdown-card"
    >
      <div className="w-full max-w-[420px] flex items-center gap-3">
        {countdown.nextThumb && (
          <img src={countdown.nextThumb} alt="" className="w-[120px] aspect-video rounded-lg object-cover shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-white/60 text-[11px] font-medium uppercase tracking-[0.12em] mb-1">Up next in</p>
          <p className="text-white text-[14px] font-medium leading-[18px] line-clamp-2" data-next-title>{countdown.nextTitle}</p>
          {countdown.nextChannel && <p className="text-white/60 text-[12px] mt-0.5 truncate">{countdown.nextChannel}</p>}
        </div>
        <div className="relative w-11 h-11 shrink-0" data-testid="countdown-ring">
          <svg viewBox="0 0 24 24" className="w-11 h-11 -rotate-90">
            <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
            <circle
              cx="12" cy="12" r="10" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct)}
              data-remaining={remaining}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-white text-[13px] font-semibold tabular-nums">{remaining}</span>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex gap-2">
        <button
          onClick={cancelCountdown}
          className="h-8 px-3.5 rounded-full bg-white/15 text-white text-[13px] font-medium hover:bg-white/25"
          data-testid="countdown-cancel"
        >
          Cancel
        </button>
        <button
          onClick={nextTrack}
          className="flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-white text-black text-[13px] font-medium hover:bg-white/90"
        >
          <SkipForward className="w-4 h-4" fill="black" /> Play now
        </button>
      </div>
    </div>
  );
}
