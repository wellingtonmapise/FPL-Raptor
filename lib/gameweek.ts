/**
 * Turning stored FPL rows into what the My gameweek page shows.
 * Pure functions only (no database or network), so they're easy to test.
 */

export type Pick = {
  player_id: number;
  squad_position: number; // 1-11 starting, 12-15 bench (in bench order)
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
};

export type Player = {
  id: number;
  web_name: string;
  team_id: number;
  position: number; // 1 GK, 2 DEF, 3 MID, 4 FWD
  now_cost: number;
  status: string;
  news: string;
  chance_of_playing_next_round: number | null;
};

export type Team = { id: number; name: string; short_name: string };

export type Fixture = {
  id: number;
  gameweek_id: number | null;
  home_team_id: number;
  away_team_id: number;
  home_difficulty: number | null;
  away_difficulty: number | null;
  kickoff_time: string | null;
};

export type NextFixture = { opponent: string; home: boolean; difficulty: number | null };

export type SquadPlayer = Pick & {
  player: Player | null; // null if the player isn't in our table (shouldn't happen)
  club: string;
  fixtures: NextFixture[]; // empty = blank gameweek, two = double gameweek
  flagged: boolean;
};

export type Squad = {
  starters: SquadPlayer[];
  bench: SquadPlayer[];
  flagged: SquadPlayer[];
  captain: SquadPlayer | null;
  vice: SquadPlayer | null;
  formation: string; // e.g. "3-4-3"
};

/** Doubtful, injured, suspended or otherwise not certain to be available. */
export function isFlagged(player: Player): boolean {
  if (player.status !== "a") return true;
  return player.chance_of_playing_next_round !== null && player.chance_of_playing_next_round < 100;
}

/** A club's fixtures in one gameweek, from that club's point of view. */
export function fixturesFor(teamId: number, fixtures: Fixture[], teams: Team[]): NextFixture[] {
  const shortName = (id: number) => teams.find((t) => t.id === id)?.short_name ?? "?";
  return fixtures
    .filter((f) => f.home_team_id === teamId || f.away_team_id === teamId)
    .sort((a, b) => (a.kickoff_time ?? "").localeCompare(b.kickoff_time ?? ""))
    .map((f) =>
      f.home_team_id === teamId
        ? { opponent: shortName(f.away_team_id), home: true, difficulty: f.home_difficulty }
        : { opponent: shortName(f.home_team_id), home: false, difficulty: f.away_difficulty },
    );
}

export function buildSquad(picks: Pick[], players: Player[], teams: Team[], nextFixtures: Fixture[]): Squad {
  const byId = new Map(players.map((p) => [p.id, p]));
  const squad: SquadPlayer[] = [...picks]
    .sort((a, b) => a.squad_position - b.squad_position)
    .map((pick) => {
      const player = byId.get(pick.player_id) ?? null;
      return {
        ...pick,
        player,
        club: player ? (teams.find((t) => t.id === player.team_id)?.short_name ?? "?") : "?",
        fixtures: player ? fixturesFor(player.team_id, nextFixtures, teams) : [],
        flagged: player ? isFlagged(player) : false,
      };
    });

  const starters = squad.filter((p) => p.squad_position <= 11);
  const count = (position: number) => starters.filter((p) => p.player?.position === position).length;

  return {
    starters,
    bench: squad.filter((p) => p.squad_position > 11),
    flagged: squad.filter((p) => p.flagged),
    captain: squad.find((p) => p.is_captain) ?? null,
    vice: squad.find((p) => p.is_vice_captain) ?? null,
    formation: starters.length ? `${count(2)}-${count(3)}-${count(4)}` : "",
  };
}

export const CHIP_NAMES: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
};

/** The gameweek whose deadline is next: FPL's is_next, else the first future deadline. */
export function nextGameweek<T extends { is_next: boolean; deadline_time: string }>(
  gameweeks: T[],
  now: Date = new Date(),
): T | null {
  return (
    gameweeks.find((g) => g.is_next) ??
    [...gameweeks]
      .filter((g) => Date.parse(g.deadline_time) > now.getTime())
      .sort((a, b) => a.deadline_time.localeCompare(b.deadline_time))[0] ??
    null
  );
}
