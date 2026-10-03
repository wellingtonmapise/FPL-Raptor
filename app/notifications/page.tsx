import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ALERT_TYPES, type AlertType } from "@/lib/pushConfig";
import { createClient, currentUserId } from "@/lib/supabase/server";
import NotificationSettings from "./NotificationSettings";

export const metadata: Metadata = { title: "Notifications · FPL Raptor" };

export default async function NotificationsPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/notifications");

  const { data } = await supabase.from("notification_prefs").select("alert_type,enabled");
  // Everything is on unless the user has switched it off.
  const prefs = Object.fromEntries(ALERT_TYPES.map((a) => [a.id, true])) as Record<AlertType, boolean>;
  for (const row of (data ?? []) as { alert_type: string; enabled: boolean }[]) {
    if (row.alert_type in prefs) prefs[row.alert_type as AlertType] = row.enabled;
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          Deadline reminders and news about the players in your team, straight to your phone.
        </p>
      </div>
      <NotificationSettings prefs={prefs} />
    </main>
  );
}
