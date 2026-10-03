/**
 * Mini-league maths for the league page: movement, awards, captains,
 * ownership and the head-to-head with your closest rival.
 * Pure functions only, so they're easy to test.
 */

export type Member = {
  team_id: number;
  manager_name: string;
  team_name: string;
  rank: number | null;
  last_rank: number | null;
  total: number | null;
  event_total: number | null;
};

export type EntryGameweek = {
  team_id: number;
  points: number | null;
  points_on_bench: number | null;
  event_transfers: number | null;
  event_transfers_cost: number | null;
  active_chip: string | null;
};

export type LeaguePick = {
  team_id: number;
  player_id: number;
  multiplier: number;
  is_captain: boolean;
  squad_position: number;
};

export type PlayerName = { id: number; web_name: string };

/** Places moved since last gameweek: positive = climbed. */
export function movement(m: Member): number {
  if (m.rank == null || m.last_rank == null || m.last_rank === 0) return 0;
  return m.last_rank - m.rank;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export type Award = {
  id: "top" | "spoon" | "captain_hero" | "captain_fail" | "bench" | "hit";
  title: string;
  team_id: number;
  manager_name: string;
  value: string;
};

function pickBy<T>(items: T[], score: (t: T) => number | null, highest: boolean): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const s = score(item);
    if (s == null) continue;
    if (best === null || (highest ? s > bestScore : s < bestScore)) {
      best = item;
      bestScore = s;
    }
  }
  return best;
}

/** Points after hits: what actually counted this gameweek. */
export function netPoints(e: EntryGameweek): number | null {
  return e.points == null ? null : e.points - (e.event_transfers_cost ?? 0);
}

/**
 * The week's awards. Captain awards need player points (a Map of
 * player id -> points); they're left out when points aren't available.
 */
export function weeklyAwards(
  members: Member[],
  entries: EntryGameweek[],
  picks: LeaguePick[],
  playerPoints: Map<number, number> | null,
  players: Map<number, PlayerName>,
): Award[] {
  const byTeam = new Map(members.map((m) => [m.team_id, m]));
  const counted = entries.filter((e) => byTeam.has(e.team_id) && e.points != null);
  const name = (teamId: number) => byTeam.get(teamId)?.manager_name ?? `Team ${teamId}`;
  const awards: Award[] = [];

  const top = pickBy(counted, netPoints, true);
  if (top) awards.push({ id: "top", title: "Manager of the week", team_id: top.team_id, manager_name: name(top.team_id), value: `${netPoints(top)} pts` });
  const spoon = pickBy(counted, netPoints, false);
  if (spoon && counted.length > 1)
    awards.push({ id: "spoon", title: "Wooden spoon", team_id: spoon.team_id, manager_name: name(spoon.team_id), value: `${netPoints(spoon)} pts` });

  if (playerPoints) {
    const captains = picks
      .filter((p) => p.is_captain && byTeam.has(p.team_id) && playerPoints.has(p.player_id))
      .map((p) => ({ ...p, haul: (playerPoints.get(p.player_id) ?? 0) * Math.max(p.multiplier, 1) }));
    const hero = pickBy(captains, (c) => c.haul, true);
    const fail = pickBy(captains, (c) => c.haul, false);
    const label = (c: (typeof captains)[number]) =>
      `${players.get(c.player_id)?.web_name ?? "?"}, ${c.haul} pts`;
    if (hero) awards.push({ id: "captain_hero", title: "Captain hero", team_id: hero.team_id, manager_name: name(hero.team_id), value: label(hero) });
    if (fail && captains.length > 1 && fail.haul !== hero?.haul)
      awards.push({ id: "captain_fail", title: "Captain fail", team_id: fail.team_id, manager_name: name(fail.team_id), value: label(fail) });
  }

  const bench = pickBy(counted, (e) => e.points_on_bench, true);
  if (bench && (bench.points_on_bench ?? 0) > 0)
    awards.push({ id: "bench", title: "Bench of shame", team_id: bench.team_id, manager_name: name(bench.team_id), value: `${bench.points_on_bench} pts benched` });
  const hit = pickBy(counted, (e) => e.event_transfers_cost, true);
  if (hit && (hit.event_transfers_cost ?? 0) > 0)
    awards.push({ id: "hit", title: "Biggest hit", team_id: hit.team_id, manager_name: name(hit.team_id), value: `−${hit.event_transfers_cost}` });

  return awards;
}

export type CaptainChoice = {
  player_id: number;
  web_name: string;
  count: number;
  managers: string[]; // first names
  points: number | null; // the player's points, before doubling
};

