"use client";

// CompatPage — the Compat Mode surface (Phase 2, C-01/C-04/C-05).
//
// The actual video plays in the NATIVE WebView the YtCompat plugin overlays
// on top of the app; this React page is the control room behind it: it opens
// the WebView with the injection, relays player state into the background
// service (lock-screen notification), forwards notification controls into
// YouTube's player, shares session cookies with the user's server (opt-in),
// and owns the kill-switch (the injected "back to ytapp" pill and the
// notification's Close both land here).

import { useEffect, useState } from "react";
import { useRouter } from "@/lib/yt-router";
import { useYt } from "@/lib/yt-store";
import { isCompatAvailable, compatOpen, compatClose, addCompatListener, compatControls, type YtCompatMessage } from "@/lib/yt-compat";
import { nativeBackgroundEnable, nativeBackgroundUpdate, nativeBackgroundDisable, addControlListener } from "@/lib/yt-native";
import { setServerCookie } from "@/lib/yt-api";
import { AlertTriangle, ShieldAlert } from "lucide-react";

export default function CompatPage({ videoId }: { videoId: string }) {
  const navigate = useRouter().navigate;
  const shareCookies = useYt(s => s.prefs.compatShareCookies);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("opening compat player…");

  useEffect(() => {
    if (!isCompatAvailable()) return;
    let alive = true;
    let msgHandle: { remove: () => Promise<void> } | null = null;
    let offControl: (() => void) | null = null;
    let backgroundStarted = false;

    const exit = () => {
      compatClose().catch(() => {});
      nativeBackgroundDisable();
      navigate({ name: "watch", v: videoId });
    };

    addCompatListener((m: YtCompatMessage) => {
      if (!alive) return;
      if (m.type === "media") {
        setStatus(m.playing ? "playing (compat)" : "paused (compat)");
        nativeBackgroundUpdate({
          playing: !!m.playing,
          position: m.position || 0,
          duration: m.duration || 0,
        });
      } else if (m.type === "cookies") {
        // C-07: the compat session's cookies (the user may even be signed in
        // to YouTube inside compat mode) go to THEIR OWN server — the toggle
        // lives next to this in Settings.
        if (shareCookies && m.value) {
          setServerCookie(m.value).catch(() => { /* server absent: fine */ });
        }
      } else if (m.type === "close") {
        exit();
      } else if (m.type === "hookfail") {
        console.warn("[compat] hook failed:", m.hook, m.detail);
      }
    }).then(h => { if (alive) msgHandle = h; else h.remove(); }).catch(() => {});

    offControl = addControlListener((ev) => {
      if (ev.action === "play") compatControls.play().catch(() => {});
      else if (ev.action === "pause") compatControls.pause().catch(() => {});
      else if (ev.action === "seek" && typeof ev.seekTo === "number") compatControls.seek(ev.seekTo).catch(() => {});
      else if (ev.action === "stop") exit();
    });

    compatOpen(videoId)
      .then(() => {
        if (!alive) return;
        backgroundStarted = true;
        return nativeBackgroundEnable({ title: "Compat Mode", artist: "YouTube (compat surface)" });
      })
      .catch((e: unknown) => {
        if (alive) setErr(String((e as Error)?.message || e));
      });

    return () => {
      alive = false;
      msgHandle?.remove().catch(() => {});
      offControl?.();
      compatClose().catch(() => {});
      if (backgroundStarted) nativeBackgroundDisable();
    };
  }, [videoId, navigate, shareCookies]);

  if (!isCompatAvailable()) {
    return (
      <div className="px-6 py-16 max-w-[560px] mx-auto text-center">
        <ShieldAlert className="w-10 h-10 mx-auto mb-4 text-[var(--yt-text-2)]" />
        <h1 className="text-[20px] font-medium mb-2">Compat Mode needs the Android app</h1>
        <p className="text-[14px] text-[var(--yt-text-2)] leading-relaxed mb-6">
          Compat Mode plays a server-gated video inside YouTube&apos;s own mobile site in a native
          WebView that ytapp can control — browsers cannot script a cross-origin page, so this
          surface exists only in the Android build. On this device the video keeps playing through
          the standard embed fallback.
        </p>
        <button onClick={() => navigate({ name: "home" })} className="px-5 py-2.5 rounded-full bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)] text-[14px] font-medium">
          Go to home
        </button>
      </div>
    );
  }

  // The native WebView covers the screen while compat runs; everything below
  // is the failure/teardown surface (visible only when open() fails or the
  // user lands here with a dead WebView).
  return (
    <div className="px-6 py-16 max-w-[560px] mx-auto text-center" data-testid="compat-page">
      {err ? (
        <>
          <AlertTriangle className="w-10 h-10 mx-auto mb-4 text-[var(--yt-status-warn)]" />
          <h1 className="text-[20px] font-medium mb-2">Compat player failed to open</h1>
          <p className="text-[13px] text-[var(--yt-text-2)] mb-6">{err}</p>
          <button onClick={() => navigate({ name: "watch", v: videoId })} className="px-5 py-2.5 rounded-full bg-[var(--yt-invert-bg)] text-[var(--yt-invert-text)] text-[14px] font-medium">
            Back to the video
          </button>
        </>
      ) : (
        <>
          <p className="text-[13px] text-[var(--yt-text-2)] mb-2" data-testid="compat-status">{status}</p>
          <p className="text-[12px] text-[var(--yt-text-2)] leading-relaxed">
            This is YouTube&apos;s real mobile site in a controlled frame: ads are stripped where
            possible and background play is enforced. The &quot;back to ytapp&quot; pill or the
            notification&apos;s Close returns here. {shareCookies ? "This session's cookies are shared with your server." : "Cookie sharing is off (Settings)."}
          </p>
        </>
      )}
    </div>
  );
}
