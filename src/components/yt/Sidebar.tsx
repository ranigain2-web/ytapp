"use client";

import { useRouter, type Route } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import {
  Home, Play, Clock, ThumbsUp, BookmarkPlus, Flame, Music2, Gamepad2, Newspaper,
  Trophy, GraduationCap, Podcast, UtensilsCrossed, Film, Settings, UserRound, ListVideo, Radio, Zap,
} from "lucide-react";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  route?: Route;
  onClick?: () => void;
}

export function SidebarNavItems({ onNavigate }: { onNavigate: () => void }) {
  const { route, navigate } = useRouter();
  const subs = useYt(s => s.subs);
  const historyCount = useYt(s => s.history.length);

  const isActive = (r?: Route) => {
    if (!r) return false;
    if (r.name === "home" && route.name === "home") return (r as { category?: string }).category === (route as { category?: string }).category;
    return r.name === route.name;
  };

  const go = (r: Route) => { navigate(r); onNavigate(); };

  const main: NavItem[] = [
    { label: "Home", icon: Home, route: { name: "home" } },
    { label: "Shorts", icon: Zap, route: { name: "shorts" } },
    { label: "Subscriptions", icon: Play, route: { name: "subscriptions" } },
  ];

  const you: NavItem[] = [
    { label: "History", icon: Clock, route: { name: "history" } },
    { label: "Playlists", icon: ListVideo, route: { name: "playlists" } },
    { label: "Your videos", icon: Video_Icon, route: { name: "liked" } },
    { label: "Watch later", icon: BookmarkPlus, route: { name: "later" } },
    { label: "Liked videos", icon: ThumbsUp, route: { name: "liked" } },
  ];

  const explore: NavItem[] = [
    { label: "Trending", icon: Flame, route: { name: "home", category: "all" } },
    { label: "Music", icon: Music2, route: { name: "home", category: "music" } },
    { label: "Movies", icon: Film, route: { name: "home", category: "movies" } },
    { label: "Live", icon: Radio, route: { name: "home", category: "live" } },
    { label: "Gaming", icon: Gamepad2, route: { name: "home", category: "gaming" } },
    { label: "News", icon: Newspaper, route: { name: "home", category: "news" } },
    { label: "Sports", icon: Trophy, route: { name: "home", category: "sports" } },
    { label: "Courses", icon: GraduationCap, route: { name: "home", category: "learning" } },
    { label: "Podcasts", icon: Podcast, route: { name: "home", category: "podcasts" } },
  ];

  const settings: NavItem[] = [
    { label: "Settings", icon: Settings, route: { name: "settings" } },
  ];

  const renderSection = (title: string | undefined, items: NavItem[]) => (
    <div className="py-2 border-b border-[#272727]/60">
      {title && <h3 className="px-6 pt-2 pb-1 text-[16px] font-medium text-[#f1f1f1]">{title}</h3>}
      {items.map((item) => {
        const active = isActive(item.route);
        return (
          <button
            key={item.label}
            onClick={() => item.route && go(item.route)}
            className={`w-full flex items-center gap-6 px-6 h-10 rounded-lg text-[14px] transition-colors ${active ? "bg-[#272727] font-medium" : "hover:bg-[#272727]/70"}`}
          >
            <item.icon className="w-6 h-6 shrink-0 text-[#f1f1f1]" />
            <span className="truncate">{item.label}</span>
            {item.label === "History" && historyCount > 0 && (
              <span className="ml-auto text-xs text-[#aaa]">{historyCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <nav className="pb-8 overflow-y-auto" role="navigation">
      {renderSection(undefined, main)}

      {subs.length > 0 && (
        <div className="py-2 border-b border-[#272727]/60">
          <h3 className="px-6 pt-2 pb-1 text-[16px] font-medium text-[#f1f1f1]">Subscriptions</h3>
          {subs.slice(0, 12).map((ch) => (
            <button
              key={ch.id}
              onClick={() => go({ name: "channel", id: ch.id })}
              className="w-full flex items-center gap-6 px-6 h-10 rounded-lg text-[14px] hover:bg-[#272727]/70"
            >
              {ch.avatar ? (

                <img src={ch.avatar} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-[#3ea6ff] text-[#0f0f0f] text-xs font-bold flex items-center justify-center shrink-0">
                  {(ch.name || "?")[0]?.toUpperCase()}
                </span>
              )}
              <span className="truncate">{ch.name}</span>
            </button>
          ))}
        </div>
      )}

      {renderSection("You", you)}
      {renderSection("Explore", explore)}
      {renderSection(undefined, settings)}

      <div className="px-6 pt-6 pb-4 border-b border-[#272727]/60">
        <p className="text-[13px] leading-5 text-[#aaa] mb-3">
          Sign in to like videos, comment, and subscribe.
        </p>
        <button className="flex items-center gap-2 h-9 px-4 rounded-full border border-[#3ea6ff] text-[14px] text-[#3ea6ff] hover:bg-[#3ea6ff]/10">
          <UserRound className="w-5 h-5" /> Sign in
        </button>
      </div>
      <p className="px-6 pt-4 text-[13px] leading-5 text-[#717171]">
        YouTube client · data fetched on-device
      </p>
    </nav>
  );
}

// inline icon to avoid extra import in list above
function Video_Icon({ className }: { className?: string }) {
  return <Radio className={className} />;
}

export function MiniSidebar() {
  const { route, navigate } = useRouter();
  const items: NavItem[] = [
    { label: "Home", icon: Home, route: { name: "home" } },
    { label: "Subscriptions", icon: Play, route: { name: "subscriptions" } },
    { label: "History", icon: Clock, route: { name: "history" } },
    { label: "Watch later", icon: BookmarkPlus, route: { name: "later" } },
    { label: "Liked", icon: ThumbsUp, route: { name: "liked" } },
  ];
  return (
    <nav className="w-[72px] shrink-0 hidden sm:flex flex-col pt-14" aria-label="mini guide">
      {items.map((item) => {
        const active = route.name === item.route?.name;
        return (
          <button
            key={item.label}
            onClick={() => item.route && navigate(item.route)}
            className={`flex flex-col items-center justify-center gap-1 w-full py-4 rounded-lg text-[10px] ${active ? "bg-[#272727]" : "hover:bg-[#272727]/70"}`}
          >
            <item.icon className="w-6 h-6 text-[#f1f1f1]" />
            <span className="text-[#f1f1f1]">{item.label.split(" ")[0]}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return (
    <>
      {/* backdrop (mobile) */}
      <div
        className={`fixed inset-0 z-[55] bg-black/60 transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed left-0 top-0 bottom-0 z-[60] w-60 bg-[#0f0f0f] overflow-y-auto transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Guide"
        aria-hidden={!open}
      >
        <div className="h-14 flex items-center gap-4 px-4 sticky top-0 bg-[#0f0f0f] z-10">
          <button onClick={onClose} aria-label="Close guide" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#272727]">
            <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#f1f1f1" strokeWidth="1.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <div className="flex items-center gap-[5px]">
            <svg viewBox="0 0 28 20" className="h-[20px] w-[28px]">
              <path d="M27.4 3.1s-.3-2-1.1-2.9c-1-1.1-2.2-1.1-2.7-1.2C19.5-1.2 14-1.2 14-1.2h-.1s-5.5 0-9.6.2c-.5.1-1.7.1-2.7 1.2C.8 1.1.5 3.1.5 3.1S.2 5.5.2 8v4c0 2.5.3 4.9.3 4.9s.3 2 1.1 2.9c1 1.1 2.4 1 3 1.2 1.4.1 9.4.2 9.4.2s5.5 0 9.6-.3c.5-.1 1.7-.1 2.7-1.2.8-.9 1.1-2.9 1.1-2.9s.3-2.4.3-4.9V8c0-2.5-.3-4.9-.3-4.9z" fill="#ff0000" />
              <path d="M11.2 13.3V5.7l7.6 3.8-7.6 3.8z" fill="#fff" />
            </svg>
            <span className="text-white text-[18px] font-bold tracking-[-0.7px]">YouTube</span>
          </div>
        </div>
        <SidebarNavItems onNavigate={onClose} />
      </aside>
    </>
  );
}
