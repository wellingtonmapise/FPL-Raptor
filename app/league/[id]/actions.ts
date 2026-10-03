"use server";

import { REACTIONS, type Reaction } from "@/lib/recap";
import { createClient, currentUserId } from "@/lib/supabase/server";

/** React to a recap card (one reaction per card; the same one again takes it back). */
export async function react(input: { leagueId: number; gameweekId: number; cardId: string; emoji: Reaction | null }): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId || input.cardId.length > 32) return { ok: false };
  const key = { league_id: input.leagueId, gameweek_id: input.gameweekId, card_id: input.cardId, user_id: userId };
  if (input.emoji === null) {
    const { error } = await supabase.from("recap_reactions").delete().match(key);
    return { ok: !error };
  }
  if (!(REACTIONS as readonly string[]).includes(input.emoji)) return { ok: false };
  const { error } = await supabase
    .from("recap_reactions")
    .upsert({ ...key, emoji: input.emoji, created_at: new Date().toISOString() }, { onConflict: "league_id,gameweek_id,card_id,user_id" });
  return { ok: !error };
}
