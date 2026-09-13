"use client";

// Full-screen mobile search — the real YouTube pattern:
// back arrow + input + live suggestions (magnifier) + recent searches (clock).
// Opens with ONE tap from the header search icon; input auto-focuses.

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowLeft, Search, Mic, Clock, X } from "lucide-react";
import { useRouter } from "@/lib/yt-router";
import { fetchSuggestions } from "@/lib/yt-api";

const RECENTS_KEY = "yt_recent_searches";
const MAX_RECENTS = 12;

export function getRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) as string[] : [];
    return Array.isArray(list) ? list.filter(s => typeof s === "string").slice(0, MAX_RECENTS) : [];
  } catch { return []; }
}

export function addRecentSearch(q: string) {
  if (typeof window === "undefined" || !q.trim()) return;
  try {
    const list = getRecentSearches().filter(s => s !== q);
    list.unshift(q);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch { /* ignore */ }
}

export function clearRecentSearches() {
  if (typeof window !== "undefined") window.localStorage.removeItem(RECENTS_KEY);
}

// Suggestion text: typed prefix in regular weight, completion bolded
// (real YouTube bolds the untyped part of each suggestion).
function SuggestionText({ text, query }: { text: string; query: string }) {
  const clean = text.replace(/\u200b/g, "");
  const idx = query && clean.toLowerCase().startsWith(query.toLowerCase()) ? query.length : 0;
  if (idx === 0) return <span className="text-[15px] text-[var(--yt-text)] truncate pr-2">{clean}</span>;
  return (
    <span className="text-[15px] text-[var(--yt-text)] truncate pr-2">
      <span className="font-normal">{clean.slice(0, idx)}</span>
      <span className="font-medium">{clean.slice(idx)}</span>
    </span>
  );
}

export default function SearchOverlay({ open, onClose, onSearch, initialQuery = "" }: {
  open: boolean;
  onClose: () => void;
  onSearch: (q: string) => void;
  initialQuery?: string;
}) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { navigate } = useRouter();
  void navigate;

  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setSuggestions([]);
      setRecents(getRecentSearches());
      // focus after the entrance transition starts; select-all so retyping
      // replaces the prefilled query in one gesture (YouTube behavior)
      const t = setTimeout(() => {
        const el = inputRef.current;
        if (el) { el.focus(); if (initialQuery) el.select(); }
      }, 60);
      return () => clearTimeout(t);
    }
  }, [open, initialQuery]);

  // Back handling: overlay open → close overlay instead of leaving the page
  useEffect(() => {
    if (!open) return;
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open, onClose]);

  // Debounced suggestions
  useEffect(() => {
    const query = q.trim();
    if (!query) { setSuggestions([]); setLoadingSugg(false); return; }
    setLoadingSugg(true);
    const t = setTimeout(async () => {
      try {
        const s = await fetchSuggestions(query);
        setSuggestions(s.filter(s2 => s2.toLowerCase() !== query.toLowerCase()));
      } catch { setSuggestions([]); }
      finally { setLoadingSugg(false); }
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const submit = useCallback((query: string) => {
    const clean = query.trim();
    if (!clean) return;
    addRecentSearch(clean);
    onSearch(clean);
    onClose();
  }, [onSearch, onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit(q);
    else if (e.key === "Escape") onClose();
  };

  if (!open) return null;

  const list = q.trim()
    ? [{ text: q, exact: true }, ...suggestions.map(s => ({ text: s, exact: false }))]
    : recents.map(s => ({ text: s, recent: true }));

  return (
    <div
      className="fixed inset-0 z-[70] bg-[var(--yt-bg)] yt-search-overlay"
      role="dialog"
      aria-label="Search"
    >
      {/* top bar */}
      <div className="h-14 flex items-center gap-2 px-2 border-b border-[var(--yt-border)]">
        <button
          onClick={onClose}
          aria-label="Close search"
          className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-[var(--yt-bg-elev2)] active:bg-[var(--yt-hover)] shrink-0"
        >
          <ArrowLeft className="w-6 h-6 text-[var(--yt-text)]" />
        </button>
        <div className="flex-1 flex items-center h-11 rounded-full border border-[var(--yt-border)] bg-[var(--yt-bg-input)] min-w-0">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search YouTube"
            aria-label="Search YouTube"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="search"
            className="flex-1 min-w-0 bg-transparent text-[16px] text-[var(--yt-text)] placeholder:text-[#888] outline-none px-4"
          />
          {q && (
            <button
              onClick={() => { setQ(""); inputRef.current?.focus(); }}
              aria-label="Clear search"
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
            >
              <X className="w-5 h-5 text-[var(--yt-text-2)]" />
            </button>
          )}
        </div>
        <button
          aria-label="Search with your voice"
          className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-[var(--yt-bg-elev2)] shrink-0"
        >
          <Mic className="w-5 h-5 text-[var(--yt-text)]" />
        </button>
      </div>

      {/* suggestions / recents */}
      <div className="overflow-y-auto overscroll-contain" style={{ height: "calc(100% - 56px)" }} data-testid="search-suggestion-list">
        {!q.trim() && recents.length === 0 && (
          <div className="pt-16 text-center text-[13px] text-[#717171] px-8">
            No recent searches yet — start typing to see suggestions.
          </div>
        )}
        {!q.trim() && recents.length > 0 && (
          <div className="px-4 pt-4 pb-1 flex items-center justify-between">
            <span className="text-[13px] font-medium text-[var(--yt-text-2)]">Recent searches</span>
            <button
              onClick={() => { clearRecentSearches(); setRecents([]); }}
              className="text-[13px] text-[var(--yt-blue)] px-2 py-1"
            >
              Clear
            </button>
          </div>
        )}
        {list.map((item, i) => (
          <button
            key={`${item.text}-${i}`}
            onClick={() => submit(item.text)}
            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-[var(--yt-elev2-60)] active:bg-[var(--yt-bg-elev2)] text-left"
            data-testid={item.exact ? "suggestion-exact" : "suggestion-item"}
          >
            {("recent" in item && item.recent)
              ? <Clock className="w-5 h-5 text-[var(--yt-text-2)] shrink-0" />
              : <Search className="w-5 h-5 text-[var(--yt-text-2)] shrink-0" />}
            <SuggestionText text={item.text} query={q.trim()} />
          </button>
        ))}
        {loadingSugg && q.trim() && (
          <div className="px-4 py-3 text-[13px] text-[#717171]">Searching suggestions…</div>
        )}
      </div>
    </div>
  );
}
