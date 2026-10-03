import { describe, expect, it } from "vitest";
import { buildPlayerCard, xpByGameweek, type CardPlayer, type ElementSummary } from "@/lib/player";

const teams = [
  { id: 1, name: "Arsenal", short_name: "ARS" },
  { id: 9, name: "Everton", short_name: "EVE" },
  { id: 12, name: "Liverpool", short_name: "LIV" },
  { id: 14, name: "Man City", short_name: "MCI" },
];

const saka: CardPlayer = {
  id: 6,
  web_name: "Saka",
  first_name: "Bukayo",
  second_name: "Saka",
  team_id: 1,
  position: 3,
  now_cost: 101,
  status: "a",
  news: "",
  chance_of_playing_next_round: null,
  selected_by_percent: 31.2,
  form: 6.4,
  total_points: 41,
};

const summary: ElementSummary = {
  fixtures: [
    { event: 7, team_h: 12, team_a: 1, is_home: false, difficulty: 4, kickoff_time: "2026-10-17T14:00:00Z" },
    { event: 6, team_h: 1, team_a: 9, is_home: true, difficulty: 2, kickoff_time: "2026-10-10T14:00:00Z" },
    { event: 7, team_h: 1, team_a: 14, is_home: true, difficulty: 4, kickoff_time: "2026-10-20T19:00:00Z" },
  ],
  history: [
    { round: 4, opponent_team: 14, was_home: false, team_h_score: 2, team_a_score: 1, minutes: 90, total_points: 2, kickoff_time: "2026-09-20T14:00:00Z" },
    { round: 5, opponent_team: 9, was_home: true, team_h_score: 3, team_a_score: 0, minutes: 85, total_points: 12, kickoff_time: "2026-09-27T14:00:00Z" },
  ],
};

describe("buildPlayerCard", () => {
  const card = buildPlayerCard(
    saka,
    teams,
    { minutes: 450, xg: 2.1, xa: 1.5, defensive_contribution: 18, xp_next5: 27.4 },
    new Map([[6, 6.9], [7, 9.8]]),
    summary,
  );

  it("lists the next fixtures in order, with the model's xP once per gameweek", () => {
    expect(card.upcoming).toEqual([
      { gameweek: 6, opponent: "EVE", home: true, difficulty: 2, xp: 6.9 },
      { gameweek: 7, opponent: "LIV", home: false, difficulty: 4, xp: 9.8 },
      { gameweek: 7, opponent: "MCI", home: true, difficulty: 4, xp: null },
    ]);
  });

  it("shows recent results newest first, his team's goals first", () => {
    expect(card.recent).toEqual([
      { gameweek: 5, opponent: "EVE", home: true, score: "3-0", result: "W", minutes: 85, points: 12 },
      { gameweek: 4, opponent: "MCI", home: false, score: "1-2", result: "L", minutes: 90, points: 2 },
    ]);
  });

  it("works out per-90 numbers and names", () => {
    expect(card.fullName).toBe("Bukayo Saka");
    expect(card.clubName).toBe("Arsenal");
    expect(card.xgi90).toBeCloseTo(0.72);
    expect(card.dc90).toBeCloseTo(3.6);
    expect(card.fplAvailable).toBe(true);
  });

  it("still works without FPL's summary or stats", () => {
    const bare = buildPlayerCard(saka, teams, null, new Map(), null);
    expect(bare.upcoming).toEqual([]);
    expect(bare.recent).toEqual([]);
    expect(bare.xgi90).toBeNull();
    expect(bare.fplAvailable).toBe(false);
  });
});

describe("xpByGameweek", () => {
  it("keeps the newest prediction per gameweek", () => {
    const got = xpByGameweek([
      { gameweek_id: 6, expected_points: 5, created_at: "2026-10-03T10:00:00Z" },
      { gameweek_id: 6, expected_points: 6.9, created_at: "2026-10-03T13:00:00Z" },
      { gameweek_id: 7, expected_points: 4.2, created_at: "2026-10-03T13:00:00Z" },
    ]);
    expect(got).toEqual(new Map([[6, 6.9], [7, 4.2]]));
  });
});
