// What's-new dialog — shown once per app version. Its job: the moment a new
// APK is installed the user sees exactly which Premium features arrived and
// WHERE each one lives (several past features went unnoticed because they
// were buried in menus). Version check is plain localStorage, independent
// from the zustand store so it also fires on first run after an update.
"use client";

import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/version";
import { Headphones, PlayCircle, SkipForward, X, CheckCircle2, Volume2, Gauge, MoreVertical, PictureInPicture2, Bell, Rss, LayoutPanelTop, ListVideo, MessageCircle, UserRound } from "lucide-react";

const SEEN_KEY = "yt_whatsnew_seen";

export default function WhatsNew() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // deferred one frame so the feed paints first and hydration is settled
    const t = setTimeout(() => {
      try {
        if (localStorage.getItem(SEEN_KEY) !== APP_VERSION) setOpen(true);
      } catch { /* private mode etc. */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(SEEN_KEY, APP_VERSION); } catch { /* ignore */ }
    setOpen(false);
  };

  if (!open) return null;

  const features: { icon: React.ReactNode; title: string; where: string }[] = [
    { icon: <Rss className="w-5 h-5" />, title: "Subscriptions feed", where: "Open Subscriptions and see the latest videos from every channel you follow — new uploads first, with All / Today / Continue watching / Unwatched filters. One dead channel never breaks the feed." },
    { icon: <Bell className="w-5 h-5" />, title: "Notifications (local, honest)", where: "The bell is back. It counts new videos from your subscriptions since you last looked — nothing is pushed, nothing leaves your device, and it says so." },
    { icon: <LayoutPanelTop className="w-5 h-5" />, title: "Channel pages with real tabs", where: "Home, Videos, Shorts, Playlists and About — each tab loads its own section, playlists open as watchable queues." },
    { icon: <ListVideo className="w-5 h-5" />, title: "Playlists that play", where: "Open a playlist from a channel page and get a queue: Play from here, Prev / Next, and autoplay that walks the list when a video ends." },
    { icon: <MessageCircle className="w-5 h-5" />, title: "Comment threads", where: "Tap the replies count under a comment and the conversation expands inline — plus pinned and creator-heart badges. Page-through for more comments now works in server mode too." },
    { icon: <PlayCircle className="w-5 h-5" />, title: "Shorts, truthful", where: "Real channel names, avatars and working Subscribe on shorts, a comments sheet, double-tap-to-like with the heart pop, and a sound toggle that remembers your choice. Share copies the link." },
    { icon: <UserRound className="w-5 h-5" />, title: "Account menu", where: "The header avatar opens a menu: Your channel, Appearance, and a plain-language page about what's stored and where (everything, locally)." },
    { icon: <MoreVertical className="w-5 h-5" />, title: "Everything from 1.5", where: "Action toasts, card 3-dot menus with Not-interested memory, honest comments note, search keyboard navigation — all still there." },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-0 sm:px-6" data-testid="whats-new">
      <div className="w-full sm:max-w-[440px] bg-[var(--yt-bg-elev)] sm:rounded-2xl shadow-2xl border border-[var(--yt-border)] max-h-[86vh] flex flex-col">
        <div className="flex items-center justify-between px-5 pt-5 pb-1">
          <div>
            <h2 className="text-[20px] font-bold text-[var(--yt-text)]">What&apos;s new</h2>
            <p className="text-[13px] text-[var(--yt-text-2)] mt-0.5">ytapp v{APP_VERSION}</p>
          </div>
          <button onClick={dismiss} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-[var(--yt-bg-elev2)]">
            <X className="w-5 h-5 text-[var(--yt-text)]" />
          </button>
        </div>
        <div className="px-5 py-3 overflow-y-auto">
          <ul className="space-y-4">
            {features.map(f => (
              <li key={f.title} className="flex gap-3.5">
                <span className="w-9 h-9 rounded-full bg-[var(--yt-bg-elev2)] flex items-center justify-center text-[var(--yt-text)] shrink-0">{f.icon}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium text-[var(--yt-text)]">{f.title}</span>
                  <span className="block text-[13px] leading-[18px] text-[var(--yt-text-2)] mt-0.5">{f.where}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex items-start gap-2 text-[12px] leading-[17px] text-[var(--yt-text-2)] bg-[var(--yt-bg-elev2)] rounded-xl p-3">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-px text-[#2ba640]" />
            You can always confirm your version in Settings → About (it should say v{APP_VERSION}). If it says something older, install the latest APK from the GitHub Releases page.
          </p>
        </div>
        <div className="px-5 pb-5 pt-2">
          <button
            onClick={dismiss}
            className="w-full h-11 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] text-[15px] font-medium hover:opacity-95"
            data-testid="whats-new-got-it"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
