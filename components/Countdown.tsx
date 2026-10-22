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

export default function Countdown({ deadline, compact = false }: { deadline: string; compact?: boolean }) {
  const now = useSyncExternalStore(subscribe, nowInSeconds, serverNow);
  const deadlineSeconds = Math.floor(Date.parse(deadline) / 1000);

  if (now === null) {
    return <div className={compact ? "h-11" : "mt-3 h-14"} aria-label="Loading deadline" />;
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
    <div className={compact ? "" : "mt-3"}>
      <p className={`font-semibold tabular-nums tracking-tight ${compact ? "text-lg" : "text-4xl"}`}>
        {left > 0 ? countdown(left) : "Deadline passed"}
      </p>
      <p className={compact ? "text-xs text-muted" : "mt-1 text-sm text-muted"}>{local} your time</p>
    </div>
  );
}
