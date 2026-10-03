"""Replay a past season with the model and the planner making every decision.

    uv run python -m raptor.backtest.season            # 2025/26, full bot
    uv run python -m raptor.backtest.season --no-chips

Before each deadline, exactly as the live site would:
  1. retrain the model on every earlier season plus this season's finished
     gameweeks, and predict every player's points for the next 4 gameweeks
     (fixture results after the deadline are hidden from the features)
  2. run the transfer planner, with chips, from the bot's real squad, bank,
     free transfers and selling prices
  3. make the first week's moves, then score them with the real points:
     captain (vice if the captain doesn't play), automatic substitutions,
     Bench Boost, Triple Captain, Free Hit, and −4 per hit

GW1's squad is picked from scratch with £100m. Prices come from each week's
data and selling prices follow FPL's rule (half of any rise). There's no
injury news in the history data, so the bot only sees missed matches in the
minutes it can count: it reacts a week or two later than a manager reading
the news would. Results go to jobs/backtest/<season>.json for the report.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from raptor.model.features import FEATURES, build_features
from raptor.model.history import SEASONS, cache_dir, load_history
from raptor.model.train import make_model
from raptor.optimizer.chips import DEFAULT_WINDOWS, THRESHOLDS, ChipCopy, plan_with_chips
from raptor.optimizer.inputs import selling_price
from raptor.optimizer.solve import HIT_COST, MAX_FREE_TRANSFERS, Player, Settings, candidate_pool, solve

OUT_DIR = Path(__file__).resolve().parents[2] / "backtest"
HORIZON = 4
STAT_COLUMNS = ["minutes", "starts", "points", "xg", "xa", "xgc", "bps", "bonus", "ict", "dc"]
# Gameweeks before which FPL topped everyone up to 5 free transfers (2025/26: AFCON).
TOP_UPS = {"2025-26": {16}}
# Chip rules by season. From 2025/26 every chip comes twice (one per half);
# before that only the Wildcard did, and the rest were once a season.
CHIP_WINDOWS = {
    "2024-25": [("wildcard", 2, 19), ("wildcard", 20, 38), ("freehit", 2, 38), ("bboost", 1, 38), ("3xc", 1, 38)],
    "2023-24": [("wildcard", 2, 19), ("wildcard", 20, 38), ("freehit", 2, 38), ("bboost", 1, 38), ("3xc", 1, 38)],
}


@dataclass
class WeekResult:
    gameweek: int
    chip: str | None
    transfers: list[tuple[str, str]]
    hits: int
    free_transfers: int  # before the week's moves
    captain: str
    captain_points: int
    points: int  # after hits
    bench_points: int
    expected: float  # what the plan expected for this week (before hits)
    autosubs: list[tuple[str, str]]
    bank: int
    team_value: int
    chip_gains: dict[str, float] = field(default_factory=dict)  # gain if each unused chip were played this week


class Season:
    """One season's data, indexed for the replay."""

    def __init__(self, season: str):
        self.season = season
        rows, fixtures = load_history([s for s in SEASONS if s <= season])
        self.all_rows, self.all_fixtures = rows, fixtures
        raw = pd.read_csv(cache_dir() / season / "fixtures.csv")
        events = raw.set_index("id")["event"]
        fx = fixtures[fixtures["season"] == season].copy()
        fx["gameweek"] = fx["fixture"].map(events).astype("Int64")
        self.fixtures = fx.dropna(subset=["gameweek"]).astype({"gameweek": int})
        self.rows = rows[rows["season"] == season].copy()
        names = pd.read_csv(cache_dir() / season / "merged_gw.csv", usecols=["element", "name"])
        self.names = names.drop_duplicates("element").set_index("element")["name"].to_dict()
        self.gameweeks = sorted(self.fixtures["gameweek"].unique())
        # Real points and minutes per player per gameweek (doubles summed).
        per_gw = self.rows.groupby(["gameweek", "element"])[["points", "minutes"]].sum()
        self.points = per_gw["points"].to_dict()
        self.minutes = per_gw["minutes"].to_dict()
        print("Building training features…", flush=True)
        self.train_frame = build_features(rows, fixtures)
        self.train_frame = self.train_frame[self.train_frame["points"].notna()].reset_index(drop=True)

    def short(self, element: int) -> str:
        name = self.names.get(element, str(element))
        return name.split()[-1] if " " in name else name

    def registered(self, g: int) -> pd.DataFrame:
        """Players in the game at the GW g deadline: element, team, position, value (latest row)."""
        known = self.rows[self.rows["gameweek"] <= g].sort_values(["gameweek", "kickoff_time"])
        latest = known.groupby("element").tail(1)[["element", "team", "position", "value", "gameweek"]]
        played = self.fixtures[self.fixtures["gameweek"] <= g]
        last_match = pd.concat([played[["team_h", "gameweek"]].rename(columns={"team_h": "team"}),
                                played[["team_a", "gameweek"]].rename(columns={"team_a": "team"})]).groupby("team")["gameweek"].max()
        # Left the league: no row in their club's latest match.
        still_here = latest["gameweek"] >= latest["team"].map(last_match).fillna(0)
        return latest[still_here].drop(columns="gameweek").reset_index(drop=True)

    def predict(self, model, cols: list[str], g: int, gameweeks: list[int], players: pd.DataFrame) -> dict[tuple[int, int], float]:
        history = self.rows[self.rows["gameweek"] < g].drop(columns=["fpl_xp"], errors="ignore")
        upcoming = self.fixtures[self.fixtures["gameweek"].isin(gameweeks)]
        targets = []
        for side, other, home in (("team_h", "team_a", 1), ("team_a", "team_h", 0)):
            m = players.merge(upcoming, left_on="team", right_on=side)
            targets.append(pd.DataFrame({
                "season": self.season, "element": m["element"], "fixture": m["fixture"], "gameweek": m["gameweek"],
                "kickoff_time": m["kickoff_time"], "team": m["team"], "opponent": m[other], "was_home": home,
                "position": m["position"], "value": m["value"],
            }))
        targets = pd.concat(targets, ignore_index=True)
        for c in STAT_COLUMNS:
            targets[c] = np.nan
        rows = pd.concat([history.assign(_target=False), targets.assign(_target=True)], ignore_index=True)
        # Hide results from the deadline on: team form must not see them.
        fixtures = self.fixtures.copy()
        future = fixtures["gameweek"] >= g
        fixtures.loc[future, ["team_h_score", "team_a_score"]] = np.nan
        frame = build_features(rows, fixtures.drop(columns="gameweek"))
        frame = frame[frame["_target"].astype(bool)]
        frame = frame.assign(xp=np.clip(model.predict(frame[cols]), 0, None))
        totals = frame.groupby(["element", "gameweek"])["xp"].sum()
        return {(int(e), int(w)): float(v) for (e, w), v in totals.items()}

    def train(self, g: int):
        df = self.train_frame
        before = (df["season"] < self.season) | ((df["season"] == self.season) & (df["gameweek"] < g))
        cols = [f for f in FEATURES if df.loc[before, f].notna().any()]
        model = make_model(features=cols)
        model.fit(df.loc[before, cols], df.loc[before, "points"])
        return model, cols


