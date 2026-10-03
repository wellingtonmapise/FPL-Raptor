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
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone

import requests

from raptor.config import load_settings
from raptor.db import Database, SupabaseError
from raptor.run import announce, utc_now

log = logging.getLogger("raptor.recaps")

JOB_NAME = "recaps"
MIGRATION = "supabase/migrations/20261003000003_scout_and_recaps.sql"
# Gemini's OpenAI-compatible endpoints.
ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/openai/models"
# Google retires model versions often, so the Flash models (the free tier) are
# looked up on each run; these aliases are the fallback if the list is unavailable.
MODELS = ("gemini-flash-latest", "gemini-flash-lite-latest")
NOT_TEXT = ("image", "tts", "audio", "live", "embedding", "robotics", "computer-use")
MAX_MODELS = 5
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
- No headings, lists, hashtags or emojis.

Reply with JSON only (no code fences), shaped like:
{"headline": "...", "captions": {"<card id>": "...", ...}, "recap": "..."}
- headline: a punchy headline of at most 8 words.
- captions: for every award card listed, one savage line of at most 20 words about that card's \
manager and stat, like a meme caption.
- recap: 150 to 220 words in 3 or 4 short paragraphs separated by blank lines."""


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
                "team_id": m["team_id"],  # for avatars; not sent to the model
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


CARD_TITLES = {
    "top": "Top Dog",
    "rocket": "Rocket",
    "captain_hero": "Armband Hero",
    "lone": "Lone Wolf",
    "chip": "Chip Watch",
    "bench": "Bench Warmer",
    "captain_fail": "Armband Disaster",
    "hit": "Hit and Miss",
    "freefall": "Freefall",
    "spoon": "Wooden Spoon",
}


def ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def recap_cards(facts: dict) -> list[dict]:
    """The week's awards, worked out from the facts (the model only writes the jokes).

    Good news first, roasts after, the wooden spoon last. Ties go to whoever is
    higher in the table.
    """
    managers = facts["managers"]
    if not managers:
        return []
    cards: dict[str, dict] = {}

    def card(kind: str, m: dict, stat: str) -> None:
        cards[kind] = {"id": kind, "kind": kind, "title": CARD_TITLES[kind], "manager": m["name"], "team_id": m.get("team_id"), "stat": stat}

    pick = lambda key, best: (max if best else min)(managers, key=key)  # noqa: E731 (first on ties: managers are in table order)
    top = pick(lambda m: m["points"], True)
    card("top", top, f"{top['points']} points")
    climbs = [m for m in managers if m["rank_before"] and m["rank_now"]]
    if climbs:
        up = max(climbs, key=lambda m: m["rank_before"] - m["rank_now"])
        if up["rank_before"] > up["rank_now"]:
            card("rocket", up, f"{ordinal(up['rank_before'])} to {ordinal(up['rank_now'])}")
    captained = [m for m in managers if m["captain"] and m["captain_points"] is not None]
    if len(captained) > 1:
        hero = max(captained, key=lambda m: m["captain_points"])
        flop = min(captained, key=lambda m: m["captain_points"])
        if hero["captain_points"] > flop["captain_points"]:
            card("captain_hero", hero, f"{hero['captain']}: {hero['captain_points']} points")
    lone = facts.get("players_only_one_manager_had_who_scored_10_plus") or []
    if lone:
        owner = next((m for m in managers if m["name"] == lone[0]["owner"]), None)
        if owner:
            card("lone", owner, f"{lone[0]['player']}: {lone[0]['points']} points, nobody else had him")
    chips = [m for m in managers if m["chip"]]
    if chips:
        c = chips[0]
        card("chip", c, f"{c['chip']}: {c['points']} points" + (f" (+{len(chips) - 1} more played chips)" if len(chips) > 1 else ""))
    bench = pick(lambda m: m["bench_points"], True)
    if bench["bench_points"] > 0:
        card("bench", bench, f"{bench['bench_points']} points on the bench")
    if len(captained) > 1 and "captain_hero" in cards:
        flop = min(captained, key=lambda m: m["captain_points"])
        card("captain_fail", flop, f"{flop['captain']}: {flop['captain_points']} points")
    average = facts.get("average") or 0
    hitters = [m for m in managers if m["hit_cost"] and m["points"] < average]
    if hitters:
        h = min(hitters, key=lambda m: m["points"])
        card("hit", h, f"−{h['hit_cost']} hit, {h['points']} points")
    if climbs:
        down = min(climbs, key=lambda m: m["rank_before"] - m["rank_now"])
        if down["rank_before"] < down["rank_now"]:
            card("freefall", down, f"{ordinal(down['rank_before'])} to {ordinal(down['rank_now'])}")
    spoon = pick(lambda m: m["points"], False)
    if spoon is not top:
        card("spoon", spoon, f"{spoon['points']} points")
    return [cards[k] for k in CARD_TITLES if k in cards]


def model_facts(facts: dict, cards: list[dict]) -> dict:
    """What the model sees: the facts without internal ids, plus the cards to caption."""
    managers = [{k: v for k, v in m.items() if k != "team_id"} for m in facts.get("managers", [])]
    return {
        **facts,
        "managers": managers,
        "award_cards": [{"id": c["id"], "award": c["title"], "manager": c["manager"], "stat": c["stat"]} for c in cards],
    }


def parse_reply(content: str, card_ids: list[str]) -> tuple[str, str, dict[str, str]]:
    """The model's JSON -> (headline, recap, captions). Falls back to plain text."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    start, end = text.find("{"), text.rfind("}")
    try:
        data = json.loads(text[start : end + 1]) if start >= 0 and end > start else None
    except ValueError:
        data = None
    if isinstance(data, dict) and isinstance(data.get("recap"), str) and data["recap"].strip():
        title = str(data.get("headline") or "").strip().strip('"“”*') or data["recap"].split(". ")[0][:80]
        raw = data.get("captions") if isinstance(data.get("captions"), dict) else {}
        captions = {k: " ".join(str(raw[k]).split())[:200] for k in card_ids if k in raw and str(raw[k]).strip()}
        return title[:120], data["recap"].strip()[:3000], captions
    title, body = split_recap(content)
    return title, body, {}


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


