import "server-only";

/**
 * Direct calls to the FPL API from the web server, for things the scheduled
 * job hasn't stored yet (a new user's team, their squad before the next run).
 * Responses are cached briefly so pages don't hammer FPL.
 */

// FPL_API_BASE lets tests point this at a stand-in server.
const BASE_URL = process.env.FPL_API_BASE ?? "https://fantasy.premierleague.com/api";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 fpl-raptor",
};

export type FplResult<T> = { ok: true; data: T } | { ok: false; reason: "not-found" | "unavailable" };

async function getJson<T>(path: string, revalidateSeconds: number): Promise<FplResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}/${path}`, {
      headers: HEADERS,
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { ok: false, reason: "not-found" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export type FplEntry = {
  id: number;
  name: string; // team name, e.g. "JP Morgan"
  player_first_name: string;
  player_last_name: string;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  summary_event_points: number | null;
  current_event: number | null;
};

export function getEntry(teamId: number) {
  return getJson<FplEntry>(`entry/${teamId}/`, 600);
}

export type FplPicks = {
  active_chip: string | null;
  entry_history: {
    points: number | null;
    total_points: number | null;
    overall_rank: number | null;
    bank: number | null;
    value: number | null;
    event_transfers: number | null;
    event_transfers_cost: number | null;
    points_on_bench: number | null;
  };
  picks: {
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
  }[];
};

export function getPicks(teamId: number, gameweekId: number) {
  return getJson<FplPicks>(`entry/${teamId}/event/${gameweekId}/picks/`, 300);
}

/** Every player's live points and stats for a gameweek (about 1 MB). */
export function getLive(gameweekId: number) {
  return getJson<{ elements: import("@/lib/live").LiveElement[] }>(`event/${gameweekId}/live/`, 60);
}

/** A gameweek's matches with live scores, minutes and BPS. */
export function getEventFixtures(gameweekId: number) {
  return getJson<import("@/lib/live").LiveFixture[]>(`fixtures/?event=${gameweekId}`, 60);
}