def score_week(season: Season, g: int, lineup: list[Player], bench: list[Player], captain: Player, vice: Player | None, chip: str | None):
    """Real points for a team sheet, with FPL's automatic substitutions."""
    pts = lambda p: int(season.points.get((g, p.id), 0))
    played = lambda p: season.minutes.get((g, p.id), 0) > 0
    xi, subs = list(lineup), []
    if chip != "bboost":
        for starter in [p for p in lineup if not played(p)]:
            for sub in bench:
                if sub in xi or not played(sub) or (sub.position == 1) != (starter.position == 1):
                    continue
                trial = [p for p in xi if p != starter] + [sub]
                counts = {pos: sum(p.position == pos for p in trial) for pos in (2, 3, 4)}
                if counts[2] >= 3 and counts[3] >= 2 and counts[4] >= 1:
                    xi, subs = trial, subs + [(starter, sub)]
                    break
    scorers = xi + (bench if chip == "bboost" else [])
    multiplier = 3 if chip == "3xc" else 2
    armband = captain if played(captain) else (vice if vice and played(vice) else None)
    total = sum(pts(p) for p in scorers) + ((multiplier - 1) * pts(armband) if armband else 0)
    bench_points = sum(pts(p) for p in bench if p not in xi) if chip != "bboost" else 0
    return total, bench_points, (armband, pts(armband) * multiplier if armband else 0), subs


