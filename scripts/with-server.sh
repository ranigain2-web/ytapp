#!/bin/bash
# with-server.sh — run BOTH backends + static server and any commands within
# ONE process tree so the sandbox reaper can't kill servers mid-capture.
# Usage: bash scripts/with-server.sh '<shell commands>'
set -u
cd /home/z/my-project

SRV_PIDS=()
if ! curl -s -m 2 -o /dev/null "http://127.0.0.1:3001/api/ytb-relay?e=ping"; then
  (cd /home/z/my-project/server && exec node index.mjs >> server.log 2>&1) &
  SRV_PIDS+=($!)
fi
pkill -f serve-static 2>/dev/null
sleep 0.3
bun scripts/serve-static.mjs >> /tmp/serve-static.log 2>&1 &
SRV_PIDS+=($!)

# wait for readiness
for i in $(seq 1 30); do
  A=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:3999/ 2>/dev/null)
  B=$(curl -s -m 2 -o /dev/null -w "%{http_code}" "http://127.0.0.1:3001/api/ytb-relay?e=ping" 2>/dev/null)
  [ "$A" = "200" ] && [ "$B" = "200" ] && break
  sleep 0.5
done

bash -c "$1"
RC=$?
for p in "${SRV_PIDS[@]:-}"; do kill "$p" 2>/dev/null; done
exit $RC
