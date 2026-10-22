import { SORTS, type Range, type Sort, type StatRow } from "@/lib/scout";
import { formatPrice } from "@/lib/fpl";

export const SCOUT_VIEWS = [
  { id: "players", label: "Players" },
  { id: "fixtures", label: "Fixtures" },
  { id: "stats", label: "Detailed stats" },
  { id: "differentials", label: "Differentials" },
  { id: "ask", label: "Ask Raptor" },
] as const;
export type ScoutView = typeof SCOUT_VIEWS[number]["id"];
export type ScoutParams = { view: ScoutView; weeks: number; pos: number; sort: Sort; range: Range; q: string };
export const SORT_LABELS: Record<Sort, string> = { xp: "Expected points · next 5", xgi90: "xGI per 90", form: "Form", points: "Points", price: "Price", owned: "Ownership" };

export function scoutParams(query: { get: (name: string) => string | null }): ScoutParams {
  const pos = Number(query.get("pos"));
  return {
    view: SCOUT_VIEWS.find(v => v.id === query.get("view"))?.id ?? "players",
    weeks: query.get("weeks") === "3" ? 3 : 6,
    pos: Number.isInteger(pos) && pos >= 0 && pos <= 4 ? pos : 0,
    sort: SORTS.find(s => s === query.get("sort")) ?? "xp",
    range: query.get("range") === "recent" ? "recent" : "season",
    q: (query.get("q") ?? "").slice(0, 80),
  };
}

/** Keep filter context when switching views, including existing deep links. */
export function scoutHref(params: ScoutParams, change: Partial<ScoutParams> = {}): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams({ view: next.view });
  if (next.weeks !== 6) query.set("weeks", String(next.weeks));
  if (next.pos) query.set("pos", String(next.pos));
  if (next.sort !== "xp") query.set("sort", next.sort);
  if (next.range !== "season") query.set("range", next.range);
  if (next.q) query.set("q", next.q);
  return `/scout?${query}`;
}

const normalise = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ø/gi, "o").toLowerCase();
export function matchesScoutSearch(name: string, club: string, query: string): boolean {
  const haystack = normalise(`${name} ${club}`);
  return normalise(query).trim().split(/\s+/).every(term => haystack.includes(term));
}

export function scoutMetric(row: StatRow, sort: Sort): string {
  if (sort === "xp") return row.xp5?.toFixed(1) ?? "—";
  if (sort === "xgi90") return row.xgi90?.toFixed(2) ?? "—";
  if (sort === "price") return formatPrice(row.player.now_cost);
  if (sort === "owned") return row.player.selected_by_percent == null ? "—" : `${row.player.selected_by_percent}%`;
  if (sort === "form") return row.player.form == null ? "—" : Number(row.player.form).toFixed(1);
  return String(row.points);
}
