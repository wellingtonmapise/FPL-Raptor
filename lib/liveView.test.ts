import { describe, expect, it } from "vitest";
import type { LiveElement, LivePick, LivePlayer } from "@/lib/live";
import { hasLiveSquad, liveHref, liveView, startingTotal } from "@/lib/liveView";

describe("Live view links", () => {
  it("defaults missing or unknown views to players", () => {
    expect(liveView(null)).toBe("players");
    expect(liveView("__proto__")).toBe("players");
    expect(liveView("standings")).toBe("standings");
    expect(liveView("matches")).toBe("matches");
  });
  it("retains the league when switching views and the view when switching leagues", () => {
    expect(liveHref("players", null)).toBe("/live");
    expect(liveHref("players", 42)).toBe("/live?league=42");
    expect(liveHref("matches", 42)).toBe("/live?league=42&view=matches");
    expect(liveHref("standings", 99)).toBe("/live?league=99&view=standings");
    expect(liveHref("matches", null)).toBe("/live?view=matches");
  });
});

describe("Live data completeness", () => {
  const picks = Array.from({ length: 15 }, (_, i) => ({ element: i + 1, position: i + 1, multiplier: 1, is_captain: i === 0, is_vice_captain: i === 1 }));
  const players = new Map(picks.map((pick) => [pick.element, { id: pick.element, web_name: `Player ${pick.element}`, team_id: 1, position: 3 }]));
  const live = new Map(picks.map((pick) => [pick.element, { id: pick.element, stats: { minutes: 0, total_points: 0, bonus: 0, bps: 0 }, explain: [] }]));

  it("accepts a complete squad even when nobody has scored yet", () => {
    expect(hasLiveSquad(picks, players, live)).toBe(true);
  });
  it("withholds scoring when picks, player details or live elements are missing", () => {
    expect(hasLiveSquad(picks.slice(1), players, live)).toBe(false);
    const partialPlayers = new Map<number, LivePlayer>(players);
    partialPlayers.delete(1);
    const partialLive = new Map<number, LiveElement>(live);
    partialLive.delete(2);
    expect(hasLiveSquad(picks, partialPlayers, live)).toBe(false);
    expect(hasLiveSquad(picks, players, partialLive)).toBe(false);
    expect(hasLiveSquad([...picks.slice(1), picks[1]] as LivePick[], players, live)).toBe(false);
  });
  it("keeps known starting totals and treats missing totals as unavailable", () => {
    expect(startingTotal(100, 200, 40)).toBe(100);
    expect(startingTotal(0, 200, 40)).toBe(0);
    expect(startingTotal(null, 200, 40)).toBe(160);
    expect(startingTotal(null, 0, 0)).toBe(0);
    expect(startingTotal(null, null, 40)).toBeNull();
    expect(startingTotal(undefined, 200, null)).toBeNull();
  });
});
