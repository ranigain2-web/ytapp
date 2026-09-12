#!/bin/bash
# start-stack-docker.sh — single-container entrypoint for the ytapp backend.
# Runs BOTH services inside one container (Railway/Render/Fly/VPS friendly):
#   1. pot-provider (bgutil PO-token server) on ${POT_PORT:-4416}
#   2. yt-api (Express gateway) on ${PORT:-3001}  ← the only exposed port
# Env overrides: PORT, POT_PORT, PUBLIC_URL, YOUTUBE_COOKIE
set -u

POT_PORT="${POT_PORT:-4416}"
API_PORT="${PORT:-3001}"
POT_URL="http://127.0.0.1:${POT_PORT}"

echo "[stack] starting pot-provider on :${POT_PORT}"
cd /app/pot-provider
node build/main.js --port "$POT_PORT" &
POT_PID=$!

echo "[stack] waiting for pot-provider…"
for i in $(seq 1 90); do
  if curl -s -m 2 "$POT_URL/ping" 2>/dev/null | grep -q server_uptime; then
    echo "[stack] pot-provider ready after ${i}s"
    break
  fi
  sleep 1
done

echo "[stack] starting yt-api on :${API_PORT} (BGUTIL_URL=$POT_URL)"
cd /app/server
# exec → yt-api becomes PID 1's process; docker stop → SIGTERM propagates to it
exec env PORT="$API_PORT" BGUTIL_URL="$POT_URL" URL_SUFFIX="" \
  PUBLIC_URL="${PUBLIC_URL:-}" YOUTUBE_COOKIE="${YOUTUBE_COOKIE:-}" \
  node index.mjs
