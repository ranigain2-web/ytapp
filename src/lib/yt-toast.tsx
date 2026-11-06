// yt-toast — phase 3 "interaction truth serum": every mutation confirms
// itself. One module, no dependencies, mounted once from AppShell.

"use client";

import { create } from "zustand";

export interface ToastItem {
  id: number;
  text: string;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (text: string) => void;
  dismiss: (id: number) => void;
}

const useToastStore = create<ToastStore>()((set, get) => ({
  toasts: [],
  push: (text) => {
    const id = Date.now() + Math.random();
    // cap at 3 visible: older ones get dropped instead of stacking a column
    set(s => ({ toasts: [...s.toasts, { id, text }].slice(-3) }));
    setTimeout(() => get().dismiss(id), 2600);
  },
  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

/** Fire a confirmation toast: `ytToast("Link copied to clipboard")`. */
export function ytToast(text: string) {
  useToastStore.getState().push(text);
}

/** The renderer — mounted once in AppShell (bottom-left, above the nav). */
export function ToastHost() {
  const toasts = useToastStore(s => s.toasts);
  const dismiss = useToastStore(s => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed left-2 bottom-[calc(64px+env(safe-area-inset-bottom))] md:left-6 md:bottom-6 z-[90] flex flex-col gap-2 pointer-events-none" role="status" aria-live="polite">
      {toasts.map(t => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          data-testid="yt-toast"
          className="pointer-events-auto max-w-[340px] text-left px-4 py-3 rounded-lg bg-[#f1f1f1] text-[#0f0f0f] text-[14px] leading-[20px] shadow-xl yt-pop"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
