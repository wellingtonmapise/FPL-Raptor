/**
 * Supabase settings for the web app.
 *
 * Both values are safe to expose: the publishable key only gets what
 * row-level security allows. The URL is accepted with or without a trailing
 * /rest/v1 or slash, since Supabase shows it in more than one form.
 */
export function supabaseEnv(): { url: string; key: string } | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!rawUrl || !key) return null;
  const url = rawUrl.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  return { url, key };
}
