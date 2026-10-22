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
          <h2 className="section-title">{title}</h2>
          {note && <p className="text-xs text-muted">{note}</p>}
        </div>
        <div className="flex shrink-0 rounded-xl bg-surface-muted p-1 text-xs" role="group" aria-label="Squad view">
          {(["pitch", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => choose(v)}
              aria-pressed={view === v}
              className={`min-h-9 rounded-lg px-3 font-medium capitalize ${
                view === v ? "bg-surface shadow-sm" : "text-muted"
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
