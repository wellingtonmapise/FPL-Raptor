"use server";

import { redirect } from "next/navigation";
import { getEntry } from "@/lib/fplApi";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { parseTeamId } from "@/lib/teamId";

export type OnboardingState = { error?: string };

export async function saveTeam(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const teamId = parseTeamId(String(formData.get("team") ?? ""));
  if (!teamId) {
    return { error: "That doesn't look like a team ID. It's the number after /entry/ in your Points page link." };
  }

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/onboarding");

  // Check the team exists. If FPL is down, save anyway: the name fills in later.
  const entry = await getEntry(teamId);
  if (!entry.ok && entry.reason === "not-found") {
    return { error: `There's no FPL team with ID ${teamId}. Double-check the number.` };
  }
  const displayName = entry.ok
    ? `${entry.data.player_first_name} ${entry.data.player_last_name}`.trim()
    : null;

  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId, fpl_team_id: teamId, display_name: displayName }, { onConflict: "user_id" });

  if (error) {
    if (error.code === "23505") {
      return { error: "That team is already linked to another account. Sign in with that account instead." };
    }
    return { error: `Couldn't save your team: ${error.message}` };
  }

  redirect("/me");
}
