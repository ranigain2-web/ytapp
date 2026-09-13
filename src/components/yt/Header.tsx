"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Menu, Search, Mic, Video, Bell, Cast, UserRound, Clock, Moon, Sun, Monitor } from "lucide-react";
import { useRouter, type Route } from "@/lib/yt-router";
import SearchOverlay, { addRecentSearch, getRecentSearches } from "./SearchOverlay";
import { fetchSuggestions } from "@/lib/yt-api";
import { useYt } from "@/lib/yt-store";
import { resolveIsLight } from "@/lib/yt-theme";

export function YouTubeLogo({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} aria-label="YouTube Home" className="flex items-center gap-[5px] shrink-0 select-none">
      <svg viewBox="0 0 28 20" className="h-[20px] w-[28px]">
        <path d="M27.4 3.1s-.3-2-1.1-2.9c-1-1.1-2.2-1.1-2.7-1.2C19.5-1.2 14-1.2 14-1.2h-.1s-5.5 0-9.6.2c-.5.1-1.7.1-2.7 1.2C.8 1.1.5 3.1.5 3.1S.2 5.5.2 8v4c0 2.5.3 4.9.3 4.9s.3 2 1.1 2.9c1 1.1 2.4 1 3 1.2 1.4.1 9.4.2 9.4.2s5.5 0 9.6-.3c.5-.1 1.7-.1 2.7-1.2.8-.9 1.1-2.9 1.1-2.9s.3-2.4.3-4.9V8c0-2.5-.3-4.9-.3-4.9z" fill="#ff0000" />
        <path d="M11.2 13.3V5.7l7.6 3.8-7.6 3.8z" fill="#fff" />
      </svg>
      <span className="text-[var(--yt-text)] text-[18px] font-bold tracking-[-0.7px] leading-none hidden xs:inline">YouTube</span>
    </button>
  );
}

