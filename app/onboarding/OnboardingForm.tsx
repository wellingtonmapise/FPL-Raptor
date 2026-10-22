"use client";

import { useActionState } from "react";
import { saveTeam, type OnboardingState } from "./actions";

export default function OnboardingForm({ current, next = "/me" }: { current: number | null; next?: string }) {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(saveTeam, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="text-sm font-medium">
        Points page link or team ID
        <input
          name="team"
          type="text"
          inputMode="url"
          autoComplete="off"
          required
          defaultValue={current ?? ""}
          placeholder="Paste your Points link"
          className="form-field mt-1"
        />
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="button-primary"
      >
        {pending ? "Checking your team…" : "Link my team"}
      </button>
    </form>
  );
}
