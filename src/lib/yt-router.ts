// Tiny query-param router — keeps the app single-page (Capacitor/static-export friendly)
// Route lives in a SHARED zustand store so every useRouter() instance stays in sync.
// Routes: /?v=ID (watch) | /?q=... (search) | /?channel=ID | /?page=... | /?cat=<category>
"use client";

import { useEffect } from "react";
import { create } from "zustand";

export type Route =
  | { name: "home"; category?: string }
  | { name: "search"; q: string }
  | { name: "watch"; v: string; t?: number }
  | { name: "channel"; id: string }
  | { name: "subscriptions" }
  | { name: "shorts"; id?: string }
  | { name: "playlist"; id: string }
  | { name: "history" }
  | { name: "liked" }
  | { name: "later" }
  | { name: "playlists" }
  | { name: "compat"; id: string }
  | { name: "downloads" }
  | { name: "settings" };

export function parseRoute(): Route {
  if (typeof window === "undefined") return { name: "home" };
  const p = new URLSearchParams(window.location.search);
  if (p.has("v")) return { name: "watch", v: p.get("v") || "", t: p.has("t") ? Number(p.get("t")) || 0 : 0 };
  if (p.has("q")) return { name: "search", q: p.get("q") || "" };
  if (p.has("channel")) return { name: "channel", id: p.get("channel") || "" };
  if (p.has("cat")) return { name: "home", category: p.get("cat") || "all" };
  const page = p.get("page");
  switch (page) {
    case "subscriptions": return { name: "subscriptions" };
    case "shorts": return { name: "shorts", id: p.get("id") || undefined };
    case "playlist": return p.get("id") ? { name: "playlist", id: p.get("id")! } : { name: "home" };
    case "history": return { name: "history" };
    case "liked": return { name: "liked" };
    case "later": return { name: "later" };
    case "playlists": return { name: "playlists" };
    case "compat": return p.get("id") ? { name: "compat", id: p.get("id")! } : { name: "home" };
    case "downloads": return { name: "downloads" };
    case "settings": return { name: "settings" };
    default: return { name: "home" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "home": return route.category && route.category !== "all" ? `/?cat=${encodeURIComponent(route.category)}` : "/";
    case "search": return `/?q=${encodeURIComponent(route.q)}`;
    case "watch": return `/?v=${encodeURIComponent(route.v)}${route.t ? `&t=${route.t}` : ""}`;
    case "channel": return `/?channel=${encodeURIComponent(route.id)}`;
    case "shorts": return route.id ? `/?page=shorts&id=${encodeURIComponent(route.id)}` : "/?page=shorts";
    case "playlist": return `/?page=playlist&id=${encodeURIComponent(route.id)}`;
    case "compat": return `/?page=compat&id=${encodeURIComponent(route.id)}`;
    default: return `/?page=${route.name}`;
  }
}

interface RouterStore {
  route: Route;
  setRoute: (r: Route) => void;
}

export const useRouterStore = create<RouterStore>(set => ({
  route: { name: "home" },
  setRoute: r => set({ route: r }),
}));

// Sync once on module load (client-side only)
if (typeof window !== "undefined") {
  useRouterStore.getState().setRoute(parseRoute());
  window.addEventListener("popstate", () => {
    useRouterStore.getState().setRoute(parseRoute());
  });
  // Mark the boot entry as the history root for the Android hardware back
  // button (yt-backbutton.ts). If the app cold-opens on a deep route
  // (process death on /?v=…), seed a synthetic home entry UNDER the current
  // one so hardware back lands on the home feed first, then exits — the
  // YouTube navigation contract.
  try {
    const bootUrl = window.location.pathname + window.location.search;
    window.history.replaceState({ ytRoot: true }, "", "/");
    if (bootUrl !== "/" && bootUrl !== "") window.history.pushState({ yt: true }, "", bootUrl);
  } catch { /* SSR / tests */ }
}

export function useRouter() {
  const route = useRouterStore(s => s.route);
  const setRoute = useRouterStore(s => s.setRoute);

  useEffect(() => {
    // ensure store matches URL on first mount of each consumer
    const current = parseRoute();
    const stored = useRouterStore.getState().route;
    if (JSON.stringify(current) !== JSON.stringify(stored)) setRoute(current);
     
  }, []);

  const navigate = (r: Route, replace = false) => {
    const url = href(r);
    // entries carry { yt: true } so the Android back handler can tell
    // in-app history from the boot root (see yt-backbutton.ts)
    if (replace) window.history.replaceState({ yt: true }, "", url);
    else window.history.pushState({ yt: true }, "", url);
    setRoute(r);
    if (!replace) window.scrollTo({ top: 0 });
  };

  return { route, navigate };
}
