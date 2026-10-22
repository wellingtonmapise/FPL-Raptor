import Link from "next/link";
import Countdown from "@/components/Countdown";
import InstallHelp from "@/components/InstallHelp";
import LocalTime from "@/components/LocalTime";
import Raptor from "@/components/recap/Raptor";
import { getSupabase } from "@/lib/supabase/public";

// Public and cacheable: no account session or private data enters this page.
export const revalidate = 300;
type Gameweek = { id:number; name:string; deadline_time:string };
type JobRun = { status:string; finished_at:string | null };

async function loadHome() {
  const supabase = getSupabase();
  if (!supabase) return { next:null, lastRun:null, unavailable:true };
  const [next,lastRun] = await Promise.all([
    supabase.from("gameweeks").select("id,name,deadline_time").gt("deadline_time",new Date().toISOString()).order("deadline_time").limit(1).maybeSingle<Gameweek>(),
    supabase.from("job_runs").select("status,finished_at").eq("job","fetch").neq("status","running").order("started_at",{ascending:false}).limit(1).maybeSingle<JobRun>(),
  ]);
  return { next:next.data, lastRun:lastRun.data, unavailable:Boolean(next.error) };
}

export default async function Home() {
  const data = await loadHome();
  return <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
    <div className="grid items-center gap-7 md:grid-cols-[minmax(0,1fr)_20rem]">
      <header>
        <Raptor seed={7} className="mb-4 h-16 w-16" />
        <h1 className="max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">Your gameweek, sorted.</h1>
        <p className="mt-3 max-w-lg text-base leading-relaxed text-muted">Keep an eye on your squad, plan your next transfer and follow the chase in your mini-league.</p>
        <Link href="/me" className="button-primary mt-5">Open my team <span aria-hidden>→</span></Link>
        <p className="mt-3 text-xs text-muted">Sign in, then find and confirm your FPL team.</p>
      </header>
      <section className="surface p-5 sm:p-6" aria-label="Next deadline">
        <h2 className="section-title">{data.next ? data.next.name+" deadline" : "Next deadline"}</h2>
        {data.next ? <Countdown deadline={data.next.deadline_time} /> : <p className="mt-3 text-sm leading-relaxed text-muted">{data.unavailable ? "The deadline couldn’t load right now. Please try again later." : "No upcoming deadline is available yet. Your team and league pages are still here."}</p>}
        {data.lastRun?.finished_at && <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">{data.lastRun.status === "ok" ? "Last data update: " : "Latest data update needs attention. Last attempt: "}<LocalTime iso={data.lastRun.finished_at} options={{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}} /></p>}
      </section>
    </div>
    <section className="border-t border-line pt-6" aria-label="Inside Raptor">
      <dl className="grid gap-6 sm:grid-cols-3">{[
        ["Your squad","Deadline, availability flags and live points in one place."],
        ["Your next move","Compare transfer plans, captain choices and your own scenarios."],
        ["Your mini-league","Follow the standings and catch up with the weekly recap."],
      ].map(([title,body]) => <div key={title}><dt className="text-sm font-semibold">{title}</dt><dd className="mt-2 text-sm leading-relaxed text-muted">{body}</dd></div>)}</dl>
    </section>
    <InstallHelp />
  </main>;
}
