"""The whole fetch, end to end, against the fake FPL client and in-memory database."""

from raptor.config import Settings, parse_ids
from raptor.run import run_once

SETTINGS = Settings(supabase_url="https://x.supabase.co", supabase_secret_key="sb_secret_x", league_ids=(777,))


def test_parse_ids():
    assert parse_ids("1086012, 250845") == (1086012, 250845)
    assert parse_ids("") == ()


def test_first_run_fills_every_table(fake_fpl, fake_db):
    summary = run_once(fake_fpl, fake_db, SETTINGS)

    assert len(fake_db.rows("teams")) == 3
    assert len(fake_db.rows("players")) == 4
    assert fake_db.rows("player_changes") == []
    assert len(fake_db.rows("gameweeks")) == 3
    assert len(fake_db.rows("fixtures")) == 3
    assert fake_db.rows("leagues")[0]["name"] == "Test League"
    assert len(fake_db.rows("league_members")) == 3
    # 3 managers x 2 gameweeks (previous GW4 + current GW5)
    assert len(fake_db.rows("entry_gameweeks")) == 6
    assert len(fake_db.rows("picks")) == 6 * 4
    assert "players 4 (0 changes)" in summary
    assert "squads for 3 managers (GW4: 3 saved; GW5: 3 saved)" in summary


def test_final_gameweek_marked_and_not_refetched(fake_fpl, fake_db):
    run_once(fake_fpl, fake_db, SETTINGS)
    entries = {(r["team_id"], r["gameweek_id"]): r for r in fake_db.rows("entry_gameweeks")}
    assert entries[(1001, 4)]["final"] is True  # GW4 is finished and data_checked
    assert entries[(1001, 5)]["final"] is False  # GW5 points not confirmed yet

    fake_fpl.picks_calls.clear()
    summary = run_once(fake_fpl, fake_db, SETTINGS)
    # Only the unconfirmed gameweek is fetched again.
    assert sorted(fake_fpl.picks_calls) == [(1001, 5), (1002, 5), (1003, 5)]
    assert "GW4: 0 saved, 3 already final" in summary


def test_second_run_records_player_changes(fake_fpl, fake_db):
    run_once(fake_fpl, fake_db, SETTINGS)

    haaland = next(p for p in fake_fpl.bootstrap_data["elements"] if p["id"] == 303)
    haaland["now_cost"] = 146
    haaland["status"] = "i"
    run_once(fake_fpl, fake_db, SETTINGS)

    changes = {(c["player_id"], c["field"]): c for c in fake_db.rows("player_changes")}
    assert set(changes) == {(303, "now_cost"), (303, "status")}
    assert changes[(303, "now_cost")]["new_value"] == "146"
    stored = next(p for p in fake_db.rows("players") if p["id"] == 303)
    assert stored["now_cost"] == 146


def test_signed_up_users_are_tracked_too(fake_fpl, fake_db):
    fake_db.rows("profiles").append({"user_id": "u1", "fpl_team_id": 5555})
    run_once(fake_fpl, fake_db, SETTINGS)
    assert (5555, 5) in fake_fpl.picks_calls


def test_unknown_league_is_skipped(fake_fpl, fake_db):
    settings = Settings(supabase_url="u", supabase_secret_key="k", league_ids=(424242,))
    summary = run_once(fake_fpl, fake_db, settings)
    assert fake_db.rows("leagues") == []
    assert "leagues 0 (0 managers)" in summary
    assert "squads: no managers tracked yet" in summary


def test_summary_explains_when_fpl_returns_no_squads(fake_fpl, fake_db):
    fake_fpl.picks = lambda team_id, gameweek_id: None
    fake_fpl.last_not_found = "404 on entry/1001/event/5/picks/: 'Not found'"
    summary = run_once(fake_fpl, fake_db, SETTINGS)
    assert "squads for 3 managers (GW4: 0 saved, 3 not found; GW5: 0 saved, 3 not found)" in summary
    assert "FPL said 404 on entry/1001/event/5/picks/" in summary
