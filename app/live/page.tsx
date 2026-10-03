import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import LocalTime from "@/components/LocalTime";
import Pitch from "@/components/Pitch";
import PlayerLink from "@/components/PlayerLink";
import ViewToggle from "@/components/ViewToggle";
import { getEventFixtures, getLive, getPicks } from "@/lib/fplApi";
import { CHIP_NAMES } from "@/lib/gameweek";
import { ordinal } from "@/lib/league";
import {
  headToHead,
  isMatchTime,
  leagueImpact,
  liveGameweeks,
  liveTable,
  matchState,
  provisionalBonus,
  scoreTeam,
  scoreline,
  type LiveElement,
  type LiveFixture,
  type LiveMember,
  type LivePick,
  type LivePlayer,
  type ScoredPick,
  type TeamLive,
} from "@/lib/live";
import { livePitch } from "@/lib/pitch";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Live · FPL Raptor" };

type Gameweek = { id: number; name: string; deadline_time: string; is_current: boolean; finished: boolean };
type MemberRow = { league_id: number; team_id: number; manager_name: string; team_name: string; total: number | null; event_total: number | null };
type PickRow = { team_id: number; player_id: number; squad_position: number; multiplier: number; is_captain: boolean; is_vice_captain: boolean };
type EntryRow = { team_id: number; gameweek_id: number; total_points: number | null; points: number | null; active_chip: string | null; event_transfers_cost: number | null };

const POS = ["", "GK", "DEF", "MID", "FWD"];

