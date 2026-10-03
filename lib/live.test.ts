import { describe, expect, it } from "vitest";
import {
  bonusFromBps,
  isMatchTime,
  liveGameweeks,
  liveTable,
  provisionalBonus,
  scoreTeam,
  scoreline,
  type LiveElement,
  type LiveFixture,
  type LivePick,
  type LivePlayer,
} from "@/lib/live";

function fixture(id: number, h: number, a: number, extra: Partial<LiveFixture> = {}): LiveFixture {
  return {
    id,
    event: 6,
    kickoff_time: `2026-10-10T1${id}:00:00Z`,
    started: true,
    finished: true,
    finished_provisional: true,
    minutes: 90,
    team_h: h,
    team_a: a,
    team_h_score: 1,
    team_a_score: 0,
    stats: [],
    ...extra,
  };
}

function element(id: number, minutes: number, points: number, fixtureId = 1, bonus = 0): LiveElement {
  return {
    id,
    stats: { minutes, total_points: points, bonus, bps: 0 },
    explain: [
      {
        fixture: fixtureId,
        stats: [
          { identifier: "minutes", points: minutes >= 60 ? 2 : minutes > 0 ? 1 : 0, value: minutes },
          ...(bonus ? [{ identifier: "bonus", points: bonus, value: bonus }] : []),
        ],
      },
    ],
  };
}

describe("bonusFromBps", () => {
  const s = (pairs: [number, number][]) => pairs.map(([element, value]) => ({ element, value }));
  it("gives 3, 2, 1 to the top three", () => {
    expect(bonusFromBps(s([[1, 30], [2, 25], [3, 20], [4, 10]]))).toEqual(new Map([[1, 3], [2, 2], [3, 1]]));
  });
  it("shares on ties, as FPL does", () => {
    // Two tie for first: both get 3, the next gets 1.
    expect(bonusFromBps(s([[1, 30], [2, 30], [3, 20], [4, 10]]))).toEqual(new Map([[1, 3], [2, 3], [3, 1]]));
    // Tie for second: 3, then 2 each, nobody gets 1.
    expect(bonusFromBps(s([[1, 30], [2, 25], [3, 25], [4, 10]]))).toEqual(new Map([[1, 3], [2, 2], [3, 2]]));
    // Tie for third: 1 each.
    expect(bonusFromBps(s([[1, 30], [2, 25], [3, 20], [4, 20]]))).toEqual(new Map([[1, 3], [2, 2], [3, 1], [4, 1]]));
  });
});

describe("provisionalBonus", () => {
  const bps = { identifier: "bps", h: [{ value: 40, element: 1 }, { value: 20, element: 2 }], a: [{ value: 30, element: 3 }] };
  it("adds bonus for started matches whose bonus isn't in yet", () => {
    const live = new Map([[1, element(1, 90, 10)]]);
    const got = provisionalBonus([fixture(1, 1, 2, { finished: false, stats: [bps] })], live);
    expect(got).toEqual(new Map([[1, 3], [3, 2], [2, 1]]));
  });
  it("leaves out anyone who hasn't played", () => {
    const live = new Map([[1, element(1, 90, 10)], [2, element(2, 0, 0)]]);
    const got = provisionalBonus([fixture(1, 1, 2, { finished: false, stats: [bps] })], live);
    expect(got).toEqual(new Map([[1, 3], [3, 2]]));
  });
  it("skips matches FPL has added bonus to, and ones not started", () => {
    const live = new Map([[1, element(1, 90, 13, 1, 3)]]);
    expect(provisionalBonus([fixture(1, 1, 2, { stats: [bps] })], live).size).toBe(0);
    expect(provisionalBonus([fixture(2, 1, 2, { started: false, stats: [bps] })], new Map()).size).toBe(0);
  });
});

// Squad: GK 1, DEF 2-4, MID 5-8, FWD 9-11 (4-3-3 shape below), bench GK 12, DEF 13, MID 14, FWD 15.
const positions: Record<number, number> = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3, 9: 4, 10: 4, 11: 3, 12: 1, 13: 2, 14: 3, 15: 4 };
const players = new Map<number, LivePlayer>(
  Object.entries(positions).map(([id, position]) => [Number(id), { id: Number(id), web_name: `P${id}`, team_id: Number(id) <= 8 ? 1 : 2, position }]),
);
const picks: LivePick[] = Array.from({ length: 15 }, (_, i) => ({
  element: i + 1,
  position: i + 1,
  multiplier: i === 8 ? 2 : i < 11 ? 1 : 0,
  is_captain: i === 8,
  is_vice_captain: i === 9,
}));
const done = [fixture(1, 1, 3), fixture(2, 2, 4)];

function liveFor(overrides: Record<number, [number, number]>): Map<number, LiveElement> {
  return new Map(
    picks.map((p) => {
      const [minutes, points] = overrides[p.element] ?? [90, 2];
      return [p.element, element(p.element, minutes, points, players.get(p.element)!.team_id)];
    }),
  );
}

