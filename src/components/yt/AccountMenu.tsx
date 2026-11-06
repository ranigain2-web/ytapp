"use client";

// Phase 4: account menu (the header avatar). Honest rows only — there is no
// account; "Your data in ytapp" states plainly what the app keeps and where.

import { useEffect, useRef, useState } from "react";
import { UserRound, Palette, ShieldCheck, Settings } from "lucide-react";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";

function DataModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button className="fixed inset-0 z-[80] bg-black/60" onClick={onClose} aria-label="Close" />
      <div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] w-[min(420px,90vw)] rounded-xl bg-[var(--yt-bg-elev)] border border-[var(--yt-border)] shadow-2xl p-6 yt-pop"
        role="dialog"
        aria-label="Your data in ytapp"
        data-testid="data-modal"
      >
        <h2 className="text-[18px] font-medium text-[var(--yt-text)] mb-3">Your data in ytapp</h2>
        <p className="text-[14px] leading-[21px] text-[var(--yt-text-2)] mb-3">
          There is no account and no server-side profile. Everything ytapp remembers lives in this
          browser (or app) and never leaves the device:
        </p>
        <ul className="text-[13px] leading-[20px] text-[var(--yt-text-2)] list-disc pl-5 mb-3">
          <li>Preferences (theme, quality, autoplay) — <code>localStorage</code></li>
          <li>Subscriptions, history, likes, Watch later, playlists — <code>localStorage</code></li>
          <li>Hidden videos &amp; channels (Not interested) — <code>localStorage</code></li>
        </ul>
        <p className="text-[13px] leading-[19px] text-[var(--yt-text-2)]">
          Video metadata and streams are fetched on demand from YouTube (via your chosen data
          source) and are not stored. Clearing the app storage (Settings → Clear watch history,
          or browser site data) removes all of it permanently.
        </p>
        <button onClick={onClose} className="mt-5 h-9 px-4 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] text-[14px] font-medium">
          Got it
        </button>
      </div>
    </>
  );
}

export function AccountButton() {
  const [open, setOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const { navigate } = useRouter();
  const theme = useYt(s => s.prefs.theme);
  const setPrefs = useYt(s => s.setPrefs);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const row = "w-full flex items-center gap-3 px-4 py-2.5 text-left text-[14px] text-[var(--yt-text)] hover:bg-[var(--yt-hover)]";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        aria-expanded={open}
        data-testid="account-button"
        className="w-8 h-8 rounded-full bg-[var(--yt-blue)] flex items-center justify-center shrink-0 ml-1"
      >
        <UserRound className="w-5 h-5 text-[var(--yt-invert-text)]" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-10 z-30 min-w-[220px] rounded-xl bg-[var(--yt-bg-elev)] shadow-2xl border border-[var(--yt-border)] py-2 yt-pop"
          role="menu"
          data-testid="account-menu"
        >
          <button className={row} role="menuitem" onClick={() => { setOpen(false); navigate({ name: "subscriptions" }); }}>
            <UserRound className="w-[18px] h-[18px] text-[var(--yt-text-2)]" /> Your channel
          </button>
          <button className={row} role="menuitem" data-testid="account-appearance" onClick={() => {
            const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
            setPrefs({ theme: next });
          }}>
            <Palette className="w-[18px] h-[18px] text-[var(--yt-text-2)]" /> Appearance: {theme === "system" ? "Device" : theme === "light" ? "Light" : "Dark"}
          </button>
          <button className={row} role="menuitem" data-testid="account-data" onClick={() => { setOpen(false); setDataOpen(true); }}>
            <ShieldCheck className="w-[18px] h-[18px] text-[var(--yt-text-2)]" /> Your data in ytapp
          </button>
          <div className="my-2 border-t border-[var(--yt-border)]" />
          <button className={row} role="menuitem" onClick={() => { setOpen(false); navigate({ name: "settings" }); }}>
            <Settings className="w-[18px] h-[18px] text-[var(--yt-text-2)]" /> Settings
          </button>
        </div>
      )}
      {dataOpen && <DataModal onClose={() => setDataOpen(false)} />}
    </div>
  );
}
