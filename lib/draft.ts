/**
 * The do-it-yourself planner: your squad plus a list of moves (transfers,
 * captains, bench swaps, chips), replayed week by week to give each week's
 * team, free transfers, hits, bank and expected points.
 *
 * Keeping the draft as a list of moves makes undo trivial (drop the last
 * one) and keeps saved drafts small. Each week's starting XI is the best by
 * expected points unless you've swapped someone in or out; the captain is
 * the best starter unless you've picked one.
 * Pure functions only, so they're easy to test.
 */

export type Chip = "wildcard" | "freehit" | "bboost" | "3xc";
export const CHIP_LABELS: Record<Chip, string> = { wildcard: "Wildcard", freehit: "Free Hit", bboost: "Bench Boost", "3xc": "Triple Captain" };

export type DraftPlayer = {
  id: number;
  name: string;
  team: number;
  club: string;
  position: number; // 1 GK, 2 DEF, 3 MID, 4 FWD
  price: number; // tenths of a million
  status: string;
  chance: number | null;
  owned: number | null; // % of all FPL managers
  xp: number[]; // expected points per planned gameweek, in DraftBase.gameweeks order
};

export type Move =
  | { kind: "transfer"; gw: number; out: number; in: number }
  | { kind: "captain"; gw: number; id: number }
  | { kind: "swap"; gw: number; bench: number; start: number } // `bench` drops to the bench, `start` comes in
  | { kind: "chip"; gw: number; chip: Chip | null };

export type ChipLeft = { chip: Chip; from: number; expires: number };

export type DraftBase = {
  gameweeks: number[];
  squad: number[]; // 15 ids, your team at the last deadline
  bank: number;
  freeTransfers: number;
  sell: Record<number, number>; // selling prices for the squad (missing: today's price)
  chipsLeft: ChipLeft[];
};

export type DraftWeek = {
  gameweek: number;
  squad: number[];
  xi: number[];
  bench: number[]; // goalkeeper first, then outfield in order
  captain: number;
  vice: number;
  chip: Chip | null;
  transfers: { out: number; in: number }[];
  freeTransfers: number; // before this week's transfers
  hits: number;
  bankAfter: number;
  sell: Record<number, number>; // what each player in the squad would sell for
  xp: number; // expected points before hits
  points: number; // after hits
};

export type DraftResult = { weeks: DraftWeek[]; total: number; problems: string[] };

const MAX_FT = 5;
const HIT = 4;
const MAX_PER_CLUB = 3;
const LINEUP_MIN = { 2: 3, 3: 2, 4: 1 } as const;

type Lookup = Map<number, DraftPlayer>;

/** The best valid XI by expected points, honouring forced starters and benched players. */
export function bestXI(
  squad: number[],
  players: Lookup,
  xpOf: (id: number) => number,
  forcedStart: Set<number> = new Set(),
  forcedBench: Set<number> = new Set(),
): { xi: number[]; bench: number[] } {
  const pos = (id: number) => players.get(id)?.position ?? 3;
  const keepers = squad.filter((id) => pos(id) === 1);
  const outfield = squad.filter((id) => pos(id) !== 1);
  let best: { score: number; xi: number[] } | null = null;

  const consider = (strict: boolean) => {
    for (const gk of keepers) {
      if (strict && (forcedBench.has(gk) || keepers.some((k) => k !== gk && forcedStart.has(k)))) continue;
      // Choose which 3 outfielders sit out (13 choose 3 = 286).
      for (let a = 0; a < outfield.length; a++)
        for (let b = a + 1; b < outfield.length; b++)
          for (let c = b + 1; c < outfield.length; c++) {
            const out = new Set([outfield[a], outfield[b], outfield[c]]);
            const xi = [gk, ...outfield.filter((id) => !out.has(id))];
            if (xi.length !== 11) continue;
            const n = (p: number) => xi.filter((id) => pos(id) === p).length;
            if (n(2) < LINEUP_MIN[2] || n(3) < LINEUP_MIN[3] || n(4) < LINEUP_MIN[4]) continue;
            if (strict && (xi.some((id) => forcedBench.has(id)) || [...forcedStart].some((id) => squad.includes(id) && !xi.includes(id)))) continue;
            const score = xi.reduce((s, id) => s + xpOf(id), 0);
            if (!best || score > best.score + 1e-9) best = { score, xi };
          }
    }
  };
  consider(true);
  if (!best) consider(false); // the forced choices can't all hold: ignore them
  const xi = (best as { xi: number[] } | null)?.xi ?? squad.slice(0, 11);
  const benched = squad.filter((id) => !xi.includes(id));
  const bench = [
    ...benched.filter((id) => pos(id) === 1),
    ...benched.filter((id) => pos(id) !== 1).sort((x, y) => xpOf(y) - xpOf(x)),
  ];
  const order = (ids: number[]) => [...ids].sort((x, y) => pos(x) - pos(y) || xpOf(y) - xpOf(x));
  return { xi: order(xi), bench };
}