describe("scoreTeam", () => {
  it("counts the XI with the captain doubled, minus hits", () => {
    const t = scoreTeam(picks, null, 4, players, liveFor({ 9: [90, 8] }), done, new Map());
    expect(t.gross).toBe(10 * 2 + 8 * 2);
    expect(t.points).toBe(t.gross - 4);
    expect(t.captain?.pick.element).toBe(9);
    expect(t.toPlay).toBe(0);
  });

  it("subs in the first bench player who played, keeping a valid formation", () => {
    // A defender (2) didn't play: first outfield sub is DEF 13, who played.
    const t = scoreTeam(picks, null, 0, players, liveFor({ 2: [0, 0], 13: [90, 6] }), done, new Map());
    const byId = new Map(t.picks.map((p) => [p.pick.element, p]));
    expect(byId.get(2)!.subbedOut).toBe(true);
    expect(byId.get(13)!.subbedIn).toBe(true);
    expect(t.gross).toBe(9 * 2 + 6 + 2 * 2);
  });

  it("skips a sub who would break the formation", () => {
    // Four defenders start (2-5) and three don't play. DEF 13 replaces 2 and MID 14
    // replaces 3 (4, 5 and 13 still make three at the back), but FWD 15 can't
    // replace 4: that would leave two defenders.
    const t = scoreTeam(picks, null, 0, players, liveFor({ 2: [0, 0], 3: [0, 0], 4: [0, 0] }), done, new Map());
    const swaps = t.picks.filter((p) => p.subbedIn || p.subbedOut).map((p) => [p.pick.element, p.subbedIn]);
    expect(swaps).toEqual([[2, false], [3, false], [13, true], [14, true]]);
  });

  it("only swaps goalkeepers for goalkeepers", () => {
    const t = scoreTeam(picks, null, 0, players, liveFor({ 1: [0, 0], 12: [90, 3] }), done, new Map());
    expect(t.picks.find((p) => p.pick.element === 12)!.subbedIn).toBe(true);
    const outfield = scoreTeam(picks, null, 0, players, liveFor({ 1: [0, 0], 12: [0, 0] }), done, new Map());
    expect(outfield.picks.filter((p) => p.subbedIn)).toHaveLength(0);
  });

  it("passes the armband to the vice once the captain can't play", () => {
    const t = scoreTeam(picks, null, 0, players, liveFor({ 9: [0, 0], 10: [90, 7] }), done, new Map());
    expect(t.captain?.pick.element).toBe(10);
    expect(t.picks.find((p) => p.pick.element === 10)!.multiplier).toBe(2);
  });

  it("keeps the armband while the captain's match is still to come", () => {
    const later = [fixture(1, 1, 3), fixture(2, 2, 4, { started: false, finished: false, finished_provisional: false })];
    const t = scoreTeam(picks, null, 0, players, liveFor({ 9: [0, 0] }), later, new Map());
    expect(t.captain?.pick.element).toBe(9);
    expect(t.toPlay).toBe(3); // 9, 10 and 11 play for club 2
  });

  it("scores the bench with Bench Boost and triples with Triple Captain", () => {
    expect(scoreTeam(picks, "bboost", 0, players, liveFor({}), done, new Map()).gross).toBe(15 * 2 + 2);
    expect(scoreTeam(picks, "3xc", 0, players, liveFor({}), done, new Map()).gross).toBe(11 * 2 + 2 * 2);
  });

  it("adds provisional bonus", () => {
    const t = scoreTeam(picks, null, 0, players, liveFor({}), done, new Map([[9, 3]]));
    expect(t.gross).toBe(11 * 2 + 2 + 3 * 2);
    expect(t.picks.find((p) => p.pick.element === 9)!.provisional).toBe(true);
  });
});

describe("liveTable", () => {
  it("ranks by live total, with movement since the deadline", () => {
    const team = (points: number) => ({ points } as never);
    const rows = liveTable([
      { team_id: 1, manager_name: "A", team_name: "a", startTotal: 300, live: team(40) },
      { team_id: 2, manager_name: "B", team_name: "b", startTotal: 290, live: team(70) },
      { team_id: 3, manager_name: "C", team_name: "c", startTotal: 280, live: null },
    ]);
    expect(rows.map((r) => [r.team_id, r.rank, r.startRank, r.liveTotal])).toEqual([
      [2, 1, 2, 360],
      [1, 2, 1, 340],
      [3, 3, 3, 280],
    ]);
  });
});

describe("scoreline", () => {
  const name = (id: number) => (id === 1 ? "ARS" : "EVE");
  it("shows the score once started", () => {
    expect(scoreline(fixture(1, 1, 2), name)).toBe("ARS 1-0 EVE");
    expect(scoreline(fixture(1, 1, 2, { started: false, team_h_score: null, team_a_score: null }), name)).toBe("ARS v EVE");
  });
});

describe("liveGameweeks and isMatchTime", () => {
  const gws = [
    { id: 5, deadline_time: "2026-09-26T10:00:00Z", is_current: true },
    { id: 6, deadline_time: "2026-10-10T10:00:00Z", is_current: false },
  ];
  it("picks FPL's current gameweek and the next deadline", () => {
    const { gw, next } = liveGameweeks(gws, Date.parse("2026-10-03T12:00:00Z"));
    expect(gw?.id).toBe(5);
    expect(next?.id).toBe(6);
  });
  it("refreshes only around matches", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    expect(isMatchTime([fixture(1, 1, 2)], now)).toBe(false);
    expect(isMatchTime([fixture(1, 1, 2, { finished: false, finished_provisional: false })], now)).toBe(true);
    const upcoming = { started: false, finished: false, finished_provisional: false };
    expect(isMatchTime([fixture(1, 1, 2, { ...upcoming, kickoff_time: "2026-10-10T14:00:00Z" })], now)).toBe(true);
    expect(isMatchTime([fixture(1, 1, 2, { ...upcoming, kickoff_time: "2026-10-11T14:00:00Z" })], now)).toBe(false);
  });
});
