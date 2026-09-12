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
      <Header onToggleSidebar={onToggleSidebar} onSearch={onSearch} />
      <SidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* body layout: full sidebar (persistent, xl+) | mini rail */}
      <div className="flex pt-14">
        {showFullSidebar && (
          <aside className="hidden xl:block w-60 shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto">
            <SidebarInline />
          </aside>
        )}
        {showMiniRail && <MiniSidebar />}
        <main className="flex-1 min-w-0">{content}</main>
      </div>

      {/* mobile bottom nav */}
      <MobileNav />
    </div>
  );
}

// Inline sidebar for xl+ (drawer has its own copy for mobile)
import { SidebarNavItems } from "./Sidebar";
function SidebarInline() {
  return <SidebarNavItems onNavigate={() => {}} />;
}

function MobileNav() {
  const { route, navigate } = useRouter();
  const items = [
    { label: "Home", route: { name: "home" } as const, icon: "M4 10v11h6v-11M10 4h10v17h-6v-13" },
    { label: "Subs", route: { name: "subscriptions" } as const, icon: "M7 4v16M3 8v8M17 4l4 4-4 4M11 19c6 0 8-4 8-7s-2-7-8-7-8 4-8 7 2 7 8 7Z" },
    { label: "History", route: { name: "history" } as const, icon: "M12 8v5l4 2M3 12a9 9 0 1 0 3-6.7M3 4v5h5" },
    { label: "Later", route: { name: "later" } as const, icon: "M5 4h14v17l-7-4-7 4V4z" },
  ];
  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0f0f0f] border-t border-[#272727]/70 flex pb-[env(safe-area-inset-bottom)]" aria-label="Mobile navigation">
      {items.map((it) => {
        const active = route.name === it.route.name;
        return (
          <button
            key={it.label}
            onClick={() => navigate(it.route)}
            className={`flex-1 flex flex-col items-center gap-1 py-2 ${active ? "text-[#f1f1f1]" : "text-[#aaa]"}`}
            aria-current={active ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d={it.icon} />
            </svg>
            <span className="text-[10px]">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
