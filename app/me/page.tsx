import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Countdown from "@/components/Countdown";
import Pitch from "@/components/Pitch";
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
import { signOut } from "../login/actions";

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

function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      {title && <h2 className="mb-3 font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

export default async function MyGameweekPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/me");

  const { data: profile } = await supabase
    .from("profiles")
    .select("fpl_team_id,display_name")
    .eq("user_id", userId)
    .maybeSingle<{ fpl_team_id: number | null; display_name: string | null }>();
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
      : Promise.resolve({ data: [] }),
    next
      ? supabase
          .from("fixtures")
          .select(
            "id,gameweek_id,home_team_id,away_team_id,home_difficulty,away_difficulty,kickoff_time",
          )
          .eq("gameweek_id", next.id)
      : Promise.resolve({ data: [] }),
    next && picks.length
      ? supabase
          .from("predictions")
          .select("player_id,expected_points,created_at")
          .eq("gameweek_id", next.id)
          .in("player_id", playerIds)
      : Promise.resolve({ data: [] }),
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
  const captains = captainOptions(squad.starters, xp).slice(0, 3);
  const xiTotal = expectedXI(squad.starters, xp);
  // Only show a plan made for the coming deadline (and none until the table exists).
  const plan =
    planRes.data && next && planRes.data.from_gameweek === next.id
      ? planRes.data
      : null;
  const suggestion = plan ? headline(plan) : null;
  const pitch = teamPitch(squad.starters, squad.bench, xp);

  const teamName = entry.ok ? entry.data.name : null;
  const managerName = entry.ok
    ? `${entry.data.player_first_name} ${entry.data.player_last_name}`
    : profile.display_name;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          {teamName ?? "My gameweek"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {[
            managerName,
            entry.ok && entry.data.summary_overall_points != null
              ? `${entry.data.summary_overall_points} pts`
              : null,
            entry.ok && entry.data.summary_overall_rank != null
              ? `Rank ${entry.data.summary_overall_rank.toLocaleString("en-US")}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      {next && (
        <Card>
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {next.name} deadline
          </p>
          <Countdown deadline={next.deadline_time} />
          <Link
            href="/notifications"
            className="mt-3 inline-block text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            Remind me before the deadline →
          </Link>
        </Card>
      )}

      {picks.length > 0 ? (
        <ViewToggle
          title="Your team"
          note={`${squad.formation}${xp.size ? ", shirts show xP" : ""}`}
          pitch={<Pitch starters={pitch.starters} bench={pitch.bench} />}
          list={
            <Card>
              <SquadList players={squad.starters} xp={xp} />
              <h2 className="mt-4 mb-1 font-semibold">Bench</h2>
              <SquadList players={squad.bench} dim xp={xp} />
            </Card>
          }
        />
      ) : (
        <Card>
          <p className="text-zinc-600 dark:text-zinc-400">
            {!current
              ? "Your squad shows up here after the first deadline of the season."
              : fplUnavailable
                ? "FPL isn't responding right now, so your squad can't load. Try again in a few minutes."
                : "Couldn't find a squad for this team yet. Check your team ID is right."}
          </p>
        </Card>
      )}
      {picks.length > 0 && (
        <p className="-mt-3 text-xs text-zinc-500">
          Tap a player for their card. This is your team as of the{" "}
          {current?.name} deadline: FPL doesn&apos;t share transfers until the
          next deadline passes.
        </p>
      )}

      {squad.flagged.length > 0 && (
        <Card title="Needs attention">
          <ul className="flex flex-col gap-3">
            {squad.flagged.map((sp) => (
              <li key={sp.player_id}>
                <div className="font-medium">
                  {sp.player?.web_name}{" "}
                  <span className="text-sm font-normal text-zinc-500">
                    {sp.club} · {availabilityLabel(sp)}
                    {sp.squad_position > 11 ? " · on your bench" : ""}
                    {sp.is_captain ? " · your captain" : ""}
                  </span>
                </div>
                {sp.player?.news && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    {sp.player.news}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {next && captains.length > 0 && (
        <Card title={`${next.name} captain`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-lg font-semibold">
              {captains[0].player.player?.web_name}{" "}
              <span className="text-base font-normal text-zinc-500">
                {captains[0].xp.toFixed(1)} xP
              </span>
            </p>
            {xiTotal !== null && (
              <span className="text-sm text-zinc-500">
                XI: {xiTotal.toFixed(1)} xP
              </span>
            )}
          </div>
          {captains.length > 1 && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Then{" "}
              {captains
                .slice(1)
                .map((c) => `${c.player.player?.web_name} ${c.xp.toFixed(1)}`)
                .join(", ")}
              .
            </p>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            Expected points from the FPL Raptor model, scaled by FPL&apos;s
            chance of playing. Based on your {current?.name} team.
          </p>
        </Card>
      )}

      {plan && suggestion && (
        <Card
          title={suggestion.chip ? "Chip and transfers" : "Transfer suggestion"}
        >
          {suggestion.chip && (
            <p className="mb-2 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200">
              Play {suggestion.chip.label}
              {suggestion.chip.captain
                ? ` on ${suggestion.chip.captain}`
                : ""}{" "}
              this week
            </p>
          )}
          <p className="text-lg font-semibold">
            {suggestion.kind === "move"
              ? suggestion.moves
              : suggestion.kind === "squad-chip"
                ? `${suggestion.chip.label}: ${suggestion.changes} change${suggestion.changes === 1 ? "" : "s"}`
                : "Roll your transfer"}
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {suggestion.kind === "roll" && !suggestion.chip
              ? `Nothing gains more than a point over ${gameweekRange(plan)}. You have ${plan.free_transfers} free transfer${plan.free_transfers === 1 ? "" : "s"}.`
              : `${suggestion.kind === "move" && suggestion.hits ? `Worth a −${4 * suggestion.hits} hit. ` : ""}+${suggestion.gain.toFixed(1)} xP over ${gameweekRange(plan)} vs keeping your team${laterChips(plan) ? `, including ${laterChips(plan)}` : ""}.`}
          </p>
          <Link
            href="/planner"
            className="mt-3 inline-block text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
          >
            See the full plan{plan.plan.chips?.length ? " and chips" : ""} →
          </Link>
        </Card>
      )}

      {stats && current && (
        <Card
          title={`${current.name}${stats.active_chip ? ` · ${CHIP_NAMES[stats.active_chip] ?? stats.active_chip}` : ""}`}
        >
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Points" value={String(stats.points ?? "-")} />
            <Stat
              label="On bench"
              value={String(stats.points_on_bench ?? "-")}
            />
            <Stat
              label="Transfers"
              value={`${stats.event_transfers ?? 0}${stats.event_transfers_cost ? ` (−${stats.event_transfers_cost})` : ""}`}
            />
            <Stat label="Bank" value={formatPrice(stats.bank)} />
            <Stat label="Team value" value={formatPrice(stats.value)} />
            <Stat
              label="Captain"
              value={squad.captain?.player?.web_name ?? "-"}
            />
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm">
        <div className="flex gap-4">
          <Link
            href="/planner"
            className="text-zinc-500 underline-offset-4 hover:underline"
          >
            Planner
          </Link>
          <Link
            href="/notifications"
            className="text-zinc-500 underline-offset-4 hover:underline"
          >
            Notifications
          </Link>
          <Link
            href="/onboarding"
            className="text-zinc-500 underline-offset-4 hover:underline"
          >
            Change team
          </Link>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="text-zinc-500 underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
