"""Push notifications: deadline reminders, team news and price changes.

Run it with:  uv run python -m raptor.alerts
GitHub Actions runs it every 15 minutes (.github/workflows/alerts.yml).

Each run:
  * deadline reminders: one when the next deadline is under 24 hours away,
    another when it's under 75 minutes away (the window absorbs late runs)
  * team news: injury/availability changes for players in your squad
  * price changes for players in your squad
  * mini-league: a captain round-up after each deadline, and the weekly
    awards once FPL confirms the gameweek's points

notifications_sent records every alert key, so nothing goes out twice, and
notification_prefs lets each user switch types off (everything is on unless
they say otherwise). Devices that have unsubscribed are removed.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable

import requests

from raptor.config import load_settings
from raptor.db import Database, SupabaseError
from raptor.fpl import format_price
from raptor.run import announce, utc_now

log = logging.getLogger("raptor.alerts")

JOB_NAME = "alerts"
ONE_HOUR_WINDOW = 75 * 60  # seconds
DAY_WINDOW = 24 * 3600
CHANGE_LOOKBACK = timedelta(hours=6)  # how far back to look for player changes
SENT_LOOKBACK = timedelta(days=3)  # how far back to check what was already sent
FLAG_FIELDS = {"status", "news", "chance_of_playing_next_round"}
STATUS_WORDS = {"i": "injured", "s": "suspended", "u": "unavailable", "n": "not in the squad"}


# ---------------------------------------------------------------------------
# Writing the messages (pure functions)
# ---------------------------------------------------------------------------


def availability(player: dict) -> str | None:
    """'75%', 'injured' and so on. None when fully available."""
    if player["status"] in STATUS_WORDS:
        return STATUS_WORDS[player["status"]]
    chance = player.get("chance_of_playing_next_round")
    if player["status"] == "d" or (chance is not None and chance < 100):
        return f"{chance}%" if chance is not None else "doubtful"
    return None


def time_left(seconds: float) -> str:
    if seconds >= 90 * 60:
        return f"{round(seconds / 3600)} hours"
    if seconds >= 55 * 60:
        return "1 hour"
    return f"{max(1, round(seconds / 60))} minutes"


def deadline_message(
    gameweek_id: int,
    seconds_left: float,
    last_call: bool,
    squad: list[dict] | None,
    suggestion: tuple[str, float] | None = None,
    transfer_idea: str | None = None,
) -> dict:
    """suggestion: the model's captain pick, (name, xP). transfer_idea: from the user's plan."""
    title = f"GW{gameweek_id} deadline in {time_left(seconds_left)}"
    lines = []
    if squad:
        flagged = [f"{p['web_name']} ({availability(p)})" for p in squad if availability(p)]
        if flagged:
            lines.append("Flagged in your team: " + ", ".join(flagged) + ".")
        captain = next((p for p in squad if p.get("is_captain")), None)
        if captain:
            lines.append(f"Captain: {captain['web_name']}.")
    if suggestion:
        lines.append(f"Model's pick: {suggestion[0]} ({suggestion[1]:.1f} xP).")
    if transfer_idea:
        lines.append(transfer_idea)
    lines.insert(0, "Last chance for transfers and your captain." if last_call else "Time to plan your transfers.")
    return {"title": title, "body": " ".join(lines), "url": "/me", "tag": f"deadline-gw{gameweek_id}"}


def flag_message(players: list[dict]) -> dict:
    """Team news for one or more squad players, using their current state."""

    def headline(p: dict) -> str:
        label = availability(p)
        if label is None:
            return f"{p['web_name']} is available again"
        if label.endswith("%"):
            return f"{p['web_name']}: {label} chance of playing"
        return f"{p['web_name']} is {label}" if label != "doubtful" else f"{p['web_name']} is a doubt"

    if len(players) == 1:
        p = players[0]
        return {"title": headline(p), "body": p.get("news") or "Check your team before the deadline.", "url": "/me", "tag": f"news-{p['id']}"}
    body = "; ".join(headline(p) + (f" ({p['news']})" if p.get("news") else "") for p in players)
    return {"title": f"Team news for {len(players)} of your players", "body": body, "url": "/me", "tag": "news"}


def price_message(changes: list[tuple[dict, int, int]]) -> dict:
    """changes: (player, old_cost, new_cost)."""

    def line(p: dict, old: int, new: int) -> str:
        arrow = "▲" if new > old else "▼"
        return f"{p['web_name']} {arrow} {format_price(old)} → {format_price(new)}"

    if len(changes) == 1:
        p, old, new = changes[0]
        verb = "rose" if new > old else "fell"
        return {"title": f"{p['web_name']} {verb} to {format_price(new)}", "body": line(p, old, new), "url": "/me", "tag": f"price-{p['id']}"}
    return {
        "title": f"Price changes for {len(changes)} of your players",
        "body": "; ".join(line(*c) for c in changes),
        "url": "/me",
        "tag": "prices",
    }


def transfer_idea(plan_row: dict) -> str:
    """One line from a saved transfer plan: the first week's moves, or roll."""
    gain = float(plan_row["expected_points"]) - float(plan_row["baseline_points"])
    weeks = (plan_row.get("plan") or {}).get("weeks") or []
    moves = weeks[0].get("transfers", []) if weeks else []
    if not moves or gain < 1:
        return "Plan: roll your transfer."
    text = ", ".join(f"{m['out']['name']} → {m['in']['name']}" for m in moves)
    hits = weeks[0].get("hits") or 0
    return f"Plan: {text}" + (f" (−{4 * hits})" if hits else "") + f", +{gain:.1f} xP."


