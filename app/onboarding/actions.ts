"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getEntry } from "@/lib/fplApi";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { parseTeamId } from "@/lib/teamId";
import { safeNext, teamLinkedDestination } from "@/lib/auth";

export type OnboardingState = { error?: string };

export async function saveTeam(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const teamId = parseTeamId(String(formData.get("team") ?? ""));
  if (!teamId) {
    return { error: "That doesn't look like a team ID. It's the number after /entry/ in your Points page link." };
  }

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  const next = safeNext(formData.get("next"));
  if (!userId) redirect(`/login?${new URLSearchParams({ next: `/onboarding?${new URLSearchParams({ next })}` })}`);

  // Keep the current profile untouched if the supplied team cannot be checked.
  const entry = await getEntry(teamId);
  if (!entry.ok && entry.reason === "not-found") {
    return { error: `There's no FPL team with ID ${teamId}. Double-check the number.` };
  }
  if (!entry.ok) return { error: "FPL isn't responding, so we couldn't check this team. Please try again shortly." };
  const displayName = `${entry.data.player_first_name} ${entry.data.player_last_name}`.trim();

  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId, fpl_team_id: teamId, display_name: displayName }, { onConflict: "user_id" });

  if (error) {
    if (error.code === "23505") {
      return { error: "That team is already linked to another account. Sign in with that account instead." };
    }
    return { error: "Couldn't save your team. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect(teamLinkedDestination(next));
}
