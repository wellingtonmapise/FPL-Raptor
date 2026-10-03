"""The points model's live path: same features as training, sensible predictions."""

from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from raptor.model.features import FEATURES, availability_factor, build_features
from raptor.model.predict import HORIZON, fixtures_frame, history_rows, load_model, player_stats_rows, predict

TEAMS = [1, 2, 3, 4]


def make_fixtures(n_gws=10, played=5):
    """Round robin-ish: every gameweek, 1v2 and 3v4 (home/away alternating)."""
    out, fid = [], 0
    for gw in range(1, n_gws + 1):
        pairs = [(1, 2), (3, 4)] if gw % 2 else [(2, 3), (4, 1)]
        for h, a in pairs:
            fid += 1
            done = gw <= played
            out.append(
                {
                    "id": fid,
                    "event": gw,
                    "kickoff_time": f"2026-08-{gw * 2 + 10:02d}T15:00:00Z",
                    "team_h": h,
                    "team_a": a,
                    "team_h_score": (gw + h) % 3 if done else None,
                    "team_a_score": (gw + a) % 2 if done else None,
                    "finished": done,
                    "team_h_difficulty": 2 + h % 3,
                    "team_a_difficulty": 2 + a % 3,
                }
            )
    return out


def make_bootstrap(n_gws=10, played=5):
    elements = []
    for team in TEAMS:
        for k, pos in enumerate((3, 4)):
            pid = team * 10 + k
            elements.append(
                {"id": pid, "web_name": f"P{pid}", "team": team, "element_type": pos, "now_cost": 60 + pid % 7 * 10,
                 "status": "a", "chance_of_playing_next_round": None}
            )
    elements[0].update(status="i", chance_of_playing_next_round=0)  # player 10 injured
    events = [
        {"id": gw, "deadline_time": f"2026-08-{gw * 2 + 9:02d}T10:00:00Z", "finished": gw <= played, "is_current": gw == played}
        for gw in range(1, n_gws + 1)
    ]
    return {"events": events, "elements": elements}


def make_live(bootstrap, fixtures, played=5):
    live = {}
    for gw in range(1, played + 1):
        gw_fixtures = [f for f in fixtures if f["event"] == gw]
        elements = []
        for p in bootstrap["elements"]:
            fx = next(f for f in gw_fixtures if p["team"] in (f["team_h"], f["team_a"]))
            star = p["id"] % 10 == 1  # forwards score more
            stats = {
                "minutes": 90 if star or gw % 2 else 60,
                "starts": 1,
                "total_points": 7 if star else 2,
                "expected_goals": "0.55" if star else "0.05",
                "expected_assists": "0.10",
                "expected_goals_conceded": "1.10",
                "bps": 25 if star else 10,
                "bonus": 2 if star else 0,
                "ict_index": "9.5" if star else "3.0",
                "defensive_contribution": 4,
            }
            elements.append({"id": p["id"], "stats": stats, "explain": [{"fixture": fx["id"], "stats": []}]})
        live[gw] = {"elements": elements}
    return live


NOW = datetime(2026, 8, 20, 12, 0, tzinfo=timezone.utc)  # after GW5's deadline, before GW6's


def test_availability_factor():
    assert availability_factor("a", None, 1) == 1.0
    assert availability_factor("i", None, 1) == 0.0
    assert availability_factor("d", 75, 1) == 0.75
    assert availability_factor("d", 50, 2) == pytest.approx(0.5 + 0.5 / 3)
    assert availability_factor("i", 0, 4) == 1.0  # assumed back after three weeks
    assert availability_factor("n", 0, 5) == 0.0  # left the club: stays out


