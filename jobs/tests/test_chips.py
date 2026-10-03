"""The chip planner, on small made-up worlds where the right chip week is obvious."""

import pytest

from raptor.optimizer.chips import ChipCopy, available_chips, chip_windows, plan_with_chips
from raptor.optimizer.solve import Player, Settings, solve
from tests.test_optimizer import GWS, check_money, check_rules, ids, world

FAST = Settings(time_limit=20)
NO_BAR = {"wildcard": 0.5, "freehit": 0.5, "bboost": 0.5, "3xc": 0.5}


def copy(chip, weeks=GWS, expires=19):
    return ChipCopy(chip, expires, tuple(weeks))


def test_triple_captain_goes_where_the_captain_scores_most():
    players, squad, xp = world()
    star = sorted(squad)[10]
    xp[(star, 8)] = 15  # a big double gameweek for one of your players
    result = plan_with_chips(players, squad, xp, GWS, 0, 1, [copy("3xc")], FAST, thresholds={"3xc": 9})
    (option,) = result.options
    assert option.best_week == 8 and option.advice == "later"
    assert option.gain == pytest.approx(15, abs=0.2)
    week = next(w for w in result.plan.weeks if w.gameweek == 8)
    assert week.chip == "3xc" and week.captain.id == star
    assert week.expected_points == pytest.approx(10 * 4 + 15 * 3, abs=0.01)
    check_rules(result.plan, players)


def test_ordinary_weeks_save_the_chip():
    players, squad, xp = world()
    by_pos = sorted((p for p in players if p.id in squad), key=lambda p: p.position)
    for p in [by_pos[0], *by_pos[2:5]]:  # a weak bench: one keeper and three defenders
        for g in GWS:
            xp[(p.id, g)] = 1
    result = plan_with_chips(players, squad, xp, GWS, 0, 1, [copy("3xc"), copy("bboost")], FAST)
    assert {o.chip: o.advice for o in result.options} == {"3xc": "save", "bboost": "save"}
    assert result.chips == {} and result.plan.expected_points == pytest.approx(result.base.expected_points)


def test_bench_boost_counts_the_bench():
    players, squad, xp = world()
    bench = sorted(squad)  # every player scores 4, so the bench is worth 16 a week
    result = plan_with_chips(players, squad, xp, [6], 0, 1, [copy("bboost", [6])], FAST, thresholds={"bboost": 10})
    (option,) = result.options
    assert option.advice == "play" and option.gain == pytest.approx(16, abs=0.5)
    assert result.plan.weeks[0].expected_points == pytest.approx(15 * 4 + 4, abs=0.01)
    assert len(bench) == 15


def test_free_hit_fixes_a_blank_week_then_the_squad_comes_back():
    players, squad, xp = world()
    for p in squad:
        xp[(p, 7)] = 0  # your clubs all blank in GW7
    result = plan_with_chips(players, squad, xp, GWS, 0, 1, [copy("freehit")], FAST, thresholds=NO_BAR)
    (option,) = result.options
    assert option.best_week == 7 and option.advice == "later"
    gw7 = next(w for w in result.plan.weeks if w.gameweek == 7)
    assert gw7.chip == "freehit" and gw7.hits == 0
    assert not (ids(gw7.lineup) & squad)  # a whole new XI for the week
    gw8 = next(w for w in result.plan.weeks if w.gameweek == 8)
    assert ids(gw8.lineup + gw8.bench) == squad  # and the real squad is back
    assert gw7.bank_after == 0
    assert [w.free_transfers for w in result.plan.weeks] == [1, 2, 3, 4]  # kept, plus one
    check_rules(result.plan, players)


def test_free_hit_budget_is_your_selling_value():
    players, squad, xp = world()
    for p in squad:
        xp[(p, 6)] = 0
    # A fantastic but expensive striker you can only afford with £0.5m more.
    pricey = Player(id=999, name="Pricey", team=12, position=4, price=80, sell=80)
    players.append(pricey)
    for g in GWS:
        xp[(999, g)] = 20
    plan = solve(players, squad, xp, GWS, bank=0, free_transfers=1, settings=FAST, chips={6: "freehit"}, baseline=False)
    gw6 = plan.weeks[0]
    budget = sum(p.sell for p in players if p.id in squad)
    assert sum(p.price for p in gw6.lineup + gw6.bench) <= budget


def test_wildcard_makes_many_moves_without_hits():
    players, squad, xp = world()
    # A market full of much better players at the same prices.
    better = []
    for p in list(players):
        if p.id in squad:
            twin = Player(id=p.id + 500, name=f"T{p.id}", team=p.team + 20, position=p.position, price=p.price, sell=p.price)
            better.append(twin)
            for g in GWS:
                xp[(twin.id, g)] = 7
    players += better
    result = plan_with_chips(players, squad, xp, GWS, 0, 1, [copy("wildcard")], FAST, thresholds={"wildcard": 12})
    (option,) = result.options
    assert option.advice == "play"
    first = result.plan.weeks[0]
    assert first.chip == "wildcard" and first.hits == 0 and len(first.transfers) >= 10
    check_rules(result.plan, players)
    check_money(result.plan, 0)


def test_expiring_chip_is_used_even_below_the_bar():
    players, squad, xp = world()
    result = plan_with_chips(players, squad, xp, GWS, 0, 1, [copy("3xc", expires=9)], FAST)
    (option,) = result.options
    assert option.advice in ("play", "later") and option.gain == pytest.approx(4, abs=0.2)


def test_one_chip_per_week():
    players, squad, xp = world()
    star = sorted(squad)[10]
    xp[(star, 6)] = 15
    result = plan_with_chips(players, squad, xp, GWS, 0, 1, [copy("3xc"), copy("bboost")], FAST, thresholds=NO_BAR)
    weeks = [w.chip for w in result.plan.weeks if w.chip]
    assert sorted(weeks) == ["3xc", "bboost"]
    assert result.chips[6] == "3xc"


def test_available_chips_by_window():
    bootstrap = {"chips": [
        {"name": "wildcard", "start_event": 2, "stop_event": 19}, {"name": "wildcard", "start_event": 20, "stop_event": 38},
        {"name": "3xc", "start_event": 1, "stop_event": 19}, {"name": "3xc", "start_event": 20, "stop_event": 38},
    ]}
    history = {"chips": [{"name": "3xc", "event": 3}]}
    found = available_chips(history, chip_windows(bootstrap), [18, 19, 20, 21])
    assert ChipCopy("wildcard", 19, (18, 19)) in found and ChipCopy("wildcard", 38, (20, 21)) in found
    assert [c for c in found if c.chip == "3xc"] == [ChipCopy("3xc", 38, (20, 21))]  # first-half copy used in GW3
    assert len(chip_windows({})) == 8  # sensible default when FPL doesn't list them
