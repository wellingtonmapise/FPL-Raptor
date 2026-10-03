"use client";

import { usePlayerSheet } from "@/components/PlayerSheet";

// A player's name that opens their card, for lists and tables.
export default function PlayerLink({ id, children, className = "" }: { id: number; children: React.ReactNode; className?: string }) {
  const { open } = usePlayerSheet();
  return (
    <button
      type="button"
      onClick={() => open(id)}
      className={`min-w-0 cursor-pointer text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-600 ${className}`}
    >
      {children}
    </button>
  );
}
