import { describe, expect, it } from "vitest";
import { authError, authOrigin, safeNext, signInDestination, teamLinkedDestination } from "@/lib/auth";
import { teamCandidates, teamSearchPattern, teamSearchTerm, type TeamMatchRow } from "@/lib/onboarding";

describe("auth destinations", () => {
  it.each([
    null, undefined, 123, "https://evil.example", "//evil.example", "/\\evil.example",
    "/%5cevil.example", "/live\n", "/live%0aLocation:evil", " /me", "/login?next=/me",
    "/auth/callback?code=secret", "/a/../auth/callback", "/%2e%2e/login", "/" + "a".repeat(2048),
  ])("rejects unsafe or looping next destinations: %s", (next) => {
    expect(safeNext(next)).toBe("/me");
  });

  it("retains internal paths, query parameters, and anchors", () => {
    expect(safeNext("/scout?view=stats&pos=3#players")).toBe("/scout?view=stats&pos=3#players");
    expect(safeNext("/league/123")).toBe("/league/123");
  });

  it("asks for a team only when the profile needs one, retaining the requested page", () => {
    expect(signInDestination("/planner?mode=build", true)).toBe("/planner?mode=build");
    expect(signInDestination("/me", false)).toBe("/onboarding");
    const path = new URL(signInDestination("/planner?mode=build", false), "https://raptor.invalid");
    expect(path.pathname).toBe("/onboarding");
    expect(path.searchParams.get("next")).toBe("/planner?mode=build");
    expect(signInDestination("/onboarding", false)).toBe("/onboarding");
    expect(teamLinkedDestination("/onboarding?next=/me")).toBe("/me");
    expect(teamLinkedDestination("//evil.example")).toBe("/me");
  });

  it.each(["https://raptor.example/", "http://localhost:3000", "http://127.0.0.1:3001", "http://[::1]:3000"])("accepts a canonical app origin: %s", (origin) => {
    expect(authOrigin(origin)).toBe(new URL(origin).origin);
  });

  it.each([undefined, "", "invalid", "http://raptor.example", "https://user:pass@raptor.example", "https://raptor.example/app", "https://raptor.example?next=evil", "https://raptor.example#fragment"])("rejects an invalid app origin: %s", (origin) => {
    expect(authOrigin(origin)).toBeNull();
  });

  it("only renders known auth error messages", () => {
    expect(authError("google")).toContain("Google sign-in");
    expect(authError("__proto__")).toBeUndefined();
    expect(authError("constructor")).toBeUndefined();
    expect(authError("raw-provider-token")).toBeUndefined();
  });
});

describe("team discovery", () => {
  const row = (id: number, manager: string, team: string, league: string): TeamMatchRow => ({ team_id: id, manager_name: manager, team_name: team, leagues: { name: league } });

  it("deduplicates a manager's team across leagues without conflating people with the same name", () => {
    const results = teamCandidates([
      row(12, "Sam Lee", "Team One", "Friends"),
      row(12, "Sam Lee", "Team One", "Work"),
      row(12, "Sam Lee", "Team One", "Friends"),
      row(13, "Sam Lee", "Team Two", "Work"),
    ], "Sam Lee");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ id: 12, manager: "Sam Lee", name: "Team One", leagues: ["Friends", "Work"] });
    expect(results[1].id).toBe(13);
  });

  it("puts an exact manager or team match first and bounds the number of choices", () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(i + 1, `Alex ${i}`, `Team ${i}`, "Friends"));
    rows.push(row(99, "Zoe Example", "Exact Team", "Work"));
    const results = teamCandidates(rows, "exact team");
    expect(results).toHaveLength(8);
    expect(results[0].id).toBe(99);
  });

  it("handles empty joins and rejects invalid team IDs", () => {
    expect(teamCandidates([
      { ...row(1, "Sam", "One", "Friends"), leagues: null },
      { ...row(2, "Sam", "Two", "Friends"), leagues: [{ name: "Work" }] },
      row(0, "Sam", "Invalid", "Friends"), row(-1, "Sam", "Invalid", "Friends"),
    ], "Sam")).toEqual([
      { id: 1, manager: "Sam", name: "One", leagues: [] },
      { id: 2, manager: "Sam", name: "Two", leagues: ["Work"] },
    ]);
  });

  it("normalizes and bounds search text while preserving names", () => {
    expect(teamSearchTerm("  José   O'Brien  ")).toBe("José O'Brien");
    expect(teamSearchTerm({ name: "Sam" })).toBe("");
    expect(teamSearchTerm("a".repeat(100))).toHaveLength(80);
    expect(teamSearchPattern("100%_\\" )).toBe("%100\\%\\_\\\\%");
  });
});
