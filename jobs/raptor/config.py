"""Settings, read from environment variables (GitHub secrets or a local .env)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_secret_key: str
    league_ids: tuple[int, ...]


def parse_ids(raw: str) -> tuple[int, ...]:
    """'1086012, 250845' -> (1086012, 250845). Blank -> ()."""
    return tuple(int(part) for part in raw.replace(" ", "").split(",") if part)


def load_settings() -> Settings:
    missing = [name for name in ("SUPABASE_URL", "SUPABASE_SECRET_KEY") if not os.environ.get(name)]
    if missing:
        raise SystemExit(
            f"Missing environment variables: {', '.join(missing)}. "
            "Set them as GitHub repo secrets, or in jobs/.env for local runs."
        )
    return Settings(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_secret_key=os.environ["SUPABASE_SECRET_KEY"],
        league_ids=parse_ids(os.environ.get("FPL_LEAGUE_IDS", "")),
    )
