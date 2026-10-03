"""The HTTP clients, tested with a fake requests session (no network)."""

import pytest
import requests

from raptor.db import Database
from raptor.fpl import FplClient, FplUnavailable


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.headers = {}
        self.calls = []

    def _next(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def get(self, url, **kwargs):
        return self._next("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self._next("POST", url, **kwargs)

    def patch(self, url, **kwargs):
        return self._next("PATCH", url, **kwargs)


def client(responses):
    return FplClient(session=FakeSession(responses), backoff_seconds=0, polite_delay_seconds=0)


def test_fpl_sets_a_user_agent():
    fpl = client([])
    assert "fpl-raptor" in fpl.session.headers["User-Agent"]


def test_fpl_404_returns_none():
    assert client([FakeResponse(404)]).picks(1, 99) is None


def test_fpl_retries_then_succeeds():
    fpl = client([FakeResponse(503, text="The game is being updated."), FakeResponse(200, {"ok": 1})])
    assert fpl.get("bootstrap-static/") == {"ok": 1}


def test_fpl_gives_up_with_unavailable():
    fpl = client([FakeResponse(503), requests.ConnectionError("boom"), FakeResponse(502)])
    with pytest.raises(FplUnavailable):
        fpl.bootstrap()


def test_fpl_client_errors_are_not_retried():
    fpl = client([FakeResponse(403)])
    with pytest.raises(requests.HTTPError):
        fpl.get("entry/1/")


def test_league_standings_follows_pages(standings):
    page1 = {"league": standings["league"], "standings": {"has_next": True, "results": [{"entry": 1}]}}
    page2 = {"league": standings["league"], "standings": {"has_next": False, "results": [{"entry": 2}]}}
    fpl = client([FakeResponse(200, page1), FakeResponse(200, page2)])
    merged = fpl.league_standings(777)
    assert [r["entry"] for r in merged["standings"]["results"]] == [1, 2]
    pages = [call[2]["params"]["page_standings"] for call in fpl.session.calls]
    assert pages == [1, 2]


def test_db_secret_key_goes_in_apikey_only():
    db = Database("https://x.supabase.co/", "sb_secret_abc", session=FakeSession([]))
    assert db.session.headers["apikey"] == "sb_secret_abc"
    assert "Authorization" not in db.session.headers
    assert db.base == "https://x.supabase.co/rest/v1"


def test_db_accepts_the_rest_endpoint_form_of_the_url():
    for url in (
        "https://x.supabase.co",
        "https://x.supabase.co/",
        "https://x.supabase.co/rest/v1",
        "https://x.supabase.co/rest/v1/",
        "  https://x.supabase.co/rest/v1/\n",
    ):
        db = Database(url, "sb_secret_abc", session=FakeSession([]))
        assert db.base == "https://x.supabase.co/rest/v1", url


def test_db_error_includes_a_hint():
    from raptor.db import SupabaseError

    body = '{"code":"PGRST125","message":"Invalid path specified in request URL"}'
    db = Database("https://x.supabase.co", "sb_secret_abc", session=FakeSession([FakeResponse(404, text=body)]))
    with pytest.raises(SupabaseError, match="Hint: Check SUPABASE_URL"):
        db.insert("job_runs", [{"job": "fetch"}], returning=True)


def test_db_legacy_jwt_key_also_sets_authorization():
    db = Database("https://x.supabase.co", "eyJhbGciOi.fake", session=FakeSession([]))
    assert db.session.headers["Authorization"] == "Bearer eyJhbGciOi.fake"


def test_db_select_pages_past_the_row_cap():
    session = FakeSession([FakeResponse(200, [{"id": 1}, {"id": 2}]), FakeResponse(200, [{"id": 3}])])
    db = Database("https://x.supabase.co", "sb_secret_abc", session=session)
    rows = db.select("players", "id", page_size=2)
    assert [r["id"] for r in rows] == [1, 2, 3]
    assert [c[2]["params"]["offset"] for c in session.calls] == [0, 2]


def test_db_upsert_chunks_and_merges():
    session = FakeSession([FakeResponse(201), FakeResponse(201)])
    db = Database("https://x.supabase.co", "sb_secret_abc", session=session)
    sent = db.upsert("players", [{"id": i} for i in range(3)], on_conflict="id", chunk_size=2)
    assert sent == 3
    assert [len(c[2]["json"]) for c in session.calls] == [2, 1]
    assert session.calls[0][2]["params"] == {"on_conflict": "id"}
    assert "merge-duplicates" in session.calls[0][2]["headers"]["Prefer"]


def test_db_errors_raise():
    from raptor.db import SupabaseError

    session = FakeSession([FakeResponse(401, text='{"message":"Invalid API key"}')])
    db = Database("https://x.supabase.co", "sb_secret_bad", session=session)
    with pytest.raises(SupabaseError, match="401"):
        db.select("players")
