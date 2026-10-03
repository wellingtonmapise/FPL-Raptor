import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ordinal } from "@/lib/league";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leagues · FPL Raptor" };

type Row = { league_id: number; rank: number | null; leagues: { name: string } | null };

export default async function LeaguesPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/league");

  const { data: profile } = await supabase
    .from("profiles")
    .select("fpl_team_id")
    .eq("user_id", userId)
    .maybeSingle<{ fpl_team_id: number | null }>();
  if (!profile?.fpl_team_id) redirect("/onboarding");

  const { data } = await supabase
    .from("league_members")
    .select("league_id,rank,leagues(name)")
    .eq("team_id", profile.fpl_team_id);
  const leagues = (data ?? []) as unknown as Row[];

  if (leagues.length === 1) redirect(`/league/${leagues[0].league_id}`);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Your leagues</h1>
      {leagues.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          None of your mini-leagues are followed yet. The app follows the leagues listed in the fetch
          workflow; ask whoever runs it to add yours.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {leagues.map((l) => (
            <li key={l.league_id}>
              <Link href={`/league/${l.league_id}`} className="flex items-center justify-between px-5 py-4">
                <span className="font-medium">{l.leagues?.name ?? `League ${l.league_id}`}</span>
                {l.rank && <span className="text-sm text-zinc-500">{ordinal(l.rank)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