export function captainChoices(
  members: Member[],
  picks: LeaguePick[],
  players: Map<number, PlayerName>,
  playerPoints: Map<number, number> | null,
): CaptainChoice[] {
  const byTeam = new Map(members.map((m) => [m.team_id, m]));
  const choices = new Map<number, CaptainChoice>();
  for (const p of picks) {
    if (!p.is_captain || !byTeam.has(p.team_id)) continue;
    const choice = choices.get(p.player_id) ?? {
      player_id: p.player_id,
      web_name: players.get(p.player_id)?.web_name ?? `Player ${p.player_id}`,
      count: 0,
      managers: [],
      points: playerPoints?.get(p.player_id) ?? null,
    };
    choice.count += 1;
    choice.managers.push(firstName(byTeam.get(p.team_id)!.manager_name));
    choices.set(p.player_id, choice);
  }
  return [...choices.values()].sort((a, b) => b.count - a.count || a.web_name.localeCompare(b.web_name));
}

export type Ownership = {
  player_id: number;
  web_name: string;
  owners: number; // squads containing the player
  share: number; // owners / squads, 0-1
  effective: number; // sum of multipliers / squads (captain = 2), 0-3
  mine: boolean; // in my starting XI
};

export function ownership(
  picks: LeaguePick[],
  players: Map<number, PlayerName>,
  myTeamId: number | null,
): { squads: number; rows: Ownership[] } {
  const squads = new Set(picks.map((p) => p.team_id)).size;
  const rows = new Map<number, Ownership>();
  for (const p of picks) {
    const row = rows.get(p.player_id) ?? {
      player_id: p.player_id,
      web_name: players.get(p.player_id)?.web_name ?? `Player ${p.player_id}`,
      owners: 0,
      share: 0,
      effective: 0,
      mine: false,
    };
    row.owners += 1;
    row.effective += p.multiplier;
    if (p.team_id === myTeamId && p.multiplier > 0) row.mine = true;
    rows.set(p.player_id, row);
  }
  for (const row of rows.values()) {
    row.share = squads ? row.owners / squads : 0;
    row.effective = squads ? row.effective / squads : 0;
  }
  return { squads, rows: [...rows.values()].sort((a, b) => b.effective - a.effective || b.owners - a.owners) };
}

/** Starters you have that few others own (at most a quarter of squads). */
export function differentials(rows: Ownership[]): Ownership[] {
  return rows.filter((r) => r.mine && r.share <= 0.25).sort((a, b) => a.share - b.share);
}

/** Players most of the league starts that you don't. */
export function threats(rows: Ownership[]): Ownership[] {
  return rows.filter((r) => !r.mine && r.effective >= 0.5).sort((a, b) => b.effective - a.effective);
}

export type Rival = {
  rival: Member;
  ahead: boolean; // true when the rival is above you
  gap: number; // points between you, always >= 0
  onlyThem: string[]; // their starters you don't start
  onlyMe: string[]; // your starters they don't start
  theirCaptain: string | null;
  myCaptain: string | null;
};

/** The manager directly above you, or directly below if you're top. */
export function closestRival(
  members: Member[],
  picks: LeaguePick[],
  players: Map<number, PlayerName>,
  myTeamId: number,
): Rival | null {
  const ordered = [...members].filter((m) => m.rank != null).sort((a, b) => a.rank! - b.rank!);
  const index = ordered.findIndex((m) => m.team_id === myTeamId);
  if (index === -1 || ordered.length < 2) return null;
  const me = ordered[index];
  const rival = index > 0 ? ordered[index - 1] : ordered[1];

  const starters = (teamId: number) =>
    new Set(picks.filter((p) => p.team_id === teamId && p.multiplier > 0).map((p) => p.player_id));
  const captainOf = (teamId: number) => {
    const c = picks.find((p) => p.team_id === teamId && p.is_captain);
    return c ? (players.get(c.player_id)?.web_name ?? null) : null;
  };
  const mine = starters(myTeamId);
  const theirs = starters(rival.team_id);
  const names = (ids: number[]) =>
    ids.map((id) => players.get(id)?.web_name ?? `Player ${id}`).sort((a, b) => a.localeCompare(b));

  return {
    rival,
    ahead: index > 0,
    gap: Math.abs((rival.total ?? 0) - (me.total ?? 0)),
    onlyThem: names([...theirs].filter((id) => !mine.has(id))),
    onlyMe: names([...mine].filter((id) => !theirs.has(id))),
    theirCaptain: captainOf(rival.team_id),
    myCaptain: captainOf(myTeamId),
  };
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
