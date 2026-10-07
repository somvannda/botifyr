import { describe, expect, it } from "vitest";
import { createAdsTools, notConnectedAds, type AdsClient } from "./ads-tools.js";

describe("ads tools", () => {
  const ctx = { workspaceDir: ".", log: () => {} };

  function fake() {
    const managed: Array<{ campaignId: string; action: string; dailyCents?: number }> = [];
    const client: AdsClient = {
      provider: "Meta Ads",
      readCampaigns: async () => "Campaign A — active — $10/day",
      manage: async (input) => {
        managed.push(input);
        return `Done: ${input.action} ${input.campaignId}`;
      },
    };
    return { client, managed };
  }
  const tool = (client: AdsClient, name: string) =>
    createAdsTools(client).find((entry) => entry.name === name)!;

  it("manage requires approval; insights does not", () => {
    const { client } = fake();
    expect(tool(client, "ads.insights").requiresApproval).toBeFalsy();
    expect(tool(client, "ads.manage").requiresApproval).toBe(true);
  });

  it("manages a campaign through the client", async () => {
    const { client, managed } = fake();
    const result = await tool(client, "ads.manage").run(
      { campaignId: "c1", action: "budget", dailyCents: 500 },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(managed[0]).toMatchObject({ campaignId: "c1", action: "budget", dailyCents: 500 });
  });

  it("explains when ads aren't connected", async () => {
    const result = await tool(notConnectedAds(), "ads.insights").run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Connect");
  });

  it("rejects a missing campaign id", async () => {
    const { client } = fake();
    const result = await tool(client, "ads.manage").run({ action: "pause" }, ctx);
    expect(result.ok).toBe(false);
  });
});
