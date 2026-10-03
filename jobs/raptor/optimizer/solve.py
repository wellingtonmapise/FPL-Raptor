"""The transfer optimizer: an integer program over the next few gameweeks.

Decides, for each upcoming gameweek, who to transfer in and out, who starts
and who captains, to maximise expected points (from the model) minus −4 hits.

Rules it respects:
  * squad of 2 GK, 5 DEF, 5 MID, 3 FWD, at most 3 per club
  * a valid starting XI (1 GK, at least 3 DEF, 2 MID, 1 FWD) and one captain
  * money in the bank never goes negative; players sell at your selling price
  * free transfers: one more each week, banked up to 5; extra transfers cost 4

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
    expected_points: float  # lineup + captain, before hits
    bank_after: int


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
) -> Plan:
    s = settings or Settings()
    P = {p.id: p for p in players}
    G = list(gameweeks)
    weight = {g: s.discount**i for i, g in enumerate(G)}
    value = lambda p, g: xp.get((p, g), 0.0)

    m = pulp.LpProblem("fpl_transfers", pulp.LpMaximize)
    B = lambda name: pulp.LpVariable.dicts(name, [(p, g) for p in P for g in G], cat="Binary")
    in_squad, starts, captain, buy, sell = B("squad"), B("lineup"), B("captain"), B("buy"), B("sell")
    ft = pulp.LpVariable.dicts("ft", G, lowBound=0, upBound=MAX_FREE_TRANSFERS, cat="Integer")
    paid = pulp.LpVariable.dicts("paid", G, lowBound=0, cat="Integer")
    money = pulp.LpVariable.dicts("bank", G, lowBound=0)

    m += pulp.lpSum(
        weight[g] * (
            pulp.lpSum(value(p, g) * (starts[p, g] + captain[p, g]) + s.bench_weight * value(p, g) * (in_squad[p, g] - starts[p, g]) for p in P)
            - HIT_COST * paid[g]
            - s.transfer_penalty * pulp.lpSum(buy[p, g] for p in P)
        )
        for g in G
    )

    m += ft[G[0]] == min(max(free_transfers, 0), MAX_FREE_TRANSFERS)
    for i, g in enumerate(G):
        prev = (lambda p: 1 if p in squad else 0) if i == 0 else (lambda p, h=G[i - 1]: in_squad[p, h])
        prev_money = bank if i == 0 else money[G[i - 1]]
        transfers = pulp.lpSum(buy[p, g] for p in P)
        for p in P:
            m += in_squad[p, g] == prev(p) + buy[p, g] - sell[p, g]
            m += buy[p, g] + sell[p, g] <= 1
            m += starts[p, g] <= in_squad[p, g]
            m += captain[p, g] <= starts[p, g]
            if not allow_transfers:
                m += buy[p, g] == 0
        m += money[g] == prev_money + pulp.lpSum(P[p].sell * sell[p, g] - P[p].price * buy[p, g] for p in P)
        for pos, n in POSITION_COUNTS.items():
            m += pulp.lpSum(in_squad[p, g] for p in P if P[p].position == pos) == n
        for team in {pl.team for pl in players}:
            m += pulp.lpSum(in_squad[p, g] for p in P if P[p].team == team) <= MAX_PER_CLUB
        m += pulp.lpSum(starts[p, g] for p in P) == 11
        m += pulp.lpSum(starts[p, g] for p in P if P[p].position == 1) == 1
        for pos in (2, 3, 4):
            m += pulp.lpSum(starts[p, g] for p in P if P[p].position == pos) >= LINEUP_MIN[pos]
        m += pulp.lpSum(captain[p, g] for p in P) == 1
        # Free transfers: anything beyond them is paid; unused ones roll over (max 5).
        m += paid[g] >= transfers - ft[g]
        if i + 1 < len(G):
            m += ft[G[i + 1]] <= ft[g] - transfers + paid[g] + 1

    status = pulp.LpStatus[m.solve(pulp.PULP_CBC_CMD(msg=0, timeLimit=s.time_limit, gapRel=0.002))]
    if status not in ("Optimal", "Not Solved") or pulp.value(m.objective) is None:
        raise RuntimeError(f"optimizer returned {status}")

    on = lambda var: (var.value() or 0) > 0.5
    weeks: list[Week] = []
    available = min(max(free_transfers, 0), MAX_FREE_TRANSFERS)  # recomputed exactly, week by week
    for g in G:
        outs = sorted((P[p] for p in P if on(sell[p, g])), key=lambda p: (p.position, -p.price))
        ins = sorted((P[p] for p in P if on(buy[p, g])), key=lambda p: (p.position, -p.price))
        pairs = _pair_by_position(outs, ins)
        lineup = sorted((P[p] for p in P if on(starts[p, g])), key=lambda p: (p.position, -value(p.id, g)))
        bench_gk = [P[p] for p in P if on(in_squad[p, g]) and not on(starts[p, g]) and P[p].position == 1]
        bench_out = sorted((P[p] for p in P if on(in_squad[p, g]) and not on(starts[p, g]) and P[p].position != 1),
                           key=lambda p: -value(p.id, g))
        cap = next(P[p] for p in P if on(captain[p, g]))
        hits = max(0, len(ins) - available)
        weeks.append(
            Week(
                gameweek=g,
                transfers=pairs,
                free_transfers=available,
                hits=hits,
                captain=cap,
                lineup=lineup,
                bench=bench_gk + bench_out,
                expected_points=sum(value(p.id, g) for p in lineup) + value(cap.id, g),
                bank_after=round(money[g].value() or 0),
            )
        )
        available = min(MAX_FREE_TRANSFERS, available - (len(ins) - hits) + 1)

    total = sum(w.expected_points - HIT_COST * w.hits for w in weeks)
    baseline = total if not allow_transfers else solve(players, squad, xp, G, bank, free_transfers, s, allow_transfers=False).expected_points
    return Plan(weeks=weeks, expected_points=total, baseline_points=baseline, status=status)


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
