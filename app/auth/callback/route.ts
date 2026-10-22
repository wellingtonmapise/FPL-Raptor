import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { destinationForUser, googleAuthConfig } from "@/lib/authSession";
import { createClient, currentUserId } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const linking = url.searchParams.get("flow") === "link";
  // Behind a proxy, request.url can contain an internal hostname. Returning
  // there would lose the cookie set on the actual application's origin.
  const origin = googleAuthConfig()?.origin ?? url.origin;
  const finish = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const fail = (error: string) => finish(linking
    ? "/account?error=linking"
    : `/login?${new URLSearchParams({ error, next })}`);

  // Never echo provider error descriptions, authorization codes, or tokens.
  if (url.searchParams.has("error")) return fail("google");
  const code = url.searchParams.get("code");
  if (!code) return fail("session");

  const supabase = await createClient();
  const originalUser = linking ? await currentUserId(supabase) : null;
  if (linking && !originalUser) return fail("linking");
  const flowId = url.searchParams.get("sb_flow_id");
  const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error || !data.user) return fail("session");
  if (linking && data.user.id !== originalUser) {
    await supabase.auth.signOut({ scope: "local" });
    return fail("linking");
  }
  if (linking) return finish("/account?connected=google");
  const destination = await destinationForUser(supabase, data.user.id, next);
  return destination ? finish(destination) : fail("profile");
}
