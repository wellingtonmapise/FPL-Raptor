import { describe, expect, it } from "vitest";
import {
  captainChoices,
  closestRival,
  differentials,
  firstName,
  movement,
  netPoints,
  ordinal,
  ownership,
  threats,
  weeklyAwards,
  type EntryGameweek,
  type LeaguePick,
  type Member,
  type PlayerName,
} from "@/lib/league";

const members: Member[] = [
  { team_id: 1, manager_name: "Wellington Mapise", team_name: "JP Morgan", rank: 1, last_rank: 1, total: 366, event_total: 50 },
  { team_id: 2, manager_name: "Takunda Chikuvire", team_name: "CF Madhunatwuna", rank: 2, last_rank: 4, total: 361, event_total: 56 },
  { team_id: 3, manager_name: "Benjamin Karanja", team_name: "Kilgoris", rank: 3, last_rank: 2, total: 332, event_total: 27 },
];

const players = new Map<number, PlayerName>(
  [
    [9, "Haaland"],
    [7, "Salah"],
    [5, "Palmer"],
    [6, "Saka"],
    [8, "Rogers"],
    [12, "Pickford"],
  ].map(([id, web_name]) => [id as number, { id: id as number, web_name: web_name as string }]),
);

const pick = (team_id: number, player_id: number, multiplier = 1, is_captain = false, squad_position = 1): LeaguePick => ({
  team_id,
  player_id,
  multiplier,
  is_captain,
  squad_position,
});

const picks: LeaguePick[] = [
  // Wellington: Haaland (C), Salah, Rogers; Pickford benched
  pick(1, 9, 2, true), pick(1, 7), pick(1, 8), pick(1, 12, 0, false, 12),
  // Takunda: Salah (C), Haaland, Palmer
  pick(2, 7, 2, true), pick(2, 9), pick(2, 5),
  // Benjamin: Haaland (C), Saka, Palmer
  pick(3, 9, 2, true), pick(3, 6), pick(3, 5),
];

const entries: EntryGameweek[] = [
  { team_id: 1, points: 50, points_on_bench: 17, event_transfers: 1, event_transfers_cost: 0, active_chip: null },
  { team_id: 2, points: 60, points_on_bench: 2, event_transfers: 2, event_transfers_cost: 4, active_chip: null },
  { team_id: 3, points: 27, points_on_bench: 5, event_transfers: 0, event_transfers_cost: 0, active_chip: "bboost" },
];

const points = new Map([
  [9, 13],
  [7, 2],
  [5, 6],
  [6, 8],
  [8, 3],
  [12, 17],
]);

describe("small helpers", () => {
  it("movement, names, ordinals and net points", () => {
    expect(movement(members[1])).toBe(2);
    expect(movement(members[2])).toBe(-1);
    expect(firstName("Wellington Mapise")).toBe("Wellington");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
    expect(netPoints(entries[1])).toBe(56);
  });
});

describe("weeklyAwards", () => {
  it("hands out every award, counting hits against points", () => {
    const awards = Object.fromEntries(weeklyAwards(members, entries, picks, points, players).map((a) => [a.id, a]));
    expect(awards.top).toMatchObject({ manager_name: "Takunda Chikuvire", value: "56 pts" });
    expect(awards.spoon).toMatchObject({ manager_name: "Benjamin Karanja", value: "27 pts" });
    expect(awards.captain_hero).toMatchObject({ manager_name: "Wellington Mapise", value: "Haaland, 26 pts" });
    expect(awards.captain_fail).toMatchObject({ manager_name: "Takunda Chikuvire", value: "Salah, 4 pts" });
    expect(awards.bench).toMatchObject({ manager_name: "Wellington Mapise", value: "17 pts benched" });
    expect(awards.hit).toMatchObject({ manager_name: "Takunda Chikuvire", value: "−4" });
  });

  it("skips captain awards without player points", () => {
    const ids = weeklyAwards(members, entries, picks, null, players).map((a) => a.id);
    expect(ids).not.toContain("captain_hero");
    expect(ids).not.toContain("captain_fail");
  });
});

describe("captainChoices", () => {
  it("groups captains by player, most popular first", () => {
    expect(captainChoices(members, picks, players, points)).toEqual([
      { player_id: 9, web_name: "Haaland", count: 2, managers: ["Wellington", "Benjamin"], points: 13 },
      { player_id: 7, web_name: "Salah", count: 1, managers: ["Takunda"], points: 2 },
    ]);
  });
});

describe("ownership", () => {
  const { squads, rows } = ownership(picks, players, 1);
  const row = (name: string) => rows.find((r) => r.web_name === name)!;

  it("counts squads, share and effective ownership", () => {
    expect(squads).toBe(3);
    expect(row("Haaland")).toMatchObject({ owners: 3, mine: true });
    expect(row("Haaland").effective).toBeCloseTo(5 / 3); // two captains + one starter
    expect(row("Pickford")).toMatchObject({ owners: 1, mine: false }); // benched, so not "mine"
  });

  it("finds differentials and threats", () => {
    expect(differentials(rows).map((r) => r.web_name)).toEqual([]); // Rogers is a third of squads, over a quarter
    expect(differentials(ownership([...picks, pick(4, 5), pick(4, 9)], players, 1).rows).map((r) => r.web_name)).toEqual(["Rogers"]);
    expect(threats(rows).map((r) => r.web_name)).toEqual(["Palmer"]);
  });
});

describe("closestRival", () => {
  it("compares the leader with the manager chasing them", () => {
    const r = closestRival(members, picks, players, 1)!;
    expect(r.rival.manager_name).toBe("Takunda Chikuvire");
    expect(r.ahead).toBe(false);
    expect(r.gap).toBe(5);
    expect(r.onlyThem).toEqual(["Palmer"]);
    expect(r.onlyMe).toEqual(["Rogers"]);
    expect(r.theirCaptain).toBe("Salah");
    expect(r.myCaptain).toBe("Haaland");
  });

  it("compares everyone else with the manager directly above", () => {
    const r = closestRival(members, picks, players, 3)!;
    expect(r.rival.team_id).toBe(2);
    expect(r.ahead).toBe(true);
    expect(r.gap).toBe(29);
  });

  it("returns null when you're not in the league", () => {
    expect(closestRival(members, picks, players, 99)).toBeNull();
  });
});
