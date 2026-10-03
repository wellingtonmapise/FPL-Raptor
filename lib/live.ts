/**
 * Live gameweek scoring: FPL's live points plus what FPL adds later.
 *
 * During a gameweek FPL's live endpoint has each player's points so far, but
 * bonus only arrives about an hour after each match, and automatic
 * substitutions only at the end of the gameweek. This file projects both, the
 * way most FPL live tools do:
 *
 *  - provisional bonus: 3/2/1 to the top three in BPS of every started match
 *    whose bonus isn't confirmed yet (ties share, FPL's rules)
 *  - automatic substitutions: a starter whose matches are all over without
 *    him playing is replaced by the first bench player (in your order) who
 *    has played, keeping a valid formation; goalkeepers only for goalkeepers
 *  - captaincy passes to the vice-captain once the captain can't play
 *
 * Pure functions only, so they're easy to test.
 */

export type LiveStatLine = { identifier: string; points: number; value: number };

export type LiveElement = {
  id: number;
  stats: { minutes: number; total_points: number; bonus: number; bps: number };
  explain: { fixture: number; stats: LiveStatLine[] }[];
};

export type LiveFixture = {
  id: number;
  event: number | null;
  kickoff_time: string | null;
  started: boolean | null;
  finished: boolean;
  finished_provisional: boolean;
  minutes: number;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  stats: { identifier: string; h: { value: number; element: number }[]; a: { value: number; element: number }[] }[];
};

export type LivePlayer = { id: number; web_name: string; team_id: number; position: number };

export type LivePick = {
  element: number;
  position: number; // 1-11 starting, 12-15 bench in order
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
};

export type MatchState = "upcoming" | "live" | "done";

export function matchState(f: LiveFixture): MatchState {
  if (f.finished || f.finished_provisional) return "done";
  return f.started ? "live" : "upcoming";
}

/** FPL's bonus from a list of BPS scores: 3, 2, 1 by position, ties share the higher award. */
export function bonusFromBps(scores: { value: number; element: number }[]): Map<number, number> {
  const sorted = [...scores].sort((a, b) => b.value - a.value);
  const out = new Map<number, number>();
  let start = 0;
  while (start < 3 && start < sorted.length) {
    const value = sorted[start].value;
    let end = start;
    while (end < sorted.length && sorted[end].value === value) end++;
    for (let i = start; i < end; i++) out.set(sorted[i].element, 3 - start);
    start = end;
  }
  return out;
}

/**
 * Bonus not yet in FPL's live points, by player: for every started match
 * whose bonus FPL hasn't added (no player in it has bonus points yet).
 */
export function provisionalBonus(fixtures: LiveFixture[], live: Map<number, LiveElement>): Map<number, number> {
  const confirmed = new Set<number>();
  for (const el of live.values()) {
    for (const e of el.explain) {
      if (e.stats.some((s) => s.identifier === "bonus" && s.points > 0)) confirmed.add(e.fixture);
    }
  }
  const out = new Map<number, number>();
  for (const f of fixtures) {
    if (!f.started || confirmed.has(f.id)) continue;
    const bps = f.stats.find((s) => s.identifier === "bps");
    if (!bps) continue;
    // Only players who've been on the pitch (FPL's lists should already be just them).
    const played = [...bps.h, ...bps.a].filter((b) => (live.get(b.element)?.stats.minutes ?? 1) > 0);
    for (const [element, bonus] of bonusFromBps(played)) {
      out.set(element, (out.get(element) ?? 0) + bonus);
    }
  }
  return out;
}

export type PickStatus = "played" | "playing" | "to-play" | "out";

export type ScoredPick = {
  pick: LivePick;
  player: LivePlayer | null;
  points: number; // live points incl. provisional bonus, before the multiplier
  bonus: number; // confirmed + provisional
  provisional: boolean; // some of the bonus is provisional
  minutes: number;
  status: PickStatus;
  counts: boolean; // in the scoring team (after automatic subs; all 15 with Bench Boost)
  multiplier: number; // after captaincy passes on: 0 if not counting
  subbedIn: boolean;
  subbedOut: boolean;
  fixtures: LiveFixture[];
};

export type TeamLive = {
  picks: ScoredPick[]; // squad order
  points: number; // gameweek points after transfer cost
  gross: number; // before transfer cost
  transferCost: number;
  toPlay: number; // counting players with a match still to start or in progress
  chip: string | null;
  captain: ScoredPick | null; // whoever has the armband now
};

export function teamFixtures(teamId: number, fixtures: LiveFixture[]): LiveFixture[] {
  return fixtures
    .filter((f) => f.team_h === teamId || f.team_a === teamId)
    .sort((a, b) => (a.kickoff_time ?? "").localeCompare(b.kickoff_time ?? ""));
}

