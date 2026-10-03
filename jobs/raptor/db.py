"""A small client for Supabase's REST API (PostgREST), using plain requests.

The jobs only need select, upsert, insert and update, so this avoids pulling
in the full Supabase SDK. It works with both key styles:

  * new secret keys (sb_secret_...) go in the `apikey` header only
  * legacy service_role keys (JWTs starting "eyJ") also go in Authorization
"""

from __future__ import annotations

from typing import Any, Iterable

import requests


class SupabaseError(Exception):
    pass


class Database:
    def __init__(self, url: str, key: str, session: requests.Session | None = None) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.session = session or requests.Session()
        headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):
            headers["Authorization"] = f"Bearer {key}"
        self.session.headers.update(headers)

    def _check(self, resp: requests.Response, what: str) -> requests.Response:
        if resp.status_code >= 400:
            raise SupabaseError(f"{what} failed: HTTP {resp.status_code} {resp.text[:300]}")
        return resp

    def select(
        self,
        table: str,
        columns: str = "*",
        filters: dict[str, str] | None = None,
        page_size: int = 1000,
    ) -> list[dict]:
        """All matching rows, paging past Supabase's 1,000-row response cap.

        filters use PostgREST syntax, e.g. {"gameweek_id": "eq.5"}.
        """
        rows: list[dict] = []
        offset = 0
        while True:
            params: dict[str, Any] = {"select": columns, "limit": page_size, "offset": offset}
            params.update(filters or {})
            resp = self._check(
                self.session.get(f"{self.base}/{table}", params=params, timeout=30),
                f"select {table}",
            )
            page = resp.json()
            rows.extend(page)
            if len(page) < page_size:
                return rows
            offset += page_size

    def upsert(self, table: str, rows: Iterable[dict], on_conflict: str, chunk_size: int = 500) -> int:
        """Insert rows, updating any that already exist. Returns rows sent."""
        rows = list(rows)
        for start in range(0, len(rows), chunk_size):
            self._check(
                self.session.post(
                    f"{self.base}/{table}",
                    params={"on_conflict": on_conflict},
                    json=rows[start : start + chunk_size],
                    headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                    timeout=60,
                ),
                f"upsert {table}",
            )
        return len(rows)

    def insert(self, table: str, rows: Iterable[dict], returning: bool = False) -> list[dict]:
        rows = list(rows)
        if not rows:
            return []
        resp = self._check(
            self.session.post(
                f"{self.base}/{table}",
                json=rows,
                headers={"Prefer": "return=representation" if returning else "return=minimal"},
                timeout=60,
            ),
            f"insert {table}",
        )
        return resp.json() if returning else []

    def update(self, table: str, values: dict, filters: dict[str, str]) -> None:
        if not filters:
            raise ValueError("update needs at least one filter")
        self._check(
            self.session.patch(
                f"{self.base}/{table}",
                params=filters,
                json=values,
                headers={"Prefer": "return=minimal"},
                timeout=30,
            ),
            f"update {table}",
        )
