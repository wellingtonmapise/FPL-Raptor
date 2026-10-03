"""Gameweek recaps: the facts given to the model, parsing its reply, and the job."""

from datetime import datetime, timezone

import pytest

from raptor.db import SupabaseError
from raptor.recaps import MIGRATION, RecapUnavailable, league_facts, run_recaps, split_recap, write_recap

NOW = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
LEAGUE = {"id": 1086012, "name": "BiG ReD"}
MEMBERS = [
    {"league_id": 1086012, "team_id": 1, "manager_name": "Wellington Mapise", "team_name": "JP Morgan", "rank": 1, "last_rank": 2, "total": 420},
    {"league_id": 1086012, "team_id": 2, "manager_name": "Takunda Chikuvire", "team_name": "CF Madhunatwuna", "rank": 2, "last_rank": 1, "total": 410},
    {"league_id": 1086012, "team_id": 3, "manager_name": "Benjamin Karanja", "team_name": "Kilgoris", "rank": 3, "last_rank": 3, "total": 350},
]
NAMES = {9: "Haaland", 7: "Salah", 5: "Palmer", 6: "Saka", 20: "Semenyo"}
POINTS = {9: 2, 7: 15, 5: 6, 6: 11, 20: 12}


def picks():
    rows = []
    for team, captain, extra in ((1, 7, 20), (2, 9, 6), (3, 9, 5)):
        rows.append({"team_id": team, "player_id": captain, "multiplier": 2, "is_captain": True})
        rows.append({"team_id": team, "player_id": extra, "multiplier": 1, "is_captain": False})
    return rows


ENTRIES = {
    1: {"team_id": 1, "points": 74, "event_transfers": 1, "event_transfers_cost": 0, "points_on_bench": 3, "active_chip": None, "final": True},
    2: {"team_id": 2, "points": 52, "event_transfers": 2, "event_transfers_cost": 4, "points_on_bench": 19, "active_chip": None, "final": True},
    3: {"team_id": 3, "points": 41, "event_transfers": 0, "event_transfers_cost": 0, "points_on_bench": 1, "active_chip": "3xc", "final": True},
}


def test_facts_cover_scores_captains_and_movement():
    facts = league_facts(LEAGUE, 6, MEMBERS, ENTRIES, picks(), NAMES, POINTS)
    welly, taku, ben = facts["managers"]
    assert welly == {
        "name": "Wellington", "team": "JP Morgan", "points": 74, "hit_cost": 0, "transfers": 1, "chip": None,
        "captain": "Salah", "captain_points": 30, "bench_points": 3, "best_player": "Salah (15)",
        "rank_now": 1, "rank_before": 2, "total": 420,
    }
    assert taku["points"] == 48 and taku["hit_cost"] == 4 and taku["captain_points"] == 4
    assert ben["chip"] == "Triple Captain"
    assert facts["most_captained"] == ["Haaland x2", "Salah x1"]
    assert facts["leader"] == "Wellington (420)" and facts["lead_over_second"] == 10
    assert facts["average"] == pytest.approx((74 + 48 + 41) / 3, abs=0.05)
    # Salah (15), Semenyo (12) and Saka (11) were each in one squad; Palmer only scored 6.
    heroes = facts["players_only_one_manager_had_who_scored_10_plus"]
    assert [(h["player"], h["owner"]) for h in heroes] == [("Salah", "Wellington"), ("Semenyo", "Wellington"), ("Saka", "Takunda")]


def test_split_recap():
    assert split_recap("**Salah Saves the Banker**\n\nWellington...\n\nMore.") == ("Salah Saves the Banker", "Wellington...\n\nMore.")
    assert split_recap('Headline: "Bench of Doom"\nTakunda left 19 on the bench.') == ("Bench of Doom", "Takunda left 19 on the bench.")
    with pytest.raises(RecapUnavailable):
        split_recap("  \n ")


class FakeResponse:
    def __init__(self, status, payload=None, text=""):
        self.status_code, self._payload, self.text = status, payload, text
        self.ok = 200 <= status < 300

    def json(self):
        return self._payload


class FakeSession:
    """Answers per model: a status code, or text for a 200."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def post(self, url, headers, json, timeout):
        self.calls.append(json["model"])
        answer = self.answers.get(json["model"], 404)
        if isinstance(answer, int):
            return FakeResponse(answer, text='{"error": "nope"}')
        return FakeResponse(200, {"choices": [{"message": {"content": answer}}]})


def test_write_recap_falls_back_to_the_next_model():
    session = FakeSession({"gemini-flash-latest": 429, "gemini-2.5-flash": "Big Week\n\nWords."})
    assert write_recap({"x": 1}, "token", session) == ("gemini-2.5-flash", "Big Week", "Words.")
    assert session.calls == ["gemini-flash-latest", "gemini-2.5-flash"]
    with pytest.raises(RecapUnavailable, match="HTTP 429"):
        write_recap({"x": 1}, "token", FakeSession({"gemini-flash-latest": 429}))


def seed(fake_db):
    fake_db.rows("gameweeks").extend(
        [{"id": 5, "finished": True, "data_checked": True}, {"id": 6, "finished": True, "data_checked": True}, {"id": 7, "finished": False, "data_checked": False}]
    )
    fake_db.rows("leagues").append(dict(LEAGUE))
    fake_db.rows("league_members").extend(MEMBERS)
    fake_db.rows("entry_gameweeks").extend({**e, "gameweek_id": 6} for e in ENTRIES.values())
    fake_db.rows("picks").extend({**p, "gameweek_id": 6} for p in picks())
    fake_db.rows("players").extend({"id": k, "web_name": v} for k, v in NAMES.items())
    fake_db.rows("player_gameweeks").extend({"player_id": k, "gameweek_id": 6, "points": v} for k, v in POINTS.items())


def test_run_writes_one_recap_per_league_per_gameweek(fake_db):
    seed(fake_db)
    session = FakeSession({"gemini-flash-latest": "Salah Saves the Banker\n\nRoast."})
    summary = run_recaps(fake_db, NOW, "token", session)
    assert summary == "GW6 recap written for BiG ReD (gemini-flash-latest): Salah Saves the Banker"
    (row,) = fake_db.rows("recaps")
    assert row["league_id"] == 1086012 and row["gameweek_id"] == 6 and row["body"] == "Roast."
    assert run_recaps(fake_db, NOW, "token", session) == "GW6 recaps already written"
    assert len(session.calls) == 1


def test_run_waits_for_final_points_and_needs_a_token(fake_db):
    seed(fake_db)
    for e in fake_db.rows("entry_gameweeks")[:2]:
        e["final"] = False
    assert run_recaps(fake_db, NOW, "token", FakeSession({})) == "waiting for final points in BiG ReD"
    assert run_recaps(fake_db, NOW, None) == "recaps skipped (no GEMINI_API_KEY secret)"


def test_run_reports_model_failures_and_skips_before_the_migration(fake_db):
    seed(fake_db)
    assert run_recaps(fake_db, NOW, "token", FakeSession({})).startswith("failed: BiG ReD: gemini-flash-latest: HTTP 404")

    original = fake_db.select

    def select(table, *args, **kwargs):
        if table == "recaps":
            raise SupabaseError('select recaps failed: HTTP 404 {"code":"PGRST205"}')
        return original(table, *args, **kwargs)

    fake_db.select = select
    assert run_recaps(fake_db, NOW, "token") == f"recaps skipped (run {MIGRATION})"