def first_name(full: str) -> str:
    return full.split()[0] if full.split() else full


def rival_of(members: list[dict], my_team: int) -> dict | None:
    """The manager directly above you, or directly below if you're top."""
    ranked = sorted((m for m in members if m.get("rank")), key=lambda m: m["rank"])
    index = next((i for i, m in enumerate(ranked) if m["team_id"] == my_team), None)
    if index is None or len(ranked) < 2:
        return None
    return ranked[index - 1] if index > 0 else ranked[1]


def captain_roundup_message(league: dict, gameweek_id: int, members: list[dict], captains: dict[int, str], my_team: int) -> dict:
    """captains: team_id -> captain's name."""
    counts: dict[str, int] = {}
    for name in captains.values():
        counts[name] = counts.get(name, 0) + 1
    popular = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    shown = ", ".join(f"{name} ×{n}" for name, n in popular[:3])
    if len(popular) > 3:
        shown += f", {len(popular) - 3} others"
    lines = [shown + "."]
    if my_team in captains:
        mine = captains[my_team]
        same = counts[mine] - 1
        lines.append(f"You went {mine}" + (f", with {same} others." if same else ", on your own."))
    rival = rival_of(members, my_team)
    me = next((m for m in members if m["team_id"] == my_team), None)
    if rival and me and rival["team_id"] in captains:
        gap = abs((rival.get("total") or 0) - (me.get("total") or 0))
        where = "ahead" if (rival.get("rank") or 0) < (me.get("rank") or 0) else "behind"
        lines.append(f"{first_name(rival['manager_name'])} ({gap} {where}) went {captains[rival['team_id']]}.")
    return {
        "title": f"GW{gameweek_id} captains in {league['name']}",
        "body": " ".join(lines),
        "url": f"/league/{league['id']}",
        "tag": f"league-captains-{league['id']}-gw{gameweek_id}",
    }


