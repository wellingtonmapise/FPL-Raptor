/** Redirects are shared by password login, OAuth, and team linking. */
export function safeNext(value: unknown): string {
  if (
    typeof value !== "string" || value.length > 2048 ||
    !value.startsWith("/") || value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value) || /%(?:5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
  ) return "/me";

  const url = new URL(value, "https://raptor.invalid");
  if (url.origin !== "https://raptor.invalid" || /^\/(?:login|auth)(?:\/|$)/.test(url.pathname)) return "/me";
  return `${url.pathname}${url.search}${url.hash}`;
}

export function signInDestination(next: unknown, hasTeam: boolean): string {
  const path = safeNext(next);
  if (hasTeam || new URL(path, "https://raptor.invalid").pathname === "/onboarding") return path;
  return path === "/me" ? "/onboarding" : `/onboarding?${new URLSearchParams({ next: path })}`;
}

export function teamLinkedDestination(next: unknown): string {
  const path = safeNext(next);
  return new URL(path, "https://raptor.invalid").pathname === "/onboarding" ? "/me" : path;
}

/** Use a configured canonical origin, rather than a caller-controlled Host. */
export function authOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export const AUTH_ERRORS: Record<string, string> = {
  google: "Google sign-in didn't finish. Try again, or continue with email.",
  session: "That sign-in link has expired or was already used. Please try again.",
  profile: "You're signed in, but we couldn't load your team link. Please try again.",
  linking: "We couldn't finish connecting Google. Sign in to your existing account and check Account before trying again.",
};

export function authError(value: unknown): string | undefined {
  return typeof value === "string" && Object.hasOwn(AUTH_ERRORS, value) ? AUTH_ERRORS[value] : undefined;
}
