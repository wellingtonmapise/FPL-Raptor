import type { LeaguePick, Member } from "@/lib/league";

export const LEAGUE_VIEWS = ["overview", "insights", "recap"] as const;
export type LeagueView = typeof LEAGUE_VIEWS[number];
export type FollowedLeague = { league_id: number; rank: number | null; leagues: { name: string } | null };

export function leagueView(value: string | null): LeagueView {
  return LEAGUE_VIEWS.find(view => view === value) ?? "overview";
}

export function leagueHref(leagueId: number, view: LeagueView): string {
  return `/league/${leagueId}${view === "overview" ? "" : `?view=${view}`}`;
}

/** Incomplete squads must not turn missing players into zero ownership. */
export function completeSquadIds(members: Member[], picks: LeaguePick[]): number[] {
  return members.filter(member => {
    const squad = picks.filter(pick => pick.team_id === member.team_id);
    return squad.length === 15 && new Set(squad.map(pick => pick.player_id)).size === 15 &&
      new Set(squad.map(pick => pick.squad_position)).size === 15 &&
      squad.every(pick => Number.isInteger(pick.squad_position) && pick.squad_position >= 1 && pick.squad_position <= 15);
  }).map(member => member.team_id);
}

export function orderedLeagueMembers(members: Member[]): Member[] {
  const rank = (member: Member) => member.rank != null && member.rank > 0 ? member.rank : Infinity;
  return [...members].sort((a,b) => rank(a) - rank(b) || a.manager_name.localeCompare(b.manager_name) || a.team_id - b.team_id);
}
