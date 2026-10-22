import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), currentUserId: vi.fn(), getEntry: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient, currentUserId: mocks.currentUserId }));
vi.mock("@/lib/fplApi", () => ({ getEntry: mocks.getEntry }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));

import { authenticate, connectGoogle, signInWithGoogle } from "@/app/login/actions";
import { GET } from "@/app/auth/callback/route";
import { saveTeam } from "@/app/onboarding/actions";
import { searchTeams } from "@/lib/teamSearch";

const user = { id: "raptor-user", email: "sam@example.com" };
function client() {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { fpl_team_id: 12 }, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }), ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(query), query,
    auth: {
      signInWithOAuth: vi.fn().mockResolvedValue({ data: { url: "https://auth.example/authorize" }, error: null }),
      linkIdentity: vi.fn().mockResolvedValue({ data: { url: "https://auth.example/link" }, error: null }),
      exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      signUp: vi.fn().mockResolvedValue({ data: { user, session: { user } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}

let supabase: ReturnType<typeof client>;
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
function callback(query: string) { return GET(new Request(`https://raptor.example/auth/callback?${query}`)); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GOOGLE_AUTH_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://raptor.example");
  supabase = client();
  mocks.createClient.mockResolvedValue(supabase);
  mocks.currentUserId.mockResolvedValue(user.id);
  mocks.getEntry.mockResolvedValue({ ok: true, data: { id: 12, name: "Team One", player_first_name: "Sam", player_last_name: "Lee" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("Google initiation", () => {
  it("uses the configured origin and validated requested destination", async () => {
    await expect(signInWithGoogle({}, form({ next: "/planner?mode=build" }))).rejects.toThrow("REDIRECT:https://auth.example/authorize");
    const args = supabase.auth.signInWithOAuth.mock.calls[0][0];
    const url = new URL(args.options.redirectTo);
    expect(args.provider).toBe("google");
    expect(args.options.scopes).toBe("openid email profile");
    expect(url.origin).toBe("https://raptor.example");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("next")).toBe("/planner?mode=build");
  });

  it("rejects a forged external next destination", async () => {
    await expect(signInWithGoogle({}, form({ next: "/\\evil.example" }))).rejects.toThrow("REDIRECT:");
    const url = new URL(supabase.auth.signInWithOAuth.mock.calls[0][0].options.redirectTo);
    expect(url.searchParams.get("next")).toBe("/me");
  });

  it("does not offer a broken provider when disabled or misconfigured", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "false");
    expect(await signInWithGoogle({}, form({}))).toHaveProperty("error");
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "true");
    vi.stubEnv("APP_URL", "https://evil.example/path");
    expect(await signInWithGoogle({}, form({}))).toHaveProperty("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns a usable fallback without exposing the provider's error", async () => {
    supabase.auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: "internal-provider-detail" } });
    const result = await signInWithGoogle({}, form({}));
    expect(result.error).toContain("continue with email");
    expect(result.error).not.toContain("internal-provider-detail");
  });

  it("requires a session to connect Google and uses identity linking instead of new login", async () => {
    mocks.currentUserId.mockResolvedValue(null);
    await expect(connectGoogle({}, form({}))).rejects.toThrow("REDIRECT:/login?next=/account");
    expect(supabase.auth.linkIdentity).not.toHaveBeenCalled();
    mocks.currentUserId.mockResolvedValue(user.id);
    await expect(connectGoogle({}, form({}))).rejects.toThrow("REDIRECT:https://auth.example/link");
    const url = new URL(supabase.auth.linkIdentity.mock.calls[0][0].options.redirectTo);
    expect(url.searchParams.get("flow")).toBe("link");
    expect(url.searchParams.get("next")).toBe("/account");
    expect(supabase.auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe("OAuth callback", () => {
  it("exchanges the code and reuses the existing team without overwriting the profile", async () => {
    const response = await callback("code=one-use-code&next=%2Fplanner");
    expect(response.headers.get("location")).toBe("https://raptor.example/planner");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("one-use-code", undefined);
    expect(supabase.query.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(supabase.query.upsert).not.toHaveBeenCalled();
  });

  it("routes a new user to team discovery and retains their destination", async () => {
    supabase.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await callback("code=code&next=%2Fplanner%3Fmode%3Dbuild");
    const url = new URL(response.headers.get("location")!);
    expect(url.pathname).toBe("/onboarding");
    expect(url.searchParams.get("next")).toBe("/planner?mode=build");
  });

  it("passes the SDK's per-flow PKCE identifier back unchanged when supplied", async () => {
    await callback("code=code&sb_flow_id=flow-identifier");
    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("code", { flowId: "flow-identifier" });
  });

  it("returns to the configured public origin when Next supplies an internal request hostname", async () => {
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=code&next=/planner"));
    expect(response.headers.get("location")).toBe("https://raptor.example/planner");
  });

  it.each(["error=access_denied&error_description=private-detail", "next=%2Fme"])("handles cancellation or a missing code: %s", async (query) => {
    const response = await callback(query);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.headers.get("location")).not.toContain("private-detail");
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("handles expired codes without echoing them", async () => {
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    const response = await callback("code=private-code");
    expect(response.headers.get("location")).toContain("error=session");
    expect(response.headers.get("location")).not.toContain("private-code");
  });

  it("does not mistake a profile outage for a new user", async () => {
    supabase.query.maybeSingle.mockResolvedValue({ data: null, error: { message: "database down" } });
    const response = await callback("code=code");
    expect(response.headers.get("location")).toContain("/login?error=profile");
    expect(supabase.query.upsert).not.toHaveBeenCalled();
  });

  it("returns a successful identity link to Account with the same user", async () => {
    const response = await callback("code=code&flow=link");
    expect(response.headers.get("location")).toBe("https://raptor.example/account?connected=google");
    expect(supabase.query.upsert).not.toHaveBeenCalled();
  });

  it("requires an existing session for linking and rejects an account switch", async () => {
    mocks.currentUserId.mockResolvedValue(null);
    expect((await callback("code=code&flow=link")).headers.get("location")).toContain("error=linking");
    expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    mocks.currentUserId.mockResolvedValue(user.id);
    supabase.auth.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "another-user" } }, error: null });
    expect((await callback("code=code&flow=link")).headers.get("location")).toContain("error=linking");
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("email access and team persistence", () => {
  it("keeps email login working and skips onboarding for a linked team", async () => {
    await expect(authenticate({}, form({ email: user.email, password: "password", next: "/scout" }))).rejects.toThrow("REDIRECT:/scout");
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: "password" });
  });

  it("keeps the requested destination when a new email user needs a team", async () => {
    supabase.query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(authenticate({}, form({ email: user.email, password: "password", intent: "signup", next: "/live" }))).rejects.toThrow("REDIRECT:/onboarding?next=%2Flive");
  });

  it("requires sign-in before persisting a team", async () => {
    mocks.currentUserId.mockResolvedValue(null);
    await expect(saveTeam({}, form({ team: "12", next: "/planner" }))).rejects.toThrow("REDIRECT:/login?");
    expect(mocks.getEntry).not.toHaveBeenCalled();
    expect(supabase.query.upsert).not.toHaveBeenCalled();
  });

  it("stores the FPL entry against the Supabase UUID and returns to the requested page", async () => {
    await expect(saveTeam({}, form({ team: "https://fantasy.premierleague.com/entry/12/event/5", next: "/planner?mode=build" }))).rejects.toThrow("REDIRECT:/planner?mode=build");
    expect(supabase.query.upsert).toHaveBeenCalledWith({ user_id: user.id, fpl_team_id: 12, display_name: "Sam Lee" }, { onConflict: "user_id" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each(["not-found", "unavailable"])("does not replace a team when FPL validation fails: %s", async (reason) => {
    mocks.getEntry.mockResolvedValue({ ok: false, reason });
    expect(await saveTeam({}, form({ team: "12" }))).toHaveProperty("error");
    expect(supabase.query.upsert).not.toHaveBeenCalled();
  });

  it("does not steal a team attached to another account", async () => {
    supabase.query.upsert.mockResolvedValue({ error: { code: "23505" } });
    const result = await saveTeam({}, form({ team: "12" }));
    expect(result.error).toContain("already linked to another account");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("does not query all followed teams for an empty search", async () => {
    const results = await searchTeams(supabase as unknown as Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>, " ");
    expect(results.candidates).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("bounds candidate queries, escapes wildcards, and reports failures without partial guesses", async () => {
    supabase.query.returns.mockResolvedValue({ data: null, error: { message: "down" } });
    const results = await searchTeams(supabase as unknown as Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>, "Sam% Lee");
    expect(results).toEqual({ candidates: [], unavailable: true });
    expect(supabase.query.ilike).toHaveBeenCalledWith("manager_name", "%Sam\\%%");
    expect(supabase.query.limit).toHaveBeenCalledWith(12);
  });
});
