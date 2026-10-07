import { describe, expect, it } from "vitest";
import { ROLE_BY_ID, recommendTeam } from "./recommend.js";

describe("team recommendation", () => {
  it("matches a vertical and always puts the CEO first", () => {
    const rec = recommendTeam({ text: "a cloud POS for restaurants and retail", stage: "idea" });
    expect(rec.template).toBe("cloud_pos");
    expect(rec.roleIds[0]).toBe("exec.ceo");
    expect(rec.roleIds.every((id) => ROLE_BY_ID.has(id))).toBe(true);
    expect(rec.roleIds.length).toBeLessThanOrEqual(8);
  });

  it("is build-heavy early and go-to-market-heavy once launched", () => {
    const idea = recommendTeam({ text: "a saas tool", stage: "idea" });
    expect(idea.roleIds).toEqual(
      expect.arrayContaining(["engineering.backend", "engineering.qa", "design.ux"]),
    );

    const launched = recommendTeam({ text: "a saas tool", stage: "launched" });
    expect(launched.roleIds).toEqual(
      expect.arrayContaining(["sales.rep", "marketing.social", "support.agent"]),
    );
    expect(launched.roleIds).not.toContain("engineering.qa");
  });

  it("falls back to the saas blueprint for unknown text", () => {
    expect(recommendTeam({ text: "something totally generic" }).template).toBe("saas");
  });
});
