import { describe, expect, it } from "vitest";
import { botSummary, starterQuestions, systemPrompt } from "@/lib/ask/prompt";
import type { TransferPlanRow } from "@/lib/plan";

const player = (id: number, name: string) => ({ id, name, position: 3, team: 1, price: 70 });
const plan = (chip: string | null, transfers: [string, string][]): TransferPlanRow => ({
  from_gameweek: 6,
  horizon: 4,
  free_transfers: 1,
  bank: 5,
  plan: {
    weeks: [
      {
        gameweek: 6,
        free_transfers: 1,
        hits: transfers.length > 1 ? 1 : 0,
        transfers: transfers.map(([o, i], k) => ({ out: player(k, o), in: player(10 + k, i) })),
        captain: player(99, "Haaland"),
        lineup: [],
        bench: [],
        expected_points: 60,
        bank_after: 3,
        chip,
      },
      { gameweek: 7, free_transfers: 1, hits: 0, transfers: [], captain: player(99, "Haaland"), lineup: [], bench: [], expected_points: 55, bank_after: 3 },
    ],
  },
  expected_points: 230,
  baseline_points: 221.6,
  model_version: "v1",
  created_at: "2026-10-05T00:00:00Z",
});

describe("botSummary", () => {
  it("describes each week's moves and the gain", () => {
    expect(botSummary(plan(null, [["Saka", "Palmer"], ["Konsa", "Gabriel"]]), [6, 7])).toBe(
      "GW6: Saka → Palmer, Konsa → Gabriel; 1 hit (-4); captain Haaland. GW7: no transfers; captain Haaland. That's +8.4 expected points over doing nothing.",
    );
    expect(botSummary(plan("wildcard", []), [6, 7])).toContain("GW6: play Wildcard; no transfers");
  });

  it("ignores a stale plan", () => {
    expect(botSummary(plan(null, []), [7, 8])).toBeNull();
    expect(botSummary(null, [6])).toBeNull();
  });
});

describe("starterQuestions", () => {
  it("asks about the bot's chip or first transfer and flagged players", () => {
    expect(starterQuestions({ plan: plan("wildcard", []), gameweek: 6, flagged: ["Saka"] })).toEqual([
      "Should I really play my Wildcard in GW6?",
      "Saka is flagged. Sell or wait?",
      "Who should I captain in GW6?",
      "Best midfielder under £8m for the next five weeks?",
      "Is a -4 hit worth it this week?",
    ]);
    expect(starterQuestions({ plan: plan(null, [["Saka", "Palmer"]]), gameweek: 6, flagged: [] })[0]).toBe("Why Saka → Palmer? Is it worth it?");
    expect(starterQuestions({ plan: null, gameweek: null, flagged: [] })).toHaveLength(4);
  });
});

describe("systemPrompt", () => {
  it("carries the rules, the date and the team brief", () => {
    const prompt = systemPrompt("Bank £0.5m", "Mon, 05 Oct 2026");
    expect(prompt).toContain("Today is Mon, 05 Oct 2026.");
    expect(prompt).toContain("Never guess or recall stats from memory");
    expect(prompt).toContain("about 6% optimistic");
    expect(prompt.endsWith("Bank £0.5m")).toBe(true);
  });
});
