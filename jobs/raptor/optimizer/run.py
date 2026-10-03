"""Transfer plans for every signed-up manager.

    uv run python -m raptor.optimizer.run

Runs after the predictions. For each user with a team: reads their latest
squad, works out free transfers, bank and selling prices from public FPL
data, and solves a 4-gameweek plan with the model's expected points. Saves
it to transfer_plans, alongside the "no transfers" baseline.
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone

from raptor.config import load_settings
from raptor.db import Database, SupabaseError
from raptor.fpl import FplClient, FplUnavailable
from raptor.model.predict import load_model
from raptor.optimizer.inputs import bank, free_transfers, purchase_prices, selling_price
from raptor.optimizer.solve import Plan, Player, candidate_pool, solve
from raptor.run import announce, utc_now

log = logging.getLogger("raptor.plans")

HORIZON = 4
JOB_NAME = "plans"
MIGRATION = "supabase/migrations/20261003000002_transfer_plans.sql"


def _in(values) -> str:
    return "in.(" + ",".join(str(v) for v in values) + ")"


def latest_predictions(db: Database, gameweeks: list[int]) -> dict[tuple[int, int], float]:
    newest: dict[tuple[int, int], dict] = {}
    for row in db.select("predictions", "player_id,gameweek_id,expected_points,created_at", {"gameweek_id": _in(gameweeks)}):
        key = (row["player_id"], row["gameweek_id"])
        if key not in newest or row["created_at"] > newest[key]["created_at"]:
            newest[key] = row
    return {k: float(v["expected_points"]) for k, v in newest.items()}


def current_squad(db: Database, fpl: FplClient, team_id: int, gameweek_id: int) -> set[int]:
    rows = db.select("picks", "player_id", {"team_id": f"eq.{team_id}", "gameweek_id": f"eq.{gameweek_id}"})
    if len(rows) == 15:
        return {r["player_id"] for r in rows}
    live = fpl.picks(team_id, gameweek_id)
    return {p["element"] for p in (live or {}).get("picks", [])}


def plan_json(plan: Plan, xp: dict[tuple[int, int], float]) -> dict:
    def player(p: Player, g: int | None = None, sell: bool = False) -> dict:
        out = {"id": p.id, "name": p.name, "position": p.position, "team": p.team, "price": p.price}
        if sell:
            out["sell"] = p.sell
        if g is not None:
            out["xp"] = round(xp.get((p.id, g), 0.0), 2)
        return out

    return {
        "weeks": [
            {
                "gameweek": w.gameweek,
                "free_transfers": w.free_transfers,
                "hits": w.hits,
                "transfers": [
                    {"out": player(o, w.gameweek, sell=True), "in": player(i, w.gameweek)} for o, i in w.transfers
                ],
                "captain": player(w.captain, w.gameweek),
                "lineup": [player(p, w.gameweek) for p in w.lineup],
                "bench": [player(p, w.gameweek) for p in w.bench],
                "expected_points": round(w.expected_points, 2),
                "bank_after": w.bank_after,
            }
            for w in plan.weeks
        ],
    }


def plan_for_team(fpl: FplClient, db: Database, team_id: int, bootstrap: dict, current_gw: int,
                  gameweeks: list[int], xp: dict[tuple[int, int], float]) -> tuple[Plan, int, int]:
    history = fpl.entry_history(team_id) or {}
    transfers = fpl.entry_transfers(team_id)
    squad = current_squad(db, fpl, team_id, current_gw)
    if len(squad) != 15:
        raise ValueError(f"couldn't load a full squad for team {team_id}")
    elements = {e["id"]: e for e in bootstrap["elements"]}
    paid = purchase_prices(squad, transfers, elements)
    players = [
        Player(
            id=e["id"],
            name=e["web_name"],
            team=e["team"],
            position=e["element_type"],
            price=e["now_cost"],
            sell=selling_price(paid[e["id"]], e["now_cost"]) if e["id"] in squad and e["id"] in paid else e["now_cost"],
        )
        for e in bootstrap["elements"]
    ]
    ft, money = free_transfers(history), bank(history)
    pool = candidate_pool(players, squad, xp, gameweeks)
    return solve(pool, squad, xp, gameweeks, bank=money, free_transfers=ft), ft, money


def describe_first_week(plan: Plan) -> str:
    first = plan.weeks[0]
    if not first.transfers:
        return "roll"
    moves = ", ".join(f"{o.name}→{i.name}" for o, i in first.transfers)
    return moves + (f" (−{4 * first.hits})" if first.hits else "")


def run_plans(fpl: FplClient, db: Database, now: datetime) -> str:
    profiles = db.select("profiles", "user_id,fpl_team_id", {"fpl_team_id": "not.is.null"})
    if not profiles:
        return "no users with a team yet"
    bootstrap = fpl.bootstrap()
    current = next((e for e in bootstrap["events"] if e.get("is_current")), None)
    upcoming = sorted(
        e["id"] for e in bootstrap["events"] if datetime.fromisoformat(e["deadline_time"].replace("Z", "+00:00")) > now
    )[:HORIZON]
    if not current or not upcoming:
        return "no squads or upcoming gameweeks (pre-season or season over)"
    xp = latest_predictions(db, upcoming)
    if not xp:
        return "no predictions yet"
    _, meta = load_model()

    done, failed = [], []
    for profile in profiles:
        team = profile["fpl_team_id"]
        try:
            plan, ft, money = plan_for_team(fpl, db, team, bootstrap, current["id"], upcoming, xp)
        except FplUnavailable:
            raise
        except Exception as exc:  # one bad team shouldn't stop the rest
            log.warning("Plan for team %s failed: %s", team, exc)
            failed.append(f"{team}: {type(exc).__name__}")
            continue
        row = {
            "user_id": profile["user_id"],
            "team_id": team,
            "from_gameweek": upcoming[0],
            "horizon": len(upcoming),
            "free_transfers": ft,
            "bank": money,
            "plan": plan_json(plan, xp),
            "expected_points": round(plan.expected_points, 2),
            "baseline_points": round(plan.baseline_points, 2),
            "model_version": meta["version"],
            "created_at": now.isoformat(timespec="seconds"),
        }
        try:
            db.upsert("transfer_plans", [row], on_conflict="user_id")
        except SupabaseError as exc:
            if "PGRST205" in str(exc) or ("transfer_plans" in str(exc) and "does not exist" in str(exc)):
                return f"plans skipped (run {MIGRATION})"
            raise
        done.append(f"{team}: {describe_first_week(plan)}, +{plan.gain:.1f} over GW{upcoming[0]}-{upcoming[-1]}")

    summary = f"{len(done)} plan{'s' if len(done) != 1 else ''}"
    if done:
        summary += " (" + "; ".join(done[:5]) + ("; …" if len(done) > 5 else "") + ")"
    if failed:
        summary += f"; {len(failed)} failed ({', '.join(failed[:3])})"
    return summary


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    db = Database(settings.supabase_url, settings.supabase_secret_key)
    run = db.insert("job_runs", [{"job": JOB_NAME}], returning=True)[0]
    run_filter = {"id": f"eq.{run['id']}"}
    try:
        summary = run_plans(FplClient(), db, datetime.now(timezone.utc))
    except FplUnavailable as exc:
        db.update("job_runs", {"status": "skipped", "finished_at": utc_now(), "detail": str(exc)[:500]}, run_filter)
        announce("warning", "FPL unavailable, plans skipped", str(exc))
        return 0
    except Exception as exc:
        db.update("job_runs", {"status": "failed", "finished_at": utc_now(), "detail": f"{type(exc).__name__}: {exc}"[:500]}, run_filter)
        announce("error", "Transfer plans failed", f"{type(exc).__name__}: {exc}")
        raise
    db.update("job_runs", {"status": "ok", "finished_at": utc_now(), "detail": summary[:500]}, run_filter)
    log.info("Done: %s", summary)
    announce("notice", "Transfer plans", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
