#!/bin/bash
# research-search.sh — compact web-search output for the deep-research phase
# usage: research-search.sh "query" [num]
q="$1"; n="${2:-10}"
z-ai function -n web_search -a "{\"query\": \"$q\", \"num\": $n}" 2>/dev/null | python3 -c '
import sys, json
raw = sys.stdin.read()
start = min([i for i in (raw.find("["), raw.find("{")) if i >= 0], default=-1)
if start > 0: raw = raw[start:]
try:
    d, _ = json.JSONDecoder().raw_decode(raw)
except Exception:
    print("RAW-OUTPUT:", raw[:500]); sys.exit()
items = d if isinstance(d, list) else (d.get("results") or d.get("data") or d.get("items") or [])
if isinstance(items, dict): items = items.get("results", [])
for it in items[:10]:
    t = (it.get("name") or it.get("title") or "")[:85]
    u = it.get("url") or it.get("link") or ""
    s = (it.get("snippet") or it.get("description") or "").replace("\n", " ")[:160]
    print(f"- {t}\n  {u}\n  {s}")
'
