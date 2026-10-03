"use client";

import { useEffect, useState, useTransition } from "react";
import { AddToHomeScreen, useDeviceKind } from "@/components/InstallHelp";
import { ALERT_TYPES, VAPID_PUBLIC_KEY, type AlertType } from "@/lib/pushConfig";
import { removeSubscription, savePreference, saveSubscription, sendTestNotification } from "./actions";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Status = { tone: "good" | "bad"; text: string } | null;

export default function NotificationSettings({ prefs }: { prefs: Record<AlertType, boolean> }) {
  const device = useDeviceKind();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(prefs);
  const [status, setStatus] = useState<Status>(null);
  const [busy, startTransition] = useTransition();

  // Is this device already subscribed?
  useEffect(() => {
    if (device !== "ready") return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => setSubscribed(false));
  }, [device]);

  function turnOn() {
    startTransition(async () => {
      setStatus(null);
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus({
          tone: "bad",
          text:
            permission === "denied"
              ? "Notifications are blocked for this app. Allow them in your phone's Settings, then try again."
              : "No problem. Tap the button again whenever you're ready.",
        });
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          }));
        const result = await saveSubscription(JSON.parse(JSON.stringify(sub)));
        if (!result.ok) {
          setStatus({ tone: "bad", text: result.error });
          return;
        }
        setSubscribed(true);
        setStatus({ tone: "good", text: "Notifications are on for this device." });
      } catch (err) {
        setStatus({ tone: "bad", text: `Couldn't turn on notifications: ${(err as Error).message}` });
      }
    });
  }

  function turnOff() {
    startTransition(async () => {
      setStatus(null);
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removeSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setStatus({ tone: "good", text: "Notifications are off for this device." });
    });
  }

  function test() {
    startTransition(async () => {
      setStatus(null);
      const result = await sendTestNotification();
      setStatus(result.ok ? { tone: "good", text: result.message ?? "Sent." } : { tone: "bad", text: result.error });
    });
  }

  function toggle(id: AlertType, value: boolean) {
    setEnabled((prev) => ({ ...prev, [id]: value }));
    startTransition(async () => {
      const result = await savePreference(id, value);
      if (!result.ok) {
        setEnabled((prev) => ({ ...prev, [id]: !value }));
        setStatus({ tone: "bad", text: result.error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">This device</h2>
        <div className="mt-3">
          {device === null && <p className="text-zinc-500">Checking this device…</p>}
          {device === "ios-browser" && <AddToHomeScreen />}
          {device === "unsupported" && (
            <p className="text-zinc-600 dark:text-zinc-400">
              This browser can&apos;t receive notifications. Open the site in Safari (iPhone) or Chrome (Android).
            </p>
          )}
          {device === "ready" && (
            <div className="flex flex-col gap-3">
              <p className="text-zinc-600 dark:text-zinc-400">
                {subscribed === null
                  ? "Checking…"
                  : subscribed
                    ? "Notifications are on for this device."
                    : "Notifications are off for this device."}
              </p>
              {subscribed ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    onClick={test}
                    disabled={busy}
                    className="rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Send a test notification
                  </button>
                  <button
                    onClick={turnOff}
                    disabled={busy}
                    className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Turn off on this device
                  </button>
                </div>
              ) : (
                <button
                  onClick={turnOn}
                  disabled={busy || subscribed === null}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? "One moment…" : "Turn on notifications"}
                </button>
              )}
            </div>
          )}
          {status && (
            <p
              role="status"
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                status.tone === "good"
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
              }`}
            >
              {status.text}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">What to send me</h2>
        <p className="mt-1 text-sm text-zinc-500">These apply to every device you&apos;ve turned on.</p>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/80">
          {ALERT_TYPES.map((alert) => (
            <li key={alert.id}>
              <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                <span>{alert.label}</span>
                <input
                  type="checkbox"
                  checked={enabled[alert.id]}
                  onChange={(e) => toggle(alert.id, e.target.checked)}
                  className="h-5 w-5 shrink-0 accent-emerald-600"
                />
              </label>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
