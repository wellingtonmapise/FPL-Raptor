"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SCOUT_VIEWS, scoutHref, scoutParams } from "@/lib/scoutView";

export default function ScoutNav() {
  const params = scoutParams(useSearchParams());
  return <nav aria-label="Scout views" className="grid grid-cols-4 border-b border-line">
    {SCOUT_VIEWS.filter(view => view.id !== "stats").map(view => <Link key={view.id} href={scoutHref(params, { view: view.id })} scroll={false}
      aria-current={view.id === params.view || view.id === "players" && params.view === "stats" ? "page" : undefined}
      className={`flex min-h-11 min-w-0 items-center justify-center border-b-2 px-1 text-center text-xs font-medium sm:px-3 sm:text-sm ${view.id === params.view || view.id === "players" && params.view === "stats" ? "border-accent text-accent" : "border-transparent text-muted hover:text-foreground"}`}>
      {view.label}
    </Link>)}
  </nav>;
}
