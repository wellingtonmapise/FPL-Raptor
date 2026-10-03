/**
 * Pull an FPL team id out of whatever someone pastes: the bare number, or a
 * link like https://fantasy.premierleague.com/entry/5057497/event/5.
 * Returns null if there's no plausible id.
 */
export function parseTeamId(input: string): number | null {
  const text = input.trim();
  const fromLink = text.match(/entry\/(\d+)/);
  const digits = fromLink ? fromLink[1] : /^\d+$/.test(text) ? text : null;
  if (!digits) return null;
  const id = Number(digits);
  return Number.isSafeInteger(id) && id > 0 && id < 100_000_000 ? id : null;
}
