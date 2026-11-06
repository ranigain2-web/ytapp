#!/usr/bin/env python3
"""ytdlp_battery.py — hands-on yt-dlp extraction tests from THIS (worst-case datacenter) IP.
Pass A: yt-dlp default clients on the full battery.
Pass B: forced single-client runs on 2 representative videos.
Pass C: format-URL fetchability (range GET) for each success — catches 403 GVS gating."""
import json, subprocess, sys, urllib.request, ssl

BATTERY = ["dQw4w9WgXcQ", "jNQXAC9IVRw", "9bZkp7q19f0", "kJQP7kiw5Fk", "aqz-KE-bpKQ", "jfKfPfyJRdk"]
SINGLE_CLIENT_VIDEOS = ["dQw4w9WgXcQ", "jNQXAC9IVRw"]  # one our server CAN do, one it CAN'T
CLIENTS = ["tv", "web_safari", "web_embedded", "mweb", "android_vr", "ios", "android"]

def run_ytdlp(args, timeout=45):
    cmd = [sys.executable, "-m", "yt_dlp", "--no-warnings", "--socket-timeout", "15"] + args
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "TIMEOUT"

def probe(vid, label, extra):
    rc, out, err = run_ytdlp(extra + ["-J", f"https://www.youtube.com/watch?v={vid}"])
    row = {"video": vid, "test": label, "ok": rc == 0}
    if rc == 0:
        try:
            d = json.loads(out)
            fmts = d.get("formats", [])
            heights = [f.get("height") for f in fmts if f.get("height")]
            row.update({
                "formats": len(fmts),
                "max_height": max(heights) if heights else None,
                "is_live": d.get("is_live"),
                "title": (d.get("title") or "")[:38],
                "bestaudio_url": next((f["url"] for f in reversed(fmts) if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")), None),
                "duration": d.get("duration"),
            })
        except Exception as e:
            row["ok"] = False; row["err"] = f"json-parse: {e}"
    else:
        last = [l for l in (err or "").strip().splitlines() if l.startswith("ERROR")]
        row["err"] = (last[-1] if last else (err or "").strip().splitlines()[-1:] or ["?"])[0][:150]
    print(("OK  " if row["ok"] else "FAIL") + f" {vid} [{label}]" + ("" if row["ok"] else f" :: {row.get('err','')}"))
    return row

def fetch_range(url, headers):
    req = urllib.request.Request(url, headers={**headers, "Range": "bytes=0-1023"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, len(r.read())
    except Exception as e:
        code = getattr(e, "code", None)
        return code if code else 0, str(e)[:60]

results = []
print("== Pass A: yt-dlp DEFAULT clients, full battery ==")
for vid in BATTERY:
    results.append(probe(vid, "default", []))

print("\n== Pass B: forced single clients on", SINGLE_CLIENT_VIDEOS, "==")
for vid in SINGLE_CLIENT_VIDEOS:
    for c in CLIENTS:
        results.append(probe(vid, c, ["--extractor-args", f"youtube:player_client={c}"]))

print("\n== Pass C: format-URL fetchability (Range GET first 1KB) ==")
probe_c = []
checked = set()
for r in results:
    if r["ok"] and r.get("bestaudio_url"):
        key = (r["video"], r["test"])
        if key in checked: continue
        checked.add(key)
        code, n = fetch_range(r["bestaudio_url"], {"User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip"})
        probe_c.append({**{k: r[k] for k in ("video", "test")}, "range_status": code, "bytes": n})
        print(f"{r['video']} [{r['test']}] bestaudio range-GET -> HTTP {code} ({n})")

with open("research/results/ytdlp-battery.json", "w") as f:
    json.dump({"when": __import__("datetime").datetime.now().isoformat(), "results": results, "fetch_probes": probe_c}, f, indent=2)

ok_default = sum(1 for r in results if r["test"] == "default" and r["ok"])
print(f"\nSUMMARY: default clients extracted {ok_default}/6 battery videos; "
      f"{sum(1 for r in results if r['ok'])}/{len(results)} single-client runs OK")