/** Whether swapping a starter for a bench player leaves a valid XI. */
export function canSwap(week: DraftWeek, players: Lookup, starter: number, benched: number): boolean {
  const pos = (id: number) => players.get(id)?.position ?? 3;
  if (!week.xi.includes(starter) || !week.bench.includes(benched)) return false;
  if ((pos(starter) === 1) !== (pos(benched) === 1)) return false;
  const xi = [...week.xi.filter((id) => id !== starter), benched];
  const n = (p: number) => xi.filter((id) => pos(id) === p).length;
  return n(1) === 1 && n(2) >= LINEUP_MIN[2] && n(3) >= LINEUP_MIN[3] && n(4) >= LINEUP_MIN[4];
}

export function simulate(base: DraftBase, players: Lookup, moves: Move[]): DraftResult {
  const problems: string[] = [];
  const name = (id: number) => players.get(id)?.name ?? `#${id}`;
  let squad = [...base.squad];
  let bank = base.bank;
  let ft = Math.min(MAX_FT, Math.max(0, base.freeTransfers));
  let sell: Record<number, number> = {};
  for (const id of squad) sell[id] = base.sell[id] ?? players.get(id)?.price ?? 0;
  const chipsUsed: Chip[] = [];
  const weeks: DraftWeek[] = [];

  base.gameweeks.forEach((gw, i) => {
    const xpOf = (id: number) => players.get(id)?.xp[i] ?? 0;
    const mine = moves.filter((m) => m.gw === gw);
    const before = { squad: [...squad], bank, sell: { ...sell } };

    // The week's chip (the last one set wins), if you still have it.
    let chip: Chip | null = null;
    for (const m of mine) if (m.kind === "chip") chip = m.chip;
    if (chip) {
      const copies = base.chipsLeft.filter((c) => c.chip === chip && c.from <= gw && gw <= c.expires);
      const usedBefore = chipsUsed.filter((c) => c === chip).length;
      if (copies.length <= usedBefore) {
        problems.push(`GW${gw}: no ${CHIP_LABELS[chip]} left to play`);
        chip = null;
      } else chipsUsed.push(chip);
    }

    // Transfers, netted: selling someone you bought this week replaces that
    // transfer, and buying back someone you sold this week cancels it.
    const transfers: { out: number; in: number }[] = [];
    const soldThisWeek = new Map<number, number>(); // original player -> what he sold for
    for (const m of mine) {
      if (m.kind !== "transfer") continue;
      const out = players.get(m.out);
      const incoming = players.get(m.in);
      if (!out || !incoming || !squad.includes(m.out) || squad.includes(m.in) || out.position !== incoming.position) {
        problems.push(`GW${gw}: couldn't swap ${name(m.out)} for ${name(m.in)}`);
        continue;
      }
      const cost = soldThisWeek.has(m.in) ? soldThisWeek.get(m.in)! : incoming.price;
      const after = squad.map((id) => (id === m.out ? m.in : id));
      const clubCount = after.filter((id) => players.get(id)?.team === incoming.team).length;
      if (bank + sell[m.out] - cost < 0) {
        problems.push(`GW${gw}: can't afford ${name(m.in)}`);
        continue;
      }
      if (clubCount > MAX_PER_CLUB) {
        problems.push(`GW${gw}: ${name(m.in)} would make four from one club`);
        continue;
      }
      bank += sell[m.out] - cost;
      const earlier = transfers.findIndex((t) => t.in === m.out);
      if (earlier >= 0) {
        // Selling this week's signing: the original transfer now brings in the new player,
        // unless that's the player who left, in which case the transfer is undone.
        if (transfers[earlier].out === m.in) transfers.splice(earlier, 1);
        else transfers[earlier] = { out: transfers[earlier].out, in: m.in };
      } else {
        transfers.push({ out: m.out, in: m.in });
        soldThisWeek.set(m.out, sell[m.out]);
      }
      const keepSell = soldThisWeek.has(m.in) ? soldThisWeek.get(m.in)! : incoming.price;
      delete sell[m.out];
      sell[m.in] = keepSell;
      squad = after;
    }

    const unlimited = chip === "wildcard" || chip === "freehit";
    const hits = unlimited ? 0 : Math.max(0, transfers.length - ft);

    // Lineup: swaps (the last for each player wins), then the best XI around them.
    const forcedStart = new Set<number>();
    const forcedBench = new Set<number>();
    let captainPick: number | null = null;
    for (const m of mine) {
      if (m.kind === "swap") {
        forcedBench.add(m.bench);
        forcedStart.delete(m.bench);
        forcedStart.add(m.start);
        forcedBench.delete(m.start);
      } else if (m.kind === "captain") captainPick = m.id;
    }
    const { xi, bench } = bestXI(squad, players, xpOf, forcedStart, forcedBench);
    const byXp = [...xi].sort((a, b) => xpOf(b) - xpOf(a));
    const captain = captainPick !== null && xi.includes(captainPick) ? captainPick : byXp[0];
    const vice = byXp.find((id) => id !== captain) ?? captain;
    const xp =
      xi.reduce((s, id) => s + xpOf(id), 0) +
      xpOf(captain) * (chip === "3xc" ? 2 : 1) +
      (chip === "bboost" ? bench.reduce((s, id) => s + xpOf(id), 0) : 0);

    weeks.push({
      gameweek: gw,
      squad: [...squad],
      xi,
      bench,
      captain,
      vice,
      chip,
      transfers,
      freeTransfers: ft,
      hits,
      bankAfter: bank,
      sell: { ...sell },
      xp,
      points: xp - HIT * hits,
    });

    // Next week: a Free Hit squad goes back; free transfers roll (Wildcard and Free Hit keep them).
    if (chip === "freehit") {
      squad = before.squad;
      bank = before.bank;
      sell = before.sell;
    }
    ft = unlimited ? Math.min(MAX_FT, ft + 1) : Math.min(MAX_FT, ft - (transfers.length - hits) + 1);
  });

  return { weeks, total: weeks.reduce((s, w) => s + w.points, 0), problems };
}

