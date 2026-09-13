// Formatting helpers — YouTube-style text formatting
export function formatViews(views: number | string | undefined | null): string {
  if (views === undefined || views === null || views === "") return "";
  if (typeof views === "string") {
    // already formatted like "1.8B views" / "2.4M views"
    return views.replace(/\s*views?/i, "").trim();
  }
  if (views >= 1e9) return `${(views / 1e9).toFixed(views % 1e9 === 0 ? 0 : 1)}B`;
  if (views >= 1e6) return `${(views / 1e6).toFixed(views % 1e6 === 0 ? 0 : 1)}M`;
  if (views >= 1e3) return `${(views / 1e3).toFixed(views % 1e3 === 0 ? 0 : 1)}K`;
  return String(views);
}

export function formatCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// normalize InnerTube compact forms: "1mo", "2yrs", "19h", "3w" → full words
export function normalizeCompactAge(s: string): string {
  const m = /^(\d+)\s*(s|m|h|d|w|mo|y|yr|yrs)\s*(ago)?$/i.exec(s.trim());
  if (!m) return s;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const map: Record<string, [string, string]> = {
    s: ["second", "seconds"], m: ["minute", "minutes"], h: ["hour", "hours"],
    d: ["day", "days"], w: ["week", "weeks"], mo: ["month", "months"],
    y: ["year", "years"], yr: ["year", "years"], yrs: ["year", "years"],
  };
  const pair = map[unit];
  if (!pair) return s;
  return `${n} ${n === 1 ? pair[0] : pair[1]} ago`;
}

export function timeAgo(published: string | undefined | null): string {
  if (!published) return "";
  const p0 = published.toLowerCase();
  const norm = normalizeCompactAge(published);
  if (norm !== published) return norm;
  const p = p0;
  // already relative ("3 weeks ago")
  if (/ago|streamed|premiere/.test(p)) return published.replace(/streamed|premiere[d]*/gi, "").trim();
  // absolute date ("Oct 25, 2009") — approximate
  const d = new Date(published);
  if (!isNaN(d.getTime())) {
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days < 1) return "today";
    if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
    if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? "s" : ""} ago`;
    const y = Math.floor(days / 365);
    return `${y} year${y > 1 ? "s" : ""} ago`;
  }
  return published;
}

export function fullDate(published: string | undefined | null): string {
  if (!published) return "";
  return published;
}
