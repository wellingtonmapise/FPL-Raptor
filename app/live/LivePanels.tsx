import Link from "next/link";
import LocalTime from "@/components/LocalTime";
import Pitch from "@/components/Pitch";
import PlayerLink from "@/components/PlayerLink";
import ViewToggle from "@/components/ViewToggle";
import { CHIP_NAMES } from "@/lib/gameweek";
import { ordinal } from "@/lib/league";
import { matchState, scoreline, type HeadToHead, type Impact, type LiveFixture, type LiveRow, type ScoredPick, type TeamLive } from "@/lib/live";
import { livePitch } from "@/lib/pitch";

const POS = ["", "GK", "DEF", "MID", "FWD"];
const sign = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;

export function Movement({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-muted" aria-label="Position unchanged">—</span>;
  return (
    <span className={`text-xs font-semibold ${value > 0 ? "text-accent" : "text-rose-700 dark:text-rose-300"}`} aria-label={`${value > 0 ? "Up" : "Down"} ${Math.abs(value)} place${Math.abs(value) === 1 ? "" : "s"}`}>
      <span aria-hidden>{value > 0 ? "↑" : "↓"}{Math.abs(value)}</span>
    </span>
  );
}

function Chevron() {
  return <svg viewBox="0 0 24 24" className="disclosure-arrow h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="m6 9 6 6 6-6" /></svg>;
}

export function LiveNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface p-5">
      <h2 className="section-title">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
    </section>
  );
}

export function ScoreSummary({ team, mine, leagueName, complete, hasLeague, final, bonusPending }: {
  team: TeamLive | null;
  mine: LiveRow | null;
  leagueName: string | null;
  complete: boolean;
  hasLeague: boolean;
  final: boolean;
  bonusPending: boolean;
}) {
  return (
    <section className="surface mb-5 overflow-hidden" aria-label="Your live score">
      <dl className="grid grid-cols-3 gap-2 px-4 py-4 sm:px-5">
        <div className="flex flex-col">
          <dt className="order-2 mt-1 text-xs text-muted">{final ? "Final points" : "Live points"}</dt>
          <dd className="order-1 text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">{team?.points ?? "—"}</dd>
        </div>
        <div className="flex flex-col justify-end border-l border-line pl-4">
          <dt className="order-2 mt-1 text-xs text-muted">Players left<span className="sr-only"> to finish, including those playing now</span></dt>
          <dd className="order-1 text-2xl font-semibold tabular-nums">{team?.toPlay ?? "—"}</dd>
        </div>
        <div className="flex flex-col justify-end border-l border-line pl-4">
          <dt className="order-2 mt-1 text-xs text-muted">League position<span className="sr-only">{leagueName ? ` in ${leagueName}` : ""}; movement since the deadline</span></dt>
          <dd className="order-1 flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold tabular-nums">
            {hasLeague && complete && mine ? <>{ordinal(mine.rank)} <Movement value={mine.startRank - mine.rank} /></> : "—"}
          </dd>
        </div>
      </dl>
      <div className="space-y-1 border-t border-line px-4 py-3 text-xs leading-relaxed text-muted sm:px-5">
        {team && (team.chip || team.transferCost > 0) && <p>{[
          team.chip ? CHIP_NAMES[team.chip] ?? team.chip : null,
          team.transferCost ? `Includes a −${team.transferCost} transfer hit` : null,
        ].filter(Boolean).join(" · ")}</p>}
        {hasLeague && !complete && <p>Standings incomplete</p>}
        {!final && team && <p>{bonusPending ? "Includes provisional bonus and projected substitutions." : "Includes projected substitutions. Points can change until FPL confirms them."}</p>}
      </div>
    </section>
  );
}

function MatchStatus({ fixture }: { fixture: LiveFixture }) {
  const state = matchState(fixture);
  if (state === "done") return <span aria-label="Full time">FT</span>;
  if (state === "live") return <span className="inline-flex items-center gap-1.5 font-medium text-accent"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" />{fixture.minutes}&apos;</span>;
  return fixture.kickoff_time ? <LocalTime iso={fixture.kickoff_time} options={{ weekday: "short", hour: "numeric", minute: "2-digit" }} /> : <>Time TBC</>;
}

