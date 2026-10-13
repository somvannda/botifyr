import { describe, expect, it } from "vitest";
import { roleInstructionsFor, withRoleInstructions } from "./role-instructions.js";

describe("role instructions (Phase 1)", () => {
  it("gives the chair the CEO playbook", () => {
    const ceo = roleInstructionsFor("CEO");
    expect(ceo).toContain("standup");
    expect(ceo).toContain("company.decide");
    expect(ceo).toContain("approval");
  });

  it("covers every Phase 1 role", () => {
    const titles = [
      "CEO",
      "Head of Product",
      "Business Analyst",
      "Product Researcher",
      "Content Manager",
      "SEO Specialist",
      "Lead Researcher",
      "Data Analyst",
      "Head of Operations",
      "Compliance Officer",
      "Recruiter",
    ];
    expect(titles.filter((title) => !roleInstructionsFor(title))).toEqual([]);
  });

  it("returns nothing for a role with no guidance yet", () => {
    expect(roleInstructionsFor("Chief Vibes Officer")).toBe("");
  });

  it("composes role guidance before a model-written JD", () => {
    const text = withRoleInstructions("Head of Product", "Focus on the payments roadmap.");
    expect(text).toContain("Head of Product");
    expect(text).toContain("Focus on the payments roadmap.");
    expect(text.indexOf("Head of Product")).toBeLessThan(text.indexOf("Focus on the payments"));
  });

  it("falls back to just the JD when there is no guidance", () => {
    expect(withRoleInstructions("Chief Vibes Officer", "Keep it fun.")).toBe("Keep it fun.");
    expect(withRoleInstructions("CEO", "  ")).toContain("standup");
  });
});
