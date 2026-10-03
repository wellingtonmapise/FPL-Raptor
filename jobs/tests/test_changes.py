from raptor.changes import diff_players

NOW = "2026-10-03T12:00:00+00:00"


def player(**overrides):
    base = {
        "id": 202,
        "now_cost": 105,
        "status": "a",
        "news": "",
        "chance_of_playing_next_round": None,
    }
    base.update(overrides)
    return base


def test_first_run_records_nothing():
    assert diff_players({}, [player()], NOW) == []


def test_unchanged_player_records_nothing():
    assert diff_players({202: player()}, [player()], NOW) == []


def test_blank_news_and_null_news_are_the_same():
    assert diff_players({202: player(news=None)}, [player(news="")], NOW) == []


def test_flag_records_each_changed_field():
    old = {202: player()}
    new = [player(status="d", news="Knock - 75% chance of playing", chance_of_playing_next_round=75)]
    changes = {c["field"]: c for c in diff_players(old, new, NOW)}
    assert set(changes) == {"status", "news", "chance_of_playing_next_round"}
    assert changes["status"]["old_value"] == "a"
    assert changes["status"]["new_value"] == "d"
    assert changes["chance_of_playing_next_round"]["old_value"] is None
    assert changes["chance_of_playing_next_round"]["new_value"] == "75"
    assert all(c["seen_at"] == NOW and c["player_id"] == 202 for c in changes.values())


def test_price_rise():
    changes = diff_players({202: player()}, [player(now_cost=106)], NOW)
    assert changes == [
        {"player_id": 202, "field": "now_cost", "old_value": "105", "new_value": "106", "seen_at": NOW}
    ]
