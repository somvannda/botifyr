import { describe, expect, it } from "vitest";
import { scheduledPromptFor } from "./schedule-prompts.js";

describe("scheduledPromptFor", () => {
  it("gives the chair the company standup", () => {
    const prompt = scheduledPromptFor({ title: "CEO", department: "exec", isChair: true });
    expect(prompt).toMatch(/daily standup/i);
    expect(prompt).toContain("company.propose");
    expect(prompt).toContain("company.decide");
  });

  it("gives a department head the review + delegate loop", () => {
    const prompt = scheduledPromptFor({ title: "CTO", department: "engineering" });
    expect(prompt).toContain("company.review_department");
    expect(prompt).toContain("company.delegate");
    expect(prompt).toContain("company.report");
  });

  it("uses the catalog level, so an IC whose title says 'Lead' stays an IC", () => {
    // "Lead Researcher" is sales.researcher (level ic) — the title must not win.
    const prompt = scheduledPromptFor({ title: "Lead Researcher", department: "sales" });
    expect(prompt).not.toContain("company.review_department");
    expect(prompt).toContain("company.report");
  });

  it("falls back to the title for a custom head title", () => {
    expect(scheduledPromptFor({ title: "Head of Vibes", department: "marketing" })).toContain(
      "company.review_department",
    );
  });

  it("gives a plain IC the do-and-report prompt", () => {
    const prompt = scheduledPromptFor({ title: "Backend Engineer", department: "engineering" });
    expect(prompt).toContain("company.report");
    expect(prompt).not.toContain("company.review_department");
  });
});
