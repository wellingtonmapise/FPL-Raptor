"""Train and evaluate the expected-points model.

    uv run python -m raptor.model.train

1. Loads four seasons of history (2022/23 to 2025/26) and builds features.
2. Backtests twice, each time training only on what came before the test weeks:
     A. 2025/26 GW20-38 (the latest rules), against recent form
     B. 2024/25 GW20-38, also against FPL's own expected points (xP), on the
        weeks where the dataset recorded it (it's missing for most of 2025/26)
3. Retrains on all four seasons and saves the model to jobs/model/, with a
   metadata file and a Markdown report of the results.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from scipy.stats import spearmanr
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance

from raptor.model.features import CATEGORICAL, FEATURES, build_features
from raptor.model.history import SEASONS, load_history

MODEL_DIR = Path(__file__).resolve().parents[2] / "model"
MODEL_PATH = MODEL_DIR / "xpts.joblib"
META_PATH = MODEL_DIR / "xpts.json"
REPORT_PATH = MODEL_DIR / "REPORT.md"

TEST_SEASON, TEST_FROM_GW = "2025-26", 20  # backtest A
XP_SEASON, XP_FROM_GW = "2024-25", 20  # backtest B


def make_model(max_iter: int = 600, features: list[str] = FEATURES) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss="squared_error",
        learning_rate=0.05,
        max_iter=max_iter,
        max_leaf_nodes=31,
        min_samples_leaf=40,
        l2_regularization=1.0,
        categorical_features=[features.index(c) for c in CATEGORICAL if c in features],
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=30,
        random_state=0,
    )


def per_gameweek(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    """Fixture rows -> player-gameweek rows (sums over double gameweeks)."""
    agg = {c: "sum" for c in columns}
    agg.update({"points": "sum", "minutes_l6": "first", "fpl_xp": "first"})
    return df.groupby(["season", "gameweek", "element"], as_index=False).agg(agg)


def fpl_forecasts(df: pd.DataFrame, season: str) -> pd.DataFrame:
    """FPL's pre-match xP for each player-gameweek.

    The dataset captures FPL's xP after each gameweek, by which point it
    already reflects that week's results (it correlates far more with the
    same match than any forecast could). The xP recorded at gameweek g-1 is
    FPL's real forecast for gameweek g, so that's what we compare against.
    """
    season_rows = df[df["season"] == season]
    weekly = season_rows.groupby(["gameweek", "element"], as_index=False)["fpl_xp"].first()
    recorded = weekly.groupby("gameweek")["fpl_xp"].apply(lambda x: (x != 0).mean() > 0.3)
    weekly = weekly[weekly["gameweek"].isin(recorded[recorded].index)]
    weekly["gameweek"] = weekly["gameweek"] + 1  # recorded after g-1 -> forecast for g
    return weekly.rename(columns={"fpl_xp": "fpl_forecast"})


def evaluate(gw: pd.DataFrame, columns: dict[str, str]) -> pd.DataFrame:
    """Accuracy and ranking quality for each predictor, on all players and on regulars."""
    out = []
    for subset, frame in (("All players", gw), ("Regulars (45+ min/game lately)", gw[gw["minutes_l6"] >= 45])):
        for label, col in columns.items():
            f = frame.dropna(subset=[col])
            err = f[col] - f["points"]
            rhos, top20, top1 = [], [], []
            for _, week in f.groupby("gameweek"):
                if week[col].nunique() > 1:
                    rhos.append(spearmanr(week[col], week["points"]).statistic)
                ranked = week.sort_values(col, ascending=False)
                top20.append(ranked["points"].head(20).mean())
                top1.append(ranked["points"].iloc[0])
            out.append(
                {
                    "Players": subset,
                    "Predictor": label,
                    "MAE": err.abs().mean(),
                    "RMSE": float(np.sqrt((err**2).mean())),
                    "Rank corr.": float(np.nanmean(rhos)),
                    "Top-20 avg pts": float(np.mean(top20)),
                    "Top pick avg pts": float(np.mean(top1)),
                }
            )
    return pd.DataFrame(out)


def to_markdown(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join(" --- " for _ in cols) + "|"]
    for _, row in df.iterrows():
        cells = [f"{v:.3f}" if isinstance(v, float) else str(v) for v in row]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def backtest(df: pd.DataFrame, season: str, from_gw: int):
    """Train on everything before (season, from_gw), predict the rest of that season."""
    before = (df["season"] < season) | ((df["season"] == season) & (df["gameweek"] < from_gw))
    is_test = (df["season"] == season) & (df["gameweek"] >= from_gw)
    # Leave out stats that didn't exist yet (defensive contributions start in 2025/26).
    cols = [f for f in FEATURES if df.loc[before, f].notna().any()]
    model = make_model(features=cols)
    model.fit(df.loc[before, cols], df.loc[before, "points"])
    test = df[is_test].copy()
    test["model"] = model.predict(test[cols])
    test["form"] = test["points_l6"]
    return model, test, per_gameweek(test, ["model", "form"])


def main() -> int:
    print("Loading history and building features…", flush=True)
    rows, fixtures = load_history()
    df = build_features(rows, fixtures)
    df = df[df["points"].notna()].reset_index(drop=True)

    model, test, gw = backtest(df, TEST_SEASON, TEST_FROM_GW)
    best_iter = model.n_iter_
    results_a = evaluate(gw, {"This model": "model", "Form (last 6)": "form"})
    print(f"Backtest A: {TEST_SEASON} GW{TEST_FROM_GW}-38, {len(test):,} player-fixtures", flush=True)
    print(results_a.to_string(index=False), flush=True)

    _, test_b, gw_b = backtest(df, XP_SEASON, XP_FROM_GW)
    gw_b = gw_b.merge(fpl_forecasts(df, XP_SEASON), on=["gameweek", "element"], how="inner")
    xp_weeks = sorted(gw_b["gameweek"].unique())
    results_b = evaluate(gw_b, {"This model": "model", "Form (last 6)": "form", "FPL's xP": "fpl_forecast"})
    print(f"Backtest B: {XP_SEASON}, {len(xp_weeks)} weeks with FPL's xP", flush=True)
    print(results_b.to_string(index=False), flush=True)

    sample = test.sample(n=min(8000, len(test)), random_state=0)
    imp = permutation_importance(model, sample[FEATURES], sample["points"], n_repeats=3, random_state=0, scoring="neg_mean_absolute_error")
    importance = (
        pd.DataFrame({"Feature": FEATURES, "MAE increase when shuffled": imp.importances_mean})
        .sort_values("MAE increase when shuffled", ascending=False)
        .head(12)
    )

    print("Retraining on all seasons…", flush=True)
    final = make_model(max_iter=max(best_iter, 50))
    final.set_params(early_stopping=False)
    final.fit(df[FEATURES], df["points"])

    version = f"gbm-{date.today().isoformat()}"
    MODEL_DIR.mkdir(exist_ok=True)
    joblib.dump(final, MODEL_PATH, compress=3)
    META_PATH.write_text(
        json.dumps(
            {
                "version": version,
                "features": FEATURES,
                "trained_on": SEASONS,
                "rows": int(len(df)),
                "iterations": int(final.n_iter_),
                "sklearn": sklearn.__version__,
                "backtests": {"A": [TEST_SEASON, TEST_FROM_GW], "B": [XP_SEASON, XP_FROM_GW]},
            },
            indent=2,
        )
        + "\n"
    )

    REPORT_PATH.write_text(
        f"""# Expected-points model: results

