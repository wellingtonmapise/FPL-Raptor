"use client";

import { useEffect, useRef } from "react";

// A bottom sheet on phones (a centred panel on wider screens) with a dimmed
// backdrop. Escape or tapping outside closes it.
export default function Sheet({
  title,
  onClose,
  children,
  tall = false,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  tall?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/45 motion-safe:animate-[fade-in_150ms_ease-out]"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex w-full max-w-md flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl motion-safe:animate-[sheet-up_220ms_cubic-bezier(0.2,0.8,0.2,1)] sm:rounded-3xl dark:bg-zinc-950 ${
          tall ? "h-[85vh]" : "max-h-[85vh]"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-900">
          <div className="min-w-0 font-semibold">{title}</div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="-mr-2 rounded-full p-2 text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-600 dark:hover:bg-zinc-900"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
