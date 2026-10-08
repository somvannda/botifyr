import { describe, expect, it } from "vitest";
import { directionsFor, matchTemplate, ROLE_BY_ID, recommendTeam } from "./recommend.js";

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

describe("directions", () => {
  it("matches a vertical, or returns null instead of a silent default", () => {
    expect(matchTemplate("a cloud pos for restaurants")?.id).toBe("cloud_pos");
    expect(matchTemplate("something totally generic")).toBeNull();
  });

  it("offers three stage-ordered directions with valid catalog roles", () => {
    const early = directionsFor({ text: "a cloud pos for restaurants", stage: "idea", industry: "Cloud POS" });
    expect(early).toHaveLength(3);
    // Early stage leads with the product direction.
    expect(early[0]?.id).toBe("dir_product");
    expect(early.map((d) => d.id)).toEqual(["dir_product", "dir_growth", "dir_scale"]);
    for (const direction of early) {
      expect(direction.roles[0]).toBe("exec.ceo");
      expect(direction.roles.every((id) => ROLE_BY_ID.has(id))).toBe(true);
      expect(direction.estimatedTokens).toBe(direction.roles.length * 150_000);
      expect(direction.roadmap.length).toBeGreaterThan(0);
    }

    // A launched product leads with growth.
    const late = directionsFor({ text: "a cloud pos", stage: "launched", industry: "Cloud POS" });
    expect(late[0]?.id).toBe("dir_growth");
  });

  it("flags an unclassifiable business instead of quietly defaulting to saas", () => {
    const directions = directionsFor({ text: "something totally generic", stage: "idea", industry: "Widgets" });
    const product = directions.find((d) => d.id === "dir_product");
    expect(product?.rationale.join(" ")).toContain("Couldn't confidently classify");
    expect(product?.roles).toContain("product.manager");
  });

  it("keeps only product/engineering roles in the product direction", () => {
    const directions = directionsFor({ text: "a cloud pos for restaurants", stage: "idea" });
    const product = directions.find((d) => d.id === "dir_product");
    // cloud_pos core includes marketing/sales, which must not leak into product.
    expect(product?.roles).not.toContain("marketing.manager");
    expect(product?.roles).not.toContain("sales.manager");
    expect(product?.roles).toContain("engineering.cto");
  });
});
