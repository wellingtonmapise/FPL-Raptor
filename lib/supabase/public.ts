import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

/**
 * Supabase client for public data (gameweeks, players, job status), with no
 * signed-in user attached, so pages that use it can stay static and cached.
 *
 * Uses the publishable key (older projects call it the anon key), which is
 * safe to expose: row-level security in supabase/migrations decides what it
 * can read. The secret key is only ever used by the jobs in GitHub Actions.
 *
 * Returns null until the environment variables are set, so the app still
 * builds and shows setup steps instead of crashing.
 */
export function getSupabase(): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env) return null;
  return createClient(env.url, env.key, { auth: { persistSession: false } });
}
