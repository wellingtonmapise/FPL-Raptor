"""Turn season replays into jobs/backtest/REPORT.md.

    uv run python -m raptor.backtest.report

Reads the replays in jobs/backtest/ (written by raptor.backtest.season), last
season's mini-league results and a sample of (points, overall rank) pairs
(both from raptor.backtest.actuals), and writes the report.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "backtest"


def estimate_rank(points: int, curve: list[tuple[int, int]]) -> int:
    """Overall rank for a season total, interpolating log(rank) between sampled managers."""
    pairs = sorted(curve, key=lambda p: -p[0])  # best first
    if points >= pairs[0][0]:
        return pairs[0][1]
    if points <= pairs[-1][0]:
        return pairs[-1][1]
    for (hi_pts, hi_rank), (lo_pts, lo_rank) in zip(pairs, pairs[1:]):
        if lo_pts <= points <= hi_pts:
            if hi_pts == lo_pts:
                return hi_rank
            t = (hi_pts - points) / (hi_pts - lo_pts)
            return round(math.exp(math.log(hi_rank) + t * (math.log(lo_rank) - math.log(hi_rank))))
    raise ValueError(points)


def summarise(run: dict) -> dict:
    weeks = run["weeks"]
    return {
        "total": run["total"],
        "hits": sum(w["hits"] for w in weeks),
        "transfers": sum(len(w["transfers"]) for w in weeks[1:]),
        "captain": sum(w["captain_points"] for w in weeks),
        "bench": sum(w["bench_points"] for w in weeks),
        "expected": sum(w["expected"] for w in weeks),
        "before_hits": sum(w["points"] + 4 * w["hits"] for w in weeks),
        "chips": [(w["gameweek"], w["chip"], w["points"]) for w in weeks if w["chip"]],
        "best": max(weeks, key=lambda w: w["points"]),
        "worst": min(weeks, key=lambda w: w["points"]),
    }


CHIP_LABELS = {"wildcard": "Wildcard", "freehit": "Free Hit", "bboost": "Bench Boost", "3xc": "Triple Captain"}


def describe(run: dict) -> str:
    s = run["settings"]
    bars = run["thresholds"]
    chips = "no chips" if not run["chips"] else "chip bars " + "/".join(f"{bars[c]:g}" for c in ("wildcard", "freehit", "bboost", "3xc"))
    return f"transfer penalty {s['transfer_penalty']:g}, hit margin {s['hit_margin']:g}, {chips}"


def build(tuning: dict[str, dict], tests: dict[str, dict], chosen: str, curve: list[tuple[int, int]], league: dict) -> str:
    final = tests[chosen]
    fs = summarise(final)
    rank = estimate_rank(final["total"], curve)
    you = next(m for m in league["managers"] if m["you"])
    place = 1 + sum(1 for m in league["managers"] if m["points"] > final["total"])
    first = tests.get("first")
    lines = [
        "# Season backtest: the model and planner against a real season",
        "",
        "A bot replays 2025/26 week by week. Before every deadline it retrains the model on everything",
        "before that week, predicts the next four gameweeks, runs the transfer planner and chip planner",
        "from its real squad, bank and free transfers, and makes the first week's moves. Each week is",
        "scored with the real points, with automatic subs, captaincy (vice if the captain didn't play),",
        "chips and −4 per hit. GW1's squad is picked from scratch with £100m.",
        "",
        "## Headline",
        "",
        "| | 2025/26 points | Overall rank |",
        "| --- | ---: | ---: |",
        f"| You (JP Morgan) | {you['points']:,} | {you['rank']:,} |",
        f"| Bot, tuned settings | {final['total']:,} | ~{rank:,} |",
    ]
    if first:
        lines.append(f"| Bot, first settings | {first['total']:,} | ~{estimate_rank(first['total'], curve):,} |")
    lines += [
        "",
        f"You beat the bot by **{you['points'] - final['total']} points**. In {league['league']} last season it would have "
        f"finished {ordinal(place)} of {len(league['managers']) + 1}.",
        "",
        f"The bot's ranks are estimated from {len(curve)} real managers' 2025/26 totals and ranks (interpolated on a",
        "log scale).",
        "",
        "## Where the points went (tuned bot, 2025/26)",
        "",
        f"- Expected {fs['expected']:,.0f} before hits, scored {fs['before_hits']:,}: the model is optimistic about the",
        f"  players it picks by about {100 * (1 - fs['before_hits'] / fs['expected']):.0f}% (it picks whoever it rates highest,",
        "  so its errors lean upwards)",
        f"- {fs['transfers']} transfers and {fs['hits']} hits (−{4 * fs['hits']})",
        f"- Captains: {fs['captain']:,} points; bench left {fs['bench']:,} points unused",
        "- Chips: " + ", ".join(f"{CHIP_LABELS[c]} GW{g} ({p})" for g, c, p in fs["chips"]),
        f"- Best week GW{fs['best']['gameweek']} ({fs['best']['points']}), worst GW{fs['worst']['gameweek']} ({fs['worst']['points']})",
        "",
        "## Tuning (on 2024/25, so 2025/26 stays a fair test)",
        "",
        "The first settings took too many hits and played chips as soon as they looked good. Settings were",
        "chosen on a replay of 2024/25 (model trained on 2022/23 and 2023/24 first), then checked once on",
        "2025/26.",
        "",
        "| Settings | 2024/25 total | Hits | Chips |",
        "| --- | ---: | ---: | --- |",
    ]
    for tag, run in tuning.items():
        s = summarise(run)
        marker = " **(chosen)**" if run["settings"] == final["settings"] and run["thresholds"] == final["thresholds"] and run["chips"] == final["chips"] else ""
        chips = ", ".join(f"{CHIP_LABELS[c]} {g}" for g, c, _ in s["chips"]) or "none"
        lines.append(f"| {describe(run)}{marker} | {s['total']:,} | {s['hits']} | {chips} |")
    lines += [
        "",
        "Transfer penalty: points a transfer must gain on top of its cost. Hit margin: extra points a paid",
        "transfer must gain beyond its 4. Chip bars: the gain (expected points over the plan) a chip must",
        "beat to be played before it expires.",
        "",
        "## Limits",
        "",
        "- No injury news: the history data has no flags, so the bot only notices injuries once a player",
        "  misses matches. The live planner uses FPL's chance of playing, so it should do a little better.",
        "- GW1 is picked on prices and fixtures alone (no form yet), which is why the bot wildcards early.",
        "- One season is a small sample: a single Triple Captain haul can swing a total by 20+ points.",
        "- History from the public vaastav/Fantasy-Premier-League dataset; ranks from FPL's public data.",
        "",
        "Rebuild: `uv run python -m raptor.backtest.season --season 2025-26 --tag tuned` (about 10",
        "minutes; the defaults are the tuned settings), then `uv run python -m raptor.backtest.report`.",
        "",
    ]
    return "\n".join(lines)


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def main() -> int:
    load = lambda name: json.loads((OUT_DIR / name).read_text())
    tuning = {p.stem.removeprefix("2024-25-"): json.loads(p.read_text()) for p in sorted(OUT_DIR.glob("2024-25-*.json"))}
    tests = {"first": load("2025-26-first.json")} if (OUT_DIR / "2025-26-first.json").exists() else {}
    tests["tuned"] = load("2025-26-tuned.json")
    curve = [tuple(p) for p in load("rank-curve-2025-26.json")]
    report = build(tuning, tests, "tuned", curve, load("league-2025-26.json"))
    (OUT_DIR / "REPORT.md").write_text(report)
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
