from raptor.fpl import (
    format_price,
    gameweeks_to_refresh,
    parse_fixtures,
    parse_gameweeks,
    parse_league,
    parse_picks,
    parse_players,
    parse_teams,
)

NOW = "2026-10-03T12:00:00+00:00"


def test_money_is_tenths_of_a_million():
    assert format_price(1009) == "£100.9m"
    assert format_price(3) == "£0.3m"
    assert format_price(65) == "£6.5m"
    assert format_price(None) == "-"


def test_parse_teams(bootstrap):
    teams = parse_teams(bootstrap, NOW)
    assert {"id": 6, "name": "Chelsea", "short_name": "CHE", "updated_at": NOW} in teams


def test_parse_players_maps_fields_and_numbers(bootstrap):
    players = {p["id"]: p for p in parse_players(bootstrap, NOW)}
    palmer = players[202]
    assert palmer["team_id"] == 6
    assert palmer["position"] == 3
    assert palmer["now_cost"] == 105
    assert palmer["status"] == "d"
    assert palmer["chance_of_playing_next_round"] == 75
    assert palmer["selected_by_percent"] == 35.0  # FPL sends "35.0" as a string
    assert palmer["form"] == 6.8
    assert players[404]["selected_by_percent"] is None  # empty string -> None
    assert players[101]["news"] == ""


def test_parse_gameweeks(bootstrap):
    gws = {g["id"]: g for g in parse_gameweeks(bootstrap, NOW)}
    assert gws[5]["is_current"] is True
    assert gws[6]["is_next"] is True
    assert gws[6]["deadline_time"] == "2026-10-03T10:00:00Z"


def test_parse_fixtures_keeps_unscheduled(fixtures_json):
    fixtures = {f["id"]: f for f in parse_fixtures(fixtures_json, NOW)}
    assert fixtures[41]["home_team_id"] == 1 and fixtures[41]["away_team_id"] == 6
    assert fixtures[41]["home_score"] == 2
    assert fixtures[99]["gameweek_id"] is None
    assert fixtures[99]["kickoff_time"] is None


def test_gameweeks_to_refresh_is_current_and_previous(bootstrap):
    assert [g["id"] for g in gameweeks_to_refresh(bootstrap)] == [4, 5]


def test_parse_league(standings):
    league, members = parse_league(standings, NOW)
    assert league == {"id": 777, "name": "Test League", "updated_at": NOW}
    assert len(members) == 3
    second = members[1]
    assert second["team_id"] == 1002
    assert second["rank"] == 2 and second["last_rank"] == 4
    assert second["manager_name"] == "Manager Two"


def test_parse_picks(picks_json):
    entry, picks = parse_picks(1001, 5, picks_json, final=False, now=NOW)
    assert entry["points"] == 50
    assert entry["bank"] == 3 and entry["value"] == 1009
    assert entry["points_on_bench"] == 6
    assert entry["final"] is False
    captain = [p for p in picks if p["is_captain"]]
    assert captain == [
        {
            "team_id": 1001,
            "gameweek_id": 5,
            "player_id": 303,
            "squad_position": 2,
            "multiplier": 2,
            "is_captain": True,
            "is_vice_captain": False,
        }
    ]
    assert [p["player_id"] for p in picks if p["multiplier"] == 0] == [404]
