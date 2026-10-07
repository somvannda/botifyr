import { describe, expect, it } from "vitest";
import { createEscalationTools } from "./escalation-tools.js";

describe("escalation tool", () => {
  const ctx = { workspaceDir: ".", log: () => {} };

  it("requires approval and echoes the reason", async () => {
    const [tool] = createEscalationTools();
    expect(tool!.requiresApproval).toBe(true);
    const result = await tool!.run({ reason: "Solve the CAPTCHA on the ads page" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("CAPTCHA");
  });

  it("handles a missing reason", async () => {
    const [tool] = createEscalationTools();
    const result = await tool!.run({}, ctx);
    expect(result.ok).toBe(true);
  });
});
