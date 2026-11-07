# Phase 3 — Downloads v1 (v2.6.0)

- **Date:** 2026-11-07
- **Author:** ytapp development agent (master plan §8)
- **Status:** Implemented — gate pending
- **Components:** `server/index.mjs` (download manager + routes), `src/lib/yt-api.ts`, `src/components/yt/{DownloadSheet,DownloadsPage,WatchPage,Sidebar,AppShell}.tsx`, `src/lib/yt-router.ts`, `scripts/e2e-download.mjs`

## The Problem

The app can play everything but save nothing. For a household media client
that is a core gap: offline listening, keeping a video the server keeps
re-extracting, archiving before something disappears. The research's
conclusion was unambiguous: no in-process extractor matches yt-dlp's
anti-gating arsenal (client rotation, cookies, PO tokens), so downloads
delegate to it as a sidecar process on the server.

## Overview

A server-side yt-dlp manager with a 2-slot queue: the app requests a
download (video ≤720p MP4 mux or audio M4A), the server spawns yt-dlp with
the active cookie jar (runtime cookie from Phase 1 / compat cookies from
Phase 2), parses its `--newline` progress output, and records status. Every
endpoint is session-bound (a token minted per browser session — decision D3:
the server is a trusted-LAN appliance; the token prevents other LAN devices
from enumerating or hijacking downloads without consent). Finished files
live in a configurable `DOWNLOAD_DIR` and stream back as attachments for
browser saving; cancellation kills the process and cleans partial files.

## Goals / Non-Goals

Goals: one-click download from the watch page with honest progress; a
downloads manager page (queue/running/done/failed, cancel/remove/save);
gated videos download through the same cookie jar extraction uses; muxed
MP4 via ffmpeg when available, graceful audio-only degradation when not.
Non-goals: on-device Android file saving (the file lands on the user's
server; "save" streams it to any browser), subtitle downloads, format
pickers beyond video/audio v1, resumable partial downloads.

## Technical Plan (as built)

- Manager: `spawn(yt-dlp, [...])` with `-f bv*[height<=720]+ba/b` (video) or
  `bestaudio[ext=m4a]/bestaudio` (audio), `--merge-output-format mp4`,
  `--newline --no-playlist --no-cache-dir`, `-o <dir>/<downloadId>.%(ext)s`,
  `--print after_move:filepath --no-simulate` for final-file discovery, and
  the active cookie via `--add-header`. Progress from `[download]  N%` lines;
  exit code 0 → done (file, size), non-zero → failed (last stderr line as
  the error), SIGTERM → cancelled (partial file removed).
- Queue: at most 2 concurrent yt-dlp processes; the rest wait as `queued`.
- Routes: `GET /api/download/session` (mint token), then `POST start`,
  `GET list`, `POST cancel`, `POST remove`, `GET file/:id` — every one
  except session requires the `X-DL-Token` header (401 otherwise).
- Frontend: DownloadSheet on the watch page (Video/Audio choice + start +
  toast), DownloadsPage at `?page=downloads` with a Sidebar entry, polling
  while anything is queued/running.

## Alternatives Considered

- **In-process extraction + HTTP proxy save.** Rejected: the app already
  knows how hollow gated extraction is; yt-dlp's rotation is the proven
  path, and a subprocess crash can never take the API server down.
- **Client-side download (browser fetches streams and muxes).** Rejected:
  no ffmpeg in the browser path, double the bandwidth, and the server
  already holds the cookie jar.
- **Persistent accounts/multi-user queue.** Rejected for v1: one household,
  one token per browser session; recorded as a non-goal.

## Verification (gate)

1. tsc 0; build:static green; existing suites unchanged.
2. `scripts/e2e-download.mjs` against the real sidecar: auth (401 without
   token), audio download of the battery's reliably-extractable video to
   done with bytes on disk, muxed MP4 download (SKIP-with-reason if ffmpeg
   or gating blocks it — battery semantics), cancel path leaves no orphan
   record, remove deletes file + record.
3. Bundle test ALL PASS (backend changed — the repo rule).
4. Device/production note: yt-dlp and ffmpeg must exist on the server host
   (`YT_DLP_BIN` overridable); the sandbox gate proves the wiring on this
   worst-case IP for at least the audio path.
