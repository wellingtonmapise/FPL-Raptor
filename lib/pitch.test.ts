import { describe, expect, it } from "vitest";
import type { SquadPlayer } from "@/lib/gameweek";
import type { TeamLive } from "@/lib/live";
import { fixtureCaption, livePitch, planPitch, teamPitch } from "@/lib/pitch";
import type { PlanWeek } from "@/lib/plan";

function squadPlayer(id: number, extra: Partial<SquadPlayer> = {}): SquadPlayer {
  return {
    player_id: id,
    squad_position: id,
    multiplier: 1,
    is_captain: false,
    is_vice_captain: false,
    player: { id, web_name: `P${id}`, team_id: 1, position: 3, now_cost: 60, status: "a", news: "", chance_of_playing_next_round: null },
    club: "ARS",
    fixtures: [{ opponent: "EVE", home: true, difficulty: 2 }],
    flagged: false,
    ...extra,
  };
}

describe("fixtureCaption", () => {
  it("writes one fixture with H/A and a double in FPL's capitals style", () => {
    expect(fixtureCaption([{ opponent: "EVE", home: true, difficulty: 2 }])).toEqual({ caption: "EVE (H)", tone: "fdr2" });
    expect(
      fixtureCaption([
        { opponent: "EVE", home: true, difficulty: 2 },
        { opponent: "LIV", home: false, difficulty: 4 },
      ]),
    ).toEqual({ caption: "EVE liv", tone: "fdr2" });
    expect(fixtureCaption([])).toEqual({ caption: "No match", tone: "muted" });
  });
});

describe("teamPitch", () => {
  it("puts xP on the shirt, the fixture underneath, and marks captain and flags", () => {
    const captain = squadPlayer(9, { is_captain: true, multiplier: 2 });
    const doubtful = squadPlayer(5, {
      flagged: true,
      player: { id: 5, web_name: "Palmer", team_id: 6, position: 3, now_cost: 105, status: "d", news: "", chance_of_playing_next_round: 75 },
    });
    const injured = squadPlayer(13, {
      flagged: true,
      player: { id: 13, web_name: "Timber", team_id: 1, position: 2, now_cost: 57, status: "i", news: "", chance_of_playing_next_round: 0 },
    });
    const { starters, bench } = teamPitch([captain, doubtful], [injured], new Map([[9, 7.84]]));
    expect(starters[0]).toMatchObject({ name: "P9", caption: "EVE (H)", tone: "fdr2", number: "7.8", badge: "C", alert: null });
    expect(starters[1]).toMatchObject({ name: "Palmer", number: null, alert: "doubtful" });
    expect(bench[0]).toMatchObject({ alert: "out", position: 2 });
  });
});

describe("livePitch", () => {
  it("shows points with the multiplier and marks subs", () => {
    const base = { player: { id: 0, web_name: "", team_id: 1, position: 3 }, bonus: 0, provisional: false, fixtures: [] };
    const pick = (element: number, position: number, extra: object) => ({
      ...base,
      pick: { element, position, multiplier: 1, is_captain: false, is_vice_captain: false },
      player: { id: element, web_name: `P${element}`, team_id: 1, position: 3 },
      points: 2,
      minutes: 90,
      status: "played" as const,
      counts: true,
      multiplier: 1,
      subbedIn: false,
      subbedOut: false,
      ...extra,
    });
    const cap = pick(9, 1, { points: 8, multiplier: 2, pick: { element: 9, position: 1, multiplier: 2, is_captain: true, is_vice_captain: false } });
    const off = pick(4, 2, { points: 0, minutes: 0, status: "out", counts: false, multiplier: 0, subbedOut: true });
    const on = pick(15, 12, { points: 3, subbedIn: true });
    const upcoming = pick(7, 3, { points: 0, minutes: 0, status: "to-play" });
    const team = { picks: [cap, off, upcoming, on], captain: cap } as unknown as TeamLive;
    const { starters, bench } = livePitch(team, () => "ARS");
    expect(starters.map((s) => [s.caption, s.badge, !!s.dim])).toEqual([
      ["16", "C", false],
      ["0", null, true],
      ["–", null, false],
    ]);
    expect(bench[0]).toMatchObject({ caption: "3", ring: "sub", dim: false });
  });
});

describe("planPitch", () => {
  it("rings new signings and shows each player's xP", () => {
    const p = (id: number, position: number, xp: number) => ({ id, name: `P${id}`, position, team: 1, price: 50, xp });
    const week: PlanWeek = {
      gameweek: 6,
      free_transfers: 1,
      hits: 0,
      transfers: [{ out: p(4, 2, 0), in: p(20, 2, 4.8) }],
      captain: p(9, 4, 7.8),
      lineup: [p(1, 1, 3.9), p(20, 2, 4.8), p(9, 4, 7.8)],
      bench: [p(12, 1, 3.1)],
      expected_points: 60,
      bank_after: 9,
      chip: "3xc",
    };
    const { starters, bench } = planPitch(week, () => "LIV");
    expect(starters.map((s) => [s.caption, s.ring ?? null, s.badge ?? null])).toEqual([
      ["3.9 xP", null, null],
      ["4.8 xP", "in", null],
      ["7.8 xP", null, "TC"],
    ]);
    expect(bench[0]).toMatchObject({ dim: true, club: "LIV" });
  });
});

describe("kits", () => {
  it("knows club colours and falls back to a neutral shirt", async () => {
    const { goalkeeperKit, isLight, kitFor } = await import("@/lib/kits");
    expect(kitFor("new")).toEqual({ body: "#241F20", trim: "#FFFFFF", pattern: "stripes" });
    expect(kitFor("XYZ").pattern).toBe("solid");
    expect(goalkeeperKit("TOT").trim).toBe("#132257"); // white shirts show their trim colour
    expect(isLight("#6CABDD")).toBe(true); // sky blue: dark numbers
    expect(isLight("#034694")).toBe(false);
  });
});
