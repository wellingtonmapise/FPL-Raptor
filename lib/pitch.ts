/**
 * Turning each page's data into pitch slots (components/Pitch.tsx draws them).
 * Pure functions only, so they're easy to test.
 */

import type { NextFixture, SquadPlayer } from "@/lib/gameweek";
import type { TeamLive } from "@/lib/live";
import type { PlanPlayer, PlanWeek } from "@/lib/plan";

export type Tone = "fdr1" | "fdr2" | "fdr3" | "fdr4" | "fdr5" | "points" | "live" | "muted";

export type PitchPlayer = {
  id: number;
  name: string;
  position: number; // 1 GK, 2 DEF, 3 MID, 4 FWD
  club: string; // short name, e.g. "ARS"
  caption: string; // under the name: a fixture, points, xP
  tone?: Tone;
  number?: string | null; // printed on the shirt
  badge?: "C" | "V" | "TC" | null;
  alert?: "doubtful" | "out" | null;
  dim?: boolean; // subbed off, not playing, benched
  ring?: "in" | "sub" | "pick" | null; // a new signing / came on as a sub / can be picked now
  live?: boolean; // playing right now
  note?: string; // read out by screen readers, e.g. "subbed on"
};

export type PitchTeam = { starters: PitchPlayer[]; bench: PitchPlayer[] };

export function fdrTone(difficulty: number | null | undefined): Tone {
  const d = Math.min(5, Math.max(1, difficulty ?? 3));
  return `fdr${d}` as Tone;
}

/** "EVE (H)"; a double reads "EVE liv" (capitals at home, as FPL writes it). */
export function fixtureCaption(fixtures: NextFixture[]): { caption: string; tone: Tone } {
  if (fixtures.length === 0) return { caption: "No match", tone: "muted" };
  if (fixtures.length === 1) {
    const f = fixtures[0];
    return { caption: `${f.opponent} (${f.home ? "H" : "A"})`, tone: fdrTone(f.difficulty) };
  }
  const easiest = Math.min(...fixtures.map((f) => f.difficulty ?? 3));
  return { caption: fixtures.map((f) => (f.home ? f.opponent : f.opponent.toLowerCase())).join(" "), tone: fdrTone(easiest) };
}

function alertFor(sp: SquadPlayer): PitchPlayer["alert"] {
  const p = sp.player;
  if (!p || !sp.flagged) return null;
  if (["i", "s", "u", "n"].includes(p.status) || p.chance_of_playing_next_round === 0) return "out";
  return "doubtful";
}

/** My gameweek: next fixture under the name, the model's expected points on the shirt. */
export function teamPitch(starters: SquadPlayer[], bench: SquadPlayer[], xp: Map<number, number>): PitchTeam {
  const slot = (sp: SquadPlayer): PitchPlayer => {
    const { caption, tone } = fixtureCaption(sp.fixtures);
    const value = xp.get(sp.player_id);
    return {
      id: sp.player_id,
      name: sp.player?.web_name ?? `#${sp.player_id}`,
      position: sp.player?.position ?? 3,
      club: sp.club,
      caption,
      tone,
      number: value === undefined ? null : value.toFixed(1),
      badge: sp.is_captain ? (sp.multiplier === 3 ? "TC" : "C") : sp.is_vice_captain ? "V" : null,
      alert: alertFor(sp),
    };
  };
  return { starters: starters.map(slot), bench: bench.map(slot) };
}

/** Live: points so far under the name (with the captain's multiplier), subs marked. */
export function livePitch(team: TeamLive, clubOf: (teamId: number) => string): PitchTeam {
  const slot = (sp: TeamLive["picks"][number]): PitchPlayer => {
    const counted = sp.counts ? sp.points * sp.multiplier : sp.points;
    const pending = sp.status === "to-play" && sp.minutes === 0;
    const armband = team.captain === sp;
    return {
      id: sp.pick.element,
      name: sp.player?.web_name ?? `#${sp.pick.element}`,
      position: sp.player?.position ?? 3,
      club: sp.player ? clubOf(sp.player.team_id) : "?",
      caption: pending ? "–" : String(counted) + (sp.provisional ? "*" : ""),
      tone: sp.status === "playing" ? "live" : pending || sp.status === "out" ? "muted" : "points",
      badge: armband ? (sp.multiplier === 3 ? "TC" : "C") : sp.pick.is_vice_captain ? "V" : null,
      dim: sp.subbedOut || (!sp.counts && !sp.subbedIn) || (sp.status === "out" && !sp.counts),
      ring: sp.subbedIn ? "sub" : null,
      live: sp.status === "playing",
      note: [sp.subbedIn ? "subbed on" : null, sp.subbedOut ? "subbed off" : null, sp.provisional ? "includes provisional bonus" : null]
        .filter(Boolean)
        .join(", "),
    };
  };
  return {
    starters: team.picks.filter((p) => p.pick.position <= 11).map(slot),
    bench: team.picks.filter((p) => p.pick.position > 11).map(slot),
  };
}

/** Planner: a planned week, each player's expected points under the name, new signings ringed. */
export function planPitch(week: PlanWeek, clubOf: (teamId: number) => string): PitchTeam {
  const signed = new Set(week.transfers.map((t) => t.in.id));
  const triple = week.chip === "3xc";
  const slot = (p: PlanPlayer, benched: boolean): PitchPlayer => ({
    id: p.id,
    name: p.name,
    position: p.position,
    club: clubOf(p.team),
    caption: p.xp == null ? "–" : `${p.xp.toFixed(1)} xP`,
    tone: "points",
    badge: p.id === week.captain.id ? (triple ? "TC" : "C") : null,
    ring: signed.has(p.id) ? "in" : null,
    dim: benched && week.chip !== "bboost",
    note: signed.has(p.id) ? "new signing" : undefined,
  });
  return { starters: week.lineup.map((p) => slot(p, false)), bench: week.bench.map((p) => slot(p, true)) };
}
