"""Talking to the FPL API, and turning its JSON into database rows.

Everything that knows the shape of FPL's responses lives in this file, so if
FPL changes something (the API is unofficial and undocumented), this is the
one place to fix.

The parse_* functions are pure: JSON in, list of dicts out. They're easy to
test and never touch the network.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

log = logging.getLogger(__name__)

BASE_URL = "https://fantasy.premierleague.com/api"

# FPL sometimes rejects requests with no browser-like User-Agent.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0 Safari/537.36 fpl-raptor"
)


class FplUnavailable(Exception):
    """FPL is down or mid-update (it returns 503 around deadlines). Try later."""


class FplClient:
    def __init__(
        self,
        session: requests.Session | None = None,
        retries: int = 3,
        backoff_seconds: float = 2.0,
        polite_delay_seconds: float = 0.5,
    ) -> None:
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self.retries = retries
        self.backoff_seconds = backoff_seconds
        self.polite_delay_seconds = polite_delay_seconds
        # The most recent 404, so a run summary can say what FPL replied.
        self.last_not_found: str | None = None

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any | None:
        """GET a path under the API. Returns parsed JSON, or None on 404.

        Retries server errors and connection problems with growing waits, then
        raises FplUnavailable. Other 4xx errors raise immediately.
        """
        url = f"{BASE_URL}/{path.lstrip('/')}"
        last_problem = ""
        for attempt in range(1, self.retries + 1):
            try:
                resp = self.session.get(url, params=params, timeout=30)
            except requests.RequestException as exc:
                last_problem = f"{type(exc).__name__}: {exc}"
            else:
                if resp.status_code == 404:
                    self.last_not_found = f"404 on {path}: {resp.text[:120]!r}"
                    return None
                if resp.status_code < 400:
                    return resp.json()
                if resp.status_code < 500 and resp.status_code != 429:
                    resp.raise_for_status()
                last_problem = f"HTTP {resp.status_code}: {resp.text[:120]!r}"
            if attempt < self.retries:
                wait = self.backoff_seconds * attempt
                log.warning("FPL %s failed (%s); retrying in %.0fs", path, last_problem, wait)
                time.sleep(wait)
        raise FplUnavailable(f"{path}: {last_problem}")

    def bootstrap(self) -> dict:
        data = self.get("bootstrap-static/")
        if data is None:
            raise FplUnavailable("bootstrap-static/ returned 404")
        return data

    def fixtures(self) -> list[dict]:
        data = self.get("fixtures/")
        if data is None:
            raise FplUnavailable("fixtures/ returned 404")
        return data

    def league_standings(self, league_id: int) -> dict | None:
        """All pages of a classic league's standings, merged into one response.

        Returns None if the league doesn't exist.
        """
        page = 1
        first: dict | None = None
        results: list[dict] = []
        while True:
            data = self.get(
                f"leagues-classic/{league_id}/standings/",
                params={"page_standings": page},
            )
            if data is None:
                return None
            if first is None:
                first = data
            standings = data.get("standings", {})
            results.extend(standings.get("results", []))
            if not standings.get("has_next"):
                break
            page += 1
            time.sleep(self.polite_delay_seconds)
        first["standings"]["results"] = results
        first["standings"]["has_next"] = False
        return first

    def picks(self, team_id: int, gameweek_id: int) -> dict | None:
        """A squad for one gameweek. None if FPL has nothing for it (404)."""
        return self.get(f"entry/{team_id}/event/{gameweek_id}/picks/")

    def entry_history(self, team_id: int) -> dict | None:
        """A manager's gameweek-by-gameweek record this season, plus chips played."""
        return self.get(f"entry/{team_id}/history/")

    def entry_transfers(self, team_id: int) -> list[dict]:
        """Every transfer a manager has made this season, with prices paid."""
        return self.get(f"entry/{team_id}/transfers/") or []

    def live(self, gameweek_id: int) -> dict | None:
        """Every player's points and minutes in one gameweek (updates during matches)."""
        return self.get(f"event/{gameweek_id}/live/")


# ---------------------------------------------------------------------------
# Parsers: FPL JSON -> rows for our tables (see supabase/migrations)
# ---------------------------------------------------------------------------


