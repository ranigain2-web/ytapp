#!/bin/bash
# start-stack.sh — idempotent launcher for the ytapp backend stack.
# Ensures BOTH services are running (detached via setsid so they survive reapers):
#   1. pot-provider (bgutil PO-token server)  → 127.0.0.1:4416
#   2. yt-api (YouTube API gateway)           → 0.0.0.0:3001
# Usage:   bash /home/z/my-project/scripts/start-stack.sh
# Auto-run: sandbox boot via mini-services/yt-api shim (.zscripts/dev.sh scans it).
# Production overrides (Electron / Docker / Railway): PORT, BGUTIL_URL, URL_SUFFIX, STATIC_DIR, PUBLIC_URL, YOUTUBE_COOKIE.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POT_DIR="$ROOT/pot-provider"
API_DIR="$ROOT/server"
POT_LOG="$POT_DIR/pot-server.log"
API_LOG="$API_DIR/server.log"

wait_for() { # $1=url  $2=grep-pattern  $3=timeout-secs
  local i
  for i in $(seq 1 "${3:-30}"); do
    sleep 1
    if curl -s -m 2 "$1" 2>/dev/null | grep -q "$2"; then echo "READY after ${i}s: $1"; return 0; fi
  done
  echo "WARNING: $1 not ready after ${3:-30}s"; return 1
}

# --- 1. pot-provider (PO tokens; needed by yt-api for stream extraction) ---
if ! curl -s -m 2 http://127.0.0.1:4416/ping 2>/dev/null | grep -q "server_uptime"; then
  echo "Starting pot-provider (bgutil) on :4416..."
  mkdir -p "$POT_DIR"
  (
    setsid bash -c "cd '$POT_DIR' && exec node build/main.js >> '$POT_LOG' 2>&1" &
  )
  wait_for http://127.0.0.1:4416/ping server_uptime 90 || tail -5 "$POT_LOG" 2>/dev/null
else
  echo "pot-provider already running on :4416"
fi

# --- 2. yt-api (Express gateway: /api/* + optional static frontend) ---
if ! curl -s -m 2 http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"ok":true'; then
  echo "Starting yt-api on :3001..."
  mkdir -p "$API_DIR"
  (
    setsid bash -c "cd '$API_DIR' && exec node index.mjs >> '$API_LOG' 2>&1" &
  )
  wait_for http://127.0.0.1:3001/api/health '"ok":true' 45 || tail -5 "$API_LOG" 2>/dev/null
else
  echo "yt-api already running on :3001"
fi

echo "--- health ---"
curl -s -m 3 http://127.0.0.1:3001/api/health; echo
