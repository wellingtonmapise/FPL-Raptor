"use client";

import { usePlayerSheet } from "@/components/PlayerSheet";
import Shirt from "@/components/Shirt";
import type { PitchPlayer, Tone } from "@/lib/pitch";

// Your team in formation on a pitch, goalkeeper at the top as FPL draws it,
// with the bench below. Each player is a club-colour shirt with a name tag;
// the line under the name and the number on the shirt depend on the page
// (next fixture and expected points, live points, a planned week's xP).
// Tapping a player opens their card. lib/pitch.ts turns each page's data into slots.

const TONES: Record<Tone, string> = {
  fdr1: "bg-emerald-700 text-white",
  fdr2: "bg-emerald-300 text-emerald-950",
  fdr3: "bg-zinc-200 text-zinc-800",
  fdr4: "bg-rose-400 text-white",
  fdr5: "bg-rose-800 text-white",
  points: "bg-zinc-900 text-white",
  live: "bg-emerald-600 text-white",
  muted: "bg-zinc-600/90 text-zinc-100",
};

function Slot({ p, compact = false, onSelect }: { p: PitchPlayer; compact?: boolean; onSelect?: (id: number) => void }) {
  const { open } = usePlayerSheet();
  const label = [p.name, p.caption, p.badge === "C" ? "captain" : p.badge === "TC" ? "triple captain" : p.badge === "V" ? "vice-captain" : null, p.alert === "out" ? "unavailable" : p.alert === "doubtful" ? "doubtful" : null, p.note]
    .filter(Boolean)
    .join(", ");
  return (
    <button
      type="button"
      onClick={() => (onSelect ? onSelect(p.id) : open(p.id))}
      aria-label={label}
      className={`group flex w-[19%] max-w-[76px] min-w-0 flex-col items-center rounded-lg pt-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white ${
        p.dim ? "opacity-55" : ""
      }`}
    >
      <span className="relative">
        <Shirt
          club={p.club}
          goalkeeper={p.position === 1}
          number={p.number}
          className={`${compact ? "h-9 w-10" : "h-11 w-12"} drop-shadow-[0_2px_2px_rgba(0,0,0,0.3)] transition-transform group-active:scale-95`}
        />
        {p.badge && (
          <span
            className={`absolute -top-1 -left-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold ring-2 ring-[#2c8c58] ${
              p.badge === "V" ? "bg-white text-zinc-900" : "bg-zinc-900 text-white"
            }`}
          >
            {p.badge}
          </span>
        )}
        {p.alert && (
          <span
            className={`absolute -top-1 -right-2 flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-[#2c8c58] ${
              p.alert === "out" ? "bg-rose-600 text-white" : "bg-amber-400 text-amber-950"
            }`}
            aria-hidden
          >
            !
          </span>
        )}
        {p.live && (
          <span className="absolute -right-1 bottom-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#2c8c58] motion-safe:animate-pulse" aria-hidden />
        )}
      </span>
      <span
        className={`mt-0.5 w-full overflow-hidden rounded-[5px] text-center leading-tight shadow-sm ${
          p.ring === "in"
            ? "ring-2 ring-emerald-300"
            : p.ring === "sub"
              ? "ring-2 ring-sky-300"
              : p.ring === "pick"
                ? "ring-[3px] ring-amber-300 motion-safe:animate-pulse"
                : ""
        }`}
      >
        <span className="block truncate bg-white px-1 py-[3px] text-[11px] font-semibold text-zinc-900">{p.name}</span>
        <span className={`block truncate px-1 py-[2px] text-[11px] font-medium tabular-nums ${TONES[p.tone ?? "points"]}`}>{p.caption}</span>
      </span>
    </button>
  );
}

export default function Pitch({
  starters,
  bench,
  benchNote,
  onSelect,
}: {
  starters: PitchPlayer[];
  bench: PitchPlayer[];
  benchNote?: string;
  onSelect?: (id: number) => void; // instead of opening the player card
}) {
  const rows = [1, 2, 3, 4].map((pos) => starters.filter((p) => p.position === pos));
  return (
    <div className="overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div
        className="relative overflow-hidden px-1 pt-3 pb-5"
        style={{
          backgroundColor: "#2c8c58",
          backgroundImage: "repeating-linear-gradient(180deg, rgba(255,255,255,0.055) 0 46px, transparent 46px 92px)",
        }}
      >
        {/* Markings: the goal end at the top, halfway line and centre circle at the bottom. */}
        <div className="pointer-events-none absolute inset-x-3 top-0 bottom-0 border-x-2 border-white/25" aria-hidden />
        <div className="pointer-events-none absolute top-0 left-1/2 h-[17%] w-[58%] -translate-x-1/2 border-x-2 border-b-2 border-white/25" aria-hidden />
        <div className="pointer-events-none absolute top-0 left-1/2 h-[7%] w-[28%] -translate-x-1/2 border-x-2 border-b-2 border-white/25" aria-hidden />
        <div className="pointer-events-none absolute -bottom-[60px] left-1/2 h-[120px] w-[120px] -translate-x-1/2 rounded-full border-2 border-white/25" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-b-2 border-white/25" aria-hidden />

        <div className="relative flex flex-col gap-3">
          {rows.map((row, i) => (
            <div key={i} className="flex justify-center gap-[2%]">
              {row.map((p) => (
                <Slot key={p.id} p={p} onSelect={onSelect} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {bench.length > 0 && (
        <div className="bg-[#20694a] px-1 pt-2 pb-3 dark:bg-[#17503a]">
          <div className="mb-1 flex items-baseline justify-between px-2 text-[11px] font-medium text-white/75">
            <span>Bench</span>
            {benchNote && <span>{benchNote}</span>}
          </div>
          <div className="flex justify-center gap-[2%]">
            {bench.map((p) => (
              <Slot key={p.id} p={p} compact onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
