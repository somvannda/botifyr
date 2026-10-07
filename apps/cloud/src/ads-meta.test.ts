import { describe, expect, it } from "vitest";
import { createMetaAdsClient } from "./ads-meta.js";

describe("meta ads client", () => {
  function recorder(response: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => response };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("lists campaigns with status and budget", async () => {
    const { fetchImpl } = recorder({
      data: [{ id: "c1", name: "Launch", status: "ACTIVE", daily_budget: "1000" }],
    });
    const client = createMetaAdsClient({ accessToken: "t", adAccountId: "act_1", fetchImpl });
    const out = await client.readCampaigns();
    expect(out).toContain("Launch");
    expect(out).toContain("$10.00");
  });

  it("pauses a campaign via POST status", async () => {
    const { calls, fetchImpl } = recorder({});
    const client = createMetaAdsClient({ accessToken: "t", adAccountId: "act_1", fetchImpl });
    await client.manage({ campaignId: "c1", action: "pause" });
    const call = calls[0]!;
    expect(call.url).toContain("/c1");
    expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer t");
    expect(JSON.parse(String(call.init.body)).status).toBe("PAUSED");
  });

  it("sets a daily budget", async () => {
    const { calls, fetchImpl } = recorder({});
    const client = createMetaAdsClient({ accessToken: "t", adAccountId: "act_1", fetchImpl });
    await client.manage({ campaignId: "c1", action: "budget", dailyCents: 500 });
    expect(JSON.parse(String(calls[0]!.init.body)).daily_budget).toBe(500);
  });

  it("throws on an API error", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch;
    const client = createMetaAdsClient({ accessToken: "t", adAccountId: "act_1", fetchImpl });
    await expect(client.readCampaigns()).rejects.toThrow("Meta 400");
  });
});
