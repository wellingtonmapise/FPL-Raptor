"""Features for the expected-points model, shared by training and live prediction.

Both paths build the same two tables and call the same functions, so a feature
means exactly the same thing in training as it does on the live site:

  rows      one row per player per fixture, in kickoff order:
            season, element, fixture, gameweek, kickoff_time, team, opponent, was_home,
            position (1-4), value, minutes, starts, points, xg, xa, xgc, bps,
            bonus, ict, dc (defensive contributions; NaN before 2025/26)
  fixtures  one row per fixture: season, fixture, kickoff_time, team_h, team_a,
            team_h_score, team_a_score, team_h_difficulty, team_a_difficulty

Every history feature is computed from *earlier* fixtures only (shifted), so a
row never sees its own result. To predict upcoming fixtures, append them as
rows with no results: they pick up features from everything before them.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Seasons from 2025/26 on award defensive contribution points.
DC_REGIME_FROM = "2025-26"

HISTORY_STATS = ["points", "minutes", "starts", "xg", "xa", "xgc", "bps", "bonus", "ict", "dc"]
WINDOWS = (3, 6)

FEATURES = [
    "position",
    "value",
    "was_home",
    "difficulty",
    "dc_regime",
    "games_so_far",
    "season_points_per_game",
    "season_minutes_per_game",
    *[f"{stat}_l{w}" for stat in HISTORY_STATS for w in WINDOWS],
    "team_gf_l6",
    "team_ga_l6",
    "opp_gf_l6",
    "opp_ga_l6",
    "team_xg_l6",
    "team_xga_l6",
    "opp_xg_l6",
    "opp_xga_l6",
]
CATEGORICAL = ["position"]


def add_history_features(rows: pd.DataFrame) -> pd.DataFrame:
    """Rolling and season-to-date form for each player, from earlier fixtures only."""
    df = rows.sort_values(["season", "element", "kickoff_time", "fixture"]).reset_index(drop=True)
    keys = [df["season"], df["element"]]
    grouped = df.groupby(["season", "element"], sort=False)
    # Rows with a result. Upcoming fixtures (no result) are skipped by the
    # windows, so every upcoming fixture sees form as of the last match played.
    has_result = df["points"].notna()
    played_rows = df[has_result]
    played_keys = [played_rows["season"], played_rows["element"]]
    for stat in HISTORY_STATS:
        for w in WINDOWS:
            through = (
                played_rows[stat].groupby(played_keys, sort=False).rolling(w, min_periods=1).mean()
                .reset_index(level=[0, 1], drop=True)
            )  # form including each played match
            window = pd.Series(np.nan, index=df.index)
            window.loc[through.index] = through
            # Each row takes the window as of the previous played match.
            previous = window.groupby(keys, sort=False).shift(1)
            filled = previous.groupby(keys, sort=False).ffill()
            df[f"{stat}_l{w}"] = previous.where(has_result, filled)
    df["games_so_far"] = grouped["points"].transform(lambda s: s.notna().cumsum().shift(1).fillna(0))
    for stat, name in (("points", "season_points_per_game"), ("minutes", "season_minutes_per_game")):
        cumulative = df[stat].fillna(0).groupby([df["season"], df["element"]], sort=False).cumsum()
        before = cumulative.groupby([df["season"], df["element"]], sort=False).shift(1)
        df[name] = before / df["games_so_far"].replace(0, np.nan)
    df["dc_regime"] = (df["season"] >= DC_REGIME_FROM).astype(int)
    return df


def team_form(fixtures: pd.DataFrame) -> pd.DataFrame:
    """Each team's goals for/against over its last 6 finished matches, as of each finished match."""
    done = fixtures.dropna(subset=["team_h_score", "team_a_score"])
    long = pd.concat(
        [
            pd.DataFrame({"season": done["season"], "team": done["team_h"], "kickoff_time": done["kickoff_time"],
                          "gf": done["team_h_score"], "ga": done["team_a_score"]}),
            pd.DataFrame({"season": done["season"], "team": done["team_a"], "kickoff_time": done["kickoff_time"],
                          "gf": done["team_a_score"], "ga": done["team_h_score"]}),
        ]
    ).sort_values(["season", "team", "kickoff_time"]).reset_index(drop=True)
    g = long.groupby(["season", "team"], sort=False)
    long["gf_l6"] = g["gf"].transform(lambda s: s.rolling(6, min_periods=1).mean())
    long["ga_l6"] = g["ga"].transform(lambda s: s.rolling(6, min_periods=1).mean())
    return long[["season", "team", "kickoff_time", "gf_l6", "ga_l6"]]


