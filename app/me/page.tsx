import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Countdown from "@/components/Countdown";
import Pitch from "@/components/Pitch";
import PlayerLink from "@/components/PlayerLink";
import { availabilityLabel, SquadList } from "@/components/Squad";
import ViewToggle from "@/components/ViewToggle";
import { formatPrice } from "@/lib/fpl";
import { getEntry, getPicks } from "@/lib/fplApi";
import {
  buildSquad,
  captainOptions,
  CHIP_NAMES,
  expectedXI,
  latestPredictions,
  nextGameweek,
  type Fixture,
  type Pick,
  type Player,
  type PredictionRow,
  type Team,
} from "@/lib/gameweek";
import { teamPitch } from "@/lib/pitch";
import {
  gameweekRange,
  headline,
  laterChips,
  type TransferPlanRow,
} from "@/lib/plan";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My gameweek · FPL Raptor" };

type Gameweek = {
  id: number;
  name: string;
  deadline_time: string;
  is_current: boolean;
  is_next: boolean;
};

type GameweekStats = {
  active_chip: string | null;
  points: number | null;
  points_on_bench: number | null;
  event_transfers: number | null;
  event_transfers_cost: number | null;
  bank: number | null;
  value: number | null;
};

const PLAYER_COLUMNS =
  "id,web_name,team_id,position,now_cost,status,news,chance_of_playing_next_round";

function Chevron() {
  return <svg viewBox="0 0 24 24" className="disclosure-arrow h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden><path d="m6 9 6 6 6-6" /></svg>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col"><dt className="order-2 text-xs text-muted">{label}</dt><dd className="order-1 text-lg font-semibold tabular-nums">{value}</dd></div>;
}

function TeamNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="page-title">Your team</h1>
      <section className="surface mt-6 max-w-lg p-5">
        <h2 className="section-title">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
        <a href="/me" className="button-secondary mt-4">Try again</a>
      </section>
    </main>
  );
}

