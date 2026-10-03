"""AI-written gameweek recaps for each followed mini-league.

    uv run python -m raptor.recaps

Runs after every fetch. Once a gameweek's points are final, it gathers each
league's facts (scores, captains, chips, hits, benches, who moved where),
asks Google's Gemini to write a roast in the voice of a football pundit, and
saves it to `recaps`. The alerts job pushes it to the league.

Gemini's API has a free tier (Flash models, rate-limited, no card): the key
comes from Google AI Studio and lives in the GEMINI_API_KEY repository
secret. The model only sees the facts given here and is told not to invent
any. On the free tier Google may use prompts to improve its models; they
hold first names and FPL numbers, nothing else.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections import Counter
from datetime import datetime, timezone

import requests

from raptor.config import load_settings
from raptor.db import Database, SupabaseError
from raptor.run import announce, utc_now

log = logging.getLogger("raptor.recaps")

JOB_NAME = "recaps"
MIGRATION = "supabase/migrations/20261003000003_scout_and_recaps.sql"
# Gemini's OpenAI-compatible endpoint.
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
# Free-tier models, tried in order; the next is used if one is unavailable or rate-limited.
MODELS = ("gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite")
COVERAGE = 0.75  # share of the league's squads with final points before writing
CHIP_NAMES = {"wildcard": "Wildcard", "freehit": "Free Hit", "bboost": "Bench Boost", "3xc": "Triple Captain", "manager": "Assistant Manager"}

SYSTEM_PROMPT = """You write the weekly recap for a Fantasy Premier League mini-league of friends, \
in the voice of a savage, quick-witted British football pundit. Full roast: mock captain fails, \
hits that didn't pay off, points rotting on the bench, wasted chips and anyone sliding down the table. \
Give the week's winners grudging credit.