Model `{version}`: gradient-boosted trees (scikit-learn `HistGradientBoostingRegressor`) predicting
each player's points per fixture from their recent form, underlying stats (xG, xA, xG conceded,
bonus, BPS, defensive contributions), minutes, price, position, home/away, fixture difficulty and
both teams' recent goals and xG. Double gameweeks sum the fixtures; blanks are zero.

## How it was tested

Two backtests. Each trains only on matches before the test weeks, and every prediction only uses
information available before kickoff. Scores are per player per gameweek.

- **MAE / RMSE**: average error in points (lower is better).
- **Rank corr.**: how well it orders players within a gameweek (Spearman, higher is better).
- **Top-20 avg pts**: actual points of the 20 players it ranked highest each week.
- **Top pick avg pts**: actual points of its single top pick each week, a stand-in for captaincy.

### A. Latest season: {TEST_SEASON} GW{TEST_FROM_GW}-38 ({len(test):,} player-fixtures)

The newest rules (defensive contribution points). Compared with recent form only, because FPL's
xP is missing for most of this season in the dataset.

{to_markdown(results_a)}

### B. Against FPL's own xP: {XP_SEASON}, {len(xp_weeks)} weeks

FPL's expected points as published before each gameweek. The dataset records xP *after* each
gameweek, when it already reflects that week's results: it correlates about 0.57 with points in
the same match but only 0.20 with the next, the level of a genuine forecast. So the xP recorded
after gameweek g-1 is used as FPL's forecast for gameweek g. Weeks without a recorded xP are left
out, and every predictor is scored on the same player-gameweeks.

{to_markdown(results_b)}

## What it relies on most

Shuffling a feature and measuring how much worse the predictions get (on the test weeks):

{to_markdown(importance)}

## Limits

- Within-season history only: a player's first weeks of a season lean on price, position and
  fixtures. Player ids change every season, so form doesn't carry over yet.
- Injuries aren't in the history data. Live predictions are scaled by FPL's chance of playing
  (fully for next gameweek, fading over the following three).
- FPL's xP already accounts for injury news, which the model doesn't see in these backtests, yet
  the model still orders players better.
- "Top pick" rests on one player a week over 16-19 weeks, so it swings a lot; the top-20 figure is
  the steadier measure of picking good players.

The final model is retrained on all four seasons ({len(df):,} player-fixtures).
Regenerate with `uv run python -m raptor.model.train`.
"""
    )
    print(f"Saved {MODEL_PATH.name} ({MODEL_PATH.stat().st_size / 1024:.0f} KB), {META_PATH.name}, {REPORT_PATH.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
