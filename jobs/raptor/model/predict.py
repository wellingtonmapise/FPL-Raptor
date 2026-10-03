"""Live expected points for the next five gameweeks.

    uv run python -m raptor.model.predict

Rebuilds this season's player history from FPL's live endpoint (one request
per played gameweek), builds the same features the model was trained on,
predicts every player's points for each upcoming fixture, scales by FPL's
chance of playing, and saves the totals per gameweek to `predictions`.

Also refreshes `player_stats` for the Scout page: season totals, the last six
gameweeks, and each player's expected points for the next one and five.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from raptor.config import load_settings
from raptor.db import Database, SupabaseError
from raptor.fpl import FplClient, FplUnavailable
from raptor.model.features import availability_factor, build_features
from raptor.run import announce, utc_now

log = logging.getLogger("raptor.predict")

MODEL_DIR = Path(__file__).resolve().parents[2] / "model"
HORIZON = 5  # gameweeks ahead
JOB_NAME = "predict"
RECENT = 6  # gameweeks in the Scout page's "recent" stats
STATS_MIGRATION = "supabase/migrations/20261003000003_scout_and_recaps.sql"


def _num(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def season_label(bootstrap: dict) -> str:
    first = min(e["deadline_time"] for e in bootstrap["events"])
    year = int(first[:4])
    return f"{year}-{str(year + 1)[2:]}"


def fixtures_frame(fixtures: list[dict], season: str) -> pd.DataFrame:
    scheduled = [f for f in fixtures if f.get("event") and f.get("kickoff_time")]
    return pd.DataFrame(
        {
            "season": season,
            "fixture": [f["id"] for f in scheduled],
            "gameweek": [f["event"] for f in scheduled],
            "kickoff_time": [f["kickoff_time"] for f in scheduled],
            "team_h": [f["team_h"] for f in scheduled],
            "team_a": [f["team_a"] for f in scheduled],
            "team_h_score": [f.get("team_h_score") if f.get("finished") else None for f in scheduled],
            "team_a_score": [f.get("team_a_score") if f.get("finished") else None for f in scheduled],
            "team_h_difficulty": [f.get("team_h_difficulty") for f in scheduled],
            "team_a_difficulty": [f.get("team_a_difficulty") for f in scheduled],
        }
    ).astype({"team_h_score": "float", "team_a_score": "float"})


def history_rows(live_by_gw: dict[int, dict], bootstrap: dict, fixtures: pd.DataFrame, season: str) -> pd.DataFrame:
    """One row per player per played gameweek, from FPL's live endpoint.

    A double gameweek arrives as one combined row (FPL sums the stats), so it
    is filed under the first of the two fixtures.
    """
    players = {p["id"]: p for p in bootstrap["elements"]}
    fx = fixtures.set_index("fixture")
    rows = []
    for gw, data in sorted(live_by_gw.items()):
        for element in data.get("elements", []):
            explain = element.get("explain") or []
            player = players.get(element["id"])
            if not explain or player is None:
                continue  # team had no match (blank), or player has left the game
            fixture_id = explain[0]["fixture"]
            if fixture_id not in fx.index:
                continue
            f = fx.loc[fixture_id]
            team = player["team"]
            if team not in (f["team_h"], f["team_a"]):
                continue  # moved clubs since; this row belongs to the old team
            home = int(team == f["team_h"])
            s = element.get("stats") or {}
            rows.append(
                {
                    "season": season,
                    "element": element["id"],
                    "fixture": int(fixture_id),
                    "gameweek": int(gw),
                    "kickoff_time": f["kickoff_time"],
                    "team": int(team),
                    "opponent": int(f["team_a"] if home else f["team_h"]),
                    "was_home": home,
                    "position": int(player["element_type"]),
                    "value": float(player["now_cost"]),
                    "minutes": _num(s.get("minutes")),
                    "starts": _num(s.get("starts")),
                    "points": _num(s.get("total_points")),
                    "xg": _num(s.get("expected_goals")),
                    "xa": _num(s.get("expected_assists")),
                    "xgc": _num(s.get("expected_goals_conceded")),
                    "bps": _num(s.get("bps")),
                    "bonus": _num(s.get("bonus")),
                    "ict": _num(s.get("ict_index")),
                    "dc": _num(s.get("defensive_contribution")),
                }
            )
    return pd.DataFrame(rows)


def target_rows(bootstrap: dict, fixtures: pd.DataFrame, gameweeks: list[int], season: str) -> pd.DataFrame:
    """A results-free row for every player in every upcoming fixture."""
    upcoming = fixtures[fixtures["gameweek"].isin(gameweeks)]
    rows = []
    for player in bootstrap["elements"]:
        team = player["team"]
        mine = upcoming[(upcoming["team_h"] == team) | (upcoming["team_a"] == team)]
        for f in mine.itertuples():
            home = int(f.team_h == team)
            rows.append(
                {
                    "season": season,
                    "element": player["id"],
                    "fixture": int(f.fixture),
                    "gameweek": int(f.gameweek),
                    "kickoff_time": f.kickoff_time,
                    "team": int(team),
                    "opponent": int(f.team_a if home else f.team_h),
                    "was_home": home,
                    "position": int(player["element_type"]),
                    "value": float(player["now_cost"]),
                    **{k: np.nan for k in ("minutes", "starts", "points", "xg", "xa", "xgc", "bps", "bonus", "ict", "dc")},
                }
            )
    return pd.DataFrame(rows)


def predict(bootstrap: dict, fixtures_json: list[dict], live_by_gw: dict[int, dict], model, features: list[str], now: datetime) -> pd.DataFrame:
    """-> DataFrame(player_id, gameweek_id, expected_points) for the next HORIZON gameweeks."""
    season = season_label(bootstrap)
    fixtures = fixtures_frame(fixtures_json, season)
    upcoming = sorted(
        e["id"] for e in bootstrap["events"] if datetime.fromisoformat(e["deadline_time"].replace("Z", "+00:00")) > now
    )[:HORIZON]
    if not upcoming:
        return pd.DataFrame(columns=["player_id", "gameweek_id", "expected_points"])

    history = history_rows(live_by_gw, bootstrap, fixtures, season)
    targets = target_rows(bootstrap, fixtures, upcoming, season)
    targets["_target"] = True
    rows = pd.concat([history.assign(_target=False), targets], ignore_index=True)
    rows["_target"] = rows["_target"].astype(bool)
    frame = build_features(rows, fixtures)
    frame = frame[frame["_target"]].copy()

    frame["raw"] = model.predict(frame[features]) if len(frame) else []
    players = {p["id"]: p for p in bootstrap["elements"]}
    horizon = {gw: i + 1 for i, gw in enumerate(upcoming)}
    frame["factor"] = [
        availability_factor(players[e]["status"], players[e].get("chance_of_playing_next_round"), horizon[g])
        for e, g in zip(frame["element"], frame["gameweek"])
    ]
    frame["xp"] = frame["raw"].clip(lower=0) * frame["factor"]
    totals = frame.groupby(["element", "gameweek"], as_index=False)["xp"].sum()

    # Players whose team has no match that week (blank gameweek) get a zero.
    grid = pd.MultiIndex.from_product([sorted(players), upcoming], names=["element", "gameweek"]).to_frame(index=False)
    totals = grid.merge(totals, on=["element", "gameweek"], how="left").fillna({"xp": 0.0})
    return totals.rename(columns={"element": "player_id", "gameweek": "gameweek_id", "xp": "expected_points"})


def _int(value) -> int | None:
    return None if value is None or value == "" else int(float(value))


def _round(value, places: int = 2) -> float | None:
    return None if value is None or value == "" else round(float(value), places)


def player_stats_rows(bootstrap: dict, history: pd.DataFrame, predictions: pd.DataFrame, now: datetime) -> list[dict]:
    """One row per player for the Scout page."""
    recent = pd.DataFrame()
    window = 0
    if not history.empty:
        last = int(history["gameweek"].max())
        played = sorted(history["gameweek"].unique())
        window = min(RECENT, len(played))
        recent = history[history["gameweek"] > last - RECENT].groupby("element")[["minutes", "points", "xg", "xa", "dc"]].sum()
    xp_gw = int(predictions["gameweek_id"].min()) if not predictions.empty else None
    by_player = predictions.groupby("player_id")["expected_points"] if not predictions.empty else None
    xp_next = predictions[predictions["gameweek_id"] == xp_gw].set_index("player_id")["expected_points"] if xp_gw else pd.Series(dtype=float)
    xp_total = by_player.sum() if by_player is not None else pd.Series(dtype=float)
    stamp = now.isoformat(timespec="seconds")
    rows = []
    for p in bootstrap["elements"]:
        pid = p["id"]
        r = recent.loc[pid] if pid in recent.index else None
        rows.append(
            {
                "player_id": pid,
                "minutes": _int(p.get("minutes")),
                "starts": _int(p.get("starts")),
                "goals": _int(p.get("goals_scored")),
                "assists": _int(p.get("assists")),
                "clean_sheets": _int(p.get("clean_sheets")),
                "bonus": _int(p.get("bonus")),
                "defensive_contribution": _int(p.get("defensive_contribution")),
                "xg": _round(p.get("expected_goals")),
                "xa": _round(p.get("expected_assists")),
                "xgi": _round(p.get("expected_goal_involvements")),
                "xgc": _round(p.get("expected_goals_conceded")),
                "points_per_game": _round(p.get("points_per_game"), 1),
                "ict": _round(p.get("ict_index"), 1),
                "recent_gameweeks": window,
                "recent_minutes": int(r["minutes"]) if r is not None else 0,
                "recent_points": int(r["points"]) if r is not None else 0,
                "recent_xg": round(float(r["xg"]), 2) if r is not None else 0.0,
                "recent_xa": round(float(r["xa"]), 2) if r is not None else 0.0,
                "recent_dc": int(r["dc"]) if r is not None and pd.notna(r["dc"]) else 0,
                "transfers_in_event": _int(p.get("transfers_in_event")),
                "transfers_out_event": _int(p.get("transfers_out_event")),
                "xp_gameweek": xp_gw,
                "xp_next": round(float(xp_next.get(pid, 0.0)), 2) if xp_gw else None,
                "xp_next5": round(float(xp_total.get(pid, 0.0)), 2) if xp_gw else None,
                "updated_at": stamp,
            }
        )
    return rows


def save_player_stats(db: Database, rows: list[dict]) -> str:
    try:
        db.upsert("player_stats", rows, on_conflict="player_id")
    except SupabaseError as exc:
        if "PGRST205" in str(exc) or ("player_stats" in str(exc) and "does not exist" in str(exc)):
            return f"scout stats skipped (run {STATS_MIGRATION})"
        raise
    return f"scout stats for {len(rows)} players"


def load_model():
    meta = json.loads((MODEL_DIR / "xpts.json").read_text())
    return joblib.load(MODEL_DIR / "xpts.joblib"), meta


def run_predict(fpl: FplClient, db: Database, now: datetime) -> str:
    model, meta = load_model()
    bootstrap = fpl.bootstrap()
    fixtures_json = fpl.fixtures()
    played = [e["id"] for e in bootstrap["events"] if e.get("finished") or e.get("is_current")]
    live_by_gw = {}
    for gw in played:
        data = fpl.live(gw)
        if data:
            live_by_gw[gw] = data

    result = predict(bootstrap, fixtures_json, live_by_gw, model, meta["features"], now)
    history = history_rows(live_by_gw, bootstrap, fixtures_frame(fixtures_json, season_label(bootstrap)), season_label(bootstrap))
    stats_note = save_player_stats(db, player_stats_rows(bootstrap, history, result, now))
    if result.empty:
        return f"no upcoming gameweeks; {stats_note}"
    created = now.isoformat(timespec="seconds")
    db.upsert(
        "predictions",
        [
            {
                "player_id": int(r.player_id),
                "gameweek_id": int(r.gameweek_id),
                "expected_points": round(float(r.expected_points), 2),
                "model_version": meta["version"],
                "created_at": created,
            }
            for r in result.itertuples()
        ],
        on_conflict="player_id,gameweek_id,model_version",
    )
    first_gw = int(result["gameweek_id"].min())
    top = result[result["gameweek_id"] == first_gw].nlargest(3, "expected_points")
    names = {p["id"]: p["web_name"] for p in bootstrap["elements"]}
    leaders = ", ".join(f"{names.get(int(r.player_id), r.player_id)} {r.expected_points:.1f}" for r in top.itertuples())
    gws = sorted(result["gameweek_id"].unique())
    return (
        f"{len(result):,} predictions for GW{gws[0]}-{gws[-1]} from {len(live_by_gw)} played gameweeks "
        f"(model {meta['version']}); top for GW{first_gw}: {leaders}; {stats_note}"
    )


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    db = Database(settings.supabase_url, settings.supabase_secret_key)
    run = db.insert("job_runs", [{"job": JOB_NAME}], returning=True)[0]
    run_filter = {"id": f"eq.{run['id']}"}
    try:
        summary = run_predict(FplClient(), db, datetime.now(timezone.utc))
    except FplUnavailable as exc:
        db.update("job_runs", {"status": "skipped", "finished_at": utc_now(), "detail": str(exc)[:500]}, run_filter)
        announce("warning", "FPL unavailable, predictions skipped", str(exc))
        return 0
    except Exception as exc:
        db.update("job_runs", {"status": "failed", "finished_at": utc_now(), "detail": f"{type(exc).__name__}: {exc}"[:500]}, run_filter)
        announce("error", "Predictions failed", f"{type(exc).__name__}: {exc}")
        raise
    db.update("job_runs", {"status": "ok", "finished_at": utc_now(), "detail": summary}, run_filter)
    log.info("Done: %s", summary)
    announce("notice", "Predictions", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
