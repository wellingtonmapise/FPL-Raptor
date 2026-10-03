"""The alerts job, against the in-memory database and a recording sender."""

from datetime import datetime, timedelta, timezone

import pytest

from raptor.alerts import (
    availability,
    deadline_message,
    flag_message,
    price_message,
    run_alerts,
    time_left,
)

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
USER = "u1"


class RecordingSender:
    def __init__(self, result="ok"):
        self.result = result
        self.sent = []

    def send(self, subscription, payload, ttl=0, urgency="normal"):
        self.sent.append({"endpoint": subscription["endpoint"], "payload": payload, "ttl": ttl, "urgency": urgency})
        return self.result


def iso(dt):
    return dt.isoformat(timespec="seconds")


@pytest.fixture
def db(fake_db):
    fake_db.rows("push_subscriptions").append(
        {"id": 1, "user_id": USER, "endpoint": "https://push.example/abc", "p256dh": "k", "auth": "a"}
    )
    fake_db.rows("profiles").append({"user_id": USER, "fpl_team_id": 1001})
    fake_db.rows("gameweeks").extend(
        [
            {"id": 5, "deadline_time": "2026-09-18T17:30:00+00:00", "is_current": True},
            {"id": 6, "deadline_time": iso(NOW + timedelta(hours=22)), "is_current": False},
        ]
    )
    fake_db.rows("players").extend(
        [
            {"id": 9, "web_name": "Haaland", "status": "a", "news": "", "chance_of_playing_next_round": None, "now_cost": 145},
            {"id": 5, "web_name": "Palmer", "status": "d", "news": "Groin injury - 75% chance of playing", "chance_of_playing_next_round": 75, "now_cost": 105},
            {"id": 13, "web_name": "Timber", "status": "i", "news": "Hamstring injury", "chance_of_playing_next_round": 0, "now_cost": 57},
            {"id": 77, "web_name": "NotMine", "status": "i", "news": "Knee", "chance_of_playing_next_round": 0, "now_cost": 50},
        ]
    )
    fake_db.rows("picks").extend(
        [
            {"team_id": 1001, "gameweek_id": 5, "player_id": 9, "is_captain": True, "multiplier": 2},
            {"team_id": 1001, "gameweek_id": 5, "player_id": 5, "is_captain": False, "multiplier": 1},
            {"team_id": 1001, "gameweek_id": 5, "player_id": 13, "is_captain": False, "multiplier": 0},
        ]
    )
    return fake_db


def test_message_helpers():
    assert time_left(22 * 3600) == "22 hours"
    assert time_left(70 * 60) == "1 hour"
    assert time_left(40 * 60) == "40 minutes"
    assert availability({"status": "d", "chance_of_playing_next_round": 75}) == "75%"
    assert availability({"status": "i", "chance_of_playing_next_round": 0}) == "injured"
    assert availability({"status": "a", "chance_of_playing_next_round": None}) is None


def test_deadline_message_lists_flags_and_captain():
    squad = [
        {"web_name": "Haaland", "status": "a", "chance_of_playing_next_round": None, "is_captain": True},
        {"web_name": "Palmer", "status": "d", "chance_of_playing_next_round": 75, "is_captain": False},
    ]
    msg = deadline_message(6, 23.6 * 3600, False, squad)
    assert msg["title"] == "GW6 deadline in 24 hours"
    assert msg["body"] == "Time to plan your transfers. Flagged in your team: Palmer (75%). Captain: Haaland."
    assert msg["url"] == "/me"
    last = deadline_message(6, 60 * 60, True, None)
    assert last["title"] == "GW6 deadline in 1 hour"
    assert last["body"] == "Last chance for transfers and your captain."


def test_flag_and_price_messages():
    one = flag_message([{"id": 5, "web_name": "Palmer", "status": "d", "chance_of_playing_next_round": 75, "news": "Groin"}])
    assert one["title"] == "Palmer: 75% chance of playing" and one["body"] == "Groin"
    back = flag_message([{"id": 5, "web_name": "Palmer", "status": "a", "chance_of_playing_next_round": 100, "news": ""}])
    assert back["title"] == "Palmer is available again"
    two = flag_message(
        [
            {"id": 5, "web_name": "Palmer", "status": "d", "chance_of_playing_next_round": 50, "news": ""},
            {"id": 13, "web_name": "Timber", "status": "i", "chance_of_playing_next_round": 0, "news": "Hamstring"},
        ]
    )
    assert two["title"] == "Team news for 2 of your players"
    assert two["body"] == "Palmer: 50% chance of playing; Timber is injured (Hamstring)"
    price = price_message([({"id": 9, "web_name": "Haaland"}, 145, 146)])
    assert price["title"] == "Haaland rose to £14.6m" and price["body"] == "Haaland ▲ £14.5m → £14.6m"


def test_24h_reminder_sent_once(db):
    sender = RecordingSender()
    summary = run_alerts(db, sender, NOW)
    assert len(sender.sent) == 1
    msg = sender.sent[0]["payload"]
    assert msg["title"] == "GW6 deadline in 22 hours"
    assert "Palmer (75%)" in msg["body"] and "Timber (injured)" in msg["body"] and "Captain: Haaland" in msg["body"]
    assert "1 sent to 1 person" in summary and "deadline_24h 1" in summary
    assert {r["alert_key"] for r in db.rows("notifications_sent")} == {"deadline_24h:gw6"}

    sender.sent.clear()
    run_alerts(db, sender, NOW + timedelta(minutes=15))
    assert sender.sent == []  # already sent


