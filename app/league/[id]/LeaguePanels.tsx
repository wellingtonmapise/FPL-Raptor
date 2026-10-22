import type { ReactNode } from "react";
import Link from "next/link";
import PlayerLink from "@/components/PlayerLink";
import { LeagueViewLink } from "@/components/LeagueViews";
import Raptor from "@/components/recap/Raptor";
import { CHIP_NAMES } from "@/lib/gameweek";
import { movement, ordinal, type Award, type CaptainChoice, type EntryGameweek, type Member, type Ownership, type Rival } from "@/lib/league";
import type { Recap } from "@/lib/recap";

export function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="surface min-w-0 p-4 sm:p-5">
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="section-title">{title}</h2>{note && <p className="text-xs text-muted">{note}</p>}</div>
    {children}
  </section>;
}

function Movement({ member }: { member: Member }) {
  if (!member.rank || !member.last_rank) return <span className="text-muted" aria-label="Movement unavailable">—</span>;
  const value = movement(member);
  return <span className={value > 0 ? "text-accent" : value < 0 ? "text-rose-700 dark:text-rose-300" : "text-muted"} aria-label={value ? `${value > 0 ? "Up" : "Down"} ${Math.abs(value)} places` : "Position unchanged"}><span aria-hidden>{value ? `${value > 0 ? "↑" : "↓"}${Math.abs(value)}` : "—"}</span></span>;
}

export function LeagueSummary({ me, rival, gameweek, comparisonReady, squadGameweek }: { me: Member | null; rival: Rival | null; gameweek: number | null; comparisonReady: boolean; squadGameweek: number | null }) {
  if (!me) return <p className="text-sm text-muted">You’re viewing this league. Your linked team isn’t in its standings.</p>;
  const knownGap = me.total != null && rival?.rival.total != null;
  return <section className="surface overflow-hidden" aria-label="Your league summary">
    <p className="sr-only">{me.team_name}</p>
    <dl className="grid grid-cols-3 gap-3 px-4 py-4 sm:px-5">
      <div><dt className="text-xs text-muted">Your position</dt><dd className="mt-1 flex flex-wrap items-baseline gap-2 text-2xl font-semibold tabular-nums">{me.rank && me.rank > 0 ? ordinal(me.rank) : "—"}<span className="text-xs"><Movement member={me} /></span></dd></div>
      <div className="border-l border-line pl-3"><dt className="text-xs text-muted">Total points</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{me.total ?? "—"}</dd></div>
      <div className="border-l border-line pl-3"><dt className="text-xs text-muted">{gameweek ? `GW${gameweek} points` : "GW points"}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{me.event_total ?? "—"}</dd></div>
    </dl>
    {rival && <details className="disclosure border-t border-line">
      <summary className="flex min-h-16 cursor-pointer items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0"><p className="text-xs text-muted">Closest rival · Compare squads</p>
          <p className="mt-1 break-words text-sm"><span className="font-semibold">{rival.rival.manager_name}</span>{knownGap ? rival.gap === 0 ? " is level with you on points." : rival.ahead ? ` is ${rival.gap} points ahead.` : ` trails you by ${rival.gap} points.` : " · points gap unavailable."}</p>
        </div><span className="disclosure-arrow shrink-0 text-accent" aria-hidden>›</span>
      </summary>
      <div className="px-4 pb-4 sm:px-5"><p className="mb-3 break-words text-xs text-muted">{rival.rival.team_name} · {squadGameweek ? `GW${squadGameweek} deadline squads` : "Squad comparison"}</p>
        {comparisonReady ? <dl className="grid gap-4 py-2 text-sm sm:grid-cols-2">{[
          ["Only they start",rival.onlyThem.join(", ") || "Nobody"],
          ["Only you start",rival.onlyMe.join(", ") || "Nobody"],
          ["Their captain",rival.theirCaptain ?? "Unavailable"],
          ["Your captain",rival.myCaptain ?? "Unavailable"],
        ].map(([label,value]) => <div key={label}><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}<div className="text-xs text-muted sm:col-span-2">Latest stored deadline squads. Open Live for current scoring.</div></dl> : <p className="pb-3 text-sm text-muted">Both complete squads and player details are needed for this comparison. Standings remain available.</p>}
      </div>
    </details>}
  </section>;
}

export function Standings({ members, myTeamId, gameweek }: { members: Member[]; myTeamId: number | null; gameweek: number | null }) {
  return <Card title="Standings" note={`${members.length} managers`}>
    {!members.length ? <p className="py-4 text-sm text-muted">Standings haven’t been stored for this league yet.</p> : <>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_2.5rem_3rem] gap-3 border-b border-line pb-2 text-xs text-muted"><span>Pos</span><span>Manager / team</span><span className="text-right">{gameweek ? `GW${gameweek}` : "GW"}</span><span className="text-right">Total</span></div>
      <ol className="divide-y divide-line">{members.map(member => <li key={member.team_id} className={`grid grid-cols-[1.75rem_minmax(0,1fr)_2.5rem_3rem] items-center gap-3 rounded-lg py-3 ${member.team_id === myTeamId ? "bg-accent-soft" : ""}`}>
        <span className="text-center text-sm tabular-nums text-muted">{member.rank && member.rank > 0 ? member.rank : "—"}</span>
        <div className="min-w-0"><p className="break-words text-sm font-semibold">{member.manager_name}{member.team_id === myTeamId && <span className="ml-1 font-normal text-accent">(you)</span>}</p><p className="mt-1 break-words text-xs text-muted">{member.team_name}</p><p className="mt-1 text-xs"><Movement member={member} /></p></div>
        <span className="text-right text-sm tabular-nums text-muted">{member.event_total ?? "—"}</span><span className="text-right text-sm font-semibold tabular-nums">{member.total ?? "—"}</span>
      </li>)}</ol>
      <p className="mt-3 text-xs leading-relaxed text-muted">Latest published FPL standings. <Link href="/live" className="text-link">Open Live</Link> for provisional points and movement.</p>
    </>}
  </Card>;
}

