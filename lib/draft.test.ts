import { describe, expect, it } from "vitest";
import {
  bestXI,
  canSwap,
  cleanMoves,
  movesFromPlan,
  replacements,
  simulate,
  type DraftBase,
  type DraftPlayer,
  type Move,
} from "@/lib/draft";

// Squad: GK 1-2, DEF 3-7, MID 8-12, FWD 13-15, three to a club (clubs 1-5).
// Market: 20 (MID, club 6, great), 21 (MID, club 1, pricey), 22 (FWD, club 7), 23 (GK, club 8).
const P = (id: number, position: number, team: number, price: number, xp: number[]): DraftPlayer => ({
  id,
  name: `P${id}`,
  team,
  club: `C${team}`,
  position,
  price,
  status: "a",
  chance: null,
  owned: 5,
  xp,
});
const squadPlayers = [
  P(1, 1, 1, 50, [5, 5, 5]),
  P(2, 1, 2, 40, [2, 2, 2]),
  ...[3, 4, 5, 6, 7].map((id, k) => P(id, 2, 1 + Math.floor((id - 2) / 3), 50, [4 - k * 0.5, 4 - k * 0.5, 4 - k * 0.5])),
  ...[8, 9, 10, 11, 12].map((id, k) => P(id, 3, 3 + Math.floor((id - 8) / 3), 70, [5 - k * 0.5, 5 - k * 0.5, 5 - k * 0.5])),
  ...[13, 14, 15].map((id, k) => P(id, 4, 5, 75, [6 - k, 6 - k, 6 - k])),
];
const market = [P(20, 3, 6, 75, [9, 9, 9]), P(21, 3, 1, 140, [12, 12, 12]), P(22, 4, 7, 60, [2, 8, 8]), P(23, 1, 8, 45, [6, 6, 6])];
const all = [...squadPlayers, ...market];
const players = new Map(all.map((p) => [p.id, p]));
const base: DraftBase = {
  gameweeks: [6, 7, 8],
  squad: squadPlayers.map((p) => p.id),
  bank: 10,
  freeTransfers: 1,
  sell: { 12: 68 },
  chipsLeft: [
    { chip: "wildcard", from: 2, expires: 19 },
    { chip: "3xc", from: 1, expires: 19 },
    { chip: "bboost", from: 1, expires: 19 },
    { chip: "freehit", from: 2, expires: 19 },
  ],
};

describe("bestXI", () => {
  it("picks the highest-scoring valid XI and benches the rest, keeper first", () => {
    const { xi, bench } = bestXI(base.squad, players, (id) => players.get(id)!.xp[0]);
    expect(xi).toHaveLength(11);
    expect(bench[0]).toBe(2); // the spare keeper
    // The three weakest outfielders (DEF 7 on 2.0, DEF 6 on 2.5, then one on 3.0), best sub first.
    expect(bench).toHaveLength(4);
    expect(bench).toContain(6);
    expect(bench.at(-1)).toBe(7);
  });
  it("honours forced starters", () => {
    const { xi } = bestXI(base.squad, players, (id) => players.get(id)!.xp[0], new Set([7]), new Set([3]));
    expect(xi).toContain(7);
    expect(xi).not.toContain(3);
  });
});

