/**
 * Ask Raptor's tools: what the chat model can look up about players,
 * fixtures and "what if I did this" scenarios, all over data loaded once per
 * question (see lib/ask/context.ts). The model never does its own maths: every
 * number it quotes comes from one of these.
 * Pure functions only, so they're easy to test.
 */

import { CHIP_LABELS, simulate, type Chip, type DraftBase, type DraftPlayer, type Move } from "@/lib/draft";

export type AskPlayer = DraftPlayer & {
  fullName: string;
  news: string;
  form: number | null;
  points: number | null; // season total
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  xg: number | null;
  xa: number | null;
  dc: number | null; // defensive contributions
  recent: { gameweeks: number; minutes: number; points: number; xg: number; xa: number } | null;
  leagueOwners: number | null; // squads in your league that have him (not counting yours)
};

export type Fixtures = Record<number, Record<number, { opponent: string; home: boolean; difficulty: number | null }[]>>;

export type AskData = {
  base: DraftBase;
  players: AskPlayer[];
  fixtures: Fixtures; // by club id, then gameweek
  clubs: { id: number; short: string; name: string }[];
  botMoves: Move[] | null;
  leagueSquads: number; // other squads in your league
  gameweeksPlayed: number;
};

export type Scenario = { label: string; moves: Move[]; gain: number; total: number; gameweeks: number[] };
export type ToolOutcome = { result: unknown; scenario?: Scenario; players?: number[] };

export const POS = ["", "GK", "DEF", "MID", "FWD"] as const;
const POS_IDS: Record<string, number> = { GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4 };
const CHIPS: Chip[] = ["wildcard", "freehit", "bboost", "3xc"];
const MAX_LIST = 15;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (tenths: number) => r1(tenths / 10);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Lowercase, no accents or punctuation: "Ødegaard" and "odegaard" match. */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/æ/gi, "ae")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function availability(p: AskPlayer): string {
  if (p.status === "a") return "available";
  const chance = p.chance == null ? "" : ` (${p.chance}% chance)`;
  const word: Record<string, string> = { d: "doubtful", i: "injured", s: "suspended", u: "unavailable", n: "not available" };
  return `${word[p.status] ?? "flagged"}${chance}`;
}

/**
 * Players matching a name, best match first: an id, a surname ("Saka"),
 * a full or first name ("Bruno Fernandes", "Bruno"), with an optional club
 * ("Gabriel ARS" or "Gabriel (ARS)").
 */
export function findPlayers(data: AskData, text: string): AskPlayer[] {
  const raw = String(text ?? "").trim();
  if (/^\d+$/.test(raw)) {
    const hit = data.players.find((p) => p.id === Number(raw));
    return hit ? [hit] : [];
  }
  const words = normalise(raw).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const clubWords = new Set(data.clubs.map((c) => normalise(c.short)));
  const club = words.find((w) => clubWords.has(w) && words.length > 1);
  const nameWords = words.filter((w) => w !== club);
  const query = nameWords.join(" ");

  const scored = data.players
    .filter((p) => !club || normalise(p.club) === club)
    .map((p) => {
      const web = normalise(p.name);
      const tokens = `${web} ${normalise(p.fullName)}`.split(" ");
      let score = -1;
      if (web === query) score = 3;
      else if (normalise(p.fullName) === query) score = 2.5;
      else if (nameWords.every((w) => tokens.some((t) => t === w))) score = 2;
      else if (nameWords.every((w) => tokens.some((t) => t.startsWith(w)))) score = 1;
      return { p, score };
    })
    .filter((s) => s.score >= 0);
  return scored.sort((a, b) => b.score - a.score || sum(b.p.xp) - sum(a.p.xp)).map((s) => s.p);
}

