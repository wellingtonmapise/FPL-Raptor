import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferPlanRow } from "@/lib/plan";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fplApi", () => ({ getPicks: vi.fn() }));
import { loadDraftData } from "@/lib/draftData";

let rows: Record<string, unknown[]>;
let errors: Record<string, unknown>;
const client = { from: (table: string) => {
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query, range: () => query,
    maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: errors[table] ?? null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: errors[table] ?? null }).then(resolve),
  };
  return query;
} };
const plan = {
  from_gameweek: 9, free_transfers: 2, bank: 12,
  plan: { weeks: [], squad: [{ id: 1, sell: 70 }], chips_left: [{ chip: "3xc", from: 1, expires: 19 }] },
} as unknown as TransferPlanRow;

beforeEach(() => {
  errors = {};
  rows = {
    profiles: [{ fpl_team_id: 12 }],
    gameweeks: [{ id: 8, deadline_time: "2020-01-01", is_current: true }, { id: 9, deadline_time: "2100-01-01", is_current: false }],
    teams: [{ id: 1, short_name: "ARS" }],
    picks: Array.from({ length: 15 }, (_, i) => ({ player_id: i + 1 })),
    players: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, web_name: `Player ${i + 1}`, team_id: 1, position: 3, now_cost: 60, status: "a", chance_of_playing_next_round: 100, selected_by_percent: 1 })),
    predictions: Array.from({ length: 15 }, (_, i) => ({ player_id: i + 1, gameweek_id: 9, expected_points: 0, created_at: "2026-10-21" })),
    fixtures: [], entry_gameweeks: [{ bank: 45 }], planner_drafts: [],
  };
});

async function load(value: TransferPlanRow | null) { return loadDraftData(client as never, "viewer", value); }

describe("Draft data snapshots", () => {
  it("uses the current plan and returns account-specific persistence and known-zero coverage", async () => {
    const result = await load(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.storageKey).toBe("raptor-draft:viewer:12:gw9");
    expect(result.data.base).toMatchObject({ bank: 12, freeTransfers: 2, sell: { 1: 70 }, chipsLeft: [{ chip: "3xc", from: 1, expires: 19 }] });
    expect(result.data.predictionCoverage[1]).toEqual([9]);
  });
  it("does not reuse stale bank, selling prices, chips or free transfers", async () => {
    const result = await load({ ...plan, from_gameweek: 8, bank: 999 });
    if (!result.ok) throw Error(result.reason);
    expect(result.data.base).toMatchObject({ bank: 45, freeTransfers: 1, sell: {}, chipsLeft: [] });
    expect(result.data.botMoves).toBeNull();
    expect(result.data.notes.join(" ")).toContain("estimated as 1");
  });
  it("reports an assumed bank and withholds missing player details", async () => {
    rows.entry_gameweeks = [];
    const result = await load(null);
    if (!result.ok) throw Error(result.reason);
    expect(result.data.notes.join(" ")).toContain("assumes £0.0m");
    rows.players.pop();
    expect(await load(null)).toMatchObject({ ok: false, reason: "Some squad details couldn’t load. Try again in a moment." });
  });
  it("distinguishes a query outage from the end of the season or a blank fixture", async () => {
    errors.gameweeks = { message: "unavailable" };
    expect(await load(plan)).toMatchObject({ ok: false, reason: "Gameweek data couldn’t load. Try again in a moment." });
    errors = { fixtures: { message: "unavailable" } };
    const result = await load(plan);
    if (!result.ok) throw Error(result.reason);
    expect(result.data.fixturesAvailable).toBe(false);
    expect(result.data.notes.join(" ")).toContain("fixture labels are unavailable");
  });
});
