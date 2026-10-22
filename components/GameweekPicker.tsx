"use client";

export default function GameweekPicker({ weeks, selected, onSelect }: {
  weeks: { gameweek: number; transfers: unknown[]; chip?: string | null }[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-surface-muted p-1" role="group" aria-label="Gameweek">
      {weeks.map((week, index) => (
        <button
          key={week.gameweek}
          type="button"
          aria-pressed={selected === index}
          onClick={() => onSelect(index)}
          className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg text-sm font-medium ${selected === index ? "bg-surface shadow-sm" : "text-muted"}`}
        >
          GW{week.gameweek}
          {(week.transfers.length > 0 || week.chip) && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${week.chip ? "bg-violet-500" : "bg-accent"}`}><span className="sr-only">{week.chip ? ", chip planned" : `, ${week.transfers.length} transfers`}</span></span>}
        </button>
      ))}
    </div>
  );
}
