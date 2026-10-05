import { describe, expect, it } from "vitest";
import type { DraftBase } from "@/lib/draft";
import {
  describeTool,
  findPlayers,
  fixtureRun,
  normalise,
  playerDetails,
  resolvePlayer,
  runTool,
  searchPlayers,
  squadBrief,
  whatIf,
  type AskData,
  type AskPlayer,
} from "@/lib/ask/tools";

// Squad: GK 1-2, DEF 3-7, MID 8-12, FWD 13-15 (clubs 1-5). Market: 20-25.
const P = (id: number, position: number, team: number, price: number, xp: number[], extra: Partial<AskPlayer> = {}): AskPlayer => ({
  id,
  name: `P${id}`,
  fullName: `Player ${id}`,
  team,
  club: `C${team}`,
  position,
  price,
  status: "a",
  chance: null,
  owned: 5,
  xp,
  news: "",
  form: 3,
  points: 20,
  minutes: 450,
  goals: 1,
  assists: 1,
  xg: 1.5,
  xa: 1,
  dc: 20,
  recent: { gameweeks: 5, minutes: 450, points: 20, xg: 1.5, xa: 1 },
  leagueOwners: 2,
  ...extra,
});
const squad = [
  P(1, 1, 1, 50, [5, 5, 5]),
  P(2, 1, 2, 40, [2, 2, 2]),
  ...[3, 4, 5, 6, 7].map((id, k) => P(id, 2, 1 + Math.floor((id - 2) / 3), 50, [4 - k * 0.5, 4 - k * 0.5, 4 - k * 0.5])),
  ...[8, 9, 10, 11, 12].map((id, k) => P(id, 3, 3 + Math.floor((id - 8) / 3), 70, [5 - k * 0.5, 5 - k * 0.5, 5 - k * 0.5])),
  ...[13, 14, 15].map((id, k) => P(id, 4, 5, 75, [6 - k, 6 - k, 6 - k])),
];
squad[11] = { ...squad[11], name: "Saka", fullName: "Bukayo Saka", status: "d", chance: 50, news: "Hamstring - 50% chance of playing" };
const market = [
  P(20, 3, 6, 75, [9, 9, 9], { name: "Palmer", fullName: "Cole Palmer", leagueOwners: 9 }),
  P(21, 3, 1, 140, [12, 12, 12], { name: "M.Salah", fullName: "Mohamed Salah Hamed Ghaly" }),
  P(22, 4, 7, 60, [2, 8, 8], { name: "Gabriel", fullName: "Gabriel Jesus", leagueOwners: 0 }),
  P(23, 2, 8, 60, [3, 3, 3], { name: "Gabriel", fullName: "Gabriel dos Santos Magalhães" }),
  P(24, 3, 9, 65, [0, 0, 0], { name: "Ødegaard", fullName: "Martin Ødegaard", status: "i", chance: 0 }),
  P(25, 3, 6, 55, [6, 6, 6], { name: "B.Fernandes", fullName: "Bruno Borges Fernandes", leagueOwners: 1 }),
];
const base: DraftBase = {
  gameweeks: [6, 7, 8],
  squad: squad.map((p) => p.id),
  bank: 10,
  freeTransfers: 1,
  sell: { 12: 68 },
  chipsLeft: [
    { chip: "wildcard", from: 2, expires: 19 },
    { chip: "3xc", from: 1, expires: 19 },
  ],
};
const clubs = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, short: `C${i + 1}`, name: `Club ${i + 1}` }));
const data: AskData = {
  base,
  players: [...squad, ...market],
  fixtures: {
    6: { 6: [{ opponent: "C1", home: true, difficulty: 2 }], 7: [{ opponent: "C2", home: false, difficulty: 2 }], 8: [] },
    1: { 6: [{ opponent: "C6", home: false, difficulty: 5 }], 7: [{ opponent: "C3", home: true, difficulty: 4 }], 8: [{ opponent: "C4", home: true, difficulty: 4 }] },
  },
  clubs,
  botMoves: [{ kind: "transfer", gw: 6, out: 12, in: 20 }],
  leagueSquads: 15,
  gameweeksPlayed: 5,
};

