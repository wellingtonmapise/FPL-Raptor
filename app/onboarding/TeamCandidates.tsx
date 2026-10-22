"use client";

import { useActionState } from "react";
import type { TeamCandidate } from "@/lib/onboarding";
import { saveTeam, type OnboardingState } from "./actions";

export default function TeamCandidates({ teams, next }: { teams: TeamCandidate[]; next: string }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(saveTeam, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <fieldset disabled={pending} className="min-w-0">
        <legend className="mb-3 font-semibold">Is one of these yours?</legend>
        <div className="flex flex-col gap-2">
          {teams.map((team) => (
            <label key={team.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-4 has-checked:border-accent has-checked:bg-accent-soft">
              <input type="radio" name="team" value={team.id} required className="mt-1 h-5 w-5 shrink-0 accent-accent" />
              <span className="min-w-0">
                <span className="block font-semibold break-words">{team.name}</span>
                <span className="block text-sm text-muted">{team.manager}</span>
                <span className="mt-1 block text-xs text-muted">{team.leagues.join(" · ")}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {state.error && <p role="alert" className="text-sm text-warning">{state.error}</p>}
      <button type="submit" disabled={pending} className="button-primary min-h-12">
        {pending ? "Checking your team…" : "Confirm my team"}
      </button>
      <p className="text-xs text-muted">Check the manager and league before confirming. You can change your linked team later.</p>
    </form>
  );
}
