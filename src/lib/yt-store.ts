// Local persistence: subscriptions, watch history, likes, watch later, playlists, settings
"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface HistoryEntry {
  id: string;
  title: string;
  channel: string;
  channel_id: string;
  thumb: string;
  views: string;
  duration: string;
  published: string;
  progress?: number; // seconds watched
  length?: number; // total seconds
  watchedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  videoIds: string[];
  createdAt: number;
}

interface YtStore {
  // Subscribed channels
  subs: { id: string; name: string; avatar: string; subscribers: string }[];
  toggleSub: (ch: { id: string; name: string; avatar: string; subscribers: string }) => void;
  isSubbed: (id: string) => boolean;

  // Watch history
  history: HistoryEntry[];
  addHistory: (e: Omit<HistoryEntry, "watchedAt">) => void;
  setProgress: (id: string, progress: number, length: number) => void;
  clearHistory: () => void;
  removeHistory: (id: string) => void;

  // Likes
  liked: HistoryEntry[];
  toggleLike: (e: Omit<HistoryEntry, "watchedAt">) => void;
  isLiked: (id: string) => boolean;

  // Watch later
  later: HistoryEntry[];
  toggleLater: (e: Omit<HistoryEntry, "watchedAt">) => void;
  isLater: (id: string) => boolean;

  // Playlists
  playlists: Playlist[];
  createPlaylist: (name: string) => string;
  addToPlaylist: (playlistId: string, videoId: string) => void;
  removeFromPlaylist: (playlistId: string, videoId: string) => void;
  deletePlaylist: (playlistId: string) => void;

  // Dislikes (local only)
  disliked: string[];
  toggleDislike: (id: string) => void;
  isDisliked: (id: string) => boolean;

  // Preferences
  prefs: {
    sponsorblock: boolean;
    autoplay: boolean;
    defaultQuality: "auto" | number;
    cinemaMode: boolean;
  };
  setPrefs: (p: Partial<YtStore["prefs"]>) => void;
}

const entry = (e: Omit<HistoryEntry, "watchedAt">): HistoryEntry => ({ ...e, watchedAt: Date.now() });

export const useYt = create<YtStore>()(
  persist(
    (set, get) => ({
      subs: [],
      toggleSub: (ch) => {
        const { subs } = get();
        if (subs.some(s => s.id === ch.id)) set({ subs: subs.filter(s => s.id !== ch.id) });
        else set({ subs: [ch, ...subs] });
      },
      isSubbed: (id) => get().subs.some(s => s.id === id),

      history: [],
      addHistory: (e) => {
        const { history } = get();
        const he = entry(e);
        set({ history: [he, ...history.filter(h => h.id !== e.id)].slice(0, 500) });
      },
      setProgress: (id, progress, length) => {
        const { history } = get();
        set({ history: history.map(h => (h.id === id ? { ...h, progress, length } : h)) });
      },
      clearHistory: () => set({ history: [] }),
      removeHistory: (id) => set({ history: get().history.filter(h => h.id !== id) }),

      liked: [],
      toggleLike: (e) => {
        const { liked } = get();
        if (liked.some(l => l.id === e.id)) set({ liked: liked.filter(l => l.id !== e.id), disliked: get().disliked.filter(d => d !== e.id) });
        else set({ liked: [entry(e), ...liked], disliked: get().disliked.filter(d => d !== e.id) });
      },
      isLiked: (id) => get().liked.some(l => l.id === id),

      later: [],
      toggleLater: (e) => {
        const { later } = get();
        if (later.some(l => l.id === e.id)) set({ later: later.filter(l => l.id !== e.id) });
        else set({ later: [entry(e), ...later] });
      },
      isLater: (id) => get().later.some(l => l.id === id),

      playlists: [],
      createPlaylist: (name) => {
        const id = `pl_${Date.now()}`;
        set({ playlists: [{ id, name, videoIds: [], createdAt: Date.now() }, ...get().playlists] });
        return id;
      },
      addToPlaylist: (playlistId, videoId) => {
        set({
          playlists: get().playlists.map(p =>
            p.id === playlistId && !p.videoIds.includes(videoId) ? { ...p, videoIds: [videoId, ...p.videoIds] } : p
          ),
        });
      },
      removeFromPlaylist: (playlistId, videoId) => {
        set({ playlists: get().playlists.map(p => (p.id === playlistId ? { ...p, videoIds: p.videoIds.filter(v => v !== videoId) } : p)) });
      },
      deletePlaylist: (playlistId) => set({ playlists: get().playlists.filter(p => p.id !== playlistId) }),

      disliked: [],
      toggleDislike: (id) => {
        const { disliked, liked } = get();
        if (disliked.includes(id)) set({ disliked: disliked.filter(d => d !== id) });
        else set({ disliked: [id, ...disliked], liked: liked.filter(l => l.id !== id) });
      },
      isDisliked: (id) => get().disliked.includes(id),

      prefs: {
        sponsorblock: true,
        autoplay: true,
        defaultQuality: "auto",
        cinemaMode: false,
      },
      setPrefs: (p) => set({ prefs: { ...get().prefs, ...p } }),
    }),
    {
      name: "yt-app-store",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
