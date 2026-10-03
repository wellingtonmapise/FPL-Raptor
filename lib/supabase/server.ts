import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "@/lib/env";

/**
 * Supabase client for the signed-in user, in Server Components and Server
 * Actions. It reads the session from cookies, so row-level security sees who
 * is asking.
 *
 * Create a new one per request; never keep it in a module-level variable.
 */
export async function createClient() {
  // Read cookies first: it marks the page as per-request, so Next.js never
  // tries to prerender signed-in pages at build time.
  const cookieStore = await cookies();
  const env = supabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, which can't set cookies.
          // Safe to ignore: proxy.ts refreshes the session on every request.
        }
      },
    },
  });
}

/** The signed-in user's id, or null. Verifies the session token. */
export async function currentUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" ? sub : null;
}
