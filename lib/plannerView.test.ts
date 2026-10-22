import { describe, expect, it } from "vitest";
import type { DraftWeek, Move } from "@/lib/draft";
import { draftStorageKey, hasDraftProjection, moveSignature, netWeekPoints, readLocalDraft, readPlannerHandoff } from "@/lib/plannerView";

const moves: Move[] = [{ kind: "captain", gw: 9, id: 7 }];

describe("Planner persistence", () => {
  it("separates accounts, linked teams and gameweeks", () => {
    const keys = [draftStorageKey("one", 12, 9), draftStorageKey("two", 12, 9), draftStorageKey("one", 13, 9), draftStorageKey("one", 12, 10)];
    expect(new Set(keys).size).toBe(4);
  });
  it("restores moves, saved identity and the saved baseline independently", () => {
    const stored = readLocalDraft(JSON.stringify({ moves, draft: { id: "saved-id", name: "My plan" }, savedMoves: [] }));
    expect(stored).toEqual({ moves, draft: { id: "saved-id", name: "My plan" }, savedMoves: [] });
    expect(moveSignature(stored!.moves)).not.toBe(moveSignature(stored!.savedMoves));
  });
  it("rejects corrupt storage and sanitizes old drafts without dropping valid moves", () => {
    expect(readLocalDraft("broken")).toBeNull();
    expect(readLocalDraft('{"moves":{}}')).toBeNull();
    expect(readLocalDraft(JSON.stringify({ moves: [...moves, { kind: "invented", gw: 9 }], draft: { id: null, name: "Old" } }))).toEqual({ moves, draft: null, savedMoves: [] });
  });
  it("accepts only handoffs for the current deadline and sanitizes their moves", () => {
    const value = JSON.stringify({ gameweek: 9, label: "Captain scenario", moves });
    expect(readPlannerHandoff(value, 9)).toEqual({ label: "Captain scenario", moves });
    expect(readPlannerHandoff(value, 10)).toBeNull();
    expect(readPlannerHandoff("broken", 9)).toBeNull();
  });
});

describe("Planner projections", () => {
  it("deducts each four-point hit from weekly optimizer points exactly once", () => {
    expect(netWeekPoints({ expected_points: 60, hits: 0 })).toBe(60);
    expect(netWeekPoints({ expected_points: 60, hits: 2 })).toBe(52);
  });
  it("requires predictions for every counting player, including a boosted bench", () => {
    const week = { gameweek: 9, xi: [1, 2], bench: [3], chip: null } as DraftWeek;
    const coverage = { 1: [9], 2: [9] };
    expect(hasDraftProjection(week, coverage)).toBe(true);
    expect(hasDraftProjection({ ...week, gameweek: 10 }, coverage)).toBe(false);
    expect(hasDraftProjection({ ...week, chip: "bboost" }, coverage)).toBe(false);
    expect(hasDraftProjection({ ...week, chip: "bboost" }, { ...coverage, 3: [9] })).toBe(true);
  });
});
