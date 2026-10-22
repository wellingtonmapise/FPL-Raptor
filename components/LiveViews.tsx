"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { LIVE_VIEWS, liveHref, liveView } from "@/lib/liveView";

const LABELS = { players: "Your players", standings: "Standings", matches: "Matches" };

export default function LiveViews({ players, standings, matches, leagues, leagueId }: {
  players: React.ReactNode;
  standings: React.ReactNode;
  matches: React.ReactNode;
  leagues: { id: number; name: string }[];
  leagueId: number | null;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const view = liveView(params.get("view"));
  const [pending, startTransition] = useTransition();
  const panels = { players, standings, matches };

  return (
    <div>
      {leagues.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <label htmlFor="live-league" className="text-sm text-muted">League</label>
          <select
            id="live-league"
            value={leagueId ?? ""}
            disabled={pending}
            aria-busy={pending}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm font-medium sm:max-w-sm"
            onChange={(event) => {
              const id = Number(event.target.value);
              if (leagues.some((league) => league.id === id)) {
                startTransition(() => router.push(liveHref(view, id), { scroll: false }));
              }
            }}
          >
            {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
          </select>
          {pending && <span role="status" className="sr-only">Switching league…</span>}
        </div>
      )}
      <nav aria-label="Live views" className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1 text-sm">
        {LIVE_VIEWS.map((item) => (
          <a
            key={item}
            href={liveHref(item, leagueId)}
            aria-current={view === item ? "page" : undefined}
            aria-controls={`live-${item}`}
            className={`flex min-h-11 items-center justify-center rounded-lg px-2 font-medium ${view === item ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              if (view !== item) window.history.pushState(null, "", liveHref(item, leagueId));
            }}
          >
            {LABELS[item]}
          </a>
        ))}
      </nav>
      {LIVE_VIEWS.map((item) => (
        <div key={item} id={`live-${item}`} hidden={view !== item}>
          {panels[item]}
        </div>
      ))}
    </div>
  );
}
