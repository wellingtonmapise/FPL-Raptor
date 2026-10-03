"""Last season's real results for a mini-league, to compare the backtest against.

    uv run python -m raptor.backtest.actuals 1086012 2025/26

Prints one JSON line per manager (entry, name, total points, overall rank) and,
on GitHub Actions, the whole list as a notice. FPL only keeps past seasons'
totals and ranks, not the week-by-week detail.
"""

from __future__ import annotations

import json
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


def main() -> int:
    league_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1086012
    season = sys.argv[2] if len(sys.argv) > 2 else "2025/26"
    rows = league_season(FplClient(), league_id, season)
    for row in rows:
        print(json.dumps(row))
    compact = ";".join(f"{r['entry']},{r['points']},{r['rank']}" for r in rows)
    announce("notice", f"League {league_id} in {season}", f"{len(rows)} managers: {compact}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
