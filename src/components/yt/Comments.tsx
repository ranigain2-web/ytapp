"use client";

import { useEffect, useState } from "react";
import { fetchComments, type YtComment } from "@/lib/yt-api";
import { formatCount } from "@/lib/yt-format";

export default function Comments({ videoId }: { videoId: string }) {
  const [comments, setComments] = useState<YtComment[] | null>(null);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = comments === null && error === null;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchComments(videoId, sort);
        if (!alive) return;
        setComments(r.comments || []);
        setCount(r.count ?? (r.comments?.length || 0));
        if (r.error) setError(r.error);
      } catch (e) {
        if (alive) setError(String(e instanceof Error ? e.message : e));
      }
    })();
    return () => { alive = false; };
  }, [videoId, sort]);

  return (
    <section aria-label="Comments">
      <div className="flex items-center gap-8 mb-6">
        <h2 className="text-[20px] font-bold">
          {count !== null && count > 0 ? `${count.toLocaleString()} Comments` : "Comments"}
        </h2>
        <div className="flex gap-4 text-[14px]">
          <button
            onClick={() => setSort("top")}
            className={`flex items-center gap-2 ${sort === "top" ? "text-[#f1f1f1] font-medium" : "text-[#aaa]"}`}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
            Sort by
          </button>
          {sort === "top" ? (
            <button onClick={() => setSort("new")} className="text-[#aaa] hover:text-[#f1f1f1]">Newest first</button>
          ) : (
            <button onClick={() => setSort("top")} className="text-[#aaa] hover:text-[#f1f1f1]">Top comments</button>
          )}
        </div>
      </div>

      {/* comment composer (visual only — anonymous) */}
      <div className="flex gap-4 mb-8">
        <span className="w-10 h-10 rounded-full bg-[#3ea6ff]/20 text-[#3ea6ff] font-bold flex items-center justify-center shrink-0">Y</span>
        <div className="flex-1 border-b border-[#303030] pb-2">
          <input
            placeholder="Add a comment..."
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-[#888]"
            aria-label="Add a comment"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex gap-4">
              <div className="w-10 h-10 rounded-full yt-skeleton shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 yt-skeleton rounded w-32" />
                <div className="h-4 yt-skeleton rounded w-full" />
                <div className="h-4 yt-skeleton rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-[#aaa] text-sm">{error}</p>
      ) : !comments || comments.length === 0 ? (
        <p className="text-[#aaa] text-sm">No comments yet.</p>
      ) : (
        <div className="space-y-6">
          {comments.map((c, i) => (
            <article key={i} className="flex gap-4" aria-label={`Comment by ${c.author}`}>
              {c.author_thumb ? (

                <img src={c.author_thumb} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" loading="lazy" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-[#444] text-[#ddd] font-bold flex items-center justify-center shrink-0">
                  {(c.author || "?").replace(/^@/, "")[0]?.toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="font-medium text-[#f1f1f1] truncate">{c.author}</span>
                  <span className="text-[#aaa] shrink-0">{c.time}</span>
                </div>
                <p className="mt-1 text-[14px] leading-[21px] text-[#ddd] whitespace-pre-wrap break-words">{c.text}</p>
                <div className="flex items-center gap-4 mt-2 text-[#aaa]">
                  <button className="flex items-center gap-1.5 hover:text-[#f1f1f1]" aria-label="Like comment">
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 10v11M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></svg>
                    {c.likes > 0 && formatCount(c.likes)}
                  </button>
                  <button className="hover:text-[#f1f1f1]" aria-label="Dislike comment">
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 14V3M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" /></svg>
                  </button>
                  <button className="text-[12px] font-medium hover:text-[#f1f1f1]">Reply</button>
                  {c.replies > 0 && (
                    <button className="text-[13px] font-medium text-[#3ea6ff] hover:text-[#6bc1ff]">
                      {c.replies} {c.replies === 1 ? "reply" : "replies"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
