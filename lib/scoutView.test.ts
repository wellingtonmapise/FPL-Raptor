import { describe, expect, it } from "vitest";
import { matchesScoutSearch, scoutHref, scoutMetric, scoutParams } from "@/lib/scoutView";
import { statRow, type ScoutPlayer } from "@/lib/scout";

const parse = (query = "") => scoutParams(new URLSearchParams(query));
const player: ScoutPlayer = { id:1, web_name:"Fernández", team_id:1, position:3, now_cost:65, status:"a", chance_of_playing_next_round:100, selected_by_percent:null, form:4.5, total_points:29 };

describe("Scout URL context", () => {
  it("starts with player discovery and rejects malformed controls", () => {
    expect(parse()).toEqual({view:"players",weeks:6,pos:0,sort:"xp",range:"season",q:""});
    expect(parse("view=unknown&weeks=9&pos=2.5&sort=unknown&range=unknown")).toEqual(parse());
  });
  it.each(["fixtures","stats","differentials","ask"])("preserves the %s deep link", view => expect(parse(`view=${view}`).view).toBe(view));
  it("round trips filters across views without corrupting text", () => {
    const params = parse("view=stats&pos=3&range=recent&sort=xgi90&q=Fern%C3%A1ndez%20%26%20Co&weeks=3");
    const url = scoutHref(params,{view:"fixtures"});
    expect(parse(url.split("?")[1])).toEqual({...params,view:"fixtures"});
  });
});

describe("Scout discovery", () => {
  it("matches names, accents, clubs and multiple words", () => {
    expect(matchesScoutSearch("Fernández","Chelsea CHE","fernandez che")).toBe(true);
    expect(matchesScoutSearch("Ødegaard","Arsenal ARS","odegaard")).toBe(true);
    expect(matchesScoutSearch("Palmer","Chelsea CHE","palmer arsenal")).toBe(false);
    expect(matchesScoutSearch("Palmer","Chelsea CHE","  ")).toBe(true);
  });
  it("does not invent projections, per-90 figures or unknown ownership", () => {
    const row = statRow(player,undefined,"season",180);
    expect(scoutMetric(row,"xp")).toBe("—");
    expect(scoutMetric(row,"xgi90")).toBe("—");
    expect(scoutMetric(row,"owned")).toBe("—");
    expect(scoutMetric(row,"price")).toBe("£6.5m");
    expect(scoutMetric(row,"points")).toBe("29");
  });
});
