import { describe, expect, it } from "vitest";
import { createZernioAdsClient, createZernioSocialClient } from "./social-zernio.js";

describe("zernio social client", () => {
  function recorder(response: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => response };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  const accounts = [
    { platform: "facebook", accountId: "acct_fb" },
    { platform: "instagram", accountId: "acct_ig" },
  ];

  it("publishes now to every connected account", async () => {
    const { calls, fetchImpl } = recorder({ _id: "p1" });
    const client = createZernioSocialClient({ apiKey: "z", accounts, fetchImpl });
    expect(await client.publish("Hello")).toContain("facebook");
    const { url, init } = calls[0]!;
    expect(url).toContain("/posts");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer z");
    const body = JSON.parse(String(init.body));
    expect(body.publishNow).toBe(true);
    expect(body.content).toBe("Hello");
    expect(body.platforms).toEqual([
      { platform: "facebook", accountId: "acct_fb" },
      { platform: "instagram", accountId: "acct_ig" },
    ]);
  });

  it("summarizes recent posts for insights", async () => {
    const { fetchImpl } = recorder({
      posts: [
        { status: "published", platforms: [{ platform: "facebook" }] },
        { status: "scheduled", platforms: [{ platform: "instagram" }] },
      ],
    });
    const client = createZernioSocialClient({ apiKey: "z", accounts, fetchImpl });
    const out = await client.readInsights();
    expect(out).toContain("published on facebook");
    expect(out).toContain("scheduled on instagram");
  });

  it("replies into a conversation", async () => {
    const { calls, fetchImpl } = recorder({ ok: true });
    const client = createZernioSocialClient({ apiKey: "z", accounts, fetchImpl });
    await client.reply("conv_1", "Thanks!");
    expect(calls[0]!.url).toContain("/inbox/conversations/conv_1/messages");
    expect(JSON.parse(String(calls[0]!.init.body)).text).toBe("Thanks!");
  });

  it("throws on a Zernio error", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const client = createZernioSocialClient({ apiKey: "z", accounts, fetchImpl });
    await expect(client.publish("x")).rejects.toThrow("Zernio 429");
  });
});

describe("zernio ads client", () => {
  function recorder(response: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => response };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  const options = { apiKey: "z", accounts: [{ platform: "facebook", accountId: "acct_fb" }] };

  it("lists campaigns", async () => {
    const { fetchImpl } = recorder({ campaigns: [{ id: "c1", name: "Spring", status: "ACTIVE" }] });
    const client = createZernioAdsClient({ ...options, fetchImpl });
    expect(await client.readCampaigns()).toContain("Spring");
  });

  it("pauses a campaign and converts cents to whole units for budgets", async () => {
    const { calls, fetchImpl } = recorder({ ok: true });
    const client = createZernioAdsClient({ ...options, fetchImpl });

    await client.manage({ campaignId: "c1", action: "pause" });
    expect(calls[0]!.url).toContain("/ads/c1/status");
    expect(JSON.parse(String(calls[0]!.init.body)).status).toBe("PAUSED");

    await client.manage({ campaignId: "c1", action: "budget", dailyCents: 2500 });
    expect(calls[1]!.init.method).toBe("PUT");
    expect(JSON.parse(String(calls[1]!.init.body)).dailyBudget).toBe(25);
  });
});