/** One player, or a reason the name didn't pin anyone down. */
export function resolvePlayer(data: AskData, text: unknown): { player: AskPlayer } | { error: string } {
  const found = findPlayers(data, String(text ?? ""));
  if (found.length === 0) return { error: `No player matches "${text}".` };
  const exact = found.filter((p) => normalise(p.name) === normalise(String(text)));
  if (found.length === 1 || exact.length === 1) return { player: exact[0] ?? found[0] };
  // Several matches: take the clear favourite (in the squad, or the only one the model rates).
  const squad = found.filter((p) => data.base.squad.includes(p.id));
  if (squad.length === 1) return { player: squad[0] };
  const live = found.filter((p) => sum(p.xp) > 1);
  if (live.length === 1) return { player: live[0] };
  return {
    error: `"${text}" could be ${found
      .slice(0, 5)
      .map((p) => `${p.name} (${p.club}, id ${p.id})`)
      .join(", ")}. Use the id.`,
  };
}

/** The compact line every tool uses for a player. */
export function playerRow(data: AskData, p: AskPlayer) {
  const xgi90 = p.minutes && p.minutes >= 90 && p.xg != null && p.xa != null ? r2(((p.xg + p.xa) / p.minutes) * 90) : null;
  return {
    id: p.id,
    name: p.name,
    club: p.club,
    position: POS[p.position] ?? "?",
    price: money(p.price),
    xp: p.xp.map(r1),
    xp_total: r1(sum(p.xp)),
    form: p.form,
    owned_overall_pct: p.owned,
    owned_in_league: p.leagueOwners == null || !data.leagueSquads ? null : `${p.leagueOwners}/${data.leagueSquads}`,
    status: availability(p),
    ...(p.news ? { news: p.news } : {}),
    xgi_per90: xgi90,
    minutes: p.minutes,
    in_my_squad: data.base.squad.includes(p.id),
  };
}

const clubId = (data: AskData, text: unknown): number | null => {
  const t = normalise(String(text ?? ""));
  if (!t) return null;
  const c = data.clubs.find((c) => normalise(c.short) === t || normalise(c.name) === t || normalise(c.name).startsWith(t));
  return c?.id ?? null;
};

export type SearchArgs = {
  query?: string;
  position?: string;
  club?: string;
  max_price?: number;
  min_price?: number;
  sort?: "xp_next" | "xp_total" | "form" | "xgi_per90" | "value";
  exclude_my_squad?: boolean;
  league_differentials?: boolean;
  available_only?: boolean;
  limit?: number;
};

export function searchPlayers(data: AskData, args: SearchArgs): ToolOutcome {
  const pos = args.position ? POS_IDS[String(args.position).toUpperCase()] : undefined;
  const club = args.club ? clubId(data, args.club) : null;
  if (args.club && club === null) return { result: { error: `Unknown club "${args.club}". Use a short name like ARS or MCI.` } };
  let pool = args.query ? findPlayers(data, args.query) : [...data.players];
  pool = pool.filter(
    (p) =>
      (!pos || p.position === pos) &&
      (club === null || p.team === club) &&
      (args.max_price == null || p.price <= Math.round(Number(args.max_price) * 10)) &&
      (args.min_price == null || p.price >= Math.round(Number(args.min_price) * 10)) &&
      (!args.exclude_my_squad || !data.base.squad.includes(p.id)) &&
      (!args.available_only || p.status === "a" || (p.chance ?? 0) >= 75) &&
      (!args.league_differentials || !data.leagueSquads || (p.leagueOwners ?? 0) / data.leagueSquads <= 0.2),
  );
  const per90 = (p: AskPlayer) => (p.minutes && p.minutes >= 270 ? ((p.xg ?? 0) + (p.xa ?? 0)) / p.minutes : -1);
  const key: Record<string, (p: AskPlayer) => number> = {
    xp_next: (p) => p.xp[0] ?? 0,
    xp_total: (p) => sum(p.xp),
    form: (p) => p.form ?? -1,
    xgi_per90: per90,
    value: (p) => sum(p.xp) / Math.max(1, p.price),
  };
  if (!args.query || args.sort) {
    const by = key[args.sort ?? "xp_total"] ?? key.xp_total;
    pool.sort((a, b) => by(b) - by(a));
  }
  const limit = Math.min(MAX_LIST, Math.max(1, Math.round(Number(args.limit) || 8)));
  const shown = pool.slice(0, limit);
  return {
    result: { gameweeks: data.base.gameweeks, matches: pool.length, players: shown.map((p) => playerRow(data, p)) },
    players: shown.map((p) => p.id),
  };
}

