import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AutoRefresh from "@/components/AutoRefresh";
import LiveViews from "@/components/LiveViews";
import { getEventFixtures, getLive, getPicks } from "@/lib/fplApi";
import { headToHead, isMatchTime, leagueImpact, liveGameweeks, liveTable, matchState, provisionalBonus, scoreTeam, type LiveElement, type LiveMember, type LivePick, type LivePlayer } from "@/lib/live";
import { hasLiveSquad, startingTotal } from "@/lib/liveView";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { LiveImpact, LiveMatches, LiveNotice, LivePlayers, LiveStandings, ScoreSummary } from "./LivePanels";

export const metadata: Metadata = { title: "Live · FPL Raptor" };

type Gameweek = { id: number; name: string; deadline_time: string; is_current: boolean; finished: boolean };
type MemberRow = { league_id: number; team_id: number; manager_name: string; team_name: string; total: number | null; event_total: number | null };
type PickRow = { team_id: number; player_id: number; squad_position: number; multiplier: number; is_captain: boolean; is_vice_captain: boolean };
type EntryRow = { team_id: number; gameweek_id: number; total_points: number | null; points: number | null; active_chip: string | null; event_transfers_cost: number | null };

function LiveFailure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="page-title">Live</h1>
      <AutoRefresh active={false} checkedAt={new Date().toISOString()} />
      <LiveNotice title={title}>{children}</LiveNotice>
    </main>
  );
}

