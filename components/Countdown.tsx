"use client";

import { useSyncExternalStore } from "react";

// A clock that ticks once a second. On the server (and the first browser
// render) it reports null, so the local time and countdown only appear once
// the page knows the viewer's own clock and time zone.
function subscribe(onTick: () => void) {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
}
const nowInSeconds = () => Math.floor(Date.now() / 1000);
const serverNow = () => null;

function countdown(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export default function Countdown({ deadline }: { deadline: string }) {
  const now = useSyncExternalStore(subscribe, nowInSeconds, serverNow);
  const deadlineSeconds = Math.floor(Date.parse(deadline) / 1000);

  if (now === null) {
    return <p className="mt-3 h-14 text-zinc-500">&nbsp;</p>;
  }

  const left = deadlineSeconds - now;
  const local = new Date(deadline).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mt-3">
      <p className="text-4xl font-semibold tabular-nums tracking-tight">
        {left > 0 ? countdown(left) : "Deadline passed"}
      </p>
      <p className="mt-1 text-zinc-500 dark:text-zinc-400">{local} your time</p>
    </div>
  );
}
