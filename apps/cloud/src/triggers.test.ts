import { describe, expect, it } from "vitest";
import type { Trigger } from "@botifyr/shared";
import { TRIGGER_PAYLOAD_MAX, buildTriggerGoal, findTrigger, normalizeTriggerName } from "./triggers.js";

const trigger = (overrides: Partial<Trigger> = {}): Trigger => ({
  name: "new-ticket",
  botId: "b1",
  prompt: "Triage this support ticket.",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("triggers", () => {
  it("normalises a name to URL-safe form", () => {
    expect(normalizeTriggerName("  New Ticket!  ")).toBe("new-ticket");
    expect(normalizeTriggerName("a/b c")).toBe("a-b-c");
    expect(normalizeTriggerName("   ")).toBe("");
  });

  it("finds an enabled trigger by name", () => {
    const list = [trigger(), trigger({ name: "other" })];
    expect(findTrigger(list, "new-ticket")?.name).toBe("new-ticket");
    expect(findTrigger(list, "NEW-TICKET")?.name).toBe("new-ticket");
    expect(findTrigger(list, "missing")).toBeNull();
    expect(findTrigger(undefined, "new-ticket")).toBeNull();
  });

  it("never returns a disabled trigger", () => {
    expect(findTrigger([trigger({ enabled: false })], "new-ticket")).toBeNull();
  });

  it("builds a goal from the prompt alone when there is no payload", () => {
    expect(buildTriggerGoal(trigger())).toBe("Triage this support ticket.");
  });

  it("labels a payload as untrusted and caps its size", () => {
    const goal = buildTriggerGoal(trigger(), { subject: "Help", body: "x".repeat(5000) });
    expect(goal).toContain("Triage this support ticket.");
    expect(goal).toContain("untrusted data");
    expect(goal).toContain("\"subject\":\"Help\"");
    // The payload is truncated, so the goal stays bounded.
    expect(goal.length).toBeLessThan(TRIGGER_PAYLOAD_MAX + 200);
    expect(goal).toContain("…");
  });
});
