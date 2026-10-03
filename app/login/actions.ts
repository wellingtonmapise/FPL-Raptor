"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; notice?: string };

/** Only follow redirects to pages on this site. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/me";
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/already registered|already exists/i.test(message))
    return "There's already an account with that email. Sign in instead.";
  if (/password should be at least/i.test(message)) return "Use a password of at least 6 characters.";
  if (/email not confirmed/i.test(message))
    return "That account isn't confirmed yet. Ask whoever runs the app to turn off email confirmation in Supabase.";
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
          "Account created, but Supabase is waiting for email confirmation. Turn off 'Confirm email' in Supabase (see the README), then sign in.",
      };
    }
    redirect("/onboarding");
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: friendly(error.message) };
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
