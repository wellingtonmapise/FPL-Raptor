import "server-only";
import { authOrigin, signInDestination } from "@/lib/auth";
import type { createClient } from "@/lib/supabase/server";

export function googleAuthConfig(): { origin: string } | null {
  if (process.env.GOOGLE_AUTH_ENABLED !== "true") return null;
  const origin = authOrigin(process.env.APP_URL);
  return origin ? { origin } : null;
}

/** A read failure must never be mistaken for a missing team. */
export async function destinationForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  next: unknown,
): Promise<string | null> {
  const { data, error } = await supabase.from("profiles")
    .select("fpl_team_id").eq("user_id", userId)
    .maybeSingle<{ fpl_team_id: number | null }>();
  return error ? null : signInDestination(next, Boolean(data?.fpl_team_id));
}
