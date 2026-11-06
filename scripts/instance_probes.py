#!/usr/bin/env python3
"""instance_probes.py — LIVE probes of public fallback APIs from this (datacenter) IP.
Tests: Invidious instances, Piped instances, ReturnYouTubeDislike, SponsorBlock, cobalt.
Target video: jNQXAC9IVRw (the one gated everywhere) + dQw4w9WgXcQ for RYD/SB."""
import json, time, urllib.request, ssl

ctx = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}

def get(url, timeout=15, headers=None):
    t0 = time.time()
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            body = r.read()
            return r.status, body, round((time.time() - t0) * 1000)
    except Exception as e:
        return getattr(e, "code", 0), str(e)[:80].encode(), round((time.time() - t0) * 1000)

out = {"when": time.strftime("%Y-%m-%dT%H:%M:%S")}

print("== Invidious public instances ==")
code, body, _ = get("https://api.invidious.io/instances.json?sort_by=type,users,health")
instances = []
if code == 200:
    for name, meta in json.loads(body):
        if isinstance(meta, dict) and meta.get("type") == "https":
            instances.append((name, meta))
    print(f"registry returned {len(instances)} https instances")
else:
    print("registry unreachable:", code)

out["invidious"] = []
for name, meta in instances[:8]:
    host = "https://" + name
    code, body, ms = get(f"{host}/api/v1/videos/jNQXAC9IVRw", timeout=12)
    row = {"instance": name, "http": code, "ms": ms}
    if code == 200:
        try:
            d = json.loads(body)
            fs, af = d.get("formatStreams", []), d.get("adaptiveFormats", [])
            row.update({"title": (d.get("title") or "")[:30], "formatStreams": len(fs),
                        "adaptiveFormats": len(af), "live": d.get("liveNow")})
            if fs:
                u = fs[0].get("url", "")
                c2, b2, ms2 = get(u, timeout=12, headers={"Range": "bytes=0-1023"})
                row["stream_fetch"] = f"HTTP {c2} {ms2}ms"
        except Exception as e:
            row["parse_err"] = str(e)[:60]
    out["invidious"].append(row)
    print(f"{name:42s} HTTP {code} {ms}ms fmts={row.get('formatStreams','-')}/{row.get('adaptiveFormats','-')} stream={row.get('stream_fetch','-')}")

print("\n== Piped public instances ==")
out["piped"] = []
piped_hosts = ["pipedapi.kavin.rocks", "pipedapi.adminforge.de", "api.piped.private.coffee",
               "pipedapi.reallyaweso.me", "pipedapi.drgns.space", "pipedapi-libre.kavin.rocks"]
for h in piped_hosts:
    code, body, ms = get(f"https://{h}/streams/jNQXAC9IVRw", timeout=12)
    row = {"instance": h, "http": code, "ms": ms}
    if code == 200:
        try:
            d = json.loads(body)
            row.update({"title": (d.get("title") or "")[:30],
                        "videoStreams": len(d.get("videoStreams", [])),
                        "audioStreams": len(d.get("audioStreams", []))})
        except Exception as e:
            row["parse_err"] = str(e)[:60]
    out["piped"].append(row)
    print(f"{h:38s} HTTP {code} {ms}ms streams={row.get('videoStreams','-')}/{row.get('audioStreams','-')}")

print("\n== ReturnYouTubeDislike ==")
code, body, ms = get("https://returnyoutubedislikeapi.com/votes?videoId=dQw4w9WgXcQ")
try: d = json.loads(body); ryd = f"HTTP {code} {ms}ms dislikes={d.get('dislikes')} likes={d.get('likes')}"
except Exception: ryd = f"HTTP {code} {body[:50]}"
out["ryd"] = ryd; print(ryd)

print("\n== SponsorBlock ==")
code, body, ms = get("https://sponsor.ajay.app/api/skipSegments?videoID=dQw4w9WgXcQ&category=sponsor")
out["sponsorblock"] = f"HTTP {code} {ms}ms segments={len(json.loads(body)) if code==200 else '-'}"
print(out["sponsorblock"])

print("\n== cobalt public API ==")
code, body, ms = get("https://api.cobalt.tools/", timeout=10)
out["cobalt"] = f"HTTP {code} {ms}ms {body[:60]}"
print(out["cobalt"])

with open("research/results/instance-probes.json", "w") as f:
    json.dump(out, f, indent=2)
print("\nsaved -> research/results/instance-probes.json")
