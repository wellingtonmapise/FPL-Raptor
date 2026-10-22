import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import DraftPlanner from "@/components/DraftPlanner";
import PlanWeeks from "@/components/PlanWeeks";
import { nextGameweek } from "@/lib/gameweek";
import LocalTime from "@/components/LocalTime";
import { formatPrice } from "@/lib/fpl";
import {
  adviceText,
  chipOptions,
  gameweekRange,
  headline,
  laterChips,
  type ChipOption,
  type TransferPlanRow,
} from "@/lib/plan";
import { loadDraftData } from "@/lib/draftData";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Transfer plan · FPL Raptor" };

function Card({ title, note, children }: { title?: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="surface p-5">
      {(title || note) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="section-title">{title}</h2>}
          {note && <span className="text-xs text-muted">{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

const sign = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

const ADVICE_STYLE: Record<ChipOption["advice"], string> = {
  play: "text-violet-700 dark:text-violet-300 font-semibold",
  later: "text-zinc-700 dark:text-zinc-300",
  save: "text-muted",
};

function ChipsCard({ row }: { row: TransferPlanRow }) {
  const options = chipOptions(row);
  if (!options.length) {
    return (
      <Card title="Chips">
        <p className="text-sm text-muted">No chip recommendations available for {gameweekRange(row)}.</p>
      </Card>
    );
  }
  const weeks = Object.keys(options[0].by_week).sort((a, b) => Number(a) - Number(b));
  return (
    <details className="disclosure surface"><summary className="flex min-h-14 items-center justify-between gap-3 p-5 text-sm font-semibold">Chip comparison<span aria-hidden>⌄</span></summary><div className="px-5 pb-5"><p className="mb-3 text-xs text-muted">xP gained compared with the plan without chips</p>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-1 pb-2 text-left font-normal">Chip</th>
              {weeks.map((g) => (
                <th key={g} className="px-1 pb-2 text-right font-normal">
                  GW{g}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={`${o.chip}-${o.expires}`} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="px-1 py-2">
                  <div className="font-medium">{o.label}</div>
                  <div className={`text-xs ${ADVICE_STYLE[o.advice]}`}>{adviceText(o, row)}</div>
                </td>
                {weeks.map((g) => {
                  const v = o.by_week[g];
                  const picked = o.advice !== "save" && String(o.best_week) === g;
                  return (
                    <td
                      key={g}
                      className={`px-1 py-2 text-right tabular-nums ${picked ? "font-semibold text-violet-700 dark:text-violet-300" : "text-muted"}`}
                    >
                      {v === undefined ? "–" : sign(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Each chip is tried in every week and compared with the plan without chips. It&apos;s only played when the gain
        beats what a good week for that chip is usually worth, unless it&apos;s about to expire. A Wildcard&apos;s value
        beyond the planned horizon isn&apos;t counted, so treat its numbers as a floor.
      </p>
      </div></details>
  );
}

function ModeTabs({ build }: { build: boolean }) {
  const tab = (on: boolean) =>
    `flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-center text-sm font-medium ${on ? "bg-surface shadow-sm" : "text-muted"}`;
  return (
    <nav className="mb-5 flex gap-1 rounded-xl bg-surface-muted p-1" aria-label="Planner views">
      <Link href="/planner" aria-current={!build ? "page" : undefined} className={tab(!build)}>
        Suggested plan
      </Link>
      <Link href="/planner?mode=build" aria-current={build ? "page" : undefined} className={tab(build)}>
        Build your own
      </Link>
    </nav>
  );
}

function Method({ row }: { row: TransferPlanRow }) {
  return (
    <details className="disclosure surface">
      <summary className="flex min-h-14 items-center justify-between gap-3 p-5 text-sm font-semibold">How this plan is made<span aria-hidden>⌄</span></summary>
      <div className="space-y-3 px-5 pb-5 text-xs leading-relaxed text-muted">
        <p>Free transfers and selling prices are worked out from your public FPL history. Later weeks are tentative: the plan is re-solved every 3 hours as predictions and news change.</p>
        <p>Horizon totals deduct transfer hits. The comparison keeps your existing squad and chooses its best XI and captain each week. {laterChips(row) ? `The suggested plan includes ${laterChips(row)}.` : ""}</p>
        <p>Expected points come from the FPL Raptor model ({row.model_version}). Generated <LocalTime iso={row.created_at} options={{ day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }} />.</p>
        <p>Track record: a bot following this planner through all of 2025/26 scored 2,107 points, about rank 2.2 million. Treat it as a second opinion alongside team news.</p>
      </div>
    </details>
  );
}

export default async function PlannerPage({ searchParams }: PageProps<"/planner">) {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/planner");
  const build = (await searchParams).mode === "build";
  const [{ data, error: planError }, { data: teamRows }, { data: gwRows }] = await Promise.all([
    supabase.from("transfer_plans").select("from_gameweek,horizon,free_transfers,bank,plan,expected_points,baseline_points,model_version,created_at").eq("user_id", userId).maybeSingle<TransferPlanRow>(),
    supabase.from("teams").select("id,short_name"),
    supabase.from("gameweeks").select("id,deadline_time,is_next").order("id"),
  ]);
  const next = nextGameweek((gwRows ?? []) as { id: number; deadline_time: string; is_next: boolean }[]);
  const clubs = Object.fromEntries(((teamRows ?? []) as { id: number; short_name: string }[]).map((team) => [team.id, team.short_name]));
  const loaded = build ? await loadDraftData(supabase, userId, data) : null;
  const top = data ? headline(data) : null;
  const first = data?.plan.weeks[0];
  const stale = data && next && data.from_gameweek !== next.id;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5"><p className="mb-1 text-xs font-medium text-muted">Prepare your next gameweek</p><h1 className="page-title">Planner</h1></header>
      <ModeTabs build={build} />
      <p className="mb-5 text-xs leading-relaxed text-muted">Based on your last-deadline squad. Transfers since then aren’t visible yet. Drafts and suggestions don’t make changes in FPL.</p>
      {build ? (
        loaded?.ok ? <DraftPlanner key={loaded.data.storageKey} {...loaded.data} /> : <Card title="Your draft isn’t ready"><p className="text-sm text-muted">{loaded && !loaded.ok ? loaded.reason : "Try loading the planner again."}</p><a href="/planner?mode=build" className="button-secondary mt-4">Try again</a></Card>
      ) : !data || !first || !top ? (
        <Card title={planError ? "Your suggestion couldn’t load" : "Your first plan isn’t ready yet"}>
          <p className="text-sm leading-relaxed text-muted">{planError ? "Try again in a moment. Your saved drafts are still available in Build your own." : "Plans update about every 3 hours. You can build your own while waiting for the next suggestion."}</p>
          <Link href="/planner?mode=build" className="button-primary mt-4">Build your own</Link>
        </Card>
      ) : (
        <>
          {stale && <p className="mb-4 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">This saved plan starts at GW{data.from_gameweek}. A suggestion for the next deadline, GW{next.id}, hasn’t arrived yet.</p>}
          <section className="surface mb-6 overflow-hidden" aria-labelledby="recommendation-title">
            <div className="p-5">
              <p className="text-xs font-medium text-muted">{stale ? "Saved recommendation" : `Before the GW${data.from_gameweek} deadline`}</p>
              {top.chip && <p className="mt-2 text-sm font-semibold text-accent">Play {top.chip.label}{top.chip.captain ? ` on ${top.chip.captain}` : ""}</p>}
              <h2 id="recommendation-title" className="mt-1 text-xl font-semibold tracking-tight">{top.kind === "move" ? top.moves : top.kind === "squad-chip" ? `${top.chip.label}: ${top.changes} squad change${top.changes === 1 ? "" : "s"}` : "Roll your transfer"}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{top.kind === "roll" && !top.chip ? "No transfer is suggested for this deadline. Later weeks remain tentative." : `${sign(Number(data.expected_points) - Number(data.baseline_points))} xP over ${gameweekRange(data)} vs keeping your squad, after hits${laterChips(data) ? `, including ${laterChips(data)}` : ""}.`}{top.kind === "squad-chip" && top.chip.id === "freehit" ? " Your squad comes back the following week." : ""}</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                <div><dt className="text-xs text-muted">Free transfers</dt><dd className="mt-1 font-semibold tabular-nums">{data.free_transfers}</dd></div>
                <div><dt className="text-xs text-muted">Bank before moves</dt><dd className="mt-1 font-semibold tabular-nums">{formatPrice(data.bank)}</dd></div>
                <div><dt className="text-xs text-muted">This week’s hit</dt><dd className={`mt-1 font-semibold tabular-nums ${first.hits ? "text-warning" : ""}`}>{first.hits ? `−${first.hits * 4} pts` : "No hit"}</dd></div>
              </dl>
            </div>
            <details className="disclosure border-t border-line">
              <summary className="flex min-h-12 items-center justify-between gap-3 px-5 py-3 text-xs font-medium">Compare totals over {gameweekRange(data)}<span aria-hidden>⌄</span></summary>
              <dl className="grid grid-cols-2 gap-4 px-5 pb-5 text-sm"><div><dt className="text-xs text-muted">With this plan</dt><dd className="mt-1 font-semibold tabular-nums">{Number(data.expected_points).toFixed(1)} xP</dd></div><div><dt className="text-xs text-muted">Keeping your squad</dt><dd className="mt-1 font-semibold tabular-nums">{Number(data.baseline_points).toFixed(1)} xP</dd></div></dl>
            </details>
          </section>
          <PlanWeeks key={data.from_gameweek} weeks={data.plan.weeks} clubs={clubs} aside={<><ChipsCard row={data} /><Method row={data} /></>} />
        </>
      )}
    </main>
  );
}