def _number_or_none(value: Any) -> float | None:
    """FPL sends some numbers as strings ("12.3"). Empty or missing -> None."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_teams(bootstrap: dict, now: str) -> list[dict]:
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "short_name": t["short_name"],
            "updated_at": now,
        }
        for t in bootstrap["teams"]
    ]


def parse_players(bootstrap: dict, now: str) -> list[dict]:
    return [
        {
            "id": p["id"],
            "web_name": p["web_name"],
            "first_name": p.get("first_name"),
            "second_name": p.get("second_name"),
            "team_id": p["team"],
            "position": p["element_type"],
            "now_cost": p["now_cost"],
            "status": p["status"],
            "news": p.get("news") or "",
            "chance_of_playing_next_round": p.get("chance_of_playing_next_round"),
            "selected_by_percent": _number_or_none(p.get("selected_by_percent")),
            "form": _number_or_none(p.get("form")),
            "total_points": p.get("total_points"),
            "updated_at": now,
        }
        for p in bootstrap["elements"]
    ]


def parse_gameweeks(bootstrap: dict, now: str) -> list[dict]:
    return [
        {
            "id": e["id"],
            "name": e["name"],
            "deadline_time": e["deadline_time"],
            "is_previous": bool(e.get("is_previous")),
            "is_current": bool(e.get("is_current")),
            "is_next": bool(e.get("is_next")),
            "finished": bool(e.get("finished")),
            "data_checked": bool(e.get("data_checked")),
            "updated_at": now,
        }
        for e in bootstrap["events"]
    ]


def parse_fixtures(fixtures: list[dict], now: str) -> list[dict]:
    return [
        {
            "id": f["id"],
            "gameweek_id": f.get("event"),
            "kickoff_time": f.get("kickoff_time"),
            "home_team_id": f["team_h"],
            "away_team_id": f["team_a"],
            "home_difficulty": f.get("team_h_difficulty"),
            "away_difficulty": f.get("team_a_difficulty"),
            "home_score": f.get("team_h_score"),
            "away_score": f.get("team_a_score"),
            "started": bool(f.get("started")),
            "finished": bool(f.get("finished")),
            "updated_at": now,
        }
        for f in fixtures
    ]


def gameweeks_to_refresh(bootstrap: dict) -> list[dict]:
    """The gameweeks whose squads we keep fetching: current and previous.

    The previous one is included so its points get a final refresh after FPL
    confirms them, even if the next gameweek has already started.
    """
    return [e for e in bootstrap["events"] if e.get("is_current") or e.get("is_previous")]


def parse_league(standings: dict, now: str) -> tuple[dict, list[dict]]:
    league = standings["league"]
    league_row = {"id": league["id"], "name": league["name"], "updated_at": now}
    member_rows = [
        {
            "league_id": league["id"],
            "team_id": r["entry"],
            "manager_name": r["player_name"],
            "team_name": r["entry_name"],
            "rank": r.get("rank"),
            "last_rank": r.get("last_rank"),
            "total": r.get("total"),
            "event_total": r.get("event_total"),
            "updated_at": now,
        }
        for r in standings["standings"]["results"]
    ]
    return league_row, member_rows


def parse_picks(
    team_id: int, gameweek_id: int, data: dict, final: bool, now: str
) -> tuple[dict, list[dict]]:
    history = data.get("entry_history") or {}
    entry_row = {
        "team_id": team_id,
        "gameweek_id": gameweek_id,
        "active_chip": data.get("active_chip"),
        "points": history.get("points"),
        "total_points": history.get("total_points"),
        "overall_rank": history.get("overall_rank"),
        "bank": history.get("bank"),
        "value": history.get("value"),
        "event_transfers": history.get("event_transfers"),
        "event_transfers_cost": history.get("event_transfers_cost"),
        "points_on_bench": history.get("points_on_bench"),
        "final": final,
        "updated_at": now,
    }
    pick_rows = [
        {
            "team_id": team_id,
            "gameweek_id": gameweek_id,
            "player_id": p["element"],
            "squad_position": p["position"],
            "multiplier": p["multiplier"],
            "is_captain": bool(p["is_captain"]),
            "is_vice_captain": bool(p["is_vice_captain"]),
        }
        for p in data.get("picks", [])
    ]
    return entry_row, pick_rows


def parse_live(gameweek_id: int, data: dict, now: str) -> list[dict]:
    rows = []
    for element in data.get("elements", []):
        stats = element.get("stats") or {}
        rows.append(
            {
                "player_id": element["id"],
                "gameweek_id": gameweek_id,
                "points": stats.get("total_points") or 0,
                "minutes": stats.get("minutes") or 0,
                "bonus": stats.get("bonus") or 0,
                "updated_at": now,
            }
        )
    return rows


def format_price(tenths: int | None) -> str:
    """FPL money is tenths of a million: 1009 -> '£100.9m', 3 -> '£0.3m'."""
    if tenths is None:
        return "-"
    return f"£{tenths / 10:.1f}m"