describe("finding players", () => {
  it("normalises accents and punctuation", () => {
    expect(normalise("Ødegaard")).toBe("odegaard");
    expect(normalise("B.Fernandes")).toBe("b fernandes");
  });

  it("matches surnames, first names, full names, ids and clubs", () => {
    expect(findPlayers(data, "saka")[0].id).toBe(12);
    expect(findPlayers(data, "Bruno")[0].id).toBe(25);
    expect(findPlayers(data, "Mo Salah")[0].id).toBe(21); // "mo" starts "Mohamed"
    expect(findPlayers(data, "Zlatan")).toEqual([]);
    expect(findPlayers(data, "Salah")[0].id).toBe(21);
    expect(findPlayers(data, "odegaard")[0].id).toBe(24);
    expect(findPlayers(data, "20")[0].id).toBe(20);
    expect(findPlayers(data, "Gabriel C8").map((p) => p.id)).toEqual([23]);
  });

  it("asks for an id when a name is ambiguous", () => {
    const both = resolvePlayer(data, "Gabriel");
    expect("error" in both && both.error).toContain("id 22");
    expect("error" in both && both.error).toContain("id 23");
    const one = resolvePlayer(data, "Gabriel Jesus");
    expect("player" in one && one.player.id).toBe(22);
    expect("error" in resolvePlayer(data, "Nobody")).toBe(true);
  });
});

describe("search_players", () => {
  it("filters by position and price and ranks by expected points", () => {
    const { result, players } = searchPlayers(data, { position: "MID", max_price: 7.5, exclude_my_squad: true });
    const rows = (result as { players: { name: string; price: number; xp_total: number }[] }).players;
    expect(rows.map((r) => r.name)).toEqual(["Palmer", "B.Fernandes", "Ødegaard"]);
    expect(rows[0]).toMatchObject({ price: 7.5, xp_total: 27, owned_in_league: "9/15" });
    expect(players).toEqual([20, 25, 24]);
  });

  it("finds league differentials and skips the injured", () => {
    const { result } = searchPlayers(data, { position: "MID", league_differentials: true, available_only: true, exclude_my_squad: true });
    expect((result as { players: { name: string }[] }).players.map((r) => r.name)).toEqual(["M.Salah", "B.Fernandes"]);
  });

  it("explains an unknown club", () => {
    expect(searchPlayers(data, { club: "Wrexham" }).result).toHaveProperty("error");
  });
});

describe("player_details", () => {
  it("gives stats, selling price, news and fixtures", () => {
    const { result, players } = playerDetails(data, { players: ["Saka", "Palmer"] });
    const [saka, palmer] = (result as { players: Record<string, unknown>[] }).players;
    expect(saka).toMatchObject({ name: "Saka", sells_for: 6.8, status: "doubtful (50% chance)", in_my_squad: true });
    expect(saka.news).toContain("Hamstring");
    expect(palmer).not.toHaveProperty("sells_for");
    expect(palmer.fixtures).toEqual([
      { gameweek: 6, games: ["C1 (H) difficulty 2"] },
      { gameweek: 7, games: ["C2 (A) difficulty 2"] },
      { gameweek: 8, games: ["blank"] },
    ]);
    expect(players).toEqual([12, 20]);
  });
});

describe("fixture_run", () => {
  it("ranks clubs by how kind their run is", () => {
    const { result } = fixtureRun(data, { clubs: ["C1", "C6"] });
    const rows = (result as { clubs: { club: string; ease: number; rank: number }[] }).clubs;
    expect(rows.map((r) => [r.club, r.ease])).toEqual([
      ["C6", 8],
      ["C1", 5],
    ]);
    expect(rows[0].rank).toBe(1);
    expect(fixtureRun(data, { clubs: ["Nowhere"] }).result).toHaveProperty("error");
  });
});

