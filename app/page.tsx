import Link from "next/link";
import Countdown from "@/components/Countdown";
import { getSupabase } from "@/lib/supabase/public";

// Rebuild this page at most every 5 minutes; the jobs only update every few hours.
export const revalidate = 300;

type Gameweek = { id: number; name: string; deadline_time: string };
type JobRun = { status: string; finished_at: string | null; detail: string | null };

type HomeData =
  | { state: "not-configured" }
  | { state: "error"; message: string }
  | { state: "ok"; next: Gameweek | null; lastRun: JobRun | null };

async function loadHome(): Promise<HomeData> {
  const supabase = getSupabase();
  if (!supabase) return { state: "not-configured" };

  const [next, lastRun] = await Promise.all([
    supabase
      .from("gameweeks")
      .select("id,name,deadline_time")
      .gt("deadline_time", new Date().toISOString())
      .order("deadline_time")
      .limit(1)
      .maybeSingle<Gameweek>(),
    supabase
      .from("job_runs")
      .select("status,finished_at,detail")
      .eq("job", "fetch")
      .neq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<JobRun>(),
  ]);

  if (next.error) return { state: "error", message: next.error.message };
  return { state: "ok", next: next.data, lastRun: lastRun.data };
}

function timeAgo(iso: string): string {
  const seconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function SetupSteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="font-semibold">{title}</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-600 dark:text-zinc-400">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

export default async function Home() {
  const data = await loadHome();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Your gameweek, sorted.</h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          Deadlines, flags on your players and your mini-league, in one place.
        </p>
      </header>

      {data.state === "not-configured" && (
        <SetupSteps
          title="Connect Supabase to get started"
          steps={[
            "Run supabase/migrations in the Supabase SQL Editor.",
            "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local (or Vercel's environment variables).",
            "Restart the dev server, or redeploy on Vercel.",
          ]}
        />
      )}

      {data.state === "error" && (
        <SetupSteps
          title="Couldn't read from Supabase"
          steps={[
            `Supabase said: ${data.message}`,
            "Check the tables exist: run supabase/migrations in the SQL Editor.",
            "Check the URL and publishable key in your environment variables.",
          ]}
        />
      )}

      {data.state === "ok" && !data.next && (
        <SetupSteps
          title="No gameweek data yet"
          steps={[
            "On GitHub, open Actions → Fetch FPL data → Run workflow.",
            "When it finishes, refresh this page.",
          ]}
        />
      )}

      {data.state === "ok" && data.next && (
        <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
          <p className="text-sm font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            {data.next.name} deadline
          </p>
          <Countdown deadline={data.next.deadline_time} />
        </section>
      )}

      {data.state === "ok" && (
        <Link
          href="/me"
          className="rounded-lg bg-emerald-600 px-4 py-3 text-center font-medium text-white hover:bg-emerald-700"
        >
          Open my gameweek
        </Link>
      )}

      {data.state === "ok" && data.lastRun?.finished_at && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Data {data.lastRun.status === "ok" ? "updated" : `fetch ${data.lastRun.status}`}{" "}
          {timeAgo(data.lastRun.finished_at)}
          {data.lastRun.detail ? ` · ${data.lastRun.detail}` : ""}
        </p>
      )}
    </main>
  );
}
