"use server";

import { cleanMoves } from "@/lib/draft";
import { createClient, currentUserId } from "@/lib/supabase/server";

export type SavedDraft = { id: string; name: string; from_gameweek: number; moves: unknown; updated_at: string };
export type DraftResult = { ok: true; draft: SavedDraft } | { ok: false; error: string };

const MAX_DRAFTS = 5;

/** Save a planner draft: a new one when `id` is null, otherwise overwrite that one. */
export async function saveDraft(input: { id: string | null; name: string; fromGameweek: number; moves: unknown }): Promise<DraftResult> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { ok: false, error: "Sign in again to save drafts." };
  const name = input.name.trim().slice(0, 40) || "Draft";
  const row = { name, from_gameweek: Math.trunc(input.fromGameweek), moves: cleanMoves(input.moves), updated_at: new Date().toISOString() };

  if (input.id) {
    const { data, error } = await supabase
      .from("planner_drafts")
      .update(row)
      .eq("id", input.id)
      .eq("user_id", userId)
      .select("id,name,from_gameweek,moves,updated_at")
      .maybeSingle<SavedDraft>();
    if (error || !data) return { ok: false, error: "Couldn't save that draft. Try again." };
    return { ok: true, draft: data };
  }

  const { count, error: countError } = await supabase
    .from("planner_drafts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) return { ok: false, error: "Saving drafts isn't set up yet." };
  if ((count ?? 0) >= MAX_DRAFTS) return { ok: false, error: `You can keep ${MAX_DRAFTS} drafts. Delete one first.` };
  const { data, error } = await supabase
    .from("planner_drafts")
    .insert({ ...row, user_id: userId })
    .select("id,name,from_gameweek,moves,updated_at")
    .single<SavedDraft>();
  if (error || !data) return { ok: false, error: "Couldn't save that draft. Try again." };
  return { ok: true, draft: data };
}

export async function deleteDraft(id: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { ok: false };
  const { error } = await supabase.from("planner_drafts").delete().eq("id", id).eq("user_id", userId);
  return { ok: !error };
}
