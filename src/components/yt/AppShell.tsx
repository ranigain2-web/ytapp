"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { applyTheme, watchSystemTheme } from "@/lib/yt-theme";
import { applyPlatformClass, isAndroidApp } from "@/lib/yt-native";
import Header from "./Header";
import { SidebarDrawer, MiniSidebar } from "./Sidebar";
import HomePage from "./HomePage";
import SearchPage from "./SearchPage";
import WatchPage from "./WatchPage";
import ChannelPage from "./ChannelPage";
import SettingsPage from "./SettingsPage";
import { HistoryPage, SubscriptionsPage, LikedPage, LaterPage, PlaylistsPage } from "./LibraryPages";
import ShortsPage from "./ShortsPage";
import WhatsNew from "./WhatsNew";

export default function AppShell() {
  const { route, navigate } = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [persistentSidebar, setPersistentSidebar] = useState(true);
  const theme = useYt(s => s.prefs.theme);

  // Theme engine: apply on every change and follow the OS while "system".
  // Lives here so it is active on every page, not just Settings.
  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(() => theme);
  }, [theme]);

  // Re-assert the platform shell class (the boot script stamps it pre-paint;
  // this covers a bridge that only appears once the app has hydrated).
  useEffect(() => {
    applyPlatformClass();
  }, []);

  const onToggleSidebar = useCallback(() => {
    // Below xl there is no persistent guide to collapse, so the hamburger must
    // open the overlay drawer. Watch pages are the same at ANY width — the
    // guide never persists there, so `persistentSidebar` had nothing to toggle
    // and the button did nothing on a 1440px watch page.
    // The Android shell has no persistent guide at any width, so the hamburger
    // must always open the drawer there (matches YouTube's Android app).
    if (!isAndroidApp() && window.innerWidth >= 1280 && route.name !== "watch") setPersistentSidebar(v => !v);
    else setSidebarOpen(v => !v);
  }, [route.name]);

  // YouTube's guide has three states and we mirror all three:
  //   • xl+                 → full 240px guide (collapsed automatically on watch)
  //   • md … xl             → 72px mini rail
  //   • below md            → bottom pivot bar
  // Watch pages start collapsed, and get the rail only at xl+ so the player
  // stays edge-to-edge on tablet (which is what YouTube does).
  const fullGuide = persistentSidebar && route.name !== "watch";
  // On watch, YouTube gives the player the full width well past 1440px (its
  // guide becomes an overlay), and only restores the rail on very wide
  // viewports — 2xl mirrors the measured behaviour.
  const railClass = route.name === "watch"
    ? "hidden 2xl:block shrink-0"
    : fullGuide
      ? "hidden md:block xl:hidden shrink-0"
      : "hidden md:block shrink-0";

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
    <div className="min-h-screen bg-[var(--yt-bg)]">
      {/* Shorts is immersive full-screen: no header, no bottom nav (YouTube behavior) */}
      {route.name !== "shorts" && (
        <Header onToggleSidebar={onToggleSidebar} onSearch={onSearch} />
      )}
      <SidebarDrawer open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* body layout: full sidebar (persistent, xl+) | mini rail.
          On watch pages the mini rail only appears at xl+ — smaller screens
          (incl. phone landscape) get the full width for the player. */}
      <div className="flex pt-[var(--yt-header-h)]">
        {/* `data-yt-rail` is the hook the Android shell uses to suppress every
            guide column at ANY width (see globals.css html.yt-android). */}
        {fullGuide && (
          <aside data-yt-rail className="hidden xl:block w-60 shrink-0 sticky top-[var(--yt-header-h)] yt-under-header overflow-y-auto">
            <SidebarInline />
          </aside>
        )}
        <div data-yt-rail className={railClass}>
          <MiniSidebar />
        </div>
        <main className="flex-1 min-w-0">{content}</main>
      </div>

      {/* mobile bottom nav */}
      {route.name !== "shorts" && <MobileNav />}

      {/* once-per-version feature tour */}
      <WhatsNew />
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
    <nav data-yt-mobile-nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[var(--yt-bg)] border-t border-[var(--yt-border)]/70 flex pb-[env(safe-area-inset-bottom)]" aria-label="Mobile navigation">
      {NAV_ICONS.map((it) => {
        const active = route.name === it.routeName;
        return (
          <button
            key={it.label}
            onClick={() => navigate({ name: it.routeName } as never)}
            className={`flex-1 flex flex-col items-center gap-1 pt-2 pb-2 transition-colors ${active ? "text-[var(--yt-text)]" : "text-[var(--yt-text-2)]"}`}
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
            <span className={`text-[11px] leading-[13px] ${active ? "font-medium" : "font-normal"}`}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
