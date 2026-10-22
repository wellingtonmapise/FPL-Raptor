"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import LocalTime from "@/components/LocalTime";

// Re-renders the page with fresh data every minute while matches are on,
// but only while the page is on screen.
export default function AutoRefresh({ seconds = 60, active = true, checkedAt }: { seconds?: number; active?: boolean; checkedAt?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const id = setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds, active]);
  if (!checkedAt) return null;
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 text-xs text-muted">
      <p>Checked <time dateTime={checkedAt}><LocalTime iso={checkedAt} options={{ hour: "numeric", minute: "2-digit" }} /></time>{active ? " · refreshes every minute" : ""}</p>
      <button
        type="button"
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium hover:bg-surface-muted disabled:opacity-50"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        aria-busy={pending}
        aria-label="Refresh live scores"
      >
        <svg viewBox="0 0 24 24" className={`h-4 w-4 ${pending ? "motion-safe:animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 2M18 17a7 7 0 0 1-12 1l-2-2" /></svg>
        {pending ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