def awards_message(
    league: dict,
    gameweek_id: int,
    members: list[dict],
    entries: dict[int, dict],
    captains: dict[int, tuple[str, int]],
    my_team: int,
) -> dict:
    """entries: team_id -> entry row. captains: team_id -> (captain name, points as captain)."""
    names = {m["team_id"]: first_name(m["manager_name"]) for m in members}
    net = {t: (e.get("points") or 0) - (e.get("event_transfers_cost") or 0) for t, e in entries.items() if t in names}
    parts = []
    if net:
        top = max(net, key=lambda t: net[t])
        low = min(net, key=lambda t: net[t])
        parts.append(f"Top: {names[top]} {net[top]}.")
        if low != top:
            parts.append(f"Wooden spoon: {names[low]} {net[low]}.")
    caps = {t: c for t, c in captains.items() if t in names}
    if len(caps) > 1:
        hero = max(caps, key=lambda t: caps[t][1])
        fail = min(caps, key=lambda t: caps[t][1])
        parts.append(f"Captain hero: {names[hero]} ({caps[hero][0]}, {caps[hero][1]}).")
        if caps[fail][1] != caps[hero][1]:
            parts.append(f"Captain fail: {names[fail]} ({caps[fail][0]}, {caps[fail][1]}).")
    bench = {t: e.get("points_on_bench") or 0 for t, e in entries.items() if t in names}
    if bench and max(bench.values()) > 0:
        worst = max(bench, key=lambda t: bench[t])
        parts.append(f"Bench of shame: {names[worst]} {bench[worst]}.")
    if my_team in net:
        place = 1 + sum(1 for v in net.values() if v > net[my_team])
        parts.append(f"You: {net[my_team]} ({ordinal(place)} of {len(net)}).")
    return {
        "title": f"GW{gameweek_id} awards · {league['name']}",
        "body": " ".join(parts),
        "url": f"/league/{league['id']}",
        "tag": f"league-awards-{league['id']}-gw{gameweek_id}",
    }


def ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------


class PushSender:
    """Sends one encrypted Web Push message, signed with the VAPID key."""

    def __init__(self, private_key: str, subject: str, session: requests.Session | None = None) -> None:
        self.private_key = private_key.strip()
        self.subject = subject
        self.session = session or requests.Session()

    def send(self, subscription: dict, payload: dict, ttl: int = 12 * 3600, urgency: str = "normal") -> str:
        """Returns 'ok', 'gone' (device unsubscribed) or 'error: ...'."""
        from pywebpush import WebPushException, webpush

        try:
            webpush(
                subscription_info={
                    "endpoint": subscription["endpoint"],
                    "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]},
                },
                data=json.dumps(payload),
                vapid_private_key=self.private_key,
                vapid_claims={"sub": self.subject},  # a fresh dict each time: webpush adds to it
                ttl=max(60, int(ttl)),
                headers={"Urgency": urgency},
                requests_session=self.session,
                timeout=15,
            )
            return "ok"
        except WebPushException as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in (404, 410):
                return "gone"
            return f"error: {status or exc}"
        except requests.RequestException as exc:
            return f"error: {type(exc).__name__}"


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------


@dataclass
class Outbox:
    """Collects what to send in this run, then sends it."""

    sender: PushSender
    db: Database
    now: str
    subs_by_user: dict[str, list[dict]]
    counts: dict[str, int] = field(default_factory=dict)
    gone: set[int] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)

    def send(self, user_id: str, kind: str, keys: list[str], payload: dict, ttl: int, urgency: str = "normal") -> None:
        delivered = False
        for sub in self.subs_by_user.get(user_id, []):
            if sub["id"] in self.gone:
                continue
            result = self.sender.send(sub, payload, ttl=ttl, urgency=urgency)
            if result == "ok":
                delivered = True
            elif result == "gone":
                self.gone.add(sub["id"])
            else:
                self.errors.append(result)
        if delivered:
            self.db.upsert(
                "notifications_sent",
                [{"user_id": user_id, "alert_key": key, "sent_at": self.now} for key in keys],
                on_conflict="user_id,alert_key",
            )
            self.counts[kind] = self.counts.get(kind, 0) + 1


def _in(values) -> str:
    return "in.(" + ",".join(str(v) for v in values) + ")"


ROUNDUP_WINDOW = timedelta(hours=48)  # captain round-ups only for a fresh deadline
COVERAGE = 0.75  # share of the league's squads needed before sending


