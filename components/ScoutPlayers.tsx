"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import PlayerLink from "@/components/PlayerLink";
import { formatPrice, POSITIONS } from "@/lib/fpl";
import type { Team } from "@/lib/gameweek";
import { minutesFloor, SORTS, sortStats, statRow, type PlayerStats, type ScoutPlayer, type StatRow } from "@/lib/scout";
import { matchesScoutSearch, scoutHref, scoutMetric, scoutParams, SORT_LABELS, type ScoutParams } from "@/lib/scoutView";

type Props = { players: ScoutPlayer[]; stats: PlayerStats[]; teams: Team[]; mine: number[]; played: number; xpFrom: string; statsReady: boolean };
const POS = ["All", "GK", "DEF", "MID", "FWD"];

export default function ScoutPlayers({ players, stats, teams, mine, played, xpFrom, statsReady }: Props) {
  const params = scoutParams(useSearchParams());
  const update = (change: Partial<ScoutParams>, replace = false) => window.history[replace ? "replaceState" : "pushState"](null, "", scoutHref(params, change));
  const byClub = new Map(teams.map(t => [t.id, t]));
  const byPlayer = new Map(stats.map(s => [s.player_id, s]));
  const owned = new Set(mine);
  const floor = minutesFloor(params.range === "recent" ? Math.min(played, 6) : played);
  const rows = sortStats(players.filter(p => (!params.pos || p.position === params.pos) && matchesScoutSearch(p.web_name, `${byClub.get(p.team_id)?.name ?? ""} ${byClub.get(p.team_id)?.short_name ?? ""}`, params.q))
    .map(p => statRow(p, byPlayer.get(p.id), params.range, floor)), params.sort);
  const table = rows.slice(0, 40);
  const reset = Boolean(params.q || params.pos || params.sort !== "xp" || params.range !== "season");
  const playerName = (r: StatRow) => <>
    <PlayerLink id={r.player.id} className="block w-fit max-w-full py-2 font-semibold text-foreground underline-offset-4 hover:underline">{r.player.web_name}</PlayerLink>
    <p className="text-xs text-muted">{byClub.get(r.player.team_id)?.short_name ?? "Unknown club"} · {POSITIONS[r.player.position]}{owned.has(r.player.id) && <span className="ml-2 font-medium text-accent">In your squad</span>}</p>
    {r.player.status !== "a" && <p className="mt-1 text-xs text-warning">{r.player.chance_of_playing_next_round != null ? `${r.player.chance_of_playing_next_round}% chance of playing` : "Availability concern"}</p>}
  </>;
  return <>
    <div className="surface space-y-4 p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_15rem]">
        <label className="block text-xs font-medium text-muted">Find a player or club
          <input type="search" value={params.q} onChange={e => update({ q: e.target.value.slice(0,80) }, true)} placeholder="Name or club" className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-background px-3 text-base text-foreground" />
        </label>
        <label className="block text-xs font-medium text-muted">Sort by · highest first
          <select value={params.sort} onChange={e => update({ sort: e.target.value as ScoutParams["sort"] })} className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-background px-3 text-base text-foreground">
            {SORTS.map(sort => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
          </select>
        </label>
      </div>
      <div role="group" aria-label="Position" className="flex flex-wrap gap-1">
        {POS.map((label,pos) => <button key={label} type="button" onClick={() => update({ pos })} aria-pressed={params.pos === pos} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-medium ${params.pos === pos ? "bg-accent-soft text-accent" : "bg-surface-muted text-muted"}`}>{label}</button>)}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <details className="disclosure group max-w-lg">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><span className="disclosure-arrow" aria-hidden>›</span> Stats period: {params.range === "recent" ? "Last 6 gameweeks" : "Season"}</summary>
          <label className="mt-2 block text-xs text-muted">Period for points, xG, xA and per-90 metrics
            <select value={params.range} onChange={e => update({ range: e.target.value as ScoutParams["range"] })} className="mt-1 block min-h-11 rounded-lg border border-line bg-background px-3 text-base text-foreground"><option value="season">Season</option><option value="recent">Last 6 gameweeks</option></select>
          </label>
          <p className="mt-2 text-xs leading-relaxed text-muted">Per-90 figures need at least {floor} minutes in this period. Form uses FPL’s form rating. Expected points always cover {xpFrom || "the next five gameweeks"}.</p>
        </details>
        {reset && <button type="button" className="button-secondary" onClick={() => update({ q: "", pos: 0, sort: "xp", range: "season" })}>Reset filters</button>}
      </div>
    </div>
    <section className="surface min-w-0 overflow-hidden" aria-label="Player results">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <p className="text-sm text-muted" role="status">{rows.length} {rows.length === 1 ? "player" : "players"}{rows.length > 40 ? " · showing top 40" : ""}</p>
        <Link href={scoutHref(params,{view:params.view === "stats" ? "players" : "stats"})} scroll={false} className="text-link py-2 text-sm">{params.view === "stats" ? "Compact rows" : "Detailed table"}</Link>
      </div>
      {!statsReady && <p className="border-b border-line bg-warning-soft px-4 py-3 text-sm text-warning">Player statistics are unavailable. You can still search players and open their details.</p>}
      {!rows.length ? <div className="p-6"><h2 className="section-title">No players found</h2><p className="mt-2 text-sm text-muted">Try a different name or reset the filters.</p></div> : params.view === "stats" ? <div className="overflow-x-auto px-4" role="region" aria-label="Detailed player statistics, scroll horizontally" tabIndex={0}>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-right text-xs text-muted"><tr><th className="sticky left-0 z-10 bg-surface py-3 text-left font-medium">Player</th>{["xP · 5 GWs", "xGI/90", "xG", "xA", "DC/90", "Minutes", "Points", "Owned"].map(label => <th className="px-2 py-3 font-medium" key={label}>{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">{table.map(r => <tr key={r.player.id}><td className="sticky left-0 z-10 min-w-44 bg-surface py-2 pr-4">{playerName(r)}<p className="mt-1 text-xs text-muted">{formatPrice(r.player.now_cost)}</p></td>
            {[r.xp5?.toFixed(1), r.xgi90?.toFixed(2), byPlayer.has(r.player.id) ? r.xg.toFixed(1) : null, byPlayer.has(r.player.id) ? r.xa.toFixed(1) : null, r.dc90?.toFixed(1), byPlayer.has(r.player.id) ? r.minutes : null, params.range === "season" || byPlayer.has(r.player.id) ? r.points : null, r.player.selected_by_percent == null ? null : `${r.player.selected_by_percent}%`].map((value,i) => <td key={i} className="px-2 text-right tabular-nums">{value ?? "—"}</td>)}</tr>)}</tbody>
        </table>
      </div> : <>
        <div className="grid grid-cols-[minmax(0,1fr)_4rem_6rem] gap-3 border-b border-line px-4 py-3 text-xs text-muted sm:px-5"><span>Player</span><span className="text-right">Price</span><span className="text-right">{params.sort === "xp" ? `xP ${xpFrom}` : SORT_LABELS[params.sort]}</span></div>
        <ul className="divide-y divide-line">{table.map(r => <li key={r.player.id} className="grid grid-cols-[minmax(0,1fr)_4rem_6rem] items-center gap-3 px-4 py-3 sm:px-5"><div className="min-w-0 break-words">{playerName(r)}</div><span className="text-right text-sm tabular-nums">{formatPrice(r.player.now_cost)}</span><span className="text-right text-lg font-semibold tabular-nums">{params.sort === "points" && params.range === "recent" && !byPlayer.has(r.player.id) ? "—" : scoutMetric(r,params.sort)}</span></li>)}</ul>
      </>}
      <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-muted">xP: model expected points, {xpFrom || "next five gameweeks"}. {params.range === "recent" ? "Last 6 gameweeks" : "Season totals"} · Per-90 minimum: {floor} minutes. A dash means unavailable.</p>
    </section>
  </>;
}