def test_upcoming_fixtures_see_the_same_form_as_training_would():
    """Live features for an upcoming fixture = training features for that fixture."""
    rng = np.random.default_rng(0)
    n = 9
    base = {
        "season": "2026-27", "element": 7, "team": 1, "opponent": 2, "position": 3, "value": 65.0,
    }
    rows = pd.DataFrame(
        [
            {**base, "fixture": i, "gameweek": i, "kickoff_time": f"2026-08-{i + 10:02d}T15:00:00Z", "was_home": i % 2,
             "minutes": float(rng.integers(0, 91)), "starts": 1.0, "points": float(rng.integers(0, 9)),
             "xg": rng.random(), "xa": rng.random(), "xgc": rng.random(), "bps": float(rng.integers(0, 30)),
             "bonus": float(rng.integers(0, 3)), "ict": rng.random() * 10, "dc": float(rng.integers(0, 12))}
            for i in range(1, n + 1)
        ]
    )
    fixtures = pd.DataFrame(
        [{"season": "2026-27", "fixture": i, "kickoff_time": f"2026-08-{i + 10:02d}T15:00:00Z", "team_h": 1, "team_a": 2,
          "team_h_score": 1.0, "team_a_score": 0.0, "team_h_difficulty": 3, "team_a_difficulty": 3} for i in range(1, n + 1)]
    )
    history_cols = [f for f in FEATURES if f.split("_l")[0] in {"points", "minutes", "starts", "xg", "xa", "xgc", "bps", "bonus", "ict", "dc"}
                    or f in ("games_so_far", "season_points_per_game", "season_minutes_per_game")]

    training = build_features(rows, fixtures).set_index("fixture")
    live_rows = rows.copy()
    stats = ["minutes", "starts", "points", "xg", "xa", "xgc", "bps", "bonus", "ict", "dc"]
    live_rows.loc[live_rows["fixture"] >= 7, stats] = np.nan  # fixtures 7-9 are "upcoming"
    live = build_features(live_rows, fixtures).set_index("fixture")

    pd.testing.assert_series_equal(training.loc[7, history_cols], live.loc[7, history_cols], check_names=False)
    # Further-ahead fixtures still see form as of the last match played (fixture 6).
    pd.testing.assert_series_equal(live.loc[9, history_cols], live.loc[7, history_cols], check_names=False)
    assert live.loc[9, "points_l3"] == rows.loc[rows.fixture.isin([4, 5, 6]), "points"].mean()


def test_predict_end_to_end_with_the_saved_model():
    model, meta = load_model()
    bootstrap, fixtures = make_bootstrap(), make_fixtures()
    live = make_live(bootstrap, fixtures)
    out = predict(bootstrap, fixtures, live, model, meta["features"], NOW)

    assert sorted(out["gameweek_id"].unique()) == [6, 7, 8, 9, 10][:HORIZON]
    assert len(out) == len(bootstrap["elements"]) * HORIZON
    assert (out["expected_points"] >= 0).all()
    gw6 = out[out.gameweek_id == 6].set_index("player_id")["expected_points"]
    # The injured player is out next week; prolific forwards beat quiet midfielders.
    assert gw6[10] == 0
    assert gw6[[21, 31, 41]].mean() > gw6[[20, 30, 40]].mean()
    later = out[(out.player_id == 10) & (out.gameweek_id == 9)]["expected_points"].iloc[0]
    assert later > 0  # assumed back by then


def test_blank_gameweek_predicts_zero():
    model, meta = load_model()
    bootstrap, fixtures = make_bootstrap(), make_fixtures()
    fixtures = [f for f in fixtures if not (f["event"] == 7 and 1 in (f["team_h"], f["team_a"]))]  # team 1 blanks GW7
    out = predict(bootstrap, fixtures, make_live(bootstrap, fixtures), model, meta["features"], NOW)
    gw7 = out[out.gameweek_id == 7].set_index("player_id")["expected_points"]
    assert gw7[11] == 0 and gw7[21] == 0  # both sides of the removed fixture blank
    assert gw7[31] > 0


def test_player_stats_for_the_scout_page():
    model, meta = load_model()
    bootstrap, fixtures = make_bootstrap(), make_fixtures()
    for p in bootstrap["elements"]:
        p.update(minutes=450, goals_scored=2, expected_goals="1.83", points_per_game="4.6", ict_index="31.2")
    live = make_live(bootstrap, fixtures)
    out = predict(bootstrap, fixtures, live, model, meta["features"], NOW)
    history = history_rows(live, bootstrap, fixtures_frame(fixtures, "2026-27"), "2026-27")
    rows = {r["player_id"]: r for r in player_stats_rows(bootstrap, history, out, NOW)}
    star = rows[21]
    assert star["minutes"] == 450 and star["goals"] == 2 and star["xg"] == 1.83 and star["points_per_game"] == 4.6
    assert star["recent_gameweeks"] == 5 and star["recent_points"] == 35 and star["recent_xg"] == 2.75
    assert star["xp_gameweek"] == 6
    assert star["xp_next5"] == round(out[out.player_id == 21]["expected_points"].sum(), 2)
    assert rows[10]["xp_next"] == 0  # injured


def test_player_stats_skip_politely_before_the_migration(fake_db):
    from raptor.db import SupabaseError
    from raptor.model.predict import save_player_stats

    def upsert(*args, **kwargs):
        raise SupabaseError('upsert player_stats failed: HTTP 404 {"code":"PGRST205"}')

    fake_db.upsert = upsert
    assert save_player_stats(fake_db, [{"player_id": 1}]).startswith("scout stats skipped")