def _form_before(keys: pd.DataFrame, form: pd.DataFrame, team_col: str, prefix: str) -> pd.DataFrame:
    """Attach the team's form from its latest finished match strictly before kickoff."""
    left = keys[["_i", "season", team_col, "kickoff_time"]].rename(columns={team_col: "team"}).sort_values("kickoff_time")
    right = form.sort_values("kickoff_time")
    merged = pd.merge_asof(
        left, right, on="kickoff_time", by=["season", "team"], allow_exact_matches=False, direction="backward"
    )
    return merged.set_index("_i")[["gf_l6", "ga_l6"]].add_prefix(prefix)


def add_fixture_features(df: pd.DataFrame, fixtures: pd.DataFrame) -> pd.DataFrame:
    """Difficulty and both teams' recent goals for each row's fixture."""
    fx = fixtures[["season", "fixture", "team_h_difficulty", "team_a_difficulty"]]
    out = df.merge(fx, on=["season", "fixture"], how="left")
    out["difficulty"] = np.where(out["was_home"] == 1, out["team_h_difficulty"], out["team_a_difficulty"])
    out = out.drop(columns=["team_h_difficulty", "team_a_difficulty"])
    out["_i"] = np.arange(len(out))
    out["kickoff_time"] = pd.to_datetime(out["kickoff_time"], utc=True)
    form = team_form(fixtures.assign(kickoff_time=pd.to_datetime(fixtures["kickoff_time"], utc=True)))
    own = _form_before(out, form, "team", "team_")
    opp = _form_before(out, form, "opponent", "opp_")
    out = out.join(own, on="_i").join(opp, on="_i").drop(columns="_i")
    return out


def team_xg_form(rows: pd.DataFrame) -> pd.DataFrame:
    """Each team's expected goals for/against over its last 6 played gameweeks.

    Built from player rows: a team's xG is the sum of its players' xG; its xG
    against is the largest xG-conceded figure among its players (whoever was
    on the pitch longest, usually the keeper). Gameweek level, so double
    gameweeks count as one.
    """
    played = rows[rows["points"].notna()]
    per_gw = played.groupby(["season", "team", "gameweek"], as_index=False).agg(xg=("xg", "sum"), xga=("xgc", "max"))
    per_gw = per_gw.sort_values(["season", "team", "gameweek"]).reset_index(drop=True)
    g = per_gw.groupby(["season", "team"], sort=False)
    per_gw["xg_l6"] = g["xg"].transform(lambda s: s.rolling(6, min_periods=1).mean())
    per_gw["xga_l6"] = g["xga"].transform(lambda s: s.rolling(6, min_periods=1).mean())
    return per_gw[["season", "team", "gameweek", "xg_l6", "xga_l6"]]


def add_team_xg_features(df: pd.DataFrame, rows: pd.DataFrame) -> pd.DataFrame:
    """Own and opponent xG form from gameweeks strictly before the row's gameweek."""
    form = team_xg_form(rows).rename(columns={"gameweek": "gw_key"})
    form["gw_key"] = form["gw_key"].astype(float)
    out = df.copy()
    out["_i"] = np.arange(len(out))
    out["gw_key"] = out["gameweek"].astype(float)
    for team_col, prefix in (("team", "team_"), ("opponent", "opp_")):
        left = out[["_i", "season", team_col, "gw_key"]].rename(columns={team_col: "team"}).sort_values("gw_key")
        merged = pd.merge_asof(
            left, form.sort_values("gw_key"), on="gw_key", by=["season", "team"],
            allow_exact_matches=False, direction="backward",
        ).set_index("_i")
        out[f"{prefix}xg_l6"] = merged["xg_l6"].reindex(out["_i"]).to_numpy()
        out[f"{prefix}xga_l6"] = merged["xga_l6"].reindex(out["_i"]).to_numpy()
    return out.drop(columns=["_i", "gw_key"])


def build_features(rows: pd.DataFrame, fixtures: pd.DataFrame) -> pd.DataFrame:
    """rows + fixtures -> one row per player-fixture with every FEATURES column."""
    df = add_history_features(rows)
    df = add_fixture_features(df, fixtures)
    df = add_team_xg_features(df, rows)
    df["position"] = df["position"].astype(int)
    df["was_home"] = df["was_home"].astype(int)
    return df


def availability_factor(status: str, chance: float | None, horizon: int) -> float:
    """Scale a prediction by FPL's availability flag.

    FPL's chance of playing is for the next gameweek, so it applies in full at
    horizon 1 and fades out over the following three gameweeks (a heuristic:
    flagged players usually return, but nobody knows exactly when).
    """
    if chance is None:
        p = 0.0 if status in {"i", "s", "u", "n"} else 1.0
    else:
        p = max(0.0, min(1.0, chance / 100))
    if status == "n" or status == "u":  # left the club or long-term unavailable
        return p
    recovery = min(1.0, (horizon - 1) / 3)
    return p + (1 - p) * recovery
