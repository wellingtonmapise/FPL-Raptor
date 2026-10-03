"use client";

import { useSyncExternalStore } from "react";

export type DeviceKind =
  | "ios-browser" // iPhone/iPad in Safari: must add to Home Screen before push works
  | "ready" // push is available here
  | "unsupported"; // e.g. an in-app browser or an old phone

const noSubscribe = () => () => {};

function detect(): DeviceKind {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isIOS && !standalone) return "ios-browser";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    ? "ready"
    : "unsupported";
}

/** What this device can do with push. Null during server rendering. */
export function useDeviceKind(): DeviceKind | null {
  return useSyncExternalStore(noSubscribe, detect, () => null);
}

export function AddToHomeScreen() {
  return (
    <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100">
      <p className="font-semibold">On iPhone, add FPL Raptor to your Home Screen first</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          Tap the <strong>Share</strong> button in Safari (the square with an arrow).
        </li>
        <li>
          Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </li>
        <li>Open FPL Raptor from the new icon and come back to this page.</li>
      </ol>
      <p className="mt-2 text-emerald-800 dark:text-emerald-300">
        Apple only allows notifications from apps on the Home Screen, not from Safari tabs.
      </p>
    </div>
  );
}