export default async function MyGameweekPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/me");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("fpl_team_id,display_name")
    .eq("user_id", userId)
    .maybeSingle<{ fpl_team_id: number | null; display_name: string | null }>();
  if (profileError) return <TeamNotice title="Your team link couldn’t load">Your account is still signed in. Try loading your team again.</TeamNotice>;
  if (!profile?.fpl_team_id) redirect("/onboarding");
  const teamId = profile.fpl_team_id;

  const [gameweeksRes, teamsRes, entry] = await Promise.all([
    supabase
      .from("gameweeks")
      .select("id,name,deadline_time,is_current,is_next")
      .order("id"),
    supabase.from("teams").select("id,name,short_name"),
    getEntry(teamId),
  ]);
  if (gameweeksRes.error) return <TeamNotice title="Gameweek data couldn’t load">Your team is still linked. Try again in a moment.</TeamNotice>;
  const gameweeks = (gameweeksRes.data ?? []) as Gameweek[];
  const teams = (teamsRes.data ?? []) as Team[];
  const current = gameweeks.find((g) => g.is_current) ?? null;
  const next = nextGameweek(gameweeks);

  // The squad from the latest deadline: stored by the fetch job, or straight
  // from FPL if the job hasn't picked this team up yet.
  let picks: Pick[] = [];
  let stats: GameweekStats | null = null;
  let fplUnavailable = false;
  if (current) {
    const [entryRow, pickRows] = await Promise.all([
      supabase
        .from("entry_gameweeks")
        .select(
          "active_chip,points,points_on_bench,event_transfers,event_transfers_cost,bank,value",
        )
        .eq("team_id", teamId)
        .eq("gameweek_id", current.id)
        .maybeSingle<GameweekStats>(),
      supabase
        .from("picks")
        .select(
          "player_id,squad_position,multiplier,is_captain,is_vice_captain",
        )
        .eq("team_id", teamId)
        .eq("gameweek_id", current.id),
    ]);
    if (pickRows.data?.length) {
      picks = pickRows.data as Pick[];
      stats = entryRow.data;
    } else {
      const live = await getPicks(teamId, current.id);
      if (live.ok) {
        picks = live.data.picks.map((p) => ({
          player_id: p.element,
          squad_position: p.position,
          multiplier: p.multiplier,
          is_captain: p.is_captain,
          is_vice_captain: p.is_vice_captain,
        }));
        stats = {
          ...live.data.entry_history,
          active_chip: live.data.active_chip,
        };
      } else {
        fplUnavailable = live.reason === "unavailable";
      }
    }
  }

  const playerIds = picks.map((p) => p.player_id);
  const [playersRes, fixturesRes, predictionsRes, planRes] = await Promise.all([
    picks.length
      ? supabase.from("players").select(PLAYER_COLUMNS).in("id", playerIds)
      : Promise.resolve({ data: [], error: null }),
    next
      ? supabase
          .from("fixtures")
          .select(
            "id,gameweek_id,home_team_id,away_team_id,home_difficulty,away_difficulty,kickoff_time",
          )
          .eq("gameweek_id", next.id)
      : Promise.resolve({ data: [], error: null }),
    next && picks.length
      ? supabase
          .from("predictions")
          .select("player_id,expected_points,created_at")
          .eq("gameweek_id", next.id)
          .in("player_id", playerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("transfer_plans")
      .select(
        "from_gameweek,horizon,free_transfers,bank,plan,expected_points,baseline_points,model_version,created_at",
      )
      .eq("user_id", userId)
      .maybeSingle<TransferPlanRow>(),
  ]);
  const squad = buildSquad(
    picks,
    (playersRes.data ?? []) as Player[],
    teams,
    (fixturesRes.data ?? []) as Fixture[],
  );
  const xp = latestPredictions((predictionsRes.data ?? []) as PredictionRow[]);
  const allPlayers = [...squad.starters, ...squad.bench];
  const missingPlayers = allPlayers.filter((sp) => !sp.player).length;
  const completeXI = squad.starters.length === 11 && squad.starters.every((sp) => sp.player && xp.has(sp.player_id));
  const captains = completeXI ? captainOptions(squad.starters, xp).slice(0, 3) : [];
  const xiTotal = completeXI ? expectedXI(squad.starters, xp) : null;
  // Only show a plan made for the coming deadline (and none until the table exists).
  const plan =
    planRes.data && next && planRes.data.from_gameweek === next.id
      ? planRes.data
      : null;
  const suggestion = plan ? headline(plan) : null;
  const pitch = teamPitch(squad.starters, squad.bench, xp);
  if (fixturesRes.error) {
    for (const slot of [...pitch.starters, ...pitch.bench]) { slot.caption = "Fixture —"; slot.tone = "muted"; }
  }

  const teamName = entry.ok ? entry.data.name : null;
  const managerName = entry.ok
    ? `${entry.data.player_first_name} ${entry.data.player_last_name}`
    : profile.display_name;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5">
        <p className="mb-1 text-xs font-medium text-muted">Your team{next ? ` · ${next.name}` : ""}</p>
        <h1 className="page-title wrap-break-word">{teamName ?? "My gameweek"}</h1>
        <p className="mt-2 text-sm text-muted">
          {[
            managerName,
            entry.ok && entry.data.summary_overall_points != null ? `${entry.data.summary_overall_points.toLocaleString("en-US")} pts` : null,
            entry.ok && entry.data.summary_overall_rank != null ? `Rank ${entry.data.summary_overall_rank.toLocaleString("en-US")}` : null,
          ].filter(Boolean).join(" · ")}
        </p>
      </header>

      <section aria-label="Next deadline and budget" className="surface mb-6 divide-y divide-line">
        {next ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <p className="mb-0.5 text-xs font-medium text-muted">{next.name} deadline</p>
              <Countdown deadline={next.deadline_time} compact />
            </div>
            <Link href="/notifications" className="button-secondary shrink-0 px-3 text-xs" aria-label="Set deadline reminders">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
              Remind me
            </Link>
          </div>
        ) : <p className="px-4 py-4 text-sm text-muted">No upcoming deadline is available.</p>}
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 px-4 py-2.5 text-xs sm:px-5">
          <p className="text-muted">{plan ? "Latest plan snapshot" : current ? `At the ${current.name} deadline` : "Budget"}</p>
          <dl className="flex flex-wrap gap-x-4 gap-y-1">
            <div className="flex gap-1.5"><dt className="text-muted">Bank</dt><dd className="font-semibold tabular-nums">{formatPrice(plan?.bank ?? stats?.bank)}</dd></div>
            <div className="flex gap-1.5"><dt className="text-muted">Free transfers</dt><dd className="font-semibold tabular-nums">{plan?.free_transfers ?? "—"}</dd></div>
          </dl>
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0 space-y-4">
          {squad.flagged.length > 0 && (
            <details className="disclosure rounded-xl border border-warning/20 bg-warning-soft text-warning">
              <summary className="flex min-h-14 items-center gap-3 px-4 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-sm font-semibold" aria-hidden>!</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{squad.flagged.length} availability concern{squad.flagged.length === 1 ? "" : "s"}</span><span className="block text-xs">{squad.flagged.map((sp) => sp.player?.web_name).join(", ")}</span></span>
                <Chevron />
              </summary>
              <ul className="space-y-3 border-t border-warning/15 px-4 py-3">
                {squad.flagged.map((sp) => (
                  <li key={sp.player_id} className="text-sm">
                    <p><PlayerLink id={sp.player_id} className="font-semibold underline decoration-current/40 underline-offset-4">{sp.player?.web_name}</PlayerLink> · {availabilityLabel(sp)}{sp.squad_position > 11 ? " · bench" : ""}{sp.is_captain ? " · current captain" : ""}</p>
                    {sp.player?.news && <p className="mt-1 text-xs leading-relaxed">{sp.player.news}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {picks.length > 0 ? (
            <>
              {missingPlayers > 0 ? (
                <section className="surface p-4">
                  <h2 className="section-title">Your squad</h2>
                  <p className="mt-1 text-sm text-muted">Some player details couldn’t load. Your saved squad is shown below.</p>
                  <SquadList players={squad.starters} xp={xp} fixturesAvailable={!fixturesRes.error} />
                  <h3 className="mt-4 text-sm font-semibold">Bench</h3>
                  <SquadList players={squad.bench} xp={xp} fixturesAvailable={!fixturesRes.error} />
                </section>
              ) : (
                <ViewToggle
                  title="Your squad"
                  note={`${squad.formation}${next && xp.size ? ` · ${next.name} xP on shirts` : ""}`}
                  pitch={<Pitch starters={pitch.starters} bench={pitch.bench} />}
                  list={<div className="surface px-4 py-2"><SquadList players={squad.starters} xp={xp} fixturesAvailable={!fixturesRes.error} /><h3 className="mt-4 mb-1 text-sm font-semibold">Bench</h3><SquadList players={squad.bench} dim xp={xp} fixturesAvailable={!fixturesRes.error} /></div>}
                />
              )}
              <p className="text-xs leading-relaxed text-muted">Squad and captain from the {current?.name} deadline. Transfers made since then appear after the next deadline. Tap any player for details.</p>
              {fixturesRes.error && <p className="text-xs text-muted">Upcoming fixtures couldn’t load. They’re unavailable for now.</p>}
              {teamsRes.error && <p className="text-xs text-muted">Club names couldn’t load. Player details are still available.</p>}
              {next && !completeXI && <p className="text-xs text-muted">Predictions aren’t available for every starter yet. Captain advice and the XI estimate will appear when they’re ready.</p>}
            </>
          ) : (
            <section className="surface p-5">
              <h2 className="section-title">{!current ? "Waiting for the first deadline" : "Your squad isn’t available yet"}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{!current ? "Your squad appears after the first deadline of the season." : fplUnavailable ? "FPL isn’t responding right now. Your team is still linked; try again in a few minutes." : "We couldn’t find a squad for this team. You can try again or check the linked team in Account."}</p>
              {current && <div className="mt-4 flex flex-wrap gap-2"><a href="/me" className="button-secondary">Try again</a><Link href="/account" className="button-secondary">Check team</Link></div>}
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          {next && (
            <section className="surface overflow-hidden" aria-labelledby="recommendation-title">
              <div className="border-b border-line px-5 py-4"><p className="text-xs text-muted">Before the deadline</p><h2 id="recommendation-title" className="section-title mt-0.5">Your {next.name} outlook</h2></div>
              <div className="space-y-5 p-5">
                <div>
                  <h3 className="mb-1 text-xs font-medium text-muted">{suggestion?.chip ? "Chip & transfers" : "Transfers"}</h3>
                  {plan && suggestion ? (
                    <>
                      {suggestion.chip && <p className="mb-2 text-sm font-medium text-accent">Play {suggestion.chip.label}{suggestion.chip.captain ? ` on ${suggestion.chip.captain}` : ""} this week</p>}
                      <p className="font-semibold leading-snug">{suggestion.kind === "move" ? suggestion.moves : suggestion.kind === "squad-chip" ? `${suggestion.chip.label}: ${suggestion.changes} change${suggestion.changes === 1 ? "" : "s"}` : "Roll your transfer"}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted">{suggestion.kind === "roll" && !suggestion.chip ? `No transfer suggested for this deadline. Review later moves over ${gameweekRange(plan)}.` : `${suggestion.kind === "move" && suggestion.hits ? `−${4 * suggestion.hits} transfer hit. ` : ""}${suggestion.gain >= 0 ? "+" : ""}${suggestion.gain.toFixed(1)} xP over ${gameweekRange(plan)} vs keeping your team${laterChips(plan) ? `, including ${laterChips(plan)}` : ""}.`}</p>
                    </>
                  ) : <p className="text-sm leading-relaxed text-muted">{planRes.error ? "Your transfer suggestion couldn’t load. Try opening the planner." : "A transfer suggestion isn’t ready for this deadline yet. You can still build your own plan."}</p>}
                </div>
                <div className="border-t border-line pt-4">
                  <h3 className="mb-2 text-xs font-medium text-muted">Captain</h3>
                  <p className="text-sm"><span className="text-muted">Current </span>{squad.captain ? <PlayerLink id={squad.captain.player_id} className="font-medium">{squad.captain.player?.web_name ?? `Player ${squad.captain.player_id}`}</PlayerLink> : "—"}</p>
                  {captains.length > 0 ? (
                    <>
                      <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span><span className="text-muted">Suggested </span><PlayerLink id={captains[0].player.player_id} className="font-semibold">{captains[0].player.player?.web_name}</PlayerLink></span><span className="font-semibold tabular-nums">{captains[0].xp.toFixed(1)} <span className="font-normal text-muted">xP</span></span></p>
                      <details className="disclosure mt-3 text-xs text-muted">
                        <summary className="flex min-h-9 items-center justify-between gap-2">Captain comparison & xP explained<Chevron /></summary>
                        <div className="space-y-3 pt-2 leading-relaxed">
                          {captains.length > 1 && <ul className="space-y-2">{captains.slice(1).map((c) => <li key={c.player.player_id} className="flex justify-between gap-3"><PlayerLink id={c.player.player_id}>{c.player.player?.web_name}</PlayerLink><span className="tabular-nums">{c.xp.toFixed(1)} xP</span></li>)}</ul>}
                          {xiTotal !== null && <p>Starting XI: <span className="font-medium tabular-nums">{xiTotal.toFixed(1)} xP</span>, with the suggested captain doubled.</p>}
                          <p>Expected points from the Raptor model, adjusted for FPL’s chance of playing. Based on your {current?.name} squad. Suggestions don’t change your official FPL team.</p>
                        </div>
                      </details>
                    </>
                  ) : <p className="mt-1 text-sm text-muted">Suggested captain unavailable until predictions are complete.</p>}
                </div>
                <Link href="/planner" className="button-primary w-full">Open planner <span aria-hidden>→</span></Link>
              </div>
            </section>
          )}

          {stats && current && (
            <details className="disclosure surface">
              <summary className="flex min-h-16 items-center justify-between gap-3 px-5 py-4"><span><span className="block text-xs text-muted">Last deadline · {current.name}{stats.active_chip ? ` · ${CHIP_NAMES[stats.active_chip] ?? stats.active_chip}` : ""}</span><span className="mt-0.5 block text-sm font-semibold">{stats.points == null ? "Results unavailable" : `${stats.points} points`}<span className="ml-2 font-normal text-muted">View results</span></span></span><Chevron /></summary>
              <dl className="grid grid-cols-2 gap-5 border-t border-line p-5 sm:grid-cols-3 lg:grid-cols-2">
                <Stat label="Points" value={String(stats.points ?? "—")} />
                <Stat label="On bench" value={String(stats.points_on_bench ?? "—")} />
                <Stat label="Transfers" value={`${stats.event_transfers ?? "—"}${stats.event_transfers_cost ? ` (−${stats.event_transfers_cost})` : ""}`} />
                <Stat label="Bank" value={formatPrice(stats.bank)} />
                <Stat label="Team value" value={formatPrice(stats.value)} />
                <Stat label="Captain" value={squad.captain?.player?.web_name ?? "—"} />
              </dl>
            </details>
          )}
        </div>
      </div>
    </main>
  );
}
