import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, currentUserId } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";
import GoogleAuthForm from "./GoogleAuthForm";
import { AUTH_ERRORS, authError, safeNext } from "@/lib/auth";
import { destinationForUser, googleAuthConfig } from "@/lib/authSession";

export const metadata: Metadata = { title: "Sign in · FPL Raptor" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  let error = authError(params.error);

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (userId && !error) {
    const destination = await destinationForUser(supabase, userId, next);
    if (destination) redirect(destination);
    error = AUTH_ERRORS.profile;
  }
  const google = googleAuthConfig();

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="page-title">Your next gameweek starts here.</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Sign in or join FPL Raptor. We&apos;ll help you find your team next.
        </p>
      </div>
      {error && <p role="alert" className="rounded-xl bg-warning-soft p-4 text-sm text-warning">{error}</p>}
      {google ? (
        <>
          <GoogleAuthForm next={next} />
          <details className="disclosure surface px-4 sm:px-5">
            <summary className="flex min-h-14 cursor-pointer items-center text-sm font-semibold">Continue with email</summary>
            <div className="pb-5"><LoginForm next={next} /></div>
          </details>
          <p className="text-xs leading-relaxed text-muted">Already have an account? Use the same email, or sign in with email and connect Google from Account.</p>
        </>
      ) : <LoginForm next={next} />}
    </main>
  );
}
