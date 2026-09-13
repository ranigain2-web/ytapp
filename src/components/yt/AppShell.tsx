"use client";

import { useState, useCallback } from "react";
import { useRouter } from "@/lib/yt-router";
import Header from "./Header";
import { SidebarDrawer, MiniSidebar } from "./Sidebar";
import HomePage from "./HomePage";
import SearchPage from "./SearchPage";
import WatchPage from "./WatchPage";
import ChannelPage from "./ChannelPage";
import SettingsPage from "./SettingsPage";
import { HistoryPage, SubscriptionsPage, LikedPage, LaterPage, PlaylistsPage } from "./LibraryPages";
import ShortsPage from "./ShortsPage";

export default function AppShell() {
  const { route, navigate } = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [persistentSidebar, setPersistentSidebar] = useState(true);

  const onToggleSidebar = useCallback(() => {
    if (window.innerWidth >= 1280) setPersistentSidebar(v => !v);
    else setSidebarOpen(v => !v);
  }, []);

  // On watch page: sidebar collapses to mini rail (YouTube behavior)
  const showFullSidebar = persistentSidebar && route.name !== "watch";
  const showMiniRail = !showFullSidebar;

  const onSearch = useCallback((q: string) => navigate({ name: "search", q }), [navigate]);

  let content: React.ReactNode;
  switch (route.name) {
    case "home":
      content = <HomePage key={route.category || "all"} category={route.category || "all"} />;
      break;
    case "search":
      content = <SearchPage key={route.q} query={route.q} />;
      break;
    case "watch":
      content = <WatchPage key={route.v} videoId={route.v} startAt={route.t} />;
      break;
    case "channel":
      content = <ChannelPage key={route.id} channelId={route.id} />;
      break;
    case "subscriptions":
      content = <SubscriptionsPage />;
      break;
    case "shorts":
      content = <ShortsPage />;
      break;
    case "history":
      content = <HistoryPage />;
      break;
    case "liked":
      content = <LikedPage />;
      break;
    case "later":
      content = <LaterPage />;
      break;
    case "playlists":
      content = <PlaylistsPage />;
      break;
    case "settings":
      content = <SettingsPage />;
      break;
    default:
      content = <HomePage />;
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f]">
      {/* Shorts is immersive full-screen: no header, no bottom nav (YouTube behavior) */}
      {route.name !== "shorts" && (
        <Header onToggleSidebar={onToggleSidebar} onSearch={onSearch} />
      )}
      <SidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* body layout: full sidebar (persistent, xl+) | mini rail.
          On watch pages the mini rail only appears at xl+ — smaller screens
          (incl. phone landscape) get the full width for the player. */}
      <div className="flex pt-14">
        {showFullSidebar && (
          <aside className="hidden xl:block w-60 shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto">
            <SidebarInline />
          </aside>
        )}
        {showMiniRail && (
          <div className={route.name === "watch" ? "hidden xl:block shrink-0" : "shrink-0"}>
            <MiniSidebar />
          </div>
        )}
        <main className="flex-1 min-w-0">{content}</main>
      </div>

      {/* mobile bottom nav */}
      {route.name !== "shorts" && <MobileNav />}
    </div>
  );
}

// Inline sidebar for xl+ (drawer has its own copy for mobile)
import { SidebarNavItems } from "./Sidebar";
function SidebarInline() {
  return <SidebarNavItems onNavigate={() => {}} />;
}

// Bottom-nav icons — outline when inactive, FILLED when active (Material You /
// YouTube behavior). Each entry: [outline path, filled path].
const NAV_ICONS: { label: string; routeName: string; outline: string; filled: string }[] = [
  {
    label: "Home", routeName: "home",
    outline: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
    filled: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z",
  },
  {
    label: "Shorts", routeName: "shorts",
    // YouTube Shorts glyph: rounded rect + play + motion waves
    outline: "M17.8 6.4a3.6 3.6 0 1 1 3.2 6.1L10.4 17.6a3.6 3.6 0 1 1-3.2-6.1L17.8 6.4Z M9.9 8.6l4.4 2.4-4.4 2.4z",
    filled: "M15.3 4.6 8.7 8.3a3.6 3.6 0 0 0 1.6 6.8c.5 0 1-.1 1.4-.3l1.3-.7a3.6 3.6 0 1 0 3.4-6.2l-1.1-.6ZM9 8.9l4.6 2.6L9 14.1z",
  },
  {
    label: "Subscriptions", routeName: "subscriptions",
    outline: "M4 6v12M8 4v16M21 5.6a1 1 0 0 0-1-.9H12v10.6h8a1 1 0 0 0 1-1z",
    filled: "M4 6v12M8 4v16M21 5.6a1 1 0 0 0-1-.9H12v10.6h8a1 1 0 0 0 1-1z",
  },
  {
    label: "You", routeName: "history",
    outline: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21c1.5-3.5 4.5-5.5 8-5.5s6.5 2 8 5.5",
    filled: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-8 9.2c1.6-3.7 4.7-5.7 8-5.7s6.4 2 8 5.7z",
  },
];

function MobileNav() {
  const { route, navigate } = useRouter();
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0f0f0f] border-t border-[#272727]/70 flex pb-[env(safe-area-inset-bottom)]" aria-label="Mobile navigation">
      {NAV_ICONS.map((it) => {
        const active = route.name === it.routeName;
        return (
          <button
            key={it.label}
            onClick={() => navigate({ name: it.routeName } as never)}
            className={`flex-1 flex flex-col items-center gap-1 pt-2 pb-1.5 transition-colors ${active ? "text-[#f1f1f1]" : "text-[#aaaaaa]"}`}
            aria-current={active ? "page" : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-6 h-6"
              fill={active ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={active ? 0 : 1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={active ? it.filled : it.outline} />
            </svg>
            <span className={`text-[10px] leading-3 ${active ? "font-medium" : "font-normal"}`}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
