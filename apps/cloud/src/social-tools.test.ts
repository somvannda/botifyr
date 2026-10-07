import { describe, expect, it } from "vitest";
import { createSocialTools, notConnectedSocial, type SocialClient } from "./social-tools.js";

describe("social tools", () => {
  const ctx = { workspaceDir: ".", log: () => {} };

  function fake() {
    const published: string[] = [];
    const replied: Array<[string, string]> = [];
    const client: SocialClient = {
      provider: "Facebook Page",
      readInsights: async () => "reach 1.2k, engagement 4%",
      publish: async (text) => {
        published.push(text);
        return `Published: ${text}`;
      },
      reply: async (threadId, text) => {
        replied.push([threadId, text]);
        return `Replied to ${threadId}`;
      },
    };
    return { client, published, replied };
  }

  const tool = (client: SocialClient, name: string) =>
    createSocialTools(client).find((entry) => entry.name === name)!;

  it("publish and reply require approval; read does not", () => {
    const { client } = fake();
    expect(tool(client, "social.read_insights").requiresApproval).toBeFalsy();
    expect(tool(client, "social.publish").requiresApproval).toBe(true);
    expect(tool(client, "social.reply").requiresApproval).toBe(true);
  });

  it("publishes through the connected client", async () => {
    const { client, published } = fake();
    const result = await tool(client, "social.publish").run({ text: "Hello world" }, ctx);
    expect(result.ok).toBe(true);
    expect(published).toEqual(["Hello world"]);
  });

  it("tells the owner to connect when nothing is connected", async () => {
    const result = await tool(notConnectedSocial("Meta"), "social.publish").run({ text: "Hi" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Connect");
  });

  it("rejects an empty post", async () => {
    const { client } = fake();
    const result = await tool(client, "social.publish").run({ text: "  " }, ctx);
    expect(result.ok).toBe(false);
  });
});