function fixtureList(data: AskData, team: number) {
  return data.base.gameweeks.map((gw) => {
    const games = data.fixtures[team]?.[gw] ?? [];
    return {
      gameweek: gw,
      games: games.length ? games.map((g) => `${g.opponent} (${g.home ? "H" : "A"}) difficulty ${g.difficulty ?? "?"}`) : ["blank"],
    };
  });
}

export function playerDetails(data: AskData, args: { players?: unknown[] }): ToolOutcome {
  const names = (Array.isArray(args.players) ? args.players : [args.players]).filter((x) => x != null).slice(0, 4);
  if (names.length === 0) return { result: { error: "Name at least one player." } };
  const ids: number[] = [];
  const out = names.map((name) => {
    const found = resolvePlayer(data, name);
    if ("error" in found) return { query: name, error: found.error };
    const p = found.player;
    ids.push(p.id);
    const per90 = (v: number | null) => (v == null || !p.minutes || p.minutes < 90 ? null : r2((v / p.minutes) * 90));
    const sell = data.base.squad.includes(p.id) ? (data.base.sell[p.id] ?? p.price) : null;
    return {
      ...playerRow(data, p),
      full_name: p.fullName,
      ...(sell != null ? { sells_for: money(sell) } : {}),
      season: {
        points: p.points,
        minutes: p.minutes,
        goals: p.goals,
        assists: p.assists,
        xg: p.xg == null ? null : r2(p.xg),
        xa: p.xa == null ? null : r2(p.xa),
        xgi_per90: per90(p.xg == null || p.xa == null ? null : p.xg + p.xa),
        defensive_contributions_per90: per90(p.dc),
      },
      ...(p.recent
        ? {
            last_gameweeks: {
              gameweeks: p.recent.gameweeks,
              points: p.recent.points,
              minutes: p.recent.minutes,
              xg: r2(p.recent.xg),
              xa: r2(p.recent.xa),
            },
          }
        : {}),
      fixtures: fixtureList(data, p.team),
    };
  });
  return { result: { gameweeks: data.base.gameweeks, players: out }, players: ids };
}

export function fixtureRun(data: AskData, args: { clubs?: unknown[] }): ToolOutcome {
  const rows = data.clubs.map((c) => {
    const games = data.base.gameweeks.flatMap((gw) => data.fixtures[c.id]?.[gw] ?? []);
    const ease = sum(games.map((g) => 6 - (g.difficulty ?? 3)));
    return { club: c.short, name: c.name, ease, fixtures: fixtureList(data, c.id) };
  });
  rows.sort((a, b) => b.ease - a.ease);
  const wanted = (Array.isArray(args.clubs) ? args.clubs : args.clubs ? [args.clubs] : []).map((c) => clubId(data, c));
  if (wanted.some((id) => id === null)) return { result: { error: "Unknown club. Use short names like ARS, MCI or NFO." } };
  const pick = wanted.length
    ? rows.filter((r) => wanted.includes(data.clubs.find((c) => c.short === r.club)?.id ?? -1))
    : [...rows.slice(0, 6), ...rows.slice(-4)];
  return {
    result: {
      gameweeks: data.base.gameweeks,
      note: "ease adds up (6 - difficulty) per match; higher is kinder. Difficulty 1-2 easy, 3 average, 4-5 hard.",
      ...(wanted.length ? {} : { showing: "the 6 kindest runs, then the 4 hardest" }),
      clubs: pick.map((r) => ({ ...r, rank: rows.indexOf(r) + 1 })),
    },
  };
}

export type WhatIfArgs = {
  transfers?: { gameweek?: number; out?: unknown; in?: unknown }[];
  captains?: { gameweek?: number; player?: unknown }[];
  chips?: { gameweek?: number; chip?: string }[];
};

