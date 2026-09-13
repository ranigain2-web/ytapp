"use client";

import { useRouter } from "@/lib/yt-router";

export const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "music", label: "Music" },
  { id: "gaming", label: "Gaming" },
  { id: "news", label: "News" },
  { id: "movies", label: "Movies" },
  { id: "live", label: "Live" },
  { id: "tech", label: "Tech" },
  { id: "sports", label: "Sports" },
  { id: "learning", label: "Learning" },
  { id: "comedy", label: "Comedy" },
  { id: "podcasts", label: "Podcasts" },
  { id: "cooking", label: "Cooking" },
  { id: "trailers", label: "Trailers" },
];

export default function ChipsBar({ active, onSelect }: { active: string; onSelect: (cat: string) => void }) {
  const { navigate } = useRouter();
  return (
    <div className="sticky top-14 z-30 bg-[#0f0f0f]">
      <div className="yt-chips-fade flex gap-3 px-2 sm:px-6 py-3 overflow-x-auto no-scrollbar" role="tablist" aria-label="Categories">
        {CATEGORIES.map((c) => {
          const isActive = c.id === active;
          return (
            <button
              key={c.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => { onSelect(c.id); navigate({ name: "home", category: c.id }); }}
              className={`shrink-0 h-8 px-3 rounded-lg text-[14px] font-medium transition-colors ${isActive ? "bg-[#f1f1f1] text-[#0f0f0f]" : "bg-[#272727] text-[#f1f1f1] hover:bg-[#3f3f3f]"}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
