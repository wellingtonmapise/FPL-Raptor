"use client";

import { useActionState } from "react";
import { authenticate, type AuthState } from "./actions";

const inputClass = "form-field mt-1";

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(authenticate, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="text-sm font-medium">
        Email
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
      </label>
      <label className="text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          className={inputClass}
        />
        <span className="mt-1 block text-xs font-normal text-muted">At least 6 characters.</span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-warning-soft px-3 py-3 text-sm text-warning">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="rounded-lg bg-accent-soft px-3 py-3 text-sm text-accent">
          {state.notice}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-3">
        <button
          type="submit"
          name="intent"
          value="signin"
          disabled={pending}
          className="button-primary"
        >
          {pending ? "One moment…" : "Sign in"}
        </button>
        <button
          type="submit"
          name="intent"
          value="signup"
          disabled={pending}
          className="button-secondary"
        >
          Create an account
        </button>
      </div>
    </form>
  );
}
