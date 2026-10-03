from raptor.optimizer.inputs import bank, free_transfers, purchase_prices, selling_price


def week(event, made=0, cost=0, bank=0):
    return {"event": event, "event_transfers": made, "event_transfers_cost": cost, "bank": bank}


def test_free_transfers_bank_and_cap():
    history = {"current": [week(1), week(2), week(3), week(4)], "chips": []}
    assert free_transfers(history) == 4  # 1 after GW1, +1 for each of GW2-4, none used
    history = {"current": [week(e) for e in range(1, 10)], "chips": []}
    assert free_transfers(history) == 5  # capped


def test_free_transfers_used_and_hits():
    # GW2: had 1, used 1 -> 1 next. GW3: had 1, made 2 with a -4 -> 1 next. GW4: had 1, used 0 -> 2.
    history = {"current": [week(1), week(2, made=1), week(3, made=2, cost=4), week(4)], "chips": []}
    assert free_transfers(history) == 2


def test_wildcard_week_uses_no_free_transfers():
    history = {"current": [week(1), week(2), week(3, made=9)], "chips": [{"name": "wildcard", "event": 3}]}
    assert free_transfers(history) == 3


def test_matches_the_real_shape_of_the_endpoint():
    # From a real manager this season: four transfers in GW4-5, a Triple Captain in GW3.
    history = {
        "current": [week(1), week(2), week(3), week(4, made=2), week(5, made=1, bank=3)],
        "chips": [{"name": "3xc", "time": "2026-09-04T15:40:03Z", "event": 3}],
    }
    # 1 -> GW2 +1 = 2 -> GW3 +1 = 3 -> GW4 used 2 -> 2 -> GW5 used 1 -> 2
    assert free_transfers(history) == 2
    assert bank(history) == 3


def test_selling_price_rules():
    assert selling_price(purchase=50, now=50) == 50
    assert selling_price(purchase=50, now=53) == 51  # keep half of +0.3, rounded down
    assert selling_price(purchase=50, now=54) == 52
    assert selling_price(purchase=50, now=48) == 48  # falls are passed on in full


def test_purchase_prices_from_transfers_or_start_price():
    elements = {
        449: {"now_cost": 54, "cost_change_start": 2},
        7: {"now_cost": 105, "cost_change_start": 5},  # in the squad since GW1: paid 10.0
    }
    transfers = [
        {"element_in": 449, "element_in_cost": 50, "time": "2026-09-01T00:00:00Z"},
        {"element_in": 449, "element_in_cost": 52, "time": "2026-09-18T00:00:00Z"},  # bought back later
        {"element_in": 300, "element_in_cost": 60, "time": "2026-09-10T00:00:00Z"},  # since sold
    ]
    assert purchase_prices({449, 7}, transfers, elements) == {449: 52, 7: 100}


def test_empty_history():
    assert free_transfers({"current": []}) == 1
    assert bank({"current": []}) == 0
