import { describe, expect, it } from "vitest";
import type { CapabilityGrant } from "@botifyr/shared";
import { applyCapabilityUse, promotionThreshold, readyForPromotion } from "./capability-ladder.js";

const grant = (patch: Partial<CapabilityGrant> = {}): CapabilityGrant => ({
  workspaceId: "w1",
  subject: "role:CTO",
  capability: "deploy.production",
  granted: true,
  state: "probation",
  updatedAt: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("capability trust ladder", () => {
  it("counts successes without changing state", () => {
    const result = applyCapabilityUse(grant({ successes: 2 }), true);
    expect(result.successes).toBe(3);
    expect(result.failures).toBe(0);
    expect(result.state).toBe("probation");
    expect(result.lastUsedAt).toBeTruthy();
  });

  it("demotes one step on failure", () => {
    expect(applyCapabilityUse(grant({ state: "trusted" }), false).state).toBe("probation");
    expect(applyCapabilityUse(grant({ state: "probation" }), false).state).toBe("gated");
    expect(applyCapabilityUse(grant({ state: "gated" }), false).state).toBe("gated");
  });

  it("flags a promotion only with enough clean successes", () => {
    expect(readyForPromotion(grant({ capability: "email.send", successes: 4 }))).toBe(false);
    expect(readyForPromotion(grant({ capability: "email.send", successes: 5 }))).toBe(true);
    expect(readyForPromotion(grant({ capability: "email.send", successes: 5, failures: 1 }))).toBe(false);
    expect(readyForPromotion(grant({ capability: "email.send", state: "trusted", successes: 99 }))).toBe(false);
  });

  it("needs more successes for money capabilities", () => {
    expect(promotionThreshold("ads.manage")).toBe(10);
    expect(promotionThreshold("payments.charge")).toBe(10);
    expect(promotionThreshold("email.send")).toBe(5);
  });
});
