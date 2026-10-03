import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/env";

/**
 * Keeps the signed-in session fresh: Supabase access tokens expire after an
 * hour, and this swaps in a new one (via cookies) before any page renders.
 * Pages decide for themselves whether they need a user.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const env = supabaseEnv();
  if (!env) return response;

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Nothing may run between creating the client and this call, or users can
  // get signed out at random. Return `response` exactly as it is.
  await supabase.auth.getClaims();

  return response;
}
