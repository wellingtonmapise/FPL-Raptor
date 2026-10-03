/**
 * The player card: everything shown when you tap a player, from our tables
 * (price, status, stats, the model's expected points) and FPL's
 * element-summary (their fixtures and this season's results).
 * Pure functions only, so they're easy to test.
 */

export type SummaryFixture = {
  event: number | null;
  team_h: number;
  team_a: number;
  is_home: boolean;
  difficulty: number;
  kickoff_time: string | null;
};

export type SummaryResult = {
  round: number;
  opponent_team: number;
  was_home: boolean;
  team_h_score: number | null;
  team_a_score: number | null;
  minutes: number;
  total_points: number;
  kickoff_time: string;
};

export type ElementSummary = { fixtures: SummaryFixture[]; history: SummaryResult[] };

export type CardPlayer = {
  id: number;
  web_name: string;
  first_name: string | null;
  second_name: string | null;
  team_id: number;
  position: number;
  now_cost: number;
  status: string;
  news: string;
  chance_of_playing_next_round: number | null;
  selected_by_percent: number | null;
  form: number | null;
  total_points: number | null;
};

export type CardStats = {
  minutes: number | null;
  xg: number | null;
  xa: number | null;
  defensive_contribution: number | null;
  xp_next5: number | null;
};

export type CardTeam = { id: number; name: string; short_name: string };

export type UpcomingFixture = {
  gameweek: number | null;
  opponent: string;
  home: boolean;
  difficulty: number;
  xp: number | null; // the model's expected points for that gameweek (first fixture of a double only)
};

export type RecentResult = {
  gameweek: number;
  opponent: string;
  home: boolean;
  score: string | null; // his team's goals first
  result: "W" | "D" | "L" | null;
  minutes: number;
  points: number;
};

export type PlayerCard = {
  id: number;
  name: string;
  fullName: string;
  club: string;
  clubName: string;
  position: number;
  price: number;
  status: string;
  news: string;
  chance: number | null;
  owned: number | null;
  form: number | null;
  points: number | null;
  xp5: number | null;
  minutes: number | null;
  xg: number | null;
  xa: number | null;
  xgi90: number | null;
  dc90: number | null;
  upcoming: UpcomingFixture[];
  recent: RecentResult[];
  fplAvailable: boolean; // false if FPL's element-summary couldn't be loaded
};

const per90 = (value: number | null, minutes: number | null) =>
  value == null || !minutes || minutes < 90 ? null : (value / minutes) * 90;

export function buildPlayerCard(
  player: CardPlayer,
  teams: CardTeam[],
  stats: CardStats | null,
  xpByGameweek: Map<number, number>,
  summary: ElementSummary | null,
): PlayerCard {
  const team = new Map(teams.map((t) => [t.id, t]));
  const short = (id: number) => team.get(id)?.short_name ?? "?";

  const seen = new Set<number>();
  const upcoming = [...(summary?.fixtures ?? [])]
    .sort((a, b) => (a.event ?? 99) - (b.event ?? 99) || (a.kickoff_time ?? "").localeCompare(b.kickoff_time ?? ""))
    .slice(0, 5)
    .map((f) => {
      const first = f.event != null && !seen.has(f.event);
      if (f.event != null) seen.add(f.event);
      return {
        gameweek: f.event,
        opponent: short(f.is_home ? f.team_a : f.team_h),
        home: f.is_home,
        difficulty: f.difficulty,
        xp: first && f.event != null ? (xpByGameweek.get(f.event) ?? null) : null,
      };
    });

  const recent = [...(summary?.history ?? [])]
    .sort((a, b) => b.kickoff_time.localeCompare(a.kickoff_time))
    .slice(0, 5)
    .map((h) => {
      const scored = h.was_home ? h.team_h_score : h.team_a_score;
      const conceded = h.was_home ? h.team_a_score : h.team_h_score;
      const known = scored != null && conceded != null;
      return {
        gameweek: h.round,
        opponent: short(h.opponent_team),
        home: h.was_home,
        score: known ? `${scored}-${conceded}` : null,
        result: !known ? null : scored! > conceded! ? ("W" as const) : scored === conceded ? ("D" as const) : ("L" as const),
        minutes: h.minutes,
        points: h.total_points,
      };
    });

  const minutes = stats?.minutes ?? null;
  const xg = stats?.xg == null ? null : Number(stats.xg);
  const xa = stats?.xa == null ? null : Number(stats.xa);
  return {
    id: player.id,
    name: player.web_name,
    fullName: [player.first_name, player.second_name].filter(Boolean).join(" ") || player.web_name,
    club: short(player.team_id),
    clubName: team.get(player.team_id)?.name ?? "",
    position: player.position,
    price: player.now_cost,
    status: player.status,
    news: player.news,
    chance: player.chance_of_playing_next_round,
    owned: player.selected_by_percent == null ? null : Number(player.selected_by_percent),
    form: player.form == null ? null : Number(player.form),
    points: player.total_points,
    xp5: stats?.xp_next5 == null ? null : Number(stats.xp_next5),
    minutes,
    xg,
    xa,
    xgi90: xg == null || xa == null ? null : per90(xg + xa, minutes),
    dc90: per90(stats?.defensive_contribution == null ? null : Number(stats.defensive_contribution), minutes),
    upcoming,
    recent,
    fplAvailable: summary !== null,
  };
}

/** Newest prediction per gameweek for one player. */
export function xpByGameweek(rows: { gameweek_id: number; expected_points: number; created_at: string }[]): Map<number, number> {
  const newest = new Map<number, { value: number; at: string }>();
  for (const r of rows) {
    const seen = newest.get(r.gameweek_id);
    if (!seen || r.created_at > seen.at) newest.set(r.gameweek_id, { value: Number(r.expected_points), at: r.created_at });
  }
  return new Map([...newest].map(([gw, v]) => [gw, v.value]));
}