BUSY = {429, 500, 502, 503, 504}  # worth another try in a moment
RETRY_WAITS = (5, 20)  # seconds before each retry of a busy model


def _error_text(resp) -> str:
    """The API's own error message if it sent one, kept short."""
    try:
        data = resp.json()
        data = data[0] if isinstance(data, list) else data
        message = data["error"]["message"]
    except (ValueError, KeyError, IndexError, TypeError):
        message = resp.text
    return " ".join(str(message).split())[:100]


def rank_models(ids: list[str]) -> list[str]:
    """Text-only Flash models, best first: the -latest alias, then the newest
    stable versions, then previews, then the lighter Flash-Lite ones."""
    flash = [i.removeprefix("models/") for i in ids]
    flash = [i for i in flash if "flash" in i and not any(word in i for word in NOT_TEXT)]

    def key(model: str):
        found = re.search(r"gemini-(\d+(?:\.\d+)?)", model)
        version = float(found.group(1)) if found else 0.0
        return ("lite" in model, not model.endswith("-latest"), "preview" in model or "exp" in model, -version, model)

    return sorted(set(flash), key=key)


def candidate_models(token: str, session: requests.Session) -> list[str]:
    try:
        resp = session.get(MODELS_URL, headers={"Authorization": f"Bearer {token}"}, timeout=30)
        ids = [m["id"] for m in resp.json().get("data", [])] if resp.ok else []
    except (requests.RequestException, ValueError, KeyError, TypeError, AttributeError):
        ids = []
    return (rank_models(ids) or list(MODELS))[:MAX_MODELS]


def write_recap(
    facts: dict, token: str, session: requests.Session | None = None, sleep=time.sleep, cards: list[dict] | None = None
) -> tuple[str, str, str, dict[str, str]]:
    """-> (model, headline, body, captions by card id). Tries each Flash model in turn, retrying busy ones."""
    cards = cards or []
    session = session or requests.Session()
    problems = []
    for model in candidate_models(token, session):
        for attempt in range(len(RETRY_WAITS) + 1):
            try:
                resp = session.post(
                    ENDPOINT,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": "This week's facts:\n" + json.dumps(model_facts(facts, cards), ensure_ascii=False, indent=1)},
                        ],
                        "temperature": 0.9,
                        "max_tokens": 4000,  # room for the model's thinking as well as the recap
                    },
                    timeout=90,
                )
            except requests.RequestException as exc:
                problem = f"{model}: {type(exc).__name__}"
                busy = True
            else:
                if resp.ok:
                    try:
                        content = resp.json()["choices"][0]["message"]["content"] or ""
                        title, body, captions = parse_reply(content, [c["id"] for c in cards])
                    except (KeyError, IndexError, ValueError, RecapUnavailable) as exc:
                        problems.append(f"{model}: unusable reply ({type(exc).__name__}: {str(exc)[:60]}; {resp.text[:60]!r})")
                        break
                    return model, title, body, captions
                problem = f"{model}: HTTP {resp.status_code} {_error_text(resp)}"
                busy = resp.status_code in BUSY
            if not busy or attempt == len(RETRY_WAITS):
                problems.append(problem)
                break
            sleep(RETRY_WAITS[attempt])
    raise RecapUnavailable("; ".join(problems) or "no models to try")


def latest_final_gameweek(db: Database) -> int | None:
    rows = db.select("gameweeks", "id,finished,data_checked", {"finished": "is.true", "data_checked": "is.true"})
    return max((r["id"] for r in rows), default=None)


def run_recaps(db: Database, now: datetime, token: str | None, session: requests.Session | None = None) -> str:
    gw = latest_final_gameweek(db)
    if gw is None:
        return "no finished gameweek yet"
    with_cards = True
    try:
        done = {r["league_id"] for r in db.select("recaps", "league_id,cards", {"gameweek_id": f"eq.{gw}"}) if r.get("cards")}
    except SupabaseError as exc:
        missing_table = "PGRST205" in str(exc) or ("does not exist" in str(exc) and "cards" not in str(exc))
        if missing_table:
            return f"recaps skipped (run {MIGRATION})"
        if "cards" not in str(exc):
            raise
        with_cards = False  # migration 0006 not run yet: plain recaps, once
        done = {r["league_id"] for r in db.select("recaps", "league_id", {"gameweek_id": f"eq.{gw}"})}
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
        cards = recap_cards(facts) if with_cards else []
        try:
            model, title, body, captions = write_recap(facts, token, session, cards=cards)
        except RecapUnavailable as exc:
            log.warning("Recap for %s failed: %s", league["name"], exc)
            failed.append(f"{league['name']}: {exc}")
            continue
        row = {"league_id": league["id"], "gameweek_id": gw, "title": title, "body": body, "model": model, "created_at": now.isoformat(timespec="seconds")}
        if with_cards:
            row["cards"] = [{**c, "caption": captions.get(c["id"], "")} for c in cards]
        db.upsert("recaps", [row], on_conflict="league_id,gameweek_id")
        written.append(f"{league['name']} ({model}): {title}")
        lines = "\n".join(f"{c['title']}: {c['manager']} ({c['stat']}) {captions.get(c['id'], '')}" for c in cards)
        announce("notice", f"Recap: {league['name']} GW{gw}", f"{title}\n\n{lines}\n\n{body}")

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