/** Plays a set of moves through the planner and compares it with doing nothing and with the bot's plan. */
export function whatIf(data: AskData, args: WhatIfArgs): ToolOutcome {
  const { base } = data;
  const lookup = new Map(data.players.map((p) => [p.id, p as DraftPlayer]));
  const name = (id: number) => lookup.get(id)?.name ?? `#${id}`;
  const errors: string[] = [];
  const moves: Move[] = [];
  const week = (gw: unknown) => {
    const n = gw == null ? base.gameweeks[0] : Number(gw);
    if (!base.gameweeks.includes(n)) {
      errors.push(`GW${gw} isn't one of the planned gameweeks (${base.gameweeks.join(", ")}).`);
      return null;
    }
    return n;
  };
  for (const c of (args.chips ?? []).slice(0, 4)) {
    const gw = week(c.gameweek);
    const chip = String(c.chip ?? "").toLowerCase() as Chip;
    if (gw === null) continue;
    if (!CHIPS.includes(chip)) errors.push(`Unknown chip "${c.chip}": use wildcard, freehit, bboost or 3xc.`);
    else moves.push({ kind: "chip", gw, chip });
  }
  for (const t of (args.transfers ?? []).slice(0, 15)) {
    const gw = week(t.gameweek);
    const out = resolvePlayer(data, t.out);
    const incoming = resolvePlayer(data, t.in);
    if ("error" in out) errors.push(out.error);
    if ("error" in incoming) errors.push(incoming.error);
    if (gw === null || "error" in out || "error" in incoming) continue;
    moves.push({ kind: "transfer", gw, out: out.player.id, in: incoming.player.id });
  }
  for (const c of (args.captains ?? []).slice(0, 5)) {
    const gw = week(c.gameweek);
    const p = resolvePlayer(data, c.player);
    if ("error" in p) errors.push(p.error);
    if (gw === null || "error" in p) continue;
    moves.push({ kind: "captain", gw, id: p.player.id });
  }
  if (errors.length) return { result: { error: errors.join(" ") } };
  if (moves.length === 0) return { result: { error: "Give at least one transfer, captain or chip." } };
  // Chips first in each week, then transfers, then captains: the order the planner applies them.
  const order = { chip: 0, transfer: 1, swap: 2, captain: 3 } as const;
  moves.sort((a, b) => a.gw - b.gw || order[a.kind] - order[b.kind]);

  const sim = simulate(base, lookup, moves);
  const keep = simulate(base, lookup, []);
  const bot = data.botMoves ? simulate(base, lookup, data.botMoves) : null;
  const gain = sim.total - keep.total;
  const transfers = sim.weeks.flatMap((w) => w.transfers.map((t) => `${name(t.out)} → ${name(t.in)}`));
  const chips = sim.weeks.filter((w) => w.chip).map((w) => `${CHIP_LABELS[w.chip!]} GW${w.gameweek}`);
  const label = [...chips, ...transfers.slice(0, 3), transfers.length > 3 ? `+${transfers.length - 3} more` : ""]
    .filter(Boolean)
    .join(", ") || `Captain ${moves.filter((m) => m.kind === "captain").map((m) => (m.kind === "captain" ? name(m.id) : "")).join(", ")}`;

  return {
    result: {
      gameweeks: base.gameweeks,
      ...(sim.problems.length ? { problems: sim.problems } : {}),
      weeks: sim.weeks.map((w) => ({
        gameweek: w.gameweek,
        ...(w.chip ? { chip: CHIP_LABELS[w.chip] } : {}),
        transfers: w.transfers.map((t) => `${name(t.out)} → ${name(t.in)}`),
        free_transfers_before: w.freeTransfers,
        hits: w.hits,
        bank_after: money(w.bankAfter),
        captain: name(w.captain),
        bench: w.bench.map(name),
        expected_points: r1(w.points),
      })),
      total: r1(sim.total),
      if_you_do_nothing: r1(keep.total),
      gain_vs_doing_nothing: r1(gain),
      ...(bot ? { bot_plan_total: r1(bot.total), gain_vs_bot_plan: r1(sim.total - bot.total) } : {}),
      note: "expected points after hits (4 per extra transfer), best XI and captain each week unless set",
    },
    scenario: sim.problems.length ? undefined : { label, moves, gain: r1(gain), total: r1(sim.total), gameweeks: base.gameweeks },
  };
}

