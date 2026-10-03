"""Mini-league alerts: captain round-up after a deadline, awards once points are final."""

from datetime import datetime, timedelta, timezone

import pytest

from raptor.alerts import awards_message, captain_roundup_message, rival_of, run_alerts

NOW = datetime(2026, 10, 10, 14, 0, tzinfo=timezone.utc)  # 4 hours after the GW6 deadline
LEAGUE = {"id": 777, "name": "BiG ReD"}
MEMBERS = [
    {"league_id": 777, "team_id": 1, "manager_name": "Wellington Mapise", "rank": 1, "total": 366},
    {"league_id": 777, "team_id": 2, "manager_name": "Takunda Chikuvire", "rank": 2, "total": 361},
    {"league_id": 777, "team_id": 3, "manager_name": "Alano Wheatley", "rank": 3, "total": 358},
    {"league_id": 777, "team_id": 4, "manager_name": "Benjamin Karanja", "rank": 4, "total": 332},
]


class RecordingSender:
    def __init__(self):
        self.sent = []

    def send(self, subscription, payload, ttl=0, urgency="normal"):
        self.sent.append(payload)
        return "ok"


def test_rival_and_messages():
    assert rival_of(MEMBERS, 1)["team_id"] == 2  # top: the chaser
    assert rival_of(MEMBERS, 3)["team_id"] == 2  # otherwise: the one above
    captains = {1: "Salah", 2: "Haaland", 3: "Haaland", 4: "Haaland"}
    msg = captain_roundup_message(LEAGUE, 6, MEMBERS, captains, 1)
    assert msg["title"] == "GW6 captains in BiG ReD"
    assert msg["body"] == "Haaland ×3, Salah ×1. You went Salah, on your own. Takunda (5 behind) went Haaland."
    assert msg["url"] == "/league/777"

    entries = {
        1: {"points": 50, "event_transfers_cost": 0, "points_on_bench": 17},
        2: {"points": 60, "event_transfers_cost": 4, "points_on_bench": 2},
        3: {"points": 53, "event_transfers_cost": 0, "points_on_bench": 0},
        4: {"points": 27, "event_transfers_cost": 0, "points_on_bench": 5},
    }
    caps = {1: ("Salah", 4), 2: ("Haaland", 26), 3: ("Haaland", 26), 4: ("Haaland", 26)}
    awards = awards_message(LEAGUE, 6, MEMBERS, entries, caps, 1)
    assert awards["title"] == "GW6 awards · BiG ReD"
    assert awards["body"] == (
        "Top: Takunda 56. Wooden spoon: Benjamin 27. Captain hero: Takunda (Haaland, 26). "
        "Captain fail: Wellington (Salah, 4). Bench of shame: Wellington 17. You: 50 (3rd of 4)."
    )


@pytest.fixture
def db(fake_db):
    fake_db.rows("push_subscriptions").append({"id": 1, "user_id": "u1", "endpoint": "e", "p256dh": "k", "auth": "a"})
    fake_db.rows("profiles").append({"user_id": "u1", "fpl_team_id": 1})
    fake_db.rows("leagues").append(LEAGUE)
    fake_db.rows("league_members").extend(MEMBERS)
    fake_db.rows("gameweeks").extend(
        [
            {"id": 6, "deadline_time": "2026-10-10T10:00:00+00:00", "is_current": True, "finished": False, "data_checked": False},
            {"id": 7, "deadline_time": "2026-10-17T10:00:00+00:00", "is_current": False, "finished": False, "data_checked": False},
        ]
    )
    fake_db.rows("players").extend([{"id": 9, "web_name": "Haaland"}, {"id": 7, "web_name": "Salah"}])
    for team, player in [(1, 7), (2, 9), (3, 9), (4, 9)]:
        fake_db.rows("picks").append({"team_id": team, "gameweek_id": 6, "player_id": player, "is_captain": True, "multiplier": 2})
    return fake_db


def test_roundup_after_a_fresh_deadline_once(db):
    sender = RecordingSender()
    run_alerts(db, sender, NOW)
    assert [m["title"] for m in sender.sent] == ["GW6 captains in BiG ReD"]
    sender.sent.clear()
    run_alerts(db, sender, NOW + timedelta(minutes=15))
    assert sender.sent == []


def test_no_roundup_for_an_old_deadline(db):
    sender = RecordingSender()
    run_alerts(db, sender, NOW + timedelta(days=3))
    assert sender.sent == []


def test_league_preference_off(db):
    db.rows("notification_prefs").append({"user_id": "u1", "alert_type": "league", "enabled": False})
    sender = RecordingSender()
    run_alerts(db, sender, NOW)
    assert sender.sent == []


def finish_gameweek(db, with_points=True):
    db.rows("gameweeks")[0].update(finished=True, data_checked=True)
    for team, pts in [(1, 50), (2, 60), (3, 53), (4, 27)]:
        db.rows("entry_gameweeks").append(
            {"team_id": team, "gameweek_id": 6, "points": pts, "event_transfers_cost": 0, "points_on_bench": 3, "final": True}
        )
    if with_points:
        db.rows("player_gameweeks").extend([{"player_id": 9, "gameweek_id": 6, "points": 13}, {"player_id": 7, "gameweek_id": 6, "points": 2}])


def test_awards_once_points_are_final(db):
    finish_gameweek(db)
    sender = RecordingSender()
    run_alerts(db, sender, NOW + timedelta(days=3))  # too late for a round-up, fine for awards
    assert [m["title"] for m in sender.sent] == ["GW6 awards · BiG ReD"]
    assert "Captain fail: Wellington (Salah, 4)." in sender.sent[0]["body"]


def test_awards_wait_for_player_points(db):
    finish_gameweek(db, with_points=False)
    sender = RecordingSender()
    run_alerts(db, sender, NOW + timedelta(days=3))
    assert sender.sent == []
