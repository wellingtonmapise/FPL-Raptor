"""The plans job end to end, against an in-memory database and a fake FPL client."""

from datetime import datetime, timezone

from raptor.db import SupabaseError
from raptor.optimizer.run import MIGRATION, run_plans

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
GWS = [6, 7, 8, 9]


def build():
    elements, picks, xp_rows = [], [], []
    pid = 0
    for team in range(1, 13):
        for pos in (1, 2, 2, 3, 3, 4):
            pid += 1
            elements.append({"id": pid, "web_name": f"P{pid}", "team": team, "element_type": pos,
                             "now_cost": {1: 45, 2: 50, 3: 70, 4: 75}[pos], "cost_change_start": 0, "status": "a"})
    # Squad: 2 GK, 5 DEF, 5 MID, 3 FWD from clubs 1-8, each worth 4 xP; everyone else 2 xP...
    want = {1: 2, 2: 5, 3: 5, 4: 3}
    squad = []
    for e in elements:
        if want[e["element_type"]] and e["team"] <= 8 and sum(1 for s in squad if s["team"] == e["team"]) < 3:
            squad.append(e)
            want[e["element_type"]] -= 1
    squad_ids = {e["id"] for e in squad}
    star = next(e for e in elements if e["element_type"] == 3 and e["team"] == 12)
    for e in elements:
        for g in GWS:
            points = 4 if e["id"] in squad_ids else 2
            if e["id"] == star["id"]:
                points = 9  # ...except one standout midfielder
            xp_rows.append({"player_id": e["id"], "gameweek_id": g, "expected_points": points, "created_at": "2026-10-05T11:00:00+00:00"})
    for pos, e in enumerate(squad, 1):
        picks.append({"team_id": 1001, "gameweek_id": 5, "player_id": e["id"]})
    events = [{"id": g, "deadline_time": f"2026-{9 if g <= 5 else 10:02d}-{g * 3:02d}T10:00:00Z", "is_current": g == 5} for g in range(1, 11)]
    return {"events": events, "elements": elements}, picks, xp_rows, star


class FakeFpl:
    def __init__(self, bootstrap):
        self._bootstrap = bootstrap

    def bootstrap(self):
        return self._bootstrap

    def entry_history(self, team_id):
        return {"current": [{"event": e, "event_transfers": 0, "event_transfers_cost": 0, "bank": 5} for e in range(1, 6)], "chips": []}

    def entry_transfers(self, team_id):
        return []

    def picks(self, team_id, gameweek_id):
        return None


def seeded(fake_db):
    bootstrap, picks, xp_rows, star = build()
    fake_db.rows("profiles").append({"user_id": "u1", "fpl_team_id": 1001})
    fake_db.rows("picks").extend(picks)
    fake_db.rows("predictions").extend(xp_rows)
    return FakeFpl(bootstrap), star


def test_plan_saved_for_each_user(fake_db):
    fpl, star = seeded(fake_db)
    summary = run_plans(fpl, fake_db, NOW)
    assert summary.startswith("1 plan (1001: ")
    row = fake_db.rows("transfer_plans")[0]
    assert row["user_id"] == "u1" and row["from_gameweek"] == 6 and row["horizon"] == 4
    assert row["free_transfers"] == 5 and row["bank"] == 5  # five quiet weeks banked the maximum
    first = row["plan"]["weeks"][0]
    assert [t["in"]["name"] for t in first["transfers"]] == [star["web_name"]]
    assert first["captain"]["name"] == star["web_name"]
    assert len(first["lineup"]) == 11 and len(first["bench"]) == 4
    assert row["expected_points"] > row["baseline_points"]
    chips = {c["chip"]: c for c in row["plan"]["chips"]}
    assert set(chips) == {"wildcard", "freehit", "bboost", "3xc"}  # none used yet, all in the GW1-19 window
    assert all(c["expires"] == 19 and set(c["by_week"]) == {"6", "7", "8", "9"} for c in chips.values())
    assert row["plan"]["no_chip_points"] is not None


def test_plans_skip_politely_before_the_migration(fake_db):
    fpl, _ = seeded(fake_db)

    def upsert(table, rows, on_conflict, chunk_size=500):
        raise SupabaseError('upsert transfer_plans failed: HTTP 404 {"code":"PGRST205"}')

    fake_db.upsert = upsert
    assert run_plans(fpl, fake_db, NOW) == f"plans skipped (run {MIGRATION})"


def test_no_users(fake_db):
    assert run_plans(FakeFpl({"events": [], "elements": []}), fake_db, NOW) == "no users with a team yet"
