import { describe, expect, it } from "vitest";
import { ROLE_BY_ID, recommendTeam } from "./recommend.js";

describe("team recommendation", () => {
  it("matches a vertical and always puts the CEO first", () => {
    const rec = recommendTeam({ text: "a cloud POS for restaurants and retail", stage: "idea" });
    expect(rec.template).toBe("cloud_pos");
    expect(rec.roleIds[0]).toBe("exec.ceo");
    expect(rec.roleIds.every((id) => ROLE_BY_ID.has(id))).toBe(true);
    expect(rec.roleIds.length).toBeLessThanOrEqual(5);
  });

  it("recommends a lean founding team of leaders (no individual contributors)", () => {
    const idea = recommendTeam({ text: "a saas tool", stage: "idea" });
    // Leaders only, capped small — the leaders hire their own specialists later.
    expect(idea.roleIds.length).toBeLessThanOrEqual(5);
    expect(idea.roleIds[0]).toBe("exec.ceo");
    expect(idea.roleIds).not.toEqual(
      expect.arrayContaining(["engineering.backend", "engineering.qa", "design.ux", "sales.rep"]),
    );

    const launched = recommendTeam({ text: "a saas tool", stage: "launched" });
    expect(launched.roleIds.length).toBeLessThanOrEqual(5);
    expect(launched.roleIds[0]).toBe("exec.ceo");
  });

  it("falls back to the saas blueprint for unknown text", () => {
    expect(recommendTeam({ text: "something totally generic" }).template).toBe("saas");
  });
});
