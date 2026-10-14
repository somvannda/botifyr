import { describe, expect, it } from "vitest";
import { createPostForMeSocialClient } from "./social-postforme.js";

describe("post for me social client", () => {
  function recorder(response: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => response };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  const accountIds = ["sa_1", "sa_2"];

  it("publishes a caption to every connected account", async () => {
    const { calls, fetchImpl } = recorder({ id: "p1" });
    const client = createPostForMeSocialClient({ apiKey: "k", accountIds, fetchImpl });
    expect(await client.publish("Hello")).toContain("2 account");
    const { url, init } = calls[0]!;
    expect(url).toContain("/social-posts");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(String(init.body));
    expect(body.caption).toBe("Hello");
    expect(body.social_accounts).toEqual(["sa_1", "sa_2"]);
  });

  it("summarizes recent posts for insights", async () => {
    const { fetchImpl } = recorder({
      data: [
        { status: "published", caption: "Launch day" },
        { status: "scheduled" },
      ],
    });
    const client = createPostForMeSocialClient({ apiKey: "k", accountIds, fetchImpl });
    const out = await client.readInsights();
    expect(out).toContain("published: Launch day");
    expect(out).toContain("scheduled");
  });

  it("explains that Post for Me can't reply", async () => {
    const { fetchImpl } = recorder({});
    const client = createPostForMeSocialClient({ apiKey: "k", accountIds, fetchImpl });
    expect(await client.reply("c1", "hi")).toContain("Zernio");
  });

  it("throws on a Post for Me error", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const client = createPostForMeSocialClient({ apiKey: "k", accountIds, fetchImpl });
    await expect(client.publish("x")).rejects.toThrow("Post for Me 401");
  });
});
