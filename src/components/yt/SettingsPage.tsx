"use client";

import { useEffect, useState } from "react";
import { getApiBase, setApiBase, fetchHealth, getActiveSourceLabel, invalidateDataSource, resolveDataSource } from "@/lib/yt-api";
import { useYt } from "@/lib/yt-store";
import { applyTheme, watchSystemTheme, type ThemeMode } from "@/lib/yt-theme";
import { APP_VERSION } from "@/lib/version";
import { isNativeApp } from "@/lib/yt-native";
import { Check, X, RefreshCw, Globe, Server, Smartphone, Moon, Sun, Monitor, Headphones, PlayCircle } from "lucide-react";

function Toggle({ label, desc, value, onChange, labelIcon }: { label: string; desc: string; value: boolean; onChange: (v: boolean) => void; labelIcon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-[var(--yt-border)]">
      <div>
        <p className="text-[15px] text-[var(--yt-text)] flex items-center gap-2">{labelIcon}{label}</p>
        <p className="text-[13px] text-[var(--yt-text-2)] mt-0.5">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={`w-11 h-6 rounded-full relative shrink-0 transition-colors ${value ? "bg-[var(--yt-blue)]" : "bg-[#555]"}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [apiBase, setApiBaseInput] = useState(() => getApiBase());
  const [health, setHealth] = useState<{ ok: boolean; po_token: boolean; uptime: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string>("checking…");
  const prefs = useYt(s => s.prefs);
  const setPrefs = useYt(s => s.setPrefs);
  const clearHistory = useYt(s => s.clearHistory);

  // theme: apply on change + follow the OS when set to "system"
  useEffect(() => {
    applyTheme(prefs.theme);
    return watchSystemTheme(() => prefs.theme);
  }, [prefs.theme]);

  const refreshSource = () => {
    setSourceLabel("checking…");
    invalidateDataSource();
    resolveDataSource()
      .then(() => setSourceLabel(getActiveSourceLabel()))
      .catch(() => setSourceLabel("not connected"));
  };

  useEffect(() => {
    let alive = true;
    invalidateDataSource();
    resolveDataSource()
      .then(() => { if (alive) setSourceLabel(getActiveSourceLabel()); })
      .catch(() => { if (alive) setSourceLabel("not connected"); });
    fetchHealth().then(h => { if (alive) setHealth(h); }).catch(() => { if (alive) setHealth(null); });
    return () => { alive = false; };
  }, []);

  const save = () => {
    setApiBase(apiBase);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const test = async () => {
    setTesting(true);
    try {
      setApiBase(apiBase);
      setHealth(await fetchHealth());
    } catch {
      setHealth(null);
    }
    setTesting(false);
  };

  return (
    <div className="px-2 sm:px-6 pb-16 pt-2 max-w-[720px]">
      <h1 className="text-[24px] sm:text-[36px] font-bold mb-8">Settings</h1>

      {/* Data source */}
      <section className="mb-10">
        <h2 className="text-[16px] font-medium mb-4">Data source</h2>
        <div className="rounded-xl bg-[var(--yt-elev2-60)] p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {sourceLabel.startsWith("community") ? <Globe className="w-5 h-5 text-[#ffb13b] shrink-0" />
                : sourceLabel.startsWith("on-device") ? <Smartphone className="w-5 h-5 text-[#2ba640] shrink-0" />
                : <Server className="w-5 h-5 text-[var(--yt-blue)] shrink-0" />}
              <div className="min-w-0">
                <p className="text-[14px] text-[var(--yt-text)] truncate">{sourceLabel}</p>
                <p className="text-[12px] text-[var(--yt-text-2)] mt-0.5">Active source for search, feeds and video pages</p>
              </div>
            </div>
            <button onClick={refreshSource} className="flex items-center gap-2 h-9 px-4 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[13px] shrink-0">
              <RefreshCw className="w-4 h-4" /> Check now
            </button>
          </div>
          <p className="text-[12px] leading-[18px] text-[var(--yt-text-2)] mt-3">
            On this device the app talks to YouTube directly — no companion server or proxy needed.
            Your own server is optional: it unlocks ad-free direct streams in every video.
            Community servers are a last-resort fallback for browsers.
          </p>
        </div>
      </section>

      {/* API server (optional) */}
      <section className="mb-10">
        <h2 className="text-[16px] font-medium mb-4">Your server (optional)</h2>
        <div className="rounded-xl bg-[var(--yt-elev2-60)] p-4">
          <label htmlFor="api-base" className="block text-[13px] text-[var(--yt-text-2)] mb-2">
            Backend URL — leave empty to stay fully on-device. Setting a server unlocks ad-free direct streams.
          </label>
          <div className="flex gap-2">
            <input
              id="api-base"
              value={apiBase}
              onChange={(e) => setApiBaseInput(e.target.value)}
              placeholder="https://your-api.example.com"
              className="flex-1 h-10 px-4 rounded-lg bg-[var(--yt-bg-input)] border border-[var(--yt-border)] text-[14px] outline-none focus:border-[var(--yt-blue)]"
            />
            <button onClick={save} className="h-10 px-5 rounded-full bg-[var(--yt-blue)] text-[var(--yt-blue-contrast)] text-[14px] font-medium shrink-0">
              {saved ? <Check className="w-4 h-4" /> : "Save"}
            </button>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={test} className="flex items-center gap-2 h-8 px-4 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[13px]" disabled={testing}>
              {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : null} Test connection
            </button>
            {health && (
              <span className="flex items-center gap-2 text-[13px] text-[#2ba640]">
                <Check className="w-4 h-4" /> Connected · PO token {health.po_token ? "active" : "inactive"}
              </span>
            )}
            {health === null && !testing && (
              <span className="flex items-center gap-2 text-[13px] text-[#ff4e45]">
                <X className="w-4 h-4" /> Unreachable
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Appearance — YouTube's exact setting */}
      <section className="mb-10">
        <h2 className="text-[16px] font-medium mb-2">Appearance</h2>
        <div className="rounded-xl bg-[var(--yt-elev2-60)] p-1">
          {([
            { id: "system", label: "Use device theme", icon: Monitor },
            { id: "dark", label: "Dark theme", icon: Moon },
            { id: "light", label: "Light theme", icon: Sun },
          ] as { id: ThemeMode; label: string; icon: typeof Moon }[]).map(opt => {
            const active = prefs.theme === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                onClick={() => setPrefs({ theme: opt.id })}
                className={`w-full flex items-center gap-3 px-3.5 h-11 rounded-lg text-[14px] ${active ? "bg-[var(--yt-bg-elev2)] text-[var(--yt-text)] font-medium" : "text-[var(--yt-text)] hover:bg-[var(--yt-hover)]"}`}
                aria-pressed={active}
              >
                <Icon className="w-[18px] h-[18px] text-[var(--yt-text-2)] shrink-0" />
                {opt.label}
                {active && <Check className="w-4 h-4 ml-auto text-[var(--yt-blue)]" />}
              </button>
            );
          })}
        </div>
      </section>

      {/* Playback */}
      <section className="mb-10">
        <h2 className="text-[16px] font-medium mb-2">Playback</h2>
        {isNativeApp() && (
          <Toggle
            label="Background play"
            labelIcon={<PlayCircle className="w-4 h-4" />}
            desc="Keep playing when you switch apps or turn the screen off — a lock-screen notification with pause and skip appears while a video plays"
            value={prefs.backgroundPlay}
            onChange={v => setPrefs({ backgroundPlay: v })}
          />
        )}
        <Toggle
          label="Autoplay next video"
          desc="Automatically play the next related video when one ends"
          value={prefs.autoplay}
          onChange={v => setPrefs({ autoplay: v })}
        />
        <Toggle
          label="Audio mode (data saver)"
          labelIcon={<Headphones className="w-4 h-4" />}
          desc="Play the audio-only stream with the thumbnail on screen — uses much less data and is ideal for music and listening"
          value={prefs.audioOnly}
          onChange={v => setPrefs({ audioOnly: v })}
        />
        <Toggle
          label="SponsorBlock"
          desc="Auto-skip sponsored segments when the SponsorBlock API is reachable"
          value={prefs.sponsorblock}
          onChange={v => setPrefs({ sponsorblock: v })}
        />
      </section>

      {/* Data */}
      <section className="mb-10">
        <h2 className="text-[16px] font-medium mb-2">Your data</h2>
        <div className="flex items-center justify-between gap-6 py-4 border-b border-[var(--yt-border)]">
          <div>
            <p className="text-[15px] text-[var(--yt-text)]">Clear watch history</p>
            <p className="text-[13px] text-[var(--yt-text-2)] mt-0.5">Removes all watched videos from this device</p>
          </div>
          <button onClick={() => clearHistory()} className="h-9 px-4 rounded-full bg-[var(--yt-bg-elev2)] hover:bg-[var(--yt-hover)] text-[13px] shrink-0">
            Clear
          </button>
        </div>
      </section>

      {/* About */}
      <section>
        <h2 className="text-[16px] font-medium mb-4">About</h2>
        <div className="rounded-xl bg-[var(--yt-elev2-60)] p-4 text-[13px] text-[var(--yt-text-2)] leading-relaxed">
          <p className="text-[var(--yt-text)] text-[15px] mb-2">Ad-free YouTube client</p>
          <p className="mb-1">ytapp v{APP_VERSION}</p>
          <p>
            Streams are extracted directly via the InnerTube API with PO-token attestation and played through a
            custom HLS player — no YouTube ads, tracking, or Shorts shelf. Metadata, comments and channels are
            fetched keylessly. Subscriptions, history and playlists are stored locally on your device.
          </p>
          <p className="mt-3">
            Background play and audio mode are always on this device — YouTube Premium features, without the
            subscription. Background play applies to direct-stream videos; videos that play through the official
            YouTube embed follow YouTube's own rules.
          </p>
          <p className="mt-3">
            Note: VEVO/music-label videos may require the API to run on a residential IP (set YOUTUBE_COOKIE or a
            proxy on the server). Everything else plays ad-free.
          </p>
        </div>
      </section>
    </div>
  );
}
