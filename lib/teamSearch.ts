import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { teamCandidates, teamSearchPattern, teamSearchTerm, type TeamMatchRow } from "@/lib/onboarding";

export async function searchTeams(supabase: Awaited<ReturnType<typeof createClient>>, input: unknown) {
  const query = teamSearchTerm(input);
  if (query.length < 2) return { candidates: [], unavailable: false };
  const columns = "team_id,manager_name,team_name,leagues(name)";
  // Separate typed filters avoid interpolating a user's text into PostgREST's
  // .or() expression syntax. Bound each result set; never download all teams.
  let managers = supabase.from("league_members").select(columns);
  for (const word of query.split(" ").slice(0, 8)) managers = managers.ilike("manager_name", teamSearchPattern(word));
  const [byManager, byTeam] = await Promise.all([
    managers.order("manager_name").limit(12).returns<TeamMatchRow[]>(),
    supabase.from("league_members").select(columns)
      .ilike("team_name", teamSearchPattern(query)).order("team_name").limit(12).returns<TeamMatchRow[]>(),
  ]);
  if (byManager.error || byTeam.error) return { candidates: [], unavailable: true };
  return { candidates: teamCandidates([...(byManager.data ?? []), ...(byTeam.data ?? [])], query), unavailable: false };
}
