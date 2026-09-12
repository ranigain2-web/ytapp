#!/bin/bash
# test-electron-bundle.sh — E2E test of the packaged desktop app's runtime path.
# Reproduces EXACTLY what electron/main.cjs does when the .app launches:
#   1. spawns pot-provider (bgutil) as a plain Node child on a test port
#   2. spawns yt-api with URL_SUFFIX="" + STATIC_DIR=out (serving the frontend)
#   3. verifies: frontend serves, API healthy, HLS manifest rewritten to the
#      local origin, and video segment bytes stream with Range/206.
# Usage: bash /home/z/my-project/scripts/test-electron-bundle.sh
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POT_PORT=4419
API_PORT=3002
FAIL=0

step() { echo; echo "==> $1"; }
check() { # $1 = description, $2 = haystack, $3 = needle
  if echo "$2" | grep -q "$3"; then echo "    PASS: $1"; else echo "    FAIL: $1"; FAIL=1; fi
}

# --- start pot-provider on 4419 ---
step "spawn pot-provider on :$POT_PORT (like the .app does)"
(cd "$ROOT/pot-provider" && setsid node build/main.js --port $POT_PORT > /tmp/pot-e2e.log 2>&1 &)
for i in $(seq 1 60); do
  curl -s -m 2 http://127.0.0.1:$POT_PORT/ping 2>/dev/null | grep -q server_uptime && break
  sleep 1
done
PONG=$(curl -s -m 3 http://127.0.0.1:$POT_PORT/ping)
check "pot-provider healthy" "$PONG" "server_uptime"

# --- start yt-api on 3002 with STATIC_DIR ---
step "spawn yt-api on :$API_PORT with URL_SUFFIX='' + STATIC_DIR=out"
(cd "$ROOT/server" && setsid env PORT=$API_PORT URL_SUFFIX="" STATIC_DIR="$ROOT/out" \
  node index.mjs > /tmp/api-e2e.log 2>&1 &)
for i in $(seq 1 45); do
  curl -s -m 2 http://127.0.0.1:$API_PORT/api/health 2>/dev/null | grep -q '"ok":true' && break
  sleep 1
done
HEALTH=$(curl -s -m 3 http://127.0.0.1:$API_PORT/api/health)
check "yt-api healthy" "$HEALTH" '"ok":true'

# --- frontend served ---
step "frontend served by yt-api (packaged layout)"
INDEX=$(curl -s -m 5 http://127.0.0.1:$API_PORT/)
check "index.html served" "$INDEX" "<title>YouTube</title>"
ASSET=$(echo "$INDEX" | grep -oE '/_next/static/[^"]+\.js' | head -1)
if [ -n "$ASSET" ]; then
  CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$API_PORT$ASSET")
  check "static asset 200 ($ASSET)" "$CODE" "200"
else
  echo "    FAIL: no _next static asset found in index.html"; FAIL=1
fi

# --- video metadata + streams ---
step "video metadata + stream extraction (PO-token path)"
VID=$(curl -s -m 60 "http://127.0.0.1:$API_PORT/api/video/dQw4w9WgXcQ")
check "video title" "$VID" "Never Gonna Give You Up"
check "formats present" "$VID" '"formats"'
echo "$VID" | grep -q '"hls":"/api/hls/dQw4w9WgXcQ' && echo "    PASS: hls manifest path (relative, same-origin)" || { echo "    FAIL: hls path unexpected"; echo "$VID" | grep -o '"hls":"[^"]*"' | head -1; FAIL=1; }

# --- HLS manifest rewritten to local origin ---
step "HLS manifest (URLs must resolve to the local yt-api origin)"
sleep 2 # allow manifest cache write
M3U8=$(curl -s -m 30 "http://127.0.0.1:$API_PORT/api/hls/dQw4w9WgXcQ")
check "manifest is HLS" "$M3U8" "#EXTM3U"
check "manifest has variant streams" "$M3U8" "#EXT-X-STREAM-INF"

abs() { # $1 = url (relative or absolute) → absolute against the local yt-api
  case "$1" in
    http*) echo "$1" ;;
    *) echo "http://127.0.0.1:$API_PORT$1" ;;
  esac
}

# hls.js flow: master → first variant sub-playlist → first media segment → bytes
VARIANT=$(echo "$M3U8" | grep -oE '(/api/segment\?u=[^" ]+|https?://[^" ]+)' | head -1)
if [ -n "$VARIANT" ]; then
  VURL=$(abs "$VARIANT")
  check "variant URL resolves to local origin" "$VURL" "127.0.0.1:$API_PORT"
  step "fetch variant sub-playlist (recursive rewrite path)"
  SUB=$(curl -s -m 30 "$VURL")
  check "variant playlist is HLS" "$SUB" "#EXTM3U"
  MEDIA=$(echo "$SUB" | grep -oE '(/api/segment\?u=[^" ]+|https?://[^" ]+)' | head -1)
  if [ -n "$MEDIA" ]; then
    MURL=$(abs "$MEDIA")
    check "media segment URL resolves to local origin" "$MURL" "127.0.0.1:$API_PORT"
    step "media segment byte streaming (200/206 both valid — hls.js fetches full segments)"
    SEGCODE=$(curl -s -m 30 -o /dev/null -w "%{http_code} %{size_download}" -H "Range: bytes=0-65535" "$MURL")
    check "segment streams with bytes (upstream decides 200 vs 206)" "$SEGCODE" "^\(200\|206\) [1-9]"
    SEGTYPE=$(curl -s -m 30 -o /dev/null -w "%{content_type}" -H "Range: bytes=0-65535" "$MURL")
    check "segment is video/audio bytes" "$SEGTYPE" "video/\|audio/\|application/octet-stream"
  else
    echo "    FAIL: no media segment in variant playlist"; FAIL=1
  fi
else
  echo "    FAIL: no variant URL in master manifest"; FAIL=1
fi

# --- cleanup ---
pkill -f "port $POT_PORT" 2>/dev/null
PIDS=$(ss -tlnp 2>/dev/null | grep ":$API_PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2)
[ -n "$PIDS" ] && kill $PIDS 2>/dev/null

echo
if [ "$FAIL" = "0" ]; then
  echo "=============================================================="
  echo "ALL ELECTRON-BUNDLE E2E TESTS PASSED ✅  (packaged runtime path proven)"
  echo "=============================================================="
else
  echo "=============================================================="
  echo "SOME TESTS FAILED ❌ — see /tmp/pot-e2e.log + /tmp/api-e2e.log"
  echo "=============================================================="
  tail -5 /tmp/pot-e2e.log 2>/dev/null; tail -5 /tmp/api-e2e.log 2>/dev/null
fi
exit $FAIL
