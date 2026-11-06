// Android hardware back button — the YouTube navigation contract.
//
// Without @capacitor/app installed, Capacitor 7 has NO back interception at
// all: BridgeActivity's default onBackPressed finishes the activity, so the
// hardware back button MINIMIZES the app instead of navigating back (the
// exact bug this module fixes). The contract it implements:
//
//   1. an open overlay (search, sheets, menus, panels) closes first — LIFO
//   2. otherwise in-app history goes back one route (watch → home, …)
//   3. at the root, back exits the app (YouTube's behavior on the home feed)
//
// Overlays register closers via useBackGuard() while open; the router marks
// the boot entry so "at root" is knowable even after process death.

"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { AppPlugin } from "@capacitor/app";

// ---- overlay registry (LIFO) --------------------------------------------
interface BackGuardState {
  closers: Map<string, () => void>;
  register: (id: string, close: () => void) => void;
  unregister: (id: string) => void;
}
export const useBackGuardStore = create<BackGuardState>(set => ({
  closers: new Map(),
  register: (id, close) =>
    set(s => {
      const m = new Map(s.closers);
      m.set(id, close);
      return { closers: m };
    }),
  unregister: id =>
    set(s => {
      if (!s.closers.has(id)) return s;
      const m = new Map(s.closers);
      m.delete(id);
      return { closers: m };
    }),
}));

/** Overlay components call this while open; their close runs on hardware
 *  back before any navigation happens. */
export function useBackGuard(id: string, active: boolean, close: () => void) {
  const register = useBackGuardStore(s => s.register);
  const unregister = useBackGuardStore(s => s.unregister);
  useEffect(() => {
    if (!active) return;
    register(id, close);
    return () => unregister(id);
  }, [id, active, register, unregister]);
}

// ---- the listener (mounted once, in AppShell) ----------------------------
let appPlugin: AppPlugin | null = null;
function getApp(): AppPlugin | null {
  if (typeof window === "undefined") return null;
  if (appPlugin !== null) return appPlugin;
  if (!Capacitor.isNativePlatform()) return null;
  appPlugin = registerPlugin<AppPlugin>("App");
  return appPlugin;
}

export function isAndroidBackActive(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function mountBackButton(): () => void {
  const app = getApp();
  if (!app) return () => {};

  let handle: { remove: () => Promise<void> } | null = null;
  app.addListener("backButton", () => {
    // 1) overlays close first (LIFO)
    const closers = useBackGuardStore.getState().closers;
    const last = [...closers.entries()].pop();
    if (last) {
      last[1]();
      return;
    }
    // 2) in-app history: entries pushed by the router carry { yt: true };
    //    the boot/root entry carries { ytRoot: true }
    const st = window.history.state as { yt?: boolean; ytRoot?: boolean } | null;
    if (st && st.yt && !st.ytRoot) {
      window.history.back();
      return;
    }
    // 3) at root — exit like YouTube
    app.exitApp().catch(() => {});
  }).then(h => { handle = h; }).catch(() => {});

  return () => { handle?.remove().catch(() => {}); };
}
