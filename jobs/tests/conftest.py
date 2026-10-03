"""Shared test helpers: sample FPL data, a fake FPL client and an in-memory database."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture
def bootstrap() -> dict:
    return load("bootstrap.json")


@pytest.fixture
def fixtures_json() -> list:
    return load("fixtures.json")


@pytest.fixture
def standings() -> dict:
    return load("standings.json")


@pytest.fixture
def picks_json() -> dict:
    return load("picks.json")


class FakeFpl:
    """Stands in for FplClient, serving the sample files and counting picks calls."""

    polite_delay_seconds = 0

    def __init__(self) -> None:
        self.bootstrap_data = load("bootstrap.json")
        self.fixtures_data = load("fixtures.json")
        self.standings_data = {777: load("standings.json")}
        self.picks_data = load("picks.json")
        self.picks_calls: list[tuple[int, int]] = []

    def bootstrap(self) -> dict:
        return copy.deepcopy(self.bootstrap_data)

    def fixtures(self) -> list:
        return copy.deepcopy(self.fixtures_data)

    def league_standings(self, league_id: int):
        data = self.standings_data.get(league_id)
        return copy.deepcopy(data) if data else None

    def picks(self, team_id: int, gameweek_id: int):
        self.picks_calls.append((team_id, gameweek_id))
        return copy.deepcopy(self.picks_data)


class FakeDb:
    """A tiny in-memory version of raptor.db.Database.

    Supports the PostgREST filters the jobs use: eq.X, is.true, not.is.null.
    """

    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {}
        self._next_id = 1

    def rows(self, table: str) -> list[dict]:
        return self.tables.setdefault(table, [])

    @staticmethod
    def _matches(row: dict, filters: dict[str, str] | None) -> bool:
        for column, rule in (filters or {}).items():
            value = row.get(column)
            if rule.startswith("eq."):
                if str(value) != rule[3:]:
                    return False
            elif rule == "is.true":
                if value is not True:
                    return False
            elif rule == "not.is.null":
                if value is None:
                    return False
            else:
                raise NotImplementedError(rule)
        return True

    def select(self, table, columns="*", filters=None, page_size=1000):
        found = [r for r in self.rows(table) if self._matches(r, filters)]
        if columns == "*":
            return [dict(r) for r in found]
        wanted = columns.split(",")
        return [{c: r.get(c) for c in wanted} for r in found]

    def upsert(self, table, rows, on_conflict, chunk_size=500):
        keys = on_conflict.split(",")
        existing = self.rows(table)
        for row in rows:
            match = next((r for r in existing if all(r.get(k) == row[k] for k in keys)), None)
            if match is None:
                existing.append(dict(row))
            else:
                match.update(row)
        return len(rows)

    def insert(self, table, rows, returning=False):
        out = []
        for row in rows:
            stored = dict(row)
            if table == "job_runs":
                stored.setdefault("id", self._next_id)
                self._next_id += 1
            self.rows(table).append(stored)
            out.append(stored)
        return out if returning else []

    def update(self, table, values, filters):
        for row in self.rows(table):
            if self._matches(row, filters):
                row.update(values)


@pytest.fixture
def fake_fpl() -> FakeFpl:
    return FakeFpl()


@pytest.fixture
def fake_db() -> FakeDb:
    return FakeDb()
