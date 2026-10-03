# Season backtest: the model and planner against a real season

A bot replays 2025/26 week by week. Before every deadline it retrains the model on everything
before that week, predicts the next four gameweeks, runs the transfer planner and chip planner
from its real squad, bank and free transfers, and makes the first week's moves. Each week is
scored with the real points, with automatic subs, captaincy (vice if the captain didn't play),
chips and −4 per hit. GW1's squad is picked from scratch with £100m.

## Headline

| | 2025/26 points | Overall rank |
| --- | ---: | ---: |
| You (JP Morgan) | 2,264 | 360,298 |
| Bot, tuned settings | 2,107 | ~2,153,866 |
| Bot, first settings | 1,993 | ~4,179,960 |

You beat the bot by **157 points**. In BiG ReD last season it would have finished 6th of 16.

The bot's ranks are estimated from 190 real managers' 2025/26 totals and ranks (interpolated on a
log scale).

## Where the points went (tuned bot, 2025/26)

- Expected 2,276 before hits, scored 2,135: the model is optimistic about the
  players it picks by about 6% (it picks whoever it rates highest,
  so its errors lean upwards)
- 88 transfers and 7 hits (−28)
- Captains: 470 points; bench left 286 points unused
- Chips: Wildcard GW2 (34), Free Hit GW17 (67), Bench Boost GW18 (45), Triple Captain GW19 (42), Wildcard GW20 (50), Free Hit GW26 (65), Triple Captain GW36 (124), Bench Boost GW38 (54)
- Best week GW36 (124), worst GW22 (26)

## Tuning (on 2024/25, so 2025/26 stays a fair test)

The first settings took too many hits and played chips as soon as they looked good. Settings were
chosen on a replay of 2024/25 (model trained on 2022/23 and 2023/24 first), then checked once on
2025/26.

| Settings | 2024/25 total | Hits | Chips |
| --- | ---: | ---: | --- |
| transfer penalty 0.1, hit margin 0, chip bars 12/10/10/9 | 2,024 | 33 | Wildcard 2, Free Hit 5, Triple Captain 7, Wildcard 20, Bench Boost 25 |
| transfer penalty 1, hit margin 2, no chips | 2,115 | 10 | none |
| transfer penalty 1, hit margin 2, chip bars 12/10/10/9 | 2,095 | 10 | Wildcard 2, Free Hit 3, Triple Captain 7, Wildcard 20, Bench Boost 24 |
| transfer penalty 1.5, hit margin 4, chip bars 12/10/10/9 | 2,063 | 4 | Wildcard 2, Free Hit 5, Triple Captain 7, Wildcard 21, Bench Boost 38 |
| transfer penalty 1, hit margin 2, chip bars 18/15/15/13.5 **(chosen)** | 2,204 | 6 | Wildcard 2, Wildcard 20, Free Hit 23, Triple Captain 25, Bench Boost 38 |
| transfer penalty 1, hit margin 2, chip bars 30/25/25/22.5 | 2,171 | 6 | Wildcard 2, Wildcard 22, Free Hit 33, Bench Boost 35, Triple Captain 38 |

Transfer penalty: points a transfer must gain on top of its cost. Hit margin: extra points a paid
transfer must gain beyond its 4. Chip bars: the gain (expected points over the plan) a chip must
beat to be played before it expires.

## Limits

- No injury news: the history data has no flags, so the bot only notices injuries once a player
  misses matches. The live planner uses FPL's chance of playing, so it should do a little better.
- GW1 is picked on prices and fixtures alone (no form yet), which is why the bot wildcards early.
- One season is a small sample: a single Triple Captain haul can swing a total by 20+ points.
- History from the public vaastav/Fantasy-Premier-League dataset; ranks from FPL's public data.

Rebuild: `uv run python -m raptor.backtest.season --season 2025-26 --tag tuned` (about 10
minutes; the defaults are the tuned settings), then `uv run python -m raptor.backtest.report`.