describe("what_if", () => {
  it("compares a transfer with doing nothing and with the bot's plan", () => {
    const { result, scenario } = whatIf(data, { transfers: [{ out: "Saka", in: "Palmer" }] });
    const r = result as { gain_vs_doing_nothing: number; gain_vs_bot_plan: number; weeks: { transfers: string[]; hits: number; bank_after: number }[] };
    expect(r.weeks[0].transfers).toEqual(["Saka → Palmer"]);
    expect(r.weeks[0].hits).toBe(0);
    expect(r.weeks[0].bank_after).toBe(0.3); // 1.0 + 6.8 - 7.5
    expect(r.gain_vs_doing_nothing).toBeGreaterThan(0);
    expect(r.gain_vs_bot_plan).toBe(0); // it's the bot's move
    expect(scenario).toMatchObject({ label: "Saka → Palmer", moves: [{ kind: "transfer", gw: 6, out: 12, in: 20 }] });
  });

  it("charges hits and plays chips", () => {
    const hit = whatIf(data, {
      transfers: [
        { gameweek: 6, out: "Saka", in: "Palmer" },
        { gameweek: 6, out: "P11", in: "B.Fernandes" },
      ],
    }).result as { weeks: { hits: number }[] };
    expect(hit.weeks[0].hits).toBe(1);
    const wc = whatIf(data, {
      chips: [{ gameweek: 6, chip: "wildcard" }],
      transfers: [
        { gameweek: 6, out: "Saka", in: "Palmer" },
        { gameweek: 6, out: "P11", in: "B.Fernandes" },
      ],
    });
    expect((wc.result as { weeks: { hits: number; chip?: string }[] }).weeks[0]).toMatchObject({ hits: 0, chip: "Wildcard" });
    expect(wc.scenario?.label).toBe("Wildcard GW6, Saka → Palmer, P11 → B.Fernandes");
  });

  it("reports problems instead of a scenario", () => {
    const freehit = whatIf(data, { chips: [{ gameweek: 6, chip: "freehit" }] });
    expect((freehit.result as { problems: string[] }).problems[0]).toContain("no Free Hit left");
    expect(freehit.scenario).toBeUndefined();
    expect(whatIf(data, { transfers: [{ out: "Saka", in: "Gabriel" }] }).result).toHaveProperty("error");
    expect(whatIf(data, { transfers: [{ gameweek: 30, out: "Saka", in: "Palmer" }] }).result).toHaveProperty("error");
    expect(whatIf(data, {}).result).toHaveProperty("error");
  });
});

describe("runTool and labels", () => {
  it("turns unknown tools and bad arguments into errors the model can read", () => {
    expect(runTool(data, "delete_everything", {}).result).toEqual({ error: "No tool called delete_everything." });
    expect(runTool(data, "player_details", null).result).toHaveProperty("error");
  });

  it("describes each call in plain words", () => {
    expect(describeTool("search_players", { position: "MID", max_price: 8 })).toBe("Searching mids under £8m");
    expect(describeTool("search_players", { position: "GK" })).toBe("Searching keepers");
    expect(describeTool("player_details", { players: ["Saka", "Palmer"] })).toBe("Checking Saka, Palmer");
    expect(describeTool("what_if", { transfers: [{ out: "Saka", in: "Palmer" }] })).toBe("Running the numbers on Saka → Palmer");
    expect(describeTool("what_if", { chips: [{ chip: "wildcard" }] })).toBe("Running the numbers on a Wildcard");
  });
});

describe("squadBrief", () => {
  it("lists the XI, bench, bank, chips and the bot's plan", () => {
    const brief = squadBrief(data, { teamName: "JP Morgan", leagueName: "BiG ReD", deadline: "Sat, 10 Oct 2026 10:00:00 UTC", botSummary: "GW6: Saka → Palmer" });
    expect(brief).toContain("Planned gameweeks: 6, 7, 8");
    expect(brief).toContain("Bank £1m, 1 free transfer. Chips left: Wildcard (usable GW2-19), Triple Captain (usable GW1-19).");
    expect(brief).toContain("- Saka (id 12, C4 MID), sells £6.8m, xP 3 / 3 / 3, doubtful (50% chance): Hamstring");
    expect(brief).toContain("Mini-league: BiG ReD (15 other squads)");
    expect(brief).toContain("The bot's plan: GW6: Saka → Palmer");
  });
});