def test_1h_reminder_is_urgent(db):
    sender = RecordingSender()
    run_alerts(db, sender, NOW + timedelta(hours=21, minutes=10))  # 50 minutes before
    assert [s["payload"]["title"] for s in sender.sent] == ["GW6 deadline in 50 minutes"]
    assert sender.sent[0]["urgency"] == "high"


def test_no_reminder_more_than_a_day_out(db):
    sender = RecordingSender()
    run_alerts(db, sender, NOW - timedelta(hours=3))  # 25 hours before
    assert sender.sent == []


def test_preferences_switch_types_off(db):
    db.rows("notification_prefs").append({"user_id": USER, "alert_type": "deadline_24h", "enabled": False})
    sender = RecordingSender()
    run_alerts(db, sender, NOW)
    assert sender.sent == []


def test_team_news_and_prices_for_squad_players_only(db):
    db.rows("notification_prefs").append({"user_id": USER, "alert_type": "deadline_24h", "enabled": False})
    seen = iso(NOW - timedelta(hours=1))
    db.rows("player_changes").extend(
        [
            {"id": 1, "player_id": 5, "field": "status", "old_value": "a", "new_value": "d", "seen_at": seen},
            {"id": 2, "player_id": 5, "field": "chance_of_playing_next_round", "old_value": None, "new_value": "75", "seen_at": seen},
            {"id": 3, "player_id": 9, "field": "now_cost", "old_value": "145", "new_value": "146", "seen_at": seen},
            {"id": 4, "player_id": 77, "field": "status", "old_value": "a", "new_value": "i", "seen_at": seen},
            {"id": 5, "player_id": 13, "field": "news", "old_value": "", "new_value": "Hamstring injury", "seen_at": iso(NOW - timedelta(hours=9))},
        ]
    )
    sender = RecordingSender()
    run_alerts(db, sender, NOW)
    titles = sorted(s["payload"]["title"] for s in sender.sent)
    # Palmer's two changes become one message; NotMine isn't in the squad; Timber's news is too old.
    assert titles == ["Haaland rose to £14.6m", "Palmer: 75% chance of playing"]
    keys = {r["alert_key"] for r in db.rows("notifications_sent")}
    assert keys == {"change:1", "change:2", "change:3"}

    sender.sent.clear()
    run_alerts(db, sender, NOW + timedelta(minutes=15))
    assert sender.sent == []


def test_unsubscribed_devices_are_removed_and_not_marked_sent(db):
    sender = RecordingSender(result="gone")
    summary = run_alerts(db, sender, NOW)
    assert db.rows("push_subscriptions") == []
    assert db.rows("notifications_sent") == []
    assert "removed 1 old device" in summary


def test_errors_are_retried_next_run(db):
    sender = RecordingSender(result="error: 500")
    summary = run_alerts(db, sender, NOW)
    assert db.rows("notifications_sent") == []
    assert "1 failed (error: 500)" in summary


def test_nobody_subscribed(fake_db):
    assert run_alerts(fake_db, RecordingSender(), NOW) == "no devices signed up for notifications"


def test_deadline_reminder_includes_the_models_captain(db):
    db.rows("predictions").extend(
        [
            {"player_id": 9, "gameweek_id": 6, "expected_points": 6.1, "created_at": "2026-10-09T09:00:00+00:00"},
            {"player_id": 9, "gameweek_id": 6, "expected_points": 7.8, "created_at": "2026-10-09T11:00:00+00:00"},
            {"player_id": 5, "gameweek_id": 6, "expected_points": 5.4, "created_at": "2026-10-09T11:00:00+00:00"},
            {"player_id": 13, "gameweek_id": 6, "expected_points": 9.9, "created_at": "2026-10-09T11:00:00+00:00"},
        ]
    )
    sender = RecordingSender()
    run_alerts(db, sender, NOW)
    # Timber has the highest xP but is on the bench, so the pick is Haaland (newest run).
    assert sender.sent[0]["payload"]["body"].endswith("Model's pick: Haaland (7.8 xP).")


def test_deadline_reminder_includes_the_transfer_plan(db):
    db.rows("transfer_plans").append(
        {
            "user_id": USER,
            "from_gameweek": 6,
            "expected_points": 210.4,
            "baseline_points": 201.2,
            "plan": {"weeks": [{"gameweek": 6, "hits": 0, "transfers": [{"out": {"name": "Palmer"}, "in": {"name": "Saka"}}]}]},
        }
    )
    sender = RecordingSender()
    run_alerts(db, sender, NOW)
    assert sender.sent[0]["payload"]["body"].endswith("Plan: Palmer → Saka, +9.2 xP.")


def test_transfer_idea_rolls_small_gains():
    from raptor.alerts import transfer_idea

    row = {"expected_points": 201.5, "baseline_points": 201.2, "plan": {"weeks": [{"transfers": [{"out": {"name": "A"}, "in": {"name": "B"}}]}]}}
    assert transfer_idea(row) == "Plan: roll your transfer."


def test_transfer_idea_mentions_this_weeks_chip():
    from raptor.alerts import transfer_idea

    move = {"out": {"name": "Palmer"}, "in": {"name": "Saka"}}
    week = {"transfers": [move], "hits": 0, "chip": "bboost", "captain": {"name": "Haaland"}}
    row = {"expected_points": 230, "baseline_points": 212, "plan": {"weeks": [week]}}
    assert transfer_idea(row) == "Plan: Bench Boost this week; Palmer → Saka, +18.0 xP."
    week.update(chip="3xc", transfers=[])
    assert transfer_idea(row) == "Plan: Triple Captain Haaland this week; roll your transfer."
    week.update(chip="wildcard", transfers=[move] * 9)
    assert transfer_idea(row) == "Plan: play your Wildcard (9 changes), +18.0 xP."
