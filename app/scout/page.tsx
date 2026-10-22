import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AskRaptor from "@/components/AskRaptor";
import PlayerLink from "@/components/PlayerLink";
import ScoutNav from "@/components/ScoutNav";
import ScoutPlayers from "@/components/ScoutPlayers";
import { scoutHref as href, scoutParams, type ScoutParams as Params } from "@/lib/scoutView";
import { askStorageKey } from "@/lib/askView";
import { starterQuestions } from "@/lib/ask/prompt";
import { formatPrice, POSITIONS } from "@/lib/fpl";
import type { Fixture, Team } from "@/lib/gameweek";
import {
  differentials,
  fixtureTicker,
  minutesFloor,
  statRow,
  type PlayerStats,
  type ScoutPlayer,
  type TickerCell,
} from "@/lib/scout";
import { leagueOwnership } from "@/lib/leagueOwnership";
import type { TransferPlanRow } from "@/lib/plan";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Scout · FPL Raptor" };

type Gameweek = { id: number; name: string; deadline_time: string; is_next: boolean; finished: boolean };
const POS_SHORT = ["All", "GK", "DEF", "MID", "FWD"];

function Chip({ to, on, children }: { to: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      scroll={false}
      aria-current={on ? "true" : undefined}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium whitespace-nowrap ${on ? "bg-accent-soft text-accent" : "bg-surface-muted text-muted"}`}
    >
      {children}
    </Link>
  );
}

// FPL's difficulty colours, roughly: 1-2 green, 3 grey, 4-5 red.
const FDR_CLASS: Record<number, string> = {
  1: "bg-emerald-700 text-white",
  2: "bg-emerald-300 text-emerald-950",
  3: "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  4: "bg-rose-300 text-rose-950",
  5: "bg-rose-800 text-white",
};

function FixtureChip({ cell }: { cell: TickerCell; compact?: boolean }) {
  return <span className={`block rounded px-1.5 py-1 text-center text-xs leading-5 ${FDR_CLASS[cell.difficulty ?? 3] ?? FDR_CLASS[3]}`}>
    <span className="block font-semibold">{cell.opponent} ({cell.home ? "H" : "A"})</span>
    <span className="block text-[10px]">Difficulty {cell.difficulty ?? "?"}</span>
  </span>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="surface min-w-0 p-4 sm:p-5">{children}</section>;
}

function Shell({ subtitle, children }: { params: Params; subtitle: string; children: React.ReactNode }) {
  return <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
    <header><h1 className="page-title">Scout</h1><p className="mt-1 text-sm text-muted">{subtitle}</p></header>
    <ScoutNav />
    {children}
  </main>;
}

/** Ask Raptor's tab: only what the chat needs to start (the agent loads the rest per question). */
async function AskView({ params, userId, supabase }: { params: Params; userId: string; supabase: Awaited<ReturnType<typeof createClient>> }) {
  const [profileRes, gameweekRes, { data: plan }] = await Promise.all([
    supabase.from("profiles").select("fpl_team_id").eq("user_id", userId).maybeSingle<{ fpl_team_id: number | null }>(),
    supabase.from("gameweeks").select("id,name,deadline_time,is_next,finished").order("id"),
    supabase
      .from("transfer_plans")
      .select("from_gameweek,horizon,free_transfers,bank,plan,expected_points,baseline_points,model_version,created_at")
      .eq("user_id", userId)
      .maybeSingle<TransferPlanRow>(),
  ]);
  const { data: profile } = profileRes;
  const gameweeks = (gameweekRes.data ?? []) as Gameweek[];
  const next = gameweeks.find((g) => g.is_next) ?? gameweeks.find((g) => !g.finished) ?? null;
  const squadIds = ((plan?.plan as { squad?: { id: number }[] } | undefined)?.squad ?? []).map((s) => s.id);
  const { data: flaggedRows } = squadIds.length
    ? await supabase.from("players").select("web_name,status").in("id", squadIds)
    : { data: [] };
  const blocked = profileRes.error || gameweekRes.error ? "Your team context could not load. Try refreshing this page." : !profile?.fpl_team_id ? "Link your FPL team in Account so Raptor can use your squad." : !next ? "The season is over." : null;
  const storageKey = askStorageKey(userId, profile?.fpl_team_id ?? null, next?.id ?? null);
  return (
    <Shell params={params} subtitle="Talk your transfers through">
      <AskRaptor
        key={storageKey}
        storageKey={storageKey}
        needsTeam={!profileRes.error && !profile?.fpl_team_id}
        enabled={Boolean(process.env.GEMINI_API_KEY?.trim())}
        gameweek={next?.id ?? null}
        blocked={blocked}
        suggestions={starterQuestions({
          plan: plan ?? null,
          gameweek: next?.id ?? null,
          flagged: ((flaggedRows ?? []) as { web_name: string; status: string }[]).filter((r) => r.status !== "a").map((r) => r.web_name),
        })}
      />
    </Shell>
  );
}

export default async function ScoutPage({ searchParams }: PageProps<"/scout">) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/scout");

  const sp = await searchParams;
  const params = scoutParams({ get: name => { const value = sp[name]; return (Array.isArray(value) ? value[0] : value) ?? null; } });
  const { view } = params;
  if (view === "ask") return <AskView params={params} userId={userId} supabase={supabase} />;

  const [{ data: profile }, gameweekRes, teamRes, playerRes, statsRes] = await Promise.all([
    supabase.from("profiles").select("fpl_team_id").eq("user_id", userId).maybeSingle<{ fpl_team_id: number | null }>(),
    supabase.from("gameweeks").select("id,name,deadline_time,is_next,finished").order("id"),
    supabase.from("teams").select("id,name,short_name").order("short_name"),
    supabase
      .from("players")
      .select("id,web_name,team_id,position,now_cost,status,chance_of_playing_next_round,selected_by_percent,form,total_points"),
    supabase
      .from("player_stats")
      .select(
        "player_id,minutes,goals,assists,clean_sheets,defensive_contribution,xg,xa,xgc,recent_gameweeks,recent_minutes,recent_points,recent_xg,recent_xa,recent_dc,xp_gameweek,xp_next,xp_next5",
      ),
  ]);
  const myTeamId = profile?.fpl_team_id ?? null;
  if (gameweekRes.error || teamRes.error || playerRes.error) throw new Error("Scout data could not load");
  const gameweeks = (gameweekRes.data ?? []) as Gameweek[];
  const teams = (teamRes.data ?? []) as Team[];
  const players = (playerRes.data ?? []) as ScoutPlayer[];
  const stats = new Map(((statsRes.data ?? []) as PlayerStats[]).map((s) => [s.player_id, s]));
  const statsReady = !statsRes.error && stats.size > 0;

  const next = gameweeks.find((g) => g.is_next) ?? gameweeks.find((g) => !g.finished) ?? null;
  const ahead = next ? gameweeks.filter((g) => g.id >= next.id).slice(0, 6).map((g) => g.id) : [];
  const played = gameweeks.filter((g) => g.finished).length;
  const fixtureRes = ahead.length
    ? await supabase
        .from("fixtures")
        .select("id,gameweek_id,home_team_id,away_team_id,home_difficulty,away_difficulty,kickoff_time")
        .in("gameweek_id", ahead)
    : { data: [], error: null };
  const fixtures = (fixtureRes.data ?? []) as Fixture[];
  const ticker = fixtureTicker(teams, fixtures, ahead.slice(0, params.weeks));
  const nextThree = new Map(fixtureTicker(teams, fixtures, ahead.slice(0, 3)).map((r) => [r.team.id, r.weeks]));
  const shortName = new Map(teams.map((t) => [t.id, t.short_name]));

  // Your squad and your league's squads (latest gameweek stored), for differentials.
  const { mine, owners: leagueOwners, squads, leagueName } = await leagueOwnership(supabase, myTeamId);
  const myClubs = new Map<number, number>();
  for (const p of players) if (mine.has(p.id)) myClubs.set(p.team_id, (myClubs.get(p.team_id) ?? 0) + 1);

  const floor = minutesFloor(params.range === "recent" ? Math.min(played, 6) : played);
  const rows = players
    .filter((p) => !params.pos || p.position === params.pos)
    .map((p) => statRow(p, stats.get(p.id), params.range, floor));
  const diffs = differentials(rows, leagueOwners, squads, mine).slice(0, 15);
  const xpFrom = next ? `GW${next.id}-${Math.min(38, next.id + 4)}` : "";

  return (
    <Shell params={params} subtitle={next ? `Looking ahead from ${next.name}` : "The season is over"}>
      {view === "fixtures" && (
        fixtureRes.error ? <Card><p className="text-sm text-warning">Fixtures couldn’t load. Refresh this page to try again.</p></Card> : !ahead.length ? <Card><p className="text-sm text-muted">No upcoming gameweeks.</p></Card> : !fixtures.length ? <Card><p className="text-sm text-muted">Upcoming fixtures haven’t been published yet.</p></Card> :
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Kindest run first. H: home · A: away.</p>
            <div className="flex gap-1">
              <Chip to={href(params, { weeks: 3 })} on={params.weeks === 3}>
                3 GWs
              </Chip>
              <Chip to={href(params, { weeks: 6 })} on={params.weeks === 6}>
                6 GWs
              </Chip>
            </div>
          </div>
          <div className="overflow-x-auto" role="region" aria-label="Fixture ticker, scroll horizontally" tabIndex={0}><table className={`w-full ${params.weeks === 3 ? "min-w-[300px]" : "min-w-[600px]"} table-fixed border-separate border-spacing-x-0.5 border-spacing-y-1 text-sm`}>
            <thead>
              <tr className="text-[11px] text-muted">
                <th className="w-12 text-left font-medium">Club</th>
                {ahead.slice(0, params.weeks).map((g) => (
                  <th key={g} className="font-medium">
                    GW{g}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ticker.map((r) => (
                <tr key={r.team.id}>
                  <td className="text-xs font-semibold">
                    {r.team.short_name}
                    {myClubs.get(r.team.id) ? (
                      <span className="ml-0.5 align-top text-[9px] font-medium text-emerald-700 dark:text-emerald-400" title="Players you own">
                        {myClubs.get(r.team.id)}
                      </span>
                    ) : null}
                  </td>
                  {r.weeks.map((cells, i) => (
                    <td key={i} className="align-middle">
                      {cells.length === 0 ? (
                        <span className="block rounded text-center text-[11px] leading-5 text-zinc-400 ring-1 ring-zinc-200 ring-inset dark:ring-zinc-800">
                          Blank
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {cells.length > 1 && <span className="text-center text-[10px] text-muted">{cells.length === 2 ? "Double" : `${cells.length} fixtures`}</span>}
                          {cells.map((c, j) => (
                            <FixtureChip key={j} cell={c} compact={cells.length > 1} />
                          ))}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="mt-3 text-xs text-muted">
            Colours are FPL&apos;s fixture difficulty (dark green easiest, dark red hardest). Stacked fixtures are a double
            gameweek, “Blank” means no fixture. Difficulty runs from 1 (easiest) to 5 (hardest). Green numbers: players you own at that club.
          </p>
        </Card>
      )}

      {view === "differentials" && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {POS_SHORT.map((label, pos) => (
            <Chip key={label} to={href(params, { pos })} on={params.pos === pos}>
              {label}
            </Chip>
          ))}
        </div>
      )}

      {view === "differentials" && !statsReady && (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Player statistics are unavailable. Try again later or use Players to search the directory.
          </p>
        </Card>
      )}

      {(view === "players" || view === "stats") && <ScoutPlayers players={players} stats={Array.from(stats.values())} teams={teams} mine={Array.from(mine)} played={played} xpFrom={xpFrom} statsReady={statsReady} />}

      {view === "differentials" && statsReady && (
        !myTeamId ? <Card><h2 className="section-title">Link your team for differentials</h2><p className="mt-2 text-sm text-muted">Raptor needs your squad to exclude players you already own.</p><Link href="/account" className="text-link mt-3 inline-flex min-h-11 items-center text-sm">Go to Account</Link></Card> : mine.size !== 15 ? <Card><h2 className="section-title">Your latest squad isn’t available</h2><p className="mt-2 text-sm text-muted">Differentials need a complete squad so your own players can be excluded. Try again after the next data update.</p></Card> :
        <Card>
          <p className="mb-3 text-xs text-muted">
            Under 10% owned overall,{" "}
            {squads
              ? Math.floor(squads * 0.2) === 0
                ? `in none of the other ${squads} squads in ${leagueName ?? "your league"}`
                : `in at most ${Math.floor(squads * 0.2)} of the other ${squads} squads in ${leagueName ?? "your league"}`
              : "league ownership unavailable (overall ownership only)"}{" "}
            and not in yours, ranked by the model&apos;s next five gameweeks.
          </p>
          {!diffs.length && <p className="py-5 text-sm text-muted">No players match these differential criteria.</p>}
          <ul className="divide-y divide-line dark:divide-line">
            {diffs.map((d) => (
              <li key={d.row.player.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <PlayerLink id={d.row.player.id} className="block max-w-full truncate font-medium">
                    {d.row.player.web_name}
                  </PlayerLink>
                  <div className="truncate text-xs text-muted">
                    {shortName.get(d.row.player.team_id)} · {POSITIONS[d.row.player.position]} ·{" "}
                    {formatPrice(d.row.player.now_cost)} · {d.row.player.selected_by_percent ?? 0}%
                    {squads ? (d.owners ? ` · ${d.owners} rival${d.owners > 1 ? "s" : ""}` : " · no rivals") : ""}
                  </div>
                  <div className="mt-2 grid max-w-64 grid-cols-3 gap-1">
                    {(nextThree.get(d.row.player.team_id) ?? []).map((cells, i) =>
                      fixtureRes.error ? <span key={i} className="text-xs text-muted">Unavailable</span> : cells.length ? (
                        <div key={i} className="flex flex-col gap-0.5"><span className="text-center text-[10px] text-muted">GW{ahead[i]}{cells.length > 1 ? " · Double" : ""}</span>
                          {cells.map((c, j) => (
                            <FixtureChip key={j} cell={c} compact />
                          ))}
                        </div>
                      ) : (
                        <span key={i} className="block rounded text-center text-[10px] leading-5 text-zinc-400 ring-1 ring-zinc-200 ring-inset dark:ring-zinc-800">
                          Blank
                        </span>
                      ),
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums">{d.row.xp5?.toFixed(1) ?? "-"}</div>
                  <div className="text-[11px] text-muted">xP {xpFrom}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Shell>
  );
}
