"""Gameweek recaps: the facts given to the model, parsing its reply, and the job."""

from datetime import datetime, timezone

import pytest

from raptor.db import SupabaseError
from raptor.recaps import (
    MIGRATION,
    RecapUnavailable,
    league_facts,
    parse_reply,
    rank_models,
    recap_cards,
    run_recaps,
    split_recap,
    write_recap,
)

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
        "team_id": 1,
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
    """Answers per model: a status code, or text for a 200. Lists `models` (default: the answers' keys)."""

    def __init__(self, answers, models=None):
        self.answers, self.calls = answers, []
        self.models = list(answers) if models is None else models

    def get(self, url, headers, timeout):
        return FakeResponse(200, {"data": [{"id": f"models/{m}"} for m in self.models]})

    def post(self, url, headers, json, timeout):
        self.calls.append(json["model"])
        answer = self.answers.get(json["model"], 404)
        if isinstance(answer, int):
            return FakeResponse(answer, payload=[{"error": {"code": answer, "message": "nope"}}], text="nope")
        return FakeResponse(200, {"choices": [{"message": {"content": answer}}]})


def test_rank_models_prefers_current_flash_text_models():
    ids = ["models/gemini-3-flash", "models/gemini-3.1-flash-lite", "models/gemini-flash-latest", "models/gemini-3.5-flash-preview",
           "models/gemini-3-pro", "models/gemini-3-flash-image", "models/gemini-3.5-flash", "models/text-embedding-004",
           "models/gemini-flash-lite-latest"]
    assert rank_models(ids) == [
        "gemini-flash-latest", "gemini-3.5-flash", "gemini-3-flash", "gemini-3.5-flash-preview",
        "gemini-flash-lite-latest", "gemini-3.1-flash-lite",
    ]


def test_write_recap_uses_fallback_aliases_when_the_list_is_unavailable():
    session = FakeSession({"gemini-flash-lite-latest": "Lite Week\n\nWords."}, models=[])
    assert write_recap({"x": 1}, "token", session, sleep=lambda s: None) == ("gemini-flash-lite-latest", "Lite Week", "Words.", {})
    assert session.calls == ["gemini-flash-latest", "gemini-flash-lite-latest"]


def test_write_recap_retries_busy_models_then_falls_back():
    waits = []
    session = FakeSession({"gemini-flash-latest": 503, "gemini-3-flash": "Big Week\n\nWords."})
    assert write_recap({"x": 1}, "token", session, sleep=waits.append) == ("gemini-3-flash", "Big Week", "Words.", {})
    assert session.calls == ["gemini-flash-latest"] * 3 + ["gemini-3-flash"]  # two retries, then the next model
    assert waits == [5, 20]
    with pytest.raises(RecapUnavailable, match="HTTP 400 nope"):
        write_recap({"x": 1}, "token", FakeSession({"gemini-flash-latest": 400}), sleep=waits.append)


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
    assert run_recaps(fake_db, NOW, "token", FakeSession({}, models=[])) == "waiting for final points in BiG ReD"
    assert run_recaps(fake_db, NOW, None) == "recaps skipped (no GEMINI_API_KEY secret)"


def test_run_reports_model_failures_and_skips_before_the_migration(fake_db):
    seed(fake_db)
    assert run_recaps(fake_db, NOW, "token", FakeSession({}, models=[])).startswith("failed: BiG ReD: gemini-flash-latest: HTTP 404")

    original = fake_db.select

    def select(table, *args, **kwargs):
        if table == "recaps":
            raise SupabaseError('select recaps failed: HTTP 404 {"code":"PGRST205"}')
        return original(table, *args, **kwargs)

    fake_db.select = select
    assert run_recaps(fake_db, NOW, "token") == f"recaps skipped (run {MIGRATION})"


def test_cards_hand_out_the_week_s_awards():
    facts = league_facts(LEAGUE, 6, MEMBERS, ENTRIES, picks(), NAMES, POINTS)
    cards = {c["id"]: (c["manager"], c["stat"]) for c in recap_cards(facts)}
    assert cards == {
        "top": ("Wellington", "74 points"),
        "rocket": ("Wellington", "2nd to 1st"),
        "captain_hero": ("Wellington", "Salah: 30 points"),
        "lone": ("Wellington", "Salah: 15 points, nobody else had him"),
        "chip": ("Benjamin", "Triple Captain: 41 points"),
        "bench": ("Takunda", "19 points on the bench"),
        "captain_fail": ("Takunda", "Haaland: 4 points"),
        "hit": ("Takunda", "−4 hit, 48 points"),
        "freefall": ("Takunda", "1st to 2nd"),
        "spoon": ("Benjamin", "41 points"),
    }
    first = recap_cards(facts)[0]
    assert first["title"] == "Top Dog" and first["team_id"] == 1


def test_parse_reply_reads_json_and_falls_back_to_text():
    reply = '```json\n{"headline": "Bench Disasterclass", "captions": {"bench": "Nineteen points, all of them decorative.", "made_up": "x"}, "recap": "Para one.\\n\\nPara two."}\n```'
    assert parse_reply(reply, ["bench", "top"]) == ("Bench Disasterclass", "Para one.\n\nPara two.", {"bench": "Nineteen points, all of them decorative."})
    assert parse_reply("Plain Headline\n\nJust words.", ["bench"]) == ("Plain Headline", "Just words.", {})


def test_model_sees_cards_but_not_team_ids(fake_db):
    seed(fake_db)
    seen = {}

    class Spy(FakeSession):
        def post(self, url, headers, json, timeout):
            seen["facts"] = json["messages"][1]["content"]
            return super().post(url, headers, json, timeout)

    reply = '{"headline": "Salah Saves the Banker", "captions": {"bench": "Nineteen on the pine."}, "recap": "Roast."}'
    run_recaps(fake_db, NOW, "token", Spy({"gemini-flash-latest": reply}))
    assert '"award_cards"' in seen["facts"] and '"team_id"' not in seen["facts"]
    row = fake_db.rows("recaps")[0]
    bench = next(c for c in row["cards"] if c["id"] == "bench")
    assert bench == {"id": "bench", "kind": "bench", "title": "Bench Warmer", "manager": "Takunda", "team_id": 2, "stat": "19 points on the bench", "caption": "Nineteen on the pine."}
    assert row["title"] == "Salah Saves the Banker" and row["body"] == "Roast."


def test_recaps_without_cards_are_redone(fake_db):
    seed(fake_db)
    fake_db.rows("recaps").append({"league_id": 1086012, "gameweek_id": 6, "title": "Old", "body": "Old.", "model": "m", "cards": None})
    reply = '{"headline": "New", "captions": {}, "recap": "New recap."}'
    assert run_recaps(fake_db, NOW, "token", FakeSession({"gemini-flash-latest": reply})).startswith("GW6 recap written")
    assert fake_db.rows("recaps")[0]["title"] == "New" and fake_db.rows("recaps")[0]["cards"]
