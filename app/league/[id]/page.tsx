import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import LeagueViews, { AllLeaguesLink, LeagueSelector } from "@/components/LeagueViews";
import RecapStory from "@/components/recap/RecapStory";
import { captainChoices, closestRival, differentials, ownership, threats, weeklyAwards, type EntryGameweek, type LeaguePick, type Member, type PlayerName } from "@/lib/league";
import { completeSquadIds, leagueHref, leagueView, orderedLeagueMembers, type FollowedLeague } from "@/lib/leagueView";
import { tallyReactions, type ReactionRow, type Recap, type Tally } from "@/lib/recap";
import { createClient, currentUserId } from "@/lib/supabase/server";
import { Card, LeagueInsights, LeagueSummary, RecapEntry, Standings } from "./LeaguePanels";

export const metadata: Metadata = { title: "League · FPL Raptor" };
type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Retain compatibility with recaps written before card support. */
async function latestRecap(supabase: Supabase, leagueId: number): Promise<{ recap: Recap | null; unavailable: boolean }> {
  const query = (columns: string) => supabase.from("recaps").select(columns).eq("league_id",leagueId).order("gameweek_id",{ascending:false}).limit(1).maybeSingle();
  const withCards = await query("gameweek_id,title,body,model,cards");
  if (!withCards.error) return { recap: withCards.data as unknown as Recap | null, unavailable: false };
  const plain = await query("gameweek_id,title,body,model");
  return { recap: plain.data ? { ...(plain.data as unknown as Omit<Recap,"cards">), cards:null } : null, unavailable: Boolean(plain.error) };
}

async function recapReactions(supabase: Supabase, leagueId: number, gameweekId: number, userId: string): Promise<Tally | null> {
  const { data, error } = await supabase.from("recap_reactions").select("card_id,emoji,user_id").eq("league_id",leagueId).eq("gameweek_id",gameweekId);
  return error ? null : tallyReactions((data ?? []) as ReactionRow[],userId);
}

