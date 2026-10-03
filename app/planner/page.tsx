import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import PlanWeeks from "@/components/PlanWeeks";
import { formatPrice } from "@/lib/fpl";
import {
  adviceText,
  chipOptions,
  gameweekRange,
  headline,
  laterChips,
  WORTHWHILE_GAIN,
  type ChipOption,
  type TransferPlanRow,
} from "@/lib/plan";
import { createClient, currentUserId } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Transfer plan · FPL Raptor" };

function Card({ title, note, children }: { title?: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      {(title || note) && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          {title && <h2 className="font-semibold">{title}</h2>}
          {note && <span className="text-xs text-zinc-500">{note}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

const sign = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

const CHIP_BADGE =
  "inline-block rounded bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200";
const ADVICE_STYLE: Record<ChipOption["advice"], string> = {
  play: "text-violet-700 dark:text-violet-300 font-semibold",
  later: "text-zinc-700 dark:text-zinc-300",
  save: "text-zinc-500",
};

function ChipsCard({ row }: { row: TransferPlanRow }) {
  const options = chipOptions(row);
  if (!options.length) {
    return (
      <Card title="Chips">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">No chips left to play in {gameweekRange(row)}.</p>
      </Card>
    );
  }
  const weeks = Object.keys(options[0].by_week).sort((a, b) => Number(a) - Number(b));
  return (
    <Card title="Chips" note="xP gained if played that week">
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <thead>
            <tr className="text-xs text-zinc-500">
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
                      className={`px-1 py-2 text-right tabular-nums ${picked ? "font-semibold text-violet-700 dark:text-violet-300" : "text-zinc-600 dark:text-zinc-400"}`}
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
      <p className="mt-3 text-xs text-zinc-500">
        Each chip is tried in every week and compared with the plan without chips. It&apos;s only played when the gain
        beats what a good week for that chip is usually worth, unless it&apos;s about to expire. A Wildcard&apos;s value
        beyond these four weeks isn&apos;t counted, so treat its numbers as a floor.
      </p>
    </Card>
  );
}

export default async function PlannerPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/planner");

  const [{ data }, { data: teamRows }] = await Promise.all([
    supabase
      .from("transfer_plans")
      .select("from_gameweek,horizon,free_transfers,bank,plan,expected_points,baseline_points,model_version,created_at")
      .eq("user_id", userId)
      .maybeSingle<TransferPlanRow>(),
    supabase.from("teams").select("id,short_name"),
  ]);
  const clubs = Object.fromEntries(((teamRows ?? []) as { id: number; short_name: string }[]).map((t) => [t.id, t.short_name]));

  if (!data) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Transfer plan</h1>
        <Card>
          <p className="text-zinc-600 dark:text-zinc-400">
            Your first plan appears after the next update, within about 3 hours of linking your team.
          </p>
        </Card>
      </main>
    );
  }

  const top = headline(data);
  const gain = Number(data.expected_points) - Number(data.baseline_points);
  const weeks = data.plan.weeks;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Transfer plan</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {gameweekRange(data)} · {data.free_transfers} free transfer{data.free_transfers === 1 ? "" : "s"} ·{" "}
          {formatPrice(data.bank)} in the bank
        </p>
      </header>

      <Card title={`Before the GW${data.from_gameweek} deadline`}>
        {top.chip && (
          <p className={`mb-2 ${CHIP_BADGE}`}>
            Play {top.chip.label}
            {top.chip.captain ? ` on ${top.chip.captain}` : ""} this week
          </p>
        )}
        {top.kind === "squad-chip" ? (
          <>
            <p className="text-lg font-semibold">
              {top.chip.label}: {top.changes} change{top.changes === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {sign(gain)} expected points over {gameweekRange(data)} compared with keeping your team.
              {top.chip.id === "freehit" ? " Your squad comes back the week after." : ""}
            </p>
          </>
        ) : top.kind === "move" ? (
          <>
            <p className="text-lg font-semibold">{top.moves}</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {top.hits > 0 ? `Worth a −${4 * top.hits} hit: ` : ""}
              {sign(gain)} expected points over {gameweekRange(data)} compared with keeping your team
              {laterChips(data) ? `, including ${laterChips(data)}` : ""}.
            </p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">Roll your transfer</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              No move gains more than {WORTHWHILE_GAIN} point over {gameweekRange(data)}, so banking it is as good as
              spending it.
            </p>
          </>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-zinc-500">With this plan</dt>
            <dd className="font-semibold tabular-nums">{Number(data.expected_points).toFixed(1)} xP</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Keeping your team</dt>
            <dd className="font-semibold tabular-nums">{Number(data.baseline_points).toFixed(1)} xP</dd>
          </div>
        </dl>
      </Card>

      <ChipsCard row={data} />

      <PlanWeeks weeks={weeks} clubs={clubs} />

      <p className="text-xs text-zinc-500">
        The plan starts from your team at the last deadline; transfers you&apos;ve made since aren&apos;t visible to the
        app. Free transfers and selling prices are worked out from your public FPL history, and later weeks are
        tentative: the plan is re-solved every 3 hours as predictions and news change. Expected points come from the FPL
        Raptor model ({data.model_version}).
      </p>
      <p className="text-xs text-zinc-500">
        Track record: a bot following this planner through all of 2025/26 scored 2,107 points, about rank 2.2 million.
        Decent, not elite, and it can&apos;t read team news, so treat it as a second opinion.
      </p>
      <Link href="/me" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
        Back to My gameweek
      </Link>
    </main>
  );
}
