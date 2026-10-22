import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ordinal } from "@/lib/league";
import { leagueHref, leagueView, type FollowedLeague } from "@/lib/leagueView";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leagues · FPL Raptor" };

export default async function LeaguesPage({ searchParams }: PageProps<"/league">) {
  const sp = await searchParams;
  const view = leagueView(typeof sp.view === "string" ? sp.view : null);
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/league${view === "overview" ? "" : `?view=${view}`}`)}`);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("fpl_team_id")
    .eq("user_id", userId)
    .maybeSingle<{ fpl_team_id: number | null }>();
  if (profileError) throw new Error("League profile could not load");
  if (!profile?.fpl_team_id) redirect("/onboarding");

  const { data, error } = await supabase
    .from("league_members")
    .select("league_id,rank,leagues(name)")
    .eq("team_id", profile.fpl_team_id);
  if (error) throw new Error("Followed leagues could not load");
  const leagues = (data ?? []) as unknown as FollowedLeague[];

  if (leagues.length === 1) redirect(leagueHref(leagues[0].league_id,view));

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header><h1 className="page-title">Your leagues</h1><p className="mt-1 text-sm text-muted">Standings, rivals and the latest recaps.</p></header>
      {leagues.length === 0 ? (
        <section className="surface p-5"><h2 className="section-title">No followed leagues yet</h2><p className="mt-2 text-sm leading-relaxed text-muted">Your linked team isn’t in a league followed by Raptor. Ask the app’s owner to follow your league, or check that you linked the right team.</p><Link href="/account" className="text-link mt-3 inline-flex min-h-11 items-center text-sm">Check linked team</Link></section>
      ) : (
        <ul className="surface divide-y divide-line">
          {leagues.map((l) => (
            <li key={l.league_id}>
              <Link href={leagueHref(l.league_id,view)} className="flex min-h-14 items-center justify-between gap-4 px-5 py-4">
                <span className="min-w-0 break-words font-medium">{l.leagues?.name ?? `League ${l.league_id}`}</span>
                <span className="shrink-0 text-sm text-muted">{l.rank && l.rank > 0 ? ordinal(l.rank) : "—"} <span aria-hidden>›</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
