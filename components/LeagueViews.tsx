"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useTransition, type MouseEvent, type ReactNode } from "react";
import { leagueHref, leagueView, type FollowedLeague, type LeagueView } from "@/lib/leagueView";

const LABELS: Record<LeagueView,string> = { overview: "Standings", insights: "Insights", recap: "Recap" };

export function AllLeaguesLink() {
  const view = leagueView(useSearchParams().get("view"));
  return <Link href={`/league${view === "overview" ? "" : `?view=${view}`}`} className="text-link inline-flex min-h-11 w-fit items-center text-sm">All your leagues</Link>;
}

export function LeagueViewLink({ leagueId, view, children, className = "text-link" }: { leagueId: number; view: LeagueView; children: ReactNode; className?: string }) {
  const href = leagueHref(leagueId,view);
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    window.history.pushState(null,"",href);
  }
  return <a href={href} onClick={navigate} className={className}>{children}</a>;
}

export function LeagueSelector({ leagueId, leagueName, leagues }: { leagueId: number; leagueName: string; leagues: FollowedLeague[] }) {
  const router = useRouter();
  const view = leagueView(useSearchParams().get("view"));
  const [pending, startTransition] = useTransition();
  const options = leagues.some(league => league.league_id === leagueId) ? leagues : [...leagues,{league_id:leagueId,rank:null,leagues:{name:leagueName}}];
  return <div className="min-w-0 sm:max-w-md">
    <label className="sr-only" htmlFor="league-selector">League</label>
    <select id="league-selector" title={leagueName} value={leagueId} disabled={pending} onChange={event => {
      const next = Number(event.target.value);
      startTransition(() => router.push(leagueHref(next,view)));
    }} className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-base text-foreground">
      {options.map(league => <option key={league.league_id} value={league.league_id}>{league.leagues?.name ?? `League ${league.league_id}`}</option>)}
    </select>
    <p role="status" className="mt-1 text-xs text-muted">{pending ? "Loading league…" : "Latest FPL standings"}</p>
  </div>;
}

export default function LeagueViews({ leagueId, overview, insights, recap }: { leagueId: number; overview: ReactNode; insights: ReactNode; recap: ReactNode }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const view = leagueView(params.get("view"));
  const [openedRecap, setOpenedRecap] = useState(view === "recap");
  useEffect(() => {
    const openLegacyRecap = () => {
      if (window.location.hash === "#recap" && !new URLSearchParams(window.location.search).has("view")) {
        window.history.replaceState(null,"",`${leagueHref(leagueId,"recap")}#recap`);
      }
    };
    openLegacyRecap();
    window.addEventListener("hashchange",openLegacyRecap);
    return () => window.removeEventListener("hashchange",openLegacyRecap);
  },[leagueId,pathname]);
  useEffect(() => {
    // Keep the story mounted after its first visit so reactions and card position survive tab changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing a visited URL view
    if (view === "recap") setOpenedRecap(true);
  },[view]);
  return <>
    <nav aria-label="League views" className="grid grid-cols-3 border-b border-line">
      {(["overview","insights","recap"] as const).map(id => <a key={id} href={leagueHref(leagueId,id)} aria-current={view === id ? "page" : undefined}
        onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); window.history.pushState(null,"",leagueHref(leagueId,id)); } }}
        className={`flex min-h-11 items-center justify-center border-b-2 px-2 text-sm font-medium ${view === id ? "border-accent text-accent" : "border-transparent text-muted"}`}>{LABELS[id]}</a>)}
    </nav>
    <div hidden={view !== "overview"} id="league-overview">{overview}</div>
    <div hidden={view !== "insights"} id="league-insights">{insights}</div>
    {(view === "recap" || openedRecap) && <div hidden={view !== "recap"} id="league-recap">{recap}</div>}
  </>;
}
