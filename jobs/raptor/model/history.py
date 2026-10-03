"""Past seasons for training, from the public vaastav/Fantasy-Premier-League dataset.

Files are downloaded once and cached (default: jobs/.cache/fpl-history), then
normalised into the `rows` and `fixtures` tables described in features.py.
"""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
import requests

BASE = "https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data"
# Seasons with expected goals/assists (FPL added them in 2022/23).
SEASONS = ["2022-23", "2023-24", "2024-25", "2025-26"]
POSITIONS = {"GK": 1, "GKP": 1, "DEF": 2, "MID": 3, "FWD": 4}


def cache_dir() -> Path:
    path = Path(os.environ.get("FPL_HISTORY_DIR", Path(__file__).resolve().parents[2] / ".cache" / "fpl-history"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def download(season: str) -> Path:
    folder = cache_dir() / season
    folder.mkdir(exist_ok=True)
    for remote, local in (("gws/merged_gw.csv", "merged_gw.csv"), ("fixtures.csv", "fixtures.csv")):
        target = folder / local
        if not target.exists():
            resp = requests.get(f"{BASE}/{season}/{remote}", timeout=120)
            resp.raise_for_status()
            target.write_bytes(resp.content)
    return folder


def load_season(season: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    folder = download(season)
    gw = pd.read_csv(folder / "merged_gw.csv")
    fx = pd.read_csv(folder / "fixtures.csv")
    # 2024/25's Assistant Manager chip added managers ("AM") as players; they aren't.
    gw = gw[gw["position"].isin(POSITIONS)].reset_index(drop=True)

    fixtures = pd.DataFrame(
        {
            "season": season,
            "fixture": fx["id"].astype(int),
            "kickoff_time": fx["kickoff_time"],
            "team_h": fx["team_h"].astype(int),
            "team_a": fx["team_a"].astype(int),
            "team_h_score": pd.to_numeric(fx["team_h_score"], errors="coerce"),
            "team_a_score": pd.to_numeric(fx["team_a_score"], errors="coerce"),
            "team_h_difficulty": fx["team_h_difficulty"],
            "team_a_difficulty": fx["team_a_difficulty"],
        }
    )

    was_home = gw["was_home"].astype(str).str.lower().eq("true").astype(int)
    teams = fixtures.set_index("fixture")[["team_h", "team_a"]]
    joined = teams.reindex(gw["fixture"].astype(int)).reset_index(drop=True)
    team = joined["team_h"].where(was_home == 1, joined["team_a"])
    opponent = joined["team_a"].where(was_home == 1, joined["team_h"])

    num = lambda col: pd.to_numeric(gw[col], errors="coerce") if col in gw else pd.Series(float("nan"), index=gw.index)
    rows = pd.DataFrame(
        {
            "season": season,
            "element": gw["element"].astype(int),
            "fixture": gw["fixture"].astype(int),
            "gameweek": gw["GW"].astype(int),
            "kickoff_time": gw["kickoff_time"],
            "team": team.astype(int),
            "opponent": opponent.astype(int),
            "was_home": was_home,
            "position": gw["position"].map(POSITIONS).astype(int),
            "value": num("value"),
            "minutes": num("minutes"),
            "starts": num("starts"),
            "points": num("total_points"),
            "xg": num("expected_goals"),
            "xa": num("expected_assists"),
            "xgc": num("expected_goals_conceded"),
            "bps": num("bps"),
            "bonus": num("bonus"),
            "ict": num("ict_index"),
            "dc": num("defensive_contribution"),
            "fpl_xp": num("xP"),  # FPL's own expected points, kept only as a benchmark
        }
    )
    # The dataset occasionally repeats a player's row for the same fixture.
    rows = rows.drop_duplicates(["season", "element", "fixture"]).reset_index(drop=True)
    return rows, fixtures


def load_history(seasons: list[str] | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    parts = [load_season(s) for s in (seasons or SEASONS)]
    return pd.concat([p[0] for p in parts], ignore_index=True), pd.concat([p[1] for p in parts], ignore_index=True)
