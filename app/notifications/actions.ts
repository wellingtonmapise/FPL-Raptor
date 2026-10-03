"use server";

import webpush from "web-push";
import { ALERT_TYPES, VAPID_PUBLIC_KEY, VAPID_SUBJECT, type AlertType } from "@/lib/pushConfig";
import { createClient, currentUserId } from "@/lib/supabase/server";

type Result = { ok: true; message?: string } | { ok: false; error: string };

type BrowserSubscription = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

async function signedIn() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  return { supabase, userId };
}

/** Save this device's push subscription for the signed-in user. */
export async function saveSubscription(sub: BrowserSubscription): Promise<Result> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false, error: "You've been signed out. Sign in again." };
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { ok: false, error: "This browser returned an incomplete subscription." };
  }
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { user_id: userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      { onConflict: "endpoint" },
    );
  if (error) {
    return {
      ok: false,
      error: /row-level security/i.test(error.message)
        ? "This device is already set up for another account. Turn notifications off there first."
        : `Couldn't save: ${error.message}`,
    };
  }
  return { ok: true };
}

export async function removeSubscription(endpoint: string): Promise<Result> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false, error: "You've been signed out. Sign in again." };
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function savePreference(alertType: AlertType, enabled: boolean): Promise<Result> {
  if (!ALERT_TYPES.some((a) => a.id === alertType)) return { ok: false, error: "Unknown alert type." };
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false, error: "You've been signed out. Sign in again." };
  const { error } = await supabase
    .from("notification_prefs")
    .upsert({ user_id: userId, alert_type: alertType, enabled }, { onConflict: "user_id,alert_type" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Push a test notification to every device the user has turned on. */
export async function sendTestNotification(): Promise<Result> {
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return { ok: false, error: "Push isn't set up on the server yet: VAPID_PRIVATE_KEY is missing in Vercel." };
  }
  const { supabase, userId } = await signedIn();
  if (!userId) return { ok: false, error: "You've been signed out. Sign in again." };

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth");
  if (error) return { ok: false, error: error.message };
  if (!subs?.length) return { ok: false, error: "Turn on notifications on this device first." };

  const payload = JSON.stringify({
    title: "FPL Raptor",
    body: "Notifications are working. You'll hear from me before the next deadline.",
    url: "/notifications",
    tag: "test",
  });

  let delivered = 0;
  const problems: string[] = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
        vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey },
        TTL: 60 * 60,
      });
      delivered += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // The device unsubscribed or reinstalled the app; forget it.
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        problems.push(status ? `push service said ${status}` : (err as Error).message);
      }
    }
  }

  if (delivered === 0) {
    return { ok: false, error: problems[0] ?? "No devices are subscribed any more. Turn notifications on again." };
  }
  return { ok: true, message: `Sent to ${delivered} device${delivered === 1 ? "" : "s"}.` };
}
