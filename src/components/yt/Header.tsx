"use client";

import { useState, useRef, useEffect } from "react";
import { Menu, Search, Mic, Video, Bell, Cast, UserRound } from "lucide-react";
import { useRouter, type Route } from "@/lib/yt-router";

export function YouTubeLogo({ onClick }: { onClick?: () => void }) {
  return (
    <button onClick={onClick} aria-label="YouTube Home" className="flex items-center gap-[5px] shrink-0 select-none">
      <svg viewBox="0 0 28 20" className="h-[20px] w-[28px]">
        <path d="M27.4 3.1s-.3-2-1.1-2.9c-1-1.1-2.2-1.1-2.7-1.2C19.5-1.2 14-1.2 14-1.2h-.1s-5.5 0-9.6.2c-.5.1-1.7.1-2.7 1.2C.8 1.1.5 3.1.5 3.1S.2 5.5.2 8v4c0 2.5.3 4.9.3 4.9s.3 2 1.1 2.9c1 1.1 2.4 1 3 1.2 1.4.1 9.4.2 9.4.2s5.5 0 9.6-.3c.5-.1 1.7-.1 2.7-1.2.8-.9 1.1-2.9 1.1-2.9s.3-2.4.3-4.9V8c0-2.5-.3-4.9-.3-4.9z" fill="#ff0000" />
        <path d="M11.2 13.3V5.7l7.6 3.8-7.6 3.8z" fill="#fff" />
      </svg>
      <span className="text-white text-[18px] font-bold tracking-[-0.7px] leading-none hidden xs:inline">YouTube</span>
    </button>
  );
}

export default function Header({ onToggleSidebar, onSearch }: {
  onToggleSidebar: () => void;
  onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") || "";
  });
  const [focus, setFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();

  // sync input on back/forward navigation (event callback context)
  useEffect(() => {
    const onPop = () => {
      const params = new URLSearchParams(window.location.search);
      setQ(params.get("q") || "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (query) {
      onSearch(query);
      inputRef.current?.blur();
      setFocus(false);
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-14 bg-[#0f0f0f] flex items-center gap-2 px-2 sm:px-4">
      {/* left: hamburger + logo */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleSidebar}
          aria-label="Guide"
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#272727] transition-colors"
        >
          <Menu className="w-6 h-6 text-[#f1f1f1]" />
        </button>
        <YouTubeLogo onClick={() => navigate({ name: "home" })} />
      </div>

      {/* center: search */}
      <form onSubmit={submit} className="flex-1 flex justify-center min-w-0 gap-2 sm:gap-4 px-2">
        <div className={`flex w-full max-w-[540px] min-w-0 ${focus ? "md:translate-x-[68px]" : ""} transition-transform duration-200`}>
          <div className={`flex flex-1 min-w-0 h-10 rounded-l-full border ${focus ? "border-[#3ea6ff]" : "border-[#303030]"} bg-[#121212]`}>
            {focus && (
              <div className="w-12 flex items-center justify-center shrink-0">
                <Search className="w-5 h-5 text-[#f1f1f1]" />
              </div>
            )}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocus(true)}
              onBlur={() => setFocus(false)}
              placeholder="Search"
              aria-label="Search"
              className={`flex-1 min-w-0 bg-transparent text-[16px] text-[#f1f1f1] placeholder:text-[#888] outline-none px-4 ${focus ? "pl-1" : ""}`}
            />
            {q && (
              <button type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear search" className="w-10 flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#aaa" strokeWidth="1.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            )}
          </div>
          <button
            type="submit"
            aria-label="Search"
            className="w-16 h-10 rounded-r-full bg-[#222222] border border-l-0 border-[#303030] flex items-center justify-center hover:bg-[#1f1f1f] shrink-0"
          >
            <Search className="w-5 h-5 text-[#f1f1f1]" />
          </button>
          <div className="hidden md:flex w-10 h-10 ml-2 rounded-full bg-[#272727] items-center justify-center hover:bg-[#3f3f3f] cursor-pointer shrink-0" title="Search with your voice">
            <Mic className="w-5 h-5 text-[#f1f1f1]" />
          </div>
        </div>
      </form>

      {/* right: actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button className="hidden sm:flex w-10 h-10 rounded-full items-center justify-center hover:bg-[#272727]" aria-label="Cast">
          <Cast className="w-6 h-6 text-[#f1f1f1]" />
        </button>
        <button className="hidden sm:flex w-10 h-10 rounded-full items-center justify-center hover:bg-[#272727] relative" aria-label="Notifications">
          <Bell className="w-6 h-6 text-[#f1f1f1]" />
        </button>
        <button
          onClick={() => navigate({ name: "settings" })}
          className="w-8 h-8 rounded-full bg-[#3ea6ff] flex items-center justify-center shrink-0 ml-1"
          aria-label="Account"
        >
          <UserRound className="w-5 h-5 text-[#0f0f0f]" />
        </button>
      </div>
    </header>
  );
}
