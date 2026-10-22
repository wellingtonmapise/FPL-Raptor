import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth";
import { teamSearchTerm } from "@/lib/onboarding";
import { searchTeams } from "@/lib/teamSearch";
import OnboardingForm from "./OnboardingForm";
import TeamCandidates from "./TeamCandidates";

export const metadata: Metadata = { title: "Your team · FPL Raptor" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const destination = `/onboarding?${new URLSearchParams({ next })}`;
    redirect(`/login?${new URLSearchParams({ next: destination })}`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("fpl_team_id")
    .eq("user_id", user.id)
    .maybeSingle<{ fpl_team_id: number | null }>();
  if (profileError) return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 py-8">
      <h1 className="page-title">Your team link</h1>
      <p role="alert" className="text-sm text-warning">We couldn&apos;t load your current team link. Please try again before changing it.</p>
      <Link href={`/onboarding?${new URLSearchParams({ next })}`} className="font-medium text-accent">Try again</Link>
      <Link href="/account" className="text-sm text-muted">Back to Account</Link>
    </main>
  );
  const query = teamSearchTerm(typeof params.q === "string" ? params.q : user.user_metadata?.full_name ?? user.user_metadata?.name);
  const { candidates, unavailable } = await searchTeams(supabase, query);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="page-title">
          {profile?.fpl_team_id ? "Change your team" : "Find your FPL team"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Search your manager or team name. We can find teams in leagues Raptor follows.
        </p>
      </div>
      {profile?.fpl_team_id && <p className="text-sm text-muted">Current team ID: {profile.fpl_team_id}. <Link href="/me" className="font-medium text-accent">Keep this team</Link></p>}
      <form method="get" action="/onboarding" className="flex flex-col gap-2">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="team-search" className="text-sm font-medium">Manager or team name</label>
        <div className="flex gap-2">
          <input id="team-search" name="q" type="search" defaultValue={query} minLength={2} maxLength={80} required autoComplete="name" placeholder="Your FPL name" className="form-field flex-1" />
          <button type="submit" className="button-primary">Search</button>
        </div>
      </form>
      {unavailable ? <p role="status" className="text-sm text-muted">Team search isn&apos;t available right now. You can still use your Points link below.</p>
        : candidates.length ? <TeamCandidates teams={candidates} next={next} />
          : query.length >= 2 ? <p role="status" className="text-sm text-muted">No matches in the leagues we follow. Try a different name, or use your Points link below.</p> : null}
      {candidates.length === 8 && <p className="text-xs text-muted">Showing up to eight matches. Use a more specific name to narrow the search.</p>}
      <section className="surface p-4 sm:p-5">
        <h2 className="font-semibold">Have your Points link?</h2>
        <p className="mt-2 mb-4 text-sm text-muted">
          You can link any team this way, including teams outside our followed leagues. Open <a href="https://fantasy.premierleague.com/" target="_blank" rel="noopener noreferrer" className="text-link underline">Fantasy Premier League</a>, go to <strong>Points</strong>, then copy the page address and paste it here.
        </p>
        <OnboardingForm current={profile?.fpl_team_id ?? null} next={next} />
      </section>
      <Link href="/account" className="text-sm text-muted underline underline-offset-4">Account and sign-in options</Link>
    </main>
  );
}
