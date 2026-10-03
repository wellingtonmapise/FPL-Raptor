import { describe, expect, it } from "vitest";
import { applyReaction, tallyReactions } from "@/lib/recap";

describe("reactions", () => {
  const rows = [
    { card_id: "bench", emoji: "skull", user_id: "me" },
    { card_id: "bench", emoji: "skull", user_id: "a" },
    { card_id: "bench", emoji: "laugh", user_id: "b" },
    { card_id: "top", emoji: "fire", user_id: "a" },
    { card_id: "top", emoji: "nope", user_id: "c" },
  ];
  it("counts per card and remembers yours", () => {
    expect(tallyReactions(rows, "me")).toEqual({
      counts: { bench: { skull: 2, laugh: 1 }, top: { fire: 1 } },
      mine: { bench: "skull" },
    });
  });
  it("switches, adds and takes back a reaction", () => {
    const t = tallyReactions(rows, "me");
    const switched = applyReaction(t, "bench", "laugh");
    expect(switched.counts.bench).toEqual({ skull: 1, laugh: 2 });
    expect(switched.mine.bench).toBe("laugh");
    const removed = applyReaction(switched, "bench", null);
    expect(removed.counts.bench).toEqual({ skull: 1, laugh: 1 });
    expect(removed.mine.bench).toBeUndefined();
    expect(applyReaction(t, "spoon", "clown").counts.spoon).toEqual({ clown: 1 });
    expect(t.counts.bench).toEqual({ skull: 2, laugh: 1 }); // the original isn't changed
  });
});
