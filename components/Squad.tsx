import type { NextFixture, SquadPlayer } from "@/lib/gameweek";
import { formatPrice, POSITIONS } from "@/lib/fpl";

const DIFFICULTY_CLASSES: Record<number, string> = {
  1: "bg-emerald-600 text-white",
  2: "bg-emerald-300 text-emerald-950",
  3: "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  4: "bg-rose-400 text-white",
  5: "bg-rose-700 text-white",
};

export function FixtureChips({ fixtures }: { fixtures: NextFixture[] }) {
  if (fixtures.length === 0) {
    return <span className="text-xs text-zinc-500">No fixture</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {fixtures.map((f, i) => (
        <span
          key={i}
          title={f.difficulty ? `Difficulty ${f.difficulty} of 5` : undefined}
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${DIFFICULTY_CLASSES[f.difficulty ?? 3] ?? DIFFICULTY_CLASSES[3]}`}
        >
          {f.opponent} ({f.home ? "H" : "A"})
        </span>
      ))}
    </span>
  );
}

/** Short availability label, e.g. "75%", "Injured". Null when fully available. */
export function availabilityLabel(sp: SquadPlayer): string | null {
  const p = sp.player;
  if (!p || !sp.flagged) return null;
  const labels: Record<string, string> = { i: "Injured", s: "Suspended", u: "Unavailable", n: "Not in squad" };
  if (labels[p.status]) return labels[p.status];
  return p.chance_of_playing_next_round !== null ? `${p.chance_of_playing_next_round}%` : "Doubtful";
}

export function StatusBadge({ sp }: { sp: SquadPlayer }) {
  const label = availabilityLabel(sp);
  if (!label) return null;
  const severe = sp.player?.status !== "d";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
        severe
          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
      }`}
    >
      {label}
    </span>
  );
}

function PlayerRow({ sp, dim }: { sp: SquadPlayer; dim?: boolean }) {
  const p = sp.player;
  return (
    <li className={`flex items-center gap-3 py-2.5 ${dim ? "opacity-70" : ""}`}>
      <span className="w-9 shrink-0 text-xs font-medium text-zinc-500">{p ? POSITIONS[p.position] : ""}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{p?.web_name ?? `Player ${sp.player_id}`}</span>
          {sp.is_captain && (
            <span className="rounded-full bg-zinc-900 px-1.5 text-xs font-bold text-white dark:bg-white dark:text-zinc-900">
              C
            </span>
          )}
          {sp.is_vice_captain && (
            <span className="rounded-full border border-zinc-400 px-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300">
              V
            </span>
          )}
          <StatusBadge sp={sp} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
          <span className="w-8">{sp.club}</span>
          <FixtureChips fixtures={sp.fixtures} />
        </div>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
        {formatPrice(p?.now_cost)}
      </span>
    </li>
  );
}

export function SquadList({ players, dim }: { players: SquadPlayer[]; dim?: boolean }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
      {players.map((sp) => (
        <PlayerRow key={sp.player_id} sp={sp} dim={dim} />
      ))}
    </ul>
  );
}