/** played: all his matches are over and he played; out: they're over (or he has none) and he didn't. */
function pickStatus(minutes: number, fixtures: LiveFixture[]): PickStatus {
  if (fixtures.every((f) => matchState(f) === "done")) return minutes > 0 ? "played" : "out";
  return minutes > 0 ? "playing" : "to-play";
}

function validFormation(xi: ScoredPick[]): boolean {
  const n = (pos: number) => xi.filter((p) => p.player?.position === pos).length;
  return n(1) === 1 && n(2) >= 3 && n(3) >= 2 && n(4) >= 1;
}

export function scoreTeam(
  picks: LivePick[],
  chip: string | null,
  transferCost: number,
  players: Map<number, LivePlayer>,
  live: Map<number, LiveElement>,
  fixtures: LiveFixture[],
  provisional: Map<number, number>,
): TeamLive {
  const scored: ScoredPick[] = [...picks]
    .sort((a, b) => a.position - b.position)
    .map((pick) => {
      const player = players.get(pick.element) ?? null;
      const el = live.get(pick.element);
      const minutes = el?.stats.minutes ?? 0;
      const extra = provisional.get(pick.element) ?? 0;
      const fx = player ? teamFixtures(player.team_id, fixtures) : [];
      return {
        pick,
        player,
        points: (el?.stats.total_points ?? 0) + extra,
        bonus: (el?.stats.bonus ?? 0) + extra,
        provisional: extra > 0,
        minutes,
        status: pickStatus(minutes, fx),
        counts: pick.position <= 11 || chip === "bboost",
        multiplier: 0,
        subbedIn: false,
        subbedOut: false,
        fixtures: fx,
      };
    });

  if (chip !== "bboost") {
    // Bench players who have played come on, in bench order, for starters who are out.
    const bench = scored.filter((p) => p.pick.position > 11);
    for (const sub of bench) {
      if (sub.minutes <= 0) continue;
      const xi = scored.filter((p) => p.counts);
      const isGk = sub.player?.position === 1;
      const out = xi.find((s) => {
        if (s.status !== "out" || (s.player?.position === 1) !== isGk) return false;
        return validFormation([...xi.filter((p) => p !== s), sub]);
      });
      if (out) {
        out.counts = false;
        out.subbedOut = true;
        sub.counts = true;
        sub.subbedIn = true;
      }
    }
  }

  const captain = scored.find((p) => p.pick.is_captain) ?? null;
  const vice = scored.find((p) => p.pick.is_vice_captain) ?? null;
  const armMultiplier = chip === "3xc" ? 3 : 2;
  // The vice only takes over once the captain can't play at all.
  const armband = captain && captain.status === "out" && vice && vice.status !== "out" && vice.counts ? vice : captain;
  for (const p of scored) {
    p.multiplier = !p.counts ? 0 : p === armband ? armMultiplier : 1;
  }
  const gross = scored.reduce((sum, p) => sum + p.points * p.multiplier, 0);
  return {
    picks: scored,
    points: gross - transferCost,
    gross,
    transferCost,
    toPlay: scored.filter((p) => p.counts && (p.status === "to-play" || p.status === "playing")).length,
    chip,
    captain: armband,
  };
}

export type LiveMember = {
  team_id: number;
  manager_name: string;
  team_name: string;
  startTotal: number; // total before this gameweek
  live: TeamLive | null; // null if their squad couldn't be loaded
};

export type LiveRow = LiveMember & {
  liveTotal: number;
  gwPoints: number | null;
  rank: number;
  startRank: number;
};

/** The league table as it stands now, with movement since the deadline. */
export function liveTable(members: LiveMember[]): LiveRow[] {
  const rankBy = (value: (m: LiveMember) => number) => {
    const sorted = [...members].sort((a, b) => value(b) - value(a));
    const ranks = new Map<number, number>();
    sorted.forEach((m, i) => {
      const prev = sorted[i - 1];
      ranks.set(m.team_id, prev && value(prev) === value(m) ? ranks.get(prev.team_id)! : i + 1);
    });
    return ranks;
  };
  const total = (m: LiveMember) => m.startTotal + (m.live?.points ?? 0);
  const now = rankBy(total);
  const before = rankBy((m) => m.startTotal);
  return members
    .map((m) => ({
      ...m,
      liveTotal: total(m),
      gwPoints: m.live?.points ?? null,
      rank: now.get(m.team_id)!,
      startRank: before.get(m.team_id)!,
    }))
    .sort((a, b) => a.rank - b.rank || b.liveTotal - a.liveTotal);
}

