import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CHIP_NAMES } from "@/lib/gameweek";
import {
  captainChoices,
  closestRival,
  differentials,
  firstName,
  movement,
  ordinal,
  ownership,
  threats,
  weeklyAwards,
  type EntryGameweek,
  type LeaguePick,
  type Member,
  type PlayerName,
} from "@/lib/league";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "League · FPL Raptor" };

function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {note && <span className="text-xs text-zinc-500">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Movement({ value }: { value: number }) {
  if (value > 0)
    return (
      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        ▲{value}
      </span>
    );
  if (value < 0)
    return (
      <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
        ▼{-value}
      </span>
    );
  return <span className="text-xs text-zinc-400">–</span>;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function LeaguePage({
  params,
}: PageProps<"/league/[id]">) {
  const { id } = await params;
  const leagueId = Number(id);
  if (!Number.isSafeInteger(leagueId)) notFound();

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect(`/login?next=/league/${leagueId}`);

  const [{ data: profile }, { data: league }, { data: memberRows }, recapRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("fpl_team_id")
        .eq("user_id", userId)
        .maybeSingle<{ fpl_team_id: number | null }>(),
      supabase
        .from("leagues")
        .select("id,name")
        .eq("id", leagueId)
        .maybeSingle<{ id: number; name: string }>(),
      supabase
        .from("league_members")
        .select(
          "team_id,manager_name,team_name,rank,last_rank,total,event_total",
        )
        .eq("league_id", leagueId)
        .order("rank"),
      // Missing until migration 0004 has run: the card just stays hidden.
      supabase
        .from("recaps")
        .select("gameweek_id,title,body,model")
        .eq("league_id", leagueId)
        .order("gameweek_id", { ascending: false })
        .limit(1)
        .maybeSingle<{ gameweek_id: number; title: string; body: string; model: string }>(),
    ]);
  const recap = recapRes.error ? null : recapRes.data;
  if (!league) notFound();
  const members = (memberRows ?? []) as Member[];
  const myTeamId = profile?.fpl_team_id ?? null;
  const me = members.find((m) => m.team_id === myTeamId) ?? null;
  const teamIds = members.map((m) => m.team_id);

  // The latest gameweek the fetch job has squads for.
  const { data: latest } = teamIds.length
    ? await supabase
        .from("entry_gameweeks")
        .select("gameweek_id")
        .in("team_id", teamIds)
        .order("gameweek_id", { ascending: false })
        .limit(1)
        .maybeSingle<{ gameweek_id: number }>()
    : { data: null };
  const gw = latest?.gameweek_id ?? null;

  let entries: EntryGameweek[] = [];
  let picks: LeaguePick[] = [];
  let players = new Map<number, PlayerName>();
  let playerPoints: Map<number, number> | null = null;
  if (gw) {
    const [entriesRes, picksRes] = await Promise.all([
      supabase
        .from("entry_gameweeks")
        .select(
          "team_id,points,points_on_bench,event_transfers,event_transfers_cost,active_chip",
        )
        .eq("gameweek_id", gw)
        .in("team_id", teamIds),
      supabase
        .from("picks")
        .select("team_id,player_id,multiplier,is_captain,squad_position")
        .eq("gameweek_id", gw)
        .in("team_id", teamIds),
    ]);
    entries = (entriesRes.data ?? []) as EntryGameweek[];
    picks = (picksRes.data ?? []) as LeaguePick[];
    const playerIds = [...new Set(picks.map((p) => p.player_id))];
    if (playerIds.length) {
      const [playersRes, pointsRes] = await Promise.all([
        supabase.from("players").select("id,web_name").in("id", playerIds),
        supabase
          .from("player_gameweeks")
          .select("player_id,points")
          .eq("gameweek_id", gw)
          .in("player_id", playerIds),
      ]);
      players = new Map(
        ((playersRes.data ?? []) as PlayerName[]).map((p) => [p.id, p]),
      );
      // Missing until the 0002 migration has run: captain awards just stay hidden.
      if (!pointsRes.error && pointsRes.data?.length) {
        playerPoints = new Map(
          (pointsRes.data as { player_id: number; points: number }[]).map(
            (r) => [r.player_id, r.points],
          ),
        );
      }
    }
  }

  const awards = weeklyAwards(members, entries, picks, playerPoints, players);
  const captains = captainChoices(members, picks, players, playerPoints);
  const owned = ownership(picks, players, myTeamId);
  const myDifferentials = myTeamId ? differentials(owned.rows).slice(0, 5) : [];
  const myThreats = myTeamId ? threats(owned.rows).slice(0, 5) : [];
  const rival = myTeamId
    ? closestRival(members, picks, players, myTeamId)
    : null;
  const chips = entries.filter((e) => e.active_chip);
  const nameOf = (teamId: number) =>
    members.find((m) => m.team_id === teamId)?.manager_name ?? `Team ${teamId}`;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{league.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {[
            gw ? `After GW${gw}` : null,
            `${members.length} managers`,
            me?.rank ? `you're ${ordinal(me.rank)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {recap && (
        <section
          id="recap"
          className="scroll-mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            GW{recap.gameweek_id} recap
          </div>
          <h2 className="mt-1 text-lg font-bold leading-snug">{recap.title}</h2>
          <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {recap.body
              .split(/\n\s*\n/)
              .filter((p) => p.trim())
              .map((p, i) => (
                <p key={i}>{p.trim()}</p>
              ))}
          </div>
          <p className="mt-3 text-xs text-zinc-500">
            Written by AI ({recap.model}) from the gameweek&apos;s numbers, in full roast mode. It only knows
            the stats, so don&apos;t take it personally.
          </p>
        </section>
      )}

      {rival && (
        <Card
          title={rival.ahead ? "Chasing" : "Being chased by"}
          note={rival.rival.team_name}
        >
          <p className="text-lg font-semibold">
            {rival.ahead
              ? `${firstName(rival.rival.manager_name)} is ${rival.gap} pts ahead`
              : `You lead ${firstName(rival.rival.manager_name)} by ${rival.gap} pts`}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Only they start</dt>
              <dd>{rival.onlyThem.join(", ") || "Nobody"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Only you start</dt>
              <dd>{rival.onlyMe.join(", ") || "Nobody"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Their captain</dt>
              <dd>{rival.theirCaptain ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Your captain</dt>
              <dd>{rival.myCaptain ?? "-"}</dd>
            </div>
          </dl>
        </Card>
      )}

      <Card title="Table" note={gw ? `GW${gw} points · total` : undefined}>
        <ol className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {members.map((m) => (
            <li
              key={m.team_id}
              className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 ${
                m.team_id === myTeamId
                  ? "bg-emerald-50 dark:bg-emerald-950/60"
                  : ""
              }`}
            >
              <span className="w-6 text-right text-sm tabular-nums text-zinc-500">
                {m.rank}
              </span>
              <span className="w-7">
                <Movement value={movement(m)} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.manager_name}</div>
                <div className="truncate text-xs text-zinc-500">
                  {m.team_name}
                </div>
              </div>
              <span className="w-8 text-right text-sm tabular-nums text-zinc-500">
                {m.event_total ?? "-"}
              </span>
              <span className="w-10 text-right font-semibold tabular-nums">
                {m.total ?? "-"}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {awards.length > 0 && (
        <Card title={`GW${gw} awards`}>
          <div className="grid grid-cols-2 gap-3">
            {awards.map((a) => (
              <div
                key={a.id}
                className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-900"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {a.title}
                </div>
                <div className="mt-1 font-semibold">
                  {firstName(a.manager_name)}
                </div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {a.value}
                </div>
              </div>
            ))}
          </div>
          {chips.length > 0 && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Chips:{" "}
              {chips
                .map(
                  (e) =>
                    `${firstName(nameOf(e.team_id))} (${CHIP_NAMES[e.active_chip!] ?? e.active_chip})`,
                )
                .join(", ")}
            </p>
          )}
          {!playerPoints && (
            <p className="mt-3 text-xs text-zinc-500">
              Captain awards appear once player points are stored.
            </p>
          )}
        </Card>
      )}

      {captains.length > 0 && (
        <Card title={`GW${gw} captains`}>
          <ul className="flex flex-col gap-3">
            {captains.map((c) => (
              <li key={c.player_id} className="flex items-start gap-3">
                <span className="w-10 shrink-0 text-right text-lg font-semibold tabular-nums">
                  ×{c.count}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {c.web_name}
                    {c.points != null && (
                      <span className="ml-2 text-sm font-normal text-zinc-500">
                        {c.points * 2} pts as captain
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-500">
                    {c.managers.join(", ")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {owned.squads > 0 && (
        <Card title="Who owns whom" note={`share of ${owned.squads} squads`}>
          <h3 className="text-sm font-medium text-zinc-500">The template</h3>
          <ul className="mt-1 mb-4 flex flex-wrap gap-2">
            {[...owned.rows]
              .sort((a, b) => b.owners - a.owners)
              .slice(0, 8)
              .map((r) => (
                <li
                  key={r.player_id}
                  className="rounded-lg bg-zinc-100 px-2 py-1 text-sm dark:bg-zinc-800"
                >
                  {r.web_name}{" "}
                  <span className="text-zinc-500">{pct(r.share)}</span>
                </li>
              ))}
          </ul>
          {myTeamId && (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <h3 className="font-medium text-emerald-700 dark:text-emerald-400">
                    Your differentials
                  </h3>
                  <ul className="mt-1 space-y-1">
                    {myDifferentials.length ? (
                      myDifferentials.map((r) => (
                        <li key={r.player_id}>
                          {r.web_name}{" "}
                          <span className="text-zinc-500">{pct(r.share)}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-zinc-500">
                        None. You&apos;re playing the template.
                      </li>
                    )}
                  </ul>
                </div>
                <div>
                  <h3 className="font-medium text-rose-700 dark:text-rose-400">
                    Threats you don&apos;t own
                  </h3>
                  <ul className="mt-1 space-y-1">
                    {myThreats.length ? (
                      myThreats.map((r) => (
                        <li key={r.player_id}>
                          {r.web_name}{" "}
                          <span className="text-zinc-500">
                            EO {pct(r.effective)}
                          </span>
                        </li>
                      ))
                    ) : (
                      <li className="text-zinc-500">
                        None. You&apos;re covered.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                EO (effective ownership) counts captains twice, so it shows how
                many points the league gains when that player scores.
              </p>
            </>
          )}
        </Card>
      )}

      {!gw && (
        <Card title="No squads yet">
          <p className="text-zinc-600 dark:text-zinc-400">
            Squads appear after the fetch job runs following a deadline.
          </p>
        </Card>
      )}

      <Link
        href="/league"
        className="text-sm text-zinc-500 underline-offset-4 hover:underline"
      >
        All your leagues
      </Link>
    </main>
  );
}
