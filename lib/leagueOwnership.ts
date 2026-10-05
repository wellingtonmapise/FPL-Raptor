import "server-only";

import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type LeagueOwnership = {
  leagueName: string | null;
  teamName: string | null; // your FPL team's name
  rank: number | null; // your place in that league
  mine: Set<number>; // your squad at the latest stored gameweek
  owners: Map<number, number>; // player id -> other squads in your league that have him
  squads: number; // other squads with picks stored
};

/** Who owns whom in your (first) followed league, from the latest gameweek's stored picks. */
export async function leagueOwnership(supabase: Supabase, myTeamId: number | null): Promise<LeagueOwnership> {
  const empty: LeagueOwnership = { leagueName: null, teamName: null, rank: null, mine: new Set(), owners: new Map(), squads: 0 };
  if (!myTeamId) return empty;
  const { data: membership } = await supabase
    .from("league_members")
    .select("league_id,team_name,rank,leagues(name)")
    .eq("team_id", myTeamId)
    .limit(1);
  const league = (
    (membership ?? []) as unknown as { league_id: number; team_name: string; rank: number | null; leagues: { name: string } | null }[]
  )[0];
  const { data: memberRows } = league
    ? await supabase.from("league_members").select("team_id").eq("league_id", league.league_id)
    : { data: [] };
  const teamIds = [...new Set([myTeamId, ...((memberRows ?? []) as { team_id: number }[]).map((m) => m.team_id)])];
  const { data: latest } = await supabase
    .from("picks")
    .select("gameweek_id")
    .in("team_id", teamIds)
    .order("gameweek_id", { ascending: false })
    .limit(1)
    .maybeSingle<{ gameweek_id: number }>();
  const result: LeagueOwnership = {
    ...empty,
    leagueName: league?.leagues?.name ?? null,
    teamName: league?.team_name ?? null,
    rank: league?.rank ?? null,
  };
  if (!latest) return result;
  const { data: pickRows } = await supabase
    .from("picks")
    .select("team_id,player_id")
    .eq("gameweek_id", latest.gameweek_id)
    .in("team_id", teamIds);
  const picks = (pickRows ?? []) as { team_id: number; player_id: number }[];
  result.mine = new Set(picks.filter((p) => p.team_id === myTeamId).map((p) => p.player_id));
  const others = picks.filter((p) => p.team_id !== myTeamId);
  result.squads = new Set(others.map((p) => p.team_id)).size;
  for (const p of others) result.owners.set(p.player_id, (result.owners.get(p.player_id) ?? 0) + 1);
  return result;
}
