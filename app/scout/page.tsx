import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import PlayerLink from "@/components/PlayerLink";
import { formatPrice, POSITIONS } from "@/lib/fpl";
import type { Fixture, Team } from "@/lib/gameweek";
import {
  differentials,
  fixtureTicker,
  minutesFloor,
  SORTS,
  sortStats,
  statRow,
  type PlayerStats,
  type Range,
  type ScoutPlayer,
  type Sort,
  type TickerCell,
} from "@/lib/scout";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Scout · FPL Raptor" };

type View = "fixtures" | "stats" | "differentials";
type Params = { view: View; weeks: number; pos: number; sort: Sort; range: Range };
type Gameweek = { id: number; name: string; deadline_time: string; is_next: boolean; finished: boolean };

const VIEWS: { id: View; label: string }[] = [
  { id: "fixtures", label: "Fixtures" },
  { id: "stats", label: "Stats" },
  { id: "differentials", label: "Differentials" },
];
const SORT_LABELS: Record<Sort, string> = { xp: "xP", xgi90: "xGI/90", form: "Form", points: "Points", price: "Price", owned: "Owned" };
const POS_SHORT = ["All", "GK", "DEF", "MID", "FWD"];

function href(p: Params, change: Partial<Params>): string {
  const next = { ...p, ...change };
  const q = new URLSearchParams({ view: next.view });
  if (next.view === "fixtures" && next.weeks !== 6) q.set("weeks", String(next.weeks));
  if (next.view !== "fixtures") {
    if (next.pos) q.set("pos", String(next.pos));
    if (next.view === "stats" && next.sort !== "xp") q.set("sort", next.sort);
    if (next.view === "stats" && next.range !== "season") q.set("range", next.range);
  }
  return `/scout?${q}`;
}

