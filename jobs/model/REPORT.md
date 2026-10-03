# Expected-points model: results

Model `gbm-2026-10-03`: gradient-boosted trees (scikit-learn `HistGradientBoostingRegressor`) predicting
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

### A. Latest season: 2025-26 GW20-38 (15,572 player-fixtures)

The newest rules (defensive contribution points). Compared with recent form only, because FPL's
xP is missing for most of this season in the dataset.

| Players | Predictor | MAE | RMSE | Rank corr. | Top-20 avg pts | Top pick avg pts |
| --- | --- | --- | --- | --- | --- | --- |
| All players | This model | 0.952 | 1.872 | 0.714 | 4.534 | 7.421 |
| All players | Form (last 6) | 1.013 | 2.036 | 0.714 | 4.092 | 5.474 |
| Regulars (45+ min/game lately) | This model | 2.223 | 2.968 | 0.364 | 4.555 | 7.421 |
| Regulars (45+ min/game lately) | Form (last 6) | 2.518 | 3.247 | 0.209 | 4.063 | 5.474 |

### B. Against FPL's own xP: 2024-25, 16 weeks

FPL's expected points as published before each gameweek. The dataset records xP *after* each
gameweek, when it already reflects that week's results: it correlates about 0.57 with points in
the same match but only 0.20 with the next, the level of a genuine forecast. So the xP recorded
after gameweek g-1 is used as FPL's forecast for gameweek g. Weeks without a recorded xP are left
out, and every predictor is scored on the same player-gameweeks.

| Players | Predictor | MAE | RMSE | Rank corr. | Top-20 avg pts | Top pick avg pts |
| --- | --- | --- | --- | --- | --- | --- |
| All players | This model | 0.966 | 1.915 | 0.705 | 4.831 | 5.500 |
| All players | Form (last 6) | 1.000 | 2.023 | 0.704 | 4.422 | 8.438 |
| All players | FPL's xP | 1.090 | 2.130 | 0.639 | 4.241 | 6.375 |
| Regulars (45+ min/game lately) | This model | 2.122 | 3.013 | 0.366 | 4.816 | 5.500 |
| Regulars (45+ min/game lately) | Form (last 6) | 2.333 | 3.183 | 0.289 | 4.428 | 8.438 |
| Regulars (45+ min/game lately) | FPL's xP | 2.387 | 3.350 | 0.319 | 4.219 | 6.375 |

## What it relies on most

Shuffling a feature and measuring how much worse the predictions get (on the test weeks):

| Feature | MAE increase when shuffled |
| --- | --- |
| minutes_l3 | 0.263 |
| ict_l3 | 0.049 |
| dc_l6 | 0.042 |
| dc_l3 | 0.040 |
| points_l3 | 0.038 |
| season_points_per_game | 0.027 |
| minutes_l6 | 0.019 |
| xg_l3 | 0.014 |
| ict_l6 | 0.012 |
| bps_l6 | 0.011 |
| difficulty | 0.009 |
| xgc_l6 | 0.006 |

## Limits

- Within-season history only: a player's first weeks of a season lean on price, position and
  fixtures. Player ids change every season, so form doesn't carry over yet.
- Injuries aren't in the history data. Live predictions are scaled by FPL's chance of playing
  (fully for next gameweek, fading over the following three).
- FPL's xP already accounts for injury news, which the model doesn't see in these backtests, yet
  the model still orders players better.
- "Top pick" rests on one player a week over 16-19 weeks, so it swings a lot; the top-20 figure is
  the steadier measure of picking good players.

The final model is retrained on all four seasons (113,260 player-fixtures).
Regenerate with `uv run python -m raptor.model.train`.
