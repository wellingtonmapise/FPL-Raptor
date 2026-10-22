import { describe, expect, it } from "vitest";
import { completeSquadIds, leagueHref, leagueView, orderedLeagueMembers } from "@/lib/leagueView";
import type { LeaguePick, Member } from "@/lib/league";

const member = (id: number, rank: number | null = id): Member => ({team_id:id,rank,last_rank:rank,manager_name:`Manager ${id}`,team_name:`Team ${id}`,total:100,event_total:30});
const picks = (teamId: number): LeaguePick[] => Array.from({length:15},(_,i)=>({team_id:teamId,player_id:i+1,squad_position:i+1,multiplier:i<11?1:0,is_captain:i===0}));

describe("League view navigation", () => {
  it("defaults to standings and validates explicit views", () => {
    expect(leagueView(null)).toBe("overview");
    expect(leagueView("bad")).toBe("overview");
    expect(leagueView("insights")).toBe("insights");
    expect(leagueView("recap")).toBe("recap");
  });
  it("retains the chosen view when switching leagues", () => {
    expect(leagueHref(777,"overview")).toBe("/league/777");
    expect(leagueHref(888,"insights")).toBe("/league/888?view=insights");
    expect(leagueHref(888,"recap")).toBe("/league/888?view=recap");
  });
});

describe("League snapshot eligibility", () => {
  it("counts complete squads only for members in this league", () => {
    expect(completeSquadIds([member(1),member(2)],[...picks(1),...picks(2).slice(0,14),...picks(3)])).toEqual([1]);
  });
  it("rejects duplicate players, duplicate positions and invalid positions", () => {
    for (const field of ["player_id","squad_position"] as const) {
      const squad=picks(1);squad[14]={...squad[14],[field]:squad[0][field]};
      expect(completeSquadIds([member(1)],squad)).toEqual([]);
    }
    const squad=picks(1);squad[14].squad_position=16;
    expect(completeSquadIds([member(1)],squad)).toEqual([]);
  });
  it("keeps published ranks and places unranked managers last without inventing places", () => {
    const members=[member(3,null),member(2,2),member(1,1),member(4,0)];
    expect(orderedLeagueMembers(members).map(row=>row.team_id)).toEqual([1,2,3,4]);
    expect(members[0].rank).toBeNull();
  });
});
