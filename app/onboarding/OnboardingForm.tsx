"use client";

import { useActionState } from "react";
import { saveTeam, type OnboardingState } from "./actions";

export default function OnboardingForm({ current }: { current: number | null }) {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(saveTeam, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="text-sm font-medium">
        Team ID or Points page link
        <input
          name="team"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue={current ?? ""}
          placeholder="e.g. 5057497"
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2.5 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-zinc-700"
        />
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "Checking with FPL…" : "Save my team"}
      </button>
    </form>
  );
}