/** "ARS 2-1 EVE", or "ARS v EVE" before kick-off. */
export function scoreline(f: LiveFixture, shortName: (id: number) => string): string {
  if (!f.started || f.team_h_score == null || f.team_a_score == null) return `${shortName(f.team_h)} v ${shortName(f.team_a)}`;
  return `${shortName(f.team_h)} ${f.team_h_score}-${f.team_a_score} ${shortName(f.team_a)}`;
}

type GameweekLike = { deadline_time: string; is_current: boolean };

/** The gameweek to show live (FPL's current one, else the latest past deadline) and the next one. */
export function liveGameweeks<T extends GameweekLike>(gameweeks: T[], now: number = Date.now()): { gw: T | null; next: T | null } {
  const past = gameweeks.filter((g) => Date.parse(g.deadline_time) <= now);
  return {
    gw: gameweeks.find((g) => g.is_current) ?? past[past.length - 1] ?? null,
    next: gameweeks.find((g) => Date.parse(g.deadline_time) > now) ?? null,
  };
}

/** Worth refreshing every minute: a match is on, starts within 3 hours, or awaits its bonus. */
export function isMatchTime(fixtures: LiveFixture[], now: number = Date.now()): boolean {
  return fixtures.some((f) => {
    const state = matchState(f);
    if (state === "live" || (f.finished_provisional && !f.finished)) return true;
    return state === "upcoming" && !!f.kickoff_time && Date.parse(f.kickoff_time) - now < 3 * 3600_000;
  });
}

export type Impact = {
  id: number;
  name: string;
  points: number; // live points so far (before anyone's captaincy)
  mine: number; // your multiplier: 0 if he isn't scoring for you, 2 if he's your captain
  eo: number; // the rest of the league's average multiplier (1.4 = 140% effective ownership)
  impact: number; // points × (mine − eo): what he's worth to you against the average rival
};

const multiplierOf = (team: TeamLive, id: number) => team.picks.find((p) => p.pick.element === id)?.multiplier ?? 0;

/**
 * Who's saving you and who's hurting you in your league: each player's live
 * points times how much more (or less) of him you have than the average rival.
 * Owning a player everyone owns gains you nothing; a captain only you picked
 * gains you double.
 */
export function leagueImpact(members: LiveMember[], myTeamId: number): Impact[] {
  const me = members.find((m) => m.team_id === myTeamId)?.live;
  const rivals = members.filter((m) => m.team_id !== myTeamId && m.live).map((m) => m.live!);
  if (!me || rivals.length === 0) return [];
  const players = new Map<number, { name: string; points: number }>();
  for (const team of [me, ...rivals]) {
    for (const sp of team.picks) players.set(sp.pick.element, { name: sp.player?.web_name ?? `#${sp.pick.element}`, points: sp.points });
  }
  const out: Impact[] = [];
  for (const [id, { name, points }] of players) {
    if (points === 0) continue;
    const mine = multiplierOf(me, id);
    const eo = rivals.reduce((s, t) => s + multiplierOf(t, id), 0) / rivals.length;
    const impact = points * (mine - eo);
    if (Math.abs(impact) >= 0.05) out.push({ id, name, points, mine, eo, impact });
  }
  return out.sort((a, b) => b.impact - a.impact);
}

export type Swing = { id: number; name: string; points: number; mine: number; theirs: number; diff: number };
export type HeadToHead = { rival: LiveRow; ahead: boolean; gap: number; gwDiff: number; swings: Swing[] };

/** You against the manager just above you (or just below, if you're top), this gameweek. */
export function headToHead(table: LiveRow[], myTeamId: number): HeadToHead | null {
  const ranked = [...table].sort((a, b) => a.rank - b.rank || b.liveTotal - a.liveTotal);
  const i = ranked.findIndex((r) => r.team_id === myTeamId);
  if (i < 0 || ranked.length < 2) return null;
  const me = ranked[i];
  const rival = i > 0 ? ranked[i - 1] : ranked[1];
  if (!me.live || !rival.live) return null;
  const ids = new Set([...me.live.picks, ...rival.live.picks].map((p) => p.pick.element));
  const swings: Swing[] = [];
  for (const id of ids) {
    const sp = me.live.picks.find((p) => p.pick.element === id) ?? rival.live.picks.find((p) => p.pick.element === id)!;
    const mine = multiplierOf(me.live, id);
    const theirs = multiplierOf(rival.live, id);
    const diff = sp.points * (mine - theirs);
    if (diff !== 0) swings.push({ id, name: sp.player?.web_name ?? `#${id}`, points: sp.points, mine, theirs, diff });
  }
  swings.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || b.diff - a.diff);
  return {
    rival,
    ahead: me.liveTotal >= rival.liveTotal,
    gap: Math.abs(me.liveTotal - rival.liveTotal),
    gwDiff: (me.gwPoints ?? 0) - (rival.gwPoints ?? 0),
    swings: swings.slice(0, 6),
  };
}