function Chip({ to, on, children }: { to: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      scroll={false}
      className={`rounded-full px-3 py-1 text-sm whitespace-nowrap ${
        on
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
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
  4: "bg-rose-400 text-white",
  5: "bg-rose-800 text-white",
};

function FixtureChip({ cell, compact = false }: { cell: TickerCell; compact?: boolean }) {
  return (
    <span
      className={`block rounded px-1 text-center font-medium leading-5 ${compact ? "text-[10px]" : "text-[11px]"} ${
        FDR_CLASS[cell.difficulty ?? 3] ?? FDR_CLASS[3]
      }`}
    >
      {cell.home ? cell.opponent : cell.opponent.toLowerCase()}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">{children}</section>;
}

export default async function ScoutPage({ searchParams }: PageProps<"/scout">) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/scout");

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = (VIEWS.some((v) => v.id === one(sp.view)) ? one(sp.view) : "fixtures") as View;
  const params: Params = {
    view,
    weeks: one(sp.weeks) === "3" ? 3 : 6,
    pos: Math.min(4, Math.max(0, Number(one(sp.pos)) || 0)),
    sort: (SORTS as readonly string[]).includes(one(sp.sort) ?? "") ? (one(sp.sort) as Sort) : "xp",
    range: one(sp.range) === "recent" ? "recent" : "season",
  };

  const [{ data: profile }, { data: gwRows }, { data: teamRows }, { data: playerRows }, statsRes] = await Promise.all([
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
  const gameweeks = (gwRows ?? []) as Gameweek[];
  const teams = (teamRows ?? []) as Team[];
  const players = (playerRows ?? []) as ScoutPlayer[];
  const stats = new Map(((statsRes.data ?? []) as PlayerStats[]).map((s) => [s.player_id, s]));
  const statsReady = !statsRes.error && stats.size > 0;

  const next = gameweeks.find((g) => g.is_next) ?? gameweeks.find((g) => !g.finished) ?? null;
  const ahead = next ? gameweeks.filter((g) => g.id >= next.id).slice(0, 6).map((g) => g.id) : [];
  const played = gameweeks.filter((g) => g.finished).length;
  const { data: fixtureRows } = ahead.length
    ? await supabase
        .from("fixtures")
        .select("id,gameweek_id,home_team_id,away_team_id,home_difficulty,away_difficulty,kickoff_time")
        .in("gameweek_id", ahead)
    : { data: [] };
  const fixtures = (fixtureRows ?? []) as Fixture[];
  const ticker = fixtureTicker(teams, fixtures, ahead.slice(0, params.weeks));
  const nextThree = new Map(fixtureTicker(teams, fixtures, ahead.slice(0, 3)).map((r) => [r.team.id, r.weeks]));
  const shortName = new Map(teams.map((t) => [t.id, t.short_name]));

  // Your squad and your league's squads (latest gameweek stored), for differentials.
  let mine = new Set<number>();
  const leagueOwners = new Map<number, number>();
  let squads = 0;
  let leagueName: string | null = null;
  if (myTeamId) {
    const { data: membership } = await supabase
      .from("league_members")
      .select("league_id,leagues(name)")
      .eq("team_id", myTeamId)
      .limit(1);
    const league = ((membership ?? []) as unknown as { league_id: number; leagues: { name: string } | null }[])[0];
    leagueName = league?.leagues?.name ?? null;
    const { data: memberRows } = league
      ? await supabase.from("league_members").select("team_id").eq("league_id", league.league_id)
      : { data: [] };
    const teamIds = [...new Set([myTeamId, ...((memberRows ?? []) as { team_id: number }[]).map((m) => m.team_id)])];
    const { data: latest } = await supabase
      .from("picks")
      .select("gameweek_id")
      .in("team_id", teamIds)
      .order("gameweek_id", { ascending: false })
      .limit(1)
      .maybeSingle<{ gameweek_id: number }>();
    if (latest) {
      const { data: pickRows } = await supabase
        .from("picks")
        .select("team_id,player_id")
        .eq("gameweek_id", latest.gameweek_id)
        .in("team_id", teamIds);
      const picks = (pickRows ?? []) as { team_id: number; player_id: number }[];
      mine = new Set(picks.filter((p) => p.team_id === myTeamId).map((p) => p.player_id));
      const others = picks.filter((p) => p.team_id !== myTeamId);
      squads = new Set(others.map((p) => p.team_id)).size;
      for (const p of others) leagueOwners.set(p.player_id, (leagueOwners.get(p.player_id) ?? 0) + 1);
    }
  }
  const myClubs = new Map<number, number>();
  for (const p of players) if (mine.has(p.id)) myClubs.set(p.team_id, (myClubs.get(p.team_id) ?? 0) + 1);

  const floor = minutesFloor(params.range === "recent" ? Math.min(played, 6) : played);
  const rows = players
    .filter((p) => !params.pos || p.position === params.pos)
    .map((p) => statRow(p, stats.get(p.id), params.range, floor));
  const table = sortStats(rows, params.sort).slice(0, 40);
  const diffs = differentials(rows, leagueOwners, squads, mine).slice(0, 15);
  const xpFrom = next ? `GW${next.id}-${next.id + 4}` : "";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Scout</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {next ? `Looking ahead from ${next.name}` : "The season is over"}
        </p>
      </header>

      <nav className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900" aria-label="Scout views">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={href(params, { view: v.id })}
            scroll={false}
            aria-current={v.id === view ? "page" : undefined}
            className={`flex-1 rounded-lg py-1.5 text-center text-sm font-medium ${
              v.id === view ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === "fixtures" && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">Kindest run first. Capitals at home, lower case away.</p>
            <div className="flex gap-1">
              <Chip to={href(params, { weeks: 3 })} on={params.weeks === 3}>
                3 GWs
              </Chip>
              <Chip to={href(params, { weeks: 6 })} on={params.weeks === 6}>
                6 GWs
              </Chip>
            </div>
          </div>
          <table className="w-full table-fixed border-separate border-spacing-x-0.5 border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-[11px] text-zinc-500">
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
                          –
                        </span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
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
          </table>
          <p className="mt-3 text-xs text-zinc-500">
            Colours are FPL&apos;s fixture difficulty (dark green easiest, dark red hardest). Stacked fixtures are a double
            gameweek, a dash is a blank. Green numbers: players you own at that club.
          </p>
        </Card>
      )}

      {view !== "fixtures" && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {POS_SHORT.map((label, pos) => (
            <Chip key={label} to={href(params, { pos })} on={params.pos === pos}>
              {label}
            </Chip>
          ))}
        </div>
      )}

      {view !== "fixtures" && !statsReady && (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Player stats appear after the next update (the fetch runs every 3 hours).
          </p>
        </Card>
      )}

      {view === "stats" && statsReady && (
        <>
          <div className="flex flex-wrap gap-1">
            {SORTS.map((s) => (
              <Chip key={s} to={href(params, { sort: s })} on={params.sort === s}>
                {SORT_LABELS[s]}
              </Chip>
            ))}
            <span className="mx-1 self-center text-zinc-300 dark:text-zinc-700">|</span>
            <Chip to={href(params, { range: "season" })} on={params.range === "season"}>
              Season
            </Chip>
            <Chip to={href(params, { range: "recent" })} on={params.range === "recent"}>
              Last 6
            </Chip>
          </div>
          <Card>
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-500">
                    <th className="sticky left-0 bg-white pb-2 font-medium dark:bg-[#0a0a0a]">Player</th>
                    <th className="pb-2 text-right font-medium" title={`Model expected points, ${xpFrom}`}>
                      xP 5
                    </th>
                    <th className="pb-2 text-right font-medium">xGI/90</th>
                    <th className="pb-2 text-right font-medium">xG</th>
                    <th className="pb-2 text-right font-medium">xA</th>
                    <th className="pb-2 text-right font-medium" title="Defensive contributions per 90">
                      DC/90
                    </th>
                    <th className="pb-2 text-right font-medium">Mins</th>
                    <th className="pb-2 text-right font-medium">Pts</th>
                    <th className="pb-2 text-right font-medium">Own</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {table.map((r) => (
                    <tr key={r.player.id} className={mine.has(r.player.id) ? "text-emerald-800 dark:text-emerald-300" : ""}>
                      <td className="sticky left-0 max-w-36 bg-white py-1.5 pr-2 dark:bg-[#0a0a0a]">
                        <PlayerLink id={r.player.id} className="block max-w-full truncate font-medium">
                          {r.player.web_name}
                        </PlayerLink>
                        <div className="truncate text-[11px] text-zinc-500">
                          {shortName.get(r.player.team_id)} · {POSITIONS[r.player.position]} · {formatPrice(r.player.now_cost)}
                          {r.player.status !== "a" ? " · ⚠" : ""}
                        </div>
                      </td>
                      <td className="text-right font-semibold tabular-nums">{r.xp5?.toFixed(1) ?? "-"}</td>
                      <td className="text-right tabular-nums">{r.xgi90?.toFixed(2) ?? "-"}</td>
                      <td className="text-right tabular-nums">{r.xg.toFixed(1)}</td>
                      <td className="text-right tabular-nums">{r.xa.toFixed(1)}</td>
                      <td className="text-right tabular-nums">{r.dc90?.toFixed(1) ?? "-"}</td>
                      <td className="text-right tabular-nums text-zinc-500">{r.minutes}</td>
                      <td className="text-right tabular-nums">{r.points}</td>
                      <td className="text-right tabular-nums text-zinc-500">{r.player.selected_by_percent ?? "-"}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              xP 5: the model&apos;s expected points over {xpFrom}. Per-90 numbers need {floor}+ minutes.{" "}
              {params.range === "recent" ? "Last 6 covers the six most recent gameweeks." : "Season totals so far."} Your
              players are in green.
            </p>
          </Card>
        </>
      )}

      {view === "differentials" && statsReady && (
        <Card>
          <p className="mb-3 text-xs text-zinc-500">
            Under 10% owned overall,{" "}
            {squads
              ? Math.floor(squads * 0.2) === 0
                ? `in none of the other ${squads} squads in ${leagueName ?? "your league"}`
                : `in at most ${Math.floor(squads * 0.2)} of the other ${squads} squads in ${leagueName ?? "your league"}`
              : "not in your league's squads"}{" "}
            and not in yours, ranked by the model&apos;s next five gameweeks.
          </p>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {diffs.map((d) => (
              <li key={d.row.player.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <PlayerLink id={d.row.player.id} className="block max-w-full truncate font-medium">
                    {d.row.player.web_name}
                  </PlayerLink>
                  <div className="truncate text-xs text-zinc-500">
                    {shortName.get(d.row.player.team_id)} · {POSITIONS[d.row.player.position]} ·{" "}
                    {formatPrice(d.row.player.now_cost)} · {d.row.player.selected_by_percent ?? 0}%
                    {squads ? (d.owners ? ` · ${d.owners} rival${d.owners > 1 ? "s" : ""}` : " · no rivals") : ""}
                  </div>
                  <div className="mt-1 grid w-36 grid-cols-3 gap-0.5">
                    {(nextThree.get(d.row.player.team_id) ?? []).map((cells, i) =>
                      cells.length ? (
                        <div key={i} className="flex flex-col gap-0.5">
                          {cells.map((c, j) => (
                            <FixtureChip key={j} cell={c} compact />
                          ))}
                        </div>
                      ) : (
                        <span key={i} className="block rounded text-center text-[10px] leading-5 text-zinc-400 ring-1 ring-zinc-200 ring-inset dark:ring-zinc-800">
                          –
                        </span>
                      ),
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums">{d.row.xp5?.toFixed(1) ?? "-"}</div>
                  <div className="text-[11px] text-zinc-500">xP {xpFrom}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