function Card({ title, note, children }: { title?: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      {(title || note) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {note && <span className="text-xs text-zinc-500">{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

function Movement({ value }: { value: number }) {
  if (value > 0) return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">▲{value}</span>;
  if (value < 0) return <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">▼{-value}</span>;
  return <span className="text-xs text-zinc-400">–</span>;
}

const kickoffFormat: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit" };

function MatchStatus({ f }: { f: LiveFixture }) {
  const state = matchState(f);
  if (state === "done") return <>FT</>;
  if (state === "live")
    return (
      <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        {f.minutes}&apos;
      </span>
    );
  return f.kickoff_time ? <LocalTime iso={f.kickoff_time} options={kickoffFormat} /> : <>TBC</>;
}

function PlayerRow({ sp, shortName }: { sp: ScoredPick; shortName: (id: number) => string }) {
  const p = sp.player;
  const counted = sp.counts;
  const shown = counted ? sp.points * sp.multiplier : sp.points;
  const badge = sp.multiplier === 3 ? "TC" : sp.multiplier === 2 ? "C" : sp.pick.is_vice_captain ? "V" : null;
  const notes: string[] = [];
  if (sp.subbedIn) notes.push("subbed on");
  if (sp.subbedOut) notes.push("subbed off");
  else if (sp.status === "out") notes.push("didn't play");
  if (sp.bonus > 0) notes.push(`+${sp.bonus} bonus${sp.provisional ? " (provisional)" : ""}`);
  return (
    <li className={`flex items-center gap-3 py-2 ${counted ? "" : "opacity-60"}`}>
      <span className="w-8 shrink-0 text-xs text-zinc-500">{POS[p?.position ?? 0]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <PlayerLink id={sp.pick.element} className="truncate font-medium">
            {p?.web_name ?? `#${sp.pick.element}`}
          </PlayerLink>
          {badge && (
            <span className="rounded-full bg-zinc-900 px-1.5 text-[10px] font-bold leading-4 text-white dark:bg-zinc-100 dark:text-zinc-900">{badge}</span>
          )}
          {sp.status === "playing" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" title="Playing now" />}
        </div>
        <div className="text-xs text-zinc-500">
          {sp.fixtures.length === 0
            ? "No match this gameweek"
            : sp.fixtures.map((f, i) => (
                <span key={f.id}>
                  {i > 0 && " + "}
                  {scoreline(f, shortName)} · <MatchStatus f={f} />
                </span>
              ))}
          {notes.length > 0 && <span className="text-zinc-600 dark:text-zinc-400"> · {notes.join(" · ")}</span>}
        </div>
      </div>
      <div className="w-10 shrink-0 text-right">
        <div className="font-semibold tabular-nums">{sp.minutes > 0 || sp.status !== "to-play" ? shown : "–"}</div>
        {sp.minutes > 0 && <div className="text-[10px] text-zinc-500">{sp.minutes}&apos;</div>}
      </div>
    </li>
  );
}

export default async function LivePage({ searchParams }: PageProps<"/live">) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/live");

  const [{ data: profile }, { data: gameweekRows }, { data: teamRows }] = await Promise.all([
    supabase.from("profiles").select("fpl_team_id").eq("user_id", userId).maybeSingle<{ fpl_team_id: number | null }>(),
    supabase.from("gameweeks").select("id,name,deadline_time,is_current,finished").order("id"),
    supabase.from("teams").select("id,short_name"),
  ]);
  const myTeamId = profile?.fpl_team_id;
  if (!myTeamId) redirect("/onboarding");
  const gameweeks = (gameweekRows ?? []) as Gameweek[];
  const { gw, next: nextGw } = liveGameweeks(gameweeks);
  const shortNames = new Map(((teamRows ?? []) as { id: number; short_name: string }[]).map((t) => [t.id, t.short_name]));
  const shortName = (id: number) => shortNames.get(id) ?? "?";

  if (!gw) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Live</h1>
        <Card>
          <p className="text-zinc-600 dark:text-zinc-400">Live scores start at the first deadline of the season.</p>
        </Card>
      </main>
    );
  }

  // Which mini-league to show: ?league=, else the first followed one you're in.
  const { league } = await searchParams;
  const { data: myLeagueRows } = await supabase
    .from("league_members")
    .select("league_id,leagues(name)")
    .eq("team_id", myTeamId);
  const myLeagues = (myLeagueRows ?? []) as unknown as { league_id: number; leagues: { name: string } | null }[];
  const leagueId = myLeagues.find((l) => String(l.league_id) === league)?.league_id ?? myLeagues[0]?.league_id ?? null;
  const leagueName = myLeagues.find((l) => l.league_id === leagueId)?.leagues?.name ?? null;

  const { data: memberRows } = leagueId
    ? await supabase
        .from("league_members")
        .select("league_id,team_id,manager_name,team_name,total,event_total")
        .eq("league_id", leagueId)
    : { data: null };
  const members: MemberRow[] = (memberRows as MemberRow[] | null) ?? [
    { league_id: 0, team_id: myTeamId, manager_name: "You", team_name: "", total: null, event_total: null },
  ];
  const teamIds = members.map((m) => m.team_id);

  const [liveRes, fixturesRes, playersRes, picksRes, entriesRes] = await Promise.all([
    getLive(gw.id),
    getEventFixtures(gw.id),
    supabase.from("players").select("id,web_name,team_id,position").limit(2000),
    supabase
      .from("picks")
      .select("team_id,player_id,squad_position,multiplier,is_captain,is_vice_captain")
      .eq("gameweek_id", gw.id)
      .in("team_id", teamIds),
    supabase
      .from("entry_gameweeks")
      .select("team_id,gameweek_id,total_points,points,active_chip,event_transfers_cost")
      .in("gameweek_id", [gw.id - 1, gw.id])
      .in("team_id", teamIds),
  ]);

  if (!liveRes.ok || !fixturesRes.ok) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{gw.name} live</h1>
        <Card>
          <p className="text-zinc-600 dark:text-zinc-400">
            FPL isn&apos;t answering right now (it often goes quiet while it updates). Try again in a minute.
          </p>
        </Card>
      </main>
    );
  }

  const live = new Map<number, LiveElement>(liveRes.data.elements.map((e) => [e.id, e]));
  const fixtures = fixturesRes.data;
  const players = new Map<number, LivePlayer>(((playersRes.data ?? []) as LivePlayer[]).map((p) => [p.id, p]));
  const bonus = provisionalBonus(fixtures, live);

  const storedPicks = new Map<number, LivePick[]>();
  for (const r of (picksRes.data ?? []) as PickRow[]) {
    const list = storedPicks.get(r.team_id) ?? [];
    list.push({ element: r.player_id, position: r.squad_position, multiplier: r.multiplier, is_captain: r.is_captain, is_vice_captain: r.is_vice_captain });
    storedPicks.set(r.team_id, list);
  }
  const entries = (entriesRes.data ?? []) as EntryRow[];
  const entry = (teamId: number, gameweekId: number) => entries.find((e) => e.team_id === teamId && e.gameweek_id === gameweekId);

  // Squads come from the database when the fetch job has them, else straight from FPL.
  const liveMembers: LiveMember[] = await Promise.all(
    members.map(async (m) => {
      let picks = storedPicks.get(m.team_id) ?? [];
      const thisWeek = entry(m.team_id, gw.id);
      let chip = thisWeek?.active_chip ?? null;
      let cost = thisWeek?.event_transfers_cost ?? 0;
      let startTotal = gw.id === 1 ? 0 : (entry(m.team_id, gw.id - 1)?.total_points ?? null);
      if (picks.length !== 15 || !thisWeek || startTotal === null) {
        const res = await getPicks(m.team_id, gw.id);
        if (res.ok) {
          if (picks.length !== 15) picks = res.data.picks;
          chip = res.data.active_chip;
          cost = res.data.entry_history.event_transfers_cost ?? 0;
          if (startTotal === null) {
            const h = res.data.entry_history;
            startTotal = (h.total_points ?? 0) - (h.points ?? 0);
          }
        }
      }
      return {
        team_id: m.team_id,
        manager_name: m.manager_name,
        team_name: m.team_name,
        startTotal: startTotal ?? (m.total ?? 0) - (m.event_total ?? 0),
        live: picks.length === 15 ? scoreTeam(picks, chip, cost, players, live, fixtures, bonus) : null,
      };
    }),
  );

  const table = liveTable(liveMembers);
  const mine = table.find((r) => r.team_id === myTeamId) ?? null;
  const team: TeamLive | null = mine?.live ?? null;
  const sorted = [...fixtures].sort((a, b) => (a.kickoff_time ?? "").localeCompare(b.kickoff_time ?? ""));
  const doneCount = fixtures.filter((f) => matchState(f) === "done").length;
  const active = isMatchTime(fixtures);
  const anyBonusPending = bonus.size > 0;
  const pitch = team ? livePitch(team, shortName) : null;
  const impacts = table.length > 1 ? leagueImpact(liveMembers, myTeamId) : [];
  const saving = impacts.filter((i) => i.impact >= 0.5).slice(0, 4);
  const hurting = [...impacts].reverse().filter((i) => i.impact <= -0.5).slice(0, 4);
  const race = table.length > 1 ? headToHead(table, myTeamId) : null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      {active && <AutoRefresh />}
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{gw.name} live</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {doneCount === fixtures.length
            ? gw.finished
              ? "All matches done · points final"
              : "All matches done · waiting for FPL to confirm points"
            : `${doneCount} of ${fixtures.length} matches done`}
          {active ? " · updates every minute" : ""}
        </p>
      </header>

      {team ? (
        <Card title="Your score" note={mine && table.length > 1 ? leagueName ?? undefined : undefined}>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-5xl font-bold tabular-nums">{team.points}</div>
              <div className="mt-1 text-sm text-zinc-500">
                {[
                  team.transferCost ? `after a −${team.transferCost} hit` : null,
                  team.chip ? CHIP_NAMES[team.chip] ?? team.chip : null,
                  team.toPlay ? `${team.toPlay} to play` : "everyone's played",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {mine && table.length > 1 && (
              <div className="text-right">
                <div className="text-2xl font-semibold">{ordinal(mine.rank)}</div>
                <div className="text-xs text-zinc-500">
                  live in the league <Movement value={mine.startRank - mine.rank} />
                </div>
              </div>
            )}
          </div>
        </Card>
      ) : null}
      {(saving.length > 0 || hurting.length > 0) && (
        <Card title="Who's moving you" note={leagueName ? `against the rest of ${leagueName}` : undefined}>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Saving you", rows: saving, tone: "text-emerald-700 dark:text-emerald-400" },
              { label: "Hurting you", rows: hurting, tone: "text-rose-700 dark:text-rose-400" },
            ].map((col) => (
              <div key={col.label}>
                <h3 className={`text-sm font-semibold ${col.tone}`}>{col.label}</h3>
                {col.rows.length === 0 ? (
                  <p className="mt-1 text-sm text-zinc-500">Nobody yet.</p>
                ) : (
                  <ul className="mt-1 space-y-2">
                    {col.rows.map((r) => (
                      <li key={r.id} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <PlayerLink id={r.id} className="block truncate text-sm font-medium">
                            {r.name}
                          </PlayerLink>
                          <div className="text-[11px] text-zinc-500 tabular-nums">
                            {r.points} pts, you {r.mine === 0 ? "don't" : `×${r.mine}`}, league {Math.round(r.eo * 100)}%
                          </div>
                        </div>
                        <span className={`text-sm font-bold tabular-nums ${col.tone}`}>
                          {r.impact > 0 ? "+" : "−"}
                          {Math.abs(r.impact).toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {race && race.swings.length > 0 && (
            <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <p className="text-sm">
                <span className="font-semibold">You vs {race.rival.manager_name.split(" ")[0]}</span>{" "}
                <span className="text-zinc-500">
                  ({race.ahead ? `you're ${race.gap} ahead` : `${race.gap} behind`} live, {race.gwDiff >= 0 ? "+" : "−"}
                  {Math.abs(race.gwDiff)} this week)
                </span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {race.swings.map((sw) => (
                  <span
                    key={sw.id}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                      sw.diff > 0
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                    }`}
                  >
                    {sw.name} {sw.diff > 0 ? "+" : "−"}
                    {Math.abs(sw.diff)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            +5 means that player has gained you 5 points on the average rival: his points times how much more of him you
            have than they do (captains count double).
          </p>
        </Card>
      )}
      {team ? (
        <ViewToggle
          title="Your players"
          note={anyBonusPending ? "* includes provisional bonus" : undefined}
          pitch={<Pitch starters={pitch!.starters} bench={pitch!.bench} benchNote={team.chip === "bboost" ? "Bench Boost: all count" : undefined} />}
          list={
            <Card>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {team.picks
                  .filter((p) => p.pick.position <= 11)
                  .map((sp) => (
                    <PlayerRow key={sp.pick.element} sp={sp} shortName={shortName} />
                  ))}
              </ul>
              <h3 className="mt-4 text-sm font-semibold">Bench{team.chip === "bboost" ? " (Bench Boost: all count)" : ""}</h3>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {team.picks
                  .filter((p) => p.pick.position > 11)
                  .map((sp) => (
                    <PlayerRow key={sp.pick.element} sp={sp} shortName={shortName} />
                  ))}
              </ul>
            </Card>
          }
        />
      ) : (
        <Card>
          <p className="text-zinc-600 dark:text-zinc-400">Couldn&apos;t load your squad for {gw.name} from FPL. Try again in a minute.</p>
        </Card>
      )}

      {table.length > 1 && (
        <Card title={leagueName ? `${leagueName}, live` : "League, live"} note="GW · total">
          <ol className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {table.map((r) => (
              <li
                key={r.team_id}
                className={`-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 ${r.team_id === myTeamId ? "bg-emerald-50 dark:bg-emerald-950/60" : ""}`}
              >
                <span className="w-6 text-right text-sm tabular-nums text-zinc-500">{r.rank}</span>
                <span className="w-7">
                  <Movement value={r.startRank - r.rank} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.manager_name}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {r.live
                      ? [
                          r.live.captain?.player ? `C ${r.live.captain.player.web_name} ${r.live.captain.points * r.live.captain.multiplier}` : null,
                          r.live.toPlay ? `${r.live.toPlay} to play` : null,
                          r.live.chip ? CHIP_NAMES[r.live.chip] ?? r.live.chip : null,
                          r.live.transferCost ? `−${r.live.transferCost}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "squad not available"}
                  </div>
                </div>
                <span className="w-8 text-right text-sm tabular-nums text-zinc-500">{r.gwPoints ?? "-"}</span>
                <span className="w-11 text-right font-semibold tabular-nums">{r.liveTotal}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-zinc-500">
            Live totals include provisional bonus and projected subs, so they can move before FPL confirms them. Arrows show
            places gained since the deadline.
          </p>
        </Card>
      )}

      <Card title="Matches">
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800/80">
          {sorted.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 py-2">
              <span className={matchState(f) === "upcoming" ? "text-zinc-600 dark:text-zinc-400" : "font-medium"}>{scoreline(f, shortName)}</span>
              <span className="text-xs text-zinc-500">
                <MatchStatus f={f} />
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {gw.finished && nextGw && (
        <p className="text-sm text-zinc-500">
          {nextGw.name} goes live at its deadline.{" "}
          <Link href="/me" className="underline-offset-4 hover:underline">
            Get ready on My gameweek
          </Link>
        </p>
      )}
      {myLeagues.length > 1 && (
        <p className="text-sm text-zinc-500">
          Other leagues:{" "}
          {myLeagues
            .filter((l) => l.league_id !== leagueId)
            .map((l, i) => (
              <span key={l.league_id}>
                {i > 0 && ", "}
                <Link href={`/live?league=${l.league_id}`} className="underline-offset-4 hover:underline">
                  {l.leagues?.name ?? l.league_id}
                </Link>
              </span>
            ))}
        </p>
      )}
    </main>
  );
}
