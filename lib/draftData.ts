import "server-only";

import type { SavedDraft } from "@/app/planner/actions";
import type { TeamFixtures } from "@/components/DraftPlanner";
import { movesFromPlan, type Chip, type DraftBase, type DraftPlayer, type Move } from "@/lib/draft";
import { getPicks } from "@/lib/fplApi";
import type { TransferPlanRow } from "@/lib/plan";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type PlanExtras = { squad?: { id: number; sell: number }[]; chips_left?: { chip: Chip; from: number; expires: number }[] };

export type DraftData = {
  base: DraftBase;
  players: DraftPlayer[];
  fixtures: TeamFixtures;
  botMoves: Move[] | null;
  drafts: SavedDraft[] | null;
};

const HORIZON = 5; // the model predicts five gameweeks ahead
const PAGE = 1000; // Supabase returns at most this many rows per request

/** Everything the do-it-yourself planner needs, or a reason it can't start yet. */
export async function loadDraftData(
  supabase: Supabase,
  userId: string,
  plan: TransferPlanRow | null,
): Promise<{ ok: true; data: DraftData } | { ok: false; reason: string }> {
  const [{ data: profile }, { data: gameweekRows }, { data: teamRows }, { data: playerRows }] = await Promise.all([
    supabase.from("profiles").select("fpl_team_id").eq("user_id", userId).maybeSingle<{ fpl_team_id: number | null }>(),
    supabase.from("gameweeks").select("id,deadline_time,is_current").order("id"),
    supabase.from("teams").select("id,short_name"),
    supabase
      .from("players")
      .select("id,web_name,team_id,position,now_cost,status,chance_of_playing_next_round,selected_by_percent")
      .limit(PAGE),
  ]);
  const teamId = profile?.fpl_team_id;
  if (!teamId) return { ok: false, reason: "Link your FPL team first." };
  const gameweeks = (gameweekRows ?? []) as { id: number; deadline_time: string; is_current: boolean }[];
  const now = Date.now();
  const ahead = gameweeks.filter((g) => Date.parse(g.deadline_time) > now).slice(0, HORIZON).map((g) => g.id);
  if (ahead.length === 0) return { ok: false, reason: "The season is over: there's nothing left to plan." };
  const current = gameweeks.filter((g) => Date.parse(g.deadline_time) <= now).pop();

  // Your squad at the last deadline.
  let squad: number[] = [];
  if (current) {
    const { data: picks } = await supabase.from("picks").select("player_id").eq("team_id", teamId).eq("gameweek_id", current.id);
    squad = ((picks ?? []) as { player_id: number }[]).map((p) => p.player_id);
    if (squad.length !== 15) {
      const live = await getPicks(teamId, current.id);
      squad = live.ok ? live.data.picks.map((p) => p.element) : [];
    }
  }
  if (squad.length !== 15) return { ok: false, reason: "Your squad shows up here after the first deadline of the season." };

  // Expected points for every player for the planned gameweeks (several pages).
  const xpRows: { player_id: number; gameweek_id: number; expected_points: number; created_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("predictions")
      .select("player_id,gameweek_id,expected_points,created_at")
      .in("gameweek_id", ahead)
      .order("player_id")
      .order("gameweek_id")
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    xpRows.push(...(data as typeof xpRows));
    if (data.length < PAGE) break;
  }
  const xp = new Map<number, number[]>();
  const stamp = new Map<string, string>();
  for (const r of xpRows) {
    const key = `${r.player_id}:${r.gameweek_id}`;
    if ((stamp.get(key) ?? "") > r.created_at) continue; // keep the newest prediction
    stamp.set(key, r.created_at);
    const list = xp.get(r.player_id) ?? ahead.map(() => 0);
    list[ahead.indexOf(r.gameweek_id)] = Number(r.expected_points);
    xp.set(r.player_id, list);
  }

  const short = new Map(((teamRows ?? []) as { id: number; short_name: string }[]).map((t) => [t.id, t.short_name]));
  type Row = {
    id: number;
    web_name: string;
    team_id: number;
    position: number;
    now_cost: number;
    status: string;
    chance_of_playing_next_round: number | null;
    selected_by_percent: number | null;
  };
  const players: DraftPlayer[] = ((playerRows ?? []) as Row[])
    .filter((p) => squad.includes(p.id) || (xp.get(p.id) ?? []).some((v) => v > 0.05))
    .map((p) => ({
      id: p.id,
      name: p.web_name,
      team: p.team_id,
      club: short.get(p.team_id) ?? "?",
      position: p.position,
      price: p.now_cost,
      status: p.status,
      chance: p.chance_of_playing_next_round,
      owned: p.selected_by_percent == null ? null : Number(p.selected_by_percent),
      xp: xp.get(p.id) ?? ahead.map(() => 0),
    }));

  const { data: fixtureRows } = await supabase
    .from("fixtures")
    .select("gameweek_id,home_team_id,away_team_id,home_difficulty,away_difficulty,kickoff_time")
    .in("gameweek_id", ahead)
    .order("kickoff_time");
  const fixtures: TeamFixtures = {};
  type FixtureRow = { gameweek_id: number; home_team_id: number; away_team_id: number; home_difficulty: number | null; away_difficulty: number | null };
  for (const f of (fixtureRows ?? []) as FixtureRow[]) {
    for (const [team, opp, home, difficulty] of [
      [f.home_team_id, f.away_team_id, true, f.home_difficulty],
      [f.away_team_id, f.home_team_id, false, f.away_difficulty],
    ] as const) {
      ((fixtures[team] ??= {})[f.gameweek_id] ??= []).push({ opponent: short.get(opp) ?? "?", home, difficulty });
    }
  }

  // Bank, free transfers, selling prices and chips come from the latest plan (worked out from your FPL history).
  const extras = (plan?.plan ?? {}) as PlanExtras;
  const fresh = plan && plan.from_gameweek === ahead[0];
  let bank = plan?.bank ?? null;
  if (bank === null && current) {
    const { data: entry } = await supabase
      .from("entry_gameweeks")
      .select("bank")
      .eq("team_id", teamId)
      .eq("gameweek_id", current.id)
      .maybeSingle<{ bank: number | null }>();
    bank = entry?.bank ?? 0;
  }
  const base: DraftBase = {
    gameweeks: ahead,
    squad,
    bank: bank ?? 0,
    freeTransfers: fresh ? plan.free_transfers : 1,
    sell: Object.fromEntries((extras.squad ?? []).map((s) => [s.id, s.sell])),
    chipsLeft: extras.chips_left ?? [],
  };

  const draftsRes = await supabase
    .from("planner_drafts")
    .select("id,name,from_gameweek,moves,updated_at")
    .order("updated_at", { ascending: false });
  return {
    ok: true,
    data: {
      base,
      players,
      fixtures,
      botMoves: fresh ? movesFromPlan(plan.plan.weeks, ahead) : null,
      drafts: draftsRes.error ? null : ((draftsRes.data ?? []) as SavedDraft[]),
    },
  };
}
