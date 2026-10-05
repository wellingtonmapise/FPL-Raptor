import "server-only";

import type { AskData, AskPlayer } from "@/lib/ask/tools";
import { loadDraftData } from "@/lib/draftData";
import { leagueOwnership } from "@/lib/leagueOwnership";
import type { TransferPlanRow } from "@/lib/plan";
import type { PlayerStats } from "@/lib/scout";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AskContext = {
  data: AskData;
  plan: TransferPlanRow | null;
  teamName: string | null;
  leagueName: string | null;
  deadline: string | null; // ISO time of the next deadline
};

type ExtraRow = {
  id: number;
  first_name: string | null;
  second_name: string | null;
  news: string | null;
  form: number | null;
  total_points: number | null;
};

/** Everything Ask Raptor's tools work from, loaded once per question. */
export async function loadAskContext(supabase: Supabase, userId: string): Promise<{ ok: true; context: AskContext } | { ok: false; reason: string }> {
  const [{ data: plan }, { data: profile }] = await Promise.all([
    supabase
      .from("transfer_plans")
      .select("from_gameweek,horizon,free_transfers,bank,plan,expected_points,baseline_points,model_version,created_at")
      .eq("user_id", userId)
      .maybeSingle<TransferPlanRow>(),
    supabase.from("profiles").select("fpl_team_id").eq("user_id", userId).maybeSingle<{ fpl_team_id: number | null }>(),
  ]);
  const [draft, ownership, extraRes, statsRes, teamsRes, gwRes] = await Promise.all([
    loadDraftData(supabase, userId, plan ?? null),
    leagueOwnership(supabase, profile?.fpl_team_id ?? null),
    supabase.from("players").select("id,first_name,second_name,news,form,total_points").limit(1000),
    supabase
      .from("player_stats")
      .select("player_id,minutes,goals,assists,defensive_contribution,xg,xa,recent_gameweeks,recent_minutes,recent_points,recent_xg,recent_xa")
      .limit(1000),
    supabase.from("teams").select("id,name,short_name"),
    supabase.from("gameweeks").select("id,deadline_time,finished").order("id"),
  ]);
  if (!draft.ok) return { ok: false, reason: draft.reason };

  const extra = new Map(((extraRes.data ?? []) as ExtraRow[]).map((r) => [r.id, r]));
  const stats = new Map(((statsRes.error ? [] : (statsRes.data ?? [])) as PlayerStats[]).map((s) => [s.player_id, s]));
  const num = (v: unknown) => (v == null ? null : Number(v));
  const players: AskPlayer[] = draft.data.players.map((p) => {
    const e = extra.get(p.id);
    const s = stats.get(p.id);
    return {
      ...p,
      fullName: [e?.first_name, e?.second_name].filter(Boolean).join(" ") || p.name,
      news: e?.news ?? "",
      form: num(e?.form),
      points: num(e?.total_points),
      minutes: num(s?.minutes),
      goals: num(s?.goals),
      assists: num(s?.assists),
      xg: num(s?.xg),
      xa: num(s?.xa),
      dc: num(s?.defensive_contribution),
      recent: s?.recent_gameweeks
        ? {
            gameweeks: Number(s.recent_gameweeks),
            minutes: Number(s.recent_minutes ?? 0),
            points: Number(s.recent_points ?? 0),
            xg: Number(s.recent_xg ?? 0),
            xa: Number(s.recent_xa ?? 0),
          }
        : null,
      leagueOwners: ownership.squads ? (ownership.owners.get(p.id) ?? 0) : null,
    };
  });
  const gameweeks = (gwRes.data ?? []) as { id: number; deadline_time: string; finished: boolean }[];
  const next = gameweeks.find((g) => g.id === draft.data.base.gameweeks[0]);
  return {
    ok: true,
    context: {
      data: {
        base: draft.data.base,
        players,
        fixtures: draft.data.fixtures,
        clubs: ((teamsRes.data ?? []) as { id: number; name: string; short_name: string }[]).map((t) => ({ id: t.id, short: t.short_name, name: t.name })),
        botMoves: draft.data.botMoves,
        leagueSquads: ownership.squads,
        gameweeksPlayed: gameweeks.filter((g) => g.finished).length,
      },
      plan: plan ?? null,
      teamName: ownership.teamName,
      leagueName: ownership.leagueName,
      deadline: next?.deadline_time ?? null,
    },
  };
}
