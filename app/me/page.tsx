import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import Countdown from "@/components/Countdown";
import { availabilityLabel, SquadList } from "@/components/Squad";
import { formatPrice } from "@/lib/fpl";
import { getEntry, getPicks } from "@/lib/fplApi";
import {
  buildSquad,
  CHIP_NAMES,
  nextGameweek,
  type Fixture,
  type Pick,
  type Player,
  type Team,
} from "@/lib/gameweek";
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

const PLAYER_COLUMNS = "id,web_name,team_id,position,now_cost,status,news,chance_of_playing_next_round";

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
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
    supabase.from("gameweeks").select("id,name,deadline_time,is_current,is_next").order("id"),
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
        .select("active_chip,points,points_on_bench,event_transfers,event_transfers_cost,bank,value")
        .eq("team_id", teamId)
        .eq("gameweek_id", current.id)
        .maybeSingle<GameweekStats>(),
      supabase
        .from("picks")
        .select("player_id,squad_position,multiplier,is_captain,is_vice_captain")
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
        stats = { ...live.data.entry_history, active_chip: live.data.active_chip };
      } else {
        fplUnavailable = live.reason === "unavailable";
      }
    }
  }

  const [playersRes, fixturesRes] = await Promise.all([
    picks.length
      ? supabase.from("players").select(PLAYER_COLUMNS).in("id", picks.map((p) => p.player_id))
      : Promise.resolve({ data: [] }),
    next
      ? supabase
          .from("fixtures")
          .select("id,gameweek_id,home_team_id,away_team_id,home_difficulty,away_difficulty,kickoff_time")
          .eq("gameweek_id", next.id)
      : Promise.resolve({ data: [] }),
  ]);
  const squad = buildSquad(
    picks,
    (playersRes.data ?? []) as Player[],
    teams,
    (fixturesRes.data ?? []) as Fixture[],
  );

  const teamName = entry.ok ? entry.data.name : null;
  const managerName = entry.ok
    ? `${entry.data.player_first_name} ${entry.data.player_last_name}`
    : profile.display_name;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{teamName ?? "My gameweek"}</h1>
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

      {picks.length > 0 && (
        <Card title={squad.flagged.length ? "Needs attention" : undefined}>
          {squad.flagged.length === 0 ? (
            <p className="text-zinc-600 dark:text-zinc-400">No injury or availability flags in your team.</p>
          ) : (
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
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{sp.player.news}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {stats && current && (
        <Card title={`${current.name}${stats.active_chip ? ` · ${CHIP_NAMES[stats.active_chip] ?? stats.active_chip}` : ""}`}>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Points" value={String(stats.points ?? "-")} />
            <Stat label="On bench" value={String(stats.points_on_bench ?? "-")} />
            <Stat
              label="Transfers"
              value={`${stats.event_transfers ?? 0}${stats.event_transfers_cost ? ` (−${stats.event_transfers_cost})` : ""}`}
            />
            <Stat label="Bank" value={formatPrice(stats.bank)} />
            <Stat label="Team value" value={formatPrice(stats.value)} />
            <Stat label="Captain" value={squad.captain?.player?.web_name ?? "-"} />
          </div>
        </Card>
      )}

      {picks.length > 0 ? (
        <Card>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="font-semibold">Starting XI</h2>
            <span className="text-sm text-zinc-500">
              {squad.formation}
              {next ? ` · ${next.name} fixtures` : ""}
            </span>
          </div>
          <SquadList players={squad.starters} />
          <h2 className="mt-4 mb-1 font-semibold">Bench</h2>
          <SquadList players={squad.bench} dim />
          <p className="mt-4 text-xs text-zinc-500">
            Your team as of the {current?.name} deadline. FPL doesn&apos;t share transfers until the next
            deadline passes.
          </p>
        </Card>
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

      <div className="flex items-center justify-between text-sm">
        <div className="flex gap-4">
          <Link href="/notifications" className="text-zinc-500 underline-offset-4 hover:underline">
            Notifications
          </Link>
          <Link href="/onboarding" className="text-zinc-500 underline-offset-4 hover:underline">
            Change team
          </Link>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-zinc-500 underline-offset-4 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
