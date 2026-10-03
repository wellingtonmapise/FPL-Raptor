"use client";

import { useState } from "react";
import Pitch from "@/components/Pitch";
import PlayerLink from "@/components/PlayerLink";
import { formatPrice, POSITIONS } from "@/lib/fpl";
import { planPitch } from "@/lib/pitch";
import type { PlanWeek } from "@/lib/plan";

// The plan week by week: tabs for each gameweek, its moves, and the team it
// leaves you with on the pitch (new signings ringed, xP under each name).
const CHIP_LABELS: Record<string, string> = { wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", "3xc": "Triple Captain" };

export default function PlanWeeks({ weeks, clubs }: { weeks: PlanWeek[]; clubs: Record<number, string> }) {
  const [index, setIndex] = useState(0);
  const week = weeks[index];
  if (!week) return null;
  const clubOf = (teamId: number) => clubs[teamId] ?? "?";
  const pitch = planPitch(week, clubOf);
  const unlimited = week.chip === "wildcard" || week.chip === "freehit";

  return (
    <section aria-label="Week by week">
      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900" role="tablist" aria-label="Gameweek">
        {weeks.map((w, i) => (
          <button
            key={w.gameweek}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={`flex-1 rounded-lg py-1.5 text-sm font-medium ${
              i === index ? "bg-white shadow-sm dark:bg-zinc-800" : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            GW{w.gameweek}
            {(w.transfers.length > 0 || w.chip) && (
              <span
                className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${w.chip ? "bg-violet-500" : "bg-emerald-500"}`}
                aria-label={w.chip ? "chip" : "transfers"}
              />
            )}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">
          GW{week.gameweek}
          {week.chip ? `: ${CHIP_LABELS[week.chip] ?? week.chip}` : ""}
        </h2>
        <span className="text-xs text-zinc-500 tabular-nums">
          {week.expected_points.toFixed(1)} xP, {formatPrice(week.bank_after)} left
        </span>
      </div>
      <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
        {week.chip === "freehit"
          ? `A one-week team: your squad comes back for GW${week.gameweek + 1}.`
          : week.chip === "wildcard"
            ? "Unlimited free transfers this week."
            : week.chip === "bboost"
              ? "Your bench scores too."
              : week.chip === "3xc"
                ? "Your captain scores triple."
                : week.transfers.length === 0
                  ? `No transfers${week.free_transfers < 5 ? `: bank it (${week.free_transfers} free now).` : "."}`
                  : `${week.free_transfers} free transfer${week.free_transfers === 1 ? "" : "s"} available${week.hits ? `, plus a −${4 * week.hits} hit` : ""}.`}
      </p>

      {week.transfers.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
          {week.transfers.map((t) => (
            <li key={`${t.out.id}-${t.in.id}`} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
              <div className="min-w-0">
                <PlayerLink id={t.out.id} className="block truncate font-medium text-rose-700 dark:text-rose-400">
                  {t.out.name}
                </PlayerLink>
                <div className="text-xs text-zinc-500">
                  {POSITIONS[t.out.position]}, sells for {formatPrice(t.out.sell ?? t.out.price)}
                </div>
              </div>
              <span className="text-zinc-400" aria-label="replaced by">
                ›
              </span>
              <div className="min-w-0">
                <PlayerLink id={t.in.id} className="block truncate font-medium text-emerald-700 dark:text-emerald-400">
                  {t.in.name}
                </PlayerLink>
                <div className="text-xs text-zinc-500 tabular-nums">
                  {formatPrice(t.in.price)}, {t.in.xp?.toFixed(1) ?? "-"} xP
                </div>
              </div>
            </li>
          ))}
          {unlimited ? null : week.hits > 0 ? (
            <li className="text-xs font-semibold text-amber-700 dark:text-amber-300">Costs a −{4 * week.hits} hit</li>
          ) : null}
        </ul>
      )}

      <div className="mt-3">
        <Pitch starters={pitch.starters} bench={pitch.bench} benchNote={week.chip === "bboost" ? "Bench Boost: all count" : undefined} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Captain: {week.captain.name} ({week.captain.xp?.toFixed(1) ?? "-"} xP). Ringed players are new signings. Tap anyone
        for their card.
      </p>
    </section>
  );
}
