import { describe, expect, it } from "vitest";
import { createEmailTools, type EmailSender } from "./email-tools.js";

describe("email tool", () => {
  const ctx = { workspaceDir: ".", log: () => {} };

  it("requires approval and sends through the sender", async () => {
    const sent: Array<{ to: string; subject: string; body: string }> = [];
    const sender: EmailSender = {
      send: async (input) => {
        sent.push(input);
        return true;
      },
    };
    const [tool] = createEmailTools(sender);
    expect(tool!.requiresApproval).toBe(true);
    const result = await tool!.run({ to: "a@b.com", subject: "Hi", body: "Hello" }, ctx);
    expect(result.ok).toBe(true);
    expect(sent[0]).toMatchObject({ to: "a@b.com", subject: "Hi" });
  });

  it("explains when email isn't configured", async () => {
    const [tool] = createEmailTools(null);
    const result = await tool!.run({ to: "a@b.com", subject: "Hi", body: "Hello" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("configured");
  });

  it("rejects missing fields", async () => {
    const sender: EmailSender = { send: async () => true };
    const [tool] = createEmailTools(sender);
    const result = await tool!.run({ to: "a@b.com" }, ctx);
    expect(result.ok).toBe(false);
  });
});
