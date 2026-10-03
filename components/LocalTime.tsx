"use client";

import { useSyncExternalStore } from "react";

// A time in the viewer's own time zone. The server doesn't know it, so this
// renders nothing until the browser takes over.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export default function LocalTime({ iso, options }: { iso: string; options: Intl.DateTimeFormatOptions }) {
  const client = useSyncExternalStore(subscribe, onClient, onServer);
  if (!client) return null;
  return <>{new Date(iso).toLocaleString(undefined, options)}</>;
}