export function RecapEntry({ recap, leagueId, unavailable }: { recap: Recap | null; leagueId: number; unavailable: boolean }) {
  return <section className="surface flex items-center gap-3 px-4 py-3 sm:p-5" aria-label="Latest recap">
    <Raptor seed={leagueId} className="h-9 w-9 shrink-0" />
    <div className="min-w-0 flex-1"><p className="text-xs text-muted">{recap ? `Latest recap · GW${recap.gameweek_id}` : unavailable ? "Recap unavailable" : "Recap on the way"}</p>
      <h2 className="mt-1 line-clamp-1 break-words text-sm font-semibold">{recap?.title ?? (unavailable ? "The recap couldn’t load." : "The next story follows the completed gameweek.")}</h2>
    </div>
    <LeagueViewLink leagueId={leagueId} view="recap" className="text-link inline-flex min-h-11 shrink-0 items-center text-sm">{recap ? "Open recap →" : "View status"}</LeagueViewLink>
  </section>;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
export function LeagueInsights({ gw, members, awards, captains, owned, myTeamId, chips, completeCount, entriesReady, namesReady, myDifferentials, myThreats, captainPointsReady }: {
  gw: number | null; members: Member[]; awards: Award[]; captains: CaptainChoice[]; owned: { squads: number; rows: Ownership[] }; myTeamId: number | null;
  chips: EntryGameweek[]; completeCount: number; entriesReady: boolean; namesReady: boolean; myDifferentials: Ownership[]; myThreats: Ownership[]; captainPointsReady: boolean;
}) {
  const allSquads = members.length > 0 && completeCount === members.length && namesReady;
  return <div className="space-y-5">
    <div><h2 className="section-title">{gw ? `GW${gw} insights` : "League insights"}</h2><p className="mt-1 text-sm text-muted">From the latest stored gameweek, separate from the latest standings.</p></div>
    {!gw ? <Card title="No squads yet"><p className="text-sm text-muted">Gameweek insights will appear after the first deadline squads are available.</p></Card> : <>
      {(!allSquads || !entriesReady) && <section role="status" className="rounded-xl bg-warning-soft px-4 py-3 text-sm leading-relaxed text-warning">Gameweek data is incomplete · {completeCount} of {members.length} complete squads. Awards, captains and ownership appear when their required data is available.</section>}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Weekly awards" note="Points after transfer hits">
          {entriesReady ? <div className="grid gap-3 sm:grid-cols-2">{awards.map(award => <div key={award.id} className="rounded-lg bg-surface-muted p-3"><p className="text-xs text-muted">{award.title}</p><p className="mt-1 break-words text-sm font-semibold">{award.manager_name}</p><p className="mt-1 text-sm">{award.value}</p></div>)}</div> : <p className="text-sm text-muted">Complete gameweek scores are needed to compare all managers fairly.</p>}
          {!captainPointsReady && <p className="mt-3 text-xs text-muted">Captain awards are waiting for complete captain scores and squad details.</p>}
          {entriesReady && chips.length > 0 && <p className="mt-3 break-words text-sm text-muted">Chips: {chips.map(entry => `${members.find(member => member.team_id === entry.team_id)?.manager_name ?? `Team ${entry.team_id}`} (${CHIP_NAMES[entry.active_chip!] ?? entry.active_chip})`).join(", ")}</p>}
        </Card>
        <Card title="Captain choices">
          {allSquads && captains.length ? <ul className="divide-y divide-line">{captains.map(captain => <li key={captain.player_id} className="flex items-start gap-3 py-3"><span className="w-8 shrink-0 text-right text-lg font-semibold tabular-nums">×{captain.count}</span><div className="min-w-0"><PlayerLink id={captain.player_id} className="min-h-11 text-sm font-semibold">{captain.web_name}</PlayerLink><p className="break-words text-xs text-muted">{captain.managers.join(", ")}</p>{captain.points != null && <p className="mt-1 text-xs text-muted">{captain.points} player points · multiplier depends on chip and substitutions</p>}</div></li>)}</ul> : <p className="text-sm text-muted">Captain choices need every manager’s complete squad and player details.</p>}
        </Card>
      </div>
      <Card title="Who owns whom" note={allSquads ? `Share of ${owned.squads} squads` : undefined}>
        {allSquads ? <>
          <h3 className="text-sm font-medium">The template</h3>
          <ul className="mt-2 flex flex-wrap gap-2">{[...owned.rows].sort((a,b) => b.owners-a.owners).slice(0,8).map(row => <li key={row.player_id} className="flex items-center gap-2 rounded-lg bg-surface-muted px-3"><PlayerLink id={row.player_id} className="min-h-11 text-sm">{row.web_name}</PlayerLink><span className="text-xs text-muted">{pct(row.share)}</span></li>)}</ul>
          {myTeamId && completeCount > 0 && <div className="mt-5 grid gap-5 sm:grid-cols-2">{[
            {title:"Your differentials",rows:myDifferentials,effective:false},
            {title:"Threats you don’t start",rows:myThreats,effective:true},
          ].map(group => <div key={group.title}><h3 className="text-sm font-medium">{group.title}</h3><ul className="mt-2 space-y-1 text-sm">{group.rows.length ? group.rows.map(row => <li key={row.player_id} className="flex items-center justify-between gap-3"><PlayerLink id={row.player_id} className="min-h-11">{row.web_name}</PlayerLink><span className="shrink-0 text-xs text-muted">{group.effective ? "EO " : ""}{pct(group.effective ? row.effective : row.share)}</span></li>) : <li className="py-2 text-muted">{group.effective ? "No threats meet the threshold." : "No starters are owned by a quarter of squads or fewer."}</li>}</ul></div>)}</div>}
          <p className="mt-4 text-xs leading-relaxed text-muted">Ownership includes the bench. Your differentials refer to your starters. Effective ownership (EO) counts active multipliers, including captains, and can exceed 100%.</p>
        </> : <p className="text-sm text-muted">Complete squads and player details are needed so missing picks aren’t counted as zero ownership.</p>}
      </Card>
    </>}
  </div>;
}
