"use client";

// Phase 4: notifications — local and honest. The badge counts videos from
// your subscriptions that appeared since you last opened the drawer; nothing
// is pushed, nothing leaves the device. Data comes from the ONE shared
// subs fetch (yt-subs-feed), so opening the drawer never refetches the world.

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { useSubsFeed, readSeenSet, markAllSeen, type SubsFeedItem } from "@/lib/yt-subs-feed";

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const subs = useYt(s => s.subs);
  const items = useSubsFeed(s => s.items);
  const loading = useSubsFeed(s => s.loading);
  const ensure = useSubsFeed(s => s.ensure);
  const { navigate } = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  // the seen-set is device memory (localStorage) — read once lazily, then
  // held in state so "new" is a pure derivation of (items, seen)
  const [seen, setSeen] = useState<Set<string>>(() =>
    typeof window === "undefined" ? new Set<string>() : readSeenSet());
  const unseen: SubsFeedItem[] = items.filter(i => !seen.has(i.video.id));

  // badge: refresh the shared feed on mount (TTL-guarded)
  useEffect(() => { if (subs.length) ensure(); }, [subs.length, ensure]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          !(e.target as HTMLElement)?.closest?.("[data-testid=notifications-bell]")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const openDrawer = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      // counted the moment you look — like a read receipt
      setSeen(prev => {
        const merged = new Set(prev);
        for (const i of items) merged.add(i.video.id);
        return merged;
      });
      markAllSeen();
    }
  };

  return (
    <>
      <button
        onClick={openDrawer}
        data-testid="notifications-bell"
        aria-label={`Notifications${unseen.length ? ` (${unseen.length} new)` : ""}`}
        className="flex relative w-10 h-10 rounded-full items-center justify-center hover:bg-[var(--yt-bg-elev2)]"
      >
        <Bell className="w-6 h-6 text-[var(--yt-text)]" />
        {unseen.length > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--yt-red)] text-white text-[10px] font-medium flex items-center justify-center"
            data-testid="notifications-badge"
          >
            {unseen.length > 9 ? "9+" : unseen.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed left-0 right-0 md:left-auto md:right-6 top-[var(--yt-header-h)] md:w-[400px] z-[60] rounded-b-xl md:rounded-xl bg-[var(--yt-bg-elev)] shadow-2xl border border-[var(--yt-border)] overflow-hidden yt-pop"
          role="dialog"
          aria-label="Notifications"
          data-testid="notifications-drawer"
        >
          <div className="flex items-center justify-between px-4 h-12 border-b border-[var(--yt-border)]">
            <span className="text-[16px] font-medium text-[var(--yt-text)]">Notifications</span>
            <button onClick={() => setOpen(false)} aria-label="Close notifications" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--yt-hover)]">
              <X className="w-5 h-5 text-[var(--yt-text)]" />
            </button>
          </div>
          <p className="px-4 py-2 text-[12px] text-[var(--yt-text-2)] border-b border-[var(--yt-border)]">
            From your subscriptions — local only, no push.
          </p>
          <div className="max-h-[60vh] overflow-y-auto">
            {unseen.length === 0 && items.length === 0 && (subs.length === 0 ? (
              <p className="px-4 py-8 text-[14px] text-[var(--yt-text-2)]" data-testid="notifications-empty">
                Subscribe to channels to see their new videos here.
              </p>
            ) : loading ? (
              <p className="px-4 py-8 text-[14px] text-[var(--yt-text-2)]">Checking your subscriptions…</p>
            ) : (
              <p className="px-4 py-8 text-[14px] text-[var(--yt-text-2)]" data-testid="notifications-empty">
                Nothing new since your last visit.
              </p>
            ))}
            {(unseen.length > 0 ? unseen : items).slice(0, 20).map(it => (
              <button
                key={it.video.id}
                data-testid="notification-item"
                onClick={() => {
                  setOpen(false);
                  navigate({ name: "watch", v: it.video.id });
                }}
                className="w-full flex gap-3 px-4 py-3 text-left hover:bg-[var(--yt-hover)]"
              >
                {it.avatar ? (
                  <img src={it.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" loading="lazy" />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-[var(--yt-blue)]/20 text-[var(--yt-blue)] font-bold flex items-center justify-center shrink-0">
                    {(it.channelName || "?")[0]?.toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-[18px] text-[var(--yt-text-2)]">{it.channelName} uploaded</p>
                  <p className="text-[14px] leading-[20px] text-[var(--yt-text)] clamp-2">{it.video.title}</p>
                  <p className="text-[12px] text-[var(--yt-text-2)] mt-0.5">{it.video.published || ""}</p>
                </div>
                {it.video.thumb && (
                  <img src={it.video.thumb} alt="" className="w-[86px] aspect-video rounded object-cover shrink-0" loading="lazy" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