Rules:
- Use only the facts in the message. Never invent scores, players, events, numbers or quotes.
- Roast FPL decisions only. Nothing about anyone's looks, job, personal life, nationality, race, \
religion, gender or sexuality. No slurs and no swearing.
- Call managers by the first name given.
- 150 to 220 words in 3 or 4 short paragraphs. No headings, lists, hashtags or emojis.
- The first line is a punchy headline of at most 8 words, then a blank line, then the recap."""


class RecapUnavailable(Exception):
    """No model could write the recap this run (rate limit, outage, refusal)."""


def _in(values) -> str:
    return "in.(" + ",".join(str(v) for v in values) + ")"


def first_name(full: str) -> str:
    return full.split()[0] if full.split() else full


def league_facts(
    league: dict,
    gameweek_id: int,
    members: list[dict],
    entries: dict[int, dict],
    picks: list[dict],
    names: dict[int, str],
    points: dict[int, int],
) -> dict:
    """Everything the recap may mention, as plain data.

    members: league_members rows (rank and last_rank are after/before the week).
    entries: team_id -> entry_gameweeks row. picks: that week's picks.
    names/points: player id -> web name / points that gameweek.
    """
    by_team: dict[int, list[dict]] = {}
    for p in picks:
        by_team.setdefault(p["team_id"], []).append(p)
    owners = Counter(p["player_id"] for p in picks)
    managers = []
    for m in sorted(members, key=lambda m: m.get("rank") or 999):
        e = entries.get(m["team_id"])
        if not e:
            continue
        squad = by_team.get(m["team_id"], [])
        captain = next((p for p in squad if p["multiplier"] >= 2), None) or next((p for p in squad if p.get("is_captain")), None)
        starters = [p for p in squad if p["multiplier"] > 0]
        best = max(starters, key=lambda p: points.get(p["player_id"], 0), default=None)
        managers.append(
            {
                "name": first_name(m["manager_name"]),
                "team": m["team_name"],
                "points": (e.get("points") or 0) - (e.get("event_transfers_cost") or 0),
                "hit_cost": e.get("event_transfers_cost") or 0,
                "transfers": e.get("event_transfers") or 0,
                "chip": CHIP_NAMES.get(e.get("active_chip") or "", None),
                "captain": names.get(captain["player_id"]) if captain else None,
                "captain_points": points.get(captain["player_id"], 0) * captain["multiplier"] if captain else None,
                "bench_points": e.get("points_on_bench") or 0,
                "best_player": f"{names.get(best['player_id'])} ({points.get(best['player_id'], 0)})" if best else None,
                "rank_now": m.get("rank"),
                "rank_before": m.get("last_rank") or None,
                "total": m.get("total"),
            }
        )
    scores = [m["points"] for m in managers]
    captains = Counter(m["captain"] for m in managers if m["captain"])
    lone_heroes = sorted(
        (
            {"player": names.get(pid), "points": points.get(pid, 0), "owner": first_name(next(m["manager_name"] for m in members if m["team_id"] == p["team_id"]))}
            for pid, n in owners.items()
            if n == 1 and points.get(pid, 0) >= 10
            for p in picks
            if p["player_id"] == pid and p["multiplier"] > 0
        ),
        key=lambda h: -h["points"],
    )[:3]
    leader = managers and min(managers, key=lambda m: m["rank_now"] or 999)
    second = sorted((m for m in managers if m["rank_now"]), key=lambda m: m["rank_now"])[1:2]
    return {
        "league": league["name"],
        "gameweek": gameweek_id,
        "average": round(sum(scores) / len(scores), 1) if scores else None,
        "most_captained": [f"{name} x{n}" for name, n in captains.most_common(3)],
        "leader": f"{leader['name']} ({leader['total']})" if leader else None,
        "lead_over_second": (leader["total"] - second[0]["total"]) if leader and second and second[0]["total"] is not None else None,
        "players_only_one_manager_had_who_scored_10_plus": lone_heroes,
        "managers": managers,
    }


def split_recap(text: str) -> tuple[str, str]:
    """The model's reply -> (headline, body)."""
    lines = [line.rstrip() for line in text.strip().splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        raise RecapUnavailable("empty reply")
    title = lines[0].strip().strip("#*_ ").removeprefix("Headline:").strip().strip('"“”*').strip()
    body = "\n".join(lines[1:]).strip()
    if not body:  # one paragraph: use its first sentence as the headline
        body = title
        title = title.split(". ")[0][:80]
    return title[:120], body[:3000]


def write_recap(facts: dict, token: str, session: requests.Session | None = None) -> tuple[str, str, str]:
    """-> (model, headline, body). Tries each model in turn."""
    session = session or requests.Session()
    problems = []
    for model in MODELS:
        try:
            resp = session.post(
                ENDPOINT,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": "This week's facts:\n" + json.dumps(facts, ensure_ascii=False, indent=1)},
                    ],
                    "temperature": 0.9,
                    "max_tokens": 4000,  # room for the model's thinking as well as the recap
                },
                timeout=90,
            )
        except requests.RequestException as exc:
            problems.append(f"{model}: {type(exc).__name__}")
            continue
        if not resp.ok:
            problems.append(f"{model}: HTTP {resp.status_code} {resp.text[:160]}")
            continue
        try:
            content = resp.json()["choices"][0]["message"]["content"] or ""
            title, body = split_recap(content)
        except (KeyError, IndexError, ValueError, RecapUnavailable) as exc:
            where = f" from {resp.url}" if getattr(resp, "url", ENDPOINT) != ENDPOINT else ""
            kind = getattr(resp, "headers", {}).get("content-type", "?")
            problems.append(f"{model}: unusable reply{where} ({type(exc).__name__}: {exc}; {kind}: {resp.text[:120]!r})")
            continue
        return model, title, body
    raise RecapUnavailable("; ".join(problems) or "no models to try")


def latest_final_gameweek(db: Database) -> int | None:
    rows = db.select("gameweeks", "id,finished,data_checked", {"finished": "is.true", "data_checked": "is.true"})
    return max((r["id"] for r in rows), default=None)