export default async function LeaguePage({ params, searchParams }: PageProps<"/league/[id]">) {
  const { id } = await params;
  const leagueId = Number(id);
  if (!Number.isSafeInteger(leagueId) || leagueId <= 0) notFound();
  const sp = await searchParams;
  const initialView = leagueView(typeof sp.view === "string" ? sp.view : null);
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect(`/login?next=${encodeURIComponent(leagueHref(leagueId,initialView))}`);

  const [profileRes, leagueRes, memberRes, recapRes, gameweekRes] = await Promise.all([
    supabase.from("profiles").select("fpl_team_id").eq("user_id",userId).maybeSingle<{fpl_team_id:number | null}>(),
    supabase.from("leagues").select("id,name").eq("id",leagueId).maybeSingle<{id:number;name:string}>(),
    supabase.from("league_members").select("team_id,manager_name,team_name,rank,last_rank,total,event_total").eq("league_id",leagueId).order("rank"),
    latestRecap(supabase,leagueId),
    supabase.from("gameweeks").select("id,is_current").order("id"),
  ]);
  if (profileRes.error || leagueRes.error || memberRes.error) throw new Error("League data could not load");
  const league = leagueRes.data;
  if (!league) notFound();
  const members = orderedLeagueMembers((memberRes.data ?? []) as Member[]);
  const myTeamId = profileRes.data?.fpl_team_id ?? null;
  const me = members.find(member => member.team_id === myTeamId) ?? null;
  const { recap, unavailable: recapUnavailable } = recapRes;
  const currentGameweek = !gameweekRes.error ? (gameweekRes.data ?? []).find(gw => gw.is_current)?.id ?? null : null;
  const [followedRes, reactions] = await Promise.all([
    myTeamId ? supabase.from("league_members").select("league_id,rank,leagues(name)").eq("team_id",myTeamId) : Promise.resolve({data:[],error:null}),
    recap?.cards?.length && me ? recapReactions(supabase,leagueId,recap.gameweek_id,userId) : Promise.resolve(null),
  ]);
  const followed = (followedRes.data ?? []) as unknown as FollowedLeague[];
  const teamIds = members.map(member => member.team_id);
  const latestRes = teamIds.length ? await supabase.from("entry_gameweeks").select("gameweek_id").in("team_id",teamIds).order("gameweek_id",{ascending:false}).limit(1).maybeSingle<{gameweek_id:number}>() : {data:null,error:null};
  const gw = latestRes.data?.gameweek_id ?? null;

  let entries: EntryGameweek[] = [];
  let picks: LeaguePick[] = [];
  let players = new Map<number,PlayerName>();
  let playerPoints: Map<number,number> | null = null;
  if (gw) {
    const [entriesRes, picksRes] = await Promise.all([
      supabase.from("entry_gameweeks").select("team_id,points,points_on_bench,event_transfers,event_transfers_cost,active_chip").eq("gameweek_id",gw).in("team_id",teamIds),
      supabase.from("picks").select("team_id,player_id,multiplier,is_captain,squad_position").eq("gameweek_id",gw).in("team_id",teamIds),
    ]);
    entries = (entriesRes.data ?? []) as EntryGameweek[];
    picks = (picksRes.data ?? []) as LeaguePick[];
    const playerIds = [...new Set(picks.map(pick => pick.player_id))];
    if (playerIds.length) {
      const [playersRes, pointsRes] = await Promise.all([
        supabase.from("players").select("id,web_name").in("id",playerIds),
        supabase.from("player_gameweeks").select("player_id,points").eq("gameweek_id",gw).in("player_id",playerIds),
      ]);
      players = new Map(((playersRes.data ?? []) as PlayerName[]).map(player => [player.id,player]));
      if (!pointsRes.error && pointsRes.data?.length) playerPoints = new Map((pointsRes.data as {player_id:number;points:number | null}[]).filter(row => row.points != null).map(row => [row.player_id,row.points!]));
    }
  }
  const completeIds = new Set(completeSquadIds(members,picks));
  const allSquads = members.length > 0 && completeIds.size === members.length;
  const namesReady = picks.length > 0 && picks.every(pick => players.has(pick.player_id));
  const entriesReady = members.length > 0 && members.every(member => entries.some(entry => entry.team_id === member.team_id && entry.points != null && entry.event_transfers_cost != null));
  const captainPointsReady = allSquads && namesReady && picks.some(pick => pick.is_captain) && picks.filter(pick => pick.is_captain).every(pick => playerPoints?.has(pick.player_id));
  const awards = weeklyAwards(members,entries,picks,captainPointsReady ? playerPoints : null,players);
  const captains = captainChoices(members,picks,players,playerPoints);
  const owned = ownership(picks,players,myTeamId);
  const rival = myTeamId ? closestRival(members.filter(member => member.rank != null && member.rank > 0),picks,players,myTeamId) : null;
  const comparisonReady = Boolean(rival && myTeamId && completeIds.has(myTeamId) && completeIds.has(rival.rival.team_id) && picks.filter(pick => pick.team_id === myTeamId || pick.team_id === rival.rival.team_id).every(pick => players.has(pick.player_id)));
  const story = <div className="space-y-5">
    {recap ? <>
      <header><p className="text-xs text-muted">Latest recap · GW{recap.gameweek_id}</p><h2 className="section-title mt-1 break-words">{recap.title}</h2></header>
      {recap.cards?.length ? <RecapStory key={`${userId}:${leagueId}:${recap.gameweek_id}`} recap={recap} leagueId={leagueId} leagueName={league.name} reactions={reactions} reactionNote={!me ? "Reactions are available to members of this league." : !reactions ? "Reactions couldn’t load. Refresh this page to try again." : undefined} /> : <section id="recap" className="surface space-y-3 p-5 text-sm leading-relaxed">
        {recap.body.split(/\n\s*\n/).filter(paragraph => paragraph.trim()).map((paragraph,index) => <p key={index}>{paragraph.trim()}</p>)}
        <p className="text-xs text-muted">Based on this gameweek’s numbers. Captions are generated by AI.</p>
      </section>}
    </> : <Card title={recapUnavailable ? "The recap couldn’t load" : "Recap on the way"}><p className="text-sm text-muted">{recapUnavailable ? "Refresh this page to try again. Standings and stored gameweek insights remain available." : "The next recap will appear once the gameweek is complete and processed."}</p></Card>}
  </div>;

  return <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
    <header className="grid items-start gap-3 sm:grid-cols-[1fr_minmax(15rem,28rem)]"><h1 className="page-title">League</h1><LeagueSelector leagueId={leagueId} leagueName={league.name} leagues={followed} />{followedRes.error && <p className="text-xs text-warning sm:col-span-2">Other leagues couldn’t load. <Link href="/league" className="text-link">Try the league list</Link>.</p>}</header>
    <LeagueViews key={`${userId}:${leagueId}`} leagueId={leagueId}
      overview={<div className="space-y-5"><LeagueSummary me={me} rival={rival} gameweek={currentGameweek} comparisonReady={comparisonReady} squadGameweek={gw} /><div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="lg:order-last"><RecapEntry recap={recap} leagueId={leagueId} unavailable={recapUnavailable} /></div><Standings members={members} myTeamId={myTeamId} gameweek={currentGameweek} /></div></div>}
      insights={<LeagueInsights gw={gw} members={members} awards={awards} captains={captains} owned={owned} myTeamId={me ? myTeamId : null} chips={entries.filter(entry => entry.active_chip)} completeCount={completeIds.size} entriesReady={entriesReady} namesReady={namesReady} myDifferentials={myTeamId ? differentials(owned.rows).slice(0,5) : []} myThreats={myTeamId ? threats(owned.rows).slice(0,5) : []} captainPointsReady={captainPointsReady} />}
      recap={story}
    />
    {latestRes.error && <p role="status" className="text-sm text-warning">Stored gameweek data couldn’t load. Latest standings remain available.</p>}
    <AllLeaguesLink />
  </main>;
}
