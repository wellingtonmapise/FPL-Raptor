"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Sheet from "@/components/Sheet";
import Shirt from "@/components/Shirt";
import { formatPrice } from "@/lib/fpl";
import type { PlayerCard } from "@/lib/player";

// Tap any player to open their card. Pages call usePlayerSheet().open(id);
// the provider in the root layout shows the sheet over whatever page you're on.
const SheetContext = createContext<{ open: (id: number) => void }>({ open: () => {} });

export function usePlayerSheet() {
  return useContext(SheetContext);
}

export default function PlayerSheetProvider({ children }: { children: React.ReactNode }) {
  const [playerId, setPlayerId] = useState<number | null>(null);
  const open = useCallback((id: number) => setPlayerId(id), []);
  return (
    <SheetContext.Provider value={{ open }}>
      {children}
      {playerId !== null && <PlayerSheet key={playerId} id={playerId} onClose={() => setPlayerId(null)} />}
    </SheetContext.Provider>
  );
}

const POSITION_NAMES = ["", "goalkeeper", "defender", "midfielder", "forward"];

const FDR: Record<number, string> = {
  1: "bg-emerald-700 text-white",
  2: "bg-emerald-300 text-emerald-950",
  3: "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
  4: "bg-rose-400 text-white",
  5: "bg-rose-800 text-white",
};

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; card: PlayerCard };

function PlayerSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    fetch(`/api/player/${id}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "This player isn't in the game any more." : "Couldn't load this player. Try again in a moment.");
        return (await res.json()) as PlayerCard;
      })
      .then((card) => live && setLoad({ state: "ready", card }))
      .catch((err: Error) => live && setLoad({ state: "error", message: err.message }));
    return () => {
      live = false;
      controller.abort();
    };
  }, [id, attempt]);

  const card = load.state === "ready" ? load.card : null;
  return (
    <Sheet title="Player details" onClose={onClose} closeLabel="Close player card">
        {load.state === "error" && (
          <div className="space-y-4 p-6">
            <p role="alert" className="text-sm text-muted">{load.message}</p>
            <button type="button" className="button-secondary" onClick={() => { setLoad({ state: "loading" }); setAttempt((value) => value + 1); }}>Try again</button>
          </div>
        )}
        {load.state === "loading" && <SheetSkeleton />}
        {card && <CardBody card={card} />}
    </Sheet>
  );
}

function SheetSkeleton() {
  return (
    <div className="px-6 pt-6 motion-safe:animate-pulse" role="status" aria-label="Loading player">
      <span className="sr-only">Loading player details…</span>
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-44 rounded bg-surface-muted" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-surface-muted" />
        ))}
      </div>
      <div className="mt-6 h-20 rounded-lg bg-surface-muted" />
      <div className="mt-4 mb-4 h-32 rounded-lg bg-surface-muted" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function availability(card: PlayerCard): { text: string; severe: boolean } | null {
  if (card.status === "a" && (card.chance == null || card.chance === 100)) return null;
  const words: Record<string, string> = { i: "Injured", s: "Suspended", u: "Unavailable", n: "Not in the squad" };
  const label = words[card.status] ?? (card.chance != null ? `${card.chance}% chance of playing` : "Doubtful");
  return { text: card.news || label, severe: card.status !== "d" };
}

function CardBody({ card }: { card: PlayerCard }) {
  const flag = availability(card);
  const fmt = (v: number | null, digits = 1) => (v == null ? "–" : v.toFixed(digits));
  return (
    <div className="px-5 py-5 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <Shirt club={card.club} goalkeeper={card.position === 1} className="h-16 w-[70px] shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-semibold tracking-tight break-words">
            {card.fullName}
          </h3>
          <p className="text-sm text-muted">
            {card.clubName} {POSITION_NAMES[card.position]}
          </p>
        </div>
        <div className="text-lg font-semibold tabular-nums">{formatPrice(card.price)}</div>
      </header>

      {flag && (
        <p
          className={`mt-4 rounded-xl px-3 py-2 text-sm ${
            flag.severe
              ? "bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
              : "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100"
          }`}
        >
          {flag.text}
        </p>
      )}

      <div className="mt-5 grid grid-cols-4 gap-3">
        <Stat value={fmt(card.xp5)} label="xP next 5" />
        <Stat value={fmt(card.form)} label="Form" />
        <Stat value={card.points == null ? "–" : String(card.points)} label="Points" />
        <Stat value={card.owned == null ? "–" : `${card.owned}%`} label="Owned" />
      </div>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">Coming up</h3>
        {card.upcoming.length ? (
          <ol className="mt-2 grid grid-cols-5 gap-1.5 text-center">
            {card.upcoming.map((f, i) => (
              <li key={i}>
                <div className="text-[11px] text-muted">{f.gameweek ? `GW${f.gameweek}` : "TBC"}</div>
                <div className={`mt-0.5 rounded-md py-1 text-xs font-semibold ${FDR[f.difficulty] ?? FDR[3]}`}>
                  {f.opponent} ({f.home ? "H" : "A"})
                </div>
                <div className="mt-1 text-xs tabular-nums text-muted">{f.xp == null ? "" : `${f.xp.toFixed(1)} xP`}</div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted">{card.fplAvailable ? "No fixtures left." : "FPL didn't send fixtures just now."}</p>
        )}
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">Last five</h3>
        {card.recent.length ? (
          <table className="mt-1 w-full text-sm">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {card.recent.map((r, i) => (
                <tr key={i}>
                  <td className="w-12 py-2 text-xs text-muted">GW{r.gameweek}</td>
                  <td className="py-2">
                    {r.home ? "v" : "at"} {r.opponent}
                  </td>
                  <td className="py-2 text-muted tabular-nums">
                    {r.score && (
                      <>
                        <span
                          className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                            r.result === "W" ? "bg-emerald-500" : r.result === "L" ? "bg-rose-500" : "bg-zinc-400"
                          }`}
                          aria-label={r.result === "W" ? "won" : r.result === "L" ? "lost" : "drew"}
                        />
                        {r.score}
                      </>
                    )}
                  </td>
                  <td className="py-2 text-right text-xs text-muted tabular-nums">{r.minutes}&apos;</td>
                  <td className="w-10 py-2 text-right font-semibold tabular-nums">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-muted">{card.fplAvailable ? "No matches yet this season." : "FPL didn't send results just now."}</p>
        )}
      </section>

      <section className="mt-6">
        <h3 className="text-sm font-semibold">This season</h3>
        <div className="mt-2 grid grid-cols-4 gap-3">
          <Stat value={fmt(card.xg, 2)} label="xG" />
          <Stat value={fmt(card.xa, 2)} label="xA" />
          <Stat value={fmt(card.xgi90, 2)} label="xGI per 90" />
          <Stat value={fmt(card.dc90)} label="Def. actions per 90" />
        </div>
        <p className="mt-3 text-xs text-muted">
          {card.minutes == null ? "Minutes unavailable." : `${card.minutes} minutes played.`} xP is the FPL Raptor model&apos;s expected points.
        </p>
      </section>
    </div>
  );
}
