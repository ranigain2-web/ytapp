// yt-subs-feed — phase 4: the ONE shared subscriptions fetch.
//
// The design review demanded a budget here: a single-flight cached fetch
// (TTL 20 min, stale-while-revalidate) that feeds BOTH the subscriptions
// page and the notification badge — opening the drawer must not refetch the
// world. Concurrency cap 4 channels in flight, Promise.allSettled per
// channel (one dead channel never fails the feed — it gets an error chip),
// progressive render as results land, cap 3 videos per channel.

"use client";

import { create } from "zustand";
import { fetchChannel, type YtVideo } from "./yt-api";
import { useYt } from "./yt-store";

export interface SubsFeedItem {
  video: YtVideo;
  channelId: string;
  channelName: string;
  avatar: string;
  /** rough day bucket from publishedTimeText (0 = today) */
  ageDays: number;
}

export interface SubsFeedError {
  channelId: string;
  channelName: string;
  message: string;
}

const TTL_MS = 20 * 60 * 1000;
const PER_CHANNEL_CAP = 3;
const CONCURRENCY = 4;

/** "3 days ago" / "2 weeks ago" / "Streamed 1 year ago" → rough day bucket */
export function publishedAgeDays(text: string): number {
  const m = /(\d+)\s+(second|minute|hour|day|week|month|year)/i.exec(text || "");
  if (!m) return 9999; // "16 years ago" no match → very old; missing → unknown-but-old
  const n = parseInt(m[1], 10);
  if (/second|minute|hour/i.test(m[2])) return 0;
  if (/day/i.test(m[2])) return n;
  if (/week/i.test(m[2])) return n * 7;
  if (/month/i.test(m[2])) return n * 30;
  return n * 365;
}

interface SubsFeedStore {
  items: SubsFeedItem[];
  errors: SubsFeedError[];
  loading: boolean;
  fetchedAt: number;
  /** single-flight: the in-progress promise (not part of state) */
  ensure: (opts?: { force?: boolean }) => void;
}

let inflight: Promise<void> | null = null;

async function fetchAll(): Promise<void> {
  const subs = useYt.getState().subs;
  const items: SubsFeedItem[] = [];
  const errors: SubsFeedError[] = [];

  const publish = () => {
    // progressive render: re-sort + publish whatever has landed so far
    useSubsFeed.setState({ items: [...items].sort(cmp), errors: [...errors] });
  };

  // cap-4 worker pool over channels (allSettled isolation: a dead channel
  // records an error and never fails the feed)
  const queue = [...subs];
  const worker = async () => {
    while (queue.length) {
      const ch = queue.shift()!;
      try {
        const info = await fetchChannel(ch.id);
        const videos = (info.videos || [])
          .filter(v => v.id && !v.is_live)
          .slice(0, PER_CHANNEL_CAP);
        for (const v of videos) {
          items.push({
            video: v,
            channelId: ch.id,
            channelName: info.name || ch.name,
            avatar: info.avatar || ch.avatar,
            ageDays: publishedAgeDays(v.published),
          });
        }
      } catch (e) {
        errors.push({
          channelId: ch.id,
          channelName: ch.name,
          message: e instanceof Error ? e.message : "unavailable",
        });
      }
      publish();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, worker));

  useSubsFeed.setState({ items: [...items].sort(cmp), errors: [...errors], loading: false, fetchedAt: Date.now() });
}

// day-granularity ordering (the API gives nothing finer — documented)
const cmp = (a: SubsFeedItem, b: SubsFeedItem) =>
  a.ageDays - b.ageDays || a.channelName.localeCompare(b.channelName);

export const useSubsFeed = create<SubsFeedStore>()((set, get) => ({
  items: [],
  errors: [],
  loading: false,
  fetchedAt: 0,
  ensure: ({ force = false } = {}) => {
    const { loading, fetchedAt } = get();
    const fresh = fetchedAt && Date.now() - fetchedAt < TTL_MS;
    if (inflight) return; // single-flight
    if (loading) return;
    if (fresh && !force) return;
    set({ loading: true, ...(force || !fetchedAt ? { items: [], errors: [] } : {}) });
    inflight = fetchAll().finally(() => { inflight = null; });
  },
}));

// ----------------------------------------------------------------------------
// Notification memory (local, honest): "new since you last looked".
// A video is new if it is in the current feed but wasn't in the seen-set.
// ----------------------------------------------------------------------------

const SEEN_KEY = "yt_subs_seen";
const LAST_VISIT_KEY = "yt_subs_last_visit";

export function readSeenSet(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const list = raw ? JSON.parse(raw) as string[] : [];
    return new Set(Array.isArray(list) ? list.slice(-2000) : []);
  } catch { return new Set(); }
}

export function getUnseenItems(): SubsFeedItem[] {
  const seen = readSeenSet();
  return useSubsFeed.getState().items.filter(i => !seen.has(i.video.id));
}

export function markAllSeen() {
  const seen = readSeenSet();
  for (const i of useSubsFeed.getState().items) seen.add(i.video.id);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-2000)));
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  } catch { /* ignore */ }
}
