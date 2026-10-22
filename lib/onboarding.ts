export type TeamMatchRow = {
  team_id: number;
  manager_name: string;
  team_name: string;
  leagues: { name: string } | { name: string }[] | null;
};

export type TeamCandidate = {
  id: number;
  manager: string;
  name: string;
  leagues: string[];
};

export function teamSearchTerm(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) : "";
}

/** Escape LIKE wildcards; the query is passed as a value, never .or() syntax. */
export function teamSearchPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function teamCandidates(rows: TeamMatchRow[], query: string): TeamCandidate[] {
  const byId = new Map<number, TeamCandidate>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.team_id) || row.team_id <= 0 || row.team_id >= 100_000_000) continue;
    const team = byId.get(row.team_id) ?? { id: row.team_id, manager: row.manager_name, name: row.team_name, leagues: [] };
    const leagues = Array.isArray(row.leagues) ? row.leagues : row.leagues ? [row.leagues] : [];
    for (const league of leagues) if (league.name && !team.leagues.includes(league.name)) team.leagues.push(league.name);
    byId.set(row.team_id, team);
  }
  const term = teamSearchTerm(query).toLowerCase();
  const exact = (team: TeamCandidate) => Number(team.manager.toLowerCase() === term || team.name.toLowerCase() === term);
  return [...byId.values()].sort((a, b) =>
    exact(b) - exact(a) || a.manager.localeCompare(b.manager) || a.name.localeCompare(b.name) || a.id - b.id,
  ).slice(0, 8);
}
