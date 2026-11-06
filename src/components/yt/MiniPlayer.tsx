"use client";

// MiniPlayer (phase 2) — the second mount point of the VideoSurface. The
// surface appends its persistent <video> into our adoption frame while the
// mini is open, so the stream NEVER resets between the watch page and here.
//
// Docks when the user scrolls past the player on watch ([A4]) or navigates
// away while playing. Never for embed-fallback videos ([A2]) and never on the
// Shorts route ([A3] — the owner rule closes it there).

import { useEffect, useRef, useState, useCallback } from "react";
import { usePlayback } from "@/lib/yt-playback";
import { parkSurfaceVideoIfInside } from "./VideoSurface";
import { CountdownCard } from "./CountdownCard";
import { Play, Pause, SkipForward, X } from "lucide-react";

export default function MiniPlayer() {
  const miniOpen = usePlayback(s => s.miniOpen);
  const video = usePlayback(s => s.video);
  const playing = usePlayback(s => s.playing);
  const current = usePlayback(s => s.current);
  const duration = usePlayback(s => s.duration);
  const queueLen = usePlayback(s => s.queue.length);
  const countdown = usePlayback(s => s.countdown);

  const titleBoxRef = useRef<HTMLDivElement | null>(null);

  // register the adoption frame. REF CALLBACK (not an effect): it fires
  // before the DOM node is removed, letting us park the persistent <video>
  // into the holder first — an element removed with the frame would be
  // browser-paused, and a parked-stale effect cleanup can't see the element.
  const frameRefCb = useCallback((el: HTMLDivElement | null) => {
    const pb = usePlayback.getState();
    if (el) {
      pb.registerMiniFrame(el);
    } else {
      parkSurfaceVideoIfInside(pb.miniFrame);
      pb.registerMiniFrame(null);
    }
  }, []);

  // marquee: measure overflow once per video, then let CSS loop it
  useEffect(() => {
    const box = titleBoxRef.current;
    if (!box) return;
    const span = box.querySelector("span");
    box.classList.toggle("yt-marquee-run", !!span && span.scrollWidth > box.clientWidth + 4);
  }, [video?.id, miniOpen, countdown]);

  // ---- drag-to-dismiss (mobile signature; works with a mouse too) ----
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ y0: number; moved: boolean } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // buttons are not drag handles
    dragRef.current = { y0: e.clientY, moved: false };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (dy > 8 && !d.moved) {
      d.moved = true;
      // capture ONLY once the drag is real: capturing on pointerdown would
      // retarget the following click to the root and kill the frame's expand
      try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* older browsers */ }
    }
    if (d.moved && dy > 0) setDragY(dy);
  }, []);
  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved && dragY > 80) usePlayback.getState().closeMini();
    setDragY(0);
  }, [dragY]);

  if (!miniOpen || !video) return null;

  const toggle = () => usePlayback.getState().engine?.togglePlay();
  const close = () => usePlayback.getState().closeMini();
  const next = () => usePlayback.getState().nextTrack();
  const expand = () => {
    if (!dragRef.current?.moved) usePlayback.getState().expandMini();
  };
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    // positioning lives on the FIXED wrapper itself (left/right/bottom are
    // ignored on non-positioned children — the inner card is a plain block)
    <div
      className="fixed z-50 yt-mini-in left-2 right-2 bottom-[calc(56px+env(safe-area-inset-bottom))] md:left-auto md:right-4 md:bottom-4 md:w-[400px]"
      style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? "none" : "transform 0.18s" }}
      data-testid="miniplayer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* phone: horizontal bar above the bottom nav (YouTube mobile);
          md+: floating card bottom-right with the video on top (desktop) */}
      <div className="flex flex-row md:flex-col rounded-xl overflow-hidden shadow-2xl bg-[var(--yt-bg-elev2)] border border-[var(--yt-border)]/60">
        {/* the adoption frame — the persistent <video> lands here */}
        <div
          className="relative w-[136px] md:w-full aspect-video shrink-0 bg-black cursor-pointer"
          ref={frameRefCb}
          onClick={expand}
          data-testid="mini-frame"
        >
          {/* progress hairline */}
          <div className="absolute bottom-0 left-0 h-[2px] bg-[var(--yt-red)] z-10" style={{ width: `${pct}%` }} data-testid="mini-hairline" />
        </div>

        {/* info + controls */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 min-w-0 flex-1">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={expand}>
            {countdown ? (
              <CountdownCard compact />
            ) : (
              <>
                <div className="yt-marquee-box" ref={titleBoxRef} data-testid="mini-title">
                  <span>{video.title || "Untitled"}</span>
                  <span aria-hidden="true">{video.title || "Untitled"}</span>
                </div>
                <p className="text-[12px] text-[var(--yt-text-2)] truncate mt-0.5">{video.channel}</p>
              </>
            )}
          </div>
          <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} data-testid="mini-play" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[var(--yt-hover)] text-[var(--yt-text)]">
            {playing ? <Pause className="w-5 h-5" fill="currentColor" /> : <Play className="w-5 h-5 ml-0.5" fill="currentColor" />}
          </button>
          {queueLen > 0 && (
            <button onClick={next} aria-label="Next video" data-testid="mini-next" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[var(--yt-hover)] text-[var(--yt-text)]">
              <SkipForward className="w-5 h-5" fill="currentColor" />
            </button>
          )}
          <button onClick={close} aria-label="Close miniplayer" data-testid="mini-close" className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-[var(--yt-hover)] text-[var(--yt-text-2)]">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