/** The tools as the chat model sees them (OpenAI-style function declarations). */
export const TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "search_players",
      description:
        "Find and rank players by the model's expected points (xp, one per planned gameweek), form, xGI per 90 or value. Use it for 'who's the best X under £Ym', replacements, and differentials.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Part of a name, e.g. 'Saka' or 'Bruno'." },
          position: { type: "string", enum: ["GK", "DEF", "MID", "FWD"] },
          club: { type: "string", description: "Club short name, e.g. ARS, MCI, NFO." },
          max_price: { type: "number", description: "In £m, e.g. 7.5." },
          min_price: { type: "number", description: "In £m." },
          sort: { type: "string", enum: ["xp_next", "xp_total", "form", "xgi_per90", "value"], description: "Default xp_total." },
          exclude_my_squad: { type: "boolean" },
          league_differentials: { type: "boolean", description: "Only players owned by at most a fifth of the user's mini-league." },
          available_only: { type: "boolean", description: "Skip injured, suspended and doubtful (under 75%) players." },
          limit: { type: "integer", description: "1-15, default 8." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "player_details",
      description:
        "Everything on up to 4 players: price (and selling price if the user owns him), availability and news, expected points per gameweek, season and recent stats (xG, xA, minutes), and fixtures. Use it before giving an opinion on a player.",
      parameters: {
        type: "object",
        properties: { players: { type: "array", items: { type: "string" }, description: "Names or ids, e.g. ['Saka', 'Palmer']." } },
        required: ["players"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fixture_run",
      description: "Clubs' fixtures over the planned gameweeks with difficulty, ranked kindest first. Without clubs, shows the kindest and hardest runs.",
      parameters: {
        type: "object",
        properties: { clubs: { type: "array", items: { type: "string" }, description: "Short names, e.g. ['ARS', 'LIV']." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "what_if",
      description:
        "Run a plan through the transfer planner: transfers, captains and chips in given gameweeks. Returns expected points per week after hits, free transfers, bank, and the gain against doing nothing and against the bot's plan. Use it for every 'should I do X' or comparison, one call per option.",
      parameters: {
        type: "object",
        properties: {
          transfers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                gameweek: { type: "integer", description: "Defaults to the next gameweek." },
                out: { type: "string", description: "Player sold: name or id." },
                in: { type: "string", description: "Player bought: name or id. Same position." },
              },
              required: ["out", "in"],
            },
          },
          captains: {
            type: "array",
            items: {
              type: "object",
              properties: { gameweek: { type: "integer" }, player: { type: "string" } },
              required: ["player"],
            },
          },
          chips: {
            type: "array",
            items: {
              type: "object",
              properties: { gameweek: { type: "integer" }, chip: { type: "string", enum: ["wildcard", "freehit", "bboost", "3xc"] } },
              required: ["gameweek", "chip"],
            },
          },
        },
      },
    },
  },
] as const;

export const TOOL_LABELS: Record<string, string> = {
  search_players: "Searched players",
  player_details: "Checked players",
  fixture_run: "Checked fixtures",
  what_if: "Ran the numbers",
};

