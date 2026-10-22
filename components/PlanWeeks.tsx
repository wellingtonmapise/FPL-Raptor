"use client";

import { useState } from "react";
import GameweekPicker from "@/components/GameweekPicker";
import { netWeekPoints } from "@/lib/plannerView";
import Pitch from "@/components/Pitch";
import PlayerLink from "@/components/PlayerLink";
import { formatPrice, POSITIONS } from "@/lib/fpl";
import { planPitch } from "@/lib/pitch";
import type { PlanWeek } from "@/lib/plan";

// The plan week by week: tabs for each gameweek, its moves, and the team it
// leaves you with on the pitch (new signings ringed, xP under each name).
const CHIP_LABELS: Record<string, string> = { wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", "3xc": "Triple Captain" };

export default function PlanWeeks({ weeks, clubs, aside }: { weeks: PlanWeek[]; clubs: Record<number, string>; aside?: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const week = weeks[index];
  if (!week) return null;
  const clubOf = (teamId: number) => clubs[teamId] ?? "?";
  const pitch = planPitch(week, clubOf);
  const unlimited = week.chip === "wildcard" || week.chip === "freehit";

  return (
    <section aria-label="Week by week">
      <GameweekPicker weeks={weeks} selected={index} onSelect={setIndex} />
      <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-8"><div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="section-title">
          GW{week.gameweek}
          {week.chip ? `: ${CHIP_LABELS[week.chip] ?? week.chip}` : ""}
        </h2>
        <span className="text-xs text-muted tabular-nums">
          {netWeekPoints(week).toFixed(1)} net xP · {formatPrice(week.bank_after)} left
        </span>
      </div>
      <p className="mt-0.5 text-sm text-muted">
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
        <ul className="mt-3 flex flex-col gap-2 surface p-3">
          {week.transfers.map((t) => (
            <li key={`${t.out.id}-${t.in.id}`} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
              <div className="min-w-0">
                <PlayerLink id={t.out.id} className="block truncate font-medium text-rose-700 dark:text-rose-400">
                  {t.out.name}
                </PlayerLink>
                <div className="text-xs text-muted">
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
                <div className="text-xs text-muted tabular-nums">
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
      <p className="mt-3 text-xs leading-relaxed text-muted">
        Suggested captain: {week.captain.name} ({week.captain.xp?.toFixed(1) ?? "-"} xP). Ringed players are new signings. Tap anyone
        for their card. Weekly net xP deducts any transfer hit.
      </p>
      </div>{aside && <aside className="min-w-0 space-y-4">{aside}</aside>}</div>
    </section>
  );
}
