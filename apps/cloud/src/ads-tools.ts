import type { ToolDefinition } from "@botifyr/agent-core";

/**
 * Ads hand (docs/company-workspace.md Part III §25, item 14): read campaigns and
 * change status/budget. Changing spend is consequential → approval-gated. The
 * provider client is injected (Meta Ads API, or a supervised browser fallback);
 * until connected, the tools explain how to connect.
 */
export interface AdsClient {
  provider: string;
  readCampaigns(): Promise<string>;
  manage(input: { campaignId: string; action: "pause" | "resume" | "budget"; dailyCents?: number }): Promise<string>;
}

export function notConnectedAds(provider = "Meta Ads"): AdsClient {
  const message = `No ${provider} account is connected yet. Connect an ads account first (Meta Business / Ads).`;
  return { provider, readCampaigns: async () => message, manage: async () => message };
}

export function createAdsTools(client: AdsClient): ToolDefinition[] {
  return [
    {
      name: "ads.insights",
      description: `List the connected ${client.provider} campaigns (status, budget, spend).`,
      parameters: { type: "object", properties: {} },
      run: async () => {
        try {
          return { ok: true, output: await client.readCampaigns() };
        } catch (error) {
          return { ok: false, output: String(error) };
        }
      },
    },
    {
      name: "ads.manage",
      description: `Pause, resume, or change the daily budget of a ${client.provider} campaign. Needs the owner's approval — it spends money.`,
      parameters: {
        type: "object",
        properties: {
          campaignId: { type: "string", description: "The campaign id." },
          action: { type: "string", enum: ["pause", "resume", "budget"] },
          dailyCents: { type: "number", description: "New daily budget in cents (for action=budget)." },
        },
        required: ["campaignId", "action"],
      },
      requiresApproval: true,
      run: async (args) => {
        const campaignId = String(args.campaignId ?? "").trim();
        if (!campaignId) return { ok: false, output: "A campaign id is required." };
        const action = args.action === "resume" ? "resume" : args.action === "budget" ? "budget" : "pause";
        try {
          return {
            ok: true,
            output: await client.manage({
              campaignId,
              action,
              dailyCents: typeof args.dailyCents === "number" ? args.dailyCents : undefined,
            }),
          };
        } catch (error) {
          return { ok: false, output: String(error) };
        }
      },
    },
  ];
}
