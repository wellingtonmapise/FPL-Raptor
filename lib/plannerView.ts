import { cleanMoves, type DraftWeek, type Move } from "@/lib/draft";
import type { PlanWeek } from "@/lib/plan";

export type DraftIdentity = { id: string; name: string };
export type LocalDraft = { moves: Move[]; draft: DraftIdentity | null; savedMoves: Move[] };
export type PredictionCoverage = Record<number, number[]>;

export function draftStorageKey(userId: string, teamId: number, gameweek: number): string {
  return `raptor-draft:${userId}:${teamId}:gw${gameweek}`;
}

export function readLocalDraft(value: string | null): LocalDraft | null {
  try {
    const data = JSON.parse(value ?? "null");
    if (!data || !Array.isArray(data.moves)) return null;
    const draft = data.draft && typeof data.draft.id === "string" && typeof data.draft.name === "string"
      ? { id: data.draft.id, name: data.draft.name.slice(0, 40) } : null;
    return { moves: cleanMoves(data.moves), draft, savedMoves: cleanMoves(data.savedMoves) };
  } catch { return null; }
}

export function moveSignature(moves: Move[]): string {
  return JSON.stringify(cleanMoves(moves));
}

export function readPlannerHandoff(value: string | null, gameweek: number): { moves: Move[]; label: string } | null {
  try {
    const data = JSON.parse(value ?? "null");
    if (!data || data.gameweek !== gameweek || !Array.isArray(data.moves)) return null;
    return { moves: cleanMoves(data.moves), label: String(data.label ?? "Ask Raptor scenario").slice(0, 80) };
  } catch { return null; }
}

/** Optimizer weekly xP is before hits; its horizon total already deducts hits. */
export function netWeekPoints(week: Pick<PlanWeek, "expected_points" | "hits">): number {
  return Number(week.expected_points) - week.hits * 4;
}

/** Unknown projections must not appear as known zeroes in the drafting UI. */
export function hasDraftProjection(week: DraftWeek, coverage: PredictionCoverage): boolean {
  const counted = week.chip === "bboost" ? [...week.xi, ...week.bench] : week.xi;
  return counted.length > 0 && counted.every((id) => coverage[id]?.includes(week.gameweek));
}