describe("simulate", () => {
  it("with no moves keeps the team, rolls free transfers and captains the best starter", () => {
    const r = simulate(base, players, []);
    expect(r.weeks.map((w) => w.freeTransfers)).toEqual([1, 2, 3]);
    expect(r.weeks[0].captain).toBe(13);
    expect(r.weeks[0].points).toBeCloseTo(r.weeks[0].xp);
    expect(r.problems).toEqual([]);
  });

  it("applies a transfer from its week on, with bank and selling prices", () => {
    const r = simulate(base, players, [{ kind: "transfer", gw: 6, out: 12, in: 20 }]);
    expect(r.weeks[0].transfers).toEqual([{ out: 12, in: 20 }]);
    expect(r.weeks[0].bankAfter).toBe(10 + 68 - 75);
    expect(r.weeks[2].squad).toContain(20);
    expect(r.weeks[0].hits).toBe(0);
    expect(r.weeks.map((w) => w.freeTransfers)).toEqual([1, 1, 2]);
    expect(r.total).toBeGreaterThan(simulate(base, players, []).total);
  });

  it("charges a hit beyond the free transfers", () => {
    const moves: Move[] = [
      { kind: "transfer", gw: 6, out: 12, in: 20 },
      { kind: "transfer", gw: 6, out: 15, in: 22 },
    ];
    const r = simulate(base, players, moves);
    expect(r.weeks[0].hits).toBe(1);
    expect(r.weeks[0].points).toBeCloseTo(r.weeks[0].xp - 4);
  });

  it("nets transfers within a week", () => {
    const twice = simulate(base, players, [
      { kind: "transfer", gw: 6, out: 12, in: 20 },
      { kind: "transfer", gw: 6, out: 20, in: 21 },
    ]);
    // 12 -> 20 -> 21 is one transfer, 12 -> 21 (but 21 is too dear, so the second is refused).
    expect(twice.weeks[0].transfers).toEqual([{ out: 12, in: 20 }]);
    expect(twice.problems).toEqual(["GW6: can't afford P21"]);
    const undone = simulate(base, players, [
      { kind: "transfer", gw: 6, out: 12, in: 20 },
      { kind: "transfer", gw: 6, out: 20, in: 12 },
    ]);
    expect(undone.weeks[0].transfers).toEqual([]);
    expect(undone.weeks[0].bankAfter).toBe(10);
    expect(undone.weeks[0].sell[12]).toBe(68);
  });

  it("refuses a fourth player from one club", () => {
    const r = simulate(base, players, [{ kind: "transfer", gw: 6, out: 2, in: 23 }]);
    expect(r.problems).toEqual([]); // club 8 is fine
    const busy = simulate({ ...base, bank: 200 }, players, [{ kind: "transfer", gw: 6, out: 12, in: 21 }]);
    expect(busy.problems).toEqual(["GW6: P21 would make four from one club"]);
  });

  it("plays chips: triple captain, bench boost, a wildcard without hits, a free hit that reverts", () => {
    const tc = simulate(base, players, [{ kind: "chip", gw: 6, chip: "3xc" }]);
    expect(tc.weeks[0].xp - simulate(base, players, []).weeks[0].xp).toBeCloseTo(6);
    const bb = simulate(base, players, [{ kind: "chip", gw: 7, chip: "bboost" }]);
    expect(bb.weeks[1].xp - simulate(base, players, []).weeks[1].xp).toBeCloseTo(2 + 2 + 2.5 + 3);
    const wc = simulate(base, players, [
      { kind: "chip", gw: 6, chip: "wildcard" },
      { kind: "transfer", gw: 6, out: 12, in: 20 },
      { kind: "transfer", gw: 6, out: 15, in: 22 },
    ]);
    expect(wc.weeks[0].hits).toBe(0);
    expect(wc.weeks[1].freeTransfers).toBe(2); // banked one kept, plus a new one
    const fh = simulate(base, players, [
      { kind: "chip", gw: 6, chip: "freehit" },
      { kind: "transfer", gw: 6, out: 12, in: 20 },
    ]);
    expect(fh.weeks[0].squad).toContain(20);
    expect(fh.weeks[1].squad).toContain(12);
    expect(fh.weeks[1].bankAfter).toBe(10);
  });

  it("allows each chip once", () => {
    const r = simulate(base, players, [
      { kind: "chip", gw: 6, chip: "3xc" },
      { kind: "chip", gw: 7, chip: "3xc" },
    ]);
    expect(r.weeks[1].chip).toBeNull();
    expect(r.problems).toEqual(["GW7: no Triple Captain left to play"]);
  });

  it("uses your captain and bench swaps for that week only", () => {
    const r = simulate(base, players, [
      { kind: "captain", gw: 6, id: 8 },
      { kind: "swap", gw: 6, bench: 3, start: 7 },
    ]);
    expect(r.weeks[0].captain).toBe(8);
    expect(r.weeks[0].xi).toContain(7);
    expect(r.weeks[0].bench).toContain(3);
    expect(r.weeks[1].captain).toBe(13);
    expect(r.weeks[1].xi).toContain(3);
  });
});

describe("canSwap and replacements", () => {
  const r = simulate(base, players, []);
  it("only allows swaps that keep a valid formation", () => {
    const week = r.weeks[0];
    expect(canSwap(week, players, 3, 7)).toBe(true); // DEF for DEF
    expect(canSwap(week, players, 1, 7)).toBe(false); // keeper for outfielder
    expect(canSwap(week, players, 13, 2)).toBe(false);
  });
  it("lists affordable players in the position first, best outlook first", () => {
    const options = replacements(r, 0, 12, all);
    expect(options.map((o) => [o.player.id, o.ok, o.reason])).toEqual([
      [20, true, null],
      [21, false, "£6.2m short"],
    ]);
    expect(options[0].xpRest).toBe(27);
    expect(replacements(r, 0, 12, all, "p21").map((o) => o.player.id)).toEqual([21]);
  });
});

describe("movesFromPlan and cleanMoves", () => {
  it("turns the bot's plan into moves", () => {
    const moves = movesFromPlan(
      [
        { gameweek: 6, chip: null, captain: { id: 13 }, transfers: [{ out: { id: 12 }, in: { id: 20 } }] },
        { gameweek: 7, chip: "bboost", captain: { id: 20 }, transfers: [] },
        { gameweek: 11, chip: null, captain: { id: 1 }, transfers: [] },
      ],
      [6, 7, 8],
    );
    expect(moves).toEqual([
      { kind: "transfer", gw: 6, out: 12, in: 20 },
      { kind: "captain", gw: 6, id: 13 },
      { kind: "chip", gw: 7, chip: "bboost" },
      { kind: "captain", gw: 7, id: 20 },
    ]);
  });
  it("drops anything malformed", () => {
    expect(cleanMoves([{ kind: "transfer", gw: 6, out: 1, in: 2 }, { kind: "hack", gw: 6 }, { kind: "chip", gw: 6, chip: "x" }, null, "x"])).toEqual([
      { kind: "transfer", gw: 6, out: 1, in: 2 },
    ]);
    expect(cleanMoves("nope")).toEqual([]);
  });
});
