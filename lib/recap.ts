/**
 * Recap cards (written by jobs/raptor/recaps.py) and reactions to them.
 * Pure functions only, so they're easy to test.
 */

export type RecapCard = {
  id: string;
  kind: string; // top, rocket, captain_hero, lone, chip, bench, captain_fail, hit, freefall, spoon
  title: string;
  manager: string;
  team_id: number | null;
  stat: string;
  caption: string;
};

export type Recap = { gameweek_id: number; title: string; body: string; model: string; cards: RecapCard[] | null };

export const REACTIONS = ["laugh", "skull", "fire", "clown"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const REACTION_EMOJI: Record<Reaction, string> = { laugh: "😂", skull: "💀", fire: "🔥", clown: "🤡" };

export type ReactionRow = { card_id: string; emoji: string; user_id: string };
export type Tally = { counts: Record<string, Partial<Record<Reaction, number>>>; mine: Record<string, Reaction> };

export function tallyReactions(rows: ReactionRow[], userId: string | null): Tally {
  const counts: Tally["counts"] = {};
  const mine: Tally["mine"] = {};
  for (const r of rows) {
    if (!(REACTIONS as readonly string[]).includes(r.emoji)) continue;
    const emoji = r.emoji as Reaction;
    const card = (counts[r.card_id] ??= {});
    card[emoji] = (card[emoji] ?? 0) + 1;
    if (r.user_id === userId) mine[r.card_id] = emoji;
  }
  return { counts, mine };
}

/** Apply a reaction change locally (before the server confirms it). */
export function applyReaction(tally: Tally, cardId: string, next: Reaction | null): Tally {
  const counts = { ...tally.counts, [cardId]: { ...(tally.counts[cardId] ?? {}) } };
  const mine = { ...tally.mine };
  const previous = mine[cardId];
  if (previous) counts[cardId][previous] = Math.max(0, (counts[cardId][previous] ?? 1) - 1);
  if (next) {
    counts[cardId][next] = (counts[cardId][next] ?? 0) + 1;
    mine[cardId] = next;
  } else delete mine[cardId];
  return { counts, mine };
}

/** Cards that look like roasts get a sad raptor. */
export const SAD_KINDS = new Set(["bench", "captain_fail", "hit", "freefall", "spoon"]);
