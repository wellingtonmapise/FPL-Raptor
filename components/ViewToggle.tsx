"use client";

import { useEffect, useState } from "react";

// Pitch or list for the same squad. The choice is remembered on this device.
type View = "pitch" | "list";

export default function ViewToggle({
  title,
  note,
  pitch,
  list,
  storageKey = "raptor-squad-view",
}: {
  title: React.ReactNode;
  note?: React.ReactNode;
  pitch: React.ReactNode;
  list: React.ReactNode;
  storageKey?: string;
}) {
  const [view, setView] = useState<View>("pitch");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the saved choice once, after hydration
      if (saved === "list" || saved === "pitch") setView(saved);
    } catch {
      // Storage blocked (private mode): stay on the pitch.
    }
  }, [storageKey]);
  const choose = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Not remembered, which is fine.
    }
  };
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {note && <p className="truncate text-xs text-zinc-500">{note}</p>}
        </div>
        <div className="flex shrink-0 rounded-lg bg-zinc-100 p-0.5 text-sm dark:bg-zinc-900" role="group" aria-label="Show as">
          {(["pitch", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => choose(v)}
              aria-pressed={view === v}
              className={`rounded-md px-3 py-1 font-medium capitalize ${
                view === v ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-500"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === "pitch" ? pitch : list}
    </section>
  );
}
