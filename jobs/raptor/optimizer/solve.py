"""The transfer optimizer: an integer program over the next few gameweeks.

Decides, for each upcoming gameweek, who to transfer in and out, who starts
and who captains, to maximise expected points (from the model) minus −4 hits.

Rules it respects:
  * squad of 2 GK, 5 DEF, 5 MID, 3 FWD, at most 3 per club
  * a valid starting XI (1 GK, at least 3 DEF, 2 MID, 1 FWD) and one captain
  * money in the bank never goes negative; players sell at your selling price
  * free transfers: one more each week, banked up to 5; extra transfers cost 4

Chips can be fixed to weeks (`chips={gameweek: name}`, FPL's names):
  * wildcard  unlimited free transfers that week; banked free transfers are kept
  * freehit   a one-week squad (same budget and rules), then your squad returns
  * bboost    the bench scores too
  * 3xc       the captain scores triple
Which weeks to try them in is decided in chips.py.

Later gameweeks count a little less (predictions get less certain) and the
bench counts a little (cover for injuries), so the plan leans towards moves
that pay off soon and squads with playable subs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pulp

POSITION_COUNTS = {1: 2, 2: 5, 3: 5, 4: 3}
LINEUP_MIN = {1: 1, 2: 3, 3: 2, 4: 1}  # GK is exactly 1, see below
MAX_PER_CLUB = 3
MAX_FREE_TRANSFERS = 5
HIT_COST = 4
CHIPS = ("wildcard", "freehit", "bboost", "3xc")
CHIP_LABELS = {"wildcard": "Wildcard", "freehit": "Free Hit", "bboost": "Bench Boost", "3xc": "Triple Captain"}


@dataclass(frozen=True)
class Player:
    id: int
    name: str
    team: int
    position: int  # 1 GK, 2 DEF, 3 MID, 4 FWD
    price: int  # buying price, tenths of a million
    sell: int  # your selling price if you own them; otherwise the buying price


@dataclass
class Settings:
    discount: float = 0.85  # weight of each later gameweek relative to the one before
    bench_weight: float = 0.1  # value of a bench player's expected points
    transfer_penalty: float = 0.1  # tiny cost per transfer so equal swaps aren't suggested
    time_limit: int = 30  # seconds per solve


@dataclass
class Week:
    gameweek: int
    transfers: list[tuple[Player, Player]]  # (out, in)
    free_transfers: int  # available before this week's transfers
    hits: int  # paid transfers
    captain: Player
    lineup: list[Player]
    bench: list[Player]
    expected_points: float  # lineup + captain (and bench/triple captain with chips), before hits
    bank_after: int
    chip: str | None = None


@dataclass
class Plan:
    weeks: list[Week]
    expected_points: float  # over the horizon, after hits
    baseline_points: float  # same squad, no transfers, best XI and captain each week
    status: str = "Optimal"
    notes: list[str] = field(default_factory=list)

    @property
    def gain(self) -> float:
        return self.expected_points - self.baseline_points


def candidate_pool(players: list[Player], squad: set[int], xp: dict[tuple[int, int], float], gameweeks: list[int],
                   per_position: dict[int, int] | None = None) -> list[Player]:
    """Your squad plus the best players per position over the horizon (keeps the model small)."""
    per_position = per_position or {1: 6, 2: 18, 3: 18, 4: 10}
    total = {p.id: sum(xp.get((p.id, g), 0.0) for g in gameweeks) for p in players}
    chosen = {p.id for p in players if p.id in squad}
    for pos, k in per_position.items():
        best = sorted((p for p in players if p.position == pos and total[p.id] > 0), key=lambda p: -total[p.id])[:k]
        chosen.update(p.id for p in best)
    return [p for p in players if p.id in chosen]


def solve(
    players: list[Player],
    squad: set[int],
    xp: dict[tuple[int, int], float],
    gameweeks: list[int],
    bank: int,
    free_transfers: int,
    settings: Settings | None = None,
    allow_transfers: bool = True,
    chips: dict[int, str] | None = None,
    baseline: bool = True,
    initial: bool = False,
) -> Plan:
    """Best plan over `gameweeks`.

    chips: chip to play in a given week (see module docstring).
    baseline: also solve the no-transfer plan to compare against (skip it when
      the caller already has one).
    initial: the first week picks a squad from scratch (unlimited free
      transfers, used by the season backtest); `squad` is then empty.
    """
    s = settings or Settings()
    P = {p.id: p for p in players}
    G = list(gameweeks)
    chips = {g: c for g, c in (chips or {}).items() if g in G}
    for c in chips.values():
        if c not in CHIPS:
            raise ValueError(f"unknown chip {c!r}")
    unlimited = {g for g, c in chips.items() if c == "wildcard"} | ({G[0]} if initial else set())
    free_hit = {g for g, c in chips.items() if c == "freehit"}
    triple = {g for g, c in chips.items() if c == "3xc"}
    bench_boost = {g for g, c in chips.items() if c == "bboost"}
    weight = {g: s.discount**i for i, g in enumerate(G)}
    value = lambda p, g: xp.get((p, g), 0.0)

    m = pulp.LpProblem("fpl_transfers", pulp.LpMaximize)
    B = lambda name: pulp.LpVariable.dicts(name, [(p, g) for p in P for g in G], cat="Binary")
    in_squad, starts, captain, buy, sell = B("squad"), B("lineup"), B("captain"), B("buy"), B("sell")
    ft = pulp.LpVariable.dicts("ft", G, lowBound=0, upBound=MAX_FREE_TRANSFERS, cat="Integer")
    paid = pulp.LpVariable.dicts("paid", G, lowBound=0, cat="Integer")
    money = pulp.LpVariable.dicts("bank", G, lowBound=0)
    # Free Hit weeks play a separate squad; `keep` marks players carried over from
    # the real squad, who count at their selling price rather than today's price.
    fh = pulp.LpVariable.dicts("fh", [(p, g) for p in P for g in free_hit], cat="Binary")
    keep = pulp.LpVariable.dicts("keep", [(p, g) for p in P for g in free_hit if P[p].sell != P[p].price], cat="Binary")
    playing = lambda p, g: fh[p, g] if g in free_hit else in_squad[p, g]

    def points(g):
        bench = 1.0 if g in bench_boost else s.bench_weight
        cap = 2 if g in triple else 1
        return pulp.lpSum(
            value(p, g) * (starts[p, g] + cap * captain[p, g]) + bench * value(p, g) * (playing(p, g) - starts[p, g]) for p in P
        )

    m += pulp.lpSum(
        weight[g] * (points(g) - HIT_COST * paid[g] - s.transfer_penalty * pulp.lpSum(buy[p, g] for p in P)) for g in G
    )

    m += ft[G[0]] == min(max(free_transfers, 0), MAX_FREE_TRANSFERS)
    for i, g in enumerate(G):
        prev = (lambda p: 1 if p in squad else 0) if i == 0 else (lambda p, h=G[i - 1]: in_squad[p, h])
        prev_money = bank if i == 0 else money[G[i - 1]]
        transfers = pulp.lpSum(buy[p, g] for p in P)
        for p in P:
            m += in_squad[p, g] == prev(p) + buy[p, g] - sell[p, g]
            m += buy[p, g] + sell[p, g] <= 1
            m += starts[p, g] <= playing(p, g)
            m += captain[p, g] <= starts[p, g]
            if not allow_transfers or g in free_hit:
                m += buy[p, g] == 0  # a Free Hit leaves the real squad untouched
                m += sell[p, g] == 0
        m += money[g] == prev_money + pulp.lpSum(P[p].sell * sell[p, g] - P[p].price * buy[p, g] for p in P)
        squads = [lambda p, g=g: in_squad[p, g]] + ([lambda p, g=g: fh[p, g]] if g in free_hit else [])
        for member in squads:
            for pos, n in POSITION_COUNTS.items():
                m += pulp.lpSum(member(p) for p in P if P[p].position == pos) == n
            for team in {pl.team for pl in players}:
                m += pulp.lpSum(member(p) for p in P if P[p].team == team) <= MAX_PER_CLUB
        if g in free_hit:
            # Budget: your squad's selling value plus the bank, as FPL computes it.
            for p in P:
                if (p, g) in keep:
                    m += keep[p, g] <= fh[p, g]
                    m += keep[p, g] <= prev(p)
            m += (
                pulp.lpSum(P[p].price * fh[p, g] for p in P)
                - pulp.lpSum((P[p].price - P[p].sell) * keep[p, g] for p in P if (p, g) in keep)
                <= prev_money + pulp.lpSum(P[p].sell * prev(p) for p in P)
            )
        m += pulp.lpSum(starts[p, g] for p in P) == 11
        m += pulp.lpSum(starts[p, g] for p in P if P[p].position == 1) == 1
        for pos in (2, 3, 4):
            m += pulp.lpSum(starts[p, g] for p in P if P[p].position == pos) >= LINEUP_MIN[pos]
        m += pulp.lpSum(captain[p, g] for p in P) == 1
        # Free transfers: anything beyond them is paid; unused ones roll over (max 5).
        # Wildcard and Free Hit weeks cost nothing and keep the banked ones.
        if g in unlimited or g in free_hit:
            m += paid[g] == 0
            if i + 1 < len(G):
                m += ft[G[i + 1]] <= (1 if initial and i == 0 else ft[g] + 1)
        else:
            m += paid[g] >= transfers - ft[g]
            if i + 1 < len(G):
                m += ft[G[i + 1]] <= ft[g] - transfers + paid[g] + 1

    status = pulp.LpStatus[m.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=s.time_limit, gapRel=0.002))]
    if status not in ("Optimal", "Not Solved") or pulp.value(m.objective) is None:
        raise RuntimeError(f"optimizer returned {status}")

    on = lambda var: (var.value() or 0) > 0.5
    weeks: list[Week] = []
    available = min(max(free_transfers, 0), MAX_FREE_TRANSFERS)  # recomputed exactly, week by week
    owned = set(squad)
    for i, g in enumerate(G):
        team = {p for p in P if on(playing(p, g))}
        if g in free_hit:  # shown as the week's temporary swaps
            outs = sorted((P[p] for p in owned - team), key=lambda p: (p.position, -p.price))
            ins = sorted((P[p] for p in team - owned), key=lambda p: (p.position, -p.price))
        else:
            outs = sorted((P[p] for p in P if on(sell[p, g])), key=lambda p: (p.position, -p.price))
            ins = sorted((P[p] for p in P if on(buy[p, g])), key=lambda p: (p.position, -p.price))
            owned = {p for p in P if on(in_squad[p, g])}
        pairs = _pair_by_position(outs, ins)
        lineup = sorted((P[p] for p in P if on(starts[p, g])), key=lambda p: (p.position, -value(p.id, g)))
        bench_gk = [P[p] for p in team if not on(starts[p, g]) and P[p].position == 1]
        bench_out = sorted((P[p] for p in team if not on(starts[p, g]) and P[p].position != 1), key=lambda p: -value(p.id, g))
        bench = bench_gk + bench_out
        cap = next(P[p] for p in P if on(captain[p, g]))
        free_week = g in unlimited or g in free_hit
        hits = 0 if free_week else max(0, len(ins) - available)
        total = sum(value(p.id, g) for p in lineup) + value(cap.id, g) * (2 if g in triple else 1)
        if g in bench_boost:
            total += sum(value(p.id, g) for p in bench)
        weeks.append(
            Week(
                gameweek=g,
                transfers=pairs,
                free_transfers=available,
                hits=hits,
                captain=cap,
                lineup=lineup,
                bench=bench,
                expected_points=total,
                bank_after=round(money[g].value() or 0),
                chip=chips.get(g),
            )
        )
        if initial and i == 0:
            available = 1
        elif free_week:
            available = min(MAX_FREE_TRANSFERS, available + 1)
        else:
            available = min(MAX_FREE_TRANSFERS, available - (len(ins) - hits) + 1)

    total = sum(w.expected_points - HIT_COST * w.hits for w in weeks)
    if not allow_transfers or initial:
        baseline_points = total
    elif baseline:
        baseline_points = solve(players, squad, xp, G, bank, free_transfers, s, allow_transfers=False).expected_points
    else:
        baseline_points = float("nan")
    return Plan(weeks=weeks, expected_points=total, baseline_points=baseline_points, status=status)


def _pair_by_position(outs: list[Player], ins: list[Player]) -> list[tuple[Player, Player]]:
    """Show each transfer as out -> in, matching positions (squad shape is fixed, so counts match)."""
    pairs, remaining = [], list(ins)
    for out in outs:
        match = next((p for p in remaining if p.position == out.position), remaining[0] if remaining else None)
        if match is None:
            break
        remaining.remove(match)
        pairs.append((out, match))
    return pairs
