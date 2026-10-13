import { describe, expect, it } from "vitest";
import { defaultCapabilitiesFor } from "./capability-tools.js";
import { capabilityForTool } from "./tool-capabilities.js";
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
      "Head of Sales",
      "Sales Representative",
      "Customer Success Manager",
      "Finance Analyst",
      "Head of Marketing",
      "Social Media Manager",
      "Support Agent",
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

  it("only names tools the role actually holds (verification)", () => {
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
      "Head of Sales",
      "Sales Representative",
      "Customer Success Manager",
      "Finance Analyst",
      "Head of Marketing",
      "Social Media Manager",
      "Support Agent",
    ];
    // Only match real tool names (company.*, library.*, browser.*, …), not "e.g.".
    const toolPattern =
      /\b(company|library|browser|code|shell|media|social|ads|design|email|feed|group|page|youtube|skills|research|finance|crm|repo)\.[a-z][a-z_]*/g;
    const problems: string[] = [];
    for (const title of titles) {
      const capabilities = defaultCapabilitiesFor({ title, department: "" });
      for (const name of roleInstructionsFor(title).match(toolPattern) ?? []) {
        const capability = capabilityForTool(name);
        if (!capability) continue; // structural / ungated (company.*, skills.*)
        const allowed =
          capabilities.has(capability) ||
          (capability === "browser.use" && capabilities.has("research.web"));
        if (!allowed) problems.push(`${title}: playbook names ${name} but the role lacks ${capability}`);
      }
    }
    expect(problems).toEqual([]);
    // Sanity: the pattern really finds tools (guards against a vacuous pass).
    expect(roleInstructionsFor("CEO").match(toolPattern)?.length ?? 0).toBeGreaterThan(0);
  });
});
