"""The scheduled fetch: FPL -> Supabase.

Run it with:  uv run python -m raptor.run

Each run:
  1. saves clubs, players, gameweeks and fixtures, recording what changed
     for each player since the last run
  2. saves the standings of every league in FPL_LEAGUE_IDS
  3. saves squads for everyone being tracked (league members + app users)
     for the current and previous gameweek, until FPL confirms final points
  4. logs the run in job_runs, so the app can show when data was last updated
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import datetime, timezone

from raptor.changes import TRACKED_FIELDS, diff_players
from raptor.config import Settings, load_settings
from raptor.db import Database
from raptor.fpl import (
    FplClient,
    FplUnavailable,
    gameweeks_to_refresh,
    parse_fixtures,
    parse_gameweeks,
    parse_league,
    parse_picks,
    parse_players,
    parse_teams,
)

log = logging.getLogger("raptor")

JOB_NAME = "fetch"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sync_static(fpl: FplClient, db: Database, bootstrap: dict, now: str) -> dict:
    """Clubs, players (plus their changes), gameweeks and fixtures."""
    teams = parse_teams(bootstrap, now)
    players = parse_players(bootstrap, now)
    gameweeks = parse_gameweeks(bootstrap, now)

    stored = db.select("players", "id," + ",".join(TRACKED_FIELDS))
    changes = diff_players({row["id"]: row for row in stored}, players, now)

    # Order matters: players point at teams, fixtures at teams and gameweeks.
    db.upsert("teams", teams, on_conflict="id")
    db.upsert("players", players, on_conflict="id")
    db.insert("player_changes", changes)
    db.upsert("gameweeks", gameweeks, on_conflict="id")

    fixtures = parse_fixtures(fpl.fixtures(), now)
    db.upsert("fixtures", fixtures, on_conflict="id")

    return {"players": len(players), "changes": len(changes), "fixtures": len(fixtures)}


def sync_leagues(fpl: FplClient, db: Database, league_ids: tuple[int, ...], now: str) -> dict:
    leagues = members = 0
    for league_id in league_ids:
        standings = fpl.league_standings(league_id)
        if standings is None:
            log.warning("League %s not found; skipping it", league_id)
            continue
        league_row, member_rows = parse_league(standings, now)
        db.upsert("leagues", [league_row], on_conflict="id")
        db.upsert("league_members", member_rows, on_conflict="league_id,team_id")
        leagues += 1
        members += len(member_rows)
        log.info("League %s (%s): %d managers", league_row["name"], league_id, len(member_rows))
    return {"leagues": leagues, "managers": members}


def tracked_team_ids(db: Database) -> set[int]:
    """Everyone in a followed league, plus everyone who has signed up."""
    ids = {row["team_id"] for row in db.select("league_members", "team_id")}
    ids |= {
        row["fpl_team_id"]
        for row in db.select("profiles", "fpl_team_id", {"fpl_team_id": "not.is.null"})
    }
    return ids


def sync_picks(fpl: FplClient, db: Database, bootstrap: dict, team_ids: set[int], now: str) -> dict:
    """Squads for the current and previous gameweek.

    A squad is fetched again every run until FPL marks its gameweek as
    final (finished and data_checked), so points end up correct. After that
    it's skipped, which keeps requests to FPL low.

    Returns counts per gameweek, so the run summary says exactly what happened.
    """
    per_gameweek: list[dict] = []
    for gameweek in gameweeks_to_refresh(bootstrap):
        gw_id = gameweek["id"]
        final = bool(gameweek.get("finished") and gameweek.get("data_checked"))
        done = {
            row["team_id"]
            for row in db.select(
                "entry_gameweeks", "team_id", {"gameweek_id": f"eq.{gw_id}", "final": "is.true"}
            )
        }
        entry_rows: list[dict] = []
        pick_rows: list[dict] = []
        missing = 0
        for team_id in sorted(team_ids - done):
            data = fpl.picks(team_id, gw_id)
            if data is None:  # e.g. the manager joined after this gameweek
                missing += 1
                continue
            entry_row, picks = parse_picks(team_id, gw_id, data, final, now)
            entry_rows.append(entry_row)
            pick_rows.extend(picks)
            time.sleep(fpl.polite_delay_seconds)
        db.upsert("entry_gameweeks", entry_rows, on_conflict="team_id,gameweek_id")
        db.upsert("picks", pick_rows, on_conflict="team_id,gameweek_id,player_id")
        per_gameweek.append(
            {"id": gw_id, "saved": len(entry_rows), "missing": missing, "already_final": len(team_ids & done)}
        )
    return {
        "tracked": len(team_ids),
        "squads": sum(g["saved"] for g in per_gameweek),
        "per_gameweek": per_gameweek,
    }


def describe_picks(picks: dict, fpl: FplClient) -> str:
    """'squads for 18 managers (GW5: 18 saved)', plus why when FPL refused."""
    if picks["tracked"] == 0:
        return "squads: no managers tracked yet"
    parts = []
    for g in picks["per_gameweek"]:
        bits = [f"{g['saved']} saved"]
        if g["already_final"]:
            bits.append(f"{g['already_final']} already final")
        if g["missing"]:
            bits.append(f"{g['missing']} not found")
        parts.append(f"GW{g['id']}: " + ", ".join(bits))
    text = f"squads for {picks['tracked']} managers ({'; '.join(parts) or 'no gameweeks'})"
    if picks["squads"] == 0 and getattr(fpl, "last_not_found", None):
        text += f" · FPL said {fpl.last_not_found}"
    return text


def run_once(fpl: FplClient, db: Database, settings: Settings) -> str:
    now = utc_now()
    bootstrap = fpl.bootstrap()
    static = sync_static(fpl, db, bootstrap, now)
    leagues = sync_leagues(fpl, db, settings.league_ids, now)
    picks = sync_picks(fpl, db, bootstrap, tracked_team_ids(db), now)
    return (
        f"players {static['players']} ({static['changes']} changes), "
        f"fixtures {static['fixtures']}, "
        f"leagues {leagues['leagues']} ({leagues['managers']} managers), "
        + describe_picks(picks, fpl)
    )


def announce(level: str, title: str, message: str) -> None:
    """Show a message on the GitHub Actions run page (no-op elsewhere)."""
    if os.environ.get("GITHUB_ACTIONS") == "true":
        escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::{level} title={title}::{escaped}", flush=True)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    db = Database(settings.supabase_url, settings.supabase_secret_key)
    fpl = FplClient()

    run = db.insert("job_runs", [{"job": JOB_NAME}], returning=True)[0]
    run_filter = {"id": f"eq.{run['id']}"}
    try:
        summary = run_once(fpl, db, settings)
    except FplUnavailable as exc:
        log.warning("FPL unavailable, skipping this run: %s", exc)
        announce("warning", "FPL unavailable, run skipped", str(exc))
        db.update("job_runs", {"status": "skipped", "finished_at": utc_now(), "detail": str(exc)[:500]}, run_filter)
        return 0
    except Exception as exc:
        db.update(
            "job_runs",
            {"status": "failed", "finished_at": utc_now(), "detail": f"{type(exc).__name__}: {exc}"[:500]},
            run_filter,
        )
        announce("error", "Fetch failed", f"{type(exc).__name__}: {exc}")
        raise
    db.update("job_runs", {"status": "ok", "finished_at": utc_now(), "detail": summary}, run_filter)
    log.info("Done: %s", summary)
    announce("notice", "Fetch summary", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