export type Replacement = {
  player: DraftPlayer;
  xpWeek: number; // the chosen gameweek
  xpRest: number; // that week and the rest of the plan
  ok: boolean;
  reason: string | null; // why not, when not ok
};

/** Who could replace `outId` in week `index`: same position, not already in the squad. */
export function replacements(
  result: DraftResult,
  index: number,
  outId: number,
  players: DraftPlayer[],
  query = "",
): Replacement[] {
  const week = result.weeks[index];
  const out = players.find((p) => p.id === outId);
  if (!week || !out) return [];
  const budget = week.bankAfter + (week.sell[outId] ?? out.price);
  const clubs = new Map<number, number>();
  for (const id of week.squad) {
    if (id === outId) continue;
    const team = players.find((p) => p.id === id)?.team;
    if (team != null) clubs.set(team, (clubs.get(team) ?? 0) + 1);
  }
  const q = query.trim().toLowerCase();
  return players
    .filter((p) => p.position === out.position && !week.squad.includes(p.id))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.club.toLowerCase() === q)
    .map((p) => {
      const tooDear = p.price > budget;
      const clubFull = (clubs.get(p.team) ?? 0) >= MAX_PER_CLUB;
      return {
        player: p,
        xpWeek: p.xp[index] ?? 0,
        xpRest: p.xp.slice(index).reduce((s, v) => s + v, 0),
        ok: !tooDear && !clubFull,
        reason: tooDear ? `£${((p.price - budget) / 10).toFixed(1)}m short` : clubFull ? `3 ${p.club} already` : null,
      };
    })
    .sort((a, b) => Number(b.ok) - Number(a.ok) || b.xpRest - a.xpRest);
}

/** The bot's plan as moves, so you can start from it and change things. */
export function movesFromPlan(
  weeks: { gameweek: number; chip?: string | null; captain: { id: number }; transfers: { out: { id: number }; in: { id: number } }[] }[],
  gameweeks: number[],
): Move[] {
  const moves: Move[] = [];
  for (const w of weeks) {
    if (!gameweeks.includes(w.gameweek)) continue;
    if (w.chip) moves.push({ kind: "chip", gw: w.gameweek, chip: w.chip as Chip });
    for (const t of w.transfers) moves.push({ kind: "transfer", gw: w.gameweek, out: t.out.id, in: t.in.id });
    moves.push({ kind: "captain", gw: w.gameweek, id: w.captain.id });
  }
  return moves;
}

/** Keep only well-formed moves (drafts come back from the database as plain JSON). */
export function cleanMoves(value: unknown): Move[] {
  if (!Array.isArray(value)) return [];
  const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  const chips = new Set<unknown>(["wildcard", "freehit", "bboost", "3xc", null]);
  return value
    .filter((m): m is Move => {
      if (!m || typeof m !== "object" || !int((m as Move).gw)) return false;
      const x = m as Record<string, unknown>;
      if (x.kind === "transfer") return int(x.out) && int(x.in);
      if (x.kind === "captain") return int(x.id);
      if (x.kind === "swap") return int(x.bench) && int(x.start);
      if (x.kind === "chip") return chips.has(x.chip);
      return false;
    })
    .slice(0, 300);
}
