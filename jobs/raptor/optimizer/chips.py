"""The chip planner: which chips you still have, and when to play them.

FPL gives every manager each chip once per half-season (bootstrap-static's
`chips` lists the windows, e.g. GW1-19 and GW20-38; Wildcard and Free Hit
can't be played in GW1), at most one chip a week, and unused chips expire at
the end of their window.

For every chip you still have, the planner re-solves the transfer plan with
the chip played in each week of the horizon, and compares it with the plan
without chips. A chip is worth playing when its gain clears a bar: roughly
what a good week for that chip is worth over a season (see THRESHOLDS),
because playing it on an ordinary week wastes it. When a chip's window ends
inside the horizon, the bar drops to zero: better used than lost.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from raptor.optimizer.solve import CHIP_LABELS, CHIPS, Plan, Player, Settings, solve

# Gain over the no-chip plan (expected points over the horizon) that a chip
# must beat to be played before it's about to expire. Tuned on a replay of
# 2024/25 and checked on 2025/26 (jobs/backtest/REPORT.md): lower bars spent
# chips on ordinary early weeks; these keep them for doubles and big swings.
THRESHOLDS = {"wildcard": 18.0, "freehit": 15.0, "bboost": 15.0, "3xc": 13.5}

# Used when bootstrap-static doesn't list chip windows.
DEFAULT_WINDOWS = [
    ("wildcard", 2, 19), ("freehit", 2, 19), ("bboost", 1, 19), ("3xc", 1, 19),
    ("wildcard", 20, 38), ("freehit", 20, 38), ("bboost", 20, 38), ("3xc", 20, 38),
]


@dataclass
class ChipOption:
    chip: str
    best_week: int | None  # best week in the horizon (None: can't be played in it)
    gain: float  # at the best week, vs the plan without chips
    by_week: dict[int, float]  # gain if played in each week
    expires: int  # last gameweek of the chip's current window
    advice: str = "save"  # "play" this week, "later" (pencilled in for best_week), or "save"

    @property
    def label(self) -> str:
        return CHIP_LABELS[self.chip]


@dataclass
class ChipPlan:
    plan: Plan  # the transfer plan with the chosen chips played
    options: list[ChipOption] = field(default_factory=list)
    base: Plan | None = None  # the plan without chips

    @property
    def chips(self) -> dict[int, str]:
        return {w.gameweek: w.chip for w in self.plan.weeks if w.chip}


def chip_windows(bootstrap: dict) -> list[tuple[str, int, int]]:
    listed = bootstrap.get("chips") or []
    windows = [(c["name"], int(c["start_event"]), int(c["stop_event"])) for c in listed if c.get("name") in CHIPS]
    return windows or list(DEFAULT_WINDOWS)


@dataclass(frozen=True)
class ChipCopy:
    """One unused chip: its window's last gameweek and the planned weeks it fits in."""

    chip: str
    expires: int
    weeks: tuple[int, ...]


def available_chips(history: dict, windows: list[tuple[str, int, int]], gameweeks: list[int]) -> list[ChipCopy]:
    """Unused chips that can be played somewhere in `gameweeks`.

    A chip played in a window uses that window's copy. `history` is
    entry/{id}/history/ (its `chips` list has name and event).
    """
    used = [(c["name"], int(c["event"])) for c in history.get("chips", []) if c.get("event")]
    out = []
    for name, start, stop in windows:
        if any(n == name and start <= e <= stop for n, e in used):
            continue
        weeks = tuple(g for g in gameweeks if start <= g <= stop)
        if weeks:
            out.append(ChipCopy(name, stop, weeks))
    return out


def plan_with_chips(
    players: list[Player],
    squad: set[int],
    xp: dict[tuple[int, int], float],
    gameweeks: list[int],
    bank: int,
    free_transfers: int,
    available: list[ChipCopy],
    settings: Settings | None = None,
    thresholds: dict[str, float] | None = None,
    base: Plan | None = None,
) -> ChipPlan:
    """The transfer plan with chips placed where they clear their bar."""
    bars = {**THRESHOLDS, **(thresholds or {})}
    base = base or solve(players, squad, xp, gameweeks, bank, free_transfers, settings)
    options: list[ChipOption] = []
    for copy in sorted(available, key=lambda c: (CHIPS.index(c.chip), c.expires)):
        by_week = {}
        for g in copy.weeks:
            trial = solve(players, squad, xp, gameweeks, bank, free_transfers, settings, chips={g: copy.chip}, baseline=False)
            by_week[g] = trial.expected_points - base.expected_points
        best = max(by_week, key=lambda g: by_week[g])
        option = ChipOption(chip=copy.chip, best_week=best, gain=by_week[best], by_week=by_week, expires=copy.expires)
        if by_week[best] > _bar(option, bars, gameweeks):
            option.advice = "play" if best == gameweeks[0] else "later"
        options.append(option)

    chosen = _assign_weeks([o for o in options if o.advice != "save"], bars, gameweeks)
    for option in options:
        week = next((g for g, o in chosen.items() if o is option), None)
        if week is None:
            option.advice = "save"
        else:
            option.best_week, option.gain = week, option.by_week[week]
            option.advice = "play" if week == gameweeks[0] else "later"
    chosen = {g: o.chip for g, o in chosen.items()}

    if not chosen:
        return ChipPlan(plan=base, options=options, base=base)
    plan = solve(players, squad, xp, gameweeks, bank, free_transfers, settings, chips=chosen, baseline=False)
    if plan.expected_points < base.expected_points:  # chips that only pay off together can disappoint; keep it simple
        for option in options:
            option.advice = "save"
        return ChipPlan(plan=base, options=options, base=base)
    plan.baseline_points = base.baseline_points
    return ChipPlan(plan=plan, options=options, base=base)


def _bar(option: ChipOption, bars: dict[str, float], gameweeks: list[int]) -> float:
    """The gain a chip must beat: its usual bar, or nothing once it's about to expire."""
    return -1.0 if option.expires <= gameweeks[-1] else bars[option.chip]


def _assign_weeks(options: list[ChipOption], bars: dict[str, float], gameweeks: list[int]) -> dict[int, ChipOption]:
    """One chip a week, placed to maximise the total gain (each only where it clears its bar).

    At most 8 chips over a few weeks, so trying every placement is instant.
    """
    best: tuple[float, dict[int, ChipOption]] = (0.0, {})

    def search(i: int, taken: dict[int, ChipOption], total: float) -> None:
        nonlocal best
        if i == len(options):
            if total > best[0] + 1e-9:
                best = (total, dict(taken))
            return
        option = options[i]
        bar = _bar(option, bars, gameweeks)
        for g, gain in option.by_week.items():
            if g not in taken and gain > bar:
                taken[g] = option
                search(i + 1, taken, total + gain)
                del taken[g]
        search(i + 1, taken, total)

    search(0, {}, 0.0)
    return best[1]