export default function Header({ onToggleSidebar, onSearch }: {
  onToggleSidebar: () => void;
  onSearch: (q: string) => void;
}) {
  const { route } = useRouter();
  const theme = useYt(s => s.prefs.theme);
  const setPrefs = useYt(s => s.setPrefs);
  const isLight = resolveIsLight(theme);
  const [q, setQ] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });
  const [focus, setFocus] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggOpen, setSuggOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggBoxRef = useRef<HTMLDivElement>(null);
  const { navigate } = useRouter();

  // sync input on back/forward navigation (event callback context)
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      setQ(params.get("q") || "");
      setSuggOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (query) {
      addRecentSearch(query);
      onSearch(query);
      inputRef.current?.blur();
      setFocus(false);
      setSuggOpen(false);
    }
  };

  const submitQuery = useCallback((query: string) => {
    addRecentSearch(query);
    onSearch(query);
    setSuggOpen(false);
    setFocus(false);
  }, [onSearch]);

  // Desktop suggestions dropdown (debounced) + recents — scheduled, not sync
  useEffect(() => {
    const t = setTimeout(() => {
      const query = q.trim();
      if (!query || !focus) {
        setSuggestions([]);
        if (focus) setRecents(getRecentSearches());
        return;
      }
      fetchSuggestions(query)
        .then(s => setSuggestions(s.filter(s2 => s2.toLowerCase() !== query.toLowerCase()).slice(0, 9)))
        .catch(() => setSuggestions([]));
    }, 170);
    return () => clearTimeout(t);
  }, [q, focus]);

  // Close the dropdown on outside click
  useEffect(() => {
    if (!suggOpen) return;
    const onDown = (e: MouseEvent) => {
      if (suggBoxRef.current && !suggBoxRef.current.contains(e.target as Node)) setSuggOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [suggOpen]);

  const desktopList = q.trim()
    ? [{ text: q, exact: true }, ...suggestions.map(s => ({ text: s, exact: false }))]
    : recents.slice(0, 8).map(s => ({ text: s, recent: true }));

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-[var(--yt-bg)] flex items-center gap-2 px-2 sm:px-4">
        {/* left: hamburger + logo */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onToggleSidebar}
            aria-label="Guide"
            className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-[var(--yt-bg-elev2)] active:bg-[var(--yt-hover)] transition-colors"
          >
            <Menu className="w-6 h-6 text-[var(--yt-text)]" />
          </button>
          <YouTubeLogo onClick={() => navigate({ name: "home" })} />
        </div>

        {/* MOBILE: query bar (on search results) or spacer, then search icon */}
        {route.name === "search" && route.q ? (
          <button
            onClick={() => setOverlayOpen(true)}
            className="sm:hidden flex flex-1 h-10 mx-1 rounded-full bg-[var(--yt-bg-input)] border border-[var(--yt-border)] items-center gap-3 px-4 min-w-0"
            data-testid="mobile-query-bar"
            aria-label={`Search: ${route.q}`}
          >
            <Search className="w-5 h-5 text-[var(--yt-text-2)] shrink-0" />
            <span className="text-[15px] text-[var(--yt-text)] truncate">{route.q}</span>
          </button>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex items-center gap-1 shrink-0 sm:hidden">
          {/* Theme quick-toggle — always one tap away on mobile too */}
          <button
            onClick={() => {
              // dark → light → system → dark (YouTube's Appearance cycle)
              const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
              setPrefs({ theme: next });
            }}
            aria-label={`Theme: ${theme === "system" ? "device theme" : theme}. Tap to change`}
            title={`Appearance: ${theme === "system" ? "Use device theme" : theme === "light" ? "Light theme" : "Dark theme"} — tap to change`}
            data-testid="theme-toggle"
            className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-[var(--yt-bg-elev2)] active:bg-[var(--yt-hover)]"
          >
            {theme === "system"
              ? <Monitor className="w-6 h-6 text-[var(--yt-text)]" />
              : isLight
              ? <Sun className="w-6 h-6 text-[var(--yt-text)]" />
              : <Moon className="w-6 h-6 text-[var(--yt-text)]" />}
          </button>
          <button
            onClick={() => setOverlayOpen(true)}
            aria-label="Search"
            data-testid="mobile-search-button"
            className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-[var(--yt-bg-elev2)] active:bg-[var(--yt-hover)]"
          >
            <Search className="w-6 h-6 text-[var(--yt-text)]" />
          </button>
          <button
            onClick={() => navigate({ name: "settings" })}
            className="w-8 h-8 rounded-full bg-[var(--yt-blue)] flex items-center justify-center shrink-0 ml-1"
            aria-label="Account"
          >
            <UserRound className="w-5 h-5 text-[var(--yt-invert-text)]" />
          </button>
        </div>

        {/* DESKTOP: inline search bar + suggestions dropdown */}
        <form onSubmit={submit} className="hidden sm:flex flex-1 justify-center min-w-0 gap-2 sm:gap-4 px-2">
          <div className={`flex w-full max-w-[540px] min-w-0 ${focus ? "md:translate-x-[68px]" : ""} transition-transform duration-200`}>
            <div className="relative flex flex-1 min-w-0">
              <div className={`flex flex-1 min-w-0 h-10 rounded-l-full border ${focus ? "border-[var(--yt-blue)]" : "border-[var(--yt-border)]"} bg-[var(--yt-bg-input)]`}>
                {focus && (
                  <div className="w-12 flex items-center justify-center shrink-0">
                    <Search className="w-5 h-5 text-[var(--yt-text)]" />
                  </div>
                )}
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => { setFocus(true); setSuggOpen(true); }}
                  onBlur={() => setFocus(false)}
                  onKeyDown={(e) => { if (e.key === "Escape") setSuggOpen(false); }}
                  placeholder="Search"
                  aria-label="Search"
                  autoComplete="off"
                  className={`flex-1 min-w-0 bg-transparent text-[16px] text-[var(--yt-text)] placeholder:text-[#888] outline-none px-4 ${focus ? "pl-1" : ""}`}
                />
                {q && (
                  <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear search" className="w-10 flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#aaa" strokeWidth="1.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              {/* suggestions dropdown */}
              {suggOpen && focus && desktopList.length > 0 && (
                <div
                  ref={suggBoxRef}
                  className="absolute top-11 left-0 right-0 rounded-xl bg-[var(--yt-bg-elev)] border border-[var(--yt-border)] shadow-2xl py-2 z-50"
                  data-testid="desktop-suggestions"
                >
                  {desktopList.map((item, i) => (
                    <button
                      key={`${item.text}-${i}`}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); submitQuery(item.text); }}
                      className="w-full flex items-center gap-4 px-4 py-2.5 text-left hover:bg-[#2f2f2f]"
                      data-testid={item.exact ? "suggestion-exact" : "suggestion-item"}
                    >
                      {("recent" in item && item.recent)
                        ? <Clock className="w-5 h-5 text-[var(--yt-text-2)] shrink-0" />
                        : <Search className="w-5 h-5 text-[var(--yt-text-2)] shrink-0" />}
                      <span className="text-[15px] text-[var(--yt-text)] truncate pr-2">{item.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              aria-label="Search"
              className="w-16 h-10 rounded-r-full bg-[#222222] border border-l-0 border-[var(--yt-border)] flex items-center justify-center hover:bg-[#1f1f1f] shrink-0"
            >
              <Search className="w-5 h-5 text-[var(--yt-text)]" />
            </button>
            <div className="hidden md:flex w-10 h-10 ml-2 rounded-full bg-[var(--yt-bg-elev2)] items-center justify-center hover:bg-[var(--yt-hover)] cursor-pointer shrink-0" title="Search with your voice">
              <Mic className="w-5 h-5 text-[var(--yt-text)]" />
            </div>
          </div>
        </form>

        {/* DESKTOP right: actions */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
              setPrefs({ theme: next });
            }}
            aria-label={`Theme: ${theme === "system" ? "device theme" : theme}. Tap to change`}
            title={`Appearance: ${theme === "system" ? "Use device theme" : theme === "light" ? "Light theme" : "Dark theme"} — tap to change (Settings → Appearance for more)`}
            data-testid="theme-toggle-desktop"
            className="hidden md:flex w-10 h-10 rounded-full items-center justify-center hover:bg-[var(--yt-bg-elev2)]"
          >
            {theme === "system"
              ? <Monitor className="w-6 h-6 text-[var(--yt-text)]" />
              : isLight
              ? <Sun className="w-6 h-6 text-[var(--yt-text)]" />
              : <Moon className="w-6 h-6 text-[var(--yt-text)]" />}
          </button>
          <button className="hidden md:flex w-10 h-10 rounded-full items-center justify-center hover:bg-[var(--yt-bg-elev2)]" aria-label="Cast">
            <Cast className="w-6 h-6 text-[var(--yt-text)]" />
          </button>
          <button className="hidden md:flex w-10 h-10 rounded-full items-center justify-center hover:bg-[var(--yt-bg-elev2)] relative" aria-label="Notifications">
            <Bell className="w-6 h-6 text-[var(--yt-text)]" />
          </button>
          <button
            onClick={() => navigate({ name: "settings" })}
            className="w-8 h-8 rounded-full bg-[var(--yt-blue)] flex items-center justify-center shrink-0 ml-1"
            aria-label="Account"
          >
            <UserRound className="w-5 h-5 text-[var(--yt-invert-text)]" />
          </button>
        </div>
      </header>

      {/* full-screen mobile search */}
      <SearchOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        onSearch={(query) => onSearch(query)}
        initialQuery={route.name === "search" ? route.q : ""}
      />
    </>
  );
}