def league_alerts(
    db: Database,
    outbox: Outbox,
    now: datetime,
    current: dict,
    profiles: dict[str, int | None],
    wants: Callable[[str, str], bool],
    sent: set[tuple[str, str]],
) -> None:
    """Captain round-up after a deadline, weekly awards once points are final."""
    team_to_users: dict[int, list[str]] = {}
    for user, team in profiles.items():
        if team and wants(user, "league"):
            team_to_users.setdefault(team, []).append(user)
    if not team_to_users:
        return
    memberships = db.select("league_members", "league_id,team_id", {"team_id": _in(sorted(team_to_users))})
    league_ids = sorted({m["league_id"] for m in memberships})
    if not league_ids:
        return
    leagues = {l["id"]: l for l in db.select("leagues", "id,name", {"id": _in(league_ids)})}
    all_members = db.select("league_members", "league_id,team_id,manager_name,rank,total", {"league_id": _in(league_ids)})
    teams = sorted({m["team_id"] for m in all_members})
    gw = current["id"]

    deadline = datetime.fromisoformat(current["deadline_time"].replace("Z", "+00:00"))
    fresh = timedelta(0) <= now - deadline <= ROUNDUP_WINDOW
    final = bool(current.get("finished") and current.get("data_checked"))
    if not (fresh or final):
        return

    captain_picks = db.select(
        "picks", "team_id,player_id,multiplier", {"gameweek_id": f"eq.{gw}", "is_captain": "is.true", "team_id": _in(teams)}
    )
    captain_ids = sorted({p["player_id"] for p in captain_picks})
    names = {p["id"]: p["web_name"] for p in db.select("players", "id,web_name", {"id": _in(captain_ids)})} if captain_ids else {}
    entries = (
        {e["team_id"]: e for e in db.select(
            "entry_gameweeks",
            "team_id,points,event_transfers_cost,points_on_bench,final",
            {"gameweek_id": f"eq.{gw}", "team_id": _in(teams), "final": "is.true"},
        )}
        if final
        else {}
    )
    points: dict[int, int] = {}
    if final and captain_ids:
        try:
            points = {
                r["player_id"]: r["points"]
                for r in db.select("player_gameweeks", "player_id,points", {"gameweek_id": f"eq.{gw}", "player_id": _in(captain_ids)})
            }
        except SupabaseError:  # table missing until migration 0002 runs
            points = {}

    for league_id in league_ids:
        league = leagues.get(league_id)
        members = [m for m in all_members if m["league_id"] == league_id]
        if not league or not members:
            continue
        member_teams = {m["team_id"] for m in members}
        captains = {p["team_id"]: names.get(p["player_id"], "?") for p in captain_picks if p["team_id"] in member_teams}
        enough_captains = len(captains) >= COVERAGE * len(members)

        for team in member_teams & set(team_to_users):
            for user in team_to_users[team]:
                if fresh and enough_captains:
                    key = f"league_captains:{league_id}:gw{gw}"
                    if (user, key) not in sent:
                        msg = captain_roundup_message(league, gw, members, captains, team)
                        outbox.send(user, "league", [key], msg, ttl=12 * 3600)
                league_entries = {t: e for t, e in entries.items() if t in member_teams}
                # Awards wait for final points and for player points (captain awards).
                if final and points and len(league_entries) >= COVERAGE * len(members):
                    key = f"league_awards:{league_id}:gw{gw}"
                    if (user, key) not in sent:
                        caps = {
                            p["team_id"]: (names.get(p["player_id"], "?"), points.get(p["player_id"], 0) * max(p["multiplier"], 1))
                            for p in captain_picks
                            if p["team_id"] in member_teams and p["player_id"] in points
                        }
                        msg = awards_message(league, gw, members, league_entries, caps, team)
                        outbox.send(user, "league", [key], msg, ttl=24 * 3600)


