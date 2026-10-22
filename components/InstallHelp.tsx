"use client";

import { useSyncExternalStore } from "react";
import { pushDeviceKind, type DeviceKind } from "@/lib/notificationsView";
export type { DeviceKind } from "@/lib/notificationsView";

function subscribe(onChange: () => void) {
  const mode = window.matchMedia("(display-mode: standalone)");
  mode.addEventListener("change",onChange);
  window.addEventListener("pageshow",onChange);
  return () => { mode.removeEventListener("change",onChange); window.removeEventListener("pageshow",onChange); };
}

function detect(): DeviceKind {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return pushDeviceKind({ userAgent:navigator.userAgent, touchPoints:navigator.maxTouchPoints, standalone, supported:"serviceWorker" in navigator && "PushManager" in window && "Notification" in window });
}

/** What this device can do with push. Null during server rendering. */
export function useDeviceKind(): DeviceKind | null {
  return useSyncExternalStore(subscribe, detect, () => null);
}

export function AddToHomeScreen() {
  return (
    <div className="rounded-xl bg-accent-soft p-4 text-sm leading-relaxed text-foreground">
      <p className="font-semibold">On iPhone or iPad, add Raptor to your Home Screen</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Tap the <strong>Share</strong> button in Safari (the square with an arrow).
        </li>
        <li>
          Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </li>
        <li>Open FPL Raptor from the new icon and come back to this page.</li>
      </ol>
      <p className="mt-2 text-xs text-muted">
        Open the Home Screen app to enable notifications on a supported iOS version.
      </p>
    </div>
  );
}

export default function InstallHelp() {
  return <details className="disclosure surface px-4 sm:px-5">
    <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-3 text-sm font-semibold">Add Raptor to your phone<span className="disclosure-arrow" aria-hidden>⌄</span></summary>
    <div className="space-y-4 pb-5 text-sm leading-relaxed"><AddToHomeScreen /><div><h3 className="font-semibold">Android and desktop</h3><p className="mt-1 text-muted">Open your browser’s menu and choose Install app or Add to Home Screen when available. On desktop, look for the install icon beside the address bar.</p></div><p className="text-xs text-muted">Installing is optional. Your team, plans and leagues also work in the browser. Notification preferences are in Account.</p></div>
  </details>;
}
