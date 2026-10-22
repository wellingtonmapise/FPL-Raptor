import type { LiveElement, LivePick, LivePlayer } from "@/lib/live";

export const LIVE_VIEWS = ["players", "standings", "matches"] as const;
export type LiveView = (typeof LIVE_VIEWS)[number];

export function liveView(value: string | null): LiveView {
  return LIVE_VIEWS.find((view) => view === value) ?? "players";
}

export function liveHref(view: LiveView, leagueId: number | null): string {
  const params = new URLSearchParams();
  if (leagueId !== null) params.set("league", String(leagueId));
  if (view !== "players") params.set("view", view);
  return `/live${params.size ? `?${params}` : ""}`;
}

/** Missing rows must not become zero-point players or trigger projected subs. */
export function hasLiveSquad(
  picks: LivePick[],
  players: Map<number, LivePlayer>,
  live: Map<number, LiveElement>,
): boolean {
  return picks.length === 15 && new Set(picks.map((pick) => pick.element)).size === 15 &&
    picks.every((pick) => players.has(pick.element) && live.has(pick.element));
}

/** A known zero is valid; missing season totals cannot establish a rank. */
export function startingTotal(
  previous: number | null | undefined,
  total: number | null | undefined,
  gameweekPoints: number | null | undefined,
): number | null {
  if (previous != null) return previous;
  return total != null && gameweekPoints != null ? total - gameweekPoints : null;
}
