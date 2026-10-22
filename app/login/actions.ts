"use server";

import { redirect } from "next/navigation";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth";
import { destinationForUser, googleAuthConfig } from "@/lib/authSession";

export type AuthState = { error?: string; notice?: string };

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/already registered|already exists/i.test(message))
    return "There's already an account with that email. Sign in instead.";
  if (/password should be at least/i.test(message)) return "Use a password of at least 6 characters.";
  if (/email not confirmed/i.test(message))
    return "Please confirm your email before signing in. Check your inbox for the confirmation link.";
  if (/rate limit/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  return message;
}

export async function authenticate(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const intent = formData.get("intent") === "signup" ? "signup" : "signin";
  const next = safeNext(formData.get("next"));

  if (!email || !password) return { error: "Enter your email and a password." };

  const supabase = await createClient();

  if (intent === "signup") {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: friendly(error.message) };
    if (!data.session) {
      // Supabase wants the email confirmed first. Its built-in mailer only
      // reaches members of the Supabase team, so friends would be stuck.
      return {
        notice:
          "Check your email to confirm your account, then come back to sign in.",
      };
    }
    const destination = await destinationForUser(supabase, data.session.user.id, next);
    if (!destination) return { error: "You're signed in, but we couldn't load your team link. Please try again." };
    redirect(destination);
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendly(error.message) };
  if (!data.user) return { error: "Sign-in didn't finish. Please try again." };
  const destination = await destinationForUser(supabase, data.user.id, next);
  if (!destination) return { error: "You're signed in, but we couldn't load your team link. Please try again." };
  redirect(destination);
}

async function startGoogle(formData: FormData, linking: boolean): Promise<AuthState> {
  const config = googleAuthConfig();
  if (!config) return { error: "Google sign-in isn't available right now. Please continue with email." };
  const supabase = await createClient();
  const next = linking ? "/account" : safeNext(formData.get("next"));
  if (linking && !(await currentUserId(supabase))) redirect("/login?next=/account");
  const callback = new URL("/auth/callback", config.origin);
  callback.searchParams.set("next", next);
  if (linking) callback.searchParams.set("flow", "link");
  const options = { redirectTo: callback.toString(), skipBrowserRedirect: true, scopes: "openid email profile" };
  const { data, error } = linking
    ? await supabase.auth.linkIdentity({ provider: "google", options })
    : await supabase.auth.signInWithOAuth({ provider: "google", options });
  if (error || !data.url) return { error: linking
    ? "Google couldn't be connected. Try again, or keep using your current sign-in method."
    : "Google sign-in isn't available right now. Try again, or continue with email." };
  redirect(data.url);
}

export async function signInWithGoogle(_prev: AuthState, formData: FormData): Promise<AuthState> {
  return startGoogle(formData, false);
}

export async function connectGoogle(_prev: AuthState, formData: FormData): Promise<AuthState> {
  return startGoogle(formData, true);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
