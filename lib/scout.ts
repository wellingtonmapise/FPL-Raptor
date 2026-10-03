/**
 * The Scout page: fixture ticker, underlying stats and differentials.
 * Pure functions only, so they're easy to test.
 */

import type { Fixture, Team } from "@/lib/gameweek";

export type TickerCell = { opponent: string; home: boolean; difficulty: number | null };

export type TickerRow = {
  team: Team;
  weeks: TickerCell[][]; // one list per gameweek: empty = blank, two = double
  ease: number; // higher = kinder run (doubles count twice, blanks count nothing)
  averageDifficulty: number | null;
};

/**
 * Every club's fixtures over the next gameweeks, kindest run first.
 * Ease adds up (6 - difficulty) per match, so a double gameweek of two
 * average fixtures beats one easy one and a blank scores nothing.
 */
export function fixtureTicker(teams: Team[], fixtures: Fixture[], gameweekIds: number[]): TickerRow[] {
  const short = new Map(teams.map((t) => [t.id, t.short_name]));
  const rows = teams.map((team) => {
    const weeks = gameweekIds.map((gw) =>
      fixtures
        .filter((f) => f.gameweek_id === gw && (f.home_team_id === team.id || f.away_team_id === team.id))
        .sort((a, b) => (a.kickoff_time ?? "").localeCompare(b.kickoff_time ?? ""))
        .map((f) => {
          const home = f.home_team_id === team.id;
          return {
            opponent: short.get(home ? f.away_team_id : f.home_team_id) ?? "?",
            home,
            difficulty: home ? f.home_difficulty : f.away_difficulty,
          };
        }),
    );
    const all = weeks.flat().filter((c) => c.difficulty != null);
    const ease = all.reduce((sum, c) => sum + (6 - (c.difficulty ?? 3)), 0);
    return {
      team,
      weeks,
      ease,
      averageDifficulty: all.length ? all.reduce((s, c) => s + (c.difficulty ?? 0), 0) / all.length : null,
    };
  });
  return rows.sort((a, b) => b.ease - a.ease || a.team.short_name.localeCompare(b.team.short_name));
}

export type ScoutPlayer = {
  id: number;
  web_name: string;
  team_id: number;
  position: number;
  now_cost: number;
  status: string;
  chance_of_playing_next_round: number | null;
  selected_by_percent: number | null;
  form: number | null;
  total_points: number | null;
};

export type PlayerStats = {
  player_id: number;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  clean_sheets: number | null;
  defensive_contribution: number | null;
  xg: number | null;
  xa: number | null;
  xgc: number | null;
  recent_gameweeks: number | null;
  recent_minutes: number | null;
  recent_points: number | null;
  recent_xg: number | null;
  recent_xa: number | null;
  recent_dc: number | null;
  xp_gameweek: number | null;
  xp_next: number | null;
  xp_next5: number | null;
};

export type Range = "season" | "recent";
export const SORTS = ["xp", "xgi90", "form", "points", "price", "owned"] as const;
export type Sort = (typeof SORTS)[number];

export type StatRow = {
  player: ScoutPlayer;
  xpNext: number | null;
  xp5: number | null;
  minutes: number;
  points: number;
  xg: number;
  xa: number;
  xgi90: number | null; // per 90, null under the minutes floor
  dc90: number | null;
  xgc90: number | null;
};

const per90 = (value: number, minutes: number) => (minutes > 0 ? (value / minutes) * 90 : 0);

/** Stats for one player over the season or the recent window. */
export function statRow(player: ScoutPlayer, stats: PlayerStats | undefined, range: Range, minMinutes: number): StatRow {
  const recent = range === "recent";
  const minutes = Number((recent ? stats?.recent_minutes : stats?.minutes) ?? 0);
  const xg = Number((recent ? stats?.recent_xg : stats?.xg) ?? 0);
  const xa = Number((recent ? stats?.recent_xa : stats?.xa) ?? 0);
  const dc = Number((recent ? stats?.recent_dc : stats?.defensive_contribution) ?? 0);
  const enough = minutes >= minMinutes;
  return {
    player,
    xpNext: stats?.xp_next == null ? null : Number(stats.xp_next),
    xp5: stats?.xp_next5 == null ? null : Number(stats.xp_next5),
    minutes,
    points: Number((recent ? stats?.recent_points : player.total_points) ?? 0),
    xg,
    xa,
    xgi90: enough ? per90(xg + xa, minutes) : null,
    dc90: enough ? per90(dc, minutes) : null,
    xgc90: enough && !recent && stats?.xgc != null ? per90(Number(stats.xgc), minutes) : null,
  };
}

/** Minutes a player needs before per-90 numbers mean much: a third of what was possible. */
export function minutesFloor(gameweeksPlayed: number): number {
  return Math.max(90, Math.round(gameweeksPlayed * 90 * 0.33));
}

export function sortStats(rows: StatRow[], sort: Sort): StatRow[] {
  const key: Record<Sort, (r: StatRow) => number> = {
    xp: (r) => r.xp5 ?? -1,
    xgi90: (r) => r.xgi90 ?? -1,
    form: (r) => r.player.form ?? -1,
    points: (r) => r.points,
    price: (r) => r.player.now_cost,
    owned: (r) => r.player.selected_by_percent ?? -1,
  };
  return [...rows].sort((a, b) => key[sort](b) - key[sort](a) || (b.xp5 ?? 0) - (a.xp5 ?? 0));
}

export type Differential = {
  row: StatRow;
  owners: number; // squads in your league that have him
  squads: number;
};

/**
 * Players few people have, ranked by the model's next five gameweeks:
 * under `maxOverall`% owned overall and in at most `maxLeagueShare` of your
 * league's squads (and not in yours).
 */
export function differentials(
  rows: StatRow[],
  leagueOwners: Map<number, number>,
  squads: number,
  mine: Set<number>,
  maxOverall = 10,
  maxLeagueShare = 0.2,
): Differential[] {
  return rows
    .filter((r) => (r.player.selected_by_percent ?? 100) < maxOverall)
    .filter((r) => !mine.has(r.player.id))
    .filter((r) => r.player.status === "a" || (r.player.chance_of_playing_next_round ?? 0) >= 75)
    .map((r) => ({ row: r, owners: leagueOwners.get(r.player.id) ?? 0, squads }))
    .filter((d) => squads === 0 || d.owners / squads <= maxLeagueShare)
    .sort((a, b) => (b.row.xp5 ?? 0) - (a.row.xp5 ?? 0));
}