def run(season_name: str, use_chips: bool, thresholds: dict[str, float] | None, verbose: bool = True, last_week: int = 38,
        settings: Settings | None = None) -> dict:
    season = Season(season_name)
    settings = settings or Settings(time_limit=20)
    windows = CHIP_WINDOWS.get(season_name, DEFAULT_WINDOWS)
    squad: set[int] = set()
    purchase: dict[int, int] = {}
    bank, ft = 1000, 1
    chips_used: list[tuple[str, int]] = []
    weeks: list[WeekResult] = []
    started = time.time()
    for g in [w for w in season.gameweeks if w <= last_week]:
        model, cols = season.train(g)
        horizon = [w for w in season.gameweeks if w >= g][:HORIZON]
        reg = season.registered(g)
        xp = season.predict(model, cols, g, horizon, reg)
        info = reg.set_index("element")
        # Owned players who left the league still have to be sold: last known price.
        last_seen = season.rows[season.rows["gameweek"] <= g].sort_values("gameweek").groupby("element").tail(1).set_index("element")
        ids = set(info.index) | squad
        players = []
        for e in sorted(ids):
            row = info.loc[e] if e in info.index else last_seen.loc[e]
            price = int(row["value"])
            sell = selling_price(purchase[e], price) if e in squad else price
            players.append(Player(id=int(e), name=season.short(e), team=int(row["team"]), position=int(row["position"]), price=price, sell=sell))
        if g in TOP_UPS.get(season_name, set()):
            ft = MAX_FREE_TRANSFERS
        pool = candidate_pool(players, squad, xp, horizon)

        chip_gains: dict[str, float] = {}
        if not squad:
            plan = solve(pool, squad, xp, horizon, bank, ft, settings, initial=True)
        else:
            available = [] if not use_chips else [
                ChipCopy(name, stop, tuple(w for w in horizon if start <= w <= stop))
                for name, start, stop in windows
                if not any(n == name and start <= e <= stop for n, e in chips_used) and any(start <= w <= stop for w in horizon)
            ]
            result = plan_with_chips(pool, squad, xp, horizon, bank, ft, available, settings, thresholds)
            plan = result.plan
            chip_gains = {o.chip: round(o.by_week.get(g, float("nan")), 2) for o in result.options if g in o.by_week}
        week = plan.weeks[0]
        chip = week.chip
        if chip:
            chips_used.append((chip, g))

        # Make the moves (a Free Hit's are for this week only).
        if chip != "freehit":
            for out in week.sold:
                squad.discard(out.id)
                purchase.pop(out.id, None)
            for new in week.bought:
                squad.add(new.id)
                purchase[new.id] = new.price
            bank = week.bank_after
            assert len(squad) == 15, f"GW{g}: squad of {len(squad)}"
        ordered = sorted(week.lineup, key=lambda p: -xp.get((p.id, g), 0))
        vice = next((p for p in ordered if p != week.captain), None)
        total, bench_points, (armband, cap_points), subs = score_week(season, g, week.lineup, week.bench, week.captain, vice, chip)
        total -= HIT_COST * week.hits
        by_id = {p.id: p for p in players}
        value = bank + sum(by_id[p].sell for p in squad)
        weeks.append(WeekResult(
            gameweek=g, chip=chip, transfers=[(o.name, i.name) for o, i in week.transfers] or [("", i.name) for i in week.bought],
            hits=week.hits,
            free_transfers=ft, captain=(armband or week.captain).name, captain_points=cap_points, points=total,
            bench_points=bench_points, expected=round(week.expected_points, 2), autosubs=[(a.name, b.name) for a, b in subs],
            bank=bank, team_value=value, chip_gains=chip_gains,
        ))
        # Free transfers for next week.
        if not plan.weeks or g == season.gameweeks[0]:
            ft = 1
        elif chip in ("wildcard", "freehit"):
            ft = min(MAX_FREE_TRANSFERS, ft + 1)
        else:
            ft = min(MAX_FREE_TRANSFERS, max(0, ft - (len(week.bought) - week.hits)) + 1)
        if verbose:
            moves = ", ".join(f"{o}→{i}" for o, i in weeks[-1].transfers[:3]) + ("…" if len(week.transfers) > 3 else "")
            print(
                f"GW{g:>2} {total:>3} pts (exp {week.expected_points:5.1f}) total {sum(w.points for w in weeks):>4}"
                f"  {chip or '':8} C {weeks[-1].captain:<12} {moves}"
                f"{f' −{4 * week.hits}' if week.hits else ''}  [{time.time() - started:.0f}s]",
                flush=True,
            )
    return {
        "season": season_name,
        "chips": use_chips,
        "settings": asdict(settings),
        "thresholds": {**THRESHOLDS, **(thresholds or {})},
        "total": sum(w.points for w in weeks),
        "weeks": [asdict(w) for w in weeks],
    }


def _plain(value):
    """numpy numbers -> JSON numbers."""
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    raise TypeError(f"can't save {type(value).__name__}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", default="2025-26")
    parser.add_argument("--no-chips", action="store_true")
    parser.add_argument("--until", type=int, default=38, help="stop after this gameweek (for quick checks)")
    parser.add_argument("--hit-margin", type=float, default=Settings.hit_margin)
    parser.add_argument("--transfer-penalty", type=float, default=Settings.transfer_penalty)
    parser.add_argument("--chip-scale", type=float, default=1.0, help="multiply every chip's bar")
    parser.add_argument("--tag", default="", help="suffix for the results file")
    args = parser.parse_args()
    settings = Settings(time_limit=20, hit_margin=args.hit_margin, transfer_penalty=args.transfer_penalty)
    bars = {chip: bar * args.chip_scale for chip, bar in THRESHOLDS.items()}
    result = run(args.season, use_chips=not args.no_chips, thresholds=bars, last_week=args.until, settings=settings)
    OUT_DIR.mkdir(exist_ok=True)
    name = f"{args.season}{'-no-chips' if args.no_chips else ''}{f'-{args.tag}' if args.tag else ''}.json"
    (OUT_DIR / name).write_text(json.dumps(result, indent=1, default=_plain) + "\n")
    print(f"Total {result['total']} → {OUT_DIR / name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
