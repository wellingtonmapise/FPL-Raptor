import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { googleAuthConfig } from "@/lib/authSession";
import { AUTH_ERRORS } from "@/lib/auth";
import InstallHelp from "@/components/InstallHelp";
import GoogleAuthForm from "@/app/login/GoogleAuthForm";
import { signOut } from "@/app/login/actions";

export const metadata: Metadata = { title: "Account · FPL Raptor" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account");
  const connected = user.identities?.some((identity) => identity.provider === "google") ?? false;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <header>
        <Link href="/me" className="text-sm text-muted">← Your team</Link>
        <h1 className="mt-3 page-title">Account</h1>
        <p className="mt-1 break-all text-sm text-muted">{user.email}</p>
      </header>
      {params.error === "linking" && <p role="alert" className="text-sm text-warning">{AUTH_ERRORS.linking}</p>}
      <section className="surface flex flex-col gap-3 p-4 sm:p-5">
        <h2 className="font-semibold">Sign-in options</h2>
        {connected ? <p role="status" className="text-sm text-accent">Google is connected to this account.</p>
          : googleAuthConfig() ? <>
            <p className="text-sm text-muted">Connect Google to keep your team, drafts, and alerts with this account, even if your Google email is different.</p>
            <GoogleAuthForm linking />
          </> : <p className="text-sm text-muted">You can keep using your current sign-in method.</p>}
      </section>
      <nav aria-label="Account settings" className="surface flex flex-col divide-y divide-line px-4 sm:px-5">
        <Link href="/onboarding" className="flex min-h-12 items-center justify-between py-3 font-medium">Find or change your team <span aria-hidden="true">→</span></Link>
        <Link href="/notifications" className="flex min-h-12 items-center justify-between py-3 font-medium">Notifications <span aria-hidden="true">→</span></Link>
      </nav>
      <InstallHelp />
      <form action={signOut}><button type="submit" className="button-secondary">Sign out</button></form>
    </main>
  );
}
