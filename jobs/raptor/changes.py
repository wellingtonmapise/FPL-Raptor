"""Spotting what changed for each player between two fetches."""

from __future__ import annotations

from typing import Any

# The fields alerts care about: price, availability flag, news text, and the
# percentage chance of playing that FPL shows next to a flag.
TRACKED_FIELDS = ("now_cost", "status", "news", "chance_of_playing_next_round")


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    return text if text != "" else None


def diff_players(old: dict[int, dict], new: list[dict], now: str) -> list[dict]:
    """Compare stored players (by id) with freshly parsed ones.

    Returns one player_changes row per field that changed. Players we haven't
    seen before are skipped, so the very first run records nothing.
    """
    changes: list[dict] = []
    for player in new:
        before = old.get(player["id"])
        if before is None:
            continue
        for field in TRACKED_FIELDS:
            old_value = _as_text(before.get(field))
            new_value = _as_text(player.get(field))
            if old_value != new_value:
                changes.append(
                    {
                        "player_id": player["id"],
                        "field": field,
                        "old_value": old_value,
                        "new_value": new_value,
                        "seen_at": now,
                    }
                )
    return changes