def run_alerts(db: Database, sender: PushSender, now: datetime) -> str:
    now_iso = now.isoformat(timespec="seconds")
    subs = db.select("push_subscriptions", "id,user_id,endpoint,p256dh,auth")
    if not subs:
        return "no devices signed up for notifications"
    subs_by_user: dict[str, list[dict]] = {}
    for sub in subs:
        subs_by_user.setdefault(sub["user_id"], []).append(sub)
    users = sorted(subs_by_user)

    profiles = {p["user_id"]: p["fpl_team_id"] for p in db.select("profiles", "user_id,fpl_team_id", {"user_id": _in(users)})}
    off = {
        (row["user_id"], row["alert_type"])
        for row in db.select("notification_prefs", "user_id,alert_type,enabled", {"user_id": _in(users)})
        if not row["enabled"]
    }
    wants: Callable[[str, str], bool] = lambda user, kind: (user, kind) not in off
    since_sent = (now - SENT_LOOKBACK).isoformat(timespec="seconds")
    sent = {
        (row["user_id"], row["alert_key"])
        for row in db.select("notifications_sent", "user_id,alert_key", {"user_id": _in(users), "sent_at": f"gt.{since_sent}"})
    }

    gameweeks = db.select("gameweeks", "id,deadline_time,is_current,finished,data_checked")
    current = next((g for g in gameweeks if g["is_current"]), None)
    upcoming = sorted(
        (g for g in gameweeks if datetime.fromisoformat(g["deadline_time"].replace("Z", "+00:00")) > now),
        key=lambda g: g["deadline_time"],
    )
    next_gw = upcoming[0] if upcoming else None

    # Each user's squad (latest deadline), joined with current player state.
    squads: dict[str, list[dict]] = {}
    team_ids = {t for t in profiles.values() if t}
    if current and team_ids:
        picks = db.select(
            "picks",
            "team_id,player_id,is_captain,multiplier",
            {"gameweek_id": f"eq.{current['id']}", "team_id": _in(sorted(team_ids))},
        )
        player_ids = sorted({p["player_id"] for p in picks})
        players = (
            {p["id"]: p for p in db.select("players", "id,web_name,status,news,chance_of_playing_next_round,now_cost", {"id": _in(player_ids)})}
            if player_ids
            else {}
        )
        by_team: dict[int, list[dict]] = {}
        for pick in picks:
            if pick["player_id"] in players:
                by_team.setdefault(pick["team_id"], []).append(
                    {**players[pick["player_id"]], "is_captain": pick["is_captain"], "starting": (pick.get("multiplier") or 0) > 0}
                )
        for user, team in profiles.items():
            if team in by_team:
                squads[user] = by_team[team]

    outbox = Outbox(sender=sender, db=db, now=now_iso, subs_by_user=subs_by_user)

    # The model's expected points for the next gameweek (newest run per player).
    xp: dict[int, float] = {}
    squad_ids = sorted({p["id"] for squad in squads.values() for p in squad})
    if next_gw and squad_ids:
        newest: dict[int, dict] = {}
        for row in db.select(
            "predictions", "player_id,expected_points,created_at",
            {"gameweek_id": f"eq.{next_gw['id']}", "player_id": _in(squad_ids)},
        ):
            if row["player_id"] not in newest or row["created_at"] > newest[row["player_id"]]["created_at"]:
                newest[row["player_id"]] = row
        xp = {pid: float(r["expected_points"]) for pid, r in newest.items()}

    # Each user's transfer plan for this deadline (table exists from migration 0003).
    ideas: dict[str, str] = {}
    if next_gw:
        try:
            for row in db.select(
                "transfer_plans", "user_id,from_gameweek,plan,expected_points,baseline_points",
                {"user_id": _in(users), "from_gameweek": f"eq.{next_gw['id']}"},
            ):
                ideas[row["user_id"]] = transfer_idea(row)
        except SupabaseError:
            pass

    def suggestion_for(user: str) -> tuple[str, float] | None:
        options = [(p["web_name"], xp[p["id"]]) for p in squads.get(user, []) if p.get("starting") and p["id"] in xp]
        return max(options, key=lambda o: o[1]) if options else None

    # 1. Deadline reminders
    if next_gw:
        deadline = datetime.fromisoformat(next_gw["deadline_time"].replace("Z", "+00:00"))
        seconds = (deadline - now).total_seconds()
        kind = "deadline_1h" if seconds <= ONE_HOUR_WINDOW else "deadline_24h" if seconds <= DAY_WINDOW else None
        if kind:
            key = f"{kind}:gw{next_gw['id']}"
            for user in users:
                if wants(user, kind) and (user, key) not in sent:
                    payload = deadline_message(
                        next_gw["id"], seconds, kind == "deadline_1h", squads.get(user), suggestion_for(user), ideas.get(user)
                    )
                    outbox.send(user, kind, [key], payload, ttl=int(seconds), urgency="high" if kind == "deadline_1h" else "normal")

    # 2. Team news and price changes for squad players
    since_change = (now - CHANGE_LOOKBACK).isoformat(timespec="seconds")
    changes = db.select("player_changes", "id,player_id,field,old_value,new_value,seen_at", {"seen_at": f"gt.{since_change}"})
    if changes and squads:
        for user, squad in squads.items():
            by_id = {p["id"]: p for p in squad}
            mine = [c for c in changes if c["player_id"] in by_id and (user, f"change:{c['id']}") not in sent]
            flags = [c for c in mine if c["field"] in FLAG_FIELDS]
            prices = [c for c in mine if c["field"] == "now_cost"]
            if flags and wants(user, "player_flag"):
                players = [by_id[pid] for pid in dict.fromkeys(c["player_id"] for c in flags)]
                outbox.send(user, "player_flag", [f"change:{c['id']}" for c in flags], flag_message(players), ttl=12 * 3600)
            if prices and wants(user, "price_change"):
                latest: dict[int, tuple[dict, int, int]] = {}
                for c in sorted(prices, key=lambda c: c["seen_at"]):
                    first_old = latest[c["player_id"]][1] if c["player_id"] in latest else int(c["old_value"])
                    latest[c["player_id"]] = (by_id[c["player_id"]], first_old, int(c["new_value"]))
                moved = [v for v in latest.values() if v[1] != v[2]]
                if moved:
                    outbox.send(user, "price_change", [f"change:{c['id']}" for c in prices], price_message(moved), ttl=12 * 3600)

    # 3. Mini-league alerts
    if current:
        league_alerts(db, outbox, now, current, profiles, wants, sent)

    for sub_id in outbox.gone:
        db.delete("push_subscriptions", {"id": f"eq.{sub_id}"})

    sent_total = sum(outbox.counts.values())
    parts = [f"{sent_total} sent to {len(users)} {'person' if len(users) == 1 else 'people'}"]
    if outbox.counts:
        parts.append(", ".join(f"{k} {v}" for k, v in sorted(outbox.counts.items())))
    if outbox.gone:
        parts.append(f"removed {len(outbox.gone)} old device{'s' if len(outbox.gone) != 1 else ''}")
    if outbox.errors:
        parts.append(f"{len(outbox.errors)} failed ({outbox.errors[0]})")
    return "; ".join(parts)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    private_key = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if not private_key:
        msg = "VAPID_PRIVATE_KEY isn't set, so no notifications can be sent yet."
        log.warning(msg)
        announce("warning", "Push not set up", msg)
        return 0  # not a failure: avoids a failed run every 15 minutes before setup

    settings = load_settings()
    db = Database(settings.supabase_url, settings.supabase_secret_key)
    sender = PushSender(private_key, os.environ.get("VAPID_SUBJECT", "https://fpl-raptor.vercel.app"))

    run = db.insert("job_runs", [{"job": JOB_NAME}], returning=True)[0]
    run_filter = {"id": f"eq.{run['id']}"}
    try:
        summary = run_alerts(db, sender, datetime.now(timezone.utc))
    except Exception as exc:
        db.update("job_runs", {"status": "failed", "finished_at": utc_now(), "detail": f"{type(exc).__name__}: {exc}"[:500]}, run_filter)
        announce("error", "Alerts failed", f"{type(exc).__name__}: {exc}")
        raise
    db.update("job_runs", {"status": "ok", "finished_at": utc_now(), "detail": summary}, run_filter)
    log.info("Done: %s", summary)
    announce("notice", "Alerts summary", summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
