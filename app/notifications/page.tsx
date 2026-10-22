import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { notificationPreferences } from "@/lib/notificationsView";
import { createClient, currentUserId } from "@/lib/supabase/server";
import NotificationSettings from "./NotificationSettings";

export const metadata: Metadata = {title:"Notifications · FPL Raptor"};

export default async function NotificationsPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login?next=/notifications");
  const [prefs,subscriptions] = await Promise.all([
    supabase.from("notification_prefs").select("alert_type,enabled").eq("user_id",userId),
    supabase.from("push_subscriptions").select("endpoint").eq("user_id",userId),
  ]);
  return <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
    <header><Link href="/account" className="text-link inline-flex min-h-11 items-center text-sm">← Account</Link><h1 className="page-title mt-2">Notifications</h1><p className="mt-2 text-sm leading-relaxed text-muted">Deadline reminders, player news and league updates. You choose what reaches your devices.</p></header>
    <NotificationSettings key={userId} prefs={prefs.error ? null : notificationPreferences(prefs.data ?? [])} savedEndpoints={subscriptions.error ? null : (subscriptions.data ?? []).map(row => row.endpoint as string)} />
  </main>;
}
