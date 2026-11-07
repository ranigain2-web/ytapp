"use client";

// OfflineBanner (Phase 5, U-04): a slim system pill when the network is
// gone — playback from cache may continue, but feeds/search fail fast and
// the user deserves to know why.

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export default function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    // deferred past the effect pass: setState must not fire synchronously
    // inside the effect (cascading-render lint); the events are async anyway
    const sync = setTimeout(() => setOnline(navigator.onLine), 0);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearTimeout(sync);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online) return null;
  return (
    <div
      data-testid="offline-banner"
      className="fixed left-1/2 -translate-x-1/2 bottom-16 lg:bottom-6 z-[90] px-4 h-9 rounded-full bg-black/90 text-white text-[13px] font-medium flex items-center gap-2 shadow-2xl"
    >
      <WifiOff className="w-4 h-4" /> You&apos;re offline — playback may stop, feeds won&apos;t refresh
    </div>
  );
}