export default async function LivePage({ searchParams }: PageProps<"/live">) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/live");

  const [{ data: profile, error: profileError }, { data: gameweekRows, error: gameweeksError }, { data: teamRows, error: teamsError }] = await Promise.all([
    supabase.from("profiles").select("fpl_team_id").eq("user_id", userId).maybeSingle<{ fpl_team_id: number | null }>(),
    supabase.from("gameweeks").select("id,name,deadline_time,is_current,finished").order("id"),
    supabase.from("teams").select("id,short_name"),
  ]);
  if (profileError) return <LiveFailure title="Your team link couldn’t load">Your account is still signed in. Refresh to try again.</LiveFailure>;
  if (gameweeksError) return <LiveFailure title="Gameweek data couldn’t load">Your team is still linked. Refresh to try again.</LiveFailure>;
  const myTeamId = profile?.fpl_team_id;
  if (!myTeamId) redirect("/onboarding");
  const gameweeks = (gameweekRows ?? []) as Gameweek[];
  const { gw, next: nextGw } = liveGameweeks(gameweeks);
  const shortNames = new Map(((teamRows ?? []) as { id: number; short_name: string }[]).map((t) => [t.id, t.short_name]));
  const shortName = (id: number) => shortNames.get(id) ?? "?";

  if (!gw) return <LiveFailure title="Waiting for the first deadline">Live scores start at the first deadline of the season. <Link href="/me" className="text-link">View your team</Link></LiveFailure>;

  // Which mini-league to show: ?league=, else the first followed one you're in.
  const { league } = await searchParams;
  const { data: myLeagueRows, error: leaguesError } = await supabase
    .from("league_members")
    .select("league_id,leagues(name)")
    .eq("team_id", myTeamId);
  const myLeagues = (myLeagueRows ?? []) as unknown as { league_id: number; leagues: { name: string } | null }[];
  const leagueId = myLeagues.find((l) => String(l.league_id) === league)?.league_id ?? myLeagues[0]?.league_id ?? null;
  const leagueName = myLeagues.find((l) => l.league_id === leagueId)?.leagues?.name ?? null;

  const { data: memberRows, error: membersError } = leagueId
    ? await supabase
        .from("league_members")
        .select("league_id,team_id,manager_name,team_name,total,event_total")
        .eq("league_id", leagueId)
    : { data: null, error: null };
  const members = [...new Map(((memberRows ?? []) as MemberRow[]).map((member) => [member.team_id, member])).values()];
  const ownMembership = members.some((member) => member.team_id === myTeamId);
  if (!ownMembership) members.push({ league_id: 0, team_id: myTeamId, manager_name: "You", team_name: "", total: null, event_total: null });
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
    return <LiveFailure title="Live scores are temporarily unavailable">FPL isn’t answering right now. It often pauses while updating. Refresh in a minute to try again.</LiveFailure>;
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

  // Preserve the scoring engine; withhold results when inputs are missing.
  const knownTotals = new Set<number>();
  const liveMembers: LiveMember[] = await Promise.all(
    members.map(async (member) => {
      let picks = storedPicks.get(member.team_id) ?? [];
      const thisWeek = entry(member.team_id, gw.id);
      let chip = thisWeek?.active_chip ?? null;
      let cost = thisWeek?.event_transfers_cost ?? null;
      let startTotal = gw.id === 1 ? 0 : startingTotal(entry(member.team_id, gw.id - 1)?.total_points, thisWeek?.total_points, thisWeek?.points);
      if (picks.length !== 15 || !thisWeek || startTotal === null || cost === null) {
        const result = await getPicks(member.team_id, gw.id);
        if (result.ok) {
          if (picks.length !== 15) picks = result.data.picks;
          chip = result.data.active_chip;
          cost = result.data.entry_history.event_transfers_cost;
          if (startTotal === null) startTotal = startingTotal(null, result.data.entry_history.total_points, result.data.entry_history.points);
        }
      }
      startTotal ??= startingTotal(null, member.total, member.event_total);
      if (startTotal !== null) knownTotals.add(member.team_id);
      return {
        team_id: member.team_id,
        manager_name: member.manager_name,
        team_name: member.team_name,
        // The engine needs a number; unknown totals never enter visible ranks.
        startTotal: startTotal ?? 0,
        live: cost !== null && hasLiveSquad(picks, players, live) ? scoreTeam(picks, chip, cost, players, live, fixtures, bonus) : null,
      };
    }),
  );

  const table = liveTable(liveMembers);
  const mine = table.find((row) => row.team_id === myTeamId) ?? null;
  const team = mine?.live ?? null;
  const complete = ownMembership && !leaguesError && !membersError && table.every((row) => row.live !== null && knownTotals.has(row.team_id));
  const impacts = complete && table.length > 1 ? leagueImpact(liveMembers, myTeamId) : [];
  const race = complete && table.length > 1 ? headToHead(table, myTeamId) : null;
  const sorted = [...fixtures].sort((a, b) => (a.kickoff_time ?? "").localeCompare(b.kickoff_time ?? ""));
  const doneCount = fixtures.filter((fixture) => matchState(fixture) === "done").length;
  const active = isMatchTime(fixtures);
  const bonusPending = bonus.size > 0;
  const allDone = fixtures.length > 0 && doneCount === fixtures.length;
  const final = gw.finished && allDone && !bonusPending;
  const playing = fixtures.some((fixture) => matchState(fixture) === "live");
  const status = final ? "Points final" : allDone ? "Awaiting confirmation" : playing ? "In progress" : bonusPending ? "Bonus pending" : active ? "Kick-off soon" : "Gameweek open";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex items-start justify-between gap-3">
        <div><p className="mb-1 text-xs font-medium text-muted">Live</p><h1 className="page-title">{gw.name}</h1></div>
        <span className={`mt-1 rounded-full px-2.5 py-1.5 text-xs font-medium ${active ? "bg-accent-soft text-accent" : "bg-surface-muted text-muted"}`}>{status}</span>
      </header>
      <AutoRefresh active={active} checkedAt={new Date().toISOString()} />
      <ScoreSummary team={team} mine={mine} leagueName={leagueName} hasLeague={leagueId !== null} complete={complete} final={final} bonusPending={bonusPending} />
      <p className="-mt-2 mb-5 text-xs text-muted">{fixtures.length ? `${doneCount} of ${fixtures.length} matches complete` : "No fixtures available for this gameweek"}</p>
      {teamsError && <p className="mb-4 text-xs text-muted">Club names couldn’t load. Scores are still available.</p>}
      <LiveViews
        leagueId={leagueId}
        leagues={myLeagues.map((item) => ({ id: item.league_id, name: item.leagues?.name ?? `League ${item.league_id}` }))}
        players={
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-8">
            <LivePlayers team={team} shortName={shortName} />
            {leaguesError || membersError
              ? <LiveNotice title="League comparisons couldn’t load">Your score is still available. Refresh to try the league again.</LiveNotice>
              : <LiveImpact impacts={impacts} race={race} complete={complete} hasLeague={leagueId !== null} leagueName={leagueName} />}
          </div>
        }
        standings={<LiveStandings table={table} myTeamId={myTeamId} complete={complete} knownTotals={knownTotals} leagueId={leagueId} leagueName={leagueName} queryFailed={Boolean(leaguesError || membersError)} />}
        matches={<LiveMatches fixtures={sorted} shortName={shortName} />}
      />
      {gw.finished && nextGw && <p className="mt-6 text-sm text-muted">{nextGw.name} goes live at its deadline. <Link href="/me" className="text-link">Prepare your team</Link></p>}
    </main>
  );
}
