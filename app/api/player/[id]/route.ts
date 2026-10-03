import { NextResponse } from "next/server";
import { getElementSummary } from "@/lib/fplApi";
import {
  buildPlayerCard,
  xpByGameweek,
  type CardPlayer,
  type CardStats,
  type CardTeam,
} from "@/lib/player";
import { getSupabase } from "@/lib/supabase/public";

// The player card's data. Public football data only, so the CDN may cache it briefly.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Not a player id" }, { status: 400 });
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Not set up" }, { status: 503 });

  const [playerRes, teamsRes, statsRes, xpRes, summaryRes] = await Promise.all([
    supabase
      .from("players")
      .select(
        "id,web_name,first_name,second_name,team_id,position,now_cost,status,news,chance_of_playing_next_round,selected_by_percent,form,total_points",
      )
      .eq("id", id)
      .maybeSingle<CardPlayer>(),
    supabase.from("teams").select("id,name,short_name"),
    supabase.from("player_stats").select("minutes,xg,xa,defensive_contribution,xp_next5").eq("player_id", id).maybeSingle<CardStats>(),
    supabase.from("predictions").select("gameweek_id,expected_points,created_at").eq("player_id", id),
    getElementSummary(id),
  ]);
  if (!playerRes.data) return NextResponse.json({ error: "No such player" }, { status: 404 });

  const card = buildPlayerCard(
    playerRes.data,
    (teamsRes.data ?? []) as CardTeam[],
    statsRes.error ? null : statsRes.data,
    xpByGameweek((xpRes.data ?? []) as { gameweek_id: number; expected_points: number; created_at: string }[]),
    summaryRes.ok ? summaryRes.data : null,
  );
  return NextResponse.json(card, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" },
  });
}