/** Runs one tool call. Bad arguments come back as an error the model can read and fix. */
export function runTool(data: AskData, name: string, args: unknown): ToolOutcome {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "search_players":
        return searchPlayers(data, a as SearchArgs);
      case "player_details":
        return playerDetails(data, a as { players?: unknown[] });
      case "fixture_run":
        return fixtureRun(data, a as { clubs?: unknown[] });
      case "what_if":
        return whatIf(data, a as WhatIfArgs);
      default:
        return { result: { error: `No tool called ${name}.` } };
    }
  } catch (e) {
    return { result: { error: `That didn't work: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

/** What the model is told about the user's team at the start of every question. */
export function squadBrief(data: AskData, extra: { teamName?: string | null; deadline?: string | null; leagueName?: string | null; botSummary?: string | null }) {
  const { base } = data;
  const lookup = new Map(data.players.map((p) => [p.id, p]));
  const keep = simulate(base, new Map(data.players.map((p) => [p.id, p as DraftPlayer])), []);
  const first = keep.weeks[0];
  const line = (id: number) => {
    const p = lookup.get(id);
    if (!p) return `- #${id}`;
    const sell = base.sell[id] ?? p.price;
    const flag = p.status === "a" ? "" : `, ${availability(p)}${p.news ? `: ${p.news}` : ""}`;
    return `- ${p.name} (id ${p.id}, ${p.club} ${POS[p.position]}), sells £${money(sell)}m, xP ${p.xp.map(r1).join(" / ")}${flag}`;
  };
  const chips = base.chipsLeft.length
    ? base.chipsLeft.map((c) => `${CHIP_LABELS[c.chip]} (usable GW${c.from}-${c.expires})`).join(", ")
    : "none left";
  return [
    `Planned gameweeks: ${base.gameweeks.join(", ")} (xP lists below are in this order).${extra.deadline ? ` Next deadline: ${extra.deadline}.` : ""}`,
    extra.teamName ? `Team: ${extra.teamName}.` : "",
    `Bank £${money(base.bank)}m, ${base.freeTransfers} free transfer${base.freeTransfers === 1 ? "" : "s"}. Chips left: ${chips}.`,
    extra.leagueName ? `Mini-league: ${extra.leagueName} (${data.leagueSquads} other squads).` : "",
    `Starting XI for GW${first.gameweek} if nothing changes (captain ${lookup.get(first.captain)?.name}):`,
    ...first.xi.map(line),
    "Bench:",
    ...first.bench.map(line),
    `Doing nothing scores about ${r1(keep.total)} expected points over the planned gameweeks.`,
    extra.botSummary ? `The bot's plan: ${extra.botSummary}` : "The bot has no plan for this user yet.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A short "what I'm doing" line for each tool call, shown while the answer is on its way. */
export function describeTool(name: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String).filter(Boolean);
  switch (name) {
    case "search_players": {
      const what = a.position ? `${String(a.position).toUpperCase() === "GK" ? "keepers" : `${String(a.position).toLowerCase()}s`}` : "players";
      if (a.query) return `Looking up ${String(a.query)}`;
      return `Searching ${what}${a.club ? ` at ${String(a.club).toUpperCase()}` : ""}${a.max_price != null ? ` under £${a.max_price}m` : ""}`;
    }
    case "player_details": {
      const names = list(a.players);
      return names.length ? `Checking ${names.slice(0, 3).join(", ")}${names.length > 3 ? " and more" : ""}` : "Checking players";
    }
    case "fixture_run": {
      const clubs = list(a.clubs).map((c) => c.toUpperCase());
      return clubs.length ? `Checking fixtures for ${clubs.slice(0, 4).join(", ")}` : "Checking the fixture ticker";
    }
    case "what_if": {
      const transfers = Array.isArray(a.transfers) ? (a.transfers as Record<string, unknown>[]) : [];
      const chips = Array.isArray(a.chips) ? (a.chips as Record<string, unknown>[]) : [];
      const chip = chips[0]?.chip ? (CHIP_LABELS[String(chips[0].chip) as Chip] ?? String(chips[0].chip)) : null;
      if (chip) return `Running the numbers on a ${chip}`;
      if (transfers.length === 1) return `Running the numbers on ${String(transfers[0].out)} → ${String(transfers[0].in)}`;
      return transfers.length ? `Running the numbers on ${transfers.length} transfers` : "Running the numbers";
    }
    default:
      return "Thinking";
  }
}
