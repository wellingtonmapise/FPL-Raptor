/** Transfer plans saved by the optimizer job (see jobs/raptor/optimizer). */

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
};

export type TransferPlanRow = {
  from_gameweek: number;
  horizon: number;
  free_transfers: number;
  bank: number;
  plan: { weeks: PlanWeek[] };
  expected_points: number;
  baseline_points: number;
  model_version: string;
  created_at: string;
};

/** Below this, a plan isn't worth acting on: roll the transfer instead. */
export const WORTHWHILE_GAIN = 1;

export type Headline =
  | { kind: "roll"; gain: number }
  | { kind: "move"; gain: number; moves: string; hits: number };

/** What to do before the next deadline, in one line. */
export function headline(row: TransferPlanRow): Headline {
  const gain = Number(row.expected_points) - Number(row.baseline_points);
  const first = row.plan.weeks[0];
  if (!first || first.transfers.length === 0 || gain < WORTHWHILE_GAIN) return { kind: "roll", gain };
  const moves = first.transfers.map((t) => `${t.out.name} → ${t.in.name}`).join(", ");
  return { kind: "move", gain, moves, hits: first.hits };
}

export function gameweekRange(row: TransferPlanRow): string {
  const last = row.from_gameweek + row.horizon - 1;
  return row.horizon > 1 ? `GW${row.from_gameweek}-${last}` : `GW${row.from_gameweek}`;
}
