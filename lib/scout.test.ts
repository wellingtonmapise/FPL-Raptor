import { describe, expect, it } from "vitest";
import type { Fixture, Team } from "@/lib/gameweek";
import {
  differentials,
  fixtureTicker,
  minutesFloor,
  sortStats,
  statRow,
  type PlayerStats,
  type ScoutPlayer,
} from "@/lib/scout";

const teams: Team[] = [
  { id: 1, name: "Arsenal", short_name: "ARS" },
  { id: 2, name: "Burnley", short_name: "BUR" },
  { id: 3, name: "Chelsea", short_name: "CHE" },
  { id: 4, name: "Leeds", short_name: "LEE" },
];

const fx = (id: number, gw: number, h: number, a: number, hd: number, ad: number): Fixture => ({
  id,
  gameweek_id: gw,
  home_team_id: h,
  away_team_id: a,
  home_difficulty: hd,
  away_difficulty: ad,
  kickoff_time: `2026-10-${10 + gw}T1${id % 10}:00:00Z`,
});

describe("fixtureTicker", () => {
  const fixtures = [
    fx(1, 6, 1, 2, 2, 5), // ARS easy, BUR hard
    fx(2, 6, 3, 4, 3, 3),
    fx(3, 7, 2, 1, 4, 3),
    fx(4, 7, 4, 3, 2, 4),
    fx(5, 7, 1, 4, 2, 4), // a double gameweek for ARS and LEE
  ];
  it("lists each club's matches per gameweek, doubles and blanks included", () => {
    const rows = fixtureTicker(teams, fixtures, [6, 7]);
    const ars = rows.find((r) => r.team.short_name === "ARS")!;
    expect(ars.weeks).toEqual([
      [{ opponent: "BUR", home: true, difficulty: 2 }],
      [
        { opponent: "BUR", home: false, difficulty: 3 },
        { opponent: "LEE", home: true, difficulty: 2 },
      ],
    ]);
    const blank = fixtureTicker(teams, [fx(1, 6, 1, 2, 2, 5)], [6]).find((r) => r.team.short_name === "CHE")!;
    expect(blank.weeks).toEqual([[]]);
    expect(blank.ease).toBe(0);
  });
  it("puts the kindest run first", () => {
    const rows = fixtureTicker(teams, fixtures, [6, 7]);
    expect(rows[0].team.short_name).toBe("ARS"); // 4 + 3 + 4 = 11
    expect(rows.at(-1)!.team.short_name).toBe("BUR"); // 1 + 2 = 3
    expect(rows[0].averageDifficulty).toBeCloseTo(7 / 3);
  });
});

const player = (id: number, extra: Partial<ScoutPlayer> = {}): ScoutPlayer => ({
  id,
  web_name: `P${id}`,
  team_id: 1,
  position: 3,
  now_cost: 60,
  status: "a",
  chance_of_playing_next_round: null,
  selected_by_percent: 5,
  form: 3,
  total_points: 30,
  ...extra,
});

const stats = (id: number, extra: Partial<PlayerStats> = {}): PlayerStats => ({
  player_id: id,
  minutes: 450,
  goals: 1,
  assists: 1,
  clean_sheets: 0,
  defensive_contribution: 20,
  xg: 1.5,
  xa: 1.0,
  xgc: 5,
  recent_gameweeks: 5,
  recent_minutes: 450,
  recent_points: 30,
  recent_xg: 1.5,
  recent_xa: 1.0,
  recent_dc: 20,
  xp_gameweek: 6,
  xp_next: 4,
  xp_next5: 20,
  ...extra,
});

describe("statRow and sortStats", () => {
  it("works out per-90 numbers above a minutes floor", () => {
    const row = statRow(player(1), stats(1), "season", 180);
    expect(row.xgi90).toBeCloseTo(0.5);
    expect(row.dc90).toBeCloseTo(4);
    expect(row.xgc90).toBeCloseTo(1);
    expect(statRow(player(1), stats(1, { minutes: 100 }), "season", 180).xgi90).toBeNull();
  });
  it("sorts by the chosen column", () => {
    const rows = [
      statRow(player(1), stats(1, { xp_next5: 10 }), "season", 90),
      statRow(player(2, { now_cost: 120 }), stats(2, { xp_next5: 25 }), "season", 90),
      statRow(player(3), stats(3, { xg: 6 }), "season", 90),
    ];
    expect(sortStats(rows, "xp").map((r) => r.player.id)).toEqual([2, 3, 1]);
    expect(sortStats(rows, "xgi90").map((r) => r.player.id)).toEqual([3, 2, 1]);
    expect(sortStats(rows, "price")[0].player.id).toBe(2);
  });
  it("needs a third of the possible minutes for per-90s", () => {
    expect(minutesFloor(1)).toBe(90);
    expect(minutesFloor(6)).toBe(178);
  });
});

describe("differentials", () => {
  it("keeps low-owned players your league and you don't have, best outlook first", () => {
    const rows = [
      statRow(player(1, { selected_by_percent: 3 }), stats(1, { xp_next5: 18 }), "season", 90),
      statRow(player(2, { selected_by_percent: 40 }), stats(2, { xp_next5: 30 }), "season", 90), // template
      statRow(player(3, { selected_by_percent: 2 }), stats(3, { xp_next5: 22 }), "season", 90), // you own him
      statRow(player(4, { selected_by_percent: 6 }), stats(4, { xp_next5: 25 }), "season", 90), // half the league has him
      statRow(player(5, { selected_by_percent: 1, status: "i", chance_of_playing_next_round: 0 }), stats(5, { xp_next5: 9 }), "season", 90),
      statRow(player(6, { selected_by_percent: 8 }), stats(6, { xp_next5: 20 }), "season", 90),
    ];
    const owners = new Map([[4, 5], [6, 1]]);
    const got = differentials(rows, owners, 10, new Set([3]));
    expect(got.map((d) => [d.row.player.id, d.owners])).toEqual([
      [6, 1],
      [1, 0],
    ]);
  });
});
