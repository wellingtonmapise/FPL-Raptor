"""Last season's real results, to compare the backtest against.

    uv run python -m raptor.backtest.actuals 1086012 2025/26          # a mini-league
    uv run python -m raptor.backtest.actuals curve 2025/26            # points -> rank sample

The league mode prints one JSON line per manager (entry, name, total points,
overall rank) and, on GitHub Actions, the whole list as a notice. FPL only
keeps past seasons' totals and ranks, not the week-by-week detail.

The curve mode samples (points, rank) pairs to turn a backtest score into an
overall rank: managers at the top of this season's overall league (they cover
the top ranks) plus random team ids (they cover the rest). No ids are kept.
"""

from __future__ import annotations

import json
import random
import sys

from raptor.fpl import FplClient
from raptor.run import announce


def league_season(fpl: FplClient, league_id: int, season: str) -> list[dict]:
    standings = fpl.league_standings(league_id) or {}
    out = []
    for r in standings.get("standings", {}).get("results", []):
        history = fpl.entry_history(r["entry"]) or {}
        past = next((p for p in history.get("past", []) if p.get("season_name") == season), None)
        if past:
            out.append({"entry": r["entry"], "name": r["player_name"], "points": past["total_points"], "rank": past["rank"]})
    return sorted(out, key=lambda p: p["rank"])


OVERALL_LEAGUE = 314


def past_season(fpl: FplClient, entry: int, season: str) -> tuple[int, int] | None:
    history = fpl.entry_history(entry) or {}
    past = next((p for p in history.get("past", []) if p.get("season_name") == season), None)
    return (past["total_points"], past["rank"]) if past and past.get("rank") else None


def rank_curve(fpl: FplClient, season: str, top_pages: int = 2, random_ids: int = 150, seed: int = 7) -> list[tuple[int, int]]:
    entries = [r["entry"] for r in (fpl.league_standings(OVERALL_LEAGUE, max_pages=top_pages) or {}).get("standings", {}).get("results", [])]
    rng = random.Random(seed)
    entries += [rng.randint(1, 11_000_000) for _ in range(random_ids)]
    pairs = set()
    for entry in entries:
        found = past_season(fpl, entry, season)
        if found:
            pairs.add(found)
    return sorted(pairs, key=lambda p: p[1])


def main() -> int:
    season = sys.argv[2] if len(sys.argv) > 2 else "2025/26"
    if len(sys.argv) > 1 and sys.argv[1] == "curve":
        pairs = rank_curve(FplClient(), season)
        for start in range(0, len(pairs), 100):
            chunk = pairs[start : start + 100]
            announce("notice", f"Rank curve {season} ({start + 1}-{start + len(chunk)} of {len(pairs)})", ";".join(f"{p},{r}" for p, r in chunk))
        return 0
    league_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1086012
    rows = league_season(FplClient(), league_id, season)
    for row in rows:
        print(json.dumps(row))
    compact = ";".join(f"{r['entry']},{r['points']},{r['rank']}" for r in rows)
    announce("notice", f"League {league_id} in {season}", f"{len(rows)} managers: {compact}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
