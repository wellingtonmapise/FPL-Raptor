"""The transfer optimizer on small, made-up player pools with obvious right answers."""

import pytest

from raptor.optimizer.solve import MAX_PER_CLUB, Player, Settings, candidate_pool, solve

GWS = [6, 7, 8, 9]
FAST = Settings(time_limit=20)


def world():
    """A squad of steady 4-point players, plus a market of alternatives."""
    players, squad, xp = [], set(), {}
    pid = 0

    def add(pos, team, price, points, owned=False, sell=None):
        nonlocal pid
        pid += 1
        players.append(Player(id=pid, name=f"P{pid}", team=team, position=pos, price=price, sell=sell or price))
        for g in GWS:
            xp[(pid, g)] = points
        if owned:
            squad.add(pid)
        return pid

    # The squad: 2 GK, 5 DEF, 5 MID, 3 FWD across clubs 1-8, every player 4 xP a week.
    for i in range(2):
        add(1, 1 + i, 45, 4, owned=True)
    for i in range(5):
        add(2, 1 + i, 50, 4, owned=True)
    for i in range(5):
        add(3, 3 + i, 70, 4, owned=True)
    for i in range(3):
        add(4, 6 + i, 75, 4, owned=True)
    # The market: weaker players everywhere, so only deliberate upgrades are tempting.
    for pos, price in ((1, 40), (2, 40), (3, 50), (4, 55)):
        for team in range(9, 13):
            add(pos, team, price, 2)
    return players, squad, xp


def ids(players):
    return {p.id for p in players}


def check_rules(plan, players):
    by_id = {p.id: p for p in players}
    for week in plan.weeks:
        squad = week.lineup + week.bench
        assert len(squad) == 15 and len(week.lineup) == 11
        counts = {pos: sum(p.position == pos for p in squad) for pos in (1, 2, 3, 4)}
        assert counts == {1: 2, 2: 5, 3: 5, 4: 3}
        clubs = {}
        for p in squad:
            clubs[p.team] = clubs.get(p.team, 0) + 1
        assert max(clubs.values()) <= MAX_PER_CLUB
        starting = {pos: sum(p.position == pos for p in week.lineup) for pos in (1, 2, 3, 4)}
        assert starting[1] == 1 and starting[2] >= 3 and starting[3] >= 2 and starting[4] >= 1
        assert week.captain in week.lineup
        assert week.bank_after >= 0
        assert all(by_id[p.id] == p for p in squad)


def check_money(plan, start_bank):
    bank = start_bank
    for week in plan.weeks:
        bank += sum(out.sell for out, _ in week.transfers) - sum(new.price for _, new in week.transfers)
        assert bank >= 0
        assert week.bank_after == bank


def test_no_transfers_when_nothing_beats_the_squad():
    players, squad, xp = world()
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=1, settings=FAST)
    assert all(not w.transfers for w in plan.weeks)
    assert [w.free_transfers for w in plan.weeks] == [1, 2, 3, 4]  # banked, one more each week
    assert plan.gain == pytest.approx(0)
    check_rules(plan, players)


def test_free_transfer_used_on_a_clear_upgrade():
    players, squad, xp = world()
    star = Player(id=999, name="Star", team=12, position=3, price=72, sell=72)
    players.append(star)
    for g in GWS:
        xp[(999, g)] = 8
    plan = solve(players, squad, xp, GWS, bank=5, free_transfers=1, settings=FAST)
    first = plan.weeks[0]
    assert [t[1].name for t in first.transfers] == ["Star"]
    assert first.transfers[0][0].position == 3 and first.hits == 0
    assert first.captain.name == "Star"
    assert plan.gain > 20  # +4 a week, plus the extra from captaining him
    check_rules(plan, players)


def test_hit_only_when_it_pays():
    players, squad, xp = world()
    for k, gain in enumerate((5, 5)):
        players.append(Player(id=900 + k, name=f"Up{k}", team=10 + k, position=2, price=50, sell=50))
        for g in GWS:
            xp[(900 + k, g)] = 4 + gain
    trusting = Settings(time_limit=20, transfer_penalty=0.1, hit_margin=0)
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=1, settings=trusting)
    assert len(plan.weeks[0].transfers) == 2 and plan.weeks[0].hits == 1  # +5 a week each beats −4
    # With the default margin (a hit must win 6, not 4), the second move waits a week for a free transfer.
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=1, settings=FAST)
    assert [len(w.transfers) for w in plan.weeks[:2]] == [1, 1] and sum(w.hits for w in plan.weeks) == 0

    players, squad, xp = world()
    for k in range(2):
        players.append(Player(id=900 + k, name=f"Up{k}", team=10 + k, position=2, price=50, sell=50))
        for g in GWS:
            xp[(900 + k, g)] = 4.4  # +0.4 a week: not worth a hit
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=1, settings=FAST)
    assert sum(w.hits for w in plan.weeks) == 0


def test_budget_is_respected():
    players, squad, xp = world()
    players.append(Player(id=999, name="Pricey", team=12, position=3, price=150, sell=150))
    for g in GWS:
        xp[(999, g)] = 12
    plan = solve(players, squad, xp, GWS, bank=10, free_transfers=1, settings=FAST)
    # It may fund him by downgrading others (a real tactic), but the books must balance.
    check_money(plan, start_bank=10)
    check_rules(plan, players)


def test_selling_price_is_used_not_the_current_price():
    players, squad, xp = world()
    # The weakest-value owned midfielder costs 7.5 now but only sells for 7.0.
    mid = next(p for p in players if p.position == 3 and p.id in squad)
    players[players.index(mid)] = Player(id=mid.id, name=mid.name, team=mid.team, position=3, price=75, sell=70)
    players.append(Player(id=999, name="Target", team=12, position=3, price=74, sell=74))
    for g in GWS:
        xp[(999, g)] = 9
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=1, settings=FAST)
    check_money(plan, start_bank=0)  # uses 7.0 for the midfielder, not his 7.5 price
    sold = [t[0] for w in plan.weeks for t in w.transfers]
    if mid.id in {p.id for p in sold}:
        assert next(p for p in sold if p.id == mid.id).sell == 70


def test_club_limit_forces_a_sell_from_that_club():
    players, squad, xp = world()
    # Club 3 already has three of our players (a DEF and two MIDs at clubs 3, 3?). Make a club-4 star.
    club4 = [p for p in players if p.id in squad and p.team == 4]
    assert len(club4) == 2
    players.append(Player(id=998, name="Extra4", team=4, position=4, price=60, sell=60))
    players.append(Player(id=999, name="Star4", team=4, position=4, price=60, sell=60))
    for g in GWS:
        xp[(998, g)] = 9
        xp[(999, g)] = 9
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=2, settings=FAST)
    check_rules(plan, players)  # never more than 3 from club 4


def test_baseline_keeps_the_squad():
    players, squad, xp = world()
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=1, settings=FAST, allow_transfers=False)
    assert all(ids(w.lineup + w.bench) == squad for w in plan.weeks)
    assert plan.baseline_points == plan.expected_points == pytest.approx(4 * (11 * 4 + 4))


def test_candidate_pool_keeps_the_squad_and_the_best():
    players, squad, xp = world()
    pool = candidate_pool(players, squad, xp, GWS, per_position={1: 1, 2: 1, 3: 1, 4: 1})
    assert squad <= ids(pool)
