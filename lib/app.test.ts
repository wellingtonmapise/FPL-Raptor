import { describe, expect, it } from "vitest";
import { supabaseEnv } from "@/lib/env";
import {
  buildSquad,
  fixturesFor,
  isFlagged,
  nextGameweek,
  type Fixture,
  type Pick,
  type Player,
  type Team,
} from "@/lib/gameweek";
import { parseTeamId } from "@/lib/teamId";

const teams: Team[] = [
  { id: 1, name: "Arsenal", short_name: "ARS" },
  { id: 6, name: "Chelsea", short_name: "CHE" },
  { id: 14, name: "Man City", short_name: "MCI" },
];

function player(id: number, overrides: Partial<Player> = {}): Player {
  return {
    id,
    web_name: `P${id}`,
    team_id: 1,
    position: 3,
    now_cost: 60,
    status: "a",
    news: "",
    chance_of_playing_next_round: null,
    ...overrides,
  };
}

function pick(player_id: number, squad_position: number, extra: Partial<Pick> = {}): Pick {
  return {
    player_id,
    squad_position,
    multiplier: squad_position <= 11 ? 1 : 0,
    is_captain: false,
    is_vice_captain: false,
    ...extra,
  };
}

describe("isFlagged", () => {
  it("flags anything not fully available", () => {
    expect(isFlagged(player(1))).toBe(false);
    expect(isFlagged(player(1, { chance_of_playing_next_round: 100 }))).toBe(false);
    expect(isFlagged(player(1, { status: "d", chance_of_playing_next_round: 75 }))).toBe(true);
    expect(isFlagged(player(1, { status: "i", chance_of_playing_next_round: 0 }))).toBe(true);
    expect(isFlagged(player(1, { status: "s" }))).toBe(true);
    expect(isFlagged(player(1, { chance_of_playing_next_round: 50 }))).toBe(true);
  });
});

describe("fixturesFor", () => {
  const fixtures: Fixture[] = [
    { id: 1, gameweek_id: 6, home_team_id: 14, away_team_id: 1, home_difficulty: 4, away_difficulty: 5, kickoff_time: "2026-10-11T15:30:00Z" },
    { id: 2, gameweek_id: 6, home_team_id: 1, away_team_id: 6, home_difficulty: 3, away_difficulty: 4, kickoff_time: "2026-10-10T11:30:00Z" },
  ];

  it("uses each side's own difficulty and sorts by kickoff (double gameweek)", () => {
    expect(fixturesFor(1, fixtures, teams)).toEqual([
      { opponent: "CHE", home: true, difficulty: 3 },
      { opponent: "MCI", home: false, difficulty: 5 },
    ]);
  });

  it("returns nothing for a blank gameweek", () => {
    expect(fixturesFor(99, fixtures, teams)).toEqual([]);
  });
});

describe("buildSquad", () => {
  const players = [
    player(1, { position: 1 }),
    player(2, { position: 2 }),
    player(3, { position: 2 }),
    player(4, { position: 2 }),
    player(5, { position: 3, team_id: 6, status: "d", chance_of_playing_next_round: 75, news: "Knock" }),
    player(6, { position: 3 }),
    player(7, { position: 3 }),
    player(8, { position: 3 }),
    player(9, { position: 4, team_id: 14 }),
    player(10, { position: 4 }),
    player(11, { position: 4 }),
    player(12, { position: 1 }),
    player(13, { position: 2, status: "i" }),
    player(14, { position: 3 }),
    player(15, { position: 2 }),
  ];
  // Picks arrive in any order from the database.
  const picks = players
    .map((p, i) => pick(p.id, i + 1, p.id === 9 ? { is_captain: true, multiplier: 2 } : p.id === 5 ? { is_vice_captain: true } : {}))
    .reverse();

  const squad = buildSquad(picks, players, teams, []);

  it("splits starters and bench in squad order", () => {
    expect(squad.starters.map((s) => s.player_id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(squad.bench.map((s) => s.player_id)).toEqual([12, 13, 14, 15]);
  });

  it("works out the formation from starters", () => {
    expect(squad.formation).toBe("3-4-3");
  });

  it("finds captain, vice and flagged players (bench included)", () => {
    expect(squad.captain?.player_id).toBe(9);
    expect(squad.vice?.player_id).toBe(5);
    expect(squad.flagged.map((s) => s.player_id)).toEqual([5, 13]);
    expect(squad.starters[4].club).toBe("CHE");
  });

  it("copes with a player missing from the players table", () => {
    const partial = buildSquad([pick(999, 1)], [], teams, []);
    expect(partial.starters[0].player).toBeNull();
    expect(partial.starters[0].flagged).toBe(false);
  });
});

describe("nextGameweek", () => {
  const gws = [
    { id: 5, is_next: false, deadline_time: "2026-09-18T17:30:00Z" },
    { id: 6, is_next: false, deadline_time: "2026-10-10T10:00:00Z" },
    { id: 7, is_next: false, deadline_time: "2026-10-17T10:00:00Z" },
  ];

  it("prefers FPL's is_next flag", () => {
    expect(nextGameweek([...gws.slice(0, 2), { ...gws[2], is_next: true }])?.id).toBe(7);
  });

  it("otherwise takes the first future deadline", () => {
    expect(nextGameweek(gws, new Date("2026-10-03T12:00:00Z"))?.id).toBe(6);
    expect(nextGameweek(gws, new Date("2027-01-01T00:00:00Z"))).toBeNull();
  });
});

describe("parseTeamId", () => {
  it("accepts a bare id or a Points page link", () => {
    expect(parseTeamId("5057497")).toBe(5057497);
    expect(parseTeamId("  5057497 ")).toBe(5057497);
    expect(parseTeamId("https://fantasy.premierleague.com/entry/5057497/event/5")).toBe(5057497);
  });

  it("rejects anything else", () => {
    expect(parseTeamId("")).toBeNull();
    expect(parseTeamId("abc")).toBeNull();
    expect(parseTeamId("12 34")).toBeNull();
    expect(parseTeamId("0")).toBeNull();
  });
});

describe("supabaseEnv", () => {
  it("normalises the URL and trims the key", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = " https://x.supabase.co/rest/v1/ ";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x\n";
    expect(supabaseEnv()).toEqual({ url: "https://x.supabase.co", key: "sb_publishable_x" });
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(supabaseEnv()).toBeNull();
  });
});
