/** Transfer plans saved by the optimizer job (see jobs/raptor/optimizer). */
import { CHIP_NAMES } from "@/lib/gameweek";

export type PlanPlayer = {
  id: number;
  name: string;
  position: number;
  team: number;
  price: number; // tenths of a million
  sell?: number; // selling price, for players you'd sell
  xp?: number; // expected points that gameweek
};

export type PlanWeek = {
  gameweek: number;
  free_transfers: number;
  hits: number;
  transfers: { out: PlanPlayer; in: PlanPlayer }[];
  captain: PlanPlayer;
  lineup: PlanPlayer[];
  bench: PlanPlayer[];
  expected_points: number;
  bank_after: number;
  chip?: string | null; // wildcard, freehit, bboost, 3xc
};

export type ChipAdvice = "play" | "later" | "save";

export type ChipOption = {
  chip: string;
  label: string;
  advice: ChipAdvice;
  best_week: number | null;
  gain: number; // expected points gained at best_week, vs the plan without chips
  by_week: Record<string, number>;
  expires: number; // last gameweek of this chip's window
};

export type TransferPlanRow = {
  from_gameweek: number;
  horizon: number;
  free_transfers: number;
  bank: number;
  plan: { weeks: PlanWeek[]; chips?: ChipOption[]; no_chip_points?: number | null };
  expected_points: number;
  baseline_points: number;
  model_version: string;
  created_at: string;
};

/** Below this, a plan isn't worth acting on: roll the transfer instead. */
export const WORTHWHILE_GAIN = 1;

export type ChipThisWeek = { id: string; label: string; captain?: string };

export type Headline =
  | { kind: "roll"; gain: number; chip?: ChipThisWeek }
  | { kind: "move"; gain: number; moves: string; hits: number; chip?: ChipThisWeek }
  | { kind: "squad-chip"; gain: number; changes: number; chip: ChipThisWeek }; // Wildcard or Free Hit

export const chipLabel = (chip: string) => CHIP_NAMES[chip] ?? chip;

/** What to do before the next deadline, in one line. */
export function headline(row: TransferPlanRow): Headline {
  const gain = Number(row.expected_points) - Number(row.baseline_points);
  const first = row.plan.weeks[0];
  const chip: ChipThisWeek | undefined = first?.chip
    ? { id: first.chip, label: chipLabel(first.chip), ...(first.chip === "3xc" ? { captain: first.captain.name } : {}) }
    : undefined;
  if (chip && (chip.id === "wildcard" || chip.id === "freehit")) {
    return { kind: "squad-chip", gain, changes: first.transfers.length, chip };
  }
  const extra = chip ? { chip } : {};
  if (!first || first.transfers.length === 0 || gain < WORTHWHILE_GAIN) return { kind: "roll", gain, ...extra };
  const moves = first.transfers.map((t) => `${t.out.name} → ${t.in.name}`).join(", ");
  return { kind: "move", gain, moves, hits: first.hits, ...extra };
}

export function gameweekRange(row: TransferPlanRow): string {
  const last = row.from_gameweek + row.horizon - 1;
  return row.horizon > 1 ? `GW${row.from_gameweek}-${last}` : `GW${row.from_gameweek}`;
}

const ADVICE_ORDER: Record<ChipAdvice, number> = { play: 0, later: 1, save: 2 };

/** Chips you still have in the plan's weeks: play-now first, then pencilled in, then saved. */
export function chipOptions(row: TransferPlanRow): ChipOption[] {
  return [...(row.plan.chips ?? [])].sort(
    (a, b) => ADVICE_ORDER[a.advice] - ADVICE_ORDER[b.advice] || (a.best_week ?? 99) - (b.best_week ?? 99),
  );
}

/** "Play now", "GW8", or "Save" (with why) for one chip. */
export function adviceText(option: ChipOption, row: TransferPlanRow): string {
  if (option.advice === "play") return "Play this week";
  if (option.advice === "later") return `Pencilled in for GW${option.best_week}`;
  const last = row.from_gameweek + row.horizon - 1;
  return option.expires > last ? "Save it" : `Save it (use by GW${option.expires})`;
}

/** "Bench Boost in GW8" for chips the plan plays after this week, or null. */
export function laterChips(row: TransferPlanRow): string | null {
  const later = row.plan.weeks.slice(1).filter((w) => w.chip);
  return later.length ? later.map((w) => `${chipLabel(w.chip!)} in GW${w.gameweek}`).join(" and ") : null;
}