def run_recaps(db: Database, now: datetime, token: str | None, session: requests.Session | None = None) -> str:
    gw = latest_final_gameweek(db)
    if gw is None:
        return "no finished gameweek yet"
    try:
        done = {r["league_id"] for r in db.select("recaps", "league_id", {"gameweek_id": f"eq.{gw}"})}
    except SupabaseError as exc:
        if "PGRST205" in str(exc) or "does not exist" in str(exc):
            return f"recaps skipped (run {MIGRATION})"
        raise
    leagues = [l for l in db.select("leagues", "id,name") if l["id"] not in done]
    if not leagues:
        return f"GW{gw} recaps already written"
    if not token:
        return "recaps skipped (no GEMINI_API_KEY secret)"

    written, waiting, failed = [], [], []
    for league in leagues:
        members = db.select("league_members", "team_id,manager_name,team_name,rank,last_rank,total", {"league_id": f"eq.{league['id']}"})
        teams = [m["team_id"] for m in members]
        if not teams:
            continue
        entries = {
            e["team_id"]: e
            for e in db.select(
                "entry_gameweeks",
                "team_id,points,event_transfers,event_transfers_cost,points_on_bench,active_chip,final",
                {"gameweek_id": f"eq.{gw}", "team_id": _in(teams), "final": "is.true"},
            )
        }
        if len(entries) < COVERAGE * len(members):
            waiting.append(league["name"])
            continue
        picks = db.select("picks", "team_id,player_id,multiplier,is_captain", {"gameweek_id": f"eq.{gw}", "team_id": _in(teams)})
        ids = sorted({p["player_id"] for p in picks})
        names = {p["id"]: p["web_name"] for p in db.select("players", "id,web_name", {"id": _in(ids)})} if ids else {}
        try:
            points = {r["player_id"]: r["points"] for r in db.select("player_gameweeks", "player_id,points", {"gameweek_id": f"eq.{gw}", "player_id": _in(ids)})} if ids else {}
        except SupabaseError:
            points = {}
        facts = league_facts(league, gw, members, entries, picks, names, points)
        try:
            model, title, body = write_recap(facts, token, session)
        except RecapUnavailable as exc:
            log.warning("Recap for %s failed: %s", league["name"], exc)
            failed.append(f"{league['name']}: {str(exc)[:200]}")
            continue
        db.upsert(
            "recaps",
            [{"league_id": league["id"], "gameweek_id": gw, "title": title, "body": body, "model": model, "created_at": now.isoformat(timespec="seconds")}],
            on_conflict="league_id,gameweek_id",
        )
        written.append(f"{league['name']} ({model}): {title}")
        announce("notice", f"Recap: {league['name']} GW{gw}", f"{title}\n\n{body}")

    parts = []
    if written:
        parts.append(f"GW{gw} recap written for " + "; ".join(written))
    if waiting:
        parts.append(f"waiting for final points in {', '.join(waiting)}")
    if failed:
        parts.append("failed: " + "; ".join(failed))
    return ". ".join(parts) or "nothing to do"


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    db = Database(settings.supabase_url, settings.supabase_secret_key)
    run = db.insert("job_runs", [{"job": JOB_NAME}], returning=True)[0]
    run_filter = {"id": f"eq.{run['id']}"}
    try:
        summary = run_recaps(db, datetime.now(timezone.utc), os.environ.get("GEMINI_API_KEY", "").strip() or None)
    except Exception as exc:
        db.update("job_runs", {"status": "failed", "finished_at": utc_now(), "detail": f"{type(exc).__name__}: {exc}"[:500]}, run_filter)
        announce("error", "Recaps failed", f"{type(exc).__name__}: {exc}")
        raise
    status = "failed" if "failed:" in summary else "ok"
    db.update("job_runs", {"status": status, "finished_at": utc_now(), "detail": summary[:500]}, run_filter)
    log.info("Done: %s", summary)
    announce("warning" if status == "failed" else "notice", "Recaps", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
