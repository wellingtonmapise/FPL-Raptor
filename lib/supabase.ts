import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for reading data in the app.
 *
 * Uses the publishable key (older projects call it the anon key), which is
 * safe to expose: row-level security in supabase/migrations decides what it
 * can read. The secret key is only ever used by the jobs in GitHub Actions.
 *
 * Returns null until the environment variables are set, so the app still
 * builds and shows setup steps instead of crashing.
 */
export function getSupabase(): SupabaseClient | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !key) return null;
  // Accept the URL with or without a trailing /rest/v1 or slash.
  const url = rawUrl.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  return createClient(url, key, { auth: { persistSession: false } });
}
