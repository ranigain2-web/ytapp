#!/bin/bash
# push-to-github.sh — one-command publish + CI monitor for ytapp.
#
# Usage:   GH_TOKEN=<token> bash scripts/push-to-github.sh
#          bash scripts/push-to-github.sh ghp_xxxxx
#
# Does everything needed to publish and verify the builds:
#   1. verifies the token (GET /user)
#   2. creates ranigain2-web/ytapp if it doesn't exist
#   3. pushes the local main branch (repo root must be the project root)
#   4. waits for the build-android + build-macos workflows
#   5. prints run URLs, statuses, artifact names, and log tails on failure
#
# Token requirements: classic PAT (ghp_…) or fine-grained PAT with
# Contents: read+write, Actions: read+write, Metadata: read.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="ranigain2-web"
REPO="ytapp"
TOKEN="${1:-${GH_TOKEN:-}}"
API="https://api.github.com"

fail() { echo "ERROR: $*" >&2; exit 1; }
[ -n "$TOKEN" ] || fail "no token provided (arg 1 or GH_TOKEN env)"
cd "$ROOT" || fail "cannot cd $ROOT"
[ -d .git ] || fail "not a git repo — run: git init -b main && git add -A && git commit -m 'ytapp'"

gh() { curl -s -m 30 -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/vnd.github+json" "$@"; }

echo "==> 1/5 verifying token…"
LOGIN=$(gh "$API/user" | python3 -c "import json,sys; print(json.load(sys.stdin).get('login',''))")
[ -n "$LOGIN" ] || fail "token invalid (Bad credentials)"
echo "    authenticated as: $LOGIN"

echo "==> 2/5 checking repo $OWNER/$REPO…"
REPO_OK=$(gh "$API/repos/$OWNER/$REPO" | python3 -c "import json,sys; print('yes' if json.load(sys.stdin).get('full_name') else 'no')" 2>/dev/null)
if [ "$REPO_OK" != "yes" ]; then
  echo "    creating…"
  gh -X POST "$API/user/repos" -d "{\"name\":\"$REPO\",\"description\":\"Ad-free YouTube-style client — React web + Android APK (Capacitor) + macOS Intel app (Electron, self-contained backend). youtubei.js + PO tokens + HLS proxy.\",\"private\":false,\"has_wiki\":false}" > /dev/null
fi
echo "    repo: https://github.com/$OWNER/$REPO"

echo "==> 3/5 pushing main…"
git remote remove origin 2>/dev/null
git remote add origin "https://${LOGIN}:${TOKEN}@github.com/$OWNER/$REPO.git"
git push -u origin main 2>&1 | grep -vE "^remote:.*token" | tail -3 || fail "push failed (check token scopes: Contents read+write)"

echo "==> 4/5 waiting for CI workflows (polling up to 20 min)…"
DEADLINE=$(( $(date +%s) + 1200 ))
while :; do
  RUNS=$(gh "$API/repos/$OWNER/$REPO/actions/runs?per_page=5")
  SUMMARY=$(echo "$RUNS" | python3 -c "
import json,sys
runs=json.load(sys.stdin).get('workflow_runs',[])
for r in runs:
    print(f\"{r['name']}|{r['status']}|{r.get('conclusion','')}|{r['id']}|{r['html_url']}\")")
  TOTAL=$(echo "$SUMMARY" | grep -c . )
  DONE=$(echo "$SUMMARY" | awk -F'|' '$2=="completed"' | wc -l)
  echo "    runs: $TOTAL, completed: $DONE"
  if [ "$TOTAL" -ge 2 ] && [ "$DONE" -eq "$TOTAL" ]; then break; fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "    (timeout waiting — check the Actions tab)"; break; fi
  sleep 30
done

echo "==> 5/5 results…"
echo "$SUMMARY" | while IFS='|' read -r name status conclusion id url; do
  echo "---- $name → ${conclusion:-$status}  ($url)"
  if [ "$status" = "completed" ] && [ "$conclusion" != "success" ]; then
    echo "     failure log tail:"
    gh "$API/repos/$OWNER/$REPO/actions/runs/$id/attempts/1/logs" -L -o /tmp/ytapp-logs.zip 2>/dev/null
    python3 - <<PYEOF 2>/dev/null || true
import zipfile
try:
    z = zipfile.ZipFile('/tmp/ytapp-logs.zip')
    names = [n for n in z.namelist() if 'Build' in n or 'build' in n or 'gradle' in n.lower() or 'electron' in n.lower()]
    for n in names[:3]:
        print('     ---', n)
        tail = z.read(n).decode(errors='replace').splitlines()[-25:]
        for line in tail: print('     ', line[:150])
except Exception as e:
    print('     (could not read logs zip:', e, ')')
PYEOF
  fi
done

echo
echo "Artifacts (download from any run's page):"
gh "$API/repos/$OWNER/$REPO/actions/artifacts" | python3 -c "
import json,sys
for a in json.load(sys.stdin).get('artifacts',[]):
    print(f\"  - {a['name']}  ({a['size_in_bytes']//1024//1024} MB, expires {a['expires_at'][:10]})\")" 2>/dev/null

echo
echo "Done. Repo: https://github.com/$OWNER/$REPO  ·  Actions: https://github.com/$OWNER/$REPO/actions"