function PlayerRow({ sp, shortName }: { sp: ScoredPick; shortName: (id: number) => string }) {
  const shown = sp.counts ? sp.points * sp.multiplier : sp.points;
  const badge = sp.multiplier === 3 ? "TC" : sp.multiplier === 2 ? "C" : sp.pick.is_vice_captain ? "V" : null;
  const notes: string[] = [];
  if (sp.subbedIn) notes.push("projected sub on");
  if (sp.subbedOut) notes.push("projected sub off");
  else if (sp.status === "out") notes.push("didn’t play");
  if (sp.bonus > 0) notes.push(`+${sp.bonus} bonus${sp.provisional ? " (provisional)" : ""}`);
  return (
    <li className={`flex items-center gap-3 py-3 ${sp.counts ? "" : "opacity-70"}`}>
      <span className="w-7 shrink-0 text-xs text-muted">{POS[sp.player?.position ?? 0]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <PlayerLink id={sp.pick.element} className="truncate text-sm font-medium">{sp.player?.web_name ?? `#${sp.pick.element}`}</PlayerLink>
          {badge && <span className="rounded-full bg-foreground px-1.5 text-[10px] font-bold leading-4 text-surface">{badge}</span>}
          {sp.status === "playing" && <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" title="Playing now" />}
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {sp.fixtures.length === 0 ? "No match this gameweek" : sp.fixtures.map((fixture, index) => <span key={fixture.id}>{index > 0 && " + "}{scoreline(fixture, shortName)} · <MatchStatus fixture={fixture} /></span>)}
          {notes.length > 0 && ` · ${notes.join(" · ")}`}
        </p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <p className="text-sm font-semibold">{sp.minutes > 0 || sp.status !== "to-play" ? shown : "—"}</p>
        {sp.minutes > 0 && <p className="text-[11px] text-muted">{sp.minutes}&apos;</p>}
      </div>
    </li>
  );
}

export function LivePlayers({ team, shortName }: { team: TeamLive | null; shortName: (id: number) => string }) {
  if (!team) return <LiveNotice title="Your live squad isn’t available">Some squad or scoring data couldn’t load. Refresh in a minute. Your team is still linked and the match list remains available.</LiveNotice>;
  const pitch = livePitch(team, shortName);
  const projected = team.picks.some((pick) => pick.subbedIn || pick.subbedOut);
  return (
    <div className="min-w-0">
      <ViewToggle
        title="Your players"
        note={[team.picks.some((pick) => pick.provisional) ? "* provisional bonus" : null, projected ? "Projected subs shown" : null].filter(Boolean).join(" · ") || undefined}
        pitch={<Pitch starters={pitch.starters} bench={pitch.bench} benchNote={team.chip === "bboost" ? "Bench Boost: all count" : undefined} />}
        list={
          <div className="surface px-4 py-1">
            <ul className="divide-y divide-line">{team.picks.filter((pick) => pick.pick.position <= 11).map((sp) => <PlayerRow key={sp.pick.element} sp={sp} shortName={shortName} />)}</ul>
            <h3 className="mt-4 text-sm font-semibold">Bench{team.chip === "bboost" ? " · all count" : ""}</h3>
            <ul className="divide-y divide-line">{team.picks.filter((pick) => pick.pick.position > 11).map((sp) => <PlayerRow key={sp.pick.element} sp={sp} shortName={shortName} />)}</ul>
          </div>
        }
      />
      <p className="mt-3 text-xs leading-relaxed text-muted">Scores include the captain’s multiplier. {projected ? "Blue rings show projected substitutes; dimmed players don’t count toward your score. " : ""}Tap a player for their card.</p>
    </div>
  );
}

function ImpactRow({ row }: { row: Impact }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <PlayerLink id={row.id} className="block truncate text-sm font-medium">{row.name}</PlayerLink>
        <p className="mt-0.5 text-xs text-muted">{row.points} pts · you {row.mine ? `×${row.mine}` : "×0"} · rivals {Math.round(row.eo * 100)}%</p>
      </div>
      <span className={`text-sm font-semibold tabular-nums ${row.impact > 0 ? "text-accent" : "text-rose-700 dark:text-rose-300"}`}>{sign(row.impact)}</span>
    </li>
  );
}

export function LiveImpact({ impacts, race, complete, hasLeague, leagueName }: { impacts: Impact[]; race: HeadToHead | null; complete: boolean; hasLeague: boolean; leagueName: string | null }) {
  if (!hasLeague) return <LiveNotice title="League impact">Your score works without a followed league. League comparisons appear when the app follows one of your mini-leagues. <Link href="/league" className="text-link">View leagues</Link></LiveNotice>;
  if (!complete) return <LiveNotice title="League impact is incomplete">Comparisons will appear when the league’s squads and starting totals are available.</LiveNotice>;
  const saving = impacts.filter((row) => row.impact > 0);
  const hurting = [...impacts].reverse().filter((row) => row.impact < 0);
  return (
    <section className="surface overflow-hidden">
      <header className="border-b border-line px-5 py-4"><h2 className="section-title">What’s moving you</h2><p className="mt-1 text-xs text-muted">Against the rest of {leagueName ?? "your league"}</p></header>
      <div className="space-y-3 px-5 py-4">
        {[{ label: "Helping most", rows: saving }, { label: "Hurting most", rows: hurting }].map(({ label, rows }) => (
          <div key={label}><h3 className="text-xs font-medium text-muted">{label}</h3>{rows[0] ? <ul><ImpactRow row={rows[0]} /></ul> : <p className="mt-1 text-sm text-muted">Nobody yet.</p>}</div>
        ))}
      </div>
      <details className="disclosure border-t border-line">
        <summary className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 text-sm font-medium">Full impact & closest rival<Chevron /></summary>
        <div className="space-y-5 px-5 pb-5">
          {[{ label: "Helping you", rows: saving }, { label: "Hurting you", rows: hurting }].map(({ label, rows }) => <section key={label}><h3 className="text-xs font-medium text-muted">{label}</h3><ul>{rows.map((row) => <ImpactRow key={row.id} row={row} />)}</ul>{rows.length === 0 && <p className="mt-2 text-sm text-muted">Nobody yet.</p>}</section>)}
          {race && (
            <section className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold wrap-break-word">You vs {race.rival.manager_name}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">{race.ahead ? `${race.gap} points ahead` : `${race.gap} points behind`} overall · {race.gwDiff >= 0 ? "+" : "−"}{Math.abs(race.gwDiff)} this week</p>
              <ul className="mt-3 space-y-2">{race.swings.map((swing) => <li key={swing.id} className="flex justify-between gap-3 text-xs"><PlayerLink id={swing.id} className="font-medium">{swing.name}</PlayerLink><span className={`shrink-0 font-semibold tabular-nums ${swing.diff > 0 ? "text-accent" : "text-rose-700 dark:text-rose-300"}`}>{swing.diff > 0 ? "+" : "−"}{Math.abs(swing.diff)}</span></li>)}</ul>
              {race.swings.length === 0 && <p className="mt-2 text-xs text-muted">Your different picks haven’t changed the gap this week.</p>}
            </section>
          )}
          <p className="text-xs leading-relaxed text-muted">+5 means five points gained on the average rival: a player’s points multiplied by your share minus theirs. Rival percentages include captain multipliers.</p>
        </div>
      </details>
    </section>
  );
}

export function LiveStandings({ table, myTeamId, complete, knownTotals, leagueId, leagueName, queryFailed }: { table: LiveRow[]; myTeamId: number; complete: boolean; knownTotals: Set<number>; leagueId: number | null; leagueName: string | null; queryFailed: boolean }) {
  if (queryFailed) return <LiveNotice title="League data couldn’t load">Your score is still available. Refresh to try the league again.</LiveNotice>;
  if (!leagueId) return <LiveNotice title="No followed leagues yet">The app follows the leagues listed in its fetch workflow. Ask whoever runs it to add yours. <Link href="/league" className="text-link">View leagues</Link></LiveNotice>;
  const rows = complete ? table : [...table].sort((a, b) => a.manager_name.localeCompare(b.manager_name));
  return (
    <section className="surface overflow-hidden" aria-labelledby="standings-title">
      <header className="border-b border-line p-5"><h2 id="standings-title" className="section-title wrap-break-word">{leagueName ?? "League standings"}</h2><p className="mt-1 text-xs leading-relaxed text-muted">{complete ? "Live totals · movement since the deadline" : "Standings incomplete. Available scores are listed by manager until every squad and starting total loads."}</p></header>
      <div className="px-3 pb-3 sm:px-5">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted"><tr><th scope="col" className="py-3 text-left font-normal">Pos.</th><th scope="col" className="px-2 text-left font-normal">Manager</th><th scope="col" className="py-3 text-right font-normal">GW</th><th scope="col" className="py-3 pl-3 text-right font-normal">Total</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.team_id} className={`border-t border-line ${row.team_id === myTeamId ? "bg-accent-soft" : ""}`}>
                <td className="py-3 align-top"><div className="flex flex-wrap items-baseline gap-x-1.5">{complete ? row.rank : "—"}{complete && <Movement value={row.startRank - row.rank} />}</div></td>
                <th scope="row" className="w-full max-w-0 px-2 py-3 text-left font-normal">
                  <p className="truncate font-medium" title={row.manager_name}>{row.manager_name}{row.team_id === myTeamId ? " (you)" : ""}</p>
                  <p className="truncate text-xs text-muted" title={row.team_name}>{row.team_name}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{row.live ? [row.live.captain?.player ? `C ${row.live.captain.player.web_name} ${row.live.captain.points * row.live.captain.multiplier}` : null, `${row.live.toPlay} left`, row.live.chip ? CHIP_NAMES[row.live.chip] ?? row.live.chip : null, row.live.transferCost ? `−${row.live.transferCost} hit` : null].filter(Boolean).join(" · ") : "Squad unavailable"}</p>
                </th>
                <td className="py-3 text-right align-top text-muted">{row.gwPoints ?? "—"}</td>
                <td className="py-3 pl-3 text-right align-top font-semibold">{row.live && knownTotals.has(row.team_id) ? row.liveTotal.toLocaleString("en-US") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-muted">Totals include projected substitutions and any provisional bonus. They can move until FPL confirms the gameweek. <Link href={`/league/${leagueId}`} className="text-link">Open league</Link></p>
    </section>
  );
}

export function LiveMatches({ fixtures, shortName }: { fixtures: LiveFixture[]; shortName: (id: number) => string }) {
  if (fixtures.length === 0) return <LiveNotice title="No matches available">There are no fixtures to show for this gameweek yet.</LiveNotice>;
  const groups = [
    { state: "live", label: "Playing now" },
    { state: "upcoming", label: "Still to come" },
    { state: "done", label: "Full time" },
  ] as const;
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      {groups.map(({ state, label }) => {
        const rows = fixtures.filter((fixture) => matchState(fixture) === state);
        if (rows.length === 0) return null;
        return (
          <section key={state} className="surface overflow-hidden">
            <h2 className="section-title border-b border-line px-5 py-4">{label}</h2>
            <ul className="divide-y divide-line px-5">{rows.map((fixture) => <li key={fixture.id} className="flex min-h-14 items-center justify-between gap-3 py-3 text-sm"><span className="font-medium">{scoreline(fixture, shortName)}</span><span className="shrink-0 text-xs text-muted"><MatchStatus fixture={fixture} /></span></li>)}</ul>
          </section>
        );
      })}
    </div>
  );
}
