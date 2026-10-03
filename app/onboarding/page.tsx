import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, currentUserId } from "@/lib/supabase/server";
import OnboardingForm from "./OnboardingForm";

export const metadata: Metadata = { title: "Your team · FPL Raptor" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/onboarding");

  const { data: profile } = await supabase
    .from("profiles")
    .select("fpl_team_id")
    .eq("user_id", userId)
    .maybeSingle<{ fpl_team_id: number | null }>();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {profile?.fpl_team_id ? "Change your team" : "Link your FPL team"}
        </h1>
        <p className="mt-2 text-zinc-500 dark:text-zinc-400">
          Open the FPL site, go to <strong>Points</strong>, and look at the address bar. Your team ID is
          the number after <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">/entry/</code>. You
          can also paste the whole link.
        </p>
      </div>
      <OnboardingForm current={profile?.fpl_team_id ?? null} />
    </main>
  );
}
