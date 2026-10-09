// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { DEPARTMENTS, type BotRole } from "@botifyr/shared";
import { DEPARTMENT_LABELS, DEPARTMENT_PROMPTS, employeeHero } from "./BotifyrApp";

/**
 * The employee chat empty state should read as "assign work to this person",
 * not the generic "What should Botifyr do?" prompt.
 */

function role(overrides: Partial<BotRole> = {}): BotRole {
  return {
    workspaceId: "ws-1",
    botId: "bot-1",
    title: "Head of Marketing",
    department: "marketing",
    hiredAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("employee empty-state hero", () => {
  it("falls back to the generic hero when the bot is not an employee", () => {
    expect(employeeHero("Botifyr", undefined)).toBeNull();
  });

  it("frames the chat as assigning a task to the employee", () => {
    const hero = employeeHero("Andrés Cárdenas", role());
    expect(hero?.heading).toBe("Assign a task to Andrés Cárdenas");
    expect(hero?.subtitle).toContain("Head of Marketing");
    expect(hero?.subtitle).toContain("Marketing");
    expect(hero?.suggestions.length).toBeGreaterThan(0);
  });

  it("covers every department with a label and at least one suggestion", () => {
    for (const department of DEPARTMENTS) {
      expect(DEPARTMENT_LABELS[department], `label for ${department}`).toBeTruthy();
      expect(DEPARTMENT_PROMPTS[department]?.length ?? 0, `prompts for ${department}`).toBeGreaterThan(0);
    }
  });
});
