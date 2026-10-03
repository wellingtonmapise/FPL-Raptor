"""What the optimizer needs to know about a manager, from public FPL data.

FPL only shows free transfers and selling prices to the manager themselves,
so both are worked out from public history:

* free transfers: start with 1 after the first gameweek, gain one a week,
  bank up to 5; free transfers used come off, paid ones (−4 each) don't.
  A Wildcard or Free Hit week uses none.
* selling price: FPL lets you keep half of any rise (rounded down) and takes
  the whole of any fall. The purchase price comes from the manager's public
  transfer list, or the player's start-of-season price if they've been in
  the squad since the start.
"""

from __future__ import annotations

MAX_FREE_TRANSFERS = 5


def free_transfers(history: dict) -> int:
    """Free transfers available for the next deadline, from entry/{id}/history/."""
    weeks = sorted(history.get("current", []), key=lambda w: w["event"])
    if not weeks:
        return 1
    chips = {c["event"]: c["name"] for c in history.get("chips", [])}
    ft = None
    for week in weeks:
        if ft is None:  # the manager's first gameweek: unlimited changes, then 1
            ft = 1
            continue
        if chips.get(week["event"]) in ("wildcard", "freehit"):
            ft = min(MAX_FREE_TRANSFERS, ft + 1)
            continue
        made = week.get("event_transfers") or 0
        paid = (week.get("event_transfers_cost") or 0) // 4
        used_free = max(0, made - paid)
        ft = min(MAX_FREE_TRANSFERS, max(0, ft - used_free) + 1)
    return ft


def bank(history: dict) -> int:
    weeks = sorted(history.get("current", []), key=lambda w: w["event"])
    return (weeks[-1].get("bank") or 0) if weeks else 0


def selling_price(purchase: int, now: int) -> int:
    """FPL keeps half of any rise (rounded down to 0.1m) and passes on all of any fall."""
    if now <= purchase:
        return now
    return purchase + (now - purchase) // 2


def purchase_prices(squad: set[int], transfers: list[dict], elements: dict[int, dict]) -> dict[int, int]:
    """Price paid for each squad player: their latest transfer in, else their start price."""
    paid: dict[int, int] = {}
    for t in sorted(transfers, key=lambda t: t.get("time") or ""):
        if t["element_in"] in squad:
            paid[t["element_in"]] = t["element_in_cost"]
    for pid in squad:
        if pid not in paid and pid in elements:
            e = elements[pid]
            paid[pid] = e["now_cost"] - (e.get("cost_change_start") or 0)
    return paid
